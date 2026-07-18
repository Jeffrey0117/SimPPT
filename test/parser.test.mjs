import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const match = html.match(/<script id="simppt-parser">([\s\S]*?)<\/script>/)
assert.ok(match, 'index.html must contain <script id="simppt-parser">')

const SimpptParser = new Function(`${match[1]}; return SimpptParser;`)()
const { parse, renderMarkdown, slideIndexAt, slideLineRange, blocksOf, stripAttrTail, IMG_RE } = SimpptParser

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

test('note: lines become speaker notes, hidden from render', () => {
  const deck = parse('# A\nnote: 記得講故事\nnote: 放慢')
  assert.equal(deck.slides[0].notes, '記得講故事\n放慢')
  const out = renderMarkdown(deck.slides[0].body)
  assert.equal(out, '<h1>A</h1><div class="note-block" hidden></div><div class="note-block" hidden></div>')
})

test('slides carry their raw index even after empty slides are dropped', () => {
  const deck = parse('# A\n\n---\n\n---\n\n# B')
  assert.equal(deck.slides[0].raw, 0)
  assert.equal(deck.slides[1].raw, 2)
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

test('image with {x= y= w=} renders absolutely positioned figure', () => {
  const out = renderMarkdown('![p](a.png){x=10 y=20.5 w=30}')
  assert.equal(out, '<figure class="img-abs" style="left:10%;top:20.5%;width:30%"><img src="a.png" alt="p"></figure>')
})

test('image w= without x/y stays in flow but applies width', () => {
  const out = renderMarkdown('![p](a.png){w=30}')
  assert.equal(out, '<figure><img src="a.png" alt="p" style="width:30vw"></figure>')
})

test('IMG_RE matches plain and attributed image lines', () => {
  assert.ok(IMG_RE.test('![a](b.png)'))
  assert.ok(IMG_RE.test('![a](b.png){x=1 y=2 w=3}'))
  assert.ok(!IMG_RE.test('text ![a](b.png)'))
})

test('slideLineRange returns raw line span of a slide', () => {
  const text = '---\nbg: red\n---\n# A\nline\n---\n# B'
  assert.deepEqual(slideLineRange(text, 0), { start: 3, end: 5 })
  assert.deepEqual(slideLineRange(text, 1), { start: 6, end: 7 })
  assert.equal(slideLineRange(text, 2), null)
})

test('ordered list starting at 2 keeps its number via start attr', () => {
  assert.equal(renderMarkdown('2. second point'), '<ol start="2"><li>second point</li></ol>')
  assert.equal(renderMarkdown('1. a\n\ntext\n\n2. b'), '<ol><li>a</li></ol><p>text</p><ol start="2"><li>b</li></ol>')
})

test('heading with {x= y= s=} renders absolutely positioned + scaled', () => {
  const out = renderMarkdown('# T {x=5 y=6 s=120}')
  assert.equal(out, '<h1 class="txt-abs" style="left:5%;top:6%;--ts:1.2">T</h1>')
})

test('s= alone scales a flow block without positioning', () => {
  assert.equal(renderMarkdown('# T {s=120}'), '<h1 style="--ts:1.2">T</h1>')
})

test('c= sets block text color', () => {
  assert.equal(renderMarkdown('hi {c=#ff0000}'), '<p style="color:#ff0000">hi</p>')
})

test('extra blank lines become vertical gap spacers', () => {
  assert.equal(renderMarkdown('a\n\nb'), '<p>a</p><p>b</p>')
  assert.equal(
    renderMarkdown('a\n\n\nb'),
    '<p>a</p><div class="gap" style="height:2.5vw"></div><p>b</p>',
  )
  assert.equal(
    renderMarkdown('a\n\n\n\n\nb'),
    '<p>a</p><div class="gap" style="height:7.5vw"></div><p>b</p>',
  )
})

test('inline {{text|attrs}} styles part of a sentence', () => {
  assert.equal(
    renderMarkdown('a {{big|s=200 c=#ff0000}} b'),
    '<p>a <span style="font-size:2em;color:#ff0000">big</span> b</p>',
  )
  assert.equal(
    renderMarkdown('# 你{{只}}需要 {{管|b=1}}'),
    '<h1>你只需要 <span style="font-weight:700">管</span></h1>',
  )
})

test('b=1 sets block bold', () => {
  assert.equal(renderMarkdown('hi {b=1}'), '<p style="font-weight:700">hi</p>')
})

test('paragraph with {x= y=} without s has no transform', () => {
  const out = renderMarkdown('hello world {x=10 y=50}')
  assert.equal(out, '<p class="txt-abs" style="left:10%;top:50%">hello world</p>')
})

test('list with attrs on first item positions the whole list', () => {
  const out = renderMarkdown('- one {x=8 y=9}\n- two')
  assert.equal(out, '<ul class="txt-abs" style="left:8%;top:9%"><li>one</li><li>two</li></ul>')
})

test('blocksOf reports type and start line of each block', () => {
  const blocks = blocksOf('# title\n\npara line\nmore\n\n- a\n- b\n\n![i](x.png)')
  assert.deepEqual(blocks.map((b) => [b.type, b.start]), [['h', 0], ['p', 2], ['ul', 5], ['img', 8]])
})

test('stripAttrTail splits trailing attr braces from a line', () => {
  assert.deepEqual(stripAttrTail('# T {x=1 y=2}'), { text: '# T', attrs: { x: '1', y: '2' } })
  assert.deepEqual(stripAttrTail('plain line'), { text: 'plain line', attrs: null })
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
