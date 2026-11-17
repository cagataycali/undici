> Owner review file — remove PR.md before opening the real PR.

# perf(fetch): skip header list round trip in Request constructor

When `new Request(input, init)` is called with a non-empty `init` that has no `headers`, steps 32.1–32.5
copied this request's header list into a new `HeadersList`, emptied the list, appended every header back and
copied the `set-cookie` list. The result was the same list. This change runs those steps only when
`init.headers` exists. `request.headersList` is already this request's own clone (made in `makeRequest`), so
skipping the round trip shares no state with the input request.

Breaking changes: none. The header list ends up with the same entries, the same order, the same name casing and the
same `set-cookie` values. The round trip appended through `HeadersList#append` and so never applied a guard,
so `no-cors` behaviour is unchanged as well.

## Benchmarks

`benchmarks/fetch/request-creation.mjs` (mitata), extended with two cases:
`new Request(request, { method: 'PUT' })` where `request` has 8 headers, and `new Request(url, { method: 'PUT' })`.
Baseline (origin/main e2d3523b) and patched runs were interleaved, 4 runs each, all through bench-lock
(loadavg at start 6.11 7.55 8.07). Node v26.13.0, darwin arm64 (MacBook Pro, 15 cores).

| case | baseline (mean of 4, range) | patched (mean of 4, range) | change |
|---|---|---|---|
| `new Request(request, { method })`, 8 headers | 2.40 µs (1.98–3.07) | 1.68 µs (1.53–1.93) | **−30%** |
| `new Request(url, { method })` | 653 ns (563–831) | 505 ns (462–543) | **−23%** |
| `new Request(url)` (control, code path unchanged) | 446 ns (351–717) | 417 ns (340–548) | ≈ (noise) |

Leaving out the noisy first run gives −27% (2.18 → 1.59 µs) and −17% (594 → 492 ns).

## Tests

- `npm run lint` passes.
- `node --test test/fetch/request.js`: 32/32 pass. `test/fetch/headers*.js` + `request*.js`: 70/70 pass.
- `borp -p "test/fetch/*.js"` gives exactly the same set of failures on origin/main and on this branch. Those tests
  are environment-dependent (`--expose-gc` finalizer tests, bundle, subprocess `--max-http-header-size`), and none
  of them is in request.js.
- An ad-hoc equivalence script compared baseline and patched builds and the output was byte-identical: entries,
  getSetCookie(), duplicate names, cookie joining, `no-cors`, and mutation isolation between source and derived requests.
- WPT: not run locally (hosts setup needs sudo; upstream CI runs it).

## Overlap

`perf/fetch-request-no-intermediate-record` (P10) also edits `lib/web/fetch/request.js`, in a different section.
Both branches are based on origin/main, so they are independent, but the second one to land may need a trivial rebase.

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.
