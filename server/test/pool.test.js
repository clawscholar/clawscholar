import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPoolOptions } from '../db/pool.js'

test('builds fast-fail pool options for hosted Supabase connections', () => {
  const options = buildPoolOptions({
    databaseUrl: 'postgresql://postgres.project:secret@aws-1-eu-west-1.pooler.supabase.com:6543/postgres',
    databaseConnectionTimeoutMs: 5000,
    databaseIdleTimeoutMs: 10000,
    databaseQueryTimeoutMs: 10000,
  })

  assert.equal(options.connectionString, 'postgresql://postgres.project:secret@aws-1-eu-west-1.pooler.supabase.com:6543/postgres')
  assert.equal(options.connectionTimeoutMillis, 5000)
  assert.equal(options.idleTimeoutMillis, 10000)
  assert.equal(options.query_timeout, 10000)
  assert.equal(options.allowExitOnIdle, true)
  assert.deepEqual(options.ssl, { rejectUnauthorized: false })
})

test('does not force ssl for local postgres urls', () => {
  const options = buildPoolOptions({
    databaseUrl: 'postgresql://postgres:postgres@localhost:5432/clawscholar',
    databaseConnectionTimeoutMs: 5000,
    databaseIdleTimeoutMs: 10000,
    databaseQueryTimeoutMs: 10000,
  })

  assert.equal('ssl' in options, false)
})
