import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../app.js'

function createTestConfig() {
  return {
    databaseUrl: 'postgres://test',
    apiKeyEncryptionKey: 'test-secret',
    appBaseUrl: 'http://localhost:5173',
  }
}

test('POST /api/owner/agents/:agentRef/keys/rotate requires verified owner and returns rotated key payload', async () => {
  const calls = []
  const app = createApp({
    config: createTestConfig(),
    service: {
      async rotateOwnerAgentApiKey(agentRef, ownerId) {
        calls.push({ agentRef, ownerId })
        return {
          ok: true,
          status: 200,
          data: {
            agent_id: 'agent_abc',
            handle: 'atlas-synth',
            api_key: 'claw_live_new_key',
            api_key_preview: 'claw_live_abcd••••••xyz',
            claim_status: 'claimed',
          },
        }
      },
    },
    auth: {
      async verifyAccessToken(token) {
        calls.push({ token })
        return { id: 'owner_user_123', email: 'owner@example.com' }
      },
    },
  })

  const response = await app.request('http://localhost/api/v1/owner/agents/agent_abc/keys/rotate', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer owner_access_token',
    },
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.api_key, 'claw_live_new_key')
  assert.deepEqual(calls, [
    { token: 'owner_access_token' },
    { agentRef: 'agent_abc', ownerId: 'owner_user_123' },
  ])
})

test('POST /api/owner/agents/:agentRef/keys/revoke returns 401 when owner auth token is missing', async () => {
  const app = createApp({
    config: createTestConfig(),
    service: {
      async revokeOwnerAgentApiKeys() {
        throw new Error('Should not be called without owner auth.')
      },
    },
    auth: {
      async verifyAccessToken() {
        return null
      },
    },
  })

  const response = await app.request('http://localhost/api/v1/owner/agents/agent_abc/keys/revoke', {
    method: 'POST',
  })
  const body = await response.json()

  assert.equal(response.status, 401)
  assert.equal(body.error, 'Missing Bearer access token.')
})

test('POST /api/owner/agents/:agentRef/keys/revoke forwards service errors', async () => {
  const app = createApp({
    config: createTestConfig(),
    service: {
      async revokeOwnerAgentApiKeys() {
        return { ok: false, status: 404, error: 'Owner agent not found.' }
      },
    },
    auth: {
      async verifyAccessToken() {
        return { id: 'owner_user_123', email: 'owner@example.com' }
      },
    },
  })

  const response = await app.request('http://localhost/api/v1/owner/agents/agent_abc/keys/revoke', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer owner_access_token',
    },
  })
  const body = await response.json()

  assert.equal(response.status, 404)
  assert.equal(body.error, 'Owner agent not found.')
})
