> Owner review only — remove this file before opening the real PR.

# perf(cache): parse Vary in a single pass

`isInvalidOrWildcardVaryHeader()` called `hasVaryStar()` (split + trim every part), then `parseVaryHeader()`, which called `hasVaryStar()` again and split a third time. Both functions now walk the comma-separated parts once: a part containing `*` returns the wildcard result immediately (it still wins over an earlier invalid token, as before), and an invalid non-empty token makes the result `undefined` / `true`. `parseVaryHeader` collects the names first and only reads request headers once the value is known to be valid, so the lookups match main's exactly. The cache interceptor calls these for every response that has a `Vary` header.

## Benchmarks

Same-process A/B with an A/A control: `main` and `main2` are two separately loaded copies of `origin/main`'s `lib/util/cache.js`, `patched` is this branch. 5 interleaved rounds × 400k iterations per process, 3 processes, run through the machine bench lock (loadavg at start `6.57 7.99 8.38`). Inputs are the 5 values in `benchmarks/cache/vary.mjs` (added in this PR): `Accept-Encoding`, `Accept-Encoding, Origin`, `accept, accept-encoding , Accept-Language`, `['Accept-Encoding', 'Origin']` and `*`. Numbers are ns per call.

| function | main (A) | main2 (A/A) | patched | Δ vs main |
|---|---|---|---|---|
| parseVaryHeader — run 1 | 342.6 | 361.4 | 254.1 | −26% |
| parseVaryHeader — run 2 | 361.3 | 355.1 | 254.3 | −30% |
| parseVaryHeader — run 3 | 332.5 | 324.9 | 231.1 | −30% |
| isInvalidOrWildcardVaryHeader — run 1 | 568.0 | 605.3 | 240.7 | −58% |
| isInvalidOrWildcardVaryHeader — run 2 | 488.9 | 468.2 | 170.4 | −65% |
| isInvalidOrWildcardVaryHeader — run 3 | 389.1 | 384.5 | 139.6 | −64% |

In every run, the two copies of main differed by 7% or less, well below the measured gains.

Node v26.13.0, macOS arm64 (Apple M-series, 15 cores). Reproduce: `node benchmarks/cache/vary.mjs` (mitata) on main vs this branch.

## Equivalence

I fuzz-compared the main and patched `parseVaryHeader`, `isInvalidOrWildcardVaryHeader` and `hasVaryStar` on 300k random values: strings and arrays built from tokens, `*`, `a*b`, ` * `, spaces/tabs, empty parts (`,,`), duplicates, mixed case, invalid tokens (`a b`, `"q"`, `(`), non-ASCII (`é`, `İ`, the Kelvin sign U+212A, which lower-cases to a valid `k`), and `__proto__`/`constructor`. The checks were deep equality, the same key order, the same prototype, and identical `headers` identity for the wildcard result. There were 0 differences.

## Tests

`npm run lint` is clean for the changed files. `node --test test/cache-interceptor/*.js test/interceptors/cache*.js test/cache/*.js` gives 258/258 pass. The cache-tests suite was skipped because its fixture submodule isn't checked out locally.

Breaking changes: none. Both functions return identical values for every input (the same object, `headers` identity for `*` and `undefined` for invalid), and no exports or signatures change.

Overlap: P36 (`perf/cache-trimows-no-regex`) and P38 also touch `lib/util/cache.js`. This diff comes straight from `origin/main` and is independent of theirs; if they land first, a trivial rebase may be needed.

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.

## Re-verified (rotated load order)

Re-run 2026-11-17 after finding that in one process the last-loaded undici copy can run 20–30% slower whatever its code. A and A' are two separate extracted copies of base `3d170a33`'s tree, B is this branch. Each call cycles through the same 5 inputs. Each load order runs in its own process (3 orders × 2 processes, 9 alternating rounds × 200k calls, median ns/call), under the bench lock (loadavg 4.4). Node v26.13.0, darwin arm64. The gain holds in every order and A/A stays within ±1.6%.

### parseVaryHeader
| order | A (base) | A' (base copy) | B (patch) | A'/A | B/A |
|---|---|---|---|---|---|
| A,B,A2 | 220.8 | 223.3 | 158.5 | +1.1% | -28.2% |
| A,B,A2 | 222.6 | 225.8 | 161.7 | +1.4% | -27.4% |
| B,A2,A | 225.1 | 227.4 | 157.7 | +1.0% | -29.9% |
| B,A2,A | 225.8 | 223.6 | 159.2 | -1.0% | -29.5% |
| A2,A,B | 220.6 | 222.7 | 156.6 | +1.0% | -29.0% |
| A2,A,B | 223.0 | 220.8 | 156.7 | -1.0% | -29.7% |
| **geo-mean over orders** | | | | **+0.4%** | **-29.1%** vs mean(A,A') |

### isInvalidOrWildcardVaryHeader
| order | A (base) | A' (base copy) | B (patch) | A'/A | B/A |
|---|---|---|---|---|---|
| A,B,A2 | 295.2 | 300.0 | 113.3 | +1.6% | -61.6% |
| A,B,A2 | 296.3 | 294.5 | 112.5 | -0.6% | -62.0% |
| B,A2,A | 300.6 | 298.2 | 111.7 | -0.8% | -62.8% |
| B,A2,A | 297.5 | 300.3 | 115.3 | +0.9% | -61.3% |
| A2,A,B | 293.7 | 291.1 | 109.9 | -0.9% | -62.6% |
| A2,A,B | 301.7 | 298.9 | 114.8 | -0.9% | -61.9% |
| **geo-mean over orders** | | | | **-0.1%** | **-62.0%** vs mean(A,A') |

