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

const { setSlideDirectives, insertSlideAfter } = SimpptParser

test('layout and countdown are page-only: "set" does not carry them to later slides', () => {
  const deck = parse('# A\n\n--- set bg=#fff layout=bullets countdown=30\n\n# B\n\n---\n\n# C')
  assert.deepEqual(deck.slides[1].meta, { bg: '#fff', layout: 'bullets', countdown: '30' })
  assert.deepEqual(deck.slides[2].meta, { bg: '#fff' })
})

test('a separator before any content sets up the first slide instead of adding a page', () => {
  const text = '---\nbg: #000\n---\n\n--- layout=section\n\n# A\n\n---\n\n# B'
  const deck = parse(text, { keepEmpty: true })
  assert.equal(deck.slides.length, 2)
  assert.deepEqual(deck.slides[0].meta, { layout: 'section' })
  assert.equal(deck.slides[0].raw, 0)
  assert.equal(deck.slides[0].body, '# A')
  assert.equal(slideIndexAt(text, text.indexOf('# A')), 0)
  assert.equal(slideIndexAt(text, text.indexOf('# B')), 1)
  const lines = text.split('\n')
  const first = slideLineRange(text, 0)
  assert.equal(lines.slice(first.start, first.end).join('\n').trim(), '# A')
  const second = slideLineRange(text, 1)
  assert.equal(lines.slice(second.start, second.end).join('\n').trim(), '# B')
})

test('a leading "set" separator still works as the starting defaults', () => {
  const deck = parse('--- set bg=#000\n\n# A\n\n---\n\n# B')
  assert.equal(deck.slides[0].meta.bg, '#000')
  assert.equal(deck.slides[1].meta.bg, '#000')
})

test('setSlideDirectives changes one slide and leaves the others alone', () => {
  const text = '# A\n\n--- bg=#fff\n\n# B\n\n---\n\n# C'
  const out = setSlideDirectives(text, 1, { layout: 'bullets' })
  assert.equal(out, '# A\n\n--- bg=#fff layout=bullets\n\n# B\n\n---\n\n# C')
  assert.equal(setSlideDirectives(out, 1, { layout: 'quote' }), '# A\n\n--- bg=#fff layout=quote\n\n# B\n\n---\n\n# C')
  assert.equal(setSlideDirectives(out, 1, { layout: null }), text)
  assert.equal(setSlideDirectives(text, 2, { layout: 'big' }), '# A\n\n--- bg=#fff\n\n# B\n\n--- layout=big\n\n# C')
  assert.equal(setSlideDirectives(text, 9, { layout: 'big' }), text)
})

test('setSlideDirectives keeps "set" and can add it', () => {
  const text = '# A\n\n--- set bg=#fff color=#111\n\n# B'
  assert.equal(setSlideDirectives(text, 1, { layout: 'top' }), '# A\n\n--- set bg=#fff color=#111 layout=top\n\n# B')
  assert.equal(
    setSlideDirectives('# A\n\n--- layout=top\n\n# B', 1, { bg: '#000', color: '#fff' }, { sticky: true }),
    '# A\n\n--- set layout=top bg=#000 color=#fff\n\n# B',
  )
})

test('setSlideDirectives on the first slide adds a line after the front matter', () => {
  const text = '---\nbg: #000\n---\n\n# A\n\n---\n\n# B'
  const out = setSlideDirectives(text, 0, { layout: 'section' })
  assert.equal(out, '---\nbg: #000\n---\n--- layout=section\n\n\n# A\n\n---\n\n# B')
  const deck = parse(out, { keepEmpty: true })
  assert.equal(deck.slides.length, 2)
  assert.equal(deck.slides[0].meta.layout, 'section')
  assert.equal(deck.slides[1].meta.layout, undefined)
  assert.deepEqual(deck.globals, { bg: '#000' })
  assert.equal(setSlideDirectives(out, 0, { layout: 'big' }).includes('--- layout=big'), true)
  assert.equal(parse(setSlideDirectives(out, 0, { layout: null }), { keepEmpty: true }).slides[0].meta.layout, undefined)
})

