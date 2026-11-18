import { bench, summary, run } from 'mitata'
import { ByteParser } from '../../lib/web/websocket/receiver.js'
import { states } from '../../lib/web/websocket/constants.js'

function frame (opcode, length) {
  const payload = Buffer.alloc(length, 0x61)
  const head = length < 126
    ? Buffer.from([0x80 | opcode, length])
    : Buffer.from([0x80 | opcode, 126, length >> 8, length & 0xff])
  return Buffer.concat([head, payload])
}

function frames (count, opcode, length) {
  return Buffer.concat(Array.from({ length: count }, () => frame(opcode, length)))
}

function chunked (buffer, size) {
  const chunks = []
  for (let i = 0; i < buffer.length; i += size) {
    chunks.push(buffer.subarray(i, i + size))
  }
  return chunks
}

let received = 0

function createParser () {
  const handler = {
    readyState: states.OPEN,
    closeState: new Set(),
    socket: { writableNeedDrain: false, write () {}, once () {} },
    controller: { abort () {} },
    onMessage (type, data) { received += data.length },
    onPing () {},
    onPong () {}
  }
  return new ByteParser(handler, null)
}

const cases = {
  '64 x 16 B text frames, one chunk': [frames(64, 1, 16)],
  '64 x 200 B binary frames, one chunk': [frames(64, 2, 200)],
  '64 x 16 B text frames, 37 B chunks': chunked(frames(64, 1, 16), 37),
  '1 x 16 KiB binary frame, one chunk': [frame(2, 16384)]
}

summary(() => {
  for (const [name, chunks] of Object.entries(cases)) {
    const parser = createParser()
    bench(name, () => {
      for (let i = 0; i < chunks.length; i++) {
        parser.write(chunks[i])
      }
    })
  }
})

await run()

if (received === 0) throw new Error('no messages parsed')
