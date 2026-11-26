import assert from 'node:assert/strict'
import { fetchNote, noteConfig, noteIdIn, resolveSource } from '../lib/note-source.mjs'

const tests = []
const test = (name, fn) => tests.push({ name, fn })

const config = noteConfig({ HACKMD2_API_TOKEN: 'secret', HACKMD2_SITES: 'https://notes.example.com, ' })
const answer = (status, body) => new Response(JSON.stringify(body), { status })

test('noteConfig: the local hackmd2 unless told otherwise', () => {
  assert.deepEqual(noteConfig({}), { url: 'http://127.0.0.1:4490', token: '', sites: [] })
  assert.equal(noteConfig({ HACKMD2_URL: 'http://127.0.0.1:5000/' }).url, 'http://127.0.0.1:5000')
  assert.deepEqual(config.sites, ['https://notes.example.com'])
})

test('noteIdIn: the address of a note, under any of the names hackmd2 answers to', () => {
  assert.equal(noteIdIn('http://127.0.0.1:4490/my-note', config), 'my-note')
  assert.equal(noteIdIn('  http://localhost:4490/aB3_x-9?both#top \n', config), 'aB3_x-9')
  assert.equal(noteIdIn('https://notes.example.com/%E7%AD%86%E8%A8%98/print', config), '筆記')
  assert.equal(noteIdIn('hackmd2:my-note', config), 'my-note')
})

test('noteIdIn: anything else is just text', () => {
  for (const text of [
    'https://example.com/my-note',
    'http://127.0.0.1:9999/my-note',
    'http://127.0.0.1:4490/',
    'http://127.0.0.1:4490/api/notes',
    'http://127.0.0.1:4490/settings',
    'see http://127.0.0.1:4490/my-note for the outline',
    'http://127.0.0.1:4490/a\nhttp://127.0.0.1:4490/b',
    '# A talk about ducks',
    '',
  ]) assert.equal(noteIdIn(text, config), null, text)
})

test('fetchNote: asks the configured hackmd2, with the token, and returns the text', async () => {
  const asked = []
  const fetchImpl = async (url, init) => { asked.push({ url, auth: init.headers.Authorization }); return answer(200, { id: 'x', content: '# Ducks\n\nnotes' }) }
  assert.equal(await fetchNote('我的 筆記', config, fetchImpl), '# Ducks\n\nnotes')
  assert.deepEqual(asked, [{ url: 'http://127.0.0.1:4490/api/notes/%E6%88%91%E7%9A%84%20%E7%AD%86%E8%A8%98', auth: 'Bearer secret' }])
})

test('fetchNote: says what went wrong in words a person can act on', async () => {
  const message = (fetchImpl) => fetchNote('x', config, fetchImpl).then(() => 'no error', (err) => err.message)
  assert.match(await message(async () => { throw new Error('ECONNREFUSED') }), /連不上/)
  assert.match(await message(async () => answer(401, { error: 'unauthorized' })), /token/)
  assert.match(await message(async () => answer(404, {})), /找不到/)
  assert.match(await message(async () => answer(200, { content: '  ' })), /空的/)
})

test('resolveSource: a note address becomes the note, pasted text stays as it is, and nothing is fetched for text', async () => {
  let asked = 0
  const fetchImpl = async () => { asked += 1; return answer(200, { content: '# From the note' }) }
  assert.equal(await resolveSource('some pasted notes about ducks', config, fetchImpl), 'some pasted notes about ducks')
  assert.equal(asked, 0)
  assert.equal(await resolveSource('https://notes.example.com/duck-talk', config, fetchImpl), '# From the note')
  assert.equal(asked, 1)
})

let failed = 0
for (const { name, fn } of tests) {
  try {
    await fn()
    console.log(`ok - ${name}`)
  } catch (err) {
    failed += 1
    console.log(`not ok - ${name}\n${err.stack}`)
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`)
if (failed) process.exit(1)
