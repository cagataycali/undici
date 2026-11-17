> **Owner review file — delete `PR.md` before opening the real PR.**

# perf(fetch): copy the header list directly in `new Headers(headers)`

`new Headers(existingHeaders)` is the usual way to clone headers (proxies, middleware, `new Headers(res.headers)`).
Today it builds an `entriesList` array of `[name, value]` pairs and then `fill()` normalizes, validates, lowercases
and re-appends every pair, rebuilding the map entry by entry. This patch adds a fast path: when `init` is a real
(non-Proxy) `Headers` whose `@@iterator` is the original `entries`, one pass over its header list checks that `fill()`
would store every entry unchanged (valid lowercase-stored name, already-normalized valid value, cookies included)
and copies the entries into a new map at the same time. If any entry would be changed or rejected
(e.g. response headers from the network with trailing whitespace, or entries added by an interceptor), it returns
`null` and the existing path runs, so results and errors stay exactly the same.
Update: when an entry would be changed or rejected (e.g. a response header with trailing whitespace, which llhttp
keeps), the entries already copied are kept (they are exactly what `fill()` would have appended, in the same order) and
only the remaining entries go through `appendHeader`, so such a list is still faster than `main` instead of paying for
the fast path and then the full slow path (worst case was 1.6× slower before this change).
`Symbol.iterator` is still read exactly once (the `HeadersInit` conversion now takes the already-read iterator).

## Benchmarks

New micro-benchmark `benchmarks/fetch/headers-copy.mjs` (mitata; no existing benchmark times `new Headers(headers)`).
Command: `node benchmarks/fetch/headers-copy.mjs` in a baseline worktree (origin/main e2d3523b) and in this branch,
interleaved base/patch × 4 runs each, all through a machine-wide benchmark lock. Mean ns/iter (min–max of the 4 run means).
Node v26.13.0, macOS, Apple M5 Pro (15 cores; other work running, so absolute numbers are noisy, ratios are stable).

| case | main | this branch | speedup |
|---|---|---|---|
| empty | 42 (37–47) | 42 (38–48) | 1.00× |
| 8 headers (mixed case) | 933 (865–989) | 489 (441–556) | **1.91×** |
| 16 headers (lowercase) | 1685 (1410–1860) | 931 (815–1120) | **1.81×** |
| 8 headers (3 set-cookie) | 689 (562–871) | 344 (309–407) | **2.00×** |

A cross-check that loads both versions in the same process and runs them in one mitata session
(less exposed to machine drift) gave 1.79× (8 mixed-case), 1.30× (16 lowercase), 1.75× (set-cookie), 1.07× (empty).

## Tests

- `npx borp --timeout 180000 --expose-gc --concurrency 1 -p "test/fetch/*.js"`: 526/526 pass.
- New tests in `test/fetch/headers.js` cover the copy (names, order, combined values, cookies, independence of copy
  and source, immutable source, overridden iterator) and show that entries added internally without normalization
  are still normalized or rejected. They pass on both `main` and this branch.
- WPT: the full runner could not start its server on this machine (it needs `/etc/hosts` entries). The 12
  `fetch/api/headers/*.any.js` files were run through a minimal testharness/vm harness on main and on this branch: the 273 subtest
  results were identical.
- A differential script (20 source shapes: Proxy, subclass, `Object.create(Headers.prototype)`, overridden iterator, cached
  sort, whitespace/NUL/non-Latin-1 values, upper-case map keys, invalid names, deleted set-cookie, …) gives byte-identical
  header lists and errors on main and on this branch. Fuzzing the value check against `headerValueNormalize`+`isValidHeaderValue`
  (500k strings) and the name check against `isValidHeaderName` found 0 mismatches.
- `npm run lint` is clean.

Breaking changes: none. The fast path only runs when `fill()` would store every entry unchanged, and it copies exactly
those entries; in every other case the existing code runs, so the API, results, errors, header casing and order are unchanged.

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.

## End-to-end validation

Rebased on origin/main `3d170a33`. All runs: separate processes (one undici tree per process), order alternated, machine-wide
benchmark lock, macOS / Apple M5 Pro, loadavg ≈ 4–5.

**Node matrix** (`new Headers(headers)` micro-benchmark, median of 3 runs, ns):

| Node | 8 mixed-case | 16 lowercase | 8 with 3 set-cookie | empty |
|---|---|---|---|---|
| 22.23.5 | 664 → 438 (1.52×) | 1236 → 822 (1.50×) | 520 → 321 (1.62×) | 27 → 29 |
| 24.22.3 | 672 → 406 (1.65×) | 1108 → 712 (1.56×) | 508 → 272 (1.87×) | 27 → 30 |
| 26.13.0 | 647 → 348 (1.86×) | 1018 → 640 (1.59×) | 455 → 260 (1.75×) | 29 → 31 |

Copying an empty `Headers` is a few ns slower (the extra checks cost more than they save on 0 entries).

**Real responses.** How often the copy is taken for a `fetch()` response (counter in a throwaway copy): 40/40 popular sites/APIs/CDNs
over HTTPS and 100% of `benchmarks/server.js` responses. Case, duplicates, `set-cookie`, empty values and latin1 bytes all keep the copy.
A header value with trailing whitespace (llhttp keeps it) cannot be copied as is; from that entry on, the remaining entries go through
`appendHeader`, so 24 CDN headers with one such value last are still 1.6× faster than main, and ≈ main when it is first.
A random differential (1M header-list shapes built through the internal list, incl. upper-case keys, whitespace, NUL/CR/LF, invalid
names, cookies) gives identical lists, iteration results and errors on main and on this branch.

**End to end.** Local `node:http` server (24 CDN-style headers, 2 KiB body, keep-alive), 16 concurrent requests, 40 000 per run,
12 paired runs per side. Δ = median of paired differences, bootstrap 95% CI.

| workload | metric | main | branch | Δ | 95% CI |
|---|---|---|---|---|---|
| proxy: fetch → `new Headers(res.headers)` → set/append/delete → forEach → `new Response` | req/s | 22 564 | 23 063 | +2.3% | [+2.1%, +3.6%] |
| | CPU µs/req | 68.9 | 68.2 | −1.4% | [−2.1%, −0.9%] |
| | p50 / p95 µs | 608 / 1745 | 596 / 1709 | −2.1% / −1.8% | both < 0 |
| plain fetch (does not reach this code; control) | req/s | 26 882 | 26 769 | −0.6% | [−1.6%, +0.7%] |

CPU profile of the proxy workload: `new Headers(res.headers)` goes from 5.78% to 3.03% of client CPU (inclusive).

Related upstream: #5699 also clones the list in `new Headers(headers)` as part of a larger rewrite, but without re-normalizing, so
values with trailing whitespace would stay un-normalized; this change keeps the result identical to `fill()`.