test('setSlideDirectives on the first slide of a deck without front matter', () => {
  const out = setSlideDirectives('# A\n\n---\n\n# B', 0, { layout: 'big' })
  const deck = parse(out, { keepEmpty: true })
  assert.equal(deck.slides.length, 2)
  assert.equal(deck.slides[0].meta.layout, 'big')
  assert.equal(deck.slides[0].body, '# A')
  assert.deepEqual(deck.globals, {})
  assert.equal(setSlideDirectives('# A', 0, { layout: null }), '# A')
})

test('insertSlideAfter adds a page after the given one and says where it is', () => {
  const text = '# A\n\n---\n\n# B\n'
  const mid = insertSlideAfter(text, 0, 'layout=bullets', '# New\n\n- one')
  assert.equal(mid.index, 1)
  const deck = parse(mid.text, { keepEmpty: true })
  assert.deepEqual(deck.slides.map((sl) => sl.body), ['# A', '# New\n\n- one', '# B'])
  assert.equal(deck.slides[1].meta.layout, 'bullets')
  const last = insertSlideAfter(text, 1, '', '# End')
  assert.equal(last.index, 2)
  assert.deepEqual(parse(last.text).slides.map((sl) => sl.body), ['# A', '# B', '# End'])
})

const { duplicateSlide, deleteSlide, moveSlide } = SimpptParser

// What each page looks like: first line of its body, background, layout.
// An unset background and the built-in default are the same thing on screen.
const looks = (text) => parse(text, { keepEmpty: true }).slides.map((sl) => [
  sl.body.split('\n')[0],
  !sl.meta.bg || sl.meta.bg === '#101014' ? 'default' : sl.meta.bg,
  sl.meta.layout || 'centre',
].join(' / '))

const FOUR = '# A\n\n--- set bg=#fff\n\n# B\n\n--- layout=bullets\n\n# C\n\n---\n\n# D\n'

test('duplicateSlide copies a page right after itself', () => {
  const out = duplicateSlide('# A\n\n---\n\n# B', 0)
  assert.equal(out.index, 1)
  assert.deepEqual(looks(out.text), ['# A / default / centre', '# A / default / centre', '# B / default / centre'])
})

test('duplicateSlide keeps the look of the copy and of the pages after it', () => {
  const out = duplicateSlide(FOUR, 2)
  assert.deepEqual(looks(out.text), [
    '# A / default / centre', '# B / #fff / centre',
    '# C / #fff / bullets', '# C / #fff / bullets', '# D / #fff / centre',
  ])
  const red = duplicateSlide('# A\n\n--- bg=#f00\n\n# B\n\n---\n\n# C', 1)
  assert.deepEqual(looks(red.text), ['# A / default / centre', '# B / #f00 / centre', '# B / #f00 / centre', '# C / default / centre'])
})

test('duplicateSlide of a page that starts a colour scheme does not restart it', () => {
  const out = duplicateSlide(FOUR, 1)
  assert.equal(out.text.split('set bg=#fff').length - 1, 1)
  assert.deepEqual(looks(out.text).slice(1, 3), ['# B / #fff / centre', '# B / #fff / centre'])
})

test('deleteSlide removes a page', () => {
  const out = deleteSlide(FOUR, 2)
  assert.equal(out.index, 2)
  assert.deepEqual(looks(out.text), ['# A / default / centre', '# B / #fff / centre', '# D / #fff / centre'])
  assert.equal(deleteSlide(FOUR, 3).index, 2)
})

test('deleteSlide of the page that starts a colour scheme hands the scheme to the next page', () => {
  const out = deleteSlide(FOUR, 1)
  assert.deepEqual(looks(out.text), ['# A / default / centre', '# C / #fff / bullets', '# D / #fff / centre'])
  assert.equal(out.text.split('bg=#fff').length - 1, 1)
})

