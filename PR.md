> Owner review copy. Remove this file before opening the real PR.
>
> Supervisor (work/fetch-supervisor/REVIEW.md): NOT READY. B1: the branch can stall forever on a 0-byte chunk from the parser (fix + test in the review). B2: two WPT subtests now pass, so test/web-platform-tests/expectation.json must be updated. The wording below has been corrected; the numbers are for b16db4f9 and get re-measured after the fix.

# perf(fetch): buffer undecoded response bodies without a Readable

I profiled `fetch()` against `request()` on small keep-alive responses. A good part of the difference was in the response body plumbing, not in the spec steps. Each chunk goes from the socket to `onResponseData`, into a Node `Readable`, out through its async iterator to `fetchParams.controller.next()`, and then into the fetch `ReadableStream`. The `Readable` is there so content decoders can be attached with `pipeline()`. For a response without `Content-Encoding`, nothing is attached to it: it only buffers chunks and turns `read()` into `controller.resume()`. Setting it up for every response (stream state, the async iterator, end-of-stream listeners, nextTicks) costs more than the fetch code around it, and it allocates a lot of short-lived objects.

This uses a small `BodyQueue` instead when there are no decoders. It hands chunks to `controller.next()`. `push()` returns `false` at the same high-water mark as a default `Readable`, so `onResponseData` still pauses the socket, and the source resumes once a taken chunk brings the queue back below it. `destroy()` rejects a pending read with the given error, or with the same `ERR_STREAM_PREMATURE_CLOSE` a `Readable` iterator gives. Responses with `Content-Encoding` keep the `Readable` + `pipeline()` path, and the `ReadableStream` users see doesn't change.

Client CPU per request, this branch vs main, ±95% CI, `await (await fetch(url)).text()`:

| response body | Node 26.13.1, 3 rounds | 24.22.3 | 22.23.5 | worst A/A |
|---|---|---|---|---|
| 16 B | -31.1 ±13.4 / -28.7 ±12.5 / -41.6 ±10.4 % | -10.3 ±1.8 % | -13.7 ±2.1 % | 5.8% |
| 1 KiB | -34.9 ±9.4 / -24.8 ±12.4 / -33.8 ±11.1 % | - | - | 2.9% |
| 64 KiB | -8.2 ±6.8 / -9.0 ±4.9 / -10.4 ±5.0 % | -5.6 ±2.3 % | -12.6 ±6.6 % | 6.4% |

Requests/s go up by about the same amount: on Node 26 at 16 B, from about 15,800 to 21,500 (mean of the three rounds). With one request at a time (16 B, Node 26) it's -17.9 ±1.4 %. With 32 response headers it's -7.9 ±7.7 %, against -4.0% for A/A, so I'm not counting that one; header handling dominates there.

Node 26 needs a word of explanation, because its intervals are wide. With the same code, a Node 26 process settles into one of two GC regimes for the whole run. In one, scavenges keep about 450 KB alive and fetch costs about 50 µs. In the other they keep about 6.5 MB alive and it costs about 86 µs. This change makes each request about 13-19% cheaper in both regimes. It also makes the cheap regime more likely for small bodies: 38 of 60 runs on this branch landed in it, against 14 of 60 on main and 11 of 60 for the A/A copy of main. Together that gives the 30-40% above. How often main lands in the cheap regime depends on the benchmark setup, though: a second, independent client harness on the same machine (60 runs per arm, Node 26) put main there in 32 of 60 runs (A/A 39, branch 43) and measured -24.0 ±8.4 % at 16 B, -14.7 ±8.4 % at 1 KiB and -10.9 ±3.4 % at 64 KiB, with the same 14-18% saving inside each regime. So read the Node 26 totals as setup-dependent. On Node 24 and 22 the second harness agrees at 16 B (-12.7 ±2.0 / -13.2 ±1.9 %) and 1 KiB (-13.0 / -13.8 %), and adds 1 MiB (-7.2 / -7.7 %); at 64 KiB on Node 22 it measured only -3.7 ±5.5 %, so the -12.6 % in the table (whose A/A drifted -6.4 %) is uncertain. Node 24 and 22 don't show the two regimes in this test, so their 10-14% is the plain saving, and it is the number to rely on.

Measured on a shared Jetson AGX Thor (aarch64, 14 cores). Clocks were fixed with `jetson_clocks` for everything except round 1's 16 B and 1 KiB runs, which ran at default clocks. A node:http server ran on 5 cores and the client on 2 others, with 32 concurrent requests on a keep-alive `Agent`. Each arm is 20 separate-process runs in rotated order; A/A is main against a second arm running the same main checkout.

The client is a loop of `const r = await fetch(url, { dispatcher }); await r.text()` timed with `process.cpuUsage()`. I can add it to `benchmarks/` if that's useful.

The new `test/fetch/response-body-flow.js` checks that a slow reader still gets every byte, and what happens on a connection closed mid-body and on an abort mid-body. It passes on main and on this branch. `test/fetch`, `test/node-fetch`, `test/webidl`, `test/busboy`, `test/cache-interceptor`, `test/interceptors` and `test/websocket` give the same results as main on Node 22, 24 and 26 (all pass on a Linux box; on my Mac the bundle, `--max-http-header-size` and env-proxy tests fail on main too). Lint is clean. WPT `/fetch` matches main except two `stream-safe-creation.any.html` subtests that now pass (a poisoned `Object.prototype.highWaterMark` no longer breaks `fetch()`, because no `Readable` is built from an options object), so their `expectation.json` entries are updated to pass.

Breaking changes: none. The `Readable` was internal and never exposed, and the body stream, its errors and its backpressure behave the same.

Related: #2014, #1203, #2927. This follows #3093 and #3095, which removed a `TransformStream` and an intermediary `ReadableStream` from the same path.

I used an AI agent for the profiling, benchmark runs and a first draft, and reviewed and tested all of it myself.
