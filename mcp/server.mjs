#!/usr/bin/env node
// SimPPT MCP server (stdio, no dependencies). It reads and writes the deck files directly,
// so the web server does not have to be running.
//   claude mcp add simppt -- node <repo>/mcp/server.mjs
// SIMPPT_ROOT = the folder that holds decks/ (default: this repo).
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { TOOLS, callTool } from './tools.mjs'

const ROOT = path.resolve(process.env.SIMPPT_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'))
// Protocol versions this server speaks; a client asking for another one is answered with the newest.
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
const refuse = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } })

const toolResult = (name, args) => {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(callTool(ROOT, name, args), null, 2) }] }
  } catch (err) {
    // A wrong page number or deck name is something the model can fix: tell it what went wrong.
    const text = err && err.code ? `${err.code}: ${err.message}` : 'internal error'
    return { content: [{ type: 'text', text }], isError: true }
  }
}

const METHODS = {
  initialize: (params) => ({
    protocolVersion: params && PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
    capabilities: { tools: {} },
    serverInfo: { name: 'simppt', version: '0.3.0' },
  }),
  ping: () => ({}),
  'tools/list': () => ({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }),
  'tools/call': (params) => toolResult(params && params.name, params && params.arguments),
}

const handle = (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch (err) {
    refuse(null, -32700, 'parse error')
    return
  }
  const hasId = message && message.id !== undefined && message.id !== null
  const method = message && typeof message.method === 'string' ? METHODS[message.method] : null
  // Notifications (no id) never get an answer.
  if (!hasId) return
  if (typeof message.method !== 'string') {
    refuse(message.id, -32600, 'invalid request')
    return
  }
  if (!method) {
    refuse(message.id, -32601, `method not found: ${message.method}`)
    return
  }
  reply(message.id, method(message.params))
}

readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  if (line.trim() !== '') handle(line)
})
