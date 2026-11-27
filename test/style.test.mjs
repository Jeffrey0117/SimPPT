import assert from 'node:assert/strict'
import { parseStyle, buildStylePrompt, buildLearnPrompt, DEFAULT_STYLE } from '../lib/style-spec.mjs'
import { applyStyle, cutPage, wordCount } from '../lib/style-apply.mjs'
import { SimpptParser } from '../lib/parser.mjs'

const tests = []
const test = (name, fn) => tests.push({ name, fn })

const STYLE = `# 幹話
主題: bg=#111 color=#eee accent=#fc3
每頁最多: 10
梗圖間隔: 2

## 頁型
- 開場: 置中 | 梗=困惑 | 一個問句
- 重點: 大字 | 一個數字
- 列點: 列點
- 反轉: 置中 | 梗=恍然大悟
- 總結: 標題在上 | 梗=不配

## 語氣
口語、短句
`

test('parseStyle reads the settings, the kinds and the free sections', () => {
  const style = parseStyle(STYLE)
  assert.equal(style.name, '幹話')
  assert.deepEqual(style.theme, { bg: '#111', color: '#eee', accent: '#fc3' })
  assert.equal(style.maxChars, 10)
  assert.equal(style.memeGap, 2)
  assert.deepEqual(style.kinds.map((k) => [k.name, k.layout, k.meme]), [
    ['開場', 'center', '困惑'], ['重點', 'big', null], ['列點', 'bullets', null], ['反轉', 'center', '恍然大悟'], ['總結', 'top', null],
  ])
  assert.equal(style.kinds[0].how, '一個問句')
  assert.deepEqual(style.notes, [{ title: '語氣', text: '口語、短句' }])
})

test('parseStyle takes full-width colons and English layout names', () => {
  const style = parseStyle('## 頁型\n- 開場：big｜梗＝傻眼')
  assert.deepEqual(style.kinds.map((k) => [k.name, k.layout, k.meme]), [['開場', 'big', '傻眼']])
})

test('the default style parses into something usable', () => {
  const style = parseStyle(DEFAULT_STYLE)
  assert.ok(style.kinds.length >= 5)
  assert.ok(style.kinds.some((k) => k.meme))
  assert.ok(style.theme.bg)
})

test('the prompt lists the kinds and says what the program does', () => {
  const prompt = buildStylePrompt('我的筆記', parseStyle(STYLE))
  assert.ok(prompt.includes('--- kind=頁型'))
  assert.ok(prompt.includes('- 開場（配梗）'))
  assert.ok(prompt.includes('每頁最多 10 個字'))
  assert.ok(prompt.includes('口語、短句'))
  assert.ok(prompt.endsWith('我的筆記'))
})

test('the learn prompt carries the decks, the name and the meme categories', () => {
  const prompt = buildLearnPrompt({ name: '杰式', decks: ['# A', '# B'], memeKinds: ['困惑', '崩潰'] })
  assert.ok(prompt.includes('# 杰式'))
  assert.ok(prompt.includes('=== 範本 2 ===\n# B'))
  assert.ok(prompt.includes('困惑、崩潰'))
})

test('wordCount: a Chinese character is one, an English word is one, markup is none', () => {
  assert.equal(wordCount('# 你好 world'), 3)
  assert.equal(wordCount('![](img/a.png)\n**重點** {s=120}\nnote: 不算\n梗: 也不算'), 2)
})

test('cutPage keeps a short page and cuts a long one, title on every part', () => {
  assert.equal(cutPage(['# 短', '一句'], 10).length, 1)
  const parts = cutPage(['# 標題', '- 一二三四五', '- 六七八九十', '- 甲乙丙丁戊'], 10)
  assert.equal(parts.length, 3)
  parts.forEach((part) => assert.equal(part[0], '# 標題'))
})

test('cutPage shares the items out evenly instead of leaving one alone', () => {
  const items = (n) => ['# 坑', ...Array.from({ length: n }, () => '- 一二三四五六')]
  const counts = (parts) => parts.map((p) => p.filter((l) => l.startsWith('- ')).length)
  assert.deepEqual(counts(cutPage(items(5), 16)), [3, 2])
  assert.deepEqual(counts(cutPage(items(3), 16)), [3])
  assert.deepEqual(counts(cutPage(items(6), 16)), [2, 2, 2])
})

const AI = `--- kind=開場
# 你知道嗎？
梗: 我也不知道

--- kind=重點 layout=top bg=#fff
# 87%
人不讀說明

--- kind=反轉
# 其實是你
梗: 原來是我

--- kind=反轉
# 再翻一次
梗: 又是我

--- kind=亂寫
# 不在表上`

const MEMES = { 困惑: ['/__memes/file/困惑/a.png'], 恍然大悟: ['/__memes/file/恍然大悟/b.png', '/__memes/file/恍然大悟/c.png'] }

test('applyStyle: colours, layouts, memes by the rules', () => {
  const out = applyStyle(AI, parseStyle(STYLE), { memes: MEMES, random: () => 0.5 })
  const { slides } = SimpptParser.parse(out)
  assert.equal(slides.length, 5)
  assert.ok(out.startsWith('---\nbg: #111\ncolor: #eee\naccent: #fc3\n---\n'))
  assert.equal(slides[0].meta.layout, 'split')
  assert.ok(slides[0].body.includes('/__memes/file/困惑/a.png'))
  assert.ok(slides[0].body.includes('**我也不知道**'))
  assert.equal(slides[1].meta.layout, 'big')
  assert.equal(slides[1].meta.bg, undefined)
  assert.ok(slides[2].body.includes('/__memes/file/恍然大悟/'))
  // two pages after the last meme is too soon only when the gap is not reached
  assert.ok(!slides[3].body.includes('/__memes/'))
  assert.ok(!slides[3].body.includes('梗'))
  assert.equal(slides[4].meta.kind, '亂寫')
})

test('applyStyle: no meme of that category means a normal page, the meme line dropped', () => {
  const out = applyStyle('--- kind=開場\n# 嗨\n梗: 欸', parseStyle(STYLE), { memes: {} })
  const { slides } = SimpptParser.parse(out)
  assert.equal(slides.length, 1)
  assert.equal(slides[0].meta.layout, undefined)
  assert.ok(!out.includes('梗'))
})

test('applyStyle: a long page is cut, a big page is never cut', () => {
  const style = parseStyle(STYLE)
  const long = applyStyle('--- kind=列點\n# 清單\n- 一二三四五\n- 六七八九十\n- 甲乙丙丁戊', style)
  assert.equal(SimpptParser.parse(long).slides.length, 3)
  const big = applyStyle('--- kind=重點\n# 一二三四五六七八九十\n甲乙丙丁戊己', style)
  assert.equal(SimpptParser.parse(big).slides.length, 1)
})

test('applyStyle: the AI\'s own frontmatter goes when the style has colours, stays when not', () => {
  const ai = '---\nbg: #000\n---\n--- kind=總結\n# 收'
  assert.ok(!applyStyle(ai, parseStyle(STYLE)).includes('#000'))
  assert.ok(applyStyle(ai, parseStyle('## 頁型\n- 總結: 標題在上')).includes('bg: #000'))
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
