import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const match = html.match(/<script id="history-logic">([\s\S]*?)<\/script>/)
assert.ok(match, 'index.html must contain <script id="history-logic">')

const EditHistory = new Function(`${match[1]}; return EditHistory;`)()
const { start, note, step, current, canUndo, canRedo } = EditHistory

const tests = []
const test = (name, fn) => tests.push({ name, fn })

const at = (text, caret = text.length) => ({ text, start: caret, end: caret, scroll: 0 })
const texts = (h) => h.items.map((it) => it.text)

test('a fresh history has one state and nothing to undo or redo', () => {
  const h = start(at('a'))
  assert.equal(current(h).text, 'a')
  assert.equal(canUndo(h), false)
  assert.equal(canRedo(h), false)
  assert.equal(step(h, -1), h)
  assert.equal(step(h, 1), h)
})

test('each operation is its own step', () => {
  let h = start(at('a'))
  h = note(h, at('ab'), { now: 1000 })
  h = note(h, at('abc'), { now: 1010 })
  assert.deepEqual(texts(h), ['a', 'ab', 'abc'])
  h = step(h, -1)
  assert.equal(current(h).text, 'ab')
  h = step(h, -1)
  assert.equal(current(h).text, 'a')
  assert.equal(canUndo(h), false)
  h = step(h, 1)
  assert.equal(current(h).text, 'ab')
  assert.equal(canRedo(h), true)
})

test('typing without a pause is one step, and the state before it survives', () => {
  let h = start(at('a'))
  h = note(h, at('ah'), { typing: true, now: 1000 })
  h = note(h, at('ahe'), { typing: true, now: 1200 })
  h = note(h, at('ahey'), { typing: true, now: 1400 })
  assert.deepEqual(texts(h), ['a', 'ahey'])
  assert.equal(current(step(h, -1)).text, 'a')
})

test('a pause, or a long burst, starts a new typing step', () => {
  let h = start(at(''))
  h = note(h, at('one'), { typing: true, now: 1000 })
  h = note(h, at('one two'), { typing: true, now: 3000 })
  assert.deepEqual(texts(h), ['', 'one', 'one two'])
  let long = start(at(''))
  for (let i = 1; i <= 20; i += 1) long = note(long, at('x'.repeat(i)), { typing: true, now: 1000 + i * 500 })
  assert.equal(long.items.length > 2, true)
})

test('typing right after an operation does not swallow the operation', () => {
  let h = start(at('a'))
  h = note(h, at('page moved'), { now: 1000 })
  h = note(h, at('page moved!'), { typing: true, now: 1100 })
  assert.deepEqual(texts(h), ['a', 'page moved', 'page moved!'])
})

test('a new change after undo drops the redo branch', () => {
  let h = start(at('a'))
  h = note(h, at('b'), { now: 1 })
  h = note(h, at('c'), { now: 2 })
  h = step(h, -1)
  h = note(h, at('d'), { now: 3 })
  assert.deepEqual(texts(h), ['a', 'b', 'd'])
  assert.equal(canRedo(h), false)
})

test('typing after an undo is a new step, not a rewrite of the state undone to', () => {
  let h = start(at('a'))
  h = note(h, at('ab'), { typing: true, now: 1000 })
  h = step(h, -1)
  h = note(h, at('ax'), { typing: true, now: 1100 })
  assert.deepEqual(texts(h), ['a', 'ax'])
})

test('the same text only refreshes the caret of the current state', () => {
  let h = start(at('abc', 3))
  h = note(h, at('abc', 1), { now: 5 })
  assert.equal(h.items.length, 1)
  assert.equal(current(h).start, 1)
})

test('history is capped, dropping the oldest states', () => {
  let h = start(at('0'))
  for (let i = 1; i <= 400; i += 1) h = note(h, at(String(i)), { now: i })
  assert.equal(h.items.length, EditHistory.LIMIT)
  assert.equal(current(h).text, '400')
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
