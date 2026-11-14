# 逐頁 API、SDK、MCP，與編輯器裡的「AI 插入」

2026-11-14 定案（Jeff 在對話中核准）。

## 為什麼

Jeff 想對 AI 說一句「做 XXX 主題，n 張以內」，生出來的幾頁直接接進他正在做的演講簡報。
現在逐頁操作只有編輯器自己用得到，伺服器只認得整份簡報，AI 要改就得整份重寫。

## 目標

- 簡報有自己的副檔名 `.simppt`（內容仍是原本那套 Markdown）。
- 程式可以對某一頁下手：看大綱、讀、插入、改、刪、搬。
- 同一套操作有三個入口：SDK（node 模組）、HTTP API、MCP。
- 編輯器裡多一個「AI 插入」：一句話，接在目前這頁後面，本機 `claude -p` 生成。
- AI 從外面改了檔案，開著的編輯器會跟上。

## 不做

- 線上站專用的權限或登入（API 沿用既有的 `SIMPPT_TOKEN`，跟 `/__save` 同一個檢查）。
- 圖片生成、建立新簡報的 API、串流預覽。
- 把舊的 `.md` 轉檔。舊檔照樣能開、能存回原檔。

## 不可以發生

- 插入或修改某一頁之後，其他頁的內容或樣子變了。
- 編輯器裡還沒存的修改被外部的新版悄悄蓋掉。
- 外部工具寫進 `decks/` 以外、或不是簡報的檔案。

## 做法（三種裡選了第三種）

1. AI 直接改檔：最省事，但要讀整份、容易弄壞別頁，也沒有 SDK。
2. 只做 HTTP API，MCP 去呼叫 localhost：伺服器沒開就不通。
3. **共用核心，三個入口都接它（採用）**：`lib/deck-api.mjs` 直接讀寫檔案；MCP 不需要伺服器開著；HTTP API 只是薄薄一層，之後上線上站只開這層。

## 設計

### 頁碼

對外一律從 1 開始，空白頁也算一頁（跟編輯器縮圖列一致）。「插在第 0 頁後面」＝放最前面。

### parser（`index.html` 的 `<script id="simppt-parser">`）

新增兩個純函式，走既有的 `readPages` / `writePages` / `keepLooks`：

- `insertSlidesAfter(text, index, snippet)` → `{ text, index, count }`。`index = -1` 是放最前面。
- `replaceSlide(text, index, snippet)` → `{ text, index, count }`。snippet 有多頁時，第一頁取代原頁，其餘接在後面。

snippet 是一小段簡報 Markdown（`---` 分頁，分隔線可帶 `layout=` 等設定）：

- snippet 自己的 frontmatter 丟掉，分隔線上的 `set` 拿掉 —— 新頁不能改到後面的頁。
- 新頁沒寫顏色就沿用插入位置當下生效的配色；寫了就只作用在那一頁。
- 完全空白的頁不插入。
- 取代時：snippet 第一頁沒寫設定就保留原頁的分隔線；有寫就蓋掉同名設定。

### 核心／SDK：`lib/deck-api.mjs`

parser 仍只有 `index.html` 那一份，`lib/parser.mjs` 在 node 裡把它抽出來用（跟測試同一個做法）。

- 純文字：`outline(text)`、`readSlides(text, from, to)`、`insertSlides(text, after, markdown)`、`replaceSlide(text, page, markdown)`、`deleteSlide(text, page)`、`moveSlide(text, from, to)`
- 檔案：`listDecks(root)`、`findDeck(root, 名稱或路徑)`、`readDeck(root, rel)`、`editDeck(root, rel, fn)`（讀 → 改 → 用 `writeDeck` 的 `expect` 寫回，中途被別人改過就失敗而不是蓋掉）
- 頁碼超出範圍、snippet 是空的：丟出帶 `code` 的錯誤（`ENOPAGE`、`EEMPTY`、`ENODECK`、`EAMBIGUOUS`）。

`findDeck`：完整路徑、檔名、不含副檔名的檔名、或唯一符合的片段都可以；符合多份就列出來請對方講清楚。

### HTTP API（`lib/api-routes.mjs`，掛在 `server.js`）

全部檢查 `SIMPPT_TOKEN`。回傳 `{ ok, ... }` 或 `{ ok: false, code, message }`。

| 方法 | 路徑 | 內容 |
|---|---|---|
| GET | `/api/decks` | 簡報清單 |
| GET | `/api/outline?deck=` | 每頁的頁碼、標題、版型 |
| GET | `/api/slides?deck=&from=&to=` | 幾頁的原文 |
| POST | `/api/slides/insert` | `{ deck, after, markdown }` |
| POST | `/api/slides/replace` | `{ deck, page, markdown }` |
| POST | `/api/slides/delete` | `{ deck, page }` |
| POST | `/api/slides/move` | `{ deck, from, to }` |

