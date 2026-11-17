> Owner-review file — remove `PR.md` before opening the real PR.

# perf(cookies): parse getCookies() pieces with indexOf instead of split + rest spread

`getCookies()` split each `;`-piece again on `=` and rebuilt the value with `[name, ...value]` + `value.join('=')`,
allocating two arrays and a rest copy per cookie. It now finds the first `=` with `indexOf` and takes the name/value with
`slice`. Output is the same: `=` inside a value is kept, a piece with no `=` still maps to `''`, the name is still trimmed,
and keys keep the same insertion order on the null-prototype object. Adds `benchmarks/cookies/get-cookies.mjs` (no benchmark existed for this path).

Breaking changes: none — internal parsing only; same return object, keys, values and order for every input (checked
against the old implementation on 20,013 inputs, incl. `a`, `=`, `a==b`, `;;`, whitespace and `__proto__`, 0 mismatches).

## Benchmarks

`node benchmarks/cookies/get-cookies.mjs` (mitata), baseline = origin/main `e2d3523b`, interleaved base/patch × 4 runs
through the machine bench lock. Node v26.13.0, macOS darwin arm64 (Apple Silicon MacBook Pro, 15 cores).
The benchmark cycles through 1024 distinct, runtime-built headers, because real cookie headers are fresh strings per request.

| case | baseline (mean of 4, range) | patched (mean of 4, range) | change |
|---|---|---|---|
| 1 cookie | 381 ns (350–427) | 304 ns (267–333) | **−20%** |
| 6 cookies (incl. `=` in value, valueless `flag`) | 1115 ns (946–1370) | 730 ns (641–781) | **−35%** |

Note: with a single *constant literal* header reused in a loop, the baseline is faster for 1 cookie (~100 ns vs ~190 ns),
because V8 caches `String#split` results for internalized strings. That case does not happen with real headers,
which is why the benchmark uses distinct values.

## Tests

`npm run lint` clean; `npx borp -p "test/cookie/**/*.js"` 93/93 pass; `npm run test:unit` 1688 pass, 0 fail.

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.
