# 編輯器搜尋並取代

2026-07-24 定案。編輯器目前只有純 textarea，沒有手動找字/換字工具，只能整份丟給 AI 編輯或自己找。加一個輕量的搜尋並取代。

## 決策脈絡

- 不做取代目前這一個（單點取代）：只需要「上一個/下一個找到」+「全部取代」就夠用，YAGNI。
- 不分大小寫的純字串比對，不做 regex、不做全字匹配。
- UI 用浮動小橫列（類似 VSCode/瀏覽器內建 Ctrl+F），不用彈窗，不擋內容，可以邊看邊改。

## 架構

### 可測試的純邏輯

比照專案既有 `<script id="simppt-parser">` 的做法（parser 抽出來給 node 測），新增 `<script id="find-replace-logic">` 區塊，放兩個純函式：

- `findAllMatches(text, query)`：回傳 `query` 在 `text` 中所有出現位置的起始 index 陣列（不分大小寫）；`query` 為空字串回傳 `[]`。
- `replaceAllCaseInsensitive(text, query, replacement)`：把 `text` 裡所有大小寫不敏感的 `query` 換成 `replacement`，回傳新字串；`query` 為空字串時原樣回傳 `text`（no-op）。

`test/find-replace.test.mjs` 用跟 `test/parser.test.mjs` 一樣的手法：讀 index.html、用正規表示式抓出 `<script id="find-replace-logic">...</script>` 內容、`new Function` 執行取得函式、跑 node:assert 測試。

### UI（index.html）

- `#editor-bar` 新增「🔍 取代」按鈕（`ed-find` id），也綁 `Ctrl+H`（`preventDefault`，在編輯器內才生效）。
- 新增 `#find-bar`：`position: absolute` 浮在 `#editor-body` 左上角（`z-index` 高於 textarea，跟 `#txt-tools` 一樣的浮動 mini-tools 手法），預設 `hidden`。內容：
  - 搜尋 input（`#find-query`）
  - 取代 input（`#find-replacement`）
  - 「上一個」`#find-prev` / 「下一個」`#find-next` 按鈕
  - 「全部取代」`#find-replace-all` 按鈕
  - 命中數顯示 `#find-count`（例如 `3/12`，沒有命中顯示 `0/0`）
  - 關閉按鈕 `#find-close`

### 行為

- 開啟：點「🔍 取代」按鈕或 `Ctrl+H`（僅編輯器可見時）→ `find-bar.hidden = false`，focus 搜尋框，若搜尋框已有字直接重新計算一次命中。
- 關閉：點 `#find-close` 或 `Esc`（焦點在 find-bar 內時）→ 隱藏，focus 還給 `edText`。
- 搜尋框輸入時（`input` 事件）：用 `findAllMatches(edText.value, query)` 重新計算命中陣列，目前索引重設為 `0`（若有命中），更新 `#find-count` 顯示，並把目前命中的那段文字在 `edText` 裡 `setSelectionRange` 選起來、`edText.focus()`、視需要捲動（textarea 原生選取即為高亮效果）。
- 「下一個」：目前索引 `+1`（超過長度就繞回 `0`），選取對應命中、更新計數顯示。
- 「上一個」：目前索引 `-1`（小於 `0` 就繞到最後一個），同上。
- 搜尋框按 `Enter`＝下一個；`Shift+Enter`＝上一個。
- 「全部取代」：`edText.value = replaceAllCaseInsensitive(edText.value, query, replacement)`，然後 `edText.dispatchEvent(new Event('input'))` 讓既有的 input 監聽（更新預覽、標記 `edDirty`、觸發自動存快照等）照原邏輯跑，不重複實作那些流程。取代完重新計算一次命中數（通常變 `0/0`）。
- 搜尋框空字串：命中數顯示 `0/0`，上一個/下一個/全部取代按鈕視覺上 disable（沒東西可做）。

## 測試範圍

- `findAllMatches`、`replaceAllCaseInsensitive` 兩個純函式進 `test/find-replace.test.mjs`（node:assert，比照 `parser.test.mjs`/`generate-prompt.test.mjs` 風格）。
- UI 綁定（開關 bar、選取命中、鍵盤快捷鍵）不寫自動測試，改用主要 script 區塊的 `new Function` 語法檢查 + 手動瀏覽器驗證（比照前兩個 AI 功能的做法）。

## 不做（YAGNI）

Regex 搜尋、全字匹配、區大小寫切換、取代目前這一個（單點取代）、多重高亮全部命中（只選取目前這一個）、跨頁面/檔案搜尋——要了再加。
