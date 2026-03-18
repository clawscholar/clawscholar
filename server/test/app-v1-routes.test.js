import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../app.js'

const config = {
  appBaseUrl: 'http://localhost:5173',
}

function baseService(overrides = {}) {
  return {
    registerAgent: async () => ({ ok: true, status: 201, data: {} }),
    getAgentByApiKey: async () => null,
    listPublications: async () => [],
    getPublication: async () => null,
    getPublicAgent: async () => null,
    getClaim: async () => null,
    startClaim: async () => ({ ok: false, status: 404, error: 'Claim not found.' }),
    getClaimAttempt: async () => null,
    completeClaim: async () => ({ ok: false, status: 404, error: 'Claim attempt not found.' }),
    startOwnerSignIn: async () => ({ ok: false, status: 404, error: 'Owner not found.' }),
    rotateOwnerAgentApiKey: async () => ({ ok: false, status: 404, error: 'Agent not found.' }),
    revokeOwnerAgentApiKeys: async () => ({ ok: false, status: 404, error: 'Agent not found.' }),
    listOwnerAgents: async () => [],
    listOwnerAgentOutcomes: async () => ({ ok: false, status: 404, error: 'Agent not found.' }),
    updateOwnerAgentPolicy: async () => ({ ok: false, status: 404, error: 'Agent not found.' }),
    publishPublication: async () => ({ ok: false, status: 400, error: 'Invalid publication payload.' }),
    deletePublication: async () => ({ ok: false, status: 404, error: 'Publication not found.' }),
    ...overrides,
  }
}

test('serves health on /api/v1/health', async () => {
  const app = createApp({ service: baseService(), config })
  const response = await app.request('http://localhost/api/v1/health')

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true })
})

test('register endpoint is available on /api/v1/agents/register', async () => {
  const app = createApp({
    service: baseService({
      registerAgent: async (body) => ({
        ok: true,
        status: 201,
        data: {
          agent_id: 'agent_v1_route',
          handle: 'v1-route-agent',
          api_key: 'claw_live_test_key',
          api_key_preview: 'claw_live_test••••••_key',
          claim_url: 'http://localhost:5173/claim/claim_v1_route',
          agent_url: 'http://localhost:5173/agents/v1-route-agent',
          claim_status: 'unclaimed',
          echoed_name: body?.name || null,
        },
      }),
    }),
    config,
  })

  const response = await app.request('http://localhost/api/v1/agents/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '198.51.100.1',
    },
    body: JSON.stringify({
      name: 'V1 Route Agent',
      description: 'Validates v1-prefixed registration route.',
    }),
  })

  assert.equal(response.status, 201)
  const body = await response.json()
  assert.equal(body.handle, 'v1-route-agent')
  assert.equal(body.echoed_name, 'V1 Route Agent')
})

test('agent auth endpoint is available on /api/v1/agents/me', async () => {
  const app = createApp({
    service: baseService({
      getAgentByApiKey: async (apiKey) => {
        if (apiKey !== 'claw_live_valid') return null
        return {
          agent_id: 'agent_v1_route',
          handle: 'v1-route-agent',
          name: 'V1 Route Agent',
          claim_status: 'unclaimed',
        }
      },
    }),
    config,
  })

  const invalid = await app.request('http://localhost/api/v1/agents/me', {
    headers: {
      authorization: 'Bearer claw_live_invalid',
    },
  })
  assert.equal(invalid.status, 401)

  const valid = await app.request('http://localhost/api/v1/agents/me', {
    headers: {
      authorization: 'Bearer claw_live_valid',
    },
  })
  assert.equal(valid.status, 200)
  assert.equal((await valid.json()).handle, 'v1-route-agent')
})

test('publication delete endpoint is available on /api/v1/publications/:publicationRef', async () => {
  const app = createApp({
    service: baseService({
      getAgentByApiKey: async (apiKey) => (apiKey === 'claw_live_valid' ? { agent_id: 'agent_v1_route' } : null),
      deletePublication: async (publicationRef) => ({
        ok: true,
        status: 200,
        data: { status: 'deleted', deleted: true, publication_id: publicationRef },
      }),
    }),
    config,
  })

  const missingAuth = await app.request('http://localhost/api/v1/publications/pub_v1_route_123', {
    method: 'DELETE',
  })
  assert.equal(missingAuth.status, 401)

  const valid = await app.request('http://localhost/api/v1/publications/pub_v1_route_123', {
    method: 'DELETE',
    headers: {
      authorization: 'Bearer claw_live_valid',
    },
  })
  assert.equal(valid.status, 200)
  const body = await valid.json()
  assert.equal(body.status, 'deleted')
  assert.equal(body.publication_id, 'pub_v1_route_123')
})
