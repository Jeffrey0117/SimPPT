// Reading and writing deck files on disk for server.js.
// The server's static root is the repo root, so every path is checked here.
import fs from 'node:fs'
import path from 'node:path'

// What counts as a deck file. .simppt is a deck's own extension; the content is the same markdown.
export const DECK_RE = /\.(md|markdown|simppt)$/i
const DECKS_DIR = 'decks'

const fail = (code, message) => Object.assign(new Error(message), { code })

// The path as the disk really has it. Windows answers to short names too (".git" is also
// "GIT~1"), and a link can point anywhere, so the spelling we were handed proves nothing.
// For a file that does not exist yet, the nearest folder that does is resolved instead.
const realPath = (full) => {
  const missing = []
  let at = full
  while (!fs.existsSync(at)) {
    const up = path.dirname(at)
    if (up === at) return null
    missing.unshift(path.basename(at))
    at = up
  }
  return path.join(fs.realpathSync.native(at), ...missing)
}

// Is `full` a file inside `root` that we are willing to serve or write — judged by where it
// really is on disk? No dot-files or dot-folders (.git, .env), no NTFS streams ("a.md:x").
export const insideRoot = (root, full) => {
  if (full.slice(path.parse(full).root.length).includes(':')) return false
  let realRoot
  let real
  try {
    realRoot = fs.realpathSync.native(root)
    real = realPath(full)
  } catch (err) {
    return false
  }
  if (!real || !real.startsWith(realRoot + path.sep)) return false
  return !path.relative(realRoot, real).split(path.sep).some((seg) => seg.startsWith('.'))
}

// The absolute path for a deck, or null when the path is not one we will touch.
export const resolveDeckPath = (root, rel) => {
  if (typeof rel !== 'string' || !rel) return null
  if (rel.split(/[\\/]/).some((seg) => seg.startsWith('.'))) return null
  const full = path.resolve(root, rel)
  if (!full.startsWith(root + path.sep) || !DECK_RE.test(full)) return null
  return insideRoot(root, full) ? full : null
}

const toRel = (root, full) => path.relative(root, full).split(path.sep).join('/')

const LOCKED = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_TRIES = 5
const RENAME_PAUSE_MS = 40
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

// Line endings aside, is this the same text?
const unix = (text) => text.replace(/\r\n?/g, '\n')
const sameText = (a, b) => unix(a) === unix(b)

// Replace a file without ever leaving it half written: write next to it, then rename over it.
const replaceFile = (full, text) => {
  const tmp = `${full}.tmp`
  try {
    fs.writeFileSync(tmp, text, 'utf8')
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    throw err
  }
  // Windows refuses the rename while another program (antivirus, an editor) holds the file.
  // That usually passes in a moment, so try a few times before giving up on the rename.
  for (let attempt = 0; attempt < RENAME_TRIES; attempt += 1) {
    try {
      fs.renameSync(tmp, full)
      return
    } catch (err) {
      if (!LOCKED.has(err.code)) {
        fs.rmSync(tmp, { force: true })
        throw err
      }
      pause(RENAME_PAUSE_MS)
    }
  }
  // Still locked: write in place. The temp copy stays until that has worked,
  // so a complete copy of the text is on disk the whole time.
  fs.writeFileSync(full, text, 'utf8')
  fs.rmSync(tmp, { force: true })
}

// Write a deck. With `create`, an existing file is never touched (code EEXIST).
// With `expect` (the text the editor last saw in the file), a file that someone else
// has changed since is not overwritten (code ECHANGED).
// The file is read back before returning, so a returned result means the text is on disk.
export const writeDeck = (root, rel, text, { create = false, expect } = {}) => {
  const full = resolveDeckPath(root, rel)
  if (!full || typeof text !== 'string') throw fail('EFORBIDDEN', 'not a deck path')
  fs.mkdirSync(path.dirname(full), { recursive: true })
  if (create) {
    try {
      fs.writeFileSync(full, text, { encoding: 'utf8', flag: 'wx' })
    } catch (err) {
      if (err.code === 'EEXIST') throw fail('EEXIST', 'a deck with this name already exists')
      throw err
    }
  } else {
    if (typeof expect === 'string' && fs.existsSync(full) && !sameText(fs.readFileSync(full, 'utf8'), expect)) {
      throw fail('ECHANGED', 'the file was changed by something else')
    }
    replaceFile(full, text)
  }
  if (fs.readFileSync(full, 'utf8') !== text) throw fail('EVERIFY', 'the file on disk does not match')
  return { path: toRel(root, full), bytes: Buffer.byteLength(text, 'utf8') }
}

// Markdown files directly inside decks/, newest first.
export const listDecks = (root) => {
  const dir = path.join(root, DECKS_DIR)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && DECK_RE.test(entry.name) && !entry.name.startsWith('.'))
    .map((entry) => {
      const stat = fs.statSync(path.join(dir, entry.name))
      return { path: `${DECKS_DIR}/${entry.name}`, name: entry.name, mtime: stat.mtimeMs, size: stat.size }
    })
    .sort((a, b) => b.mtime - a.mtime)
}
