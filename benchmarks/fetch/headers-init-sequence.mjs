import { bench, group, run } from 'mitata'
import { Headers } from '../../lib/web/fetch/headers.js'

// new Headers(init) where init is a sequence<sequence<ByteString>>
// (an array of [name, value] pairs).
for (const length of [1, 8, 32]) {
  const init = Array.from({ length }, (_, i) => [`x-header-${i}`, `value-${i}`])

  group(`new Headers(array of ${length} pairs)`, () => {
    bench('new Headers(pairs)', () => new Headers(init))
  })
}

await run()
