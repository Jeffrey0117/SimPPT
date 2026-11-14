import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const match = html.match(/<script id="save-logic">([\s\S]*?)<\/script>/)
assert.ok(match, 'index.html must contain <script id="save-logic">')

const SaveLogic = new Function(`${match[1]}; return SaveLogic;`)()
const { suggestName, deckPathFor, fileState } = SaveLogic

const tests = []
const test = (name, fn) => tests.push({ name, fn })

test('suggestName takes the first heading, skipping the front matter', () => {
  const text = ['---', 'bg: #0d0d0f', '---', '', '# 英文閱讀分享', '', '內文'].join('\n')
  assert.equal(suggestName(text), '英文閱讀分享')
})

test('suggestName strips markdown and SimPPT styling from the heading', () => {
  assert.equal(suggestName('# **重點** 與 {{標色|c=#f00}} {x=10 y=20}'), '重點 與 標色')
  assert.equal(suggestName('## 第二層也可以'), '第二層也可以')
})

test('suggestName removes characters a file name cannot hold and keeps it short', () => {
  assert.equal(suggestName('# a/b\\c:d?e"f<g>h|i'), 'a b c d e f g h i')
  assert.equal(suggestName(`# ${'長'.repeat(80)}`).length, 40)
  assert.equal(suggestName('# ...點開頭'), '點開頭')
})

test('suggestName falls back when there is no usable heading', () => {
  assert.equal(suggestName(''), '未命名')
  assert.equal(suggestName('只有內文'), '未命名')
  assert.equal(suggestName('# ///'), '未命名')
})

test('deckPathFor turns what was typed into a path inside decks/', () => {
  assert.equal(deckPathFor('英文閱讀分享'), 'decks/英文閱讀分享.simppt')
  assert.equal(deckPathFor('talk.simppt'), 'decks/talk.simppt')
  assert.equal(deckPathFor('talk.SIMPPT'), 'decks/talk.simppt')
})

test('deckPathFor keeps .md when the name was typed with it', () => {
  assert.equal(deckPathFor('  talk.md  '), 'decks/talk.md')
  assert.equal(deckPathFor('talk.MD'), 'decks/talk.md')
  assert.equal(deckPathFor('notes.markdown'), 'decks/notes.md')
})

test('deckPathFor never leaves decks/ and rejects an empty name', () => {
  assert.equal(deckPathFor('../../server'), 'decks/server.simppt')
  assert.equal(deckPathFor('a/b\\c'), 'decks/c.simppt')
  assert.equal(deckPathFor('.env'), 'decks/env.simppt')
  assert.equal(deckPathFor(''), null)
  assert.equal(deckPathFor('   '), null)
  assert.equal(deckPathFor('...'), null)
  assert.equal(deckPathFor('.md'), null)
  assert.equal(deckPathFor('.simppt'), null)
})

test('remoteChange: the file is as the editor knows it -> nothing to do', () => {
  const { remoteChange } = SaveLogic
  assert.equal(remoteChange({ remote: 'a\r\nb', clean: 'a\nb', dirty: false }), 'none')
  assert.equal(remoteChange({ remote: 'a', clean: 'a', dirty: true }), 'none')
})

test('remoteChange: changed elsewhere and nothing unsaved here -> load it', () => {
  assert.equal(SaveLogic.remoteChange({ remote: 'new', clean: 'old', dirty: false }), 'load')
})

test('remoteChange: unsaved changes here are never replaced, only offered once per version', () => {
  const { remoteChange } = SaveLogic
  assert.equal(remoteChange({ remote: 'new', clean: 'old', dirty: true }), 'offer')
  assert.equal(remoteChange({ remote: 'new', clean: 'old', dirty: true, seen: 'new' }), 'none')
  assert.equal(remoteChange({ remote: 'newer', clean: 'old', dirty: true, seen: 'new' }), 'offer')
})

test('remoteChange: a copy asked for before our own save is not news', () => {
  const { remoteChange } = SaveLogic
  // 編輯器在 t=200 存了 'mine'；這份回應是 t=100 問的，拿到的還是存檔前的 'old'
  assert.equal(remoteChange({ remote: 'old', clean: 'mine', dirty: false, asked: 100, wrote: 200 }), 'none')
  assert.equal(remoteChange({ remote: 'old', clean: 'mine', dirty: false, asked: 200, wrote: 200 }), 'none')
  // 存檔之後才問的，就是真的被別人改了
  assert.equal(remoteChange({ remote: 'theirs', clean: 'mine', dirty: false, asked: 300, wrote: 200 }), 'load')
  // 從沒存過檔（wrote = 0）不影響判斷
  assert.equal(remoteChange({ remote: 'theirs', clean: 'mine', dirty: false, asked: 300, wrote: 0 }), 'load')
})

test('remoteChange: without knowing what the file held, do nothing', () => {
  const { remoteChange } = SaveLogic
  assert.equal(remoteChange({ remote: 'new', clean: null, dirty: false }), 'none')
  assert.equal(remoteChange({ remote: undefined, clean: 'old', dirty: false }), 'none')
})

test('fileState: saving and failed win over everything', () => {
  assert.equal(fileState({ saving: true, failed: true, dirty: true, hasTarget: true }), 'saving')
  assert.equal(fileState({ failed: true, dirty: true, hasTarget: true }), 'failed')
})

test('fileState: a deck with nowhere to save is new, whether edited or not', () => {
  assert.equal(fileState({ dirty: false, hasTarget: false }), 'new')
  assert.equal(fileState({ dirty: true, hasTarget: false }), 'new')
})

test('fileState: a deck with a file is dirty until saved', () => {
  assert.equal(fileState({ dirty: true, hasTarget: true }), 'dirty')
  assert.equal(fileState({ dirty: false, hasTarget: true }), 'saved')
})

test('sameText ignores line endings, so a Windows file opened in a textarea is not "changed"', () => {
  assert.equal(SaveLogic.sameText('a\r\nb\r\n', 'a\nb\n'), true)
  assert.equal(SaveLogic.sameText('a\nb', 'a\nb'), true)
  assert.equal(SaveLogic.sameText('a\nb', 'a\nb '), false)
})

test('sameText: an unknown file content never counts as the same', () => {
  assert.equal(SaveLogic.sameText('text', null), false)
  assert.equal(SaveLogic.sameText(null, null), false)
  assert.equal(SaveLogic.sameText(undefined, ''), false)
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
