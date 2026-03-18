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

test('GET /api/owner/agents returns claimed agents for verified owner', async () => {
  const calls = []
  const app = createApp({
    config: createTestConfig(),
    service: {
      async listOwnerAgents(ownerId) {
        calls.push({ ownerId })
        return [
          {
            agent_id: 'agent_abc',
            handle: 'atlas-synth',
            name: 'Atlas Synth',
            description: 'Owned test agent',
            claim_status: 'claimed',
            api_key_preview: 'claw_live_1234••••••abc',
            owner_email: 'owner@example.com',
            agent_url: 'http://localhost:5173/agents/atlas-synth',
            created_at: '2026-03-12T00:00:00.000Z',
          },
        ]
      },
    },
    auth: {
      async verifyAccessToken(token) {
        assert.equal(token, 'owner_access_token')
        return { id: 'owner_user_123', email: 'owner@example.com' }
      },
    },
  })

  const response = await app.request('http://localhost/api/v1/owner/agents', {
    method: 'GET',
    headers: {
      Authorization: 'Bearer owner_access_token',
    },
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.agents.length, 1)
  assert.equal(body.agents[0].handle, 'atlas-synth')
  assert.deepEqual(calls, [{ ownerId: 'owner_user_123' }])
})

test('GET /api/owner/agents/:agentRef/outcomes forwards outcome payload', async () => {
  const calls = []
  const app = createApp({
    config: createTestConfig(),
    service: {
      async listOwnerAgentOutcomes(agentRef, ownerId) {
        calls.push({ agentRef, ownerId })
        return {
          ok: true,
          status: 200,
          data: {
            agent: {
              agent_id: 'agent_abc',
              handle: 'atlas-synth',
            },
            outcomes: [
              {
                outcome_id: 'outcome_1',
                status: 'published',
              },
            ],
          },
        }
      },
    },
    auth: {
      async verifyAccessToken(token) {
        assert.equal(token, 'owner_access_token')
        return { id: 'owner_user_123', email: 'owner@example.com' }
      },
    },
  })

  const response = await app.request('http://localhost/api/v1/owner/agents/agent_abc/outcomes', {
    method: 'GET',
    headers: {
      Authorization: 'Bearer owner_access_token',
    },
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.outcomes.length, 1)
  assert.equal(body.outcomes[0].outcome_id, 'outcome_1')
  assert.deepEqual(calls, [{ agentRef: 'agent_abc', ownerId: 'owner_user_123' }])
})

test('GET /api/owner/agents requires verified bearer auth', async () => {
  const app = createApp({
    config: createTestConfig(),
    service: {
      async listOwnerAgents() {
        throw new Error('Should not run without owner auth.')
      },
    },
    auth: {
      async verifyAccessToken() {
        return null
      },
    },
  })

  const response = await app.request('http://localhost/api/v1/owner/agents', {
    method: 'GET',
  })
  const body = await response.json()

  assert.equal(response.status, 401)
  assert.equal(body.error, 'Missing Bearer access token.')
})
