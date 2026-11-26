# SimPPT

零依賴單檔 Markdown 簡報工具。核心全在 `index.html`（parser 在 `<script id="simppt-parser">`，可被 node 測試抽取）；`server.js` 是選配的本機/線上 server（靜態 + `/__save` 寫檔 + `/__upload` 圖床代理 + `/api/...` 逐頁操作）。簡報檔是 `.simppt`（內容就是 Markdown；舊的 `.md` 照樣認）。

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

## 逐頁 API／SDK／MCP

- parser 只有 `index.html` 那一份；node 這邊用 `lib/parser.mjs` 把它抽出來，不要另外抄一份
- `lib/deck-api.mjs` 是核心（頁碼從 1 算、空白頁也算、錯誤帶 `code`）。`lib/api-routes.mjs`（`/api/...`）和 `mcp/`（stdio，零依賴）都只是包它一層 — 新增操作先加在核心，再接到兩邊，README 的表也要補
- 從外面放進來的頁走 parser 的 `insertSlidesAfter`／`replaceSlide`：snippet 的 frontmatter 丟掉、`set` 拿掉、沒寫顏色就沿用落點的配色，所以不會動到其他頁。AI 插入（`/__insert`）也是走這條
- 寫檔走 `editDeck`（帶 `expect`，檔案中途被別人改過就失敗，不會蓋掉；CRLF 的檔保持 CRLF）。讀與寫都回 `version`，寫入帶回 `version` 就會檢查簡報還是不是當初讀的那一版 — 頁碼只對讀到的那一版有意義
- `findDeck`：有斜線的就是「那個檔」，而且只收 `decks/` 底下的；沒斜線才用名字比對。專案裡其他 `.md`（README、CLAUDE.md）不是簡報，不能從這裡改
- AI 回答外面包的 ``` 只在 `/__insert` 剝（`stripFence`），parser 不剝 — 不然內容就是一段程式碼的頁，讀出來再寫回去會壞掉

## AI 邊寫邊出現

- `lib/run-claude.mjs` 的 `runClaudeStream` 用 `claude -p --output-format stream-json --include-partial-messages`，一段一段把字交出來；`streamAnswer` 把它變成一行一個 JSON（`delta`…最後一行 `done`）。頁面的請求帶 `Accept: application/x-ndjson` 才走這條，否則照舊一次回完
- claude 是用「精簡」的方式開的（`leanArgs`：不載入使用者自己的工具和 MCP、用 sonnet；`SIMPPT_AI_MODEL` 可換）。2026-11-26 量過：6KB 的筆記，第一個字從 9–14 秒變 2–9 秒，總時間少三成。它寫之前要不要先想幾秒是模型自己決定的，`MAX_THINKING_TOKENS=0`、`--effort low`、設定檔都關不掉
- 串流一開始（還沒有字）頁面就進 `beginAiLive`，想的那幾秒顯示「AI 正在想怎麼排」；所以 server 要馬上把表頭送出去（`res.flushHeaders()`）
- 頁面那半在 `beginAiLive`／`drawAiLive`／`endAiLive`：寫的期間 `#ai-live` 蓋住整個畫面、`aiLive` 不是 null（`dialogOpen()` 也算它），編輯器只是拿來顯示。**結束時一律先把編輯器還原成 AI 動手前的樣子**，再照原本的路（`enterEditor`／`commitPageOp`）正式放結果，所以復原、歷史、未存檔狀態都跟以前一樣
- 「AI 生成」貼的是 hackmd2 筆記網址時由 `lib/note-source.mjs` 換成筆記內容。它只會去問設定好的那一台 hackmd2，貼什麼網址都一樣
- DukPPT（桌面版，另一個 repo）直接用這幾個 `lib/*.mjs` 和這份 `index.html`：改了這裡，去 dukppt 跑一次 `npm test` 和 `npm run smoke`

## 首頁按 Delete 刪簡報

- 頁面只在 `/__decks` 回 `canDelete: true` 時才理 Delete 鍵（滑鼠停著或焦點所在的那一列），然後 `POST /__delete {path}`。這個 server 沒有做 `/__delete`、也不回 `canDelete`——只有 DukPPT 有（丟資源回收筒）。要在這裡做，先想好刪掉的檔放哪裡救得回來

## 製作圖卡

- 版型面板多一格「製作圖卡」，只在 `/__decks` 回 `canMakeCards: true` 時出現。按了就在編輯區上蓋一個 iframe（`/__cards/`，是打包好的 FreeForCut＝clipcraft），所以要同一個網域
- 工具輸出的方式是 `<a download>.click()`：`takeCardExports` 把 iframe 裡的那個 click 換掉，檔案走 `uploadImage`（跟貼上圖片同一條路），然後在目前這頁後面加一頁 `![](url){x=0 y=0 w=100}`（整頁滿版）
- 這個 server 沒有 `/__cards/`——只有 DukPPT 帶著（它的 `scripts/vendor.js` 把 clipcraft 打包進去）

## 素材庫

