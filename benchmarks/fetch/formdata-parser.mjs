import { bench, group, run } from 'mitata'
import { multipartFormDataParser } from '../../lib/web/fetch/formdata-parser.js'
import { parseMIMEType } from '../../lib/web/fetch/data-url.js'

const boundary = '----formdata-undici-0123456789012'
const mimeType = parseMIMEType(`multipart/form-data; boundary=${boundary}`)

function build (fields, file) {
  let body = ''
  for (let i = 0; i < fields; i++) {
    body += `--${boundary}\r\nContent-Disposition: form-data; name="field${i}"\r\n\r\nvalue${i}\r\n`
  }
  if (file) {
    body += `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\n${file}\r\n`
  }
  return Buffer.from(body + `--${boundary}--`)
}

const smallFields = build(20)
const oneFile = build(0, 'hello world')
const mixed = build(5, 'x'.repeat(64 * 1024))

group('multipartFormDataParser', () => {
  bench('20 small fields', () => multipartFormDataParser(smallFields, mimeType))
  bench('1 file part', () => multipartFormDataParser(oneFile, mimeType))
  bench('5 fields + 64 KiB file', () => multipartFormDataParser(mixed, mimeType))
})

await run()
