# AI 生成簡報 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓使用者在首頁貼一段文字內容，透過本機 `claude` CLI 把它轉成一份 SimPPT 簡報 markdown，直接載入編輯器。

**Architecture:** 新增一個純函式模組 `lib/generate-prompt.mjs` 組出要餵給 `claude -p` 的完整 prompt（語法規則＋任務指示＋使用者內容），`server.js` 新增 `POST /__generate`：收 raw text body、`spawn('claude', ['-p'])`、把 prompt 整包寫進 child 的 stdin、收集 stdout 當結果回傳。前端 `index.html` 首頁加一顆「AI 生成」按鈕開一個彈窗（textarea + 生成鈕），呼叫該端點成功後比照「新簡報」按鈕的做法呼叫既有的 `enterEditor(text)`。

**Tech Stack:** Node.js 內建 `node:http` / `node:child_process`（零外部 npm 依賴，沿用專案既有慣例）；前端純 vanilla JS/HTML/CSS（單檔 `index.html`）。

## Global Constraints

- 只給本機開發環境用；正式站沒有登入的 `claude` CLI 天然打不通，**不額外加環境旗標**（程式碼照樣進 repo）。
- 沿用既有 `authorized()` token 機制（跟 `/__save`、`/__upload` 一致），未授權回 401。
- Body 大小上限 200 * 1024 bytes（200KB），超過或空白回 413。
- `claude` 子行程逾時保護：120000ms（120 秒），逾時 `child.kill()` 並回 504。
- 生成結果只信任 `claude -p` 輸出的原始文字，**不做輸出格式驗證**（YAGNI，若之後常常生成壞格式再加）。
- 成功回應固定格式 `{"ok":true,"markdown":"..."}`；失敗固定格式 `{"ok":false,"message":"..."}`。
- 實際呼叫 `claude` CLI 的 I/O 不寫自動測試；只測試純函式 `buildGeneratePrompt`，其餘靠手動驗證。

---

### Task 1: 抽出可測試的 prompt 組裝函式

**Files:**
- Create: `C:\dev\SimPPT\lib\generate-prompt.mjs`
- Create: `C:\dev\SimPPT\test\generate-prompt.test.mjs`
- Modify: `C:\dev\SimPPT\package.json:6-9`（`test` script 串起兩份測試檔）

**Interfaces:**
- Produces: `buildGeneratePrompt(userContent: string): string`，from `lib/generate-prompt.mjs`（ESM named export）。回傳值是一整段字串，包含任務指示 + SimPPT 語法規則 + 使用者原始內容；供 Task 2 的 server.js 當作 `claude -p` 的 stdin 輸入。

- [ ] **Step 1: 寫失敗的測試**

Create `C:\dev\SimPPT\test\generate-prompt.test.mjs`:

```js
import assert from 'node:assert/strict'
import { buildGeneratePrompt } from '../lib/generate-prompt.mjs'

const tests = []
const test = (name, fn) => tests.push({ name, fn })

test('includes SimPPT syntax rules (layout/accent)', () => {
  const prompt = buildGeneratePrompt('hello world')
  assert.ok(prompt.includes('layout=split'))
  assert.ok(prompt.includes('accent'))
})

test('includes the user content verbatim', () => {
  const prompt = buildGeneratePrompt('這是我的筆記內容 ABC123')
  assert.ok(prompt.includes('這是我的筆記內容 ABC123'))
})

test('instructs markdown-only output, no code fence, no preamble', () => {
  const prompt = buildGeneratePrompt('x')
  assert.ok(prompt.includes('不要包在'))
  assert.ok(prompt.includes('不要加任何說明文字'))
})

test('different calls with different content produce different prompts', () => {
  const a = buildGeneratePrompt('內容 A')
  const b = buildGeneratePrompt('內容 B')
  assert.notEqual(a, b)
})

let failed = 0
for (const { name, fn } of tests) {
  try {
    fn()
    process.stdout.write(`ok - ${name}\n`)
  } catch (err) {
    failed += 1
    process.stdout.write(`FAIL - ${name}\n  ${err.message}\n`)
  }
}
process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`)
process.exit(failed === 0 ? 0 : 1)
```

- [ ] **Step 2: 執行測試，確認失敗**

Run: `node test/generate-prompt.test.mjs`
Expected: 拋出模組找不到的錯誤（`Cannot find module '.../lib/generate-prompt.mjs'`），因為 `lib/generate-prompt.mjs` 還不存在。

- [ ] **Step 3: 寫最小實作**

Create `C:\dev\SimPPT\lib\generate-prompt.mjs`:

```js
const TASK_INSTRUCTIONS = `你是簡報設計助手。請把下面「使用者原始內容」拆成一份完整的 SimPPT 簡報（多個分頁），並且：
- 挑一組協調的配色（bg / color / accent）寫在檔案開頭的 frontmatter。
- 依內容長短拆成合理的分頁數，每頁不要塞太多字。
- 適當使用 **粗體** 標出重點（會自動套用 accent 色強調）。
- 只有在使用者內容明確描述某頁該用圖片或適合左右分欄時才使用 layout=split，不要憑空捏造圖片網址。
- 直接輸出最終的簡報 markdown 本身，不要包在 \`\`\` code fence 裡，也不要加任何說明文字、前言或後語。`

