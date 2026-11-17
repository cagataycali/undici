> Owner review copy — remove this `PR.md` before opening the real PR.

# perf(cache): trim OWS with char code scans instead of regex

`trimOWS` / `trimOWSStart` / `trimOWSEnd` in `lib/util/cache.js` ran one or two regex `replace()` calls for every
Cache-Control directive and every Vary / Connection token, and `parseCacheControlHeader` additionally compares the
results to detect surrounding whitespace. They now scan char codes for SP / HTAB and return the original string
untouched when there is nothing to trim (the common case). The duplicate regex `trimOWS` in
`lib/handler/cache-handler.js` now reuses the one from `lib/util/cache.js` (internal module; not part of the public API).

Breaking changes: none — the functions return the identical string for every input (only `\t` and ` ` are trimmed, exactly like `/^[\t ]+|[\t ]+$/g`), verified exhaustively below; no public API, option or type changes.

## Equivalence

Old (origin/main regex) vs new, all three functions, 66,018,780 comparisons, 0 mismatches:
every UTF-16 code unit 0x0000–0xFFFF (incl. NBSP, U+3000, U+FEFF, U+2028, `\n\r\v\f`, lone surrogates) alone,
doubled, inside text and surrounded by 8 SP/HTAB padding variants on each side, plus every string up to length 6 over
`[SP, HTAB, a, U+00A0, U+3000, \n, \r, \v, \f, U+FEFF, U+2028, U+D800, =]`. A deliberately planted bug (also trimming
U+00A0) was caught immediately.

## Benchmarks

Same-process A/B with an A/A control: two independently loaded copies of origin/main `lib/util/cache.js` (mainA, mainB)
and the patched file, interleaved order, 8 rounds × 200k iterations, first 2 rounds dropped. 3 runs under the
machine-wide bench lock (loadavg 5.53 6.98 7.85). Node v26, macOS, Apple Silicon (arm64, 15 cores).

Inputs: 6 typical Cache-Control values (one with spaces around `,`/`=`), 3 Vary values. Time per loop over all inputs:

| run | parseCacheControlHeader main | patched | Δ | A/A | parseVaryHeader main | patched | Δ | A/A |
|---|---|---|---|---|---|---|---|---|
| 1 | 4505 ns | 3977 ns | −11.7% | +5.5% | 1025 ns | 697 ns | −32.0% | −0.6% |
| 2 | 5058 ns | 4091 ns | −19.1% | 0.0% | 1141 ns | 765 ns | −33.0% | −0.6% |
| 3 | 5335 ns | 4072 ns | −23.7% | −3.8% | 1182 ns | 802 ns | −32.2% | 0.0% |

So `parseCacheControlHeader` as a whole is ~12–24% faster (mean ~18%) and `parseVaryHeader` ~32% faster.
End-to-end share: this is per cacheable response / per cached lookup work of roughly 0.1–1 µs, so a full cached
`request()` (tens of µs) improves by well under 1–2%; the gain is in the cache interceptor's CPU per request,
not in network-bound latency.

A new mitata micro-benchmark is added: `node benchmarks/cache/parse-cache-control.mjs` (no existing benchmark covered
these functions; `benchmarks/cache/` had only `date.mjs` and `get-field-values.mjs`).

## Tests

`npm run lint` clean. `node --test test/cache-interceptor/*.js test/interceptors/cache*.js test/cache/*.js`: 258/258 pass.

Overlap: `perf/cache-vary-single-scan` (P40) and `perf/cache-strip-headers-single-copy` (P38) touch the same files;
both merge cleanly with this branch (`git merge-tree`), and P40's new code calls `trimOWS`, so it benefits too.

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.
