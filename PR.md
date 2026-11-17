> **Owner review note:** this file is for review only and must be removed before opening the real PR.

# perf(webidl): cache dictionary member context strings per argument

`webidl.dictionaryConverter` built a `` `${argument}.${key}` `` template string for every present member on every
call (RequestInit, ResponseInit, CloseEventInit, Cookie, CacheQueryOptions, …), although the string only depends on
the argument name, which is the same on nearly every call. The converter now builds the array of context strings
once per argument value (re-built when a different argument is passed) and passes `contexts[i]` to each member
converter. The strings are value-identical, so error messages are byte-identical.

Breaking changes: none — internal to the closure; member converters receive the exact same context strings (a new
test pins them, including a re-entrant call with a different argument), no API/options/types/messages change.

## Benchmarks

Same-process A/B with an A/A control (`/tmp` harness, shown below): baseline `origin/main` lib (A), a byte-identical
copy of it (A', control), and this branch (B) are loaded in one process; 15 interleaved rounds × 200k ops, median
per impl. Each run rotates the module load order (A,A',B / B,A,A' / A',B,A) because the last-loaded copy of
`Response` is measurably slower regardless of code; a run's value is the geometric mean over the 3 orders.
3 runs per case, each process through `work/scripts/bench-lock.sh` (1-min loadavg 6.7–7.9).

| case | B vs A (run 1 / 2 / 3) | A/A control |
|---|---|---|
| `webidl.converters.RequestInit({ method, mode, redirect })` | −10.4% / −9.9% / −10.5% | +0.1 / −0.1 / +0.6% |
| `webidl.converters.ResponseInit({ status, statusText })` | −17.0% / −16.5% / −18.4% | +0.3 / +1.3 / −0.1% |
| `new Response(null, { status: 201 })` | −10.5% / −10.6% / −9.4% | +0.3 / −0.5 / +1.0% |
| `new Request(url, { method, mode })` | −3.7% / −1.9% / −0.9% (≈ −2%, within noise) | −0.9 / +0.4 / −0.0% |

(negative = less time = faster). Absolute: ResponseInit ≈ 108 → 90 ns, RequestInit ≈ 252 → 226 ns,
`new Response(null, init)` ≈ 208 → 188 ns.

Added `benchmarks/fetch/init-dictionaries.mjs` (mitata; no existing benchmark passes an init dictionary).
Separate-process runs of it (3× each, interleaved, same lock) agree in direction: RequestInit 373/274/267 → 261/185/258 ns,
ResponseInit 165/112/137 → 113/71/105 ns; process-to-process noise at loadavg ~8 is ±25%, so the A/B above is the
primary evidence.

Node v26.13.0, macOS darwin arm64, Apple M5 Pro (15 cores).

## Tests

`npm run lint` clean; `npm run test:unit` 1688 pass / 0 fail; `npm run test:fetch` 520 + webidl 29 + busboy 49 pass;
test/websocket 170, test/cookie 93, test/cache 5, test/eventsource 153 pass. New test in `test/webidl/converters.js`
pins the context strings (also passes on `origin/main`). Error messages compared byte-for-byte between `origin/main`
and this branch for RequestInit/ResponseInit/CloseEvent/Cookie/CacheQueryOptions failures: identical.
WPT: not run locally (hosts setup needs sudo; upstream CI runs it).

Overlap: other branches also edit `lib/web/webidl/index.js` (`perf/webidl-bytestring-regex-scan` P03,
`perf/webidl-sequence-array-fastpath` P09) in different functions; this diff is independent of them and based on
`origin/main` — they should merge without conflicts.

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.
