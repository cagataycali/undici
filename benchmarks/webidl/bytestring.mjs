import { bench, group, run } from 'mitata'
import { Headers } from '../../index.js'
import { webidl } from '../../lib/web/webidl/index.js'

const short = 'content-type'
const medium = 'application/json; charset=utf-8'
const long = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const latin1 = 'caf\u00e9 na\u00efve r\u00e9sum\u00e9 \u00ff'.repeat(4)

group('webidl.converters.ByteString', () => {
  bench('short (12)', () => webidl.converters.ByteString(short, 'p', 'a'))
  bench('medium (31)', () => webidl.converters.ByteString(medium, 'p', 'a'))
  bench(`long (${long.length})`, () => webidl.converters.ByteString(long, 'p', 'a'))
  bench(`latin1 (${latin1.length})`, () => webidl.converters.ByteString(latin1, 'p', 'a'))
})

group('Headers', () => {
  bench('append x8', () => {
    const h = new Headers()
    h.append('content-type', medium)
    h.append('user-agent', long)
    h.append('accept', '*/*')
    h.append('accept-encoding', 'gzip, deflate, br')
    h.append('accept-language', 'en-US,en;q=0.9')
    h.append('cache-control', 'no-cache')
    h.append('x-request-id', '6f1c2b0e-8a3d-4f5e-9b7a-1c2d3e4f5a6b')
    h.append('authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def')
    return h
  })
  const h = new Headers({ 'content-type': medium, 'user-agent': long })
  bench('get', () => h.get('user-agent'))
  bench('set', () => h.set('user-agent', long))
})

await run()
