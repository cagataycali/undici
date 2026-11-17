> Owner-review note: remove this PR.md before opening the real PR.

# perf(cache): build stripped cache headers in one pass

Before the cache interceptor stores a response, `stripNecessaryHeaders` removes hop-by-hop headers. It used to do this with `{ ...resHeaders }` followed by `delete`. Almost every HTTP/1.1 response has `connection: keep-alive` (often with `keep-alive: timeout=…`), so in practice every stored entry went through that `delete`, which leaves the stored headers object in slow dictionary mode. Every cache hit then spreads that object again (`{ ...result.headers, age }`) and walks it in `toRawHeaders`.

This change builds the copy in one pass over `Object.keys`, skipping the names to remove. Own `__proto__` keys are kept with `defineProperty`, as before, and own enumerable Symbol keys are copied the way spread copies them. When nothing needs stripping, the original object is still returned.

Breaking changes: none. The stored headers have the same own keys, values, property descriptors and order as before, and the function returns the original object in exactly the same cases. A 200k-case fuzz against main checked this (below). No API, option, type or behaviour changes.

## Benchmarks
Same-process A/B (main and the patched `lib/handler/cache-handler.js` loaded side by side), alternating rounds, median of 15 rounds × 50k iterations. An A/A control loads main twice. Run under the machine-wide bench lock (loadavg 4.91 / 6.18 / 7.24). Node v26.13.0, Apple M5 Pro (darwin arm64, 15 cores). Numbers are ns/op from the locked run; a second and third locked run agreed within a few %.

| case | main | patched | Δ | A/A Δ |
|---|---|---|---|---|
| strip, 10 headers incl. connection/keep-alive | 288.9 | 247.9 | −14% | 0.0% |
| strip, 5 headers | 393.6 | 360.2 | −8.5% (−32% in other runs) | 0.2% |
| strip, 20 headers | 406.2 | 456.7 | **+12%** (one-time, at store) | −0.1% |
| strip, 12 headers + `no-cache="set-cookie"`, `private="x-user"` | 349.9 | 329.9 | −6% | 0.4% |
| strip, nothing to strip (identity) | 52.3 | 50.2 | ~0 | 0.4% |
| **cache-hit serve** (`toRawHeaders({ ...stored, age })`), 10 headers | 1721 | 1166 | **−32%** | −0.3% |
| cache-hit serve, 5 headers | 708 | 485 | −32% | 0.5% |
| cache-hit serve, 20 headers | 3472 | 2212 | **−36%** | −0.2% |
| cache-hit serve, 12 headers (no-cache/private) | 1623 | 1048 | −35% | 1.1% |
| cache-hit serve, nothing stripped | 1617 | 1620 | ~0 | 1.3% |
| strip + read result back, 10 headers | 436 | 294 | −33% | — |

End-to-end (in-process `http` server, `interceptors.cache` + `MemoryCacheStore`, 8 connections, median of 24 interleaved rounds × 2000 requests). Cache hit is about 18–21 µs/req. The expected gain from the table above is about 0.5–1.3 µs (~3–5%), but run-to-run variation (A/A −6% to −9%) is larger than that, so this busy laptop **could not confirm** the end-to-end gain (A/B +11% and −2% in two runs). Miss+store is ~24 µs/req; the store-time difference is ±50 ns, well under the noise.

The only regression is store-time stripping with many (~20) headers (+~50 ns, once per stored response). Each later hit on that entry saves ~1.3 µs.

No existing benchmark in `benchmarks/` covers this function, and it is not exported. The A/B script loads the module source with `module.exports.__strip = stripNecessaryHeaders` appended (it lives outside the repo and is available on request).

## Tests
- `npx borp -p "test/cache-interceptor/*.js" -p "test/interceptors/cache*.js"`: 166/166 pass
- `npm run test:cache-tests` (http-cache cache-tests suite): 219 passed / 0 failed / 52 optional failures / 4 setup failed, identical to main
- Fuzz vs main, 200,000 random cases: connection as string/array with OWS and case variants, `no-cache` / `private` field-name lists (quoted, unquoted, with whitespace), `__proto__` / `constructor` / numeric names, Symbol and non-enumerable keys, null-prototype input. Own-property descriptors, order and identity-return were identical in every case.
- `npm run lint` clean

Overlap: P36 (`trimOWS` without regex) and P40 (Vary single scan) touch other functions in the same file. This diff is independent of both and is based on origin/main.

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.
