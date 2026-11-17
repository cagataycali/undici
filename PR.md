> **Note:** this file is for owner review only and must be removed before opening the real PR.

# perf(websocket): unroll frame masking loop and avoid per-frame mask array

Every client→server WebSocket frame is masked byte by byte with `maskKey[i & 3]`, and
`generateMask()` allocates a 4-element array per frame. This change writes the 4 random mask
bytes straight into the frame header (`writeMask`) and XORs the payload with an unrolled
4-bytes-per-iteration loop using the mask held in locals (`applyMask`), plus a ≤3-byte tail.
Output bytes are identical (same random-pool consumption, same header layout, RFC 6455 §5.3 masking).
`generateMask` is kept unchanged and still exported (used by `benchmarks/websocket/generate-mask.mjs`).

## Benchmarks

Machine: MacBook Pro, Apple Silicon (darwin arm64, 15 cores) · Node v26.13.0 · baseline = `origin/main` e2d3523b.
Runs interleaved baseline/patched through a machine-wide benchmark lock.

**New micro-benchmark** `node benchmarks/websocket/create-frame.mjs` (mitata, added in this PR because no existing
bench isolates frame creation). 3 interleaved runs each, mean ± half-range:

| Payload | Function | baseline | patched | speed-up |
|---|---|---|---|---|
| 64 B | createFrame | 70 ns ±1 | 53 ns ±1 | 1.32× |
| 64 B | createFastTextFrame | 60 ns ±0 | 55 ns ±1 | 1.09× |
| 1 KiB | createFrame | 716 ns ±9 | 418 ns ±4 | 1.71× |
| 1 KiB | createFastTextFrame | 524 ns ±11 | 409 ns ±3 | 1.28× |
| 16 KiB | createFrame | 11.51 µs ±0.38 | 6.16 µs ±0.06 | 1.87× |
| 16 KiB | createFastTextFrame | 7.94 µs ±0.02 | 5.88 µs ±0.05 | 1.35× |
| 64 KiB | createFrame | 44.93 µs ±0.43 | 22.91 µs ±0.04 | 1.96× |
| 64 KiB | createFastTextFrame | 31.75 µs ±0.51 | 18.38 µs ±0.09 | 1.73× |

**End-to-end** `node benchmarks/websocket-benchmark.mjs` (256 KiB echo round trips, 9 interleaved runs each;
median msgs/s). The bundled `websocket-echo-server.mjs` (uWebSockets.js) failed to load on Node 26 locally
(package missing `index.js`), so a minimal single-threaded `ws` echo server on :8080 was used for both arms.
The machine was shared (load avg ~7), so treat these as indicative:

| Case | baseline | patched | median ratio |
|---|---|---|---|
| undici [binary] | 2385 /s (sd 186) | 3522 /s (sd 763) | 1.48× |
| undici [string] | 2671 /s (sd 165) | 3296 /s (sd 849) | 1.23× |
| undici - stream [binary] | 2471 /s (sd 189) | 3496 /s (sd 664) | 1.41× |
| undici - stream [string] | 2408 /s (sd 220) | 3374 /s (sd 504) | 1.40× |

## Tests

- `npx borp -p "test/websocket/**/*.js"`: 178/178 pass; `npm run lint` clean.
- New test in `test/websocket/frame.js`: round-trips (unmasks) `createFrame` and `createFastTextFrame` output for
  payload lengths 0–9, 125–127, 1023, 65535, 65536, 65539 (every remainder mod 4 and every header-size boundary).
  It passes on both baseline and patched code.
- An extra exhaustive local check (lengths 0–299, 1000–1003, 64 KiB boundaries, 100003) was byte-for-byte correct.
- WPT `/websockets` could not run locally (needs `/etc/hosts` entries via sudo); please rely on CI for WPT.

Breaking changes: none. Internal change to `lib/web/websocket/frame.js` only: same exports (incl. `generateMask`),
same frame bytes, same random-pool usage, no API, option, type or dependency change.

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.
