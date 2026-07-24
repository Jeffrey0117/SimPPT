import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { buildGeneratePrompt } from './lib/generate-prompt.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 4646
const TOKEN = process.env.SIMPPT_TOKEN || ''

const authorized = (req) => !TOKEN || req.headers['x-simppt-token'] === TOKEN

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
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
    if (req.method === 'POST' && (urlPath === '/__upload' || urlPath === '/__save' || urlPath === '/__generate') && !authorized(req)) {
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
          const { path: rel, text } = JSON.parse(body)
          const full = path.resolve(ROOT, rel)
          if (!full.startsWith(ROOT + path.sep) || !/\.(md|markdown)$/i.test(full) || typeof text !== 'string') {
            res.writeHead(403)
            res.end('Forbidden')
            return
          }
          fs.writeFileSync(full, text, 'utf8')
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end('{"ok":true}')
        } catch (err) {
          res.writeHead(400)
          res.end('Bad request')
        }
      })
      return
    }
    if (req.method === 'POST' && urlPath === '/__generate') {
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        const buf = Buffer.concat(chunks)
        if (buf.length === 0 || buf.length > 200 * 1024) {
          res.writeHead(413, { 'Content-Type': 'application/json' })
          res.end('{"ok":false,"message":"內容過大或空白（上限 200KB）"}')
          return
        }
        const prompt = buildGeneratePrompt(buf.toString('utf8'))
        const child = spawn('claude', ['-p'], { cwd: ROOT, shell: true })
        let stdout = ''
        let stderr = ''
        let settled = false
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          child.kill()
          res.writeHead(504, { 'Content-Type': 'application/json' })
          res.end('{"ok":false,"message":"生成逾時（120 秒），請稍後再試"}')
        }, 120000)
        child.stdout.on('data', (chunk) => { stdout += chunk })
        child.stderr.on('data', (chunk) => { stderr += chunk })
        child.on('error', (err) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          const message = err.code === 'ENOENT'
            ? '找不到 claude 指令，請確認本機已安裝並登入 Claude Code CLI'
            : `啟動失敗：${err.message}`
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, message }))
        })
        child.on('close', (code) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (code !== 0) {
            const message = stderr.trim().split('\n').slice(0, 5).join('\n') || `claude 結束碼 ${code}`
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, message }))
            return
          }
          const markdown = stdout.trim()
          if (!markdown) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end('{"ok":false,"message":"AI 沒有回傳內容"}')
            return
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, markdown }))
        })
        child.stdin.write(prompt)
        child.stdin.end()
      })
      return
    }
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')
    const full = path.resolve(ROOT, rel)
    if (!full.startsWith(ROOT + path.sep)) {
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