const SYNTAX_SPEC = `SimPPT 簡報 markdown 語法規則：
- 檔案開頭可選 frontmatter：一行 ---，接著若干 key: value（例如 bg: #1a1a2e、color: #ffffff、accent: #d84a3f），再一行 --- 結束。這些是全域預設。
- 分頁：獨立一行、恰好三個 dash --- 代表換頁（四個以上 dash 不算分頁）。
- 分頁同時可接 key=value 覆蓋該頁設定，例如：--- bg=#0f3460 color=#eee。加上 set（例如 --- set bg=#ffffff color=#1c1c1e）代表從這頁起都套用這組設定，不加 set 只作用這一頁。
- --- layout=top：標題在上、內文在下、左對齊。
- --- layout=split：左圖右文，該頁若有圖片會固定在左半邊。
- accent：設定後，內文的 **粗體** 文字會自動套用這個顏色來強調重點。
- 內容支援：#/##/### 標題、-/* 無序列表、1. 有序列表、![]() 圖片、**粗體**、*斜體*、反引號 code、[連結]()、一般段落。`

export const buildGeneratePrompt = (userContent) =>
  `${TASK_INSTRUCTIONS}\n\n${SYNTAX_SPEC}\n\n---\n使用者原始內容如下（請根據以上規則轉成 SimPPT markdown）：\n---\n\n${userContent}`
```

- [ ] **Step 4: 執行測試，確認通過**

Run: `node test/generate-prompt.test.mjs`
Expected: `4/4 passed`

- [ ] **Step 5: 把測試腳本串進 npm test**

Modify `C:\dev\SimPPT\package.json`:

Old:
```json
  "scripts": {
    "start": "node server.js",
    "test": "node test/parser.test.mjs"
  }
```

New:
```json
  "scripts": {
    "start": "node server.js",
    "test": "node test/parser.test.mjs && node test/generate-prompt.test.mjs"
  }
