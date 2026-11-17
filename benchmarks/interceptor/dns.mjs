import { bench, group, run } from 'mitata'
import dns from '../../lib/interceptor/dns.js'

// Warm-cache dispatch through the dns interceptor over a stub dispatch, so the
// numbers cover only the interceptor's own work per request.
const lookup = (origin, opts, cb) => cb(null, [{ address: '127.0.0.1', family: 4, ttl: 1e9 }])
const dispatch = dns({ lookup, maxTTL: 1e9 })(() => true)
const handler = { onResponseError (controller, err) { throw err } }

const stringOrigin = { origin: 'http://example.com:3000', path: '/', method: 'GET', headers: { accept: '*/*' } }
const urlOrigin = { origin: new URL('http://example.com'), path: '/', method: 'GET', headers: { accept: '*/*' } }
const mixedCase = {
  origin: 'http://example.com:3000',
  path: '/',
  method: 'GET',
  headers: {
    Accept: '*/*',
    'User-Agent': 'undici',
    'Content-Type': 'application/json',
    'X-Request-Id': '1',
    Authorization: 'Bearer x',
    'Accept-Encoding': 'gzip',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  }
}

group('dns interceptor (cached records)', () => {
  bench('string origin', () => dispatch(stringOrigin, handler))
  bench('URL origin', () => dispatch(urlOrigin, handler))
  bench('string origin, 8 mixed-case headers', () => dispatch(mixedCase, handler))
})

await run()
