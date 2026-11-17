import { bench, group, run } from 'mitata'
import { Headers } from '../../lib/web/fetch/headers.js'

// `new Headers(headers)` is the common way to clone a Headers object
// (proxies, middleware, `new Request(req, { headers: res.headers })`, ...).

const mixedCase8 = new Headers([
  ['Content-Type', 'application/json'],
  ['Accept', 'application/json, text/plain, */*'],
  ['Accept-Encoding', 'gzip, deflate, br'],
  ['Accept-Language', 'en-US,en;q=0.9'],
  ['Cache-Control', 'no-cache'],
  ['User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'],
  ['Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'],
  ['X-Request-Id', '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0']
])

const lowerCase16 = new Headers(
  Array.from({ length: 16 }, (_, i) => [`x-header-${i}`, `value-${i}-abcdefghijklmnop`])
)

const withCookies = new Headers([
  ['content-type', 'text/html; charset=utf-8'],
  ['cache-control', 'private, max-age=0'],
  ['set-cookie', 'a=1; Path=/; HttpOnly'],
  ['set-cookie', 'b=2; Path=/; Secure'],
  ['set-cookie', 'c=3; Path=/; SameSite=Lax'],
  ['vary', 'accept-encoding'],
  ['etag', '"33a64df551425fcc55e4d42a148795d9f25f89d4"'],
  ['date', 'Tue, 17 Nov 2026 15:00:00 GMT']
])

const empty = new Headers()

group('new Headers(headers)', () => {
  bench('empty', () => new Headers(empty))
  bench('8 headers (mixed case)', () => new Headers(mixedCase8))
  bench('16 headers (lowercase)', () => new Headers(lowerCase16))
  bench('8 headers (3 set-cookie)', () => new Headers(withCookies))
})

await run()
