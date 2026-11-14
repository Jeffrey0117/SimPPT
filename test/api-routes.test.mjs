import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { handleApi } from '../lib/api-routes.mjs'

const tests = []
const test = (name, fn) => tests.push({ name, fn })

const DECK = ['# 一', '', '--- layout=bullets', '', '# 二', '', '- a', '', '---', '', '# 三'].join('\n')
const NAME = '我的 演講.simppt'

const start = async ({ token = '' } = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'simppt-http-'))
  fs.mkdirSync(path.join(root, 'decks'))
  fs.writeFileSync(path.join(root, 'decks', NAME), DECK, 'utf8')
  const authorized = (req) => !token || req.headers['x-simppt-token'] === token
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (handleApi(req, res, url, { root, authorized })) return
    res.writeHead(404)
    res.end('not ours')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const get = async (pathAndQuery, headers = {}) => {
    const res = await fetch(base + pathAndQuery, { headers })
    return { status: res.status, body: await res.json().catch(() => null) }
  }
  const post = async (pathname, body, headers = {}) => {
    const res = await fetch(base + pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
    return { status: res.status, body: await res.json().catch(() => null) }
  }
  const file = () => fs.readFileSync(path.join(root, 'decks', NAME), 'utf8')
  return { root, get, post, file, close: () => server.close() }
}

const deckQuery = `deck=${encodeURIComponent('我的 演講')}`

test('GET /api/decks lists the decks', async (api) => {
  const { status, body } = await api.get('/api/decks')
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.deepEqual(body.decks.map((d) => d.path), [`decks/${NAME}`])
})

test('GET /api/outline finds a deck by a name with spaces and non-ASCII characters', async (api) => {
  const { status, body } = await api.get(`/api/outline?${deckQuery}`)
  assert.equal(status, 200)
  assert.equal(body.deck, `decks/${NAME}`)
  assert.equal(body.pages, 3)
  assert.deepEqual(body.slides.map((s) => s.title), ['一', '二', '三'])
})

test('GET /api/slides returns one page, or a range', async (api) => {
  const one = await api.get(`/api/slides?${deckQuery}&from=2`)
  assert.equal(one.body.slides.length, 1)
  assert.equal(one.body.slides[0].markdown, '--- layout=bullets\n\n# 二\n\n- a')
  const all = await api.get(`/api/slides?${deckQuery}&from=1&to=3`)
  assert.deepEqual(all.body.slides.map((s) => s.page), [1, 2, 3])
})

test('POST /api/slides/insert writes the new pages into the file', async (api) => {
  const { status, body } = await api.post('/api/slides/insert', { deck: NAME, after: 1, markdown: '# 新 A\n\n---\n\n# 新 B' })
  assert.equal(status, 200)
  assert.deepEqual({ ok: body.ok, deck: body.deck, pages: body.pages }, { ok: true, deck: `decks/${NAME}`, pages: [2, 3] })
  assert.match(body.version, /^[0-9a-f]{12}$/)
  const outline = await api.get(`/api/outline?${deckQuery}`)
  assert.deepEqual(outline.body.slides.map((s) => s.title), ['一', '新 A', '新 B', '二', '三'])
})

test('POST replace, delete and move change the file', async (api) => {
  assert.equal((await api.post('/api/slides/replace', { deck: NAME, page: 3, markdown: '# 換' })).status, 200)
  assert.equal((await api.post('/api/slides/move', { deck: NAME, from: 3, to: 1 })).body.page, 1)
  assert.equal((await api.post('/api/slides/delete', { deck: NAME, page: 2 })).body.total, 2)
  const outline = await api.get(`/api/outline?${deckQuery}`)
  assert.deepEqual(outline.body.slides.map((s) => s.title), ['換', '二'])
})

