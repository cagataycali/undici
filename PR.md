> Owner review copy. Remove this file before opening the real PR.

# perf(websocket): read frames through an offset instead of re-slicing chunks

When I profiled a WebSocket client that receives a lot of small messages, about 14% of its CPU samples went to creating Buffer views (`Buffer#subarray` / `FastBuffer`). With this change it's under 4%. `ByteParser.consume()` creates a view for the bytes it returns and another for the rest of the chunk, and it's called twice per frame (header, then payload), so every small frame allocates four typed arrays.

This keeps a read offset into `#buffers[0]` instead. If the header is in the first chunk, its 2 bytes are read in place and the payload is the only view created. Frames that cross chunks fall back to the copy path that's there today. The cost is one more field and a few more lines in `consume()`.

Client CPU per message, patched vs main, ±95% CI:

| workload | Node 26.13.1, 3 rounds | 24.22.3 | 22.23.5 | worst A/A |
|---|---|---|---|---|
| 64 B text | -10.1 ±1.7 / -10.0 ±1.6 / -10.0 ±2.0 % | -10.0 ±1.2 % | -9.3 ±1.5 % | 2.0% |
| 512 B text | -12.4 ±1.8 / -11.7 ±1.6 / -12.2 ±2.1 % | -12.9 ±1.2 % | -11.4 ±0.8 % | 2.4% |
| 64 B text, 16 sockets | -12.2 ±1.8 / -12.5 ±1.5 / -12.1 ±1.7 % | -10.9 ±1.0 % | -9.4 ±1.1 % | 1.4% |
| 1 KiB binary as Blob | -3.4 ±0.7 / -5.2 ±0.4 / -4.0 ±2.0 % | - | - | 0.8% |

That's 11-14% more messages/s for text on Node 26. 16 KiB binary frames move about 2%, close to the A/A drift, so I'm not counting them. Echo against a `ws` server doesn't change, since it's latency bound.

Measured on a shared Jetson AGX Thor (aarch64, 14 cores, clocks fixed with `jetson_clocks`), with server and client pinned to the two idlest cores. Each arm is 20 separate-process runs in rotated order; A/A is main against a second copy of main. 6 of about 2,000 runs failed to start and were dropped.

The parser-only bench is `cd benchmarks && npm i && node websocket/receiver.mjs` (run it again on main's `receiver.js` for the baseline). On the Thor, 64 small text frames go from 11.0 to 5.5 µs. The end-to-end harness is a small raw-frame server and client; I can add it if you want it in the repo.

A differential fuzz against main (10k random streams, random chunk splits) matched on every message, ping, close and error. The new `test/websocket/receiver-chunking.js` splits a stream of mixed frames at every pair of cut points and checks the parser gives the same events. `test/websocket` gives the same results as main on Node 22, 24 and 26; locally the HTTP/2 handshake tests time out on both, so I'm relying on CI for those. Lint is clean.

Breaking changes: none.

Part of #3201.

I used an AI agent for the profiling, benchmark runs and a first draft, and reviewed and tested all of it myself.
