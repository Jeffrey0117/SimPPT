// Puts a style (lib/style-spec.mjs) on what the AI wrote. Everything here is a rule, nothing is
// guessed: the AI said which kind each page is; the style says what that kind looks like.
//
//   - the deck's colours are the style's
//   - each page gets the layout of its kind
//   - a page with more words than the style allows is cut into pages (title repeated)
//   - a kind that comes with a meme gets one from that 梗圖 category, at most one every N pages
import { LAYOUTS } from './style-spec.mjs'

const SEPARATOR_RE = /^---(?:[ \t]+(.*))?$/
const MEME_LINE_RE = /^梗\s*[:：]\s*(.*)$/
const STYLE_OWNS = ['layout', 'bg', 'color', 'accent', 'set']
const SPLITTABLE = ['center', 'top', 'bullets']

/** frontmatter lines and the rest, from a deck's text. */
const takeFrontmatter = (lines) => {
  if (lines[0] !== '---') return { front: [], rest: lines }
  const end = lines.indexOf('---', 1)
  const inside = end > 0 ? lines.slice(1, end) : []
  if (end < 0 || !inside.every((l) => l.trim() === '' || /^[\w-]+\s*:/.test(l))) return { front: [], rest: lines }
  return { front: inside.filter((l) => l.trim()), rest: lines.slice(end + 1) }
}

const parseAttrs = (text) => (text || '').trim().split(/\s+/).filter(Boolean).map((token) => {
  const at = token.indexOf('=')
  return at < 0 ? [token, null] : [token.slice(0, at), token.slice(at + 1)]
})

const attrsText = (attrs) => attrs.map(([key, value]) => (value === null ? key : `${key}=${value}`)).join(' ')

