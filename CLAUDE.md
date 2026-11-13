# SimPPT

零依賴單檔 Markdown 簡報工具。核心全在 `index.html`（parser 在 `<script id="simppt-parser">`，可被 node 測試抽取）；`server.js` 是選配的本機/線上 server（靜態 + `/__save` 寫檔 + `/__upload` 圖床代理）。

## 開發

- `npm start` → http://localhost:4646（`PORT` 可換）
- `npm test` → 單元測試（`test/*.test.mjs`）：parser、搜尋取代、存檔邏輯是從 index.html 抽對應的 `<script id>` 跑 node:assert；`lib/deck-store.mjs` 直接 import
- 改 parser 必跑測試；UI 邏輯改完用 `new Function(script)` 做語法檢查

## 部署（CloudPipe）

- 正式站：https://simppt.isnowfriend.com （cloudpipe 專案 id `simppt`，port 4036，pm2 `simppt`）
- 真實部署目錄：`Desktop\code\workhub\simppt`（cloudpipe git fetch/reset 在那裡）；本目錄（`Desktop\code\simppt`）是開發正本，push 到 GitHub `Jeffrey0117/SimPPT` 即自動部署
- `/__save`、`/__upload` 受 `SIMPPT_TOKEN` 環境變數保護（在 cloudpipe env，用 env API 讀）；瀏覽器端用 `?token=xxx` 開一次即記住（localStorage `simppt-token`）。本機無該環境變數則不設防

## 存檔（別改壞）

- 寫檔都走 `lib/deck-store.mjs` 的 `writeDeck`：先寫暫存檔再改名（不會留下寫一半的檔），寫完讀回比對。`create: true` 只在沒有同名檔時才寫，撞名回 409
- 前端 `saveDeck`：已知來源（`state.deckUrl`／檔案 handle／資料夾 handle）才覆寫；其餘一律走 `saveAsNewDeck`（問檔名、`create: true`），所以沒開過的檔不會被悄悄蓋掉
- 存完會把檔案再抓回來跟編輯器內容比對，一樣才顯示「已存檔」。狀態由 `SaveLogic.fileState` 決定，畫在右上角 `#ed-file`
- `GET /__decks` 列出 `decks/*.md`（跟 `/__save` 同一個 token 檢查）；前端用它判斷這個 server 能不能存（`hasDeckServer`）

## 介面

- 顏色、字體、間距都是 `:root` 的 `--color-*`／`--font-*`／`--space-*`（OKLCH，暖色調深色），新樣式一律用 token，不要寫死色碼。投影片內容的顏色由簡報自己決定，不吃這些 token
- 圖示是 `<body>` 開頭的 SVG sprite（Lucide 線條），用 `<svg class="ic"><use href="#i-名稱"/></svg>`；不用 emoji

## 版型

- 版型＝分隔線上的 `layout=`，樣式是 `.deck-slide.layout-<名稱>`（一律 vw）。加新版型要動四處：`LAYOUTS`、CSS、`LAYOUT_PRESETS`（面板縮圖＋插入新頁的範例內容）、`lib/generate-prompt.mjs` 的語法說明
- `layout` 和 `countdown` 只作用在那一頁（parser 的 `PAGE_ONLY`），寫了 `set` 也不會帶到後面
- 內容開始前的第一條分隔線是第一頁的設定（`leadSepLine`），不是分頁；`parse`、`slideIndexAt`、`slideLineRange` 三處要一致
- 編輯器改分隔線一律走 `SimpptParser.setSlideDirectives`／`insertSlideAfter`（純函式，有測試），不要自己拼字串

## 整頁操作

- 複製／刪除／前後移是 parser 裡的 `duplicateSlide`、`deleteSlide`、`moveSlide`（純函式，有測試）。動完由 `keepLooks` 逐頁檢查：哪一頁的樣子跟原本不同，就在它的分隔線補回來（後面的頁也要一樣就寫成 `set`）。沒被動到的分隔線照原文寫回
- 不變量：操作後每一頁的內容與實際生效的設定都跟原本一樣。改這段之前先跑 `npm test`
- 刪頁不跳確認視窗，做完在狀態列放「復原」（`pageUndo`，只記一步，內容再被改動就失效）

## 快捷鍵

- 編輯器的 Ctrl 系列快捷鍵集中在一個 `keydown`（capture）裡；畫面上的快捷鍵表（Ctrl+/）由 `SHORTCUTS` 陣列產生 — 加新快捷鍵兩邊都要改，README 的表也要補
- 對話框開著時（`dialogOpen()`）頁面操作類的快捷鍵不作用
- 用程式換掉 textarea 內容一律走 `replaceEditorText`：它會把游標留在目前那一頁，否則下一次 keyup 預覽會跳到最後一頁

## 架構要點

- 單檔原則：不引外部依賴；favicon 是 inline SVG data URI
- 座標語法：區塊行尾 `{x= y= w= s= c= b=}`（百分比，相對 16:9 舞台）；行內 `{{文字|s= c= b=}}`；分隔線 `--- key=value`（加 `set` = 之後都生效）
- 預覽/播放/講者台三處共用同一渲染管線（`renderInto` + `.slide-scope` 字級 calc(--ts)），所有尺寸一律 vw 單位（16:9 基準），嚴禁混用 vh 否則預覽與播放不一致
- 會話保存：localStorage `simppt-session`（僅編輯視圖寫入）+ IndexedDB 檔案 handle + `simppt-history` 快照；`?role=stage` 觀眾視窗不寫會話
- 雙視窗同步：BroadcastChannel('simppt')

## AI 協作流程慣例（superpowers skills）

這是單人專案、直接在 `main` 上做，不開 feature branch/worktree。用 brainstorming → writing-plans → executing-plans 走小功能時：

- **執行方式固定 inline**：不用問「subagent-driven 還是 inline」，預設 inline execution，直接跳過那個選項的詢問。
- **spec/plan 照樣寫、照樣要走過流程**（design 段落還是要讓 Jeff 過目確認一次），但流程性的問題（要不要寫 spec、用哪種執行方式）不用問，直接做。
- **完成後預設直接 push 到 `origin/main`**（不用每次都問要不要推）——這個 repo push 上去會觸發 CloudPipe 自動部署，但目前功能都是本機限定（`claude` CLI 相關端點），部署上去也不影響正式站。
- 真正需要 Jeff 判斷的（設計方向、UI 呈現方式、有實質分歧的技術選擇）還是要問，不要因為這條規則就悶著頭亂猜。
