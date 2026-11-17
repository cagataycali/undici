> **Note:** this file is for owner review only and must be removed before opening the real PR.

# perf(websocket): faster client frame masking

Every client→server WebSocket frame is masked byte by byte with `maskKey[i & 3]`, and `generateMask()`
allocates a 4-element array per frame. This PR:

1. writes the 4 random mask bytes straight into the frame header (`writeMask`) and XORs short payloads
   (< 256 B) with an unrolled 4-bytes-per-iteration loop with the mask in locals (`applyMask`);
2. for payloads ≥ 256 B (`applyMaskWords`), copies the payload into the frame with `TypedArray#set` (skipped
   when masking in place) and XORs the 4-byte-aligned middle as 32-bit words with the mask rotated to the
   aligned start. The mask word is built through a `Uint8Array(4)`/`Uint32Array` pair over the same memory,
   so it is in native byte order on every platform (no endianness branch).

Output bytes are identical (same random-pool consumption, same header layout, RFC 6455 §5.3 masking).
`generateMask` is kept unchanged and still exported (used by `benchmarks/websocket/generate-mask.mjs`).

## Benchmarks

Machine: MacBook Pro, Apple Silicon (darwin arm64, 15 cores). Baseline = `origin/main` 3d170a33.
All runs through a machine-wide benchmark lock (loadavg at start 3.26 3.72 3.96).

**Node matrix** — every variant in its OWN process (avoids same-process load-order bias), order rotated over
3 rounds; median (min–max) of per-process medians of 5×80 ms samples. Harness: a stand-alone timing loop over
`WebsocketFrameSend#createFrame(BINARY)` and `WebsocketFrameSend.createFastTextFrame` (same calls as the new
`benchmarks/websocket/create-frame.mjs`). "unrolled only" = first commit of this PR without the 32-bit path.

### v22.23.5
| payload | fn | main (3d170a33) | unrolled only (acaaf2fc) | branch (59cdf98e) | speed-up vs main |
|---|---|---|---|---|---|
| 64 B | createFrame | 81 ns (75–81) | 57 ns (54–57) | 54 ns (52–55) | 1.48× |
| 64 B | createFastTextFrame | 80 ns (77–86) | 50 ns (48–51) | 51 ns (48–51) | 1.55× |
| 256 B | createFrame | 221 ns (210–222) | 123 ns (117–125) | 117 ns (117–118) | 1.89× |
| 256 B | createFastTextFrame | 190 ns (183–194) | 103 ns (98–103) | 84 ns (82–85) | 2.25× |
| 1 KiB | createFrame | 763 ns (737–786) | 400 ns (381–403) | 210 ns (202–217) | 3.63× |
| 1 KiB | createFastTextFrame | 619 ns (601–622) | 302 ns (291–304) | 156 ns (155–161) | 3.96× |
| 16 KiB | createFrame | 11.56 µs (11.23–11.76) | 5.74 µs (5.49–5.75) | 1.88 µs (1.77–1.89) | 6.14× |
| 16 KiB | createFastTextFrame | 9.24 µs (8.92–9.30) | 4.25 µs (4.07–4.28) | 1.58 µs (1.47–1.67) | 5.86× |
| 64 KiB | createFrame | 45.55 µs (45.55–48.81) | 22.35 µs (21.21–22.63) | 7.31 µs (6.81–7.42) | 6.23× |
| 64 KiB | createFastTextFrame | 36.59 µs (35.43–36.72) | 16.79 µs (16.15–16.89) | 6.08 µs (5.81–6.40) | 6.02× |
| 256 KiB | createFrame | 182.11 µs (180.22–194.89) | 88.64 µs (85.00–88.70) | 28.62 µs (27.00–30.25) | 6.36× |
| 256 KiB | createFastTextFrame | 147.13 µs (142.12–147.31) | 67.19 µs (65.06–68.70) | 24.14 µs (22.86–24.93) | 6.10× |

### v24.22.3
| payload | fn | main (3d170a33) | unrolled only (acaaf2fc) | branch (59cdf98e) | speed-up vs main |
|---|---|---|---|---|---|
| 64 B | createFrame | 70 ns (66–71) | 54 ns (54–56) | 54 ns (54–55) | 1.30× |
| 64 B | createFastTextFrame | 57 ns (54–58) | 59 ns (58–67) | 60 ns (58–60) | 0.95× |
| 256 B | createFrame | 215 ns (206–215) | 131 ns (126–141) | 108 ns (106–109) | 2.00× |
| 256 B | createFastTextFrame | 188 ns (180–190) | 132 ns (130–138) | 78 ns (75–79) | 2.40× |
| 1 KiB | createFrame | 722 ns (719–732) | 416 ns (402–429) | 176 ns (171–177) | 4.10× |
| 1 KiB | createFastTextFrame | 620 ns (596–620) | 419 ns (399–424) | 134 ns (129–136) | 4.64× |
| 16 KiB | createFrame | 11.31 µs (10.88–11.46) | 6.34 µs (6.08–6.45) | 1.83 µs (1.78–1.84) | 6.16× |
| 16 KiB | createFastTextFrame | 9.29 µs (9.01–9.33) | 5.92 µs (5.92–6.01) | 1.33 µs (1.33–1.33) | 7.00× |
| 64 KiB | createFrame | 44.53 µs (43.65–45.58) | 22.99 µs (21.72–23.25) | 6.90 µs (6.56–7.24) | 6.45× |
| 64 KiB | createFastTextFrame | 36.99 µs (35.77–37.02) | 16.99 µs (16.71–17.34) | 5.12 µs (5.00–5.35) | 7.22× |
| 256 KiB | createFrame | 177.33 µs (175.36–178.30) | 88.99 µs (85.01–90.22) | 26.38 µs (24.48–26.66) | 6.72× |
| 256 KiB | createFastTextFrame | 147.42 µs (144.57–147.93) | 67.17 µs (64.06–67.38) | 21.17 µs (19.66–21.25) | 6.96× |

