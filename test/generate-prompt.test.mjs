import assert from 'node:assert/strict'
import { buildGeneratePrompt, buildRevisePrompt, buildInsertPrompt, stripFence } from '../lib/generate-prompt.mjs'

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

test('insert: carries the deck, where the pages go, and the request', () => {
  const prompt = buildInsertPrompt('# 開場\n\n---\n\n# 結尾', 1, '講番茄鐘，3 張以內')
  assert.ok(prompt.includes('# 開場'))
  assert.ok(prompt.includes('接在第 1 頁後面'))
  assert.ok(prompt.includes('講番茄鐘，3 張以內'))
  assert.ok(prompt.includes('layout=bullets'))
})

test('insert: page 0 means the very front', () => {
  assert.ok(buildInsertPrompt('# A', 0, 'x').includes('放在整份簡報的最前面'))
})

test('insert: asks for new pages only, no colours, no fence', () => {
  const prompt = buildInsertPrompt('# A', 1, 'x')
  assert.ok(prompt.includes('只輸出要新增的那幾頁'))
  assert.ok(prompt.includes('不要寫任何顏色設定'))
  assert.ok(prompt.includes('1 到 3 頁'))
  assert.ok(prompt.includes('不要包在'))
})

test('stripFence unwraps an answer that is one fence, and nothing else', () => {
  assert.equal(stripFence('```markdown\n# A\n\n---\n\n# B\n```'), '# A\n\n---\n\n# B')
  assert.equal(stripFence('```\n# A\n```\n'), '# A')
  assert.equal(stripFence('# A\n\n- x'), '# A\n\n- x')
})

test('stripFence leaves slides that contain code blocks alone', () => {
  const python = '```python\nprint(1)\n```'
  assert.equal(stripFence(python), python)
  const two = '```\na\n```\n\n---\n\n```\nb\n```'
  assert.equal(stripFence(two), two)
  const inside = '# 標題\n\n```\ncode\n```'
  assert.equal(stripFence(inside), inside)
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
