import { randomBytes } from 'node:crypto'
import { bench, group, run } from 'mitata'
import { WebsocketFrameSend } from '../../lib/web/websocket/frame.js'
import { opcodes } from '../../lib/web/websocket/constants.js'

const sizes = [64, 1024, 16 * 1024, 64 * 1024]

for (const size of sizes) {
  const data = randomBytes(size)
  const frame = new WebsocketFrameSend(data)
  const text = Buffer.from(data)

  group(`${size} bytes`, () => {
    bench('createFrame (binary)', () => frame.createFrame(opcodes.BINARY))
    bench('createFastTextFrame', () => WebsocketFrameSend.createFastTextFrame(text))
  })
}

await run()
