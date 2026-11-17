import { bench, group, run } from 'mitata'
import { tree } from '../../lib/core/tree.js'
import { wellknownHeaderNames } from '../../lib/core/constants.js'

const contentLength = Buffer.from('Content-Length')
const contentLengthUpperCase = Buffer.from('Content-Length'.toUpperCase())
const contentLengthLowerCase = Buffer.from('Content-Length'.toLowerCase())

group('tree.search', () => {
  bench('content-length', () => {
    tree.lookup(contentLengthLowerCase)
  })
  bench('CONTENT-LENGTH', () => {
    tree.lookup(contentLengthUpperCase)
  })
  bench('Content-Length', () => {
    tree.lookup(contentLength)
  })
})

const commonResponseHeaders = [
  'Date', 'Content-Type', 'Content-Length', 'Connection', 'Keep-Alive',
  'Cache-Control', 'ETag', 'Last-Modified', 'Server', 'Vary',
  'Transfer-Encoding', 'Content-Encoding', 'Set-Cookie', 'Age', 'Expires'
].map((name) => Buffer.from(name))

const allWellknownHeaderNames = wellknownHeaderNames.map((name) => Buffer.from(name))

group('tree.search (many keys)', () => {
  bench('common response headers', () => {
    for (let i = 0; i < commonResponseHeaders.length; ++i) {
      tree.lookup(commonResponseHeaders[i])
    }
  })
  bench('all well-known header names', () => {
    for (let i = 0; i < allWellknownHeaderNames.length; ++i) {
      tree.lookup(allWellknownHeaderNames[i])
    }
  })
})

await run()
