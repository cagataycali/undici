> Owner-review file — remove `PR.md` before opening the real PR.

# perf(interceptor): filter decompressed raw headers in place

`DecompressHandler#onResponseStart` dropped `content-encoding`/`content-length` from `controller.rawHeaders` by decoding
every header-name Buffer to latin1, lower-casing it, pushing survivors into a new array and copying them back with
`rawHeaders.splice(0, len, ...filtered)`. It now compacts the same array in place with a write index and only decodes
names whose length is 14 or 16 (the only lengths that can match). The array object is the same one the old code
already mutated in place, so ownership/identity is unchanged.

Breaking changes: none — the same array object ends up with exactly the same elements in the same order (fuzz-compared
against the old code on 200k random arrays incl. string/number/null names, odd lengths, mixed case, non-ASCII look-alikes).

## Benchmarks
Same-process A/B with an A/A control (old filter from `main` vs patched, interleaved, median of 15 rounds), 3 runs under
the bench lock. Node v26.13.0, darwin arm64 (Apple M-series, 15 cores), loadavg at start `6.83 8.62 8.63`.

| run | filter, 12 Buffer headers — main | patched | Δ | A/A |
|---|---|---|---|---|
| 1 | 971 ns | 215 ns | −77.8% | −0.1% |
| 2 | 748 ns | 178 ns | −76.2% | +0.1% |
| 3 | 783 ns | 176 ns | −77.5% | +0.9% |

Whole `onResponseStart`+`onResponseEnd` through `interceptors.decompress()` (gzip, 12 headers; dominated by creating the
zlib stream): B/A +6.1% / −6.7% / −4.2% with A/A −8.0% / +7.4% / +10.7% — **within noise**. Best-of-rounds was
6946→6374, 7037→6501, 10510→8340 ns, consistent with the ~0.6–0.8 µs saved per compressed response, but this is a
small end-to-end win; the headline is the filter itself.

Added `benchmarks/interceptors/decompress-raw-headers.mjs` (mitata, drives the interceptor end to end) since no
existing benchmark covers this path.

## Tests
`npm run lint` clean; `test/interceptors/decompress.js` 53/53, `test/interceptors/{cache-replay-handler-throws,response-error}.js` + `test/mock-delayed-abort.js` 14/14.

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.
