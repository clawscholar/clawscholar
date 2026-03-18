import { runMigrationsFromEnv } from './migrations.js'

runMigrationsFromEnv().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
