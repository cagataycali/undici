> Owner-review file — remove `PR.md` before opening the real PR.

# perf(fetch): avoid a second copy in Body#arrayBuffer() for large bodies

`arrayBuffer()` copied every body twice: `readAllBytes()` concatenates the chunks with
`Buffer.concat()` (copy 1), then `new Uint8Array(bytes).buffer` copies it again (copy 2).
When the concatenated Buffer spans its whole `ArrayBuffer` (offset 0, same length), nothing
else references that memory, so it is now returned directly. Smaller Buffers can be slices of
Node's shared Buffer pool and are still copied, which keeps the #3337 fix (f979ec32 had
returned `bytes.buffer` unconditionally; 035524e7 reverted that). The ownership check is
exactly the guard that was missing in f979ec32.

Also adds a regression test for #3337 (it fails if the guard is removed: a small body returns
the 8 KiB pool) and a `large` (1 MiB) case to `benchmarks/fetch/body-arraybuffer.mjs`.

## Benchmarks

`cd benchmarks && node fetch/body-arraybuffer.mjs` (mitata), `Response#arrayBuffer`, baseline =
origin/main e2d3523b, interleaved baseline/patched, serialized by a machine-wide bench lock.
Node v26.13.0, Apple M5 Pro (15 cores), macOS. Mean of 5 runs (min–max):

| body size | baseline | patched | change |
|---|---|---|---|
| 128 KiB | 20.77 µs (20.06–21.96) | 17.70 µs (16.52–19.49) | −14.8 % |
| 1 MiB   | 118.8 µs (113.7–125.1) | 93.5 µs (90.5–102.9) | −21.3 % |
| 4 MiB   | 458.7 µs (446.3–492.5) | 360.0 µs (345.7–371.3) | −21.5 % |
| 512 B / 8 KiB | unchanged within noise (4 runs: 1.47 vs 1.49 µs; 3.08 vs 3.10 µs) | | 0 % |

Bodies below 4 KiB take the old path (pooled), so they are unaffected by design. The 8 KiB
case is not pooled but the copy is too small to stand out from the stream overhead.

## Tests

`npm run lint` clean · `borp -p "test/fetch/*.js"` 521/521 · `borp -p "test/*.js"` 1688 pass, 0 fail,
3 skipped · new test `arrayBuffer() returns an ArrayBuffer that is not shared with other memory`
(sizes 0…128 KiB, single-buffer and chunked streams, write-through checks).
WPT (`/fetch`) could not run on this machine (the WPT server needs `web-platform.test` entries in
/etc/hosts and there was no sudo); upstream CI runs it.

Breaking changes: none — the result is still a fresh, unshared `ArrayBuffer` with identical
bytes and length; only an internal redundant copy is skipped.

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.
