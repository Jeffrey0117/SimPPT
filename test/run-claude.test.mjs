import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { parseClaudeLine, runClaudeStream, streamAnswer, wantsStream } from '../lib/run-claude.mjs'

const tests = []
const test = (name, fn) => tests.push({ name, fn })

const delta = (text) => JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } })
const result = (text, isError = false) => JSON.stringify({ type: 'result', subtype: 'success', is_error: isError, result: text })

// A stand-in for the claude process: `play(child)` is called once the prompt has been handed over.
const fakeSpawn = (play) => {
  const seen = { killed: false, prompt: '', args: null }
  const spawnImpl = (command, args) => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => { seen.killed = true }
    child.stdin = { write: (text) => { seen.prompt += text }, end: () => setImmediate(() => play(child)) }
    seen.args = args
    return child
  }
  return { spawnImpl, seen }
}

test('parseClaudeLine: a piece of text, the final answer, and everything else', () => {
  assert.deepEqual(parseClaudeLine(delta('# Hi')), { text: '# Hi' })
  assert.deepEqual(parseClaudeLine(result('# Hi\n')), { result: '# Hi\n', failed: false })
  assert.equal(parseClaudeLine('{"type":"system","subtype":"init"}'), null)
  assert.equal(parseClaudeLine(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hm' } } })), null)
  assert.equal(parseClaudeLine('not json'), null)
  assert.equal(parseClaudeLine('null'), null)
})

test('runClaudeStream: pieces arrive in order, even when a line is cut in two, and the answer is the whole', async () => {
  const lines = `${delta('# One\n')}\n${delta('\n---\n\n# Two')}\n${result('# One\n\n---\n\n# Two')}\n`
  const { spawnImpl, seen } = fakeSpawn((child) => {
    child.stdout.emit('data', lines.slice(0, 37))
    child.stdout.emit('data', lines.slice(37))
    child.emit('close', 0)
  })
  const pieces = []
  const answer = await runClaudeStream('the prompt', { spawnImpl, onText: (text) => pieces.push(text) })
  assert.deepEqual(pieces, ['# One\n', '\n---\n\n# Two'])
  assert.deepEqual(answer, { ok: true, markdown: '# One\n\n---\n\n# Two' })
  assert.equal(seen.prompt, 'the prompt')
  assert.ok(seen.args.includes('stream-json') && seen.args.includes('--include-partial-messages'))
  // started bare, so the first word comes quickly: no tools, no MCP servers, the quick model
  assert.ok(seen.args.includes('--strict-mcp-config') && seen.args.join(' ').includes('--tools ""') && seen.args.join(' ').includes('--model sonnet'))
})

test('runClaudeStream: with no final line, what was written so far is the answer', async () => {
  const { spawnImpl } = fakeSpawn((child) => {
    child.stdout.emit('data', `${delta('# Only')}\n`)
    child.emit('close', 0)
  })
  assert.deepEqual(await runClaudeStream('p', { spawnImpl }), { ok: true, markdown: '# Only' })
})

test('runClaudeStream: a failed run and an empty one are errors', async () => {
  const failed = fakeSpawn((child) => {
    child.stderr.emit('data', 'not logged in\n')
    child.emit('close', 1)
  })
  assert.deepEqual(await runClaudeStream('p', { spawnImpl: failed.spawnImpl }), { ok: false, status: 500, message: 'not logged in' })
  const empty = fakeSpawn((child) => child.emit('close', 0))
  assert.equal((await runClaudeStream('p', { spawnImpl: empty.spawnImpl })).ok, false)
})

test('runClaudeStream: stopping it stops claude, and nothing more is handed over', async () => {
  const stopper = new AbortController()
  const pieces = []
  const { spawnImpl, seen } = fakeSpawn((child) => {
    child.stdout.emit('data', `${delta('# One')}\n`)
    stopper.abort()
    child.stdout.emit('data', `${delta('# Late')}\n`)
    child.emit('close', 0)
  })
  const answer = await runClaudeStream('p', { spawnImpl, signal: stopper.signal, onText: (text) => pieces.push(text) })
  assert.equal(answer.ok, false)
  assert.equal(answer.status, 499)
  assert.equal(seen.killed, true)
  assert.deepEqual(pieces, ['# One'])
})

test('streamAnswer: one JSON line per piece, then the finished answer, tidied', async () => {
  const sent = []
  const run = async (prompt, { onText }) => {
    onText('```md\n# A')
    onText('\n```')
    return { ok: true, markdown: '```md\n# A\n```' }
  }
  await streamAnswer('p', { send: (line) => sent.push(line), run, tidy: (text) => text.replace(/```(md)?/g, '').trim() })
  assert.ok(sent.every((line) => line.endsWith('\n')))
  assert.deepEqual(sent.map((line) => JSON.parse(line)), [
    { type: 'delta', text: '```md\n# A' },
    { type: 'delta', text: '\n```' },
    { type: 'done', ok: true, markdown: '# A' },
  ])
})

test('streamAnswer: a failure is the last line', async () => {
  const sent = []
  await streamAnswer('p', { send: (line) => sent.push(line), run: async () => ({ ok: false, status: 500, message: '壞了' }) })
  assert.deepEqual(sent.map((line) => JSON.parse(line)), [{ type: 'done', ok: false, message: '壞了' }])
})

test('wantsStream: only when the page says it can take pieces', () => {
  assert.equal(wantsStream('application/x-ndjson, application/json'), true)
  assert.equal(wantsStream('application/json'), false)
  assert.equal(wantsStream(undefined), false)
})

let failed = 0
for (const { name, fn } of tests) {
  try {
    await fn()
    console.log(`ok - ${name}`)
  } catch (err) {
    failed += 1
    console.log(`not ok - ${name}\n${err.stack}`)
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`)
if (failed) process.exit(1)
