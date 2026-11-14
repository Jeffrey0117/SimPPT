// HTTP face of lib/deck-api.mjs: /api/decks, /api/outline, /api/slides[/insert|replace|delete|move].
// Every answer is { ok: true, ... } or { ok: false, code, message }.
import {
  versionOf, listDecks, findDeck, readDeck, editDeck, outline, readSlides,
  insertSlides, replaceSlide, deleteSlide, moveSlide,
} from './deck-api.mjs'

const MAX_BODY = 300 * 1024

const STATUS = {
  ENODECK: 404, ENOPAGE: 404,
  EAMBIGUOUS: 409, ECHANGED: 409, ELASTPAGE: 409,
  EEMPTY: 400, EBADREQUEST: 400, EFORBIDDEN: 403, ETOOBIG: 413,
}

const fail = (code, message) => Object.assign(new Error(message), { code })

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

const sendError = (res, err) => {
  const known = Boolean(err && STATUS[err.code])
  send(res, known ? STATUS[err.code] : 500, {
    ok: false,
    code: known ? err.code : 'EINTERNAL',
    message: known ? err.message : '伺服器內部錯誤',
  })
}

const readJson = (req) => new Promise((resolve, reject) => {
  // Asking for JSON by name keeps other websites out: a page elsewhere cannot send this
  // content type to us without the browser asking first, and we never say yes.
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
    req.resume()
    reject(fail('EBADREQUEST', 'Content-Type 要是 application/json'))
    return
  }
  const chunks = []
  let size = 0
  req.on('data', (chunk) => {
    size += chunk.length
    if (size <= MAX_BODY) chunks.push(chunk)
  })
  req.on('error', reject)
  req.on('end', () => {
    if (size > MAX_BODY) return reject(fail('ETOOBIG', '內容過大（上限 300KB）'))
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
      resolve(parsed)
    } catch (err) {
      reject(fail('EBADREQUEST', '請求內容不是 JSON 物件'))
    }
  })
})

const pageNumber = (value, name) => {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (!Number.isInteger(n)) throw fail('EBADREQUEST', `${name} 要是整數頁碼`)
  return n
}

const READS = {
  '/api/decks': (root) => ({ decks: listDecks(root) }),
  '/api/outline': (root, query) => {
    const deck = findDeck(root, query.get('deck'))
    return { deck, ...outline(readDeck(root, deck)) }
  },
  '/api/slides': (root, query) => {
    const deck = findDeck(root, query.get('deck'))
    const from = pageNumber(query.get('from') || '1', 'from')
    const to = query.get('to') ? pageNumber(query.get('to'), 'to') : from
    const text = readDeck(root, deck)
    return { deck, version: versionOf(text), slides: readSlides(text, from, to) }
  },
}

const WRITES = {
  '/api/slides/insert': (body) => (text) => insertSlides(text, pageNumber(body.after, 'after'), body.markdown),
  '/api/slides/replace': (body) => (text) => replaceSlide(text, pageNumber(body.page, 'page'), body.markdown),
  '/api/slides/delete': (body) => (text) => deleteSlide(text, pageNumber(body.page, 'page')),
  '/api/slides/move': (body) => (text) => moveSlide(text, pageNumber(body.from, 'from'), pageNumber(body.to, 'to')),
}

// Returns true when the request was one of ours (and has been answered).
export const handleApi = (req, res, url, { root, authorized }) => {
  const read = req.method === 'GET' ? READS[url.pathname] : null
  const write = req.method === 'POST' ? WRITES[url.pathname] : null
  if (!read && !write) return false
  if (!authorized(req)) {
    send(res, 401, { ok: false, code: 'EUNAUTHORIZED', message: 'unauthorized' })
    return true
  }
  if (read) {
    try {
      send(res, 200, { ok: true, ...read(root, url.searchParams) })
    } catch (err) {
      sendError(res, err)
    }
    return true
  }
  readJson(req)
    .then((body) => {
      const deck = findDeck(root, body.deck)
      // The file holds the text, so the answer carries only what changed.
      send(res, 200, { ok: true, ...editDeck(root, deck, write(body), { version: body.version }) })
    })
    .catch((err) => sendError(res, err))
  return true
}
