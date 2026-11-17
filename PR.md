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

## Re-verified (rotated load order)

Re-run 2026-11-17 after finding that in one process the last-loaded undici copy can run 20–30% slower whatever its code. A and A' are two separate extracted copies of base `3d170a33`, B is this branch. The frame streams are the same as above, and each op writes all of a case's chunks once (ns per op). Each load order runs in its own process (3 orders × 2 processes, 9 alternating rounds × 4000 ops, median), under the bench lock (loadavg 4.2). Node v26.13.0, darwin arm64. The gain holds in every order and matches the original numbers.

### 64x16B text, 1 chunk
| order | A (base) | A' (base copy) | B (patch) | A'/A | B/A |
|---|---|---|---|---|---|
| A,B,A2 | 7301.2 | 7274.7 | 2991.9 | -0.4% | -59.0% |
| A,B,A2 | 7150.6 | 7225.0 | 2961.8 | +1.0% | -58.6% |
| B,A2,A | 7302.4 | 7284.3 | 2988.6 | -0.2% | -59.1% |
| B,A2,A | 7159.7 | 7175.8 | 2952.2 | +0.2% | -58.8% |
| A2,A,B | 7239.2 | 7172.4 | 2972.3 | -0.9% | -58.9% |
| A2,A,B | 7213.5 | 7236.4 | 2898.6 | +0.3% | -59.8% |
| **geo-mean over orders** | | | | **+0.0%** | **-59.0%** vs mean(A,A') |

### 64x200B binary, 1 chunk
| order | A (base) | A' (base copy) | B (patch) | A'/A | B/A |
|---|---|---|---|---|---|
| A,B,A2 | 9972.1 | 10248.4 | 4813.3 | +2.8% | -51.7% |
| A,B,A2 | 9927.1 | 9953.9 | 4772.6 | +0.3% | -51.9% |
| B,A2,A | 10013.7 | 10025.0 | 4849.3 | +0.1% | -51.6% |
| B,A2,A | 9988.0 | 9924.4 | 4859.0 | -0.6% | -51.4% |
| A2,A,B | 9993.4 | 9965.6 | 5063.0 | -0.3% | -49.3% |
| A2,A,B | 10070.8 | 9918.4 | 5026.9 | -1.5% | -50.1% |
| **geo-mean over orders** | | | | **+0.1%** | **-51.0%** vs mean(A,A') |

### 64x16B text, 37B chunks
| order | A (base) | A' (base copy) | B (patch) | A'/A | B/A |
|---|---|---|---|---|---|
| A,B,A2 | 9918.9 | 9793.9 | 6100.9 | -1.3% | -38.5% |
| A,B,A2 | 9928.7 | 9795.0 | 6151.1 | -1.3% | -38.0% |
| B,A2,A | 10038.0 | 10069.8 | 6311.0 | +0.3% | -37.1% |
| B,A2,A | 9989.9 | 10024.8 | 6236.2 | +0.3% | -37.6% |
| A2,A,B | 10017.7 | 10092.9 | 6256.3 | +0.8% | -37.5% |
| A2,A,B | 10145.0 | 10651.6 | 6255.9 | +5.0% | -38.3% |
| **geo-mean over orders** | | | | **+0.6%** | **-38.0%** vs mean(A,A') |

### 1x16KiB binary, 1 chunk
| order | A (base) | A' (base copy) | B (patch) | A'/A | B/A |
|---|---|---|---|---|---|
| A,B,A2 | 165.0 | 168.2 | 137.1 | +2.0% | -16.9% |
| A,B,A2 | 167.0 | 166.3 | 125.7 | -0.4% | -24.7% |
| B,A2,A | 166.1 | 167.5 | 123.5 | +0.8% | -25.6% |
| B,A2,A | 154.5 | 158.0 | 125.4 | +2.2% | -18.8% |
| A2,A,B | 172.7 | 174.6 | 126.1 | +1.1% | -26.9% |
| A2,A,B | 163.0 | 165.9 | 125.7 | +1.8% | -22.9% |
| **geo-mean over orders** | | | | **+1.2%** | **-23.2%** vs mean(A,A') |

