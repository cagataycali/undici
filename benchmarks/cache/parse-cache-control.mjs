import { bench, group, run } from 'mitata'
import { parseCacheControlHeader, parseVaryHeader } from '../../lib/util/cache.js'

const cacheControlValues = [
  'max-age=3600',
  'public, max-age=31536000, immutable',
  'private, no-cache, no-store, must-revalidate',
  'max-age=0, s-maxage=600, stale-while-revalidate=30',
  'no-cache="set-cookie, set-cookie2", max-age=60',
  ' public ,  max-age = 120 , stale-if-error=86400'
]

const varyValues = [
  'accept-encoding',
  'accept-encoding, accept , User-Agent',
  'Origin, Accept-Encoding, Accept-Language'
]

const requestHeaders = {
  'accept-encoding': 'gzip, br',
  accept: '*/*',
  'user-agent': 'undici',
  origin: 'https://example.com',
  'accept-language': 'en'
}

group('cache util', () => {
  bench('parseCacheControlHeader', () => {
    for (let i = 0; i < cacheControlValues.length; ++i) {
      parseCacheControlHeader(cacheControlValues[i])
    }
  })

  bench('parseVaryHeader', () => {
    for (let i = 0; i < varyValues.length; ++i) {
      parseVaryHeader(varyValues[i], requestHeaders)
    }
  })
})

await run()
