import 'dotenv/config'

const DEFAULT_PORT = 8787
const DEFAULT_APP_BASE_URL = 'http://localhost:5173'
const DEFAULT_RATE_LIMIT_MAX = 5
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000
const DEFAULT_DATABASE_CONNECTION_TIMEOUT_MS = 5_000
const DEFAULT_DATABASE_IDLE_TIMEOUT_MS = 10_000
const DEFAULT_DATABASE_QUERY_TIMEOUT_MS = 10_000

const asNumber = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const trimTrailingSlash = (value) => {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\/+$/, '')
}

export function getConfig(overrides = {}) {
  const nodeEnv = overrides.nodeEnv ?? process.env.NODE_ENV ?? 'development'
  const rawAppBaseUrl =
    overrides.appBaseUrl ??
    process.env.APP_BASE_URL ??
    (nodeEnv === 'production' ? '' : DEFAULT_APP_BASE_URL)

  const config = {
    databaseUrl: overrides.databaseUrl ?? process.env.DATABASE_URL ?? '',
    apiKeyEncryptionKey: overrides.apiKeyEncryptionKey ?? process.env.API_KEY_ENCRYPTION_KEY ?? '',
    appBaseUrl: rawAppBaseUrl ? trimTrailingSlash(rawAppBaseUrl) : '',
    nodeEnv,
    port: asNumber(overrides.port ?? process.env.PORT, DEFAULT_PORT),
    registrationRateLimitMax: asNumber(
      overrides.registrationRateLimitMax ?? process.env.REGISTRATION_RATE_LIMIT_MAX,
      DEFAULT_RATE_LIMIT_MAX
    ),
    registrationRateLimitWindowMs: asNumber(
      overrides.registrationRateLimitWindowMs ?? process.env.REGISTRATION_RATE_LIMIT_WINDOW_MS,
      DEFAULT_RATE_LIMIT_WINDOW_MS
    ),
    databaseConnectionTimeoutMs: asNumber(
      overrides.databaseConnectionTimeoutMs ?? process.env.DATABASE_CONNECTION_TIMEOUT_MS,
      DEFAULT_DATABASE_CONNECTION_TIMEOUT_MS
    ),
    databaseIdleTimeoutMs: asNumber(
      overrides.databaseIdleTimeoutMs ?? process.env.DATABASE_IDLE_TIMEOUT_MS,
      DEFAULT_DATABASE_IDLE_TIMEOUT_MS
    ),
    databaseQueryTimeoutMs: asNumber(
      overrides.databaseQueryTimeoutMs ?? process.env.DATABASE_QUERY_TIMEOUT_MS,
      DEFAULT_DATABASE_QUERY_TIMEOUT_MS
    ),
    supabaseUrl: overrides.supabaseUrl ?? process.env.SUPABASE_URL ?? '',
    supabaseAnonKey: overrides.supabaseAnonKey ?? process.env.SUPABASE_ANON_KEY ?? '',
  }

  return config
}

export function assertRuntimeConfig(config) {
  const missing = []
  if (!config.databaseUrl) missing.push('DATABASE_URL')
  if (!config.apiKeyEncryptionKey) missing.push('API_KEY_ENCRYPTION_KEY')
  if (!config.appBaseUrl) missing.push('APP_BASE_URL')

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
  }

  return config
}

export function assertSupabaseAuthConfig(config) {
  const missing = []
  if (!config.supabaseUrl) missing.push('SUPABASE_URL')
  if (!config.supabaseAnonKey) missing.push('SUPABASE_ANON_KEY')

  if (missing.length > 0) {
    throw new Error(`Missing required Supabase environment variables: ${missing.join(', ')}`)
  }

  return config
}
