> Owner review file — remove `PR.md` before opening the real PR.

# perf(fetch): decode multipart text fields without copying

`multipartFormDataParser` decoded every non-file field with
`decoderIgnoreBOM.decode(Buffer.from(body))`. `body` is already a `Buffer` view
into the input, and `TextDecoder#decode` accepts any `ArrayBufferView` and keeps
no state between calls, so the extra `Buffer.from` only copied the field bytes.
This PR decodes the view directly. The copy dates from the old `utf8DecodeBytes`
helper and was carried over unchanged when the BOM-ignoring decoder was added (#4902).
Also adds `benchmarks/fetch/formdata-text-fields.mjs` (no formData() benchmark existed).

Breaking changes: none — same bytes go to the same `ignoreBOM: true` decoder, so every
string, BOM handling, replacement character and error is identical; no API is touched.

## Benchmarks

Same-process A/B (mitata 1.0.4): origin/main `lib/` vs patched `lib/` vs a second copy of
origin/main (A/A control), 3 runs, mean avg per iteration, via `work/scripts/bench-lock.sh`
(loadavg at start 6.90 7.81 8.24). Node v26.13.0, Apple M5 Pro, macOS arm64.
Bodies: N text fields of `x` repeated.

| case | main (µs, 3 runs) | patched | Δ vs main | A/A Δ |
|---|---|---|---|---|
| parser, 4 fields × 64 KiB | 24.77 / 23.48 / 23.75 | 18.70 / 17.39 / 17.05 | **−26.2%** | −0.8% |
| `Response#formData()`, 4 × 64 KiB | 74.06 / 70.23 / 72.14 | 62.78 / 59.97 / 58.07 | **−16.4%** | +4.0% |
| parser, 20 × 1 KiB | 27.47 / 29.55 / 24.02 | 22.19 / 25.92 / 21.74 | −13.8% | −1.5% |
| `Response#formData()`, 20 × 1 KiB | 32.28 / 33.31 / 29.93 | 29.61 / 28.40 / 34.13 | −3.5% | −1.7% (noise) |
| parser, 20 × 12 B | 22.31 / 22.10 / 20.91 | 19.66 / 20.61 / 19.79 | −8.0% | −4.9% (noise) |
| `Response#formData()`, 20 × 12 B | 27.27 / 27.21 / 26.31 | 28.29 / 27.60 / 24.59 | −0.4% | −2.6% (noise) |

Honest reading: the win scales with text-field size. For large text fields, `formData()`
end to end is ~16% faster and allocates one copy less per field; for tiny fields
the difference is within noise.

New benchmark: `node benchmarks/fetch/formdata-text-fields.mjs`.

## Tests

- `npm run lint` clean.
- `node --test --expose-gc test/fetch/formdata*.js test/busboy/*.js test/fetch/issue-3*.js test/fetch/issue-4*.js`: 133/133 pass;
  every `test/fetch/*.js` that calls `formData()`: 78/78 pass.
- Fuzz (not committed): 40,000 random multipart bodies (BOMs, invalid/partial UTF-8, lone surrogates,
  base64 parts, files, charset params, corrupted/truncated bodies), main vs patched parser output
  (entries, strings, file bytes, error class+message) identical; a planted BOM-stripping bug was caught.
- WPT: not run locally (hosts setup needs sudo; upstream CI runs it).

Overlap: other branches in this series (formdata-parser-fewer-subarrays, P42) touch
`lib/web/fetch/formdata-parser.js` in other lines; this diff is a one-line change from origin/main.

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.
