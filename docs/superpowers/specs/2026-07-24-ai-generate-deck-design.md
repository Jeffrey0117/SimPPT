# AI 生成簡報（貼內容 → claude -p → 進編輯器）

2026-07-24 定案。本機用工具，把「貼一段內容」直接變成一份可播放的 SimPPT 簡報，省去手動拆頁排版。

## 決策脈絡

- 只給本機開發環境用：正式站 simppt.isnowfriend.com 沒有登入的 `claude` CLI，天然打不通，因此不另外加開關/環境旗標。程式碼照樣進 repo（部署上去也無妨，反正跑不動）。
- 沿用既有 `authorized()` token 機制（跟 `/__save`、`/__upload` 一致），不重造一套權限。
- 一鍵生成，不做風格選項（深淺色、accent、layout 傾向）——全部交給 AI 自己決定。日後真的需要再加。

## 架構

### 前端（index.html）

- 首頁 `.buttons` 內，「新簡報」「看範例」旁新增一顆「AI 生成」按鈕。
- 點擊開啟一個輕量彈窗（沿用現有 `#toast`/modal 樣式慣例）：大 `textarea` + 「生成」鈕 + 取消。
- 按「生成」：
  1. 按鈕進 loading 狀態（disabled + 文字改「AI 生成中…」），不可重複送出。
  2. `POST /__generate`，body 為使用者貼的原始文字（純文字，非 JSON 包裝即可，比照 `/__upload` 用 raw body）。
  3. 成功：關閉彈窗，比照 `new-deck` 按鈕的重設邏輯——`state.mdPath = ''`、`state.fileMap = new Map()`、`state.sourceText = ''`，再 `enterEditor(生成的markdown)`。之後行為與「新簡報」完全一致（未存檔、`Ctrl+S` 走另存/下載）。
  4. 失敗：彈窗內顯示錯誤訊息（來自 server 回傳的 `message`），textarea 內容保留，可直接重試，不用重貼。

### 後端（server.js 新增 `/__generate`）

- 沿用 `authorized(req)` 檢查（同 `/__save`、`/__upload`），未授權回 401。
- 讀取 raw body（純文字），超過 200KB 直接 413 拒絕（比照 `/__upload` 對過大檔案的處理精神）。
- 組 prompt：固定的 `INSTRUCTION_PROMPT`（寫死在 server.js 常數）+ 使用者貼的內容。`INSTRUCTION_PROMPT` 內容涵蓋：
  - SimPPT deck markdown 語法規則（frontmatter `bg`/`color`；`---` 獨立一行分頁；`--- key=value` 覆蓋單頁設定；`--- layout=top` / `--- layout=split`；`accent=` 粗體強調色）。
  - 任務指示：把使用者貼的原始內容拆成合理的分頁、選一組協調的配色（bg/color/accent）、需要時用 `layout=split`（有圖片描述時）或 `layout=top`。
  - 輸出限制：**只回傳簡報 markdown 本身**，不要任何說明文字、不要 code fence 包起來。
- 執行：`spawn('claude', ['-p', INSTRUCTION_PROMPT])`（不經過 shell，避免注入）；使用者貼的內容整包寫進 child 的 `stdin`，寫完 `end()`。收集 `stdout` 當作生成結果、收集 `stderr` 供錯誤訊息用。
- 逾時保護：120 秒未結束就 `child.kill()`，回傳逾時錯誤。
- 錯誤分支各自回對應訊息：
  - `spawn` 失敗（`ENOENT`，找不到 `claude` 指令）→「找不到 claude 指令，請確認本機已安裝並登入 Claude Code CLI」。
  - 非 0 結束碼 → 回傳 stderr 前幾行（截斷避免過長）。
  - 逾時 → 「生成逾時（120 秒），請稍後再試」。
  - `stdout` 為空 → 「AI 沒有回傳內容」。
- 成功回傳 `{"ok":true,"markdown":"..."}`；失敗回傳 `{"ok":false,"message":"..."}`（HTTP 4xx/5xx 依情況）。

## 資料流

```
textarea 內容
  → POST /__generate（raw text body）
  → server: authorized() 檢查 → 組 prompt → spawn claude -p，內容經 stdin 餵入
  → 收集 stdout / stderr / exit code / timeout
  → 回傳 { ok, markdown } 或 { ok:false, message }
  → 前端成功則 enterEditor(markdown)，失敗則彈窗顯示 message
```

## 測試範圍

- 沿用專案「parser 是純函式才測」的慣例：把組 prompt 的邏輯抽成純函式（例如 `buildGeneratePrompt(userContent)`），可用 `test/` 底下的 node:assert 單元測試涵蓋（給定輸入內容，驗證輸出字串包含語法規則段落與使用者內容）。
- 實際呼叫 `claude` CLI 的 I/O 不寫自動測試（需要真的裝 CLI、花 API 額度、且輸出不確定性高），改用手動驗證：貼一段內容 → 按生成 → 確認 deck 能正常載入播放。

## 不做（YAGNI）

風格/主題選項、正式站啟用、生成中即時串流預覽、重試次數限制、多語系 prompt、輸出格式驗證（例如強制檢查生成內容是否為合法 SimPPT 語法）——要了再加。
