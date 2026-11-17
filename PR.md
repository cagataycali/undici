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

## End-to-end validation

(Owner review only — full details in work/top5/DEEP-P03.md. Branch rebased on origin/main 3d170a33.)

**Prior art — read first:** this is the same change as nodejs/undici#5903 (@zirkelc, closed unmerged 2026-09-25). It was closed over the
"AI campaign" methodology, not the code. @jasnell called the change "worth taking" and suggested `buffer.isLatin1` (nodejs/node#66298, Node ≥26 only) + regex fallback.
A fresh PR would be a duplicate: refer to #5903, credit it, and ask maintainers first.

**Node matrix** (separate processes, main/branch alternated, 4 rounds, median ns/op):

| case | Node 22.23.5 | Node 24.22.3 | Node 26.13.0 |
|---|---|---|---|
| ByteString short (12) | 12.9 → 8.1 (1.58×) | 12.5 → 7.7 (1.62×) | 13.9 → 7.7 (1.80×) |
| ByteString long (113) | 97.6 → 10.4 (9.4×) | 96.6 → 9.3 (10.4×) | 93.9 → 9.5 (9.9×) |
| ByteString latin1 (76) | 93.8 → 12.4 (7.6×) | 103.1 → 12.5 (8.3×) | 101.1 → 12.2 (8.3×) |
| `new Headers()` + 8× append | 875 → 654 (1.34×) | 832 → 602 (1.38×) | 784 → 559 (1.40×) |
| `headers.set()` | 163 → 69 (2.35×) | 148 → 65 (2.27×) | 147 → 64 (2.29×) |

There's no regression on any supported Node version; branch max < main min in every row.

**End-to-end** (full library, separate processes, 12 ABBA rounds × 3 s, 16 concurrent, local upstream with 20 response headers, loadavg ~4.1):

| workload | Δ req/s (paired mean) | 95% bootstrap CI | Δ CPU µs/req | 95% CI |
|---|---|---|---|---|
| fetch proxy (8 append → fetch → new Headers(res.headers) → delete/set/append → forEach → new Response) | +0.50% | [−0.85%, +1.64%] | −0.25% | [−1.30%, +1.06%] |
| plain fetch() + iterate 20 headers | −2.24% | [−6.23%, +1.76%] | +2.40% | [−0.45%, +5.76%] |

Neither is statistically significant. Plain fetch makes ~1 ByteString call per request, so this change can't move it; that row is noise.

**CPU profile** (proxy workload, `--cpu-prof`, with and without inlining): `webidl.converters.ByteString` takes **1.0–1.2%** of busy CPU on main and **0.44–0.55%** on the branch (including the regex), saving ~0.6% CPU/request.
The rest of the top-10 is GC, latin1 encode/decode, `HeadersList.append`, the header-name tree search, `parseHeaders` and `isValidHeaderValue`.

**Verdict: OK.** It's a big micro-level win on every supported Node, the diff is small and spec-shaped, and there's no behaviour change. The end-to-end effect is ≤1% and only matters for header-heavy fetch code.
Upstream should get it as a revival of #5903, ideally in jasnell's `isLatin1`+regex form, not as a new PR.
