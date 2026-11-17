> Owner review copy — remove this file before opening the real PR.

# perf(websocket): track a read cursor in ByteParser instead of re-slicing buffers

`ByteParser.consume()` re-sliced the remainder of the head chunk (`this.#buffers[0] = first.subarray(n)`) on every
read, and the INFO state allocated a 2-byte `subarray` just to read the frame header. That is 3 bookkeeping
`Buffer` views per received frame. This keeps a `#headOffset` cursor into `#buffers[0]`, reads the two header bytes
in place when the head chunk has more than 2 bytes left, and only creates the payload view that becomes the message
data. The split-across-chunks path is unchanged apart from honouring the cursor.

Adds `benchmarks/websocket/receiver.mjs` (mitata), feeding pre-built server frames to `ByteParser`.

## Benchmarks

Same-process A/B with an A/A control (main loaded twice from two copies, variants interleaved per round,
7 rounds × 4000 iterations, median µs per batch), run 3 times under the bench lock
(loadavg at start 7.54 8.42 8.55). Node v26.13.0, Apple M5 Pro, macOS.

| case | main | main (A/A) | patched | change (3 runs) |
|---|---|---|---|---|
| 64 × 16 B text frames, one chunk | 10.29 / 10.34 / 8.65 µs | +0.4…+0.7% | 4.22 / 4.29 / 3.48 µs | **−58.5 … −59.8%** |
| 64 × 200 B binary frames, one chunk | 14.57 / 11.96 / 11.91 µs | +0.3…+3.2% | 7.53 / 6.01 / 5.97 µs | **−48.3 … −49.8%** |
| 64 × 16 B text frames, 37 B chunks | 15.55 / 11.67 / 12.09 µs | −0.8…+3.5% | 9.69 / 7.45 / 7.69 µs | **−36.2 … −37.7%** |
| 1 × 16 KiB binary frame, one chunk | 0.25 / 0.22 / 0.23 µs | −5.6…+4.8% | 0.18 / 0.17 / 0.16 µs | −24 … −30% |

`node benchmarks/websocket/receiver.mjs` shows the same shape on the patched tree.

## Behaviour

Fuzzed against `main`: 9,000 random streams (text/binary/fragmented/ping/pong/close, 7/16/64-bit lengths, masked
frames, bad opcodes, oversized control frames) cut at random chunk sizes (1–4 B, 1–64 B, 1–5000 B, whole) — the
messages, ping/pong payloads, frames written back and connection failures are identical (an injected off-by-one is
caught on the first case).

Breaking changes: none — internal bookkeeping in `ByteParser` only; the same frames are parsed into the same
payload bytes, with the same events, close codes and error messages.

Tests: `npm run lint` clean; `npx borp -p "test/websocket/**/*.js"` 178/178 pass.
WPT: not run locally (hosts setup needs sudo; upstream CI runs it).

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.
