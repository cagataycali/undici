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

Bodies that `Buffer.concat()` places in Node's shared pool take the old path, so they are unaffected
by design. That is any size below `Buffer.poolSize >>> 1`: 4 KiB on Node 22 (poolSize 8 KiB), 32 KiB on
Node 24 and 26 (poolSize 64 KiB). The guard checks ownership, not size, so it stays correct if an
application changes `Buffer.poolSize`.

## Tests

`npm run lint` clean · `borp -p "test/fetch/*.js"` 521/521 · `borp -p "test/*.js"` 1688 pass, 0 fail,
3 skipped · new test `arrayBuffer() returns an ArrayBuffer that is not shared with other memory`
(sizes 0…128 KiB, single-buffer and chunked streams, write-through checks).
WPT (`/fetch`) could not run on this machine (the WPT server needs `web-platform.test` entries in
/etc/hosts and there was no sudo); upstream CI runs it.

Breaking changes: none — the result is still a fresh, unshared `ArrayBuffer` with identical
bytes and length; only an internal redundant copy is skipped.

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.

## End-to-end validation

> ⚠ **Upstream duplicate:** nodejs/undici#6193 (opened 2026-11-10, open, no reviews yet) makes the same change with the
> same ownership guard, and also covers `bytes()` and `lib/api/readable.js`. Do **not** open this branch as a separate PR.
> The data below is evidence that could support #6193; posting it there is the owner's decision.
> Full notes: work/top5/DEEP-P01.md.

Rebased onto origin/main 3d170a33; lint clean; `borp --expose-gc -p "test/fetch/*.js"` 524/524.

**Why the guard is enough (Node 22/24/26):** `readAllBytes()` always ends in `Buffer.concat(chunks, n)`, which is
`Buffer.allocUnsafe(n)` plus a copy, even for one chunk, so the result never aliases a stream chunk. `allocUnsafe(n)` takes
a pool slice only when `n < Buffer.poolSize >>> 1` (default pool: 8 KiB on 22, 64 KiB on 24/26, so the cut-off is 4 KiB or
32 KiB). A pool slice always has `buffer.byteLength > n`, so `byteOffset === 0 && byteLength === buffer.byteLength` is
never true for one. This holds for any user-set `poolSize` (checked with 2 MiB). f979ec32 (#3117) returned `bytes.buffer`
without this check, which is #3337.

**Node matrix** (`new Response(body).arrayBuffer()`, separate processes, 6 alternating rounds; loadavg ~4):

| node | 64 KiB | 1 MiB | 8 MiB | 1 MiB, 64 KiB chunks | 8 KiB |
|---|---|---|---|---|---|
| 22.23.5 | −16.9 % | −22.8 % | −32.1 % | −49.9 % | −8.1 % (not pooled on 22) |
| 24.22.3 | −20.1 % | −21.7 % | −20.9 % | −42.8 % | unchanged (pooled) |
| 26.13.0 | −20.2 % | −23.8 % | −24.3 % | −58.7 % | unchanged (pooled) |

**Real network** (node:http on 127.0.0.1 → full undici `fetch()` + `res.arrayBuffer()`, Node 26.13.0, one process per
run, 12 rounds alternating main/branch, bootstrap 95% CI of the ratio of medians; bodies arrived in 3/17/129 chunks; loadavg 5.6):

| workload | latency (median) | req/s | CPU/req | GC count | peak RSS | peak arrayBuffers |
|---|---|---|---|---|---|---|
| 128 KiB ×400 | +0.3 % (n.s.) | +3.2 % (n.s.) | **−6.1 %** [−7.9, −4.3] | **−15 %** | n.s. | **−5.0 %** |
| 1 MiB ×150 | **−6.7 %** [−10.4, −4.6] | **+7.5 %** [5.7, 9.6] | **−11.0 %** | **−19 %** | **−4.9 %** | **−11.5 %** |
| 8 MiB ×30 | **−11.4 %** [−14.5, −9.7] | **+7.3 %** [6.4, 10.7] | **−9.4 %** | **−11 %** | **−4.3 %** | **−8.4 %** |
| 8 MiB ×40, 8 at once | **−11.4 %** [−15.0, −7.6] | **+12.5 %** [9.0, 14.0] | **−8.8 %** | **−15 %** | **−10.6 %** (425→380 MB) | **−15.7 %** (280→236 MB) |

Bold = CI excludes 0. Nothing got worse.

**CPU profile** (`--cpu-prof`, 8 MiB ×300, 3 profiles each): the arrayBuffer() callback with the copy (`body.js:360`) went
from 151.8 ms self (8.1 % of non-idle CPU) to 0.6 ms (0.0 %). Total non-idle CPU 1881 → 1587 ms (−15.6 %), GC 353 → 288 ms
(−18.5 %). `Buffer.concat` (the copy that has to stay) is unchanged.

**Verdict:** STRONG as a change; DUPLICATE as a PR (#6193).
