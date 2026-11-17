import { bench, group, run } from 'mitata'
import { parseVaryHeader, isInvalidOrWildcardVaryHeader } from '../../lib/util/cache.js'

const headers = {
  accept: 'text/html',
  'accept-encoding': 'gzip, br',
  'accept-language': 'en-US',
  origin: 'https://example.com'
}

const values = [
  'Accept-Encoding',
  'Accept-Encoding, Origin',
  'accept, accept-encoding , Accept-Language',
  ['Accept-Encoding', 'Origin'],
  '*'
]

group('vary', () => {
  bench('parseVaryHeader', () => {
    for (let i = 0; i < values.length; ++i) {
      parseVaryHeader(values[i], headers)
    }
  })
  bench('isInvalidOrWildcardVaryHeader', () => {
    for (let i = 0; i < values.length; ++i) {
      isInvalidOrWildcardVaryHeader(values[i])
    }
  })
})

await run()
