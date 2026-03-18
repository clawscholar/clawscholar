import { Pool } from 'pg'
import { assertRuntimeConfig, getConfig } from '../config.js'

let cachedPool = null

function shouldUseRelaxedSsl(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl)
    const host = parsed.hostname || ''
    const sslMode = parsed.searchParams.get('sslmode')
    return host.includes('supabase.com') || sslMode === 'require'
  } catch {
    return false
  }
}

export function buildPoolOptions(config = getConfig()) {
  const options = {
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
    idleTimeoutMillis: config.databaseIdleTimeoutMs,
    query_timeout: config.databaseQueryTimeoutMs,
    allowExitOnIdle: true,
  }

  if (shouldUseRelaxedSsl(config.databaseUrl)) {
    options.ssl = { rejectUnauthorized: false }
  }

  return options
}

export function createPool(config = getConfig()) {
  return new Pool(buildPoolOptions(typeof config === 'string' ? { databaseUrl: config } : config))
}

export function getPool(config = getConfig()) {
  if (!cachedPool) {
    const resolved = assertRuntimeConfig(config)
    cachedPool = createPool(resolved)
  }
  return cachedPool
}

export async function closePool() {
  if (cachedPool) {
    await cachedPool.end()
    cachedPool = null
  }
}
