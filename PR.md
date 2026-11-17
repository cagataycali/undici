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