### MCP：`mcp/server.mjs`

零依賴的 stdio 伺服器，直接用 `lib/deck-api.mjs` 讀寫 `decks/`（`SIMPPT_ROOT` 可換位置）。
工具：`list_decks`、`get_outline`、`read_slides`、`insert_slides`、`replace_slide`、`delete_slide`、`move_slide`。
`insert_slides` 的說明裡寫明語法重點，並要求不要寫顏色（會沿用原簡報）。

### 編輯器：「AI 插入」

- 預覽下方「加文字」「加圖片」旁多一顆「AI 插入」。
- 沿用 `#gen-modal`，多一個模式 `insert`：標題「AI 插入幾頁（接在第 N 頁後面）」。
- `POST /__insert`，`{ markdown, after, instruction }` → `claude -p` → 回傳那幾頁的 Markdown。
- 前端用 `insertSlidesAfter` 接進去、跳到新的第一頁、狀態列放「復原」。伺服器不寫檔（跟「AI 編輯」一致）。
- prompt（`buildInsertPrompt`）：給整份簡報當上下文、指出接在哪一頁後面、只輸出新頁、不寫 frontmatter 與顏色、沒指定張數就 1 到 3 頁。

### 編輯器跟上外部修改

只管伺服器上的簡報（`state.deckUrl`）。編輯器開著時每 2 秒抓一次檔案：

- 檔案跟編輯器認知的一樣 → 不動。
- 不一樣、編輯器沒有未存的修改 → 載入新版，留在同一頁，狀態列「檔案在別處更新了」＋「復原」。
- 不一樣、編輯器有未存的修改 → 不動內容，狀態列「檔案在別處有新版」＋「載入新版」（按了才換，可以復原）。同一個新版只提示一次。
- 存檔中、對話框開著、正在預覽上改字時跳過這一輪。

判斷寫成純函式 `SaveLogic.remoteChange`，有測試。

### 副檔名

- `.simppt` 在所有認得 `.md` 的地方都認得：伺服器（存檔、清單、MIME）、開檔、拖曳、資料夾。
- 新簡報存檔預設 `.simppt`；輸入的名字帶 `.md` 就照它存成 `.md`。
- 舊的 `.md` 不動。

## 測試

- parser：兩個新函式（插入位置、沿用配色、不影響其他頁、`set` 被拿掉、空白頁略過、取代保留或覆蓋設定）。
- `deck-api`：大綱、讀頁、頁碼錯誤、`findDeck`、`editDeck` 寫回。
- `api-routes`：起一個真的 http server 打每個端點，含未授權。
- MCP：對 stdio 送 `initialize`、`tools/list`、`tools/call`。
- `buildInsertPrompt`、`SaveLogic.remoteChange`、`.simppt` 路徑。
- `claude -p` 本身不寫自動測試（沿用之前的決定），手動試一次。

## 審查後補上的（2026-11-14，同一天）

獨立審查找到的問題，都已修並配測試：

- **版本檢查**：讀與寫都回 `version`；寫入帶回它，簡報在讀過之後變了就擋下（`ECHANGED`）。不然 AI 看完大綱、Jeff 刪了一頁，AI 再改「第 5 頁」會改到別頁。
- **`findDeck` 收緊**：有斜線的路徑只認 `decks/` 底下那個檔，不會退而求其次去比對同名檔；README、CLAUDE.md 這類不是簡報。
- **code fence 只在 `/__insert` 剝**：parser 不剝，不然只有一段程式碼的頁讀出再寫回會壞。
- **Windows 短檔名**（原本就有的洞）：`/GIT~1/config` 繞過了「不給讀 . 開頭」的檢查。改成看檔案在硬碟上真正的位置（`insideRoot`），靜態檔與簡報路徑都用它。
- **別的網站打本機 server**：`/api`、`/__` 檢查 Origin 與 Host（`sameSite`），寫入要求 JSON 的 Content-Type。
- **編輯器**：重整後仍記得檔案原本的內容（才看得出外部改過）；「有新版」的提示被打字洗掉會再出現；拖曳中、分頁在背景時不檢查；自己剛存的檔不會被當成外部新版。
- 其他：CRLF 的檔保持 CRLF、`markdown` 不是文字就拒絕、刪頁回 `total`、MCP 只回自己支援的協定版本。

沒做：檔案寫到一半被讀到（下一輪 2 秒後會自己修正）、MCP 的批次請求（新版協定已移除）。

## 我自己決定的（Jeff 沒明講）

- 頁碼從 1 開始、空白頁也算。
- MCP 用零依賴手寫，不引 SDK 套件（專案原則是零依賴）。
- API 會跟著 push 部署到線上站，但受同一個 token 保護，等於跟 `/__save` 同等級；沒有另外做開關。
- 名字帶 `.md` 就存成 `.md`，不強迫改副檔名。
