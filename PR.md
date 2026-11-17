> Note for the owner: remove this PR.md before opening the real PR.

# perf(fetch): avoid discarded subarrays in the multipart/form-data parser

`Response#formData()` / `Request#formData()` for `multipart/form-data` spent most of its self time creating
`Buffer` views (`FastBuffer` via `subarray`) that are thrown away immediately:

- whitespace / ignored-header skips used `collectASequenceOfBytes()`, which always returns a subarray; they now
  use a new `skipASequenceOfBytes()` that only advances the position (2× per content-disposition attribute,
  after every header `:`, and for every unknown header);
- the per-part boundary check `input.subarray(p, p + len).equals(boundary)` is now
  `p + len <= input.length && input.compare(boundary, 0, len, p, p + len) === 0` (same result: the old subarray
  was clamped, so an out-of-range check was already `false`);
- `boundary.subarray(2)` is computed once instead of once per part;
- the OWS / not-CRLF predicates are module-level functions instead of closures allocated per call.

Adds `benchmarks/fetch/formdata-parser.mjs` (no formdata benchmark existed).

## Benchmarks

node v26.13.0, Apple M5 Pro (darwin arm64, 15 cores), run under the machine bench lock (loadavg at start 5.57 6.47 7.49).

Same-process A/B (origin/main parser vs patched loaded side by side, interleaved, median of 7 rounds, A/A = main vs main control):

| case | run 1 | run 2 | run 3 | A/A (max abs) |
|---|---|---|---|---|
| 20 small fields | 21.6 → 15.6 µs (−27.9%) | 26.3 → 21.6 µs (−17.9%) | 20.8 → 18.3 µs (−12.1%) | 1.4% |
| 10 fields + 1 extra header each | 13.2 → 11.5 µs (−12.8%) | 13.3 → 11.1 µs (−16.7%) | 13.2 → 11.1 µs (−16.0%) | 1.0% |
| 1 file part | 3.94 → 3.60 µs (−8.4%) | 4.05 → 3.77 µs (−6.8%) | 3.13 → 2.97 µs (−5.0%) | 3.5% |
| 5 fields + 64 KiB file | 14.8 → 13.7 µs (−7.5%) | 15.4 → 14.4 µs (−6.6%) | 12.2 → 11.3 µs (−7.6%) | 1.4% |

`node benchmarks/fetch/formdata-parser.mjs` (mitata, same session):

| benchmark | main | patched | alloc main → patched (p99) |
|---|---|---|---|
| 20 small fields | 22.01 µs | 19.43 µs (−12%) | 40.9 kb → 27.5 kb |
| 1 file part | 3.42 µs | 3.11 µs (−9%) | 1.44 kb → 353 b |
| 5 fields + 64 KiB file | 12.77 µs | 12.19 µs (−5%) | 7.21 kb → 2.72 kb |

## Tests

`node --test test/fetch/formdata*.js test/busboy/*.js test/fetch/client-fetch.js test/fetch/issue-4065.js test/issue-2283.js`
and `node --expose-gc --test test/fetch/response.js`: all pass. `npm run lint` clean.
Differential fuzz against origin/main: 100k random multipart bodies (most malformed: bad CRLFs, truncated input,
bad boundaries, odd headers/attributes, extended `filename*`, base64) + 60k well-formed ones — identical entries
(name, string value / File name, type, bytes) and identical errors (type, message, cause) in every case.
WPT: not run locally (hosts setup needs sudo; upstream CI runs it).

Breaking changes: none — internal parser bookkeeping only; every input yields the same entries or the same TypeError and cause as before.

Overlap: P30/P42 candidates also touch `lib/web/fetch/formdata-parser.js` (independent hunks; a trivial rebase at most).

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.
