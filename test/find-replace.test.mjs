import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const match = html.match(/<script id="find-replace-logic">([\s\S]*?)<\/script>/)
assert.ok(match, 'index.html must contain <script id="find-replace-logic">')

const FindReplace = new Function(`${match[1]}; return FindReplace;`)()
const { findAllMatches, replaceAllCaseInsensitive } = FindReplace

const tests = []
const test = (name, fn) => tests.push({ name, fn })

test('findAllMatches finds all case-insensitive occurrences', () => {
  assert.deepEqual(findAllMatches('Hello hello HELLO', 'hello'), [0, 6, 12])
})

test('findAllMatches returns empty array for empty query', () => {
  assert.deepEqual(findAllMatches('anything', ''), [])
})

test('findAllMatches returns empty array when no match', () => {
  assert.deepEqual(findAllMatches('abc', 'xyz'), [])
})

test('findAllMatches does not return overlapping matches', () => {
  assert.deepEqual(findAllMatches('aaaa', 'aa'), [0, 2])
})

test('replaceAllCaseInsensitive replaces every occurrence regardless of case', () => {
  assert.equal(replaceAllCaseInsensitive('Hello hello HELLO', 'hello', 'hi'), 'hi hi hi')
})

test('replaceAllCaseInsensitive is a no-op for empty query', () => {
  assert.equal(replaceAllCaseInsensitive('unchanged', '', 'x'), 'unchanged')
})

test('replaceAllCaseInsensitive returns original text when nothing matches', () => {
  assert.equal(replaceAllCaseInsensitive('abc', 'xyz', 'q'), 'abc')
})

test('replaceAllCaseInsensitive preserves surrounding text', () => {
  assert.equal(replaceAllCaseInsensitive('foo BAR baz', 'bar', 'qux'), 'foo qux baz')
})

let failed = 0
for (const { name, fn } of tests) {
  try {
    fn()
    process.stdout.write(`ok - ${name}\n`)
  } catch (err) {
    failed += 1
    process.stdout.write(`FAIL - ${name}\n  ${err.message}\n`)
  }
}
process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`)
process.exit(failed === 0 ? 0 : 1)
