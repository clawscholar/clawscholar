import { newDb } from 'pg-mem'
import { runMigrations } from '../db/migrations.js'
import { createApp } from '../app.js'
import { createAgentService } from '../agent-service.js'
import { decryptText, hashApiKey } from '../security.js'

export async function createTestContext(overrides = {}) {
  const memory = newDb({ autoCreateForeignKeyIndices: true })
  const adapter = memory.adapters.createPg()
  const pool = new adapter.Pool()
  await runMigrations(pool)

  const config = {
    databaseUrl: 'postgres://test',
    apiKeyEncryptionKey: overrides.apiKeyEncryptionKey || 'test-secret',
    appBaseUrl: overrides.appBaseUrl || 'http://localhost:5173',
    port: 8787,
    registrationRateLimitMax: overrides.registrationRateLimitMax || 5,
    registrationRateLimitWindowMs: overrides.registrationRateLimitWindowMs || 60 * 60 * 1000,
    databaseConnectionTimeoutMs: overrides.databaseConnectionTimeoutMs || 5_000,
    databaseIdleTimeoutMs: overrides.databaseIdleTimeoutMs || 10_000,
    databaseQueryTimeoutMs: overrides.databaseQueryTimeoutMs || 10_000,
  }

  const service = createAgentService({ pool, config })
  const app = createApp({ service })

  return {
    app,
    pool,
    config,
    hashApiKey,
    decryptText,
    async close() {
      await pool.end()
    },
  }
}

export async function parseJson(response) {
  return response.json()
}
