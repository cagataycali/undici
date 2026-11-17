> Owner review file — remove PR.md before opening the real PR.

# perf(cookies): validate cookie names with the shared token-char table

`validateCookieName()` (called by `setCookie()` for every cookie) checked each character against a 19-way
comparison chain. A cookie name is an RFC 7230 `token` (RFC 6265 §4.1.1), which is exactly the set already
encoded in `validTokenChars` in `lib/core/util.js`. This reuses `isTokenCharCode()` — a single table lookup per
character — and adds a test that checks every UTF-16 code unit (0–0xFFFF) is accepted/rejected exactly as before.

## Benchmarks

Node v26.13.0, macOS darwin arm64 (Apple M-series, 15 cores), mitata. Baseline (`origin/main` e2d3523b) and patched
interleaved in one session, serialised through a machine-wide bench lock.

| Benchmark | baseline (mean, range) | patched (mean, range) | change |
|---|---|---|---|
| `node benchmarks/cookies/validate-cookie-name.mjs` — `Cat` (4 runs each) | 3.44 ns (3.39–3.52) | 2.15 ns (2.10–2.21) | **1.60× faster (−37%)** |
| same, ad-hoc name `__Secure-next-auth.session-token` (3 runs each, not committed) | 36.9 ns (35.8–37.6) | 19.0 ns (18.5–20.1) | **1.94× faster (−48%)** |

## Tests

`npm run lint` clean; `node --test test/cookie/*.js` 94/94; `npm run test:unit` 1688 pass / 0 fail (3 skipped).
The new exhaustive test in `test/cookie/validate-cookie-name.js` passes on both baseline and patched code.

Breaking changes: none — same accepted character set (verified for all 65,536 code units, plus the empty name),
same `Error('Invalid cookie name')`, no API/type/dependency changes.

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.
