import { bench, run } from 'mitata'
import { Request } from '../../lib/web/fetch/request.js'
import { Response } from '../../lib/web/fetch/response.js'
import { webidl } from '../../lib/web/webidl/index.js'

const input = 'https://example.com/post'

bench('webidl.converters.RequestInit({ method, mode, redirect })', () =>
  webidl.converters.RequestInit({ method: 'POST', mode: 'cors', redirect: 'follow' }))
bench('webidl.converters.ResponseInit({ status, statusText })', () =>
  webidl.converters.ResponseInit({ status: 201, statusText: 'Created' }))
bench('new Request(input, { method, mode })', () =>
  new Request(input, { method: 'POST', mode: 'cors' }))
bench('new Response(null, { status })', () =>
  new Response(null, { status: 201 }))

await run()
