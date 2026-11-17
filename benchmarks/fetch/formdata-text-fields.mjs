import { group, bench, run } from 'mitata'
import { Response } from '../../lib/web/fetch/response.js'

// Multipart bodies made only of text (non-file) fields, which are decoded as
// UTF-8 strings by the multipart/form-data parser.
const boundary = '----undici-bench-boundary'

function makeBody (count, size) {
  const value = 'x'.repeat(size)
  let body = ''
  for (let i = 0; i < count; i++) {
    body += `--${boundary}\r\nContent-Disposition: form-data; name="field${i}"\r\n\r\n${value}\r\n`
  }
  body += `--${boundary}--\r\n`
  return Buffer.from(body)
}

const settings = {
  '20 fields x 12 B': makeBody(20, 12),
  '20 fields x 1 KiB': makeBody(20, 1024),
  '4 fields x 64 KiB': makeBody(4, 64 * 1024)
}

const headers = { 'content-type': `multipart/form-data; boundary=${boundary}` }

for (const [name, body] of Object.entries(settings)) {
  group(name, () => {
    bench('Response#formData', async () => {
      return await new Response(body, { headers }).formData()
    })
  })
}

await run()