```

Run: `npm test`
Expected: 兩份測試檔都跑完並全數 passed。

- [ ] **Step 6: Commit**

```bash
git add lib/generate-prompt.mjs test/generate-prompt.test.mjs package.json
git commit -m "feat: add pure prompt-builder for AI deck generation"
```

---

### Task 2: server.js 新增 `/__generate` 端點

**Files:**
- Modify: `C:\dev\SimPPT\server.js:1-4`（imports）
- Modify: `C:\dev\SimPPT\server.js:30`（authorized 檢查加上 `/__generate`）
- Modify: `C:\dev\SimPPT\server.js:83-84`（插入新的路由分支）

**Interfaces:**
- Consumes: `buildGeneratePrompt(userContent: string): string`（Task 1）。
- Produces: HTTP contract `POST /__generate`
  - Request: raw text body（使用者貼的內容），沿用既有 `X-Simppt-Token` header 授權。
  - Response 200: `{"ok":true,"markdown":"<生成的 SimPPT deck markdown>"}`
  - Response 401/413/500/504: `{"ok":false,"message":"<人類看得懂的錯誤訊息>"}`
  - 前端 Task 3 直接消費這個 contract。

- [ ] **Step 1: 加上兩個新 import**

Modify `C:\dev\SimPPT\server.js`:

Old:
```js
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
```

New:
```js
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { buildGeneratePrompt } from './lib/generate-prompt.mjs'
```

- [ ] **Step 2: 把 `/__generate` 納入 authorized 檢查**

Modify `C:\dev\SimPPT\server.js`:

Old:
```js
    if (req.method === 'POST' && (urlPath === '/__upload' || urlPath === '/__save') && !authorized(req)) {
```

New:
```js
    if (req.method === 'POST' && (urlPath === '/__upload' || urlPath === '/__save' || urlPath === '/__generate') && !authorized(req)) {
```

- [ ] **Step 3: 插入 `/__generate` 路由分支**

Modify `C:\dev\SimPPT\server.js`, 找到 `/__save` 分支結尾與靜態檔案 fallback 之間：

Old:
```js
          fs.writeFileSync(full, text, 'utf8')
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end('{"ok":true}')
        } catch (err) {
          res.writeHead(400)
          res.end('Bad request')
        }
      })
      return
    }
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')
```

New:
```js
          fs.writeFileSync(full, text, 'utf8')
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end('{"ok":true}')
        } catch (err) {
          res.writeHead(400)
          res.end('Bad request')
        }
      })
      return
    }
    if (req.method === 'POST' && urlPath === '/__generate') {
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        const buf = Buffer.concat(chunks)
        if (buf.length === 0 || buf.length > 200 * 1024) {
          res.writeHead(413, { 'Content-Type': 'application/json' })
          res.end('{"ok":false,"message":"內容過大或空白（上限 200KB）"}')
          return
        }
        const prompt = buildGeneratePrompt(buf.toString('utf8'))
        const child = spawn('claude', ['-p'], { cwd: ROOT, shell: true })
        let stdout = ''
        let stderr = ''
        let settled = false
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          child.kill()
          res.writeHead(504, { 'Content-Type': 'application/json' })
          res.end('{"ok":false,"message":"生成逾時（120 秒），請稍後再試"}')
        }, 120000)
        child.stdout.on('data', (chunk) => { stdout += chunk })
        child.stderr.on('data', (chunk) => { stderr += chunk })
        child.on('error', (err) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          const message = err.code === 'ENOENT'
            ? '找不到 claude 指令，請確認本機已安裝並登入 Claude Code CLI'
            : `啟動失敗：${err.message}`
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, message }))
        })
        child.on('close', (code) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (code !== 0) {
            const message = stderr.trim().split('\n').slice(0, 5).join('\n') || `claude 結束碼 ${code}`
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, message }))
            return
          }
          const markdown = stdout.trim()
          if (!markdown) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end('{"ok":false,"message":"AI 沒有回傳內容"}')
            return
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, markdown }))
        })
        child.stdin.write(prompt)
        child.stdin.end()
      })
      return
    }
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')
```

- [ ] **Step 4: 手動驗證錯誤路徑（不需要真的裝 claude CLI）**

Run (重啟 server 讓新程式碼生效，再測試空 body 會被拒絕):
```bash
node server.js &
sleep 1
curl -s -X POST http://localhost:4646/__generate --data '' -w '\n%{http_code}\n'
```
Expected: `{"ok":false,"message":"內容過大或空白（上限 200KB）"}` 加上 `413`。

- [ ] **Step 5: 手動驗證成功路徑（需要本機已裝並登入 claude CLI）**

Run:
```bash
curl -s -X POST http://localhost:4646/__generate --data '公司 Q3 業績複盤：營收成長 20%，主因是新客戶開發；下一季重點是提升續約率。' -w '\n%{http_code}\n'
```
Expected: `200`，回應 JSON 的 `markdown` 欄位是一段含 `---` 分頁的 SimPPT deck 文字（不是空字串、不是包在 code fence 裡）。若本機沒裝/沒登入 `claude`，預期看到 `500` + `"找不到 claude 指令..."`，這也算驗證通過（代表錯誤處理正確）。

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat: add POST /__generate endpoint that shells out to claude -p"
```

---

### Task 3: 前端「AI 生成」按鈕 + 彈窗 + 串接

