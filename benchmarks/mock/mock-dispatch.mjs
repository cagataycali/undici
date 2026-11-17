import { bench, group, run } from 'mitata'
import { MockAgent, request } from '../../index.js'
import { getHeaderByName } from '../../lib/mock/mock-utils.js'

const objectHeaders = {
  Host: 'localhost',
  'User-Agent': 'undici',
  Accept: 'application/json',
  'Accept-Encoding': 'gzip, deflate',
  'Content-Type': 'application/json',
  Authorization: 'Bearer token',
  'X-Request-Id': '1234',
  'X-Tenant': 'acme'
}
const arrayHeaders = Object.entries(objectHeaders).flat()

group('getHeaderByName', () => {
  bench('object, 8 headers', () => getHeaderByName(objectHeaders, 'x-tenant'))
  bench('array, 8 headers', () => getHeaderByName(arrayHeaders, 'x-tenant'))
})

const N = 10
const mockAgent = new MockAgent()
mockAgent.disableNetConnect()
const pool = mockAgent.get('http://localhost')
for (let i = 0; i < N; i++) {
  pool.intercept({
    path: '/',
    method: 'GET',
    headers: { 'x-tenant': `tenant-${i}`, authorization: 'Bearer token' }
  }).reply(200, 'ok').persist()
}

group(`MockAgent request() with ${N} header-matched interceptors`, () => {
  bench('object headers', async () => {
    const { body } = await request('http://localhost/', {
      dispatcher: mockAgent,
      headers: { ...objectHeaders, 'X-Tenant': `tenant-${N - 1}` }
    })
    await body.dump()
  })
})

await run()
