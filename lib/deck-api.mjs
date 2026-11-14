// Page-level operations on a deck. This is the SDK: the HTTP API (lib/api-routes.mjs) and the
// MCP server (mcp/) are thin wrappers around it.
// Pages are numbered from 1 here, and a blank page still counts (same as the editor's thumbnails).
import crypto from 'node:crypto'
import fs from 'node:fs'
import { SimpptParser } from './parser.mjs'
import { DECK_RE, listDecks, resolveDeckPath, writeDeck } from './deck-store.mjs'

export { listDecks }

const DECKS_DIR = 'decks'

const fail = (code, message) => Object.assign(new Error(message), { code })

const unix = (text) => text.replace(/\r\n?/g, '\n')
const allPages = (text) => SimpptParser.parse(text, { keepEmpty: true }).slides

const pageIndex = (text, page) => {
  const total = allPages(text).length
  if (!Number.isInteger(page) || page < 1 || page > total) {
    throw fail('ENOPAGE', `沒有第 ${page} 頁（這份簡報共 ${total} 頁）`)
  }
  return page - 1
}

// A short fingerprint of a deck's text. Page numbers only mean something for the text they were
// read from: pass the version you saw back with a write, and a deck that changed since is refused.
export const versionOf = (text) => crypto.createHash('sha1').update(unix(text)).digest('hex').slice(0, 12)

const slideText = (markdown) => {
  if (typeof markdown !== 'string') throw fail('EBADREQUEST', 'markdown 要是文字')
  return markdown
}

const range = (count, from) => Array.from({ length: count }, (_, i) => from + i)

const titleOf = (body) => {
  const heading = SimpptParser.blocksOf(body).find((block) => block.type === 'h')
  const first = heading ? heading.text : (body.split('\n').find((line) => line.trim() !== '') || '')
  return first.replace(/\{\{([^|}]*)(?:\|[^}]*)?\}\}/g, '$1').replace(/[*`]/g, '').trim()
}

// One line per page: enough to pick a page without reading the whole deck.
export const outline = (text) => {
  const { globals } = SimpptParser.parse(text)
  const slides = allPages(text).map((slide, i) => ({
    page: i + 1,
    title: titleOf(slide.body) || '（空白）',
    layout: slide.meta.layout || 'center',
    lines: slide.body ? slide.body.split('\n').length : 0,
  }))
  return { version: versionOf(text), pages: slides.length, globals, slides }
}

// The separator line that starts a page, when it carries settings ("--- layout=top").
// A bare "---" says nothing, and the line that closes the front matter is bare too.
const ownSeparator = (lines, start) => {
  const line = start > 0 ? lines[start - 1] : ''
  return /^\s*---[ \t]+\S/.test(line) ? line.trim() : ''
}

// Pages from..to as they are written in the file. `settings` is what is in force on that page.
export const readSlides = (text, from = 1, to = from) => {
  const first = pageIndex(text, from)
  const last = pageIndex(text, Math.max(from, to))
  const lines = unix(text).split('\n')
  const pages = allPages(text)
  return range(last - first + 1, first).map((i) => {
    const at = SimpptParser.slideLineRange(text, i)
    const body = lines.slice(at.start, at.end).join('\n').trim()
    const own = ownSeparator(lines, at.start)
    return { page: i + 1, settings: pages[i].meta, markdown: own ? `${own}\n\n${body}` : body }
  })
}

// Put the pages in `markdown` after page `after` (0 = at the very front).
export const insertSlides = (text, after, markdown) => {
  const total = allPages(text).length
  if (!Number.isInteger(after) || after < 0 || after > total) {
    throw fail('ENOPAGE', `不能接在第 ${after} 頁後面（這份簡報共 ${total} 頁）`)
  }
  const out = SimpptParser.insertSlidesAfter(text, after - 1, slideText(markdown))
  if (out.count === 0) throw fail('EEMPTY', '要插入的內容是空的')
  return { text: out.text, pages: range(out.count, out.index + 1) }
}

// Swap the content of one page. Extra pages in `markdown` follow it.
export const replaceSlide = (text, page, markdown) => {
  const index = pageIndex(text, page)
  const out = SimpptParser.replaceSlide(text, index, slideText(markdown))
  if (out.count === 0) throw fail('EEMPTY', '新的內容是空的')
  return { text: out.text, pages: range(out.count, page) }
}

export const deleteSlide = (text, page) => {
  const index = pageIndex(text, page)
  const total = allPages(text).length
  if (total < 2) throw fail('ELASTPAGE', '只剩一頁，不能再刪')
  return { text: SimpptParser.deleteSlide(text, index).text, total: total - 1 }
}

export const moveSlide = (text, from, to) => {
  const out = SimpptParser.moveSlideTo(text, pageIndex(text, from), pageIndex(text, to))
  return { text: out.text, page: to }
}

// --- files ---

const stem = (name) => name.replace(DECK_RE, '')

// Which deck is meant: a path, a file name, a name without its extension, or a part of the name
// that fits only one deck. Returns the path relative to root.
export const findDeck = (root, query) => {
  const wanted = (typeof query === 'string' ? query : '').trim()
  if (!wanted) throw fail('ENODECK', '沒有指定是哪一份簡報')
  const decks = listDecks(root)
  const none = () => fail('ENODECK', `找不到「${wanted}」。現有的簡報：${decks.map((deck) => deck.name).join('、') || '（沒有）'}`)
  // A path means that file and no other — and only inside decks/ (README.md is markdown too,
  // but it is not a deck).
  if (/[\\/]/.test(wanted)) {
    const rel = wanted.split('\\').join('/')
    const full = rel.startsWith(`${DECKS_DIR}/`) ? resolveDeckPath(root, rel) : null
    if (full && fs.existsSync(full)) return rel
    throw none()
  }
  const key = wanted.toLowerCase()
  const part = stem(key)
  if (!part) throw none()
  const exact = decks.filter((deck) => deck.name.toLowerCase() === key || stem(deck.name).toLowerCase() === part)
  const hits = exact.length > 0 ? exact : decks.filter((deck) => deck.name.toLowerCase().includes(part))
  if (hits.length === 1) return hits[0].path
  if (hits.length === 0) throw none()
  throw fail('EAMBIGUOUS', `「${wanted}」符合好幾份：${hits.map((deck) => deck.name).join('、')}，請講完整檔名`)
}

export const readDeck = (root, rel) => {
  const full = resolveDeckPath(root, rel)
  if (!full || !fs.existsSync(full)) throw fail('ENODECK', `找不到 ${rel}`)
  return fs.readFileSync(full, 'utf8')
}

// Read the deck, let `change(text)` return { text, ... }, and write it back.
// - `version` (from outline / readSlides / an earlier write): when the deck is no longer that
//   version, nothing is written (ECHANGED) — the page numbers the caller has are stale.
// - If something else writes the file during the change, writeDeck refuses too.
// - A file with Windows line endings keeps them.
export const editDeck = (root, rel, change, { version } = {}) => {
  const before = readDeck(root, rel)
  if (version !== undefined && version !== null && version !== versionOf(before)) {
    throw fail('ECHANGED', '這份簡報在你讀過之後被改過了，頁碼可能已經不同。請重新看大綱再改')
  }
  const { text, ...rest } = change(before)
  const after = before.includes('\r\n') ? unix(text).replace(/\n/g, '\r\n') : text
  if (after !== before) writeDeck(root, rel, after, { expect: before })
  return { deck: rel, version: versionOf(after), ...rest }
}
