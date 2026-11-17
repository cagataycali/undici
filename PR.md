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
