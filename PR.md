> **Owner review file — delete `PR.md` before opening the real PR.**

# perf(fetch): copy the header list directly in `new Headers(headers)`

`new Headers(existingHeaders)` is the usual way to clone headers (proxies, middleware, `new Headers(res.headers)`).
Today it builds an `entriesList` array of `[name, value]` pairs and then `fill()` normalizes, validates, lowercases
and re-appends every pair, rebuilding the map entry by entry. This patch adds a fast path: when `init` is a real
(non-Proxy) `Headers` whose `@@iterator` is the original `entries`, one pass over its header list checks that `fill()`
would store every entry unchanged (valid lowercase-stored name, already-normalized valid value, cookies included)
and copies the entries into a new map at the same time. If any entry would be changed or rejected
(e.g. response headers from the network with trailing whitespace, or entries added by an interceptor), it returns
`null` and the existing path runs, so results and errors stay exactly the same.
Update: when an entry would be changed or rejected (e.g. a response header with trailing whitespace, which llhttp
keeps), the entries already copied are kept (they are exactly what `fill()` would have appended, in the same order) and
only the remaining entries go through `appendHeader`, so such a list is still faster than `main` instead of paying for
the fast path and then the full slow path (worst case was 1.6× slower before this change).
`Symbol.iterator` is still read exactly once (the `HeadersInit` conversion now takes the already-read iterator).

## Benchmarks

New micro-benchmark `benchmarks/fetch/headers-copy.mjs` (mitata; no existing benchmark times `new Headers(headers)`).
Command: `node benchmarks/fetch/headers-copy.mjs` in a baseline worktree (origin/main e2d3523b) and in this branch,
interleaved base/patch × 4 runs each, all through a machine-wide benchmark lock. Mean ns/iter (min–max of the 4 run means).
Node v26.13.0, macOS, Apple M5 Pro (15 cores; other work running, so absolute numbers are noisy, ratios are stable).

| case | main | this branch | speedup |
|---|---|---|---|
| empty | 42 (37–47) | 42 (38–48) | 1.00× |
| 8 headers (mixed case) | 933 (865–989) | 489 (441–556) | **1.91×** |
| 16 headers (lowercase) | 1685 (1410–1860) | 931 (815–1120) | **1.81×** |
| 8 headers (3 set-cookie) | 689 (562–871) | 344 (309–407) | **2.00×** |

A cross-check that loads both versions in the same process and runs them in one mitata session
(less exposed to machine drift) gave 1.79× (8 mixed-case), 1.30× (16 lowercase), 1.75× (set-cookie), 1.07× (empty).

## Tests

- `npx borp --timeout 180000 --expose-gc --concurrency 1 -p "test/fetch/*.js"`: 526/526 pass.
- New tests in `test/fetch/headers.js` cover the copy (names, order, combined values, cookies, independence of copy
  and source, immutable source, overridden iterator) and show that entries added internally without normalization
  are still normalized or rejected. They pass on both `main` and this branch.
- WPT: the full runner could not start its server on this machine (it needs `/etc/hosts` entries). The 12
  `fetch/api/headers/*.any.js` files were run through a minimal testharness/vm harness on main and on this branch: the 273 subtest
  results were identical.
- A differential script (20 source shapes: Proxy, subclass, `Object.create(Headers.prototype)`, overridden iterator, cached
  sort, whitespace/NUL/non-Latin-1 values, upper-case map keys, invalid names, deleted set-cookie, …) gives byte-identical
  header lists and errors on main and on this branch. Fuzzing the value check against `headerValueNormalize`+`isValidHeaderValue`
  (500k strings) and the name check against `isValidHeaderName` found 0 mismatches.
- `npm run lint` is clean.

Breaking changes: none. The fast path only runs when `fill()` would store every entry unchanged, and it copies exactly
those entries; in every other case the existing code runs, so the API, results, errors, header casing and order are unchanged.

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.
