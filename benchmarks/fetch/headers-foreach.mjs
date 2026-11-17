import { bench, group, run } from 'mitata'
import { Headers } from '../../lib/web/fetch/headers.js'
import { FormData } from '../../lib/web/fetch/formdata.js'

const sizes = [4, 16, 64]

for (const size of sizes) {
  const headers = new Headers()
  const formData = new FormData()
  for (let i = 0; i < size; ++i) {
    headers.append(`x-header-${i}`, `value-${i}`)
    formData.append(`field-${i}`, `value-${i}`)
  }
  // Warm the sorted cache so the benchmark measures iteration only.
  headers.forEach(() => {})

  group(`${size} entries`, () => {
    bench('Headers#forEach', () => {
      let n = 0
      headers.forEach((value, key) => { n += value.length + key.length })
      return n
    })
    bench('FormData#forEach', () => {
      let n = 0
      formData.forEach((value, key) => { n += value.length + key.length })
      return n
    })
  })
}

await run()
