'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { ByteParser } = require('../../lib/web/websocket/receiver')
const { states } = require('../../lib/web/websocket/constants')

function header (byte0, length, encoding) {
  if (encoding === 7) return Buffer.from([byte0, length])
  if (encoding === 16) {
    const head = Buffer.from([byte0, 126, 0, 0])
    head.writeUInt16BE(length, 2)
    return head
  }
  const head = Buffer.from([byte0, 127, 0, 0, 0, 0, 0, 0, 0, 0])
  head.writeUInt32BE(length, 6)
  return head
}

// Text "abc" in 3 fragments with a ping in between, a 300 byte binary
// frame with a 16-bit length, 5 bytes with a (non-minimal) 64-bit length,
// an empty text frame and a close frame.
const stream = Buffer.concat([
  header(0x01, 1, 7), Buffer.from('a'),
  header(0x89, 2, 7), Buffer.from('hi'),
  header(0x00, 1, 7), Buffer.from('b'),
  header(0x80, 1, 7), Buffer.from('c'),
  header(0x82, 300, 16), Buffer.alloc(300, 7),
  header(0x82, 5, 64), Buffer.from([1, 2, 3, 4, 5]),
  header(0x81, 0, 7),
  header(0x88, 2, 7), Buffer.from([0x03, 0xe8])
])

function parse (chunks) {
  const events = []
  const handler = {
    readyState: states.OPEN,
    closeState: new Set(),
    socket: { writableNeedDrain: false, write () {}, once () {}, end () {}, destroy () {} },
    controller: { abort () {} },
    onMessage (type, data) { events.push(`message:${type}:${Buffer.from(data).toString('hex')}`) },
    onPing (data) { events.push(`ping:${data.toString()}`) },
    onPong () {},
    onSocketClose () {},
    onSocketError () {},
    onParserError (err) { events.push(`error:${err.message}`) },
    onFail (code, reason) { events.push(`fail:${code}:${reason}`) }
  }
  const parser = new ByteParser(handler, null)
  for (const chunk of chunks) parser.write(chunk)
  events.push(`close:${JSON.stringify(parser.closingInfo ?? null)}`)
  return events.join('|')
}

test('frames parse the same however the stream is split into chunks', () => {
  const expected = parse([stream])
  assert.ok(expected.includes('message:1:616263'))

  for (let i = 0; i <= stream.length; i++) {
    for (let j = i; j <= stream.length; j++) {
      const chunks = [stream.subarray(0, i), stream.subarray(i, j), stream.subarray(j)]
      assert.strictEqual(parse(chunks), expected, `split at ${i} and ${j}`)
    }
  }

  const bytes = Array.from(stream, (byte) => Buffer.from([byte]))
  assert.strictEqual(parse(bytes), expected, 'one byte per chunk')
})
