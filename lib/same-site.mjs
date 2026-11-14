// Is this request from one of the server's own pages (or a local program), not from some
// other website open in the user's browser?
//
// A page on another site can send requests to http://127.0.0.1:4646 from the user's browser.
// Two ways it gets there, two checks:
// - directly: the browser adds an Origin header naming that other site -> it must match Host.
// - by pointing its own domain at 127.0.0.1 (DNS rebinding): Origin and Host then agree, but
//   Host is not a local name. Without a token nothing else stands in the way, so a server
//   with no token only answers to local names.
const LOCAL_NAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

const hostName = (host) => String(host || '').toLowerCase().replace(/:\d+$/, '')

export const sameSite = (req, { hasToken }) => {
  const host = String(req.headers.host || '').toLowerCase()
  const origin = req.headers.origin
  if (origin) {
    let originHost
    try {
      originHost = new URL(origin).host.toLowerCase()
    } catch (err) {
      return false
    }
    if (originHost !== host) return false
  }
  return hasToken || LOCAL_NAMES.has(hostName(host))
}
