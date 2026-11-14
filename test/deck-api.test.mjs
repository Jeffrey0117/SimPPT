import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  outline, readSlides, insertSlides, replaceSlide, deleteSlide, moveSlide,
  findDeck, readDeck, editDeck, listDecks, versionOf,
} from '../lib/deck-api.mjs'
import { resolveDeckPath } from '../lib/deck-store.mjs'

const tests = []
const test = (name, fn) => tests.push({ name, fn })

const DECK = [
  '---', 'bg: #111111', '---', '',
  '# 開場 {{重點|c=#f00}}', '',
  '--- layout=bullets', '',
  '# 三件事', '', '- a', '- b', '',
  '---', '',
  '---', '',
  '只有一段話',
].join('\n')

const codeOf = (fn) => {
  try {
    fn()
  } catch (err) {
    return err.code
  }
  return null
}

const freshRoot = (files = {}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'simppt-api-'))
  fs.mkdirSync(path.join(root, 'decks'))
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, 'decks', name), text, 'utf8')
  return root
}

test('outline lists every page from 1, blank pages included', () => {
  const out = outline(DECK)
  assert.equal(out.pages, 4)
  assert.deepEqual(out.globals, { bg: '#111111' })
  assert.deepEqual(out.slides.map((s) => [s.page, s.title, s.layout]), [
    [1, '開場 重點', 'center'],
    [2, '三件事', 'bullets'],
    [3, '（空白）', 'center'],
    [4, '只有一段話', 'center'],
  ])
})

test('readSlides returns the pages as written, with the settings line when the page has one', () => {
  const [one] = readSlides(DECK, 1)
  assert.equal(one.markdown, '# 開場 {{重點|c=#f00}}')
  const two = readSlides(DECK, 2, 4)
  assert.deepEqual(two.map((s) => s.page), [2, 3, 4])
  assert.equal(two[0].markdown, '--- layout=bullets\n\n# 三件事\n\n- a\n- b')
  assert.equal(two[0].settings.layout, 'bullets')
  assert.equal(two[1].markdown, '')
  assert.equal(two[2].markdown, '只有一段話')
})

test('a page number outside the deck is refused', () => {
  assert.equal(codeOf(() => readSlides(DECK, 0)), 'ENOPAGE')
  assert.equal(codeOf(() => readSlides(DECK, 5)), 'ENOPAGE')
  assert.equal(codeOf(() => readSlides(DECK, 1.5)), 'ENOPAGE')
  assert.equal(codeOf(() => replaceSlide(DECK, 9, '# x')), 'ENOPAGE')
  assert.equal(codeOf(() => deleteSlide(DECK, 0)), 'ENOPAGE')
  assert.equal(codeOf(() => moveSlide(DECK, 1, 9)), 'ENOPAGE')
  assert.equal(codeOf(() => insertSlides(DECK, 5, '# x')), 'ENOPAGE')
  assert.equal(codeOf(() => insertSlides(DECK, -1, '# x')), 'ENOPAGE')
})

test('insertSlides reports the new page numbers; 0 puts them at the front', () => {
  const mid = insertSlides(DECK, 2, '# 甲\n\n---\n\n# 乙')
  assert.deepEqual(mid.pages, [3, 4])
  assert.deepEqual(outline(mid.text).slides.map((s) => s.title), ['開場 重點', '三件事', '甲', '乙', '（空白）', '只有一段話'])
  const front = insertSlides(DECK, 0, '# 最前')
  assert.deepEqual(front.pages, [1])
  assert.equal(outline(front.text).slides[0].title, '最前')
  assert.equal(outline(front.text).globals.bg, '#111111')
})

test('empty content is refused rather than written', () => {
  assert.equal(codeOf(() => insertSlides(DECK, 1, '   ')), 'EEMPTY')
  assert.equal(codeOf(() => replaceSlide(DECK, 1, '')), 'EEMPTY')
  assert.equal(codeOf(() => insertSlides(DECK, 1, '---\n\n---')), 'EEMPTY')
})

