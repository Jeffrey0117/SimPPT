// A 風格 (style) is a plain text file a person can read and change. The AI writes one once, from
// decks someone likes; after that a deck is made by following it: the AI only writes what each
// page says and which kind of page it is, and lib/style-apply.mjs does the rest by the rules.
//
//   # 名字
//   主題: bg=#111111 color=#f5f5f5 accent=#ffcc33
//   每頁最多: 30
//   梗圖間隔: 3
//
//   ## 頁型
//   - 開場: 置中 | 梗=困惑 | 一個問句勾住人
//   - 重點: 大字 | 一個數字或一個詞，下面一行說明
//
//   ## 語氣          (any other ## section is free text handed to the AI)
//   口語、短句

// How each layout is named in a style, and what the AI has to write for it.
export const LAYOUTS = {
  center: { names: ['置中', 'center', '預設'], value: null, shape: '標題加一兩句，置中' },
  top: { names: ['標題在上', 'top'], value: 'top', shape: '# 標題在上，下面是內文' },
  bullets: { names: ['列點', 'bullets', '清單'], value: 'bullets', shape: '一個 # 標題加一個清單（- 開頭），每點一行' },
  cols: { names: ['兩欄', 'cols', '分欄'], value: 'cols', shape: '一個 # 標題，下面每個 ## 小標各成一欄（最多三欄）' },
  split: { names: ['左圖右文', 'split'], value: 'split', shape: '左邊一張圖、右邊文字（只有對方給了圖才放圖）' },
  big: { names: ['大字', 'big'], value: 'big', shape: '# 只放一個數字或一個詞，下面一行說它代表什麼' },
}

const layoutKey = (word) => Object.keys(LAYOUTS).find((key) => LAYOUTS[key].names.includes(word.trim().toLowerCase()))

