import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildGeneratePrompt, buildRevisePrompt, buildInsertPrompt, stripFence } from './lib/generate-prompt.mjs'
import { runClaudePrint } from './lib/run-claude.mjs'
import { writeDeck, listDecks, insideRoot } from './lib/deck-store.mjs'
import { handleApi } from './lib/api-routes.mjs'
import { sameSite } from './lib/same-site.mjs'

// Why a save was refused, as an HTTP status the editor can tell apart.
const SAVE_ERROR_STATUS = { EFORBIDDEN: 403, EEXIST: 409, ECHANGED: 409, EVERIFY: 500 }

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 4646
const TOKEN = process.env.SIMPPT_TOKEN || ''

const authorized = (req) => !TOKEN || req.headers['x-simppt-token'] === TOKEN

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.simppt': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

const server = http.createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    // Never serve dotfiles/dirs (.env, .git/…) — the static root is the repo root.
    if (urlPath.split(/[\\/]/).some((seg) => seg.startsWith('.'))) {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    // The endpoints that read or change decks, or run claude: only for this site's own pages.
    if ((urlPath.startsWith('/api/') || urlPath.startsWith('/__')) && !sameSite(req, { hasToken: Boolean(TOKEN) })) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end('{"ok":false,"code":"EFORBIDDEN","message":"forbidden"}')
      return
    }
    if (handleApi(req, res, new URL(req.url, 'http://localhost'), { root: ROOT, authorized })) return
    if (req.method === 'POST' && (urlPath === '/__insert' || urlPath === '/__upload' || urlPath === '/__save' || urlPath === '/__generate' || urlPath === '/__revise') && !authorized(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end('{"status":"error","message":"unauthorized"}')
      return
    }
    if (req.method === 'POST' && urlPath === '/__upload') {
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', async () => {
        try {
          const buf = Buffer.concat(chunks)
          if (buf.length === 0 || buf.length > 52 * 1024 * 1024) {
            res.writeHead(413)
            res.end('{"status":"error","message":"file too large"}')
            return
          }
          const filename = decodeURIComponent(req.headers['x-filename'] || 'paste.png')
          const mime = req.headers['content-type'] || 'application/octet-stream'
          const form = new FormData()
          form.append('file', new Blob([buf], { type: mime }), filename)
          form.append('r18', '0')
          const upstream = await fetch('https://api.urusai.cc/v1/upload', { method: 'POST', body: form })
          const json = await upstream.text()
          res.writeHead(upstream.ok ? 200 : 502, { 'Content-Type': 'application/json' })
          res.end(json)
        } catch (err) {
          res.writeHead(502)
          res.end('{"status":"error","message":"upload proxy failed"}')
        }
      })
      return
    }
    if (req.method === 'POST' && urlPath === '/__save') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        try {
          const { path: rel, text, create, expect } = JSON.parse(body)
          const saved = writeDeck(ROOT, rel, text, { create: create === true, expect })
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, ...saved }))
        } catch (err) {
          const status = SAVE_ERROR_STATUS[err.code] || (err instanceof SyntaxError ? 400 : 500)
          res.writeHead(status, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, code: err.code || 'EBADREQUEST' }))
        }
      })
      return
    }
    if (req.method === 'GET' && urlPath === '/__decks') {
      if (!authorized(req)) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end('{"ok":false}')
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ ok: true, decks: listDecks(ROOT) }))
      return
    }
    if (req.method === 'POST' && urlPath === '/__generate') {
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', async () => {
        const buf = Buffer.concat(chunks)
        if (buf.length === 0 || buf.length > 200 * 1024) {
          res.writeHead(413, { 'Content-Type': 'application/json' })
          res.end('{"ok":false,"message":"內容過大或空白（上限 200KB）"}')
          return
        }
        const prompt = buildGeneratePrompt(buf.toString('utf8'))
        const result = await runClaudePrint(prompt, { cwd: ROOT })
        if (!result.ok) {
          res.writeHead(result.status, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, message: result.message }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, markdown: result.markdown }))
      })
      return
    }
    if (req.method === 'POST' && urlPath === '/__revise') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', async () => {
        if (Buffer.byteLength(body, 'utf8') > 300 * 1024) {
          res.writeHead(413, { 'Content-Type': 'application/json' })
          res.end('{"ok":false,"message":"內容過大（上限 300KB）"}')
          return
        }
        let markdown
        let instruction
        try {
          ({ markdown, instruction } = JSON.parse(body))
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end('{"ok":false,"message":"請求格式錯誤"}')
          return
        }
        if (typeof markdown !== 'string' || typeof instruction !== 'string' || !instruction.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end('{"ok":false,"message":"缺少 markdown 或 instruction"}')
          return
        }
        const prompt = buildRevisePrompt(markdown, instruction)
        const result = await runClaudePrint(prompt, { cwd: ROOT })
        if (!result.ok) {
          res.writeHead(result.status, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, message: result.message }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, markdown: result.markdown }))
      })
      return
    }
    if (req.method === 'POST' && urlPath === '/__insert') {
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', async () => {
        const body = Buffer.concat(chunks).toString('utf8')
        if (Buffer.byteLength(body, 'utf8') > 300 * 1024) {
          res.writeHead(413, { 'Content-Type': 'application/json' })
          res.end('{"ok":false,"message":"內容過大（上限 300KB）"}')
          return
        }
        let markdown
        let instruction
        let after
        if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end('{"ok":false,"message":"請求格式錯誤"}')
          return
        }
        try {
          ({ markdown, instruction, after } = JSON.parse(body))
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end('{"ok":false,"message":"請求格式錯誤"}')
          return
        }
        if (typeof markdown !== 'string' || typeof instruction !== 'string' || !instruction.trim() || !Number.isInteger(after) || after < 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end('{"ok":false,"message":"缺少 markdown、instruction 或 after"}')
          return
        }
        // The editor puts the pages in itself (and can undo it); nothing is written here.
        const result = await runClaudePrint(buildInsertPrompt(markdown, after, instruction), { cwd: ROOT })
        if (!result.ok) {
          res.writeHead(result.status, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, message: result.message }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, markdown: stripFence(result.markdown) }))
      })
      return
    }
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')
    const full = path.resolve(ROOT, rel)
    // insideRoot looks at where the file really is: "/GIT~1/config" is .git/config on Windows.
    if (!full.startsWith(ROOT + path.sep) || !insideRoot(ROOT, full)) {
      res.writeHead(403)
      res.end('Forbidden')
      return
    }
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      res.writeHead(404)
      res.end('Not found')
      return
    }
    const mime = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' })
    fs.createReadStream(full).pipe(res)
  } catch (err) {
    res.writeHead(500)
    res.end('Server error')
  }
})

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`simppt → http://localhost:${PORT}\n`)
})
