import { spawn } from 'node:child_process'

const TIMEOUT_MS = 120000

export const runClaudePrint = (prompt, opts = {}) => new Promise((resolve) => {
  const child = spawn('claude', ['-p'], { cwd: opts.cwd, shell: true })
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