**Files:**
- Modify: `C:\dev\SimPPT\index.html:323`（CSS，加彈窗樣式）
- Modify: `C:\dev\SimPPT\index.html:340`（首頁按鈕）
- Modify: `C:\dev\SimPPT\index.html:346`（彈窗 HTML，插在 `</main>` 之後）
- Modify: `C:\dev\SimPPT\index.html:752`（JS element refs）
- Modify: `C:\dev\SimPPT\index.html:1959`（JS 事件綁定，插在 `new-deck` handler 之後）

**Interfaces:**
- Consumes: `POST /__generate` contract from Task 2；既有的 `apiHeaders()`、`showToast()`、`stopPolling()`、`enterEditor(text: string)`、`state` object（都已在 index.html 中定義，本任務不新增這些函式，只呼叫）。

- [ ] **Step 1: 加彈窗 CSS**

Modify `C:\dev\SimPPT\index.html`:

Old:
```html
  #toast {
    position: fixed; top: 4vh; left: 50%; transform: translateX(-50%);
    background: #c0392b; color: #fff;
    padding: 10px 22px; border-radius: 8px; font-size: 15px; z-index: 30;
  }
  [hidden] { display: none !important; }
```

New:
```html
  #toast {
    position: fixed; top: 4vh; left: 50%; transform: translateX(-50%);
    background: #c0392b; color: #fff;
    padding: 10px 22px; border-radius: 8px; font-size: 15px; z-index: 30;
  }
  #gen-modal {
    position: fixed; inset: 0; z-index: 20;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0, 0, 0, 0.6);
  }
  #gen-card {
    width: min(640px, 90vw); max-height: 80vh;
    display: flex; flex-direction: column; gap: 12px;
    background: #16161c; border: 1px solid #2a2a35; border-radius: 12px;
    padding: 20px 22px;
  }
  #gen-card h2 { margin: 0; font-size: 18px; }
  #gen-text {
    flex: 1; min-height: 240px; resize: vertical;
    background: #0e0e12; color: #f5f5f5; border: 1px solid #2a2a35; border-radius: 8px;
    padding: 12px; font: inherit; font-size: 14px; line-height: 1.6;
  }
  #gen-error { color: #e97070; font-size: 13.5px; min-height: 1.4em; }
  #gen-actions { display: flex; justify-content: flex-end; gap: 10px; }
  #gen-actions button {
    font: inherit; font-size: 14.5px; color: #f5f5f5;
    background: #23232e; border: 1px solid #3a3a4a; border-radius: 8px;
    padding: 10px 18px; cursor: pointer;
  }
  #gen-actions button:hover { background: #2e2e3c; }
  #gen-actions button:disabled { opacity: 0.55; cursor: default; }
  #gen-submit { background: #6c9ef8; color: #0b0b0f; border-color: #6c9ef8; }
  [hidden] { display: none !important; }
```

- [ ] **Step 2: 加首頁按鈕**

Modify `C:\dev\SimPPT\index.html`:

Old:
```html
    <button id="open-history" title="編輯內容每分鐘自動備份，最多 20 份；點一次載入最新，再點往回翻">歷史備份</button>
  </div>
```

New:
```html
    <button id="open-history" title="編輯內容每分鐘自動備份，最多 20 份；點一次載入最新，再點往回翻">歷史備份</button>
    <button id="ai-generate" title="貼上內容，用本機 claude CLI 生成一份簡報">AI 生成</button>
  </div>
```

- [ ] **Step 3: 加彈窗 HTML**

Modify `C:\dev\SimPPT\index.html`:

Old:
```html
</main>

<section id="stage" hidden>
```

New:
```html
</main>

<div id="gen-modal" hidden>
  <div id="gen-card">
    <h2>AI 生成簡報</h2>
    <textarea id="gen-text" placeholder="貼上你想做成簡報的內容…"></textarea>
    <div id="gen-error"></div>
    <div id="gen-actions">
      <button id="gen-cancel">取消</button>
      <button id="gen-submit">生成</button>
    </div>
  </div>
</div>

<section id="stage" hidden>
```

- [ ] **Step 4: 加 JS element refs**

Modify `C:\dev\SimPPT\index.html`:

Old:
```js
  const edPlayBtn = document.getElementById('ed-play')
  const edSaveBtn = document.getElementById('ed-save')
```

