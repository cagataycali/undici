> Owner-review file — remove `PR.md` before opening the real PR.

# perf(fetch): skip the Buffer.concat copy in text()/json() for single-chunk bodies

`readAllBytes()` always ran `Buffer.concat(chunks, length)`, so a body that arrived as one
chunk was copied once before `text()`/`json()` decoded it. Those two consumers read the bytes
synchronously (UTF-8 decode, then `JSON.parse` on the string) and keep no reference to them, so
`readAllBytes()`/`fullyReadBody()`/`consumeBody()` now take an internal, optional `readOnly`
flag; when it is set and exactly one chunk was received, that chunk is handed over as is.
`arrayBuffer()`, `bytes()`, `blob()`, `formData()` and the Cache API call it without the flag
and keep the copy, so they still own fresh memory. Zero or multiple chunks take the old path.

The chunk may be a plain `Uint8Array` or a view into a larger buffer (offset/length are respected
by `TextDecoder.decode` and `subarray`, used for the BOM). Decoding still happens at the same
moment as before (after the stream reports done), so a producer mutating its chunk later sees
the same result as with the copy. A new test in `test/fetch/response.js` covers a single-chunk
view with surrounding bytes and a BOM for text()/json(), and checks bytes()/arrayBuffer() still
return memory that is not the chunk's buffer.

## Benchmarks

`cd benchmarks && node fetch/body-arraybuffer.mjs` (existing, mitata) plus an out-of-tree
mitata script of the same shape that also times `json()` on a JSON body and adds a 1 MiB size
(not committed; source below). Baseline = origin/main e2d3523b, patched = this branch,
5 runs each, interleaved baseline/patched, serialized by a machine-wide bench lock.
Node v26.13.0, Apple M5 Pro (15 cores), macOS. Mean (min–max), per iteration:

| benchmark | size | baseline | patched | change |
|---|---|---|---|---|
| body-arraybuffer.mjs `Response#text` | 512 B | 1.70 µs (1.25–2.04) | 1.66 µs (1.29–1.92) | noise |
| body-arraybuffer.mjs `Response#text` | 8 KiB | 3.12 µs (2.51–3.66) | 2.74 µs (2.21–3.16) | −12.1 % |
| body-arraybuffer.mjs `Response#text` | 128 KiB | 30.96 µs (29.57–33.73) | 26.53 µs (25.38–29.00) | −14.3 % |
| text/json script `Response#text` | 8 KiB | 2.98 µs | 2.64 µs | −11.5 % |
| text/json script `Response#text` | 128 KiB | 27.86 µs | 25.49 µs | −8.5 % |
| text/json script `Response#text` | 1 MiB | 163.4 µs (150.3–182.5) | 122.2 µs (113.3–137.4) | −25.2 % |
| text/json script `Response#json` | 8 KiB | 6.17 µs | 5.66 µs | −8.2 % |
| text/json script `Response#json` | 128 KiB | 77.03 µs | 68.76 µs | −10.7 % |
| text/json script `Response#json` | 1 MiB | 685.2 µs | 628.1 µs | −8.3 % |
| control: `Response#arrayBuffer` | all | unchanged (+1.7…2.6 %, within spread) | | — |

Bodies under ~4 KiB were already a cheap pooled copy, so the small case is within noise.
For `fetch()` over the network, large bodies usually arrive in several chunks and keep the
old path; the gain applies to single-chunk bodies (`new Response(buffer|string)`, small and
medium network responses, single-enqueue streams).

<details><summary>text/json script</summary>

```js
import { group, bench, run } from 'mitata'
import { Response } from '../../lib/web/fetch/response.js'
const settings = { small: 2 << 8, middle: 2 << 12, long: 2 << 16, large: 2 << 19 }
for (const [name, length] of Object.entries(settings)) {
  const text = Buffer.from(JSON.stringify({ a: 'x'.repeat(length - 10) }))
  group(`${name} (length ${text.length})`, () => {
    bench('Response#text', async () => await new Response(text).text())
    bench('Response#json', async () => await new Response(text).json())
  })
}
await run()
```
</details>

## Tests

`npm run lint` clean. `borp --expose-gc -p "test/fetch/*.js"`: 518 tests, 0 failures (after
`npm run build:node`, which the bundle/max-header-size tests need). `test/cache` + `test/busboy`:
49/49. New test: "single chunk that is a view into a larger buffer" in test/fetch/response.js.
WPT: not run locally (hosts setup needs sudo; upstream CI runs it).

Breaking changes: none — only internal helpers gain an optional trailing parameter that defaults
to the old behaviour; every public method returns the same values and errors, and the
copy-owning consumers (arrayBuffer/bytes/blob/formData/Cache) are untouched.

AI assistance: this change was researched and drafted with AI (tiny / Claude) and reviewed by the author.
