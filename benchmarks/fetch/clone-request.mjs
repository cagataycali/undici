import { bench, run } from 'mitata'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
require('../../index.js')
const { makeRequest, cloneRequest } = require('../../lib/web/fetch/request.js')
const { HeadersList } = require('../../lib/web/fetch/headers.js')

const headersList = new HeadersList()
headersList.append('accept', '*/*', true)
headersList.append('user-agent', 'undici', true)

const request = makeRequest({
  urlList: [new URL('https://example.com/get')],
  headersList,
  mode: 'cors',
  credentials: 'same-origin'
})

bench('cloneRequest(request) (null body)', () => cloneRequest(request))

await run()
