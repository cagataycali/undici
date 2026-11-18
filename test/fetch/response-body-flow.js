'use strict'

const { test } = require('node:test')
const { createServer } = require('node:http')
const { once } = require('node:events')
const { setTimeout: sleep } = require('node:timers/promises')
const { fetch } = require('../..')
const { closeServerAsPromise } = require('../utils/node-http')

const CHUNK = Buffer.alloc(64 * 1024, 'a')

test('a slow reader applies backpressure and still gets every byte', async (t) => {
  let written = 0
  let blocked = false
  const server = createServer(async (req, res) => {
    // Write until the socket reports backpressure, then finish once drained.
    while (res.write(CHUNK)) written += CHUNK.length
    written += CHUNK.length
    blocked = true
    await once(res, 'drain')
    res.end()
  }).listen(0)
  t.after(closeServerAsPromise(server))
  await once(server, 'listening')

  const res = await fetch(`http://localhost:${server.address().port}`)
  const reader = res.body.getReader()
  let received = (await reader.read()).value.byteLength

  // Let the server fill every buffer between it and fetch.
  await sleep(200)
  t.assert.ok(blocked, 'server should see backpressure while the body is not read')

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
  }
  t.assert.strictEqual(received, written)
})

test('a connection closed mid-body errors the stream', async (t) => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-length': String(CHUNK.length * 4) })
    res.write(CHUNK, () => setImmediate(() => res.destroy()))
  }).listen(0)
  t.after(closeServerAsPromise(server))
  await once(server, 'listening')

  const res = await fetch(`http://localhost:${server.address().port}`)
  await t.assert.rejects(res.text(), { name: 'TypeError', message: 'terminated' })
})

test('aborting mid-body errors the stream with the abort reason', async (t) => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-length': String(CHUNK.length * 4) })
    res.write(CHUNK)
  }).listen(0)
  t.after(closeServerAsPromise(server))
  t.after(() => server.closeAllConnections())
  await once(server, 'listening')

  const ac = new AbortController()
  const res = await fetch(`http://localhost:${server.address().port}`, { signal: ac.signal })
  const reader = res.body.getReader()
  await reader.read()
  ac.abort()
  await t.assert.rejects(reader.read(), { name: 'AbortError' })
})
