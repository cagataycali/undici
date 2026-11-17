> Owner review file — remove PR.md before opening the real PR.

# perf(fetch): avoid redundant object spreads when cloning requests

`cloneRequest()` built `makeRequest({ ...request, body: null })`, and `httpNetworkOrCacheFetch()` called
`cloneRequest({ ...request, body: null })` on the no-body-source path — two full copies of the ~40-field
request record before `makeRequest()` copied every field a third time. `makeRequest()` already reads each
field individually and never keeps a reference to its argument, so the request can be passed to it directly
and the body set afterwards. The fetch path now calls `makeRequest(request)` once.

## Benchmarks

Same-process A/B (base = origin/main `e2d3523b`; branch since rebased cleanly onto `3d170a33`, patch = this branch, plus an A/A control loading a second
copy of origin/main), 7 interleaved rounds × 200k ops, median [min–max]. Script: `work/p07/ab.cjs` (owner
workspace); `benchmarks/fetch/clone-request.mjs` (mitata) is added for the upstream PR.
Node v26.13.0, darwin arm64 (Apple Silicon, 15 cores), loadavg during run `5.60 8.65 8.32`.

| case | origin/main | A/A control | patched | change |
|---|---|---|---|---|
| `cloneRequest(request)` (null body) | 120.9 ns [115.4–121.9] | 121.9 ns (+0.9%) | 80.3 ns [79.2–83.6] | **−34%** |
| fetch null-body clone in `httpNetworkOrCacheFetch` | 188.5 ns [176.1–189.6] | 189.8 ns (+0.7%) | 87.3 ns [83.2–89.7] | **−54%** |
| `new Request(request)` (public API) | 2193 ns [1222–5069] | 2174 ns (−0.8%) | 2220 ns [1446–2756] | within noise |

Honest scope: this saves ~100 ns and two short-lived ~40-key objects per `fetch()`; on a full HTTP fetch that
is well under 1% of wall time. `new Request(request)` is dominated by other work, so no change is visible there.

## Tests

`npm run lint` (changed files) clean; `npm run test:fetch`: 523/523 fetch (after rebase), 28/28 webidl, 49/49 busboy pass.
WPT: not run locally (hosts setup needs sudo; upstream CI runs it).

Breaking changes: none — `makeRequest()` copies the same fields with the same defaults whether it receives the
request or a spread copy of it, and the body is set to the same value afterwards; no exports or types change.

Overlap: P10 (`perf/fetch-request-no-intermediate-record`) and P21 (`perf/fetch-request-skip-header-roundtrip`)
also edit `lib/web/fetch/request.js` (the `Request` constructor); this diff touches only `cloneRequest()` and is
independent of them, so at most a trivial rebase.

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.

## Re-verified (rotated load order)

Re-run 2026-11-17 after finding that in one process the last-loaded undici copy can run 20–30% slower whatever its code. A and A' are two separate extracted copies of base `3d170a33`, B is this branch. Each load order runs in its own process (3 orders × 2 processes, 9 alternating rounds × 200k ops, median ns/op), under the bench lock (loadavg 5.8). Node v26.13.0, darwin arm64. The gain holds in every order.

### cloneRequest(req)
| order | A (base) | A' (base copy) | B (patch) | A'/A | B/A |
|---|---|---|---|---|---|
| A,B,A2 | 130.1 | 140.4 | 91.5 | +7.9% | -29.7% |
| A,B,A2 | 163.5 | 163.3 | 106.0 | -0.1% | -35.1% |
| B,A2,A | 151.1 | 153.8 | 98.9 | +1.8% | -34.5% |
| B,A2,A | 161.1 | 154.9 | 105.7 | -3.8% | -34.4% |
| A2,A,B | 170.0 | 167.0 | 110.9 | -1.8% | -34.8% |
| A2,A,B | 171.2 | 168.6 | 111.4 | -1.5% | -34.9% |
| **geo-mean over orders** | | | | **+0.3%** | **-34.1%** vs mean(A,A') |

### null-body clone path
| order | A (base) | A' (base copy) | B (patch) | A'/A | B/A |
|---|---|---|---|---|---|
| A,B,A2 | 213.3 | 217.6 | 98.5 | +2.0% | -53.8% |
| A,B,A2 | 226.2 | 223.8 | 103.5 | -1.1% | -54.3% |
| B,A2,A | 225.4 | 211.6 | 98.9 | -6.1% | -56.1% |
| B,A2,A | 232.5 | 233.0 | 109.2 | +0.2% | -53.0% |
| A2,A,B | 227.1 | 227.6 | 106.1 | +0.2% | -53.3% |
| A2,A,B | 253.1 | 252.5 | 121.6 | -0.2% | -51.9% |
| **geo-mean over orders** | | | | **-0.9%** | **-53.6%** vs mean(A,A') |

