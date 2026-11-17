import { bench, group, run } from 'mitata'
import { interceptors } from '../../index.js'

// Drives DecompressHandler#onResponseStart for a gzip response with 12 raw
// header Buffers, which filters out content-encoding/content-length.
const names = ['Date', 'Content-Type', 'Content-Encoding', 'Content-Length', 'Vary', 'Cache-Control', 'ETag', 'Last-Modified', 'Server', 'X-Request-Id', 'Access-Control-Allow-Origin', 'Connection']
const rawHeaders = []
const headers = {}
for (const name of names) {
  const value = name === 'Content-Encoding' ? 'gzip' : 'value'
  rawHeaders.push(Buffer.from(name), Buffer.from(value))
  headers[name.toLowerCase()] = value
}

const noop = () => {}
const handler = { onRequestStart: noop, onResponseStart: noop, onResponseData: noop, onResponseEnd: noop, onResponseError: noop }

const dispatch = interceptors.decompress()((opts, h) => {
  const controller = { rawHeaders: rawHeaders.slice(), pause: noop, resume: noop, abort: noop }
  h.onRequestStart(controller, {})
  h.onResponseStart(controller, 200, headers, 'OK')
  h.onResponseEnd(controller, {})
  return controller.rawHeaders
})

group('decompress interceptor', () => {
  bench('onResponseStart (gzip, 12 raw headers)', () => {
    return dispatch({ method: 'GET' }, handler)
  })
})

await run()
