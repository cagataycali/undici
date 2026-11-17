> Owner review file — remove `PR.md` before opening the real PR.

# perf(fetch): skip building unused parsed response headers

`fetch()` never reads the `headers` object core `Request#onResponseStart` / `onRequestUpgrade` builds with
`parseHeaders()` (one latin1 decode per value plus an object that goes dictionary-mode past ~10 keys): it rebuilds its
`HeadersList` from `controller.rawHeaders`. fetch's internal dispatch handler now carries an internal symbol
(`kRawHeadersOnly`, `lib/core/symbols.js`, not exported); core `Request` skips `parseHeaders()` only when its *direct*
handler has that flag and a controller (hence `rawHeaders`) exists. Any interceptor/decorator wrapping the handler
(compose, cache, retry, redirect …) does not carry the flag, so it still receives parsed headers exactly as today.

Breaking changes: none — no public API, option, type or behaviour change; the symbol is internal, unflagged handlers
(every user handler and every interceptor) take the identical code path, and fetch's response headers are built from
the same raw headers as before.

## Benchmarks

Node v26.13.0, darwin arm64 (Apple Silicon MacBook Pro, 15 cores), every run through the machine bench lock,
loadavg 6.1–9.0 (other jobs running). Same-process A/B, 30 alternating rounds × 20k iterations, median.
Measured: `new Request()` + `onRequestStart` + `onResponseStart` with a handler doing fetch's header work
(HeadersList from `rawHeaders`, `location`/`content-encoding` lookups). base = origin/main, off = patched without
flag (A/A-style control: shows no cost for other handlers), on = patched with flag (= fetch).

| response headers | origin/main | patched, unflagged | patched, fetch | fetch gain |
|---|---|---|---|---|
| 5  | 880 / 960 / 891 ns    | 890 / 977 / 896 ns    | 493 / 553 / 504 ns    | −44% (≈0.4 µs) |
| 17 | 5047 / 4991 / 4889 ns | 4992 / 4947 / 4897 ns | 2568 / 2563 / 2541 ns | −48% (≈2.4 µs) |
| 29 | 9571 / 9557 / 9320 ns | 9595 / 9515 / 9315 ns | 4612 / 4614 / 4442 ns | −52% (≈4.9 µs) |

Unflagged vs origin/main: −1.8% … +1.1% (noise). End to end that is ~0.4/2.4/4.9 µs out of a ~50/65/80 µs local
`fetch()` + `text()` round trip, i.e. ≈1% / ≈3–4% / ≈6% expected. Full-fetch A/B on this loaded machine (A/A control
swung up to ±8%) could **not** resolve that difference either way, so the claim is the per-response saving above.
Scripts (not part of the diff): `work/p23/micro.js` (table), `work/p23/ab.js`, `work/p23/alt.sh` (end-to-end attempts).

## Tests

`npm run lint` clean. Identical pass/fail sets vs origin/main for `test/fetch/*.js` (477 pass on origin/main 3d170a33 rebase; the same 19
environment failures on both: GC flags / bundle build), `test/websocket/*.js` (170 pass; one baseline flake),
`test/interceptors/*.js` (512), `test/cache-interceptor/*.js` (87), `test/client*.js` (331), `test/request*.js` (49),
`test/http2*.js` (154). WPT: not run locally (hosts setup needs sudo; upstream CI runs it).

Risk: touches the core Request ↔ handler hand-off; maintainers may prefer a different opt-out shape (e.g. lazy parsing).

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.

## Re-verified (rotated load order)

Re-run 2026-11-17 after finding that in one process the last-loaded undici copy can run 20–30% slower whatever its code. A and A' are two separate extracted copies of base `3d170a33`, B is this branch with `kRawHeadersOnly` set (as fetch sets it). The case is the same `new Request` + `onRequestStart` + `onResponseStart` with fetch's header work. Each load order runs in its own process (3 orders × 2 processes, 9 alternating rounds × 20k ops, median ns/op), under the bench lock (loadavg 4.3). Node v26.13.0, darwin arm64. The isolated gain holds in every order (−43% to −52%). The full-fetch share (≈1–6%) is still not measured.

### 5 response headers
| order | A (base) | A' (base copy) | B (patch) | A'/A | B/A |
|---|---|---|---|---|---|
| A,B,A2 | 788.5 | 761.1 | 424.3 | -3.5% | -46.2% |
| A,B,A2 | 828.1 | 821.9 | 459.2 | -0.7% | -44.5% |
| B,A2,A | 824.6 | 800.4 | 432.3 | -2.9% | -47.6% |
| B,A2,A | 805.8 | 806.2 | 446.4 | +0.0% | -44.6% |
| A2,A,B | 928.8 | 919.4 | 525.0 | -1.0% | -43.5% |
| A2,A,B | 844.7 | 824.4 | 482.7 | -2.4% | -42.9% |
| **geo-mean over orders** | | | | **-1.8%** | **-44.4%** vs mean(A,A') |

### 17 response headers
| order | A (base) | A' (base copy) | B (patch) | A'/A | B/A |
|---|---|---|---|---|---|
| A,B,A2 | 4421.5 | 4404.5 | 2314.2 | -0.4% | -47.7% |
| A,B,A2 | 4313.8 | 4418.4 | 2283.2 | +2.4% | -47.1% |
| B,A2,A | 4570.1 | 4498.1 | 2317.2 | -1.6% | -49.3% |
| B,A2,A | 4367.9 | 4391.2 | 2307.2 | +0.5% | -47.2% |
| A2,A,B | 4590.8 | 4560.2 | 2445.4 | -0.7% | -46.7% |
| A2,A,B | 4698.0 | 4686.4 | 2590.4 | -0.2% | -44.9% |
| **geo-mean over orders** | | | | **+0.0%** | **-47.2%** vs mean(A,A') |

### 29 response headers
| order | A (base) | A' (base copy) | B (patch) | A'/A | B/A |
|---|---|---|---|---|---|
| A,B,A2 | 8360.2 | 8238.2 | 4031.4 | -1.5% | -51.8% |
| A,B,A2 | 8419.0 | 8489.9 | 4162.8 | +0.8% | -50.6% |
| B,A2,A | 8518.1 | 8435.8 | 4091.6 | -1.0% | -52.0% |
| B,A2,A | 8111.3 | 8164.4 | 3970.8 | +0.7% | -51.0% |
| A2,A,B | 8377.4 | 8362.7 | 4100.2 | -0.2% | -51.1% |
| A2,A,B | 9776.2 | 9668.6 | 4900.5 | -1.1% | -49.9% |
| **geo-mean over orders** | | | | **-0.4%** | **-51.0%** vs mean(A,A') |

