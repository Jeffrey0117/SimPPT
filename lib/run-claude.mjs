import { spawn } from 'node:child_process'

const TIMEOUT_MS = 120000

// Writing slides needs no tools and no thinking it over first, so claude is started bare: without
// the person's own tools and MCP servers, on the quick model, told not to think before answering.
// Measured 2026-11-26 on a 6KB note: first word after 1.7s instead of 9–14s, done in half the time.
// SIMPPT_AI_MODEL picks another model.
export const leanArgs = (env = process.env) => ['--model', env.SIMPPT_AI_MODEL || 'sonnet', '--strict-mcp-config', '--tools', '""']
const leanEnv = () => ({ ...process.env, MAX_THINKING_TOKENS: '0' })

export const runClaudePrint = (prompt, opts = {}) => new Promise((resolve) => {
  const child = spawn('claude', ['-p', ...leanArgs()], { cwd: opts.cwd, shell: true, env: leanEnv() })
  let stdout = ''
  let stderr = ''
  let settled = false

  const settle = (result) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolve(result)
  }

  const timer = setTimeout(() => {
    child.kill()
    settle({ ok: false, status: 504, message: '生成逾時（120 秒），請稍後再試' })
  }, TIMEOUT_MS)

  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })

  child.on('error', (err) => {
    const message = err.code === 'ENOENT'
      ? '找不到 claude 指令，請確認本機已安裝並登入 Claude Code CLI'
      : `啟動失敗：${err.message}`
    settle({ ok: false, status: 500, message })
  })

  child.on('close', (code) => {
    if (code !== 0) {
      const message = stderr.trim().split('\n').slice(0, 5).join('\n') || `claude 結束碼 ${code}`
      settle({ ok: false, status: 500, message })
      return
    }
    const markdown = stdout.trim()
    if (!markdown) {
      settle({ ok: false, status: 500, message: 'AI 沒有回傳內容' })
      return
    }
    settle({ ok: true, markdown })
  })

  child.stdin.write(prompt)
  child.stdin.end()
})

// --- The same, but handing over the text piece by piece while it is being written ---

// One line of `claude -p --output-format stream-json`: a piece of the answer, the whole answer
// at the end, or something we do not care about (null).
export const parseClaudeLine = (line) => {
  let event
  try {
    event = JSON.parse(line)
  } catch (err) {
    return null
  }
  if (!event || typeof event !== 'object') return null
  if (event.type === 'stream_event') {
    const delta = event.event && event.event.type === 'content_block_delta' ? event.event.delta : null
    return delta && delta.type === 'text_delta' && typeof delta.text === 'string' ? { text: delta.text } : null
  }
  if (event.type === 'result') {
    return { result: typeof event.result === 'string' ? event.result : '', failed: event.is_error === true }
  }
  return null
}

const STREAM_ARGS = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages']

// Resolves like runClaudePrint. `onText(piece)` is called as the answer grows; `signal` stops it
// (the person pressed stop, or went away). `spawnImpl` is there for tests.
export const runClaudeStream = (prompt, { cwd, onText = () => {}, signal, spawnImpl = spawn } = {}) => new Promise((resolve) => {
  const child = spawnImpl('claude', [...STREAM_ARGS, ...leanArgs()], { cwd, shell: true, env: leanEnv() })
  let pending = ''
  let written = ''
  let result = null
  let stderr = ''
  let settled = false

  const settle = (answer) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
    resolve(answer)
  }
  const stop = () => {
    try { child.kill() } catch (err) { /* already gone */ }
  }
  const onAbort = () => {
    stop()
    settle({ ok: false, status: 499, message: '已停止' })
  }
  const timer = setTimeout(() => {
    stop()
    settle({ ok: false, status: 504, message: '生成逾時（120 秒），請稍後再試' })
  }, TIMEOUT_MS)
  if (signal) {
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort)
  }

  const take = (line) => {
    const parsed = parseClaudeLine(line)
    if (!parsed) return
    if (typeof parsed.text === 'string') {
      written += parsed.text
      if (!settled) onText(parsed.text)
    } else {
      result = parsed
    }
  }

  child.stdout.on('data', (chunk) => {
    pending += chunk
    const lines = pending.split('\n')
    pending = lines.pop()
    lines.forEach(take)
  })
  child.stderr.on('data', (chunk) => { stderr += chunk })

  child.on('error', (err) => {
    const message = err.code === 'ENOENT'
      ? '找不到 claude 指令，請確認本機已安裝並登入 Claude Code CLI'
      : `啟動失敗：${err.message}`
    settle({ ok: false, status: 500, message })
  })

  child.on('close', (code) => {
    if (pending.trim()) take(pending)
    if (code !== 0 || (result && result.failed)) {
      const message = stderr.trim().split('\n').slice(0, 5).join('\n') || (result && result.result) || `claude 結束碼 ${code}`
      settle({ ok: false, status: 500, message })
      return
    }
    const markdown = ((result && result.result) || written).trim()
    settle(markdown ? { ok: true, markdown } : { ok: false, status: 500, message: 'AI 沒有回傳內容' })
  })

  child.stdin.write(prompt)
  child.stdin.end()
})

// What goes over the wire while it writes: one JSON object per line.
//   {"type":"delta","text":"…"}   a piece of the answer
//   {"type":"done","ok":true,"markdown":"…"}  or  {"type":"done","ok":false,"message":"…"}
// `tidy` is applied to the finished answer only. `send(line)` gets each line, newline included.
export const streamAnswer = async (prompt, { cwd, signal, send, tidy = (text) => text, run = runClaudeStream }) => {
  const line = (event) => send(`${JSON.stringify(event)}\n`)
  const answer = await run(prompt, { cwd, signal, onText: (text) => line({ type: 'delta', text }) })
  line(answer.ok ? { type: 'done', ok: true, markdown: tidy(answer.markdown) } : { type: 'done', ok: false, message: answer.message })
}

// Did the page ask for the answer piece by piece?
export const wantsStream = (acceptHeader) => /application\/x-ndjson/i.test(acceptHeader || '')
