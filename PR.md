> Owner review note: remove this PR.md before opening the real PR.

# perf(fetch): iterate value pairs directly in Headers/FormData forEach

`forEach()` from the WebIDL iterator mixin (used by `Headers` and `FormData`) built a
`FastIterableIterator` and pulled every entry through `next()`, paying a private brand check,
an iterator result object and a `[key, value]` array per entry. It now reads the value pairs
directly, which is also how WebIDL defines `forEach`. The pairs are re-read on every step,
so entries added or removed by the callback are observed exactly as before.

## Benchmarks

`node benchmarks/fetch/headers-foreach.mjs` (new mitata micro-benchmark; no existing benchmark covers forEach).
Baseline = origin/main `e2d3523b`, patched = this branch, interleaved base/patch × 3 runs through the
machine-wide bench lock. Node v26, Apple Silicon (darwin arm64, 15 cores), loadavg at start 6.67 6.91 7.41.
Mean of 3 runs (min–max).

| Benchmark | Entries | Baseline | Patched | Speed-up |
|---|---|---|---|---|
| Headers#forEach | 4 | 136 ns (113–157) | 68 ns (53–78) | 2.02× |
| Headers#forEach | 16 | 990 ns (884–1110) | 250 ns (204–288) | 3.96× |
| Headers#forEach | 64 | 3410 ns (2860–3740) | 931 ns (809–1070) | 3.66× |
| FormData#forEach | 4 | 301 ns (277–348) | 55 ns (44–64) | 5.46× |
| FormData#forEach | 16 | 901 ns (740–1030) | 218 ns (188–245) | 4.14× |
| FormData#forEach | 64 | 2540 ns (1970–3100) | 750 ns (627–827) | 3.38× |

## Tests

`npm run lint` clean. `node --test test/fetch/headers.js test/fetch/formdata.js test/fetch/iterators.js` 108/108 pass,
including a new test that deletes/appends headers from inside the callback. `npx borp -p "test/fetch/*.js"`:
475 pass / 19 fail on both baseline and patched with an identical failure list (the 19 are local-environment
failures: GC-flag, bundle and env-proxy tests). A side-by-side script (callback mutations on Headers and
FormData, `thisArg`, third argument, brand-check / argument-count / non-function errors) prints identical
output on baseline and patched.
WPT: not run locally (hosts setup needs sudo; upstream CI runs it).

Breaking changes: none. Same callback arguments, `this`, order, error types and messages, and the same
behaviour when the callback modifies the object; only the internal iterator allocation is gone.
(Only side effect: monkey-patching the internal `Headers Iterator.prototype.next` no longer changes `forEach`,
which matches the WebIDL spec — `forEach` is not defined in terms of the iterator.)

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.

## End-to-end validation

Rebased on origin/main `3d170a33`. Every run below is a separate process (main = `git archive origin/main`), with order rotated, through the bench lock.
Full data: owner workspace `work/top5/DEEP-P16.md`.

**Spec.** WebIDL §3.7.9 ([#js-iterable](https://webidl.spec.whatwg.org/#js-iterable)) defines pair-iterator `forEach` as:
> Let pairs be idlObject's list of value pairs to iterate over. Let i be 0. While i < pairs's size: Let pair be pairs[i].
> Invoke idlCallback with « pair's value, pair's key, idlObject » and with thisArg as the callback this value.
> Set pairs to idlObject's current list of value pairs to iterate over. (It might have changed.) Set i to i + 1.

The new loop is this algorithm line for line. No iterator object is involved.

**Node matrix** (micro, 3 runs/side, median ns/op, loadavg 4.8):
| Node | Headers 4 / 16 / 64 | FormData 4 / 16 / 64 |
|---|---|---|
| 22.23.5 | 1.66× / 2.43× / 1.97× | 4.47× / 2.23× / 2.08× |
| 24.22.3 | 1.59× / 2.66× / 2.37× | 2.57× / 3.08× / 3.01× |
| 26.13.0 | 1.59× / 2.97× / 2.76× | 4.22× / 3.16× / 3.03× |

Faster on every supported engine, with no regression in any cell.

**End-to-end** (full `fetch()` against a local `node:http` upstream with 22 headers, concurrency 16, 20k requests, 12 runs/side, bootstrap 95% CI over paired runs):
| workload | Δ req/s | Δ CPU/req | 95% CI |
|---|---|---|---|
| proxy: `new Headers(res.headers)` → set/append/delete → `forEach` → `text()` | −0.19% | +0.40% | contains 0 |
| adapter: `res.headers.forEach` → object → `text()` | +0.16% | −0.67% | contains 0 |

**Not statistically detectable end to end.** forEach saves ~0.4 µs per call, and a localhost fetch costs ~85 µs of CPU.
`--cpu-prof` agrees. On a freshly built `Headers`, forEach's own cost is dominated by the first-time sort/combine (~1.7% CPU, unchanged by this PR). The iterator `next` frame (0.53% self) disappears, and nothing in the top 10 changes.
This PR is therefore a 2–4× speedup of a per-request API, and makes no `fetch()` throughput claim.

**Reach.** `Headers#forEach` is the idiomatic "copy all headers" call in framework adapters:
- Next.js `next-server.ts` (middleware response headers, every request)
- Hono `request.ts` `c.req.header()` and its AWS Lambda / Lambda@Edge adapters (every response)
- Astro's memory cache provider

**Prior art.**
- #2692 and #2743 (merged) built the shared `iteratorMixin`; this PR removes the iterator from forEach.
- #2560 was closed because a faster FormData forEach mishandled entries inserted during iteration. This PR re-reads the pairs each step, as the spec says, and adds mutation tests for both Headers and FormData. 12 mutation scenarios print identical output on main and the branch.
- #5699 (open) rewrites `headers.js` storage but keeps `iteratorMixin(…, headersListSortAndCombine, 0, 1)`, so the two don't conflict.