const NO_MEME = ['不配', '無', '沒有', 'none', '']
const MEME_RE = /^梗\s*[=＝:：]\s*(.*)$/
const KIND_RE = /^[-*]\s*([^:：|]+?)\s*[:：]\s*(.*)$/
const SETTING_RE = /^([^:：#\-*]+?)\s*[:：]\s*(.+)$/
const THEME_KEYS = ['bg', 'color', 'accent', 'font', 'width']

const number = (text) => {
  const found = String(text).match(/\d+/)
  return found ? Number(found[0]) : null
}

// "bg=#111 color=#eee accent=#fc3" → { bg: '#111', … }; only the keys a deck's frontmatter takes.
const parseTheme = (text) => Object.fromEntries(
  [...String(text).matchAll(/([a-z]+)\s*=\s*(\S+)/gi)]
    .map(([, key, value]) => [key.toLowerCase(), value])
    .filter(([key]) => THEME_KEYS.includes(key)),
)

const parseKind = (line) => {
  const found = line.match(KIND_RE)
  if (!found) return null
  const kind = { name: found[1].trim(), layout: 'center', meme: null, how: '' }
  const how = []
  for (const part of found[2].split(/[|｜]/).map((p) => p.trim()).filter(Boolean)) {
    const meme = part.match(MEME_RE)
    const layout = layoutKey(part)
    if (meme) kind.meme = NO_MEME.includes(meme[1].trim().toLowerCase()) ? null : meme[1].trim()
    else if (layout) kind.layout = layout
    else how.push(part)
  }
  return { ...kind, how: how.join('；') }
}

const SETTINGS = {
  主題: (style, value) => ({ ...style, theme: parseTheme(value) }),
  每頁最多: (style, value) => ({ ...style, maxChars: number(value) }),
  梗圖間隔: (style, value) => ({ ...style, memeGap: Math.max(1, number(value) || 1) }),
}

/** The style a text describes. Lines it does not understand are kept out, never an error. */
export const parseStyle = (text) => {
  let style = { name: '', theme: {}, maxChars: null, memeGap: 3, kinds: [], notes: [] }
  let section = ''
  let note = null
  const closeNote = () => {
    if (note && note.text.trim()) style = { ...style, notes: [...style.notes, { title: note.title, text: note.text.trim() }] }
    note = null
  }
  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    if (/^#\s/.test(line) && !style.name) { style = { ...style, name: line.slice(2).trim() }; continue }
    if (/^##\s/.test(line)) {
      closeNote()
      section = line.slice(3).trim()
      if (section !== '頁型') note = { title: section, text: '' }
      continue
    }
    if (note) { note = { ...note, text: `${note.text}${raw}\n` }; continue }
    if (section === '頁型') {
      const kind = parseKind(line)
      if (kind) style = { ...style, kinds: [...style.kinds.filter((k) => k.name !== kind.name), kind] }
      continue
    }
    const setting = line.match(SETTING_RE)
    const apply = setting && SETTINGS[setting[1].trim()]
    if (apply) style = apply(style, setting[2])
  }
  closeNote()
  return style
}

/** Kinds the AI may use, as it is told about them. */
const kindLines = (style) => style.kinds.map((kind) => {
  const parts = [LAYOUTS[kind.layout].shape, kind.how].filter(Boolean).join('；')
  return `- ${kind.name}${kind.meme ? '（配梗）' : ''}：${parts}`
}).join('\n')

export const buildStylePrompt = (userContent, style) => {
  const limit = style.maxChars ? `- 每頁最多 ${style.maxChars} 個字（中文一個字算一個，英文一個字算一個），寧可多切幾頁。\n` : ''
  const notes = style.notes.map((n) => `${n.title}：\n${n.text}`).join('\n\n')
  return `你是簡報寫手。把下面「使用者原始內容」寫成一份簡報，照「${style.name || '這份'}」這個風格。
規則：
- 每一頁都用獨立一行「--- kind=頁型」開頭，第一頁也是。頁型只能從下面的表挑，照它的寫法寫。
- 不要寫 frontmatter、顏色、layout=、set=，這些程式會照風格自動套上。
${limit}- 標了（配梗）的頁型，在那頁最後多寫一行「梗: 一句話」（12 個字以內），這句話會配在梗圖旁邊；要不要真的放梗圖由程式決定。
- 用 **粗體** 標重點。可以用 #/## 標題、- 清單、1. 編號清單。
- 不要捏造圖片網址。
- 直接輸出簡報 markdown 本身，不要包在 \`\`\` 裡，不要任何說明、前言、後語。

頁型：
${kindLines(style)}

${notes}

---
使用者原始內容：
---

${userContent}`
}

export const DEFAULT_STYLE = `# 梗圖版
（DukPPT 附的範例。每一行都能改，存檔就生效；改壞了刪掉這個檔，下次會再生一份。）

主題: bg=#111111 color=#f5f5f5 accent=#ffcc33
每頁最多: 30
梗圖間隔: 3

## 頁型
- 開場: 置中 | 梗=困惑 | 一個問句勾住人，不超過 15 個字
- 重點: 大字 | 一個數字或一個詞，下面一行說它代表什麼
- 列點: 列點 | 標題加 3 到 5 點，每點一句
- 比較: 兩欄 | 兩邊對照，各一個小標
- 反轉: 置中 | 梗=恍然大悟 | 推翻前面的直覺，一句話
- 痛點: 置中 | 梗=崩潰 | 講大家都踩過的坑
- 總結: 標題在上 | 三句話收尾，最後一句叫人去做一件事

## 語氣
口語、短句，像在跟朋友講。能一句講完就不要兩句。

## 節奏
第一頁一定是開場。每三四頁來一個反轉或痛點。最後一頁是總結。
`

/** Asks the AI to work out a style from decks someone likes, written in the format above. */
export const buildLearnPrompt = ({ name, decks, memeKinds = [] }) => {
  const kinds = memeKinds.length ? memeKinds.join('、') : '（目前沒有梗圖分類，梗= 都不要寫）'
  const shown = decks.map((text, i) => `=== 範本 ${i + 1} ===\n${text}`).join('\n\n')
  return `你是簡報風格分析師。看下面的範本簡報（SimPPT markdown：--- 分頁，--- 後面的 key=value 是該頁設定，檔首 --- 之間是整份的設定），歸納出它的「風格規格」，之後別的內容會照這份規格寫成簡報。

照這個格式輸出，不要多也不要少，不要包在 \`\`\` 裡，不要任何說明：

# ${name}
主題: bg=<範本最常用的背景色> color=<文字色> accent=<強調色>
每頁最多: <範本一頁大概最多幾個字，取整數>
梗圖間隔: <最少隔幾頁才放一張梗圖，通常 3 到 5>

## 頁型
- <頁型名稱，兩到四個字>: <版型> | 梗=<分類或 不配> | <這種頁怎麼寫，一句話>
（4 到 8 種，照範本裡真的出現的頁的作用來分，例如開場、重點、比較、轉折、總結）

## 語氣
<兩到四行：用詞、句子長短、人稱、有沒有幹話或口頭禪，要具體到別人照著寫得出來>

## 節奏
<兩到四行：開頭怎麼開、多久來一次轉折或笑點、怎麼收尾>

版型只能用這幾個：置中、標題在上、列點、兩欄、左圖右文、大字。
梗= 只能用這些分類：${kinds}。範本的語氣不搞笑就全部寫 不配。
範本沒寫顏色就整行「主題:」省略。

${shown}`
}
