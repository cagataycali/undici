> Owner review file — remove `PR.md` before opening the real PR.

# perf(mock): look up matcher headers without copying the request headers

`getHeaderByName()` is called once per matcher header for every candidate interceptor. For plain-object
request headers it built a lower-cased copy of the whole object (`Object.entries` + `map` +
`Object.fromEntries`) just to read one key. It now lower-cases the key once and scans `Object.keys()`
from the end (same "last match wins" as `fromEntries`); on a miss it returns `({})[lowerKey]`, which is
exactly what the old lookup on the fresh object returned (e.g. `constructor`). The array branch now
lower-cases the key once instead of on every iteration. `toLocaleLowerCase()` is kept.

Breaking changes: none — same return value for every header shape (object, flat array, `Headers`/`.get()`), no API, option or type change; `MockAgent` matching results are identical.

## Benchmarks

Same-process A/B with an A/A control (two separate copies of `main` loaded side by side with the patched
tree), mitata, 3 locked runs (`work/scripts/bench-lock.sh`, loadavg at start 6.92 8.25 8.49), Node v26.13.0,
Apple Silicon Mac (darwin arm64, 15 cores). 8 request headers, 10 persistent interceptors each matching
`x-tenant` + `authorization`, request matches the last one.

| case | main (3 runs) | main A/A (3 runs) | patched (3 runs) | change |
|---|---|---|---|---|
| `getHeaderByName` object, 8 headers | 923 / 772 / 1110 ns | 1870 / 884 / 1080 ns | 61 / 44 / 42 ns | **~ −95%** |
| `getHeaderByName` array, 8 headers | 251 / 200 / 157 ns | 184 / 192 / 147 ns | 99 / 108 / 95 ns | **~ −45%** |
| `getMockDispatch`, 10 header interceptors | 9.71 / 12.06 / 10.61 µs | 8.39 / 12.00 / 11.40 µs | 1.45 / 2.37 / 2.20 µs | **~ −80%** |
| `MockAgent` + `request()`, 10 header interceptors | 10.45 / 18.95 / 15.17 µs | 10.45 / 18.67 / 14.33 µs | 4.22 / 5.58 / 4.95 µs | **~ −65%** (≈3×) |

The A/A rows stay within run-to-run noise of `main`; the patched rows are far outside it on every run.
No mock benchmark existed, so this adds `benchmarks/mock/header-lookup.mjs`
(`cd benchmarks && node mock/header-lookup.mjs`).

Equivalence: a seeded fuzz (400k comparisons) of `getHeaderByName` on `main` vs this branch over
object / array / `Headers` / `Map` shapes, mixed-case and duplicate names, `constructor`, `__proto__`,
`toString`, non-enumerable and inherited properties, null-prototype objects and non-ASCII names
(`İ`, `ß`, `Σ`/`ς`, `K`) — all identical, including thrown errors.

## Tests

`npx borp -p "test/mock-*.js"` — 349 pass, 0 fail (+1 new test pinning case-insensitive / last-wins /
inherited-key behaviour; it also passes on `main`). `npm run lint` clean.

Overlap: another branch (`perf/mock-dispatch-cache-normalized-path`) touches `getMockDispatch` path matching in
the same file; the hunks are independent of this one.

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.
