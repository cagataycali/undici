> NOTE: this file is for owner review only and must be removed before opening the real PR.

# perf(core): build the header-name ternary search tree in balanced order

The TST in `lib/core/tree.js` (used by `bufferToLowerCasedHeaderName` / `headerNameToString` for every
response header name) was filled in `wellknownHeaderNames` order, so the left/right links at each level form a
skewed BST. Inserting the sorted, de-duplicated keys median-first makes each level a balanced BST: the average
number of nodes visited per well-known key lookup drops from 24.0 to 18.0 (−25%). Lookup code is unchanged.
The benchmark `benchmarks/core/tree.mjs` gains a "many keys" group (15 common response headers, and all
well-known names) so the improvement is visible beyond `content-length`.

## Benchmarks

`node benchmarks/core/tree.mjs` (mitata), baseline = origin/main e2d3523b, 5 interleaved runs each through the
bench lock. Node v26.13.0, macOS darwin arm64 (Apple Silicon MacBook Pro, 15 cores). loadavg at start: 7.90 / 6.17.

| bench | baseline mean (min–max) | patched mean (min–max) | Δ mean |
|---|---|---|---|
| content-length | 23.31 ns (20.92–28.68) | 17.96 ns (16.98–19.03) | −22.9% |
| CONTENT-LENGTH | 24.08 ns (21.47–31.87) | 20.02 ns (18.95–20.46) | −16.9% |
| Content-Length | 21.73 ns (19.70–27.44) | 17.60 ns (16.60–18.28) | −19.0% |
| 15 common response headers | 336.7 ns (313.6–403.0) | 279.5 ns (263.9–300.3) | −17.0% |
| all 95 well-known names | 2.79 µs (2.63–3.15) | 2.51 µs (2.40–2.70) | −10.0% |

(Medians: −7% to −21%. Baseline run 1 was the noisiest; excluding it still gives −6% to −15%.)

## Tests

`npm run lint` clean; `node --test test/node-test/tree.js` 6/6; `npm run test:unit` 1688 pass / 0 fail
(3 skipped); extra check: every well-known name in original, UPPER and lower case looks up to the same value as before.
WPT: not run locally (hosts setup needs sudo; upstream CI runs it) — no fetch code is touched.

Breaking changes: none — only the insertion order of the internal header-name tree changes; the set of keys,
their values, `TernarySearchTree`'s API and every lookup result are identical.

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.
