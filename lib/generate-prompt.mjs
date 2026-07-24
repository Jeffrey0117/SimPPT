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

const REVISE_INSTRUCTIONS = `你是簡報設計助手。使用者已經有一份 SimPPT 簡報（下面「目前的簡報全文」），現在要你依照「修改指令」調整內容，並且：
- 只改指令要求的部分；沒被要求更動的頁面、順序、座標屬性（例如 {x= y= w= s= c= b=}）盡量保持原樣，不要整份重新排版。
- 保持既有的配色（bg / color / accent）除非指令明確要求換色。
- 直接輸出調整後的完整簡報 markdown 本身，不要包在 \`\`\` code fence 裡，也不要加任何說明文字、前言或後語。`

export const buildRevisePrompt = (existingMarkdown, instruction) =>
  `${REVISE_INSTRUCTIONS}\n\n${SYNTAX_SPEC}\n\n---\n目前的簡報全文：\n---\n\n${existingMarkdown}\n\n---\n修改指令：\n---\n\n${instruction}`
