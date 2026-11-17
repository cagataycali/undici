> Owner review file — remove `PR.md` before opening the real PR.

# perf(fetch): skip the full intermediate request record for string input in `new Request()`

For `new Request(url)` (and therefore every `fetch(url)`), step 5.4 built a full ~40-field
request via `makeRequest()` (including an empty `HeadersList` + `Map`), only for step 12 to
immediately build the real request from ~17 of its fields. The string branch now creates a small
record with exactly the fields steps 9–12 read, holding the same values `makeRequest()` defaults to.
Step 12 is unchanged, so the resulting request state is identical.

## Benchmarks

Node v26 · darwin arm64 (Apple Silicon, 15 cores) · baseline = origin/main `e2d3523b`, run through the
shared bench lock, interleaved. The machine was shared with other jobs (loadavg ~7–9), so the A/B
harness below (both builds loaded in one process, alternating 100k-iteration batches, 30 rounds, first 10
dropped) is the most reliable number; mitata numbers agree in direction.

A/B harness, median ns/op over 3 separate runs:

| case | baseline | patched | Δ |
|---|---|---|---|
| `new Request(url)` | 297 / 295 / 292 | 227 / 224 / 226 | **−23 %** |
| `new Request(url, { method: 'POST', headers })` | 565 / 573 / 1018* | 516 / 518 / 901* | **−9 %** |

\* third run hit a load spike on both sides; still −11 %.

`cd benchmarks && node fetch/request-creation.mjs` (mitata, `new Request(input)`), p50 over 4 interleaved runs:
baseline 416 / 417 / 417 / 300 ns, patched 252 / 254 / 500† / 256 ns († load spike).

## Tests

- `npm run lint` clean
- `npm run test:fetch` — 520 + 28 + 49 pass, 0 fail
- `npm run test:unit` — 1688 pass, 0 fail, 3 skipped
- Equivalence check: 112 constructor cases (4 URLs incl. invalid/relative/data, 14 inits incl. `mode: 'navigate'`,
  `window: null`, body, signal, all enum options) — internal request state (all keys, order, values,
  headers list), public `url`/`method`/`headers`, and thrown errors are identical between baseline and patched.
- WPT `/fetch` could not run on this machine (needs `web-platform.test` in /etc/hosts, no sudo); upstream CI runs it.

Breaking changes: none — internal-only; the request object produced by step 12 has the same keys, values and
defaults as before, and no public API, error, or spec-visible behaviour changes.

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.

## Re-verified (rotated load order)

Re-run 2026-11-17 after finding that in one process the last-loaded undici copy can run 20–30% slower whatever its code. A and A' are two separate extracted copies of base `e2d3523b`, B is this branch. Each load order runs in its own process (3 orders × 2 processes, 9 alternating rounds × 50k ops, median ns/op), under the bench lock (loadavg 4.9). Node v26.13.0, darwin arm64. The bias shows plainly here: the last-loaded copy is 9–15% slower in each order, so per-order deltas swing. Averaged over orders: `new Request(url)` holds at **−22%**, in line with the original −23%. The POST+headers case averages **−7%** (A/A −1%), but in the order where the patch loads last it is only −3% / +0.1%, so treat its gain as modest (~5–7%).

### new Request(url)
| order | A (base) | A' (base copy) | B (patch) | A'/A | B/A |
|---|---|---|---|---|---|
| A,B,A2 | 240.5 | 276.9 | 188.7 | +15.1% | -21.6% |
| A,B,A2 | 265.2 | 310.6 | 212.6 | +17.1% | -19.8% |
| B,A2,A | 299.9 | 264.6 | 196.5 | -11.8% | -34.5% |
| B,A2,A | 307.4 | 268.4 | 201.9 | -12.7% | -34.3% |
| A2,A,B | 269.0 | 267.3 | 244.5 | -0.6% | -9.1% |
| A2,A,B | 268.6 | 267.5 | 243.6 | -0.4% | -9.3% |
| **geo-mean over orders** | | | | **+0.5%** | **-22.4%** vs mean(A,A') |

### new Request(url, { method: 'POST', headers })
| order | A (base) | A' (base copy) | B (patch) | A'/A | B/A |
|---|---|---|---|---|---|
| A,B,A2 | 614.0 | 655.0 | 568.9 | +6.7% | -7.3% |
| A,B,A2 | 650.7 | 684.4 | 597.1 | +5.2% | -8.2% |
| B,A2,A | 673.9 | 621.5 | 593.3 | -7.8% | -12.0% |
| B,A2,A | 673.4 | 635.6 | 573.7 | -5.6% | -14.8% |
| A2,A,B | 652.8 | 639.2 | 633.2 | -2.1% | -3.0% |
| A2,A,B | 620.6 | 604.0 | 621.0 | -2.7% | +0.1% |
| **geo-mean over orders** | | | | **-1.2%** | **-7.2%** vs mean(A,A') |

