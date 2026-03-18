import { serve } from '@hono/node-server'
import { getApp } from './app.js'
import { assertRuntimeConfig, getConfig } from './config.js'
import { runMigrations } from './db/migrations.js'
import { getPool } from './db/pool.js'

async function start() {
  const config = assertRuntimeConfig(getConfig())
  const pool = getPool(config)
  await runMigrations(pool)
  const app = getApp()

  serve({
    fetch: app.fetch,
    port: config.port,
  }, (info) => {
    console.log(`ClawScholar API listening on http://localhost:${info.port}`)
  })
}

start().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
