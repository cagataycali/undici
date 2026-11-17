> Owner-review note: remove this PR.md before opening the real PR.

# perf(fetch): skip percent-decoding replaces for quoted multipart attributes without `%`

`parseContentDispositionAttribute` ran three regex `.replace()` calls (`%0A`, `%0D`, `%22`) on every quoted
`name="…"` / `filename="…"` value in `multipart/form-data` bodies. That includes the usual case, where the value has
no `%` and every replace does nothing. A single `indexOf('%')` check now skips them. Values that contain `%` take
exactly the same replace chain as before.

## Benchmarks

Same-process A/B on `multipartFormDataParser`: origin/main (`3d170a33`), a second identical copy of main as an
A/A control, and the patched parser, run interleaved. 4 runs under the machine bench lock, with load average
4.0–4.7 at the time. Node v26.13.0, darwin arm64 (15 cores). Harness: mitata. New micro-benchmark:
`benchmarks/fetch/formdata-parser-attributes.mjs`.

| case | main (A) | main copy (A/A) | patched | Δ vs mean(A, A/A) |
|---|---|---|---|---|
| 20 small fields | 20.3 / 22.0 / 22.6 / 21.9 µs | 20.4 / 21.0 / 22.2 / 18.2 µs | 19.1 / 19.0 / 19.3 / 19.0 µs | **−9.5%** (patched spread ±0.8%) |
| 20 fields with `%22` | 21.2 / 20.9 / 22.2 / 20.1 | 23.2 / 20.3 / 21.8 / 20.3 | 21.5 / 20.5 / 21.7 / 20.4 | ≈0 (unchanged path, as expected) |
| 1 file part | 3.15 / 3.10 / 3.01 / 3.22 | 3.12 / 3.12 / 3.15 / 4.04 | 3.12 / 2.99 / 3.01 / 4.71 | within noise |
| **end-to-end** `new Response(body).formData()`, 20 fields | 26.4 / 25.3 / 25.8 / 25.0 | 24.9 / 25.4 / 27.0 / 25.2 | 24.0 / 23.9 / 26.8 / 24.2 | **≈ −3.4%** (one run of the four ≈0) |

An earlier locked session (3 runs) showed the same direction: 20 small fields −5%, 1 file part −4–14%. The A/A
control drifted by up to ±10% in single runs on this shared machine, so read the end-to-end number as "small but
consistent", not exact. The win scales with the number of quoted attributes per body.

## Tests

- `npm run lint` clean.
- `node --expose-gc --test test/busboy/*.js test/fetch/formdata*.js` plus the fetch files that call `formData()`:
  145/145 pass. `test/fetch/bundle.js` needs a build artifact and fails on main too.
- Differential fuzz: 100,000 random multipart bodies (names and filenames with and without `%0A`/`%0a`/`%0D`/`%22`,
  partial `%2`, `%%`, backslashes, quotes, non-ASCII, `filename*=`) gave identical output to origin/main:
  45,119 parsed with the same entries, 54,881 threw the same error.
- WPT: not run locally (hosts setup needs sudo; upstream CI runs it).

Breaking changes: none. Without a `%` all three replaces are no-ops, and with one the code path is byte-for-byte
the same as before.

Overlap: other candidate branches (`perf/formdata-text-field-no-copy`, `perf/formdata-parser-fewer-subarrays`)
also edit `lib/web/fetch/formdata-parser.js`, but this diff touches only the quoted-value branch, so they should
merge independently. It could also be bundled with them as one "formdata parser CPU" PR.

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.
