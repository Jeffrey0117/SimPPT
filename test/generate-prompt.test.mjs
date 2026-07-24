import assert from 'node:assert/strict'
import { buildGeneratePrompt, buildRevisePrompt } from '../lib/generate-prompt.mjs'

const tests = []
const test = (name, fn) => tests.push({ name, fn })

test('includes SimPPT syntax rules (layout/accent)', () => {
  const prompt = buildGeneratePrompt('hello world')
  assert.ok(prompt.includes('layout=split'))
  assert.ok(prompt.includes('accent'))
})

test('includes the user content verbatim', () => {
  const prompt = buildGeneratePrompt('這是我的筆記內容 ABC123')
  assert.ok(prompt.includes('這是我的筆記內容 ABC123'))
})

test('instructs markdown-only output, no code fence, no preamble', () => {
  const prompt = buildGeneratePrompt('x')
  assert.ok(prompt.includes('不要包在'))
  assert.ok(prompt.includes('不要加任何說明文字'))
})

test('different calls with different content produce different prompts', () => {
  const a = buildGeneratePrompt('內容 A')
  const b = buildGeneratePrompt('內容 B')
  assert.notEqual(a, b)
})

test('revise: includes existing markdown and the instruction', () => {
  const prompt = buildRevisePrompt('---\nbg: #000\n---\n# A', '把標題改成 Hello')
  assert.ok(prompt.includes('# A'))
  assert.ok(prompt.includes('把標題改成 Hello'))
})

test('revise: instructs preserving untouched pages and coordinate attrs', () => {
  const prompt = buildRevisePrompt('# A', 'x')
  assert.ok(prompt.includes('{x= y= w= s= c= b=}'))
})

test('revise: still forbids code fence and explanations', () => {
  const prompt = buildRevisePrompt('# A', 'x')
  assert.ok(prompt.includes('不要包在'))
  assert.ok(prompt.includes('不要加任何說明文字'))
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
