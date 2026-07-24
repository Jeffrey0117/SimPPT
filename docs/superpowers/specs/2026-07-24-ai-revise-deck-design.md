# AI 編輯簡報（編輯器內反覆下指令精修）

2026-07-24 定案。延伸 [[2026-07-24-ai-generate-deck-design.md]]（一鍵生成）——生成/開啟後還能在編輯器裡繼續跟 AI 對話式調整，不用整份重寫指令。

## 決策脈絡

- 沿用「AI 生成簡報」彈窗（`#gen-modal`）的樣式與元件，不重造 UI；用 mode 分流行為（`create` vs `revise`）。
- 只給本機開發環境用，跟 [[2026-07-24-ai-generate-deck-design.md]] 同樣的理由（正式站沒有登入的 `claude` CLI）。
- 不做 undo／diff 預覽機制：既有「歷史備份」（每分鐘自動快照，最多 20 份）已經是安全網，AI 改壞了直接從那邊撈回來。

## 架構

### 前端（index.html）

- `#editor-bar` 新增「AI 編輯」按鈕，跟「▶ 播放」「🎤 講者」「儲存 .md」「還原版面」「首頁」同排。
- 共用 `#gen-modal`／`#gen-text`／`#gen-error`／`#gen-cancel`／`#gen-submit`，新增一個 JS 狀態變數 `genMode`（`'create'` | `'revise'`）：
  - 首頁「AI 生成」按鈕開彈窗時設 `genMode = 'create'`，標題「AI 生成簡報」、placeholder「貼上你想做成簡報的內容…」、送出鈕文字「生成」（跟現在行為一致）。
  - 編輯器「AI 編輯」按鈕開彈窗時設 `genMode = 'revise'`，標題「AI 編輯簡報」、placeholder「跟 AI 說要怎麼調整這份簡報…」、送出鈕文字「送出」。
- 送出邏輯依 `genMode` 分流：
  - `create`：沿用現有行為——`POST /__generate`（raw text body），成功後 `stopPolling()` + 重置 `state.mdPath`/`fileMap`/`sourceText` + `enterEditor(markdown)`。
  - `revise`：`POST /__revise`（JSON body `{ markdown: edText.value, instruction: <textarea 內容> }`），成功後**不重置** `state.mdPath`/`fileMap`/`sourceText`（保留原本的存檔目標），直接 `enterEditor(data.markdown)` 蓋掉編輯器內容。
- 錯誤處理、loading 狀態（按鈕 disabled + 文字變化）沿用現有彈窗邏輯，訊息文案依 mode 略調。

### 後端（server.js 新增 `/__revise`；重構共用 spawn 邏輯）

- 抽出 `lib/run-claude.mjs`：`runClaudePrint(prompt)` 回傳 Promise，內部處理 `spawn('claude', ['-p'], { shell: true })`、把 prompt 寫進 stdin、收集 stdout/stderr、120 秒逾時、ENOENT／非 0 結束碼／空輸出的錯誤訊息，resolve `{ ok: true, markdown }` 或 `{ ok: false, message }`。`/__generate` 跟新的 `/__revise` 都呼叫這個共用函式，避免複製貼上兩份幾乎一樣的 spawn 邏輯。
- `POST /__revise`：
  - 沿用 `authorized()` 檢查（比照 `/__generate`）。
  - Body 是 JSON：`{ markdown: string, instruction: string }`，用 `JSON.parse` 解析（比照 `/__save` 的做法），欄位缺一個或型別不對回 400。
  - 大小上限：`markdown` + `instruction` 合計 300KB（既有 deck 全文通常比單次生成的原始內容大，給寬一點）。
  - 組 prompt：`buildRevisePrompt(markdown, instruction)`（見下）→ 呼叫 `runClaudePrint(prompt)` → 依結果回 200 `{ok:true,markdown}` 或對應錯誤碼 `{ok:false,message}`。
- `lib/generate-prompt.mjs` 新增 `buildRevisePrompt(existingMarkdown, instruction)`，跟既有 `buildGeneratePrompt` 共用 `SYNTAX_SPEC` 常數：
  - 說明：這是使用者「目前已有的 SimPPT 簡報全文」+「這次的修改指令」。
  - 要求：只依指令調整內容；其餘沒被要求更動的頁面、順序、座標屬性（`{x= y= w= s= c= b=}`）盡量保持原樣，不要整份重新排版。
  - 輸出限制：跟 `buildGeneratePrompt` 一樣——只回傳完整簡報 markdown 本身，不要 code fence、不要說明文字。

## 資料流

```
編輯器目前內容 + 使用者這次的指令
  → POST /__revise（JSON body）
  → server: authorized() → 解析 JSON → 大小檢查 → buildRevisePrompt → runClaudePrint(prompt)
  → 回傳 { ok, markdown } 或 { ok:false, message }
  → 前端成功則 enterEditor(markdown)（不重置 mdPath/fileMap），失敗則彈窗顯示 message，可重試
```

## 測試範圍

- `buildRevisePrompt` 是純函式，加進 `test/generate-prompt.test.mjs`（同一份測試檔，驗證包含 syntax 規則、使用者現有 markdown、指令內容都在輸出裡）。
- `runClaudePrint` 的實際 spawn／逾時／錯誤分支不寫自動測試（跟 `/__generate` 當初的決定一致），改用手動驗證：在編輯器連續下兩三次指令，確認每次都正確反映調整、原本沒提到的頁面沒被亂改。

## 不做（YAGNI）

Diff／變更預覽、undo 堆疊、多輪對話上下文記憶（每次都是「目前全文 + 這次指令」單輪，不記得之前對話說過什麼）、指令範本／建議、局部 patch（只回傳變動片段而非全文）——要了再加。
