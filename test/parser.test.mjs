import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const match = html.match(/<script id="simppt-parser">([\s\S]*?)<\/script>/)
assert.ok(match, 'index.html must contain <script id="simppt-parser">')

const SimpptParser = new Function(`${match[1]}; return SimpptParser;`)()
const { parse, renderMarkdown, slideIndexAt } = SimpptParser

const tests = []
const test = (name, fn) => tests.push({ name, fn })

test('frontmatter becomes globals, not a slide', () => {
  const deck = parse('---\nbg: #1a1a2e\ncolor: #fff\n---\n\n# Hello')
  assert.deepEqual(deck.globals, { bg: '#1a1a2e', color: '#fff' })
  assert.equal(deck.slides.length, 1)
  assert.equal(deck.slides[0].body, '# Hello')
})

test('no frontmatter: plain content is one slide with empty globals', () => {
  const deck = parse('# Only slide\ntext')
  assert.deepEqual(deck.globals, {})
  assert.equal(deck.slides.length, 1)
  assert.equal(deck.slides[0].body, '# Only slide\ntext')
})

test('leading --- without key:value lines is not frontmatter', () => {
  const deck = parse('---\nnot a kv line\n---\nsecond')
  assert.deepEqual(deck.globals, {})
  assert.equal(deck.slides.length, 2)
})

test('separator splits slides; same-line key=value become slide meta', () => {
  const deck = parse('# A\n\n--- bg=#0f3460 color=#eee\n\n# B')
  assert.equal(deck.slides.length, 2)
  assert.deepEqual(deck.slides[0].meta, {})
  assert.deepEqual(deck.slides[1].meta, { bg: '#0f3460', color: '#eee' })
  assert.equal(deck.slides[1].body, '# B')
})

test('four dashes is not a separator', () => {
  const deck = parse('# A\n----\n# still A')
  assert.equal(deck.slides.length, 1)
  assert.ok(deck.slides[0].body.includes('----'))
})

test('empty slides are dropped; meta-only slides are kept', () => {
  const deck = parse('# A\n\n---\n\n---\n\n--- bg=#000\n\n---\n\n# B')
  assert.equal(deck.slides.length, 3)
  assert.equal(deck.slides[0].body, '# A')
  assert.deepEqual(deck.slides[1].meta, { bg: '#000' })
  assert.equal(deck.slides[1].body, '')
  assert.equal(deck.slides[2].body, '# B')
})

test('CRLF input parses the same as LF', () => {
  const deck = parse('---\r\nbg: red\r\n---\r\n# A\r\n\r\n---\r\n# B\r\n')
  assert.deepEqual(deck.globals, { bg: 'red' })
  assert.equal(deck.slides.length, 2)
})

test('headings render to h1/h2/h3', () => {
  assert.equal(renderMarkdown('# Big'), '<h1>Big</h1>')
  assert.equal(renderMarkdown('## Mid'), '<h2>Mid</h2>')
  assert.equal(renderMarkdown('### Small'), '<h3>Small</h3>')
})

test('consecutive dash/star items group into one ul', () => {
  const out = renderMarkdown('- one\n- two\n* three')
  assert.equal(out, '<ul><li>one</li><li>two</li><li>three</li></ul>')
})

test('numbered items group into one ol', () => {
  const out = renderMarkdown('1. first\n2. second')
  assert.equal(out, '<ol><li>first</li><li>second</li></ol>')
})

test('standalone image line renders as figure, src goes through resolver', () => {
  const out = renderMarkdown('![pic](img/a.png)', (src) => `blob:fake-${src}`)
  assert.equal(out, '<figure><img src="blob:fake-img/a.png" alt="pic"></figure>')
})

test('inline bold, italic, code, link', () => {
  const out = renderMarkdown('mix **b** and *i* and `c` and [t](https://x.dev)')
  assert.ok(out.includes('<strong>b</strong>'))
  assert.ok(out.includes('<em>i</em>'))
  assert.ok(out.includes('<code>c</code>'))
  assert.ok(out.includes('<a href="https://x.dev">t</a>'))
})

test('html in content is escaped', () => {
  const out = renderMarkdown('<script>alert(1)</script>')
  assert.ok(!out.includes('<script>'))
  assert.ok(out.includes('&lt;script&gt;'))
})

test('adjacent text lines join into one paragraph, blank line splits', () => {
  const out = renderMarkdown('line one\nline two\n\nnext para')
  assert.equal(out, '<p>line one line two</p><p>next para</p>')
})

test('separator "set" makes directives sticky for later slides', () => {
  const deck = parse('# A\n\n--- set bg=#fff color=#111\n\n# B\n\n---\n\n# C')
  assert.deepEqual(deck.slides[0].meta, {})
  assert.deepEqual(deck.slides[1].meta, { bg: '#fff', color: '#111' })
  assert.deepEqual(deck.slides[2].meta, { bg: '#fff', color: '#111' })
})

test('non-sticky directive applies to its slide only, then falls back to set defaults', () => {
  const deck = parse('--- set bg=#000\n\n# A\n\n--- bg=#e94560\n\n# B\n\n---\n\n# C')
  assert.equal(deck.slides[0].meta.bg, '#000')
  assert.equal(deck.slides[1].meta.bg, '#e94560')
  assert.equal(deck.slides[2].meta.bg, '#000')
})

test('empty slides after a "set" are still dropped (inherited meta does not count)', () => {
  const deck = parse('--- set bg=#fff\n\n# A\n\n---\n\n---\n\n# B')
  assert.equal(deck.slides.length, 2)
  assert.equal(deck.slides[1].body, '# B')
  assert.equal(deck.slides[1].meta.bg, '#fff')
})

test('parse keepEmpty keeps empty slides (editor mode)', () => {
  const deck = parse('# A\n\n---\n\n---\n\n# B', { keepEmpty: true })
  assert.equal(deck.slides.length, 3)
  assert.equal(deck.slides[1].body, '')
})

test('slideIndexAt maps cursor offset to slide index', () => {
  const text = '---\nbg: red\n---\n# A\n\n---\n# B'
  assert.equal(slideIndexAt(text, 0), 0)
  assert.equal(slideIndexAt(text, text.indexOf('# A')), 0)
  assert.equal(slideIndexAt(text, text.indexOf('# B')), 1)
  assert.equal(slideIndexAt(text, text.length), 1)
})

test('slideIndexAt on the separator line itself belongs to the next slide', () => {
  const text = '# A\n---\n# B'
  assert.equal(slideIndexAt(text, text.indexOf('---')), 1)
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