test('replaceSlide, deleteSlide and moveSlide work in page numbers', () => {
  const replaced = replaceSlide(DECK, 2, '# 換過')
  assert.deepEqual(replaced.pages, [2])
  assert.equal(outline(replaced.text).slides[1].title, '換過')
  assert.equal(outline(replaced.text).slides[1].layout, 'bullets')
  const deleted = deleteSlide(DECK, 3)
  assert.equal(deleted.total, 3)
  assert.deepEqual(outline(deleted.text).slides.map((s) => s.title), ['開場 重點', '三件事', '只有一段話'])
  const moved = moveSlide(DECK, 4, 1)
  assert.equal(moved.page, 1)
  assert.equal(outline(moved.text).slides[0].title, '只有一段話')
})

test('the last page cannot be deleted', () => {
  assert.equal(codeOf(() => deleteSlide('# 只有這頁', 1)), 'ELASTPAGE')
})

test('findDeck takes a path, a file name, a bare name, or a part that fits one deck', () => {
  const root = freshRoot({ '英文 閱讀分享.md': '# a', 'talk.simppt': '# b', 'talk-notes.md': '# c' })
  assert.equal(findDeck(root, 'decks/talk.simppt'), 'decks/talk.simppt')
  assert.equal(findDeck(root, 'talk.simppt'), 'decks/talk.simppt')
  assert.equal(findDeck(root, 'talk'), 'decks/talk.simppt')
  assert.equal(findDeck(root, '英文 閱讀分享'), 'decks/英文 閱讀分享.md')
  assert.equal(findDeck(root, '閱讀'), 'decks/英文 閱讀分享.md')
  assert.equal(findDeck(root, 'NOTES'), 'decks/talk-notes.md')
})

test('findDeck says so when nothing or more than one deck fits', () => {
  const root = freshRoot({ 'talk-a.md': '# a', 'talk-b.md': '# b' })
  assert.equal(codeOf(() => findDeck(root, 'talk')), 'EAMBIGUOUS')
  assert.equal(codeOf(() => findDeck(root, 'nothing')), 'ENODECK')
  assert.equal(codeOf(() => findDeck(root, '')), 'ENODECK')
  assert.equal(codeOf(() => findDeck(root, '../server.js')), 'ENODECK')
})

test('editDeck writes the change back and returns what the change reported', () => {
  const root = freshRoot({ 'a.md': DECK })
  const out = editDeck(root, 'decks/a.md', (text) => insertSlides(text, 1, '# 新'))
  const written = readDeck(root, 'decks/a.md')
  assert.deepEqual(out, { deck: 'decks/a.md', version: versionOf(written), pages: [2] })
  assert.equal(outline(written).slides[1].title, '新')
})

test('editDeck with a version refuses a deck that changed since it was read', () => {
  const root = freshRoot({ 'a.md': DECK })
  const seen = outline(readDeck(root, 'decks/a.md')).version
  // someone else deletes page 1: every page number the reader holds is now off by one
  editDeck(root, 'decks/a.md', (text) => deleteSlide(text, 1))
  const afterTheirs = readDeck(root, 'decks/a.md')
  assert.equal(codeOf(() => editDeck(root, 'decks/a.md', (text) => deleteSlide(text, 2), { version: seen })), 'ECHANGED')
  assert.equal(readDeck(root, 'decks/a.md'), afterTheirs)
  // with the current version it goes through, and the answer carries the next version
  const out = editDeck(root, 'decks/a.md', (text) => deleteSlide(text, 2), { version: versionOf(afterTheirs) })
  assert.equal(out.version, versionOf(readDeck(root, 'decks/a.md')))
  assert.notEqual(out.version, versionOf(afterTheirs))
})

test('versionOf ignores line endings and changes with the text', () => {
  assert.equal(versionOf('a\r\nb'), versionOf('a\nb'))
  assert.notEqual(versionOf('a\nb'), versionOf('a\nc'))
})

test('a deck with Windows line endings keeps them after an edit', () => {
  const root = freshRoot({ 'w.md': DECK.replace(/\n/g, '\r\n') })
  editDeck(root, 'decks/w.md', (text) => insertSlides(text, 1, '# 新\n\n- a'))
  const text = readDeck(root, 'decks/w.md')
  assert.ok(text.includes('# 新\r\n'))
  assert.equal(/[^\r]\n/.test(text), false)
})

test('markdown that is not text is refused, not turned into a page', () => {
  assert.equal(codeOf(() => insertSlides(DECK, 1, {})), 'EBADREQUEST')
  assert.equal(codeOf(() => insertSlides(DECK, 1, ['# a'])), 'EBADREQUEST')
  assert.equal(codeOf(() => replaceSlide(DECK, 1, 42)), 'EBADREQUEST')
})

