> **Owner review note:** this file is for review only and must be removed before opening the real PR.

# perf(webidl): index loop for sequence<T> conversion of plain arrays

`webidl.sequenceConverter` always walked its input with the iterator protocol, so
`new Headers([[k, v], ...])` allocated an iterator plus one `{ done, value }` result
object for the outer array **and** for every inner `[name, value]` pair. When the value is a
plain, non-Proxy `Array` whose `@@iterator` is the built-in `Array.prototype[Symbol.iterator]`
and `%ArrayIteratorPrototype%.next` is untouched, it now uses an index loop instead. That loop does
the same observable operations as the built-in iterator: read `length`, then read the index,
re-reading `length` on every step. `HeadersInit` now passes the `@@iterator` method it has already
read, instead of a `bind()`-ed thunk, so the property is still read only once.
Every other input (Proxies, Sets, generators, subclasses with a custom iterator, a patched
`Array.prototype[Symbol.iterator]` or array-iterator `next`) keeps the existing iterator path.

## Benchmarks

New micro-benchmark `benchmarks/fetch/headers-init-sequence.mjs` (mitata, `new Headers(arrayOfPairs)`).
The existing `benchmarks/fetch/headers.mjs` only covers iterating a Headers object, not
constructing one. Because the machine was under load from other jobs, the headline numbers come from an
in-process A/B: baseline (`origin/main` e2d3523b) and patched `Headers` loaded side by side in
the same mitata group, 10 separate runs.

| init | baseline mean (min–max) | patched mean (min–max) | median paired Δ |
|---|---|---|---|
| 1 pair   | 259 ns (222–330)    | 232 ns (189–323)    | **−10.5%** |
| 8 pairs  | 1.66 µs (1.36–2.32) | 1.43 µs (1.13–1.68) | **−12.7%** |
| 32 pairs | 6.66 µs (5.45–8.11) | 6.10 µs (4.79–7.55) | **−8.9%**  |

Patched was faster in 29 of 30 paired measurements. Node v26.13.0, Apple M5 Pro (darwin arm64).
`cd benchmarks && node fetch/headers-init-sequence.mjs`. Separate-process interleaved runs of the same file
point the same way but are noisier (load average 8–11).

## Tests

- `npm run lint`: clean.
- `npm run test:unit`: 1688 pass, 0 fail.
- `test/webidl/**`: 28/28. `test/fetch/headers*.js`: 70/70. `test/websocket/**`: 178/178. `test/cache/**`: 5/5. `test/cookie/**`: 93/93.
- `test/fetch/**`: 474 pass, 19 fail. The same 19 fail on unmodified `origin/main` on this machine (environment: gc flags, bundle, max-header-size).
- WPT `fetch/api/headers/*.any.js` (9 server-less files, run with testharness.js in-process): results are identical to `origin/main`, test by test. The full WPT server could not start on this machine.
- A behaviour probe compared `origin/main` and patched on 22 edge cases with identical output: holes, `Array.prototype[0]`, index getters, arrays growing or shrinking during conversion, own/prototype `@@iterator` overrides, patched array-iterator `next`, Array subclass, traced Proxy (same trap order), typed array, Set, record, non-callable/null `@@iterator`, bad pairs, non-ByteString values.

## Breaking changes: none

Internal only: no public API, option, type or error change, and the fast path only runs when array iteration is
the unmodified built-in, where an index loop is observably equivalent.
The only theoretical difference: if user code inside an element's `toString()` replaces
`%ArrayIteratorPrototype%.next` *mid-conversion*, the fast path no longer picks up the new `next`. That matches the
spec, which reads `next` once (IteratorRecord). Also, `Function.prototype.bind` is no longer called.

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.