- 只在 `/__decks` 回 `hasAssets: true` 時才有（這個 server 沒有，DukPPT 有）：「加圖片」改成打開 `#asset-panel`，沒有就照舊直接選檔
- server 那邊是 `GET /__assets`（列表）、`GET /__assets/file/<名字>`、`POST /__assets`（圖的位元組，或 `{url}`）、`POST /__assets/delete {name}`
- 用一張圖＝把它抓回來再走 `uploadImage`（變成簡報自己的圖），所以簡報不會指到素材庫裡的檔
- 拖進編輯區的圖由 `editor` 上的 `drop` 接走（`draggedPictures`）；不是圖就不攔，照舊交給 document 那個開簡報的 drop

## 去背

- 只在 `/__decks` 回 `canCutOut: true` 時才有（DukPPT 有）：`cutOut(blob)` 第一次用才 `import('/__cutout/cutout.js')`，先試顯示卡（`device: 'gpu', model: 'isnet'`），丟錯才退回一般算法。別換成 `isnet_fp16` 配 gpu——不會丟錯但整張變透明（2026-11-26 試過）
- 三個入口：選到圖片時 `#tool-cutout`、素材庫的圖按右鍵、按著 Alt 拖圖進來。結果一律是新檔，原圖不動

## 誰可以打 server（別改鬆）

- 檔案路徑一律用 `lib/deck-store.mjs` 的 `insideRoot` 判斷，它看的是檔案在硬碟上真正的位置。只檢查網址或字串裡有沒有「.」開頭是不夠的：Windows 上 `.git` 也叫 `GIT~1`，2026-11-14 之前 `/GIT~1/config` 拿得到 git 設定
- `/api/...` 和 `/__...` 先過 `lib/same-site.mjs` 的 `sameSite`：別的網站的網頁打不進來（Origin 要等於 Host）；沒設 token 時只認本機名稱（擋把網域指到 127.0.0.1 的手法）
- 寫入要 `Content-Type: application/json` — 別的網站沒辦法不經瀏覽器詢問就送這種請求
- 這三件事在 `test/server.test.mjs`、`test/deck-api.test.mjs` 有測試，而且確認過把修補拿掉測試會紅
- 簡報檔的副檔名在三個地方：`lib/deck-store.mjs` 的 `DECK_RE`、`index.html` 的 `MD_RE`、`SaveLogic.deckPathFor`。新檔預設 `.simppt`，名字打 `.md` 就照存 `.md`

## 檔案在別處被改了

- `checkServerDeck` 每 2 秒抓一次開著的那份（只管 `state.deckUrl`），要怎麼做由 `SaveLogic.remoteChange` 決定（純函式，有測試）：沒有未存的修改就 `loadRemoteVersion`，有就只提示
- 有未存的修改時絕不自動換內容。存檔中、對話框開著、正在預覽上改字時跳過那一輪；抓回來時發現這段期間存過檔，那份回應就丟掉（不然會把自己剛存的當成外部新版）

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
- 刪頁不跳確認視窗，做完在狀態列放「復原」（就是上一動）

## 預覽上改字

- 雙擊預覽的文字區塊會開 `#block-editor`（蓋在區塊上的 textarea，內容是 markdown 原文）。讀寫走 parser 的 `blockText`／`rewriteBlock`（純函式，有測試）：標記、編號、行尾 `{x= y=…}` 都保留，字清空就刪掉區塊
- 改字期間 `blockEdit` 不是 null，全域快捷鍵都不作用
- 圖片沒有字可改，雙擊維持「還原這一塊」
- 預覽下方的「加文字」「加圖片」走 `addBlockToPage` → parser 的 `appendBlock`（純函式，有測試）：在這頁最後面加一行，回傳它是第幾塊；加文字接著直接開 `#block-editor`

## 影片

- 沒有新語法：圖片那一行 `![](網址)` 的網址是 YouTube 或影片檔，`renderMarkdown` 就改放影片（`youtubeId`、`VIDEO_FILE_RE`、`mediaHtml`，有測試）。區塊型別仍是 `img`，所以拖曳、縮放、`{x= y= w=}` 全部沿用
- YouTube 在 parser 只輸出封面圖加 `figure[data-yt]`；只有 `renderSlide`（播放）會把封面換成 iframe — 縮圖列和編輯器不載播放器
- 影片檔的 `<video>` 在 `#stage` 以外 `pointer-events: none`，不然編輯器裡拖不動
- 編輯器裡找 figure 內的東西用 `MEDIA_SELECTOR`，不要寫死 `img`

## 上一動／下一動

- 邏輯是 `<script id="history-logic">` 的 `EditHistory`（純函式，有測試）：連續打字併成一步，其餘每次改動各一步，上限 200 步
- 歷史掛在 `scheduleSave()` 上記（`noteHistory`）— 所有改內容的路徑最後都會呼叫它，所以新功能只要照常呼叫 `scheduleSave()` 就自動能復原，不要另外記
- `enterEditor` 換了一份內容會清掉歷史；同一份簡報的下一版（AI 編輯）傳 `{ keepHistory: true }`
- 游標在搜尋框等其他輸入框時，Ctrl+Z 留給那個輸入框
- 搜尋列選到符合的字時焦點要留在搜尋列（`selectFindMatch`），否則接下來打的字會直接蓋掉簡報內容

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
