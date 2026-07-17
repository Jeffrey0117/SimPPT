import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 4646

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
