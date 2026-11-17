'use strict'

const { runtimeFeatures } = require('../../util/runtime-features')
const { maxUnsigned16Bit, opcodes } = require('./constants')

const BUFFER_SIZE = 8 * 1024

let buffer = null
let bufIdx = BUFFER_SIZE

const randomFillSync = runtimeFeatures.has('crypto')
  ? require('node:crypto').randomFillSync
  : null

function generateMask () {
  if (bufIdx === BUFFER_SIZE) {
    bufIdx = 0
    randomFillSync((buffer ??= Buffer.allocUnsafeSlow(BUFFER_SIZE)), 0, BUFFER_SIZE)
  }
  return [buffer[bufIdx++], buffer[bufIdx++], buffer[bufIdx++], buffer[bufIdx++]]
}

/**
 * Writes a fresh 4-byte masking key into `target` at `offset..offset + 3`
 * without allocating an intermediate array.
 * @param {Uint8Array} target
 * @param {number} offset
 */
function writeMask (target, offset) {
  if (bufIdx === BUFFER_SIZE) {
    bufIdx = 0
    randomFillSync((buffer ??= Buffer.allocUnsafeSlow(BUFFER_SIZE)), 0, BUFFER_SIZE)
  }
  target[offset] = buffer[bufIdx++]
  target[offset + 1] = buffer[bufIdx++]
  target[offset + 2] = buffer[bufIdx++]
  target[offset + 3] = buffer[bufIdx++]
}

/**
 * XORs `length` bytes of `source` with the 4-byte mask (m0..m3) into
 * `target` starting at `targetOffset`. `source` and `target` may be the same
 * buffer with `targetOffset === 0` (in-place masking).
 * The loop is unrolled 4 bytes at a time; the result is identical to
 * `target[targetOffset + i] = source[i] ^ mask[i & 3]`.
 */
function applyMask (source, target, targetOffset, length, m0, m1, m2, m3) {
  const end = length & ~3
  let i = 0
  for (; i < end; i += 4) {
    const j = targetOffset + i
    target[j] = source[i] ^ m0
    target[j + 1] = source[i + 1] ^ m1
    target[j + 2] = source[i + 2] ^ m2
    target[j + 3] = source[i + 3] ^ m3
  }
  if (i < length) {
    target[targetOffset + i] = source[i] ^ m0
    if (++i < length) {
      target[targetOffset + i] = source[i] ^ m1
      if (++i < length) {
        target[targetOffset + i] = source[i] ^ m2
      }
    }
  }
}

class WebsocketFrameSend {
  /**
   * @param {Buffer|undefined} data
   */
  constructor (data) {
    this.frameData = data
  }

  createFrame (opcode) {
    const frameData = this.frameData
    const bodyLength = frameData?.byteLength ?? 0

    /** @type {number} */
    let payloadLength = bodyLength // 0-125
    let offset = 6

    if (bodyLength > maxUnsigned16Bit) {
      offset += 8 // payload length is next 8 bytes
      payloadLength = 127
    } else if (bodyLength > 125) {
      offset += 2 // payload length is next 2 bytes
      payloadLength = 126
    }

    const buffer = Buffer.allocUnsafe(bodyLength + offset)

    // Clear first 2 bytes, everything else is overwritten
    buffer[0] = buffer[1] = 0
    buffer[0] |= 0x80 // FIN
    buffer[0] = (buffer[0] & 0xF0) + opcode // opcode

    /*! ws. MIT License. Einar Otto Stangvik <einaros@gmail.com> */
    writeMask(buffer, offset - 4)

    buffer[1] = payloadLength

    if (payloadLength === 126) {
      buffer.writeUInt16BE(bodyLength, 2)
    } else if (payloadLength === 127) {
      // Clear extended payload length
      buffer[2] = buffer[3] = 0
      buffer.writeUIntBE(bodyLength, 4, 6)
    }

    buffer[1] |= 0x80 // MASK

    // mask body
    if (bodyLength !== 0) {
      applyMask(frameData, buffer, offset, bodyLength,
        buffer[offset - 4], buffer[offset - 3], buffer[offset - 2], buffer[offset - 1])
    }

    return buffer
  }

  /**
   * @param {Uint8Array} buffer
   */
  static createFastTextFrame (buffer) {
    const bodyLength = buffer.length

    let payloadLength = bodyLength
    let offset = 6

    if (bodyLength > maxUnsigned16Bit) {
      offset += 8 // payload length is next 8 bytes
      payloadLength = 127
    } else if (bodyLength > 125) {
      offset += 2 // payload length is next 2 bytes
      payloadLength = 126
    }
    const head = Buffer.allocUnsafeSlow(offset)

    head[0] = 0x80 /* FIN */ | opcodes.TEXT /* opcode TEXT */
    head[1] = payloadLength | 0x80 /* MASK */
    writeMask(head, offset - 4)

    // mask body
    if (bodyLength !== 0) {
      applyMask(buffer, buffer, 0, bodyLength,
        head[offset - 4], head[offset - 3], head[offset - 2], head[offset - 1])
    }

    if (payloadLength === 126) {
      head.writeUInt16BE(bodyLength, 2)
    } else if (payloadLength === 127) {
      head[2] = head[3] = 0
      head.writeUIntBE(bodyLength, 4, 6)
    }

    return [head, buffer]
  }
}

module.exports = {
  WebsocketFrameSend,
  generateMask // for benchmark
}