test('findDeck: a path names that file only, and only inside decks/', () => {
  const root = freshRoot({ 'talk.md': '# deck' })
  fs.writeFileSync(path.join(root, 'README.md'), '# readme', 'utf8')
  fs.mkdirSync(path.join(root, 'docs'))
  fs.writeFileSync(path.join(root, 'docs', 'talk.md'), '# doc', 'utf8')
  assert.equal(codeOf(() => findDeck(root, 'README.md')), 'ENODECK')
  assert.equal(codeOf(() => findDeck(root, './README.md')), 'ENODECK')
  assert.equal(codeOf(() => findDeck(root, 'docs/talk.md')), 'ENODECK')
  // a path that does not exist must not fall back to another file with the same name
  assert.equal(codeOf(() => findDeck(root, 'decks/archive/talk.md')), 'ENODECK')
  assert.equal(codeOf(() => findDeck(root, 'C:\\elsewhere\\talk.md')), 'ENODECK')
  assert.equal(findDeck(root, 'decks/talk.md'), 'decks/talk.md')
  assert.equal(findDeck(root, 'decks\\talk.md'), 'decks/talk.md')
})

test('findDeck: a name with nothing in it matches no deck (not every deck)', () => {
  const root = freshRoot({ 'only.md': '# deck' })
  assert.equal(codeOf(() => findDeck(root, '.md')), 'ENODECK')
  assert.equal(codeOf(() => findDeck(root, '.simppt')), 'ENODECK')
  assert.equal(codeOf(() => findDeck(root, '/')), 'ENODECK')
  assert.equal(codeOf(() => findDeck(root, { deck: 'only' })), 'ENODECK')
})

test('files outside the root, or in a dot-folder, cannot be reached — whatever the path is spelled like', () => {
  const root = freshRoot({ 'a.md': '# deck' })
  const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.md`)
  fs.writeFileSync(outside, '# outside', 'utf8')
  fs.mkdirSync(path.join(root, 'decks', '.secret'))
  fs.writeFileSync(path.join(root, 'decks', '.secret', 'notes.md'), '# secret', 'utf8')
  const tries = [
    `../${path.basename(outside)}`,
    `decks/../../${path.basename(outside)}`,
    outside,
    'decks/.secret/notes.md',
    'decks/SECRET~1/notes.md', // the Windows short name of ".secret"
    'decks/a.md:stream.md',
  ]
  for (const attempt of tries) {
    assert.equal(resolveDeckPath(root, attempt), null, attempt)
    assert.equal(codeOf(() => readDeck(root, attempt)), 'ENODECK', attempt)
    assert.equal(codeOf(() => findDeck(root, attempt)), 'ENODECK', attempt)
    assert.equal(codeOf(() => editDeck(root, attempt, (text) => replaceSlide(text, 1, '# pwned'))), 'ENODECK', attempt)
  }
  assert.equal(fs.readFileSync(outside, 'utf8'), '# outside')
  assert.equal(fs.readFileSync(path.join(root, 'decks', '.secret', 'notes.md'), 'utf8'), '# secret')
  fs.rmSync(outside)
})

test('editDeck leaves the file alone when the change fails', () => {
  const root = freshRoot({ 'a.md': DECK })
  assert.equal(codeOf(() => editDeck(root, 'decks/a.md', (text) => insertSlides(text, 99, '# 新'))), 'ENOPAGE')
  assert.equal(readDeck(root, 'decks/a.md'), DECK)
  assert.equal(codeOf(() => readDeck(root, 'decks/none.md')), 'ENODECK')
  assert.equal(codeOf(() => readDeck(root, '../a.md')), 'ENODECK')
})

test('.simppt files are decks: listed, readable, writable', () => {
  const root = freshRoot({ 'a.simppt': '# a', 'b.md': '# b', 'c.txt': 'no' })
  assert.deepEqual(listDecks(root).map((d) => d.name).sort(), ['a.simppt', 'b.md'])
  assert.equal(resolveDeckPath(root, 'decks/a.simppt'), path.join(root, 'decks', 'a.simppt'))
  editDeck(root, 'decks/a.simppt', (text) => replaceSlide(text, 1, '# 改'))
  assert.equal(readDeck(root, 'decks/a.simppt').trim(), '# 改')
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
