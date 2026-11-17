> Owner-review note: remove this PR.md before opening the real PR.

# perf(mock): cache normalized interceptor paths in getMockDispatch

`getMockDispatch()` runs on every request handled by a MockAgent/MockPool/MockClient. For each one it walked
**all** registered interceptors with two `.filter` passes and, for every interceptor, re-normalised its path with
`safeUrl()` (`split` + `URLSearchParams` + `sort` + `toString` + `join`, plus `removeTrailingSlash` when
`ignoreTrailingSlash` is set). Test suites that register tens to hundreds of interceptors pay that URL work O(n)
times per request.

This change does the "not consumed" + path checks in one loop and caches each interceptor's normalised path in a
module-level `WeakMap` keyed by the dispatch object. The cache entry stores the path string it was computed from and
is recomputed if `path` changes; RegExp/function path matchers are never cached and are called exactly as before.
A WeakMap (not a property/Symbol) keeps the dispatch objects untouched, so `pendingInterceptors()`, call history and
error output are unchanged. The method/body/headers filters and every `MockNotMatchedError` message are unchanged.

Breaking changes: none — internal caching only; same matching order, same results, same error messages, no API/option changes, no new properties on dispatch objects.

## Benchmarks

New micro-benchmark `benchmarks/mock/mock-dispatch.mjs` (no existing benchmark covers mock dispatch matching).
The numbers below come from a same-process A/B + A/A harness (mitata 1.0.34): `base` = `lib/mock/mock-utils.js`
from origin/main, `patched` and `patchedAA` = two separately loaded copies of the patched file (A/A control).
Interceptors use query paths `/api/items/<i>?b=2&a=1&page=<i>`, `persist: true`; the request matches the last one.
3 runs, run through the machine bench lock; loadavg at start `{ 7.78 8.23 8.44 }`. Node v26.13.0, macOS, Apple Silicon (arm64, 15 cores).

| interceptors | base (avg, 3 runs) | patched (avg, 3 runs) | speed-up | A/A patched vs patchedAA |
|---:|---:|---:|---:|---:|
| 1   | 0.76 – 1.45 µs | 417 – 741 ns   | 1.6 – 2.1× | ≤ 1.09× |
| 10  | 3.88 – 6.38 µs | 511 – 828 ns   | 7.6 – 8.7× | ≤ 1.06× |
| 50  | 18.2 – 29.4 µs | 0.92 – 1.37 µs | 20 – 25×   | ≤ 1.17× |
| 200 | 79.2 – 93.9 µs | 2.66 – 3.76 µs | 27 – 33×   | ≤ 1.10× |

Run the micro-benchmark: `cd benchmarks && node mock/mock-dispatch.mjs`

## Tests

`npx borp -p "test/mock-*.js"`: 349 pass, 0 fail. `npm run lint` clean. Added 3 tests in `test/mock-utils.js` (path changed
after a lookup is re-normalised; toggling `ignoreTrailingSlash` on the same query path; consumed interceptors are skipped
and no own properties are added to the dispatch object). They pass on both origin/main and this branch.

Overlap: `perf/mock-header-lookup-no-fromentries` (P34) also edits `lib/mock/mock-utils.js` (`getHeaderByName`); the two
branches touch different functions and merge cleanly (checked with `git merge-tree`).

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.
