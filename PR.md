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
