> Owner review file — remove PR.md before opening the real PR.

# perf(interceptor): reuse resolved origin URLs in the dns interceptor

With a warm DNS cache, every request through `interceptors.dns()` built a template string and parsed it with
`new URL()` only to read `.origin` / `.hostname`. The instance now keeps a small `href → URL` map (cleared at 256
entries) for the resolved origin; the key is the full `protocol//address:port` string, so protocols, families and
ports never share an entry, and records/TTL/affinity/pick logic is untouched (the lookup and pick still run per request).
It also gates `isHostHeader` on `key.length === 4` before `toLowerCase()`, which skips an allocation per mixed-case header name.

Breaking changes: none — the resolved URL is internal (never passed to `lookup`/`pick`/user code, only `.origin` and
`.hostname` are read), and the dispatch options (`origin` string, `servername`, `host` header) are byte-identical.

## Benchmarks
Same-process A/B with an A/A control (base vs. an identical copy of base), 7 interleaved rounds × 200k calls, 3 processes,
under `work/scripts/bench-lock.sh` (loadavg 7.59 8.07 8.35). Node v26.13.0, macOS arm64 (Apple M-series, 15 cores).
Interceptor over a stub dispatch, warm cache (mean of the 3 runs):

| case | main | P37 only | P37 + host gate | A/A |
|---|---|---|---|---|
| string origin, 1 header | 804 ns | 662 ns (−18%) | 646 ns (−20%) | +5% |
| URL origin, 1 header | 482 ns | 352 ns (−27%) | 340 ns (−29%) | −1% |
| string origin, 8 mixed-case headers | 800 ns | 661 ns (−17%) | 578 ns (−28%) | +1% |

End-to-end (honest share): `request()` keep-alive to a local HTTP server through `Agent.compose(dns())` is ~33–41 µs per
request; the saving (~190–280 ns) is **~0.5–0.7% of a request**, below the ±5% A/A noise of that measurement, so the
end-to-end gain is not separately visible. This is an isolated-path win.

New micro-benchmark: `node benchmarks/interceptor/dns.mjs` (mitata; no existing benchmark covered the interceptor).

## Tests
`npx borp -p "test/interceptors/dns*.js"`: 34 pass, 3 skipped (IPv6 not available locally, same on main); a new test checks
that cached resolution keeps ports, protocols and families separate across repeated requests. `npm run lint` clean.

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.
