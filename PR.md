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

## Re-verified (rotated load order)

Re-run 2026-11-17 after finding that in one process the last-loaded undici copy can run 20–30% slower whatever its code. A and A' are two separate extracted copies of base `e2d3523b`, B is this branch. Each load order runs in its own process (3 orders × 2 processes, 9 alternating rounds × 50k ops, median ns/op), under the bench lock (loadavg 5.9). Node v26.13.0, darwin arm64. Patched is faster in all 18 order/size runs. The gain matches the original −9–13%.

### new Headers(1 pairs)
| order | A (base) | A' (base copy) | B (patch) | A'/A | B/A |
|---|---|---|---|---|---|
| A,B,A2 | 187.7 | 187.2 | 166.3 | -0.3% | -11.4% |
| A,B,A2 | 212.9 | 202.8 | 186.0 | -4.7% | -12.6% |
| B,A2,A | 216.2 | 218.5 | 203.6 | +1.1% | -5.8% |
| B,A2,A | 197.7 | 200.5 | 182.1 | +1.4% | -7.9% |
| A2,A,B | 278.3 | 276.6 | 247.2 | -0.6% | -11.2% |
| A2,A,B | 221.6 | 225.3 | 199.8 | +1.7% | -9.8% |
| **geo-mean over orders** | | | | **-0.3%** | **-9.7%** vs mean(A,A') |

### new Headers(8 pairs)
| order | A (base) | A' (base copy) | B (patch) | A'/A | B/A |
|---|---|---|---|---|---|
| A,B,A2 | 1318.1 | 1296.6 | 1170.3 | -1.6% | -11.2% |
| A,B,A2 | 1267.1 | 1287.0 | 1164.5 | +1.6% | -8.1% |
| B,A2,A | 1487.7 | 1432.8 | 1327.3 | -3.7% | -10.8% |
| B,A2,A | 1268.8 | 1278.9 | 1172.9 | +0.8% | -7.6% |
| A2,A,B | 1650.6 | 1713.0 | 1439.8 | +3.8% | -12.8% |
| A2,A,B | 1337.5 | 1412.7 | 1206.2 | +5.6% | -9.8% |
| **geo-mean over orders** | | | | **+1.0%** | **-10.5%** vs mean(A,A') |

### new Headers(32 pairs)
| order | A (base) | A' (base copy) | B (patch) | A'/A | B/A |
|---|---|---|---|---|---|
| A,B,A2 | 5350.2 | 5310.7 | 4843.3 | -0.7% | -9.5% |
| A,B,A2 | 5071.9 | 5247.2 | 4721.7 | +3.5% | -6.9% |
| B,A2,A | 6749.8 | 6918.8 | 6294.2 | +2.5% | -6.8% |
| B,A2,A | 5043.7 | 5123.8 | 4675.3 | +1.6% | -7.3% |
| A2,A,B | 5062.3 | 5286.2 | 4617.6 | +4.4% | -8.8% |
| A2,A,B | 5224.1 | 5345.6 | 4791.9 | +2.3% | -8.3% |
| **geo-mean over orders** | | | | **+2.2%** | **-8.9%** vs mean(A,A') |