New:
```js
  const edPlayBtn = document.getElementById('ed-play')
  const edSaveBtn = document.getElementById('ed-save')
  const aiGenerateBtn = document.getElementById('ai-generate')
  const genModal = document.getElementById('gen-modal')
  const genText = document.getElementById('gen-text')
  const genError = document.getElementById('gen-error')
  const genCancelBtn = document.getElementById('gen-cancel')
  const genSubmitBtn = document.getElementById('gen-submit')
```

- [ ] **Step 5: 加事件綁定（開彈窗、取消、送出）**

Modify `C:\dev\SimPPT\index.html`:

Old:
```js
  newDeckBtn.addEventListener('click', () => {
    stopPolling()
    state.mdPath = ''
    state.fileMap = new Map()
    state.sourceText = ''
    enterEditor(NEW_DECK_TEMPLATE)
  })

  let historyCursor = -1
```

New:
```js
  newDeckBtn.addEventListener('click', () => {
    stopPolling()
    state.mdPath = ''
    state.fileMap = new Map()
    state.sourceText = ''
    enterEditor(NEW_DECK_TEMPLATE)
  })

  aiGenerateBtn.addEventListener('click', () => {
    genError.textContent = ''
    genModal.hidden = false
    genText.focus()
  })

  genCancelBtn.addEventListener('click', () => {
    genModal.hidden = true
  })

  genSubmitBtn.addEventListener('click', async () => {
    const content = genText.value.trim()
    if (!content) {
      genError.textContent = '請先貼一些內容'
      return
    }
    genSubmitBtn.disabled = true
    genCancelBtn.disabled = true
    genSubmitBtn.textContent = 'AI 生成中…'
    genError.textContent = ''
    try {
      const res = await fetch('/__generate', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...apiHeaders() },
        body: content,
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        genError.textContent = data.message || `生成失敗（${res.status}）`
        return
      }
      genModal.hidden = true
      stopPolling()
      state.mdPath = ''
      state.fileMap = new Map()
      state.sourceText = ''
      enterEditor(data.markdown)
    } catch (err) {
      genError.textContent = `連線失敗：${err.message}`
    } finally {
      genSubmitBtn.disabled = false
      genCancelBtn.disabled = false
      genSubmitBtn.textContent = '生成'
    }
  })

  let historyCursor = -1
```

- [ ] **Step 6: 手動驗證整個流程**

Run: `node server.js`（若已在跑就直接用），瀏覽器開 `http://localhost:4646`。

檢查清單：
1. 首頁看得到「AI 生成」按鈕，點下去彈窗打開、textarea 可輸入。
2. 空白直接按「生成」→ 顯示「請先貼一些內容」，不送出請求。
3. 貼一段文字按「生成」→ 按鈕變「AI 生成中…」且 disabled → 幾秒後（若本機已裝 `claude` CLI）彈窗關閉、直接進編輯器、左邊 textarea 已經是生成的 markdown、右邊預覽正常渲染分頁。
4. 按 `Ctrl+S` → 走「新簡報」同樣的另存/下載流程（因為沒有 fileHandle）。
5. 故意在情境 3 前把網路關掉或改一個錯的 URL 觸發錯誤 → 彈窗內出現錯誤訊息、textarea 內容還在、可以直接重新按生成。

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: add AI-generate button and modal wired to /__generate"
```

---

## Self-Review Notes

- **Spec coverage**：決策脈絡（本機限定、沿用 authorized）✅ Task 2 Step 2；一鍵生成無風格選項 ✅ Task 3（只有一個 textarea）；後端 prompt/spawn/逾時/錯誤分支 ✅ Task 2；資料流 ✅ Task 2+3 串接；測試範圍（純函式測、I/O 手動測）✅ Task 1 + Task 2 Step 4-5 + Task 3 Step 6；YAGNI 清單內容本計畫都沒實作，符合預期。
- **Placeholder scan**：無 TBD／"add error handling" 之類空話，每個 step 都是完整可執行的程式碼或指令。
- **Type/命名一致性**：`buildGeneratePrompt` 在 Task 1 定義、Task 2 原樣 import 使用；`/__generate` 端點回應欄位 `ok`/`markdown`/`message` 在 Task 2 產生、Task 3 原樣讀取，沒有改名不一致的狀況。