test('deleteSlide of the first page keeps the front matter', () => {
  const out = deleteSlide('---\nbg: #000\n---\n\n# A\n\n--- layout=top\n\n# B', 0)
  const deck = parse(out.text, { keepEmpty: true })
  assert.deepEqual(deck.globals, { bg: '#000' })
  assert.equal(deck.slides.length, 1)
  assert.equal(deck.slides[0].body, '# B')
  assert.equal(deck.slides[0].meta.layout, 'top')
})

test('deleteSlide leaves a one-page deck alone', () => {
  assert.equal(deleteSlide('# only', 0).text, '# only')
  assert.equal(deleteSlide(FOUR, 9).text, FOUR)
})

test('moveSlide swaps a page with its neighbour and every page keeps its look', () => {
  const up = moveSlide(FOUR, 1, -1)
  assert.equal(up.index, 0)
  assert.deepEqual(looks(up.text), [
    '# B / #fff / centre', '# A / default / centre', '# C / #fff / bullets', '# D / #fff / centre',
  ])
  const down = moveSlide(FOUR, 2, 1)
  assert.equal(down.index, 3)
  assert.deepEqual(looks(down.text), [
    '# A / default / centre', '# B / #fff / centre', '# D / #fff / centre', '# C / #fff / bullets',
  ])
})

test('moveSlide falls back to the deck-wide colour, not the built-in one', () => {
  const text = '---\nbg: #222\n---\n\n# A\n\n--- set bg=#fff\n\n# B\n\n---\n\n# C'
  const out = moveSlide(text, 1, -1)
  const deck = parse(out.text, { keepEmpty: true })
  const shown = deck.slides.map((sl) => sl.body + ' ' + ({ ...deck.globals, ...sl.meta }).bg)
  assert.deepEqual(shown, ['# B #fff', '# A #222', '# C #fff'])
})

test('moving a page away and back leaves no leftover settings behind', () => {
  const there = moveSlide(FOUR, 1, -1)
  const back = moveSlide(there.text, 0, 1)
  assert.deepEqual(looks(back.text), looks(FOUR))
  assert.equal(back.text.includes('#101014'), false)
  assert.equal(back.text.split('bg=').length - 1, 1)
})

test('moveSlideTo drops a page anywhere and every page keeps its look', () => {
  const { moveSlideTo } = SimpptParser
  const toFront = moveSlideTo(FOUR, 3, 0)
  assert.equal(toFront.index, 0)
  assert.deepEqual(looks(toFront.text), [
    '# D / #fff / centre', '# A / default / centre', '# B / #fff / centre', '# C / #fff / bullets',
  ])
  const toEnd = moveSlideTo(FOUR, 0, 3)
  assert.equal(toEnd.index, 3)
  assert.deepEqual(looks(toEnd.text), [
    '# B / #fff / centre', '# C / #fff / bullets', '# D / #fff / centre', '# A / default / centre',
  ])
  assert.equal(moveSlideTo(FOUR, 2, 2).text, FOUR)
  assert.equal(moveSlideTo(FOUR, 2, 7).text, FOUR)
  assert.equal(moveSlideTo(FOUR, -1, 2).text, FOUR)
})

test('moveSlide at either end does nothing; untouched separators keep their exact text', () => {
  assert.equal(moveSlide(FOUR, 0, -1).text, FOUR)
  assert.equal(moveSlide(FOUR, 3, 1).text, FOUR)
  const spaced = '# A\n\n---   bg=#123    layout=top\n\n# B\n\n---\n\n# C\n\n---\n\n# D'
  assert.equal(moveSlide(spaced, 3, -1).text.includes('---   bg=#123    layout=top'), true)
})

test('continueList starts the next item when Enter is pressed at the end of one', () => {
  const { continueList } = SimpptParser
  assert.deepEqual(continueList('- one', 5), { text: '- one\n- ', pos: 8 })
  assert.deepEqual(continueList('# T\n\n* a\n\nafter', 8), { text: '# T\n\n* a\n* \n\nafter', pos: 11 })
  assert.deepEqual(continueList('1. first', 8), { text: '1. first\n2. ', pos: 12 })
  assert.deepEqual(continueList('9. nine', 7), { text: '9. nine\n10. ', pos: 12 })
})