### v26.13.0
| payload | fn | main (3d170a33) | unrolled only (acaaf2fc) | branch (59cdf98e) | speed-up vs main |
|---|---|---|---|---|---|
| 64 B | createFrame | 74 ns (67–81) | 53 ns (51–54) | 53 ns (52–53) | 1.40× |
| 64 B | createFastTextFrame | 71 ns (55–73) | 61 ns (59–64) | 61 ns (60–62) | 1.17× |
| 256 B | createFrame | 227 ns (202–228) | 132 ns (125–132) | 107 ns (104–107) | 2.13× |
| 256 B | createFastTextFrame | 163 ns (155–171) | 133 ns (133–134) | 79 ns (77–80) | 2.05× |
| 1 KiB | createFrame | 726 ns (698–782) | 424 ns (408–424) | 176 ns (168–177) | 4.12× |
| 1 KiB | createFastTextFrame | 536 ns (518–547) | 422 ns (405–426) | 135 ns (133–137) | 3.97× |
| 16 KiB | createFrame | 11.35 µs (11.05–11.63) | 6.52 µs (6.09–6.55) | 1.81 µs (1.75–1.83) | 6.28× |
| 16 KiB | createFastTextFrame | 7.80 µs (7.68–8.12) | 6.08 µs (5.99–6.10) | 1.35 µs (1.29–1.41) | 5.79× |
| 64 KiB | createFrame | 44.41 µs (44.36–45.28) | 24.58 µs (23.60–24.84) | 6.90 µs (6.63–7.23) | 6.44× |
| 64 KiB | createFastTextFrame | 31.41 µs (31.24–31.42) | 24.00 µs (22.33–24.28) | 5.19 µs (4.92–5.41) | 6.06× |
| 256 KiB | createFrame | 176.32 µs (170.04–178.28) | 88.93 µs (84.07–89.42) | 27.70 µs (25.67–28.28) | 6.36× |
| 256 KiB | createFastTextFrame | 124.62 µs (121.78–126.03) | 67.11 µs (62.98–67.17) | 21.47 µs (20.13–22.74) | 5.80× |

64 B text on Node 24/26 shows 0.95–1.17× here; with ONE function × ONE size per process (5 rotated rounds) it is
neutral, so it is not a regression of this PR:
| node | bench | main | branch | hyb2 | main/branch | main/hyb2 |
|---|---|---|---|---|---|---|
| v22.23.5 | text64 | 85.4 (72.0–89.5) | 59.9 (50.7–63.4) | 59.4 (50.8–79.9) | 1.43x | 1.44x |
| v22.23.5 | bin64 | 92.1 (80.5–96.7) | 67.3 (57.4–68.1) | 64.2 (55.4–76.5) | 1.37x | 1.43x |
| v24.22.3 | text64 | 64.4 (55.5–65.2) | 66.0 (57.6–66.1) | 65.0 (57.7–67.2) | 0.98x | 0.99x |
| v24.22.3 | bin64 | 76.6 (69.4–79.5) | 56.7 (56.0–64.5) | 64.5 (55.9–65.3) | 1.35x | 1.19x |
| v26.13.0 | text64 | 58.0 (57.2–66.6) | 58.8 (58.5–66.4) | 58.0 (57.8–66.4) | 0.99x | 1.00x |
| v26.13.0 | bin64 | 72.5 (64.3–76.0) | 55.5 (53.5–64.3) | 54.2 (53.2–61.8) | 1.31x | 1.34x |

**End-to-end (first commit only, re-run pending)** `node benchmarks/websocket-benchmark.mjs` (256 KiB echo round trips, 9 interleaved runs each;
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

- `npx borp -p "test/websocket/**/*.js"`: 180/180 pass; `npm run lint` clean.
- New tests in `test/websocket/frame.js`, both unmask the output and compare with the input:
  - every payload-length remainder mod 4 and every header-size boundary (0–9, 125–127, 1023, 65535, 65536, 65539);
  - long payloads (255–260, 1021, 4096, 65537) at all 4 source byte alignments, both functions, and that
    `createFrame` does not modify its source. Breaking the alignment handling makes this test fail.
  Both pass on baseline and patched code.
- Extra local check (lengths 0–299 + 64 KiB/256 KiB boundaries × 4 alignments, 1228 cases, both functions) is
  byte-for-byte correct on Node 22.23.5, 24.22.3 and 26.13.0.
- WPT `/websockets` could not run locally (needs `/etc/hosts` entries via sudo); please rely on CI for WPT.

Breaking changes: none. Internal change to `lib/web/websocket/frame.js` only: same exports (incl. `generateMask`),
same frame bytes, same random-pool usage, no API, option, type or dependency change; works on Node ≥ 22.19 (tested 22/24/26).

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.
