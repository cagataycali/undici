> Owner review note: remove this PR.md before opening the real PR.

# perf(webidl): fast-path ByteString validation with a regex scan

`webidl.converters.ByteString` runs on every `Headers` append/set/get/has/delete name and value (and on every
entry of a headers init record/sequence, `Response` statusText, etc.). It checked each character with a
`charCodeAt` loop. This patch does a single `/[\u0100-\uFFFF]/.test(x)` first and only walks the string
(with the exact same loop and error) when an invalid code unit is present. Valid input — the common case —
no longer pays a per-character JS loop.

Breaking changes: none — the accepted set is identical (verified exhaustively for all 65 536 code units,
including lone surrogates), and invalid input throws the same `TypeError` with the same index/value message
produced by the unchanged original loop.

## Benchmarks

`node benchmarks/webidl/bytestring.mjs` (new mitata micro-benchmark — no existing benchmark covered
ByteString / Headers mutation; `benchmarks/fetch/headers.mjs` only measures iteration).
4 interleaved runs each (baseline = origin/main e2d3523b, patched), run through a machine-wide bench lock.
Node v26.13.0, macOS darwin arm64 (Apple M-series MacBook Pro, 15 cores). Mean avg/iter ± half-range.

| benchmark | baseline | patched | change |
|---|---:|---:|---:|
| ByteString short (12 chars) | 13.0 ± 0.5 ns | 7.1 ± 0.2 ns | −45% |
| ByteString medium (31) | 27.4 ± 3.2 ns | 7.0 ± 0.1 ns | −74% |
| ByteString long (113) | 96.1 ± 4.7 ns | 7.1 ± 0.2 ns | −93% |
| ByteString latin1 (76) | 101.4 ± 3.4 ns | 7.8 ± 0.3 ns | −92% |
| `new Headers()` + 8× append | 748.9 ± 39.7 ns | 558.9 ± 25.5 ns | −25% |
| `headers.get()` | 30.3 ± 0.9 ns | 25.4 ± 1.4 ns | −16% |
| `headers.set()` | 140.4 ± 11.8 ns | 61.1 ± 1.5 ns | −56% |

## Tests

`npm run lint` clean · `test/webidl/**` + `test/fetch/headers*.js` 70/70 · `test/fetch/*.js`: same
failure set as origin/main (environment-only: tests needing `--expose-gc`, bundle, subprocess flags) ·
`npm run test:unit` 1688 pass / 0 fail · exhaustive equivalence check over U+0000–U+FFFF.
WPT not runnable locally (requires /etc/hosts entries / sudo); behaviour equivalence shown by the exhaustive check.

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.
