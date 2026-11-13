import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveDeckPath, writeDeck, listDecks } from '../lib/deck-store.mjs'

const tests = []
const test = (name, fn) => tests.push({ name, fn })

const freshRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'simppt-store-'))
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const codeOf = (fn) => {
  try {
    fn()
  } catch (err) {
    return err.code
  }
  return null
}

test('resolveDeckPath accepts markdown inside the root only', () => {
  const root = freshRoot()
  assert.equal(resolveDeckPath(root, 'decks/a.md'), path.join(root, 'decks', 'a.md'))
  assert.equal(resolveDeckPath(root, 'a.markdown'), path.join(root, 'a.markdown'))
  assert.equal(resolveDeckPath(root, '../a.md'), null)
  assert.equal(resolveDeckPath(root, 'decks/../../a.md'), null)
  assert.equal(resolveDeckPath(root, 'decks/a.txt'), null)
  assert.equal(resolveDeckPath(root, 'server.js'), null)
  assert.equal(resolveDeckPath(root, '.git/a.md'), null)
  assert.equal(resolveDeckPath(root, 'decks/.hidden.md'), null)
  assert.equal(resolveDeckPath(root, ''), null)
  assert.equal(resolveDeckPath(root, 42), null)
})

test('writeDeck writes the text and reports where it went', () => {
  const root = freshRoot()
  const out = writeDeck(root, 'decks/talk.md', '# 你好\n')
  assert.deepEqual(out, { path: 'decks/talk.md', bytes: Buffer.byteLength('# 你好\n') })
  assert.equal(read(root, 'decks/talk.md'), '# 你好\n')
})

test('writeDeck creates the decks folder when it is missing', () => {
  const root = freshRoot()
  writeDeck(root, 'decks/new.md', 'x')
  assert.equal(read(root, 'decks/new.md'), 'x')
})

test('writeDeck overwrites an existing deck and leaves no temp file behind', () => {
  const root = freshRoot()
  writeDeck(root, 'decks/talk.md', 'old')
  writeDeck(root, 'decks/talk.md', 'new')
  assert.equal(read(root, 'decks/talk.md'), 'new')
  assert.deepEqual(fs.readdirSync(path.join(root, 'decks')), ['talk.md'])
})

test('writeDeck with create refuses to touch a file that already exists', () => {
  const root = freshRoot()
  writeDeck(root, 'decks/talk.md', 'precious')
  assert.equal(codeOf(() => writeDeck(root, 'decks/talk.md', 'oops', { create: true })), 'EEXIST')
  assert.equal(read(root, 'decks/talk.md'), 'precious')
})

test('writeDeck with create writes a file that is not there yet', () => {
  const root = freshRoot()
  const out = writeDeck(root, 'decks/fresh.md', 'hi', { create: true })
  assert.equal(out.path, 'decks/fresh.md')
  assert.equal(read(root, 'decks/fresh.md'), 'hi')
})

test('writeDeck with expect refuses to overwrite a file someone else changed', () => {
  const root = freshRoot()
  writeDeck(root, 'decks/talk.md', 'what the editor loaded')
  fs.writeFileSync(path.join(root, 'decks', 'talk.md'), 'edited in another program')
  assert.equal(
    codeOf(() => writeDeck(root, 'decks/talk.md', 'mine', { expect: 'what the editor loaded' })),
    'ECHANGED',
  )
  assert.equal(read(root, 'decks/talk.md'), 'edited in another program')
})

test('writeDeck with expect writes when the file is as the editor last saw it', () => {
  const root = freshRoot()
  fs.mkdirSync(path.join(root, 'decks'))
  fs.writeFileSync(path.join(root, 'decks', 'talk.md'), 'line one\r\nline two\r\n')
  writeDeck(root, 'decks/talk.md', 'mine', { expect: 'line one\nline two\n' })
  assert.equal(read(root, 'decks/talk.md'), 'mine')
  writeDeck(root, 'decks/gone.md', 'still saved', { expect: 'a file that was deleted meanwhile' })
  assert.equal(read(root, 'decks/gone.md'), 'still saved')
})

test('writeDeck rejects paths outside the root, other file types and non-text', () => {
  const root = freshRoot()
  assert.equal(codeOf(() => writeDeck(root, '../evil.md', 'x')), 'EFORBIDDEN')
  assert.equal(codeOf(() => writeDeck(root, 'server.js', 'x')), 'EFORBIDDEN')
  assert.equal(codeOf(() => writeDeck(root, 'decks/a.md', null)), 'EFORBIDDEN')
  assert.equal(fs.existsSync(path.join(root, 'decks')), false)
})

test('listDecks lists markdown in decks/, newest first, and nothing else', () => {
  const root = freshRoot()
  assert.deepEqual(listDecks(root), [])
  writeDeck(root, 'decks/old.md', 'a')
  writeDeck(root, 'decks/new.md', 'bb')
  fs.writeFileSync(path.join(root, 'decks', 'note.txt'), 'x')
  fs.mkdirSync(path.join(root, 'decks', 'demo'))
  const past = new Date(Date.now() - 60000)
  fs.utimesSync(path.join(root, 'decks', 'old.md'), past, past)
  const list = listDecks(root)
  assert.deepEqual(list.map((d) => d.path), ['decks/new.md', 'decks/old.md'])
  assert.equal(list[0].name, 'new.md')
  assert.equal(list[0].size, 2)
  assert.equal(typeof list[0].mtime, 'number')
})

let failed = 0
for (const { name, fn } of tests) {
  try {
    fn()
    process.stdout.write(`ok - ${name}\n`)
  } catch (err) {
    failed += 1
    process.stdout.write(`FAIL - ${name}\n${err.stack}\n`)
  }
}
process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`)
if (failed > 0) process.exit(1)