test('continueList splits an item when Enter is pressed in the middle of it', () => {
  const { continueList } = SimpptParser
  assert.deepEqual(continueList('- onetwo', 5), { text: '- one\n- two', pos: 8 })
})

test('continueList ends the list when Enter is pressed on an empty item', () => {
  const { continueList } = SimpptParser
  assert.deepEqual(continueList('- one\n- ', 8), { text: '- one\n', pos: 6 })
  assert.deepEqual(continueList('1. a\n2. ', 8), { text: '1. a\n', pos: 5 })
})

test('continueList leaves everything else to the browser', () => {
  const { continueList } = SimpptParser
  assert.equal(continueList('plain text', 5), null)
  assert.equal(continueList('# heading', 9), null)
  assert.equal(continueList('--- layout=top', 14), null)
  assert.equal(continueList('- one', 1), null)
  assert.equal(continueList('', 0), null)
})

const { blockText, rewriteBlock } = SimpptParser
const BODY = ['# 你需要了解什麼? {x=5 y=10 s=120}', '', '第一行', '第二行', '', '- 什麼是 A?', '- 什麼是 B?', '', '3. 三', '4. 四', '', '![](a.png)']

test('blockText gives the editable words of a block, without markers or position settings', () => {
  const body = BODY.join('\n')
  assert.deepEqual(blockText(body, 0), { kind: 'h', text: '你需要了解什麼?' })
  assert.deepEqual(blockText(body, 1), { kind: 'p', text: '第一行\n第二行' })
  assert.deepEqual(blockText(body, 2), { kind: 'ul', text: '什麼是 A?\n什麼是 B?' })
  assert.deepEqual(blockText(body, 3), { kind: 'ol', text: '三\n四' })
  assert.equal(blockText(body, 4), null)
  assert.equal(blockText(body, 9), null)
})

test('rewriteBlock changes a heading and keeps its level and position', () => {
  const out = rewriteBlock(BODY, 0, '新的標題')
  assert.equal(out[0], '# 新的標題 {x=5 y=10 s=120}')
  assert.deepEqual(out.slice(1), BODY.slice(1))
  assert.equal(rewriteBlock(['## 小標'], 0, '改\n兩行')[0], '## 改 兩行')
})

test('rewriteBlock changes a paragraph, which may grow or shrink in lines', () => {
  assert.deepEqual(rewriteBlock(BODY, 1, '只剩一行').slice(0, 5), [BODY[0], '', '只剩一行', '', '- 什麼是 A?'])
  assert.deepEqual(rewriteBlock(['a {c=#f00}', 'b'], 0, 'x\ny\nz'), ['x {c=#f00}', 'y', 'z'])
})

test('rewriteBlock changes list items: one line each, markers and numbering kept', () => {
  const ul = rewriteBlock(BODY, 2, '甲\n\n乙\n丙')
  assert.deepEqual(ul.slice(5, 8), ['- 甲', '- 乙', '- 丙'])
  const ol = rewriteBlock(BODY, 3, '只有一個')
  assert.deepEqual(ol.slice(8, 10), ['3. 只有一個', ''])
  assert.deepEqual(rewriteBlock(['* a {s=90}', '* b'], 0, 'c'), ['* c {s=90}'])
})

test('rewriteBlock with no words left removes the block; non-text blocks are left alone', () => {
  assert.deepEqual(rewriteBlock(['# T', '', 'gone', '', 'stay'], 1, '  \n '), ['# T', '', '', 'stay'])
  assert.equal(rewriteBlock(BODY, 4, 'x'), null)
})

test('what blockText gives back, rewriteBlock writes back unchanged', () => {
  const body = BODY.join('\n')
  for (let k = 0; k < 4; k += 1) assert.deepEqual(rewriteBlock(BODY, k, blockText(body, k).text), BODY)
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
