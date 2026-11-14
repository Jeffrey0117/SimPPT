// The parser lives in index.html (the app is one file). Node code uses that same copy,
// lifted out of its <script> tag, so there is never a second parser to keep in step.
import fs from 'node:fs'

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const found = html.match(/<script id="simppt-parser">([\s\S]*?)<\/script>/)
if (!found) throw new Error('index.html has no <script id="simppt-parser">')

export const SimpptParser = new Function(`${found[1]}; return SimpptParser;`)()
