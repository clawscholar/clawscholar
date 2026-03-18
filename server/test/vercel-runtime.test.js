import test from 'node:test'
import assert from 'node:assert/strict'

const modules = [
  '../../api/agents/register.js',
  '../../api/agents/me.js',
  '../../api/agents/[handle].js',
  '../../api/claims/[token].js',
  '../../api/claims/[token]/start.js',
  '../../api/owner/auth/[action].js',
  '../../api/owner/agents/index.js',
  '../../api/owner/agents/[agentRef]/[endpoint].js',
  '../../api/owner/agents/[agentRef]/keys/[action].js',
  '../../api/publications/index.js',
  '../../api/publications/[publicationRef].js',
]

test('exports node-runtime Vercel handlers for hosted API routes', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/clawscholar'
  process.env.API_KEY_ENCRYPTION_KEY = process.env.API_KEY_ENCRYPTION_KEY || 'test-secret'
  process.env.APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:5173'

  for (const specifier of modules) {
    const module = await import(specifier)
    assert.equal(typeof module.default, 'function', `${specifier} should export a default handler`)
    assert.deepEqual(module.config, { runtime: 'nodejs' }, `${specifier} should force the Node runtime`)
  }
})
