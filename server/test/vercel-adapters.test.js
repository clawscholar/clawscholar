import test from 'node:test'
import assert from 'node:assert/strict'

test('exports a standalone Vercel handler for the health endpoint', async () => {
  const module = await import('../../api/health.js')
  assert.equal(typeof module.default, 'function')

  let statusCode = null
  let jsonBody = null
  const res = {
    status(code) {
      statusCode = code
      return this
    },
    json(body) {
      jsonBody = body
      return this
    },
  }

  module.default({ url: 'http://localhost/api/v1/health' }, res)

  assert.equal(statusCode, 200)
  assert.deepEqual(jsonBody, { ok: true })
})
