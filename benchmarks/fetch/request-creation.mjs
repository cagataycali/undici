import { bench, run } from 'mitata'
import { Request } from '../../lib/web/fetch/request.js'

const input = 'https://example.com/post'

bench('new Request(input)', () => new Request(input, undefined))

const headers = {
  accept: 'application/json',
  'accept-encoding': 'gzip, deflate, br',
  'accept-language': 'en-US,en;q=0.9',
  authorization: 'Bearer abcdefghijklmnopqrstuvwxyz',
  'cache-control': 'no-cache',
  'content-type': 'application/json',
  'user-agent': 'undici-benchmark',
  'x-request-id': '0123456789abcdef'
}
const request = new Request(input, { method: 'POST', headers })

bench('new Request(request, { method })', () => new Request(request, { method: 'PUT' }))
bench('new Request(input, { method })', () => new Request(input, { method: 'PUT' }))

await run()
