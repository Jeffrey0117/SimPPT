// "AI 生成" can be given a note instead of pasted text: paste the address of a hackmd2 note (the
// local HackMD) and the note's own text is what gets turned into a deck.
//
// Only one place is ever fetched from — the configured hackmd2 — whatever address was pasted; the
// address is only read for which note it names.

const DEFAULT_URL = 'http://127.0.0.1:4490'
const TIMEOUT_MS = 8000
// hackmd2's own pages that are not notes.
const NOT_NOTES = new Set(['api', 'hm2', 'settings', 'workspace', 'login', 'new', '_health'])

const fail = (message) => Object.assign(new Error(message), { code: 'ENOTE' })
const originOf = (url) => {
  try { return new URL(url).origin } catch (err) { return '' }
}

// Where hackmd2 is and how to get in. `sites` are other addresses the same hackmd2 answers at
// (its public address, say), so a link copied from there is recognised too.
export const noteConfig = (env = {}) => ({
  url: (env.HACKMD2_URL || DEFAULT_URL).replace(/\/+$/, ''),
  token: env.HACKMD2_API_TOKEN || '',
  sites: String(env.HACKMD2_SITES || '').split(',').map((site) => site.trim()).filter(Boolean),
})

// The same machine under its other names: 127.0.0.1 and localhost are one place.
const sameMachine = (origin) => {
  const twin = origin.includes('//127.0.0.1') ? origin.replace('//127.0.0.1', '//localhost') : origin.replace('//localhost', '//127.0.0.1')
  return [origin, twin]
}

// Which note a text names, or null when it is just text. A note is named by "hackmd2:<id>", or by
// nothing but the address of one of hackmd2's notes.
export const noteIdIn = (text, config) => {
  const only = String(text || '').trim()
  if (!only || /\s/.test(only)) return null
  const short = /^hackmd2:([^/?#]+)$/i.exec(only)
  if (short) return decodeURIComponent(short[1])
  let url
  try { url = new URL(only) } catch (err) { return null }
  const known = [...sameMachine(originOf(config.url)), ...config.sites.map(originOf)].filter(Boolean)
  if (!known.includes(url.origin)) return null
  const first = url.pathname.split('/').filter(Boolean)[0]
  if (!first || NOT_NOTES.has(first)) return null
  try { return decodeURIComponent(first) } catch (err) { return null }
}

export const fetchNote = async (id, config, fetchImpl = fetch) => {
  let res
  try {
    res = await fetchImpl(`${config.url}/api/notes/${encodeURIComponent(id)}`, {
      headers: config.token ? { Authorization: `Bearer ${config.token}` } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    throw fail('連不上 hackmd2，它有開著嗎？')
  }
  if (res.status === 401 || res.status === 403) throw fail('hackmd2 不讓進：要先設定它的 token')
  if (res.status === 404) throw fail('hackmd2 裡找不到這篇筆記')
  if (!res.ok) throw fail(`hackmd2 回了 ${res.status}`)
  const note = await res.json().catch(() => null)
  const content = note && typeof note.content === 'string' ? note.content : ''
  if (!content.trim()) throw fail('這篇筆記是空的')
  return content
}

// What to make the deck from: the note's text when `text` names a note, otherwise `text` itself.
export const resolveSource = async (text, config, fetchImpl = fetch) => {
  const id = noteIdIn(text, config)
  return id ? fetchNote(id, config, fetchImpl) : text
}
