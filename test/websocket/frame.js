'use strict'

const { test } = require('node:test')
const { WebsocketFrameSend } = require('../../lib/web/websocket/frame')
const { opcodes } = require('../../lib/web/websocket/constants')

// Always be above all tests.
test('Don not use pooled buffer in mask pool', (t) => {
  const allocUnsafe = Buffer.allocUnsafe
  let counter = 0
  try {
    Buffer.allocUnsafe = (n) => {
      counter++
      return allocUnsafe(n)
    }
    // create mask pool
    new WebsocketFrameSend(Buffer.alloc(0)).createFrame(opcodes.BINARY)
    t.assert.strictEqual(counter, 1)
  } finally {
    Buffer.allocUnsafe = allocUnsafe
  }
})

test('Writing 16-bit frame length value at correct offset when buffer has a non-zero byteOffset', (t) => {
  /*
  When writing 16-bit frame lengths, a `DataView` was being used without setting a `byteOffset` into the buffer:
  i.e. `new DataView(buffer.buffer)` instead of `new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)`.
  Small `Buffers` returned by `allocUnsafe` are usually returned from the buffer pool, and thus have a non-zero `byteOffset`.
  Invalid frames were therefore being returned in that case.
  */
  const payloadLength = 126 // 126 bytes is the smallest payload to trigger a 16-bit length field
  const smallBuffer = Buffer.allocUnsafe(1) // make it very likely that the next buffer returned by allocUnsafe DOESN'T have a zero byteOffset
  const payload = Buffer.allocUnsafe(payloadLength).fill(0)
  const frame = new WebsocketFrameSend(payload).createFrame(opcodes.BINARY)

  t.assert.strictEqual(frame[2], payloadLength >>> 8)
  t.assert.strictEqual(frame[3], payloadLength & 0xff)
  t.assert.strictEqual(smallBuffer.length, 1) // ensure smallBuffer can't be garbage-collected too soon
})

test('Frames are masked correctly for every payload length remainder', (t) => {
  const { randomBytes } = require('node:crypto')

  function unmask (frame, headerLength, payloadLength, body = frame.subarray(headerLength + 4)) {
    const mask = frame.subarray(headerLength, headerLength + 4)
    const out = Buffer.allocUnsafe(payloadLength)
    for (let i = 0; i < payloadLength; ++i) {
      out[i] = body[i] ^ mask[i & 3]
    }
    return out
  }

  for (const length of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 125, 126, 127, 1023, 65535, 65536, 65539]) {
    const payload = randomBytes(length)
    const headerLength = length > 65535 ? 10 : length > 125 ? 4 : 2

    const frame = new WebsocketFrameSend(payload).createFrame(opcodes.BINARY)
    t.assert.strictEqual(frame.length, headerLength + 4 + length)
    t.assert.deepStrictEqual(unmask(frame, headerLength, length), payload)

    const text = Buffer.from(payload)
    const [head, body] = WebsocketFrameSend.createFastTextFrame(text)
    t.assert.strictEqual(head.length, headerLength + 4)
    t.assert.strictEqual(body, text)
    t.assert.deepStrictEqual(unmask(head, headerLength, length, body), payload)
  }
})

test('Frames are masked correctly for long payloads at every byte alignment', (t) => {
  const { randomBytes } = require('node:crypto')

  function unmask (mask, body, payloadLength) {
    const out = Buffer.allocUnsafe(payloadLength)
    for (let i = 0; i < payloadLength; ++i) {
      out[i] = body[i] ^ mask[i & 3]
    }
    return out
  }

  for (const length of [255, 256, 257, 258, 259, 260, 1021, 4096, 65537]) {
    for (let shift = 0; shift < 4; ++shift) {
      const backing = randomBytes(length + 8)
      const payload = backing.subarray(shift, shift + length)
      const expected = Buffer.from(payload)
      const headerLength = length > 65535 ? 10 : length > 125 ? 4 : 2

      const frame = new WebsocketFrameSend(payload).createFrame(opcodes.BINARY)
      const mask = frame.subarray(headerLength, headerLength + 4)
      t.assert.deepStrictEqual(unmask(mask, frame.subarray(headerLength + 4), length), expected)
      t.assert.deepStrictEqual(payload, expected) // source is not modified

      const text = Buffer.from(backing).subarray(shift, shift + length)
      const [head, body] = WebsocketFrameSend.createFastTextFrame(text)
      t.assert.strictEqual(body, text)
      t.assert.deepStrictEqual(unmask(head.subarray(headerLength, headerLength + 4), body, length), expected)
    }
  }
})