/** Pages as { attrs: [[key, value]], lines } — a separator inside a ``` block is not one. */
const splitPages = (lines) => {
  const pages = []
  let current = { attrs: [], lines: [] }
  let fenced = false
  for (const line of lines) {
    if (/^```/.test(line.trim())) fenced = !fenced
    const sep = fenced ? null : line.match(SEPARATOR_RE)
    if (sep) {
      if (current.lines.some((l) => l.trim()) || pages.length > 0 || current.attrs.length) pages.push(current)
      current = { attrs: parseAttrs(sep[1]), lines: [] }
    } else {
      current = { ...current, lines: [...current.lines, line] }
    }
  }
  if (current.lines.some((l) => l.trim()) || current.attrs.length) pages.push(current)
  return pages.filter((p) => p.lines.some((l) => l.trim()) || p.attrs.length)
}

/** How many words a reader sees: a Chinese character is one, an English word is one. */
export const wordCount = (text) => {
  const seen = String(text)
    .split('\n')
    .filter((l) => !/^\s*(note|梗)\s*[:：]/.test(l))
    .join('\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\{[^{}]*\}\s*$/gm, '')
  const cjk = (seen.match(/[㐀-鿿豈-﫿]/g) || []).length
  const latin = (seen.match(/[A-Za-z0-9]+/g) || []).length
  return cjk + latin
}

/** Body lines as pieces that can go on different pages: the title, then list items and paragraphs. */
const piecesOf = (lines) => {
  const body = lines.filter((l) => !/^\s*note\s*:/.test(l))
  const titleAt = body.findIndex((l) => /^#\s/.test(l.trim()))
  const title = titleAt >= 0 ? body[titleAt] : null
  const pieces = []
  let piece = []
  const close = () => { if (piece.some((l) => l.trim())) pieces.push(piece); piece = [] }
  body.forEach((line, i) => {
    if (i === titleAt) return
    if (!line.trim()) { close(); return }
    if (/^\s*([-*]|\d+\.)\s/.test(line) && !/^\s{2,}/.test(line)) close()
    piece = [...piece, line]
  })
  close()
  return { title, pieces, notes: lines.filter((l) => /^\s*note\s*:/.test(l)) }
}

/** One page cut into as many as it takes to stay under `max` words each. */
export const cutPage = (lines, max) => {
  if (!max || wordCount(lines.join('\n')) <= max) return [lines]
  const { title, pieces, notes } = piecesOf(lines)
  if (pieces.length < 2) return [lines]
  const head = title ? [title, ''] : []
  const budget = Math.max(1, max - wordCount(title || ''))
  // How many pieces each page takes when filled in order up to the limit.
  const sizes = []
  let page = []
  for (const piece of pieces) {
    if (page.length && wordCount([...page, piece].flat().join('\n')) > budget) { sizes.push(page.length); page = [] }
    page = [...page, piece]
  }
  sizes.push(page.length)
  // A piece left alone on the last page joins the one before (a page with one item looks like a
  // mistake); then the pieces are shared out evenly over that many pages.
  const lonely = sizes.length > 1 && sizes[sizes.length - 1] === 1 && sizes[sizes.length - 2] > 1
  const count = sizes.length - (lonely ? 1 : 0)
  const even = []
  let from = 0
  for (let i = 0; i < count; i += 1) {
    const size = Math.floor(pieces.length / count) + (i < pieces.length % count ? 1 : 0)
    even.push(pieces.slice(from, from + size).flat())
    from += size
  }
  return even.map((body, i) => [...head, ...body, ...(i === 0 ? notes : [])])
}

const shuffleFrom = (random) => (list) => list
  .map((item) => ({ item, at: random() }))
  .sort((a, b) => a.at - b.at)
  .map(({ item }) => item)

/** Picks memes so the same picture is not used twice while others are left. */
const memePicker = (memes, random) => {
  const shuffle = shuffleFrom(random)
  const left = {}
  return (category) => {
    const all = memes[category] || []
    if (!all.length) return null
    if (!left[category] || !left[category].length) left[category] = shuffle(all)
    const [first, ...rest] = left[category]
    left[category] = rest
    return first
  }
}

/** Lines without the empty ones at either end. */
const trim = (lines) => {
  let start = 0
  let end = lines.length
  while (start < end && !lines[start].trim()) start += 1
  while (end > start && !lines[end - 1].trim()) end -= 1
  return lines.slice(start, end)
}

// The picture on the left (layout=split), the page's words on the right, the meme's line last.
const memePage = (url, caption, body) => [`![](${url})`, '', ...trim(body), ...(caption ? ['', `**${caption}**`] : [])]

/**
 * The deck the AI wrote, with the style put on it. `memes` is { category: [url, …] }.
 * `random` is there for tests.
 */
export const applyStyle = (markdown, style, { memes = {}, random = Math.random } = {}) => {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n')
  const { front, rest } = takeFrontmatter(lines)
  const kinds = new Map(style.kinds.map((k) => [k.name, k]))
  const themeKeys = Object.keys(style.theme)
  const frontmatter = themeKeys.length ? themeKeys.map((key) => `${key}: ${style.theme[key]}`) : front
  const pick = memePicker(memes, random)
  const out = []
  let lastMeme = -Infinity

  for (const page of splitPages(rest)) {
    const kindName = (page.attrs.find(([key]) => key === 'kind') || [])[1]
    const kind = kinds.get(kindName)
    const caption = (page.lines.map((l) => l.trim().match(MEME_LINE_RE)).find(Boolean) || [])[1]
    const body = page.lines.filter((l) => !MEME_LINE_RE.test(l.trim()))
    if (!kind) {
      out.push({ attrs: page.attrs, lines: body })
      continue
    }
    const kept = page.attrs.filter(([key]) => !STYLE_OWNS.includes(key))
    const at = out.length
    const meme = kind.meme && at - lastMeme >= style.memeGap ? pick(kind.meme) : null
    if (meme) {
      lastMeme = at
      out.push({ attrs: [...kept, ['layout', 'split']], lines: memePage(meme, (caption || '').trim(), body) })
      continue
    }
    const layout = LAYOUTS[kind.layout].value
    const attrs = layout ? [...kept, ['layout', layout]] : kept
    const cut = SPLITTABLE.includes(kind.layout) ? cutPage(body, style.maxChars) : [body]
    cut.forEach((part) => out.push({ attrs, lines: part }))
  }

  const head = frontmatter.length ? ['---', ...frontmatter, '---'] : []
  const pages = out.map((page, i) => {
    const sep = page.attrs.length ? `--- ${attrsText(page.attrs)}` : (i === 0 ? '' : '---')
    return [...(sep ? [sep] : []), ...trim(page.lines)].join('\n')
  })
  return `${[...head, pages.join('\n\n')].join('\n')}\n`
}
