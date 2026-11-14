import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER = fileURLToPath(new URL('../mcp/server.mjs', import.meta.url))
const DECK = ['# 一', '', '---', '', '# 二'].join('\n')

const tests = []
const test = (name, fn) => tests.push({ name, fn })

// Start the server on a scratch folder, send the lines, collect one answer per request id.
const talk = (requests) => new Promise((resolve, reject) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'simppt-mcp-'))
  fs.mkdirSync(path.join(root, 'decks'))
  fs.writeFileSync(path.join(root, 'decks', '演講.simppt'), DECK, 'utf8')
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, SIMPPT_ROOT: root } })
  let out = ''
  child.stdout.on('data', (chunk) => { out += chunk })
  child.on('error', reject)
  child.on('close', () => {
    const answers = out.split('\n').filter(Boolean).map((line) => JSON.parse(line))
    resolve({ answers, file: fs.readFileSync(path.join(root, 'decks', '演講.simppt'), 'utf8') })
  })
  for (const request of requests) child.stdin.write(`${typeof request === 'string' ? request : JSON.stringify(request)}\n`)
  child.stdin.end()
})

const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })
const textOf = (answer) => answer.result.content[0].text

test('initialize answers with the tools capability and echoes the protocol version', async () => {
  const { answers } = await talk([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'ping' },
  ])
  assert.equal(answers.length, 2)
  assert.equal(answers[0].result.protocolVersion, '2025-06-18')
  assert.deepEqual(answers[0].result.capabilities, { tools: {} })
  assert.deepEqual(answers[1], { jsonrpc: '2.0', id: 2, result: {} })
})

test('tools/list offers the seven tools, each with a schema', async () => {
  const { answers } = await talk([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }])
  const tools = answers[0].result.tools
  assert.deepEqual(tools.map((t) => t.name), [
    'list_decks', 'get_outline', 'read_slides', 'insert_slides', 'replace_slide', 'delete_slide', 'move_slide',
  ])
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object')
    assert.ok(tool.description.length > 20)
    assert.equal(tool.run, undefined)
  }
})

test('a session: outline, insert, read back — and the file on disk has the new page', async () => {
  const { answers, file } = await talk([
    call(1, 'get_outline', { deck: '演講' }),
    call(2, 'insert_slides', { deck: '演講', after: 1, markdown: '--- layout=big\n\n# 87%\n\n說明' }),
    call(3, 'read_slides', { deck: '演講', from: 2 }),
  ])
  assert.equal(JSON.parse(textOf(answers[0])).pages, 2)
  const inserted = JSON.parse(textOf(answers[1]))
  assert.deepEqual([inserted.deck, inserted.pages], ['decks/演講.simppt', [2]])
  assert.equal(JSON.parse(textOf(answers[2])).version, inserted.version)
  assert.equal(JSON.parse(textOf(answers[2])).slides[0].markdown, '--- layout=big\n\n# 87%\n\n說明')
  assert.ok(file.includes('# 87%'))
  assert.ok(file.indexOf('# 一') < file.indexOf('# 87%') && file.indexOf('# 87%') < file.indexOf('# 二'))
})

test('a mistake comes back as a tool error the model can read, and the file is untouched', async () => {
  const { answers, file } = await talk([
    call(1, 'insert_slides', { deck: '演講', after: 9, markdown: '# x' }),
    call(2, 'get_outline', { deck: '沒有這份' }),
    call(3, 'no_such_tool', {}),
  ])
  assert.equal(answers[0].result.isError, true)
  assert.ok(textOf(answers[0]).startsWith('ENOPAGE'))
  assert.ok(textOf(answers[1]).startsWith('ENODECK'))
  assert.ok(textOf(answers[2]).startsWith('ENOTOOL'))
  assert.equal(file, DECK)
})

test('a protocol version the server does not speak is answered with one it does', async () => {
  const { answers } = await talk([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2099-01-01' } },
    { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
  ])
  assert.equal(answers[0].result.protocolVersion, '2025-06-18')
  assert.equal(answers[1].result.protocolVersion, '2024-11-05')
})

test('a write with a stale version is refused; other markdown in the project is not a deck', async () => {
  const { answers, file } = await talk([
    call(1, 'get_outline', { deck: '演講' }),
    call(2, 'delete_slide', { deck: '演講', page: 1, version: '000000000000' }),
    call(3, 'replace_slide', { deck: 'README.md', page: 1, markdown: '# x' }),
    call(4, 'replace_slide', { deck: '../outside.md', page: 1, markdown: '# x' }),
    { jsonrpc: '2.0', id: 5 },
  ])
  assert.match(JSON.parse(textOf(answers[0])).version, /^[0-9a-f]{12}$/)
  assert.ok(textOf(answers[1]).startsWith('ECHANGED'))
  assert.ok(textOf(answers[2]).startsWith('ENODECK'))
  assert.ok(textOf(answers[3]).startsWith('ENODECK'))
  assert.equal(answers[4].error.code, -32600)
  assert.equal(file, DECK)
})

test('unknown methods and broken lines get JSON-RPC errors, and the server keeps going', async () => {
  const { answers } = await talk([
    'this is not json',
    { jsonrpc: '2.0', id: 1, method: 'resources/list' },
    { jsonrpc: '2.0', id: 2, method: 'ping' },
  ])
  assert.equal(answers[0].error.code, -32700)
  assert.equal(answers[1].error.code, -32601)
  assert.deepEqual(answers[2].result, {})
})

let failed = 0
for (const { name, fn } of tests) {
  try {
    await fn()
    process.stdout.write(`ok - ${name}\n`)
  } catch (err) {
    failed += 1
    process.stdout.write(`FAIL - ${name}\n${err.stack}\n`)
  }
}
process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`)
process.exit(failed === 0 ? 0 : 1)
