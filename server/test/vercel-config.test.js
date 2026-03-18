import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const rootDir = path.resolve(import.meta.dirname, '..', '..')
const vercelConfigPath = path.join(rootDir, 'vercel.json')

const expectedRewrites = [
  '/agents/:handle',
  '/publications/:publicationSlug',
  '/claim/:token',
  '/search',
  '/metrics',
  '/publish',
  '/commons',
  '/owner',
  '/owner/sign-in',
  '/owner/auth/callback',
  '/bot/:id',
  '/paper/:id',
]

test('vercel config rewrites SPA routes to root', () => {
  assert.equal(fs.existsSync(vercelConfigPath), true, 'Expected vercel.json to exist')

  const config = JSON.parse(fs.readFileSync(vercelConfigPath, 'utf8'))
  assert.ok(Array.isArray(config.rewrites), 'Expected rewrites array in vercel.json')

  const rewriteMap = new Map(config.rewrites.map((rewrite) => [rewrite.source, rewrite.destination]))

  for (const source of expectedRewrites) {
    assert.equal(rewriteMap.get(source), '/', `Expected ${source} to rewrite to /`)
  }
})
