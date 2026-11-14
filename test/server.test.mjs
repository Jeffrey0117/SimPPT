// server.js itself, started for real on a spare port: what it refuses to hand out, and who may call it.
// Read-only against the repo — nothing here writes a deck or runs claude.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { sameSite } from '../lib/same-site.mjs'

const SERVER = fileURLToPath(new URL('../server.js', import.meta.url))
const ROOT = fileURLToPath(new URL('..', import.meta.url))

const tests = []
const test = (name, fn) => tests.push({ name, fn })

const freePort = () => new Promise((resolve) => {
  const probe = net.createServer()
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address()
    probe.close(() => resolve(port))
  })
})

// fetch() will not let a caller set Host or Origin, so these go through http.request.
const ask = (port, { method = 'GET', path = '/', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
    const chunks = []
    res.on('data', (chunk) => chunks.push(chunk))
    res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }))
  })
  req.on('error', reject)
  req.end(body)
})

const start = async (env = {}) => {
  const port = await freePort()
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, SIMPPT_TOKEN: '', ...env, PORT: String(port) } })
  await new Promise((resolve, reject) => {
    child.stdout.on('data', resolve)
    child.on('error', reject)
    child.on('exit', () => reject(new Error('server.js exited before it was ready')))
  })
  return { port, stop: () => child.kill() }
}

test('the page and the decks are served', async ({ port }) => {
  assert.equal((await ask(port)).status, 200)
  assert.equal((await ask(port, { path: '/decks/templates.md' })).status, 200)
})

test('dot-files and dot-folders are not served, under any spelling', async ({ port }) => {
  assert.ok(fs.existsSync(`${ROOT}.git/HEAD`), 'this test needs the repo\'s .git folder')
  // GIT~1 is the short name Windows gives ".git"; on other systems it simply does not exist.
  for (const path of ['/.git/HEAD', '/.git/config', '/GIT~1/HEAD', '/GIT~1/config', '/git~1/HEAD', '/.gitignore', '/GITIGN~1']) {
    const res = await ask(port, { path })
    assert.ok([403, 404].includes(res.status), `${path} answered ${res.status}`)
    assert.ok(!res.text.includes('ref:') && !res.text.includes('[core]'), `${path} leaked git data`)
  }
})

test('the deck endpoints answer this site\'s own pages and local programs', async ({ port }) => {
  const own = { Host: `localhost:${port}`, Origin: `http://localhost:${port}` }
  assert.equal((await ask(port, { path: '/api/decks' })).status, 200)
  assert.equal((await ask(port, { path: '/api/decks', headers: own })).status, 200)
  assert.equal((await ask(port, { path: '/__decks', headers: own })).status, 200)
})

test('a page on another website cannot call them', async ({ port }) => {
  const foreign = { Origin: 'https://evil.example', 'Content-Type': 'application/json' }
  // A deck that does not exist: if the guard ever fails, this must not be able to change a real one.
  const body = JSON.stringify({ deck: 'no-such-deck-used-by-tests', page: 1 })
  for (const path of ['/api/slides/delete', '/__insert', '/__save', '/__revise', '/__generate']) {
    assert.equal((await ask(port, { method: 'POST', path, headers: foreign, body })).status, 403, path)
  }
  assert.equal((await ask(port, { path: '/api/decks', headers: { Origin: 'https://evil.example' } })).status, 403)
})

test('a domain pointed at this machine (DNS rebinding) is refused when there is no token', async ({ port }) => {
  const rebound = { Host: `evil.example:${port}`, Origin: `http://evil.example:${port}` }
  assert.equal((await ask(port, { path: '/api/decks', headers: rebound })).status, 403)
  assert.equal((await ask(port, { path: '/api/slides?deck=templates', headers: { Host: 'evil.example' } })).status, 403)
})

test('/__insert refuses a request that is not JSON, before anything is run', async ({ port }) => {
  const body = JSON.stringify({ markdown: '# A', after: 1, instruction: 'x' })
  const plain = await ask(port, { method: 'POST', path: '/__insert', headers: { 'Content-Type': 'text/plain' }, body })
  assert.equal(plain.status, 400)
  const missing = await ask(port, { method: 'POST', path: '/__insert', headers: { 'Content-Type': 'application/json' }, body: '{"markdown":"# A"}' })
  assert.equal(missing.status, 400)
})

test('sameSite: with a token the public host is fine, a foreign origin still is not', async () => {
  const req = (headers) => ({ headers })
  assert.equal(sameSite(req({ host: 'slides.example.com', origin: 'https://slides.example.com' }), { hasToken: true }), true)
  assert.equal(sameSite(req({ host: 'slides.example.com' }), { hasToken: true }), true)
  assert.equal(sameSite(req({ host: 'slides.example.com', origin: 'https://evil.example' }), { hasToken: true }), false)
  assert.equal(sameSite(req({ host: 'slides.example.com' }), { hasToken: false }), false)
  assert.equal(sameSite(req({ host: '127.0.0.1:4646', origin: 'null' }), { hasToken: false }), false)
  assert.equal(sameSite(req({ host: '[::1]:4646' }), { hasToken: false }), true)
})

test('with a token set, the API needs it', async () => {
  const server = await start({ SIMPPT_TOKEN: 'secret' })
  try {
    assert.equal((await ask(server.port, { path: '/api/decks' })).status, 401)
    assert.equal((await ask(server.port, { path: '/api/decks', headers: { 'X-Simppt-Token': 'secret' } })).status, 200)
    const insert = await ask(server.port, { method: 'POST', path: '/__insert', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(insert.status, 401)
  } finally {
    server.stop()
  }
})

const shared = await start()
let failed = 0
for (const { name, fn } of tests) {
  try {
    await fn(shared)
    process.stdout.write(`ok - ${name}\n`)
  } catch (err) {
    failed += 1
    process.stdout.write(`FAIL - ${name}\n${err.stack}\n`)
  }
}
shared.stop()
process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`)
process.exit(failed === 0 ? 0 : 1)
