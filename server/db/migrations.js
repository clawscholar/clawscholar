import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPool } from './pool.js'
import { assertRuntimeConfig, getConfig } from '../config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const defaultMigrationsDir = path.join(__dirname, 'migrations')

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

export async function runMigrations(pool, options = {}) {
  const migrationsDir = options.migrationsDir || defaultMigrationsDir
  const client = await pool.connect()

  try {
    await ensureMigrationsTable(client)
    const result = await client.query('SELECT version FROM schema_migrations')
    const applied = new Set(result.rows.map((row) => row.version))
    const entries = (await fs.readdir(migrationsDir)).filter((entry) => entry.endsWith('.sql')).sort()

    for (const entry of entries) {
      if (applied.has(entry)) continue
      const fullPath = path.join(migrationsDir, entry)
      const sql = await fs.readFile(fullPath, 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [entry])
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }
  } finally {
    client.release()
  }
}

export async function runMigrationsFromEnv(overrides = {}) {
  const config = assertRuntimeConfig(getConfig(overrides))
  const pool = createPool(config.databaseUrl)
  try {
    await runMigrations(pool)
  } finally {
    await pool.end()
  }
}
