> **Owner review note:** this file is for review only and must be removed before opening the real PR.

# perf(eventsource): scan to line end in one step in EventSourceStream

The SSE parser in `EventSourceStream._transform` handled each byte of a line with a full loop pass:
`hasCurrentByte()`, `currentByte()`, the eventEndCheck/CR/LF branches, a line-length check and `advanceCursor()`.
With this change, once the parser is inside a line it scans the current chunk for the next CR/LF in one tight loop
and moves the cursor there in one step. The `maxEventSize + 7` line-length limit is checked on the bytes it skipped,
so the error fires in the same `_transform` call, after the same events. The eventEndCheck/crlfCheck states, the BOM handling and
chunk-boundary handling don't change. The diff touches one file.

## Benchmarks

`benchmarks/eventsource/eventsource-stream.mjs` (mitata, 250 events, two 64-byte data lines each), with main and the patch
run interleaved, 3 runs each, through the bench lock. Node v26.13.0, Apple Silicon MacBook Pro (darwin arm64, 15 cores).
The machine was shared with other jobs (load avg 14–20), so read the spread as noise.

| scenario | main µs (mean, min–max) | patched µs (mean, min–max) | Δ time |
|---|---|---|---|
| single chunk | 391.9 (356–418) | 283.9 (277–291) | -27.6% |
| 256-byte chunks | 445.2 (437–452) | 363.8 (320–430) | -18.3% |
| 64-byte chunks | 577.3 (529–622) | 494.5 (382–575) | -14.3% |
| 8-byte chunks | 1206.7 (1080–1290) | 1122.5 (878–1450) | -7.0% |
| 1-byte chunks | 5606.7 (4790–6200) | 5730.0 (4200–7780) | 2.2% |
| BOM + 8-byte chunks | 1281.1 (973–1550) | 1099.1 (787–1480) | -14.2% |
| BOM + 1-byte chunks | 5923.3 (4530–7200) | 5306.7 (4060–6620) | -10.4% |

The same-process A/B (both parsers in one mitata run, 2 runs) gave single chunk 1.37×/1.38×, 256 B 1.10×/1.38×,
64 B 1.66×/1.21×, 8 B ≈1.0×, and 1 B ≈1.0× (±4%). The gain is largest for real network chunk sizes and long `data:` lines,
like LLM token streams. 1-byte chunks are neutral within noise.

## Tests

- `npm run lint`: clean
- `node --test test/eventsource/*.js`: 153/153 pass
- `npm run test:unit`: 1688 pass, 0 fail
- Differential fuzz (not committed): 200k random streams built from field names, CR/LF/CRLF, BOM, NUL, colons and multibyte chars, cut at random chunk
  boundaries, with `maxEventSize` ∈ {default, 0, 1, 5, 10, 20, 64}. The emitted events, the error point/message and the final state matched main exactly in every case.

Breaking changes: none. This is an internal loop change in a private class method; every event, error, chunk-boundary and CRLF behaviour is the same (tests plus a differential fuzz against main).

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.
