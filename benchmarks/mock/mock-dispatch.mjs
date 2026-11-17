import { bench, group, run } from 'mitata'
import { addMockDispatch, getMockDispatch } from '../../lib/mock/mock-utils.js'

// getMockDispatch() runs once per mocked request and scans every registered
// interceptor. Test suites often register many interceptors with query paths.
function setup (count) {
  const dispatches = []
  for (let i = 0; i < count; i++) {
    addMockDispatch(dispatches, { path: `/api/items/${i}?b=2&a=1&page=${i}`, method: 'GET' }, { statusCode: 200, data: 'ok' }, { persist: true })
  }
  return dispatches
}

for (const count of [1, 10, 50]) {
  const dispatches = setup(count)
  const key = { path: `/api/items/${count - 1}?a=1&b=2&page=${count - 1}`, method: 'GET', headers: {} }
  group(`getMockDispatch (${count} interceptors)`, () => {
    bench('query path, last interceptor matches', () => getMockDispatch(dispatches, key))
  })
}

await run()
