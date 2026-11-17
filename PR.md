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
