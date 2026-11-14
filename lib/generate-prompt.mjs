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
- --- layout=bullets：列點頁。一個 # 標題加一個清單（- 或 1.），每點一行、保持簡短。
- --- layout=cols：兩欄。一個 # 標題，下面每個 ## 小標各成一欄（最多三欄）。
- --- layout=big：大字頁。# 放一個數字或一個詞，下面一行說明它代表什麼。
- layout 只作用在寫的那一頁，不會帶到下一頁（即使同一行有 set）。沒寫 layout 就是置中。
- accent：設定後，內文的 **粗體** 文字會自動套用這個顏色來強調重點。
- 內容支援：#/##/### 標題、-/* 無序列表、1. 有序列表、![]() 圖片、**粗體**、*斜體*、反引號 code、[連結]()、一般段落。`

export const buildGeneratePrompt = (userContent) =>
  `${TASK_INSTRUCTIONS}\n\n${SYNTAX_SPEC}\n\n---\n使用者原始內容如下（請根據以上規則轉成 SimPPT markdown）：\n---\n\n${userContent}`

const REVISE_INSTRUCTIONS = `你是簡報設計助手。使用者已經有一份 SimPPT 簡報（下面「目前的簡報全文」），現在要你依照「修改指令」調整內容，並且：
- 只改指令要求的部分；沒被要求更動的頁面、順序、座標屬性（例如 {x= y= w= s= c= b=}）盡量保持原樣，不要整份重新排版。
- 保持既有的配色（bg / color / accent）除非指令明確要求換色。
- 直接輸出調整後的完整簡報 markdown 本身，不要包在 \`\`\` code fence 裡，也不要加任何說明文字、前言或後語。`

// The model sometimes wraps its whole answer in ``` despite being told not to. Only an answer
// that is one fence from first line to last is unwrapped; a slide that contains a code block is not.
export const stripFence = (answer) => {
  const body = String(answer || '').replace(/\r\n?/g, '\n').trim()
  const fenced = body.match(/^```(?:markdown|md)?\n([\s\S]*?)\n?```$/i)
  return fenced && !fenced[1].includes('\n```') ? fenced[1] : body
}

const INSERT_INSTRUCTIONS =`你是簡報設計助手。使用者正在做一份 SimPPT 簡報（下面「目前的簡報全文」），要你依照「這次的要求」寫出幾頁新的投影片，接進這份簡報。並且：
- 只輸出要新增的那幾頁，頁與頁之間用獨立一行的 --- 分隔。不要重複簡報裡已經有的頁。
- 張數照要求裡說的（「n 張以內」就不要超過 n）；要求沒提張數就寫 1 到 3 頁。
- 不要寫 frontmatter，也不要寫任何顏色設定（bg= color= accent=、set）——新頁會自動沿用這份簡報的配色。版型可以用 layout=。
- 語氣、用詞、每頁的字數密度，跟插入位置前後的頁一致；每頁不要塞太多字。
- 不要憑空捏造圖片網址。
- 直接輸出那幾頁的 markdown 本身，不要包在 \`\`\` code fence 裡，也不要加任何說明文字、前言或後語。`

// afterPage：新頁要接在第幾頁後面（從 1 算；0 = 放在最前面）
export const buildInsertPrompt = (existingMarkdown, afterPage, instruction) => {
  const where = afterPage > 0 ? `接在第 ${afterPage} 頁後面` : '放在整份簡報的最前面'
  return `${INSERT_INSTRUCTIONS}\n\n${SYNTAX_SPEC}\n\n---\n目前的簡報全文：\n---\n\n${existingMarkdown}\n\n---\n新頁的位置：${where}。\n這次的要求：\n---\n\n${instruction}`
}

export const buildRevisePrompt =(existingMarkdown, instruction) =>
  `${REVISE_INSTRUCTIONS}\n\n${SYNTAX_SPEC}\n\n---\n目前的簡報全文：\n---\n\n${existingMarkdown}\n\n---\n修改指令：\n---\n\n${instruction}`