test('mistakes get a status and a code, and the file is left alone', async (api) => {
  const noDeck = await api.get('/api/outline?deck=nothing')
  assert.deepEqual([noDeck.status, noDeck.body.code], [404, 'ENODECK'])
  const noPage = await api.post('/api/slides/insert', { deck: NAME, after: 99, markdown: '# x' })
  assert.deepEqual([noPage.status, noPage.body.code], [404, 'ENOPAGE'])
  const empty = await api.post('/api/slides/insert', { deck: NAME, after: 1, markdown: ' ' })
  assert.deepEqual([empty.status, empty.body.code], [400, 'EEMPTY'])
  const notJson = await api.post('/api/slides/insert', 'not json')
  assert.deepEqual([notJson.status, notJson.body.code], [400, 'EBADREQUEST'])
  const badPage = await api.post('/api/slides/delete', { deck: NAME, page: 'two' })
  assert.deepEqual([badPage.status, badPage.body.code], [400, 'EBADREQUEST'])
  const outside = await api.post('/api/slides/replace', { deck: '../server.js', page: 1, markdown: '# x' })
  assert.equal(outside.status, 404)
  assert.equal(api.file(), DECK)
})

test('a write that carries the version it read is refused once the deck has changed', async (api) => {
  const seen = (await api.get(`/api/outline?${deckQuery}`)).body.version
  const first = await api.post('/api/slides/delete', { deck: NAME, page: 1, version: seen })
  assert.equal(first.status, 200)
  const stale = await api.post('/api/slides/delete', { deck: NAME, page: 1, version: seen })
  assert.deepEqual([stale.status, stale.body.code], [409, 'ECHANGED'])
  const fresh = await api.post('/api/slides/delete', { deck: NAME, page: 1, version: first.body.version })
  assert.equal(fresh.status, 200)
  assert.equal((await api.get(`/api/slides?${deckQuery}`)).body.version, fresh.body.version)
})

test('a write must say it is JSON — the kind of request another website cannot send unasked', async (api) => {
  const body = JSON.stringify({ deck: NAME, page: 1, markdown: '# 被別的網站改了' })
  for (const type of ['text/plain', 'application/x-www-form-urlencoded', '']) {
    const res = await api.post('/api/slides/replace', body, { 'Content-Type': type })
    assert.deepEqual([res.status, res.body.code], [400, 'EBADREQUEST'], type)
  }
  assert.equal(api.file(), DECK)
})

test('only decks can be named: not other markdown in the project, not a path outside it', async (api) => {
  fs.writeFileSync(path.join(api.root, 'README.md'), '# readme', 'utf8')
  for (const deck of ['README.md', './README.md', '../README.md', 'decks/../README.md']) {
    const write = await api.post('/api/slides/replace', { deck, page: 1, markdown: '# x' })
    assert.equal(write.status, 404, deck)
    assert.equal((await api.get(`/api/slides?deck=${encodeURIComponent(deck)}`)).status, 404, deck)
  }
  assert.equal(fs.readFileSync(path.join(api.root, 'README.md'), 'utf8'), '# readme')
})

test('paths that are not the API are left to the caller', async (api) => {
  assert.equal((await api.get('/api/unknown')).status, 404)
  assert.equal((await api.post('/api/decks', {})).status, 404)
})

test('with a token set, reads and writes both need it', async () => {
  const api = await start({ token: 'secret' })
  try {
    assert.equal((await api.get('/api/decks')).status, 401)
    assert.equal((await api.post('/api/slides/delete', { deck: NAME, page: 1 })).status, 401)
    assert.equal(api.file(), DECK)
    assert.equal((await api.get('/api/decks', { 'X-Simppt-Token': 'secret' })).status, 200)
  } finally {
    api.close()
  }
})

let failed = 0
for (const { name, fn } of tests) {
  const api = await start()
  try {
    await fn(api)
    process.stdout.write(`ok - ${name}\n`)
  } catch (err) {
    failed += 1
    process.stdout.write(`FAIL - ${name}\n${err.stack}\n`)
  } finally {
    api.close()
  }
}
process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`)
process.exit(failed === 0 ? 0 : 1)
