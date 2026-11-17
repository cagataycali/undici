import { bench, group, run } from 'mitata'
import { Headers } from '../../lib/web/fetch/headers.js'
import { getCookies } from '../../lib/web/cookies/index.js'

// Real cookie headers arrive as fresh (non-internalized) strings on every
// request, so build distinct values at runtime and cycle through them.
// Constant literals would hit V8's String#split cache and skew the result.
const N = 1024
const id = (i) => (i * 2654435761 >>> 0).toString(36)

const single = []
const many = []
for (let i = 0; i < N; i++) {
  single.push(new Headers({ cookie: `session=${id(i)}` }))
  many.push(new Headers({
    cookie: `session=${id(i)}; theme=dark; lang=en-US; _ga=GA1.2.${id(i + 7)}.1700000000; csrf=${id(i + 3)}=x; flag`
  }))
}

let i = 0

group('getCookies', () => {
  bench('1 cookie', () => {
    return getCookies(single[i++ & (N - 1)])
  })
  bench('6 cookies', () => {
    return getCookies(many[i++ & (N - 1)])
  })
})

await run()
