import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import {
  handleClaimStart,
  handleOwnerAuthCallback,
  handleOwnerAuthStart,
  handleOwnerAgentOutcomes,
  handleOwnerAgents,
  handleOwnerPolicy,
  handleOwnerRevokeKey,
  handleOwnerRotateKey,
  handlePublicationArtifacts,
  handlePublicationByRef,
  readJsonBody,
} from '../vercel-node.js'

function requestFrom(body, headers = { 'content-type': 'application/json' }) {
  const req = new Readable({ read() {} })
  req.headers = headers
  req.method = 'POST'
  req.url = 'http://localhost/'
  req.push(body)
  req.push(null)
  return req
}

function createResponseRecorder() {
  return {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.payload = payload
      return this
    },
  }
}

test('readJsonBody parses JSON from a Node request stream', async () => {
  const body = await readJsonBody(requestFrom('{"name":"Agent"}'))
  assert.deepEqual(body, { name: 'Agent' })
})

test('readJsonBody throws for malformed JSON', async () => {
  await assert.rejects(() => readJsonBody(requestFrom('{"name":')), /valid JSON/i)
})

test('handleClaimStart reads the dynamic token, sends a verification link, and returns pending verification JSON', async () => {
  const req = requestFrom('{"email":"owner@example.com"}')
  req.url = 'http://localhost/api/v1/claims/claim_route_token/start'
  const res = createResponseRecorder()
  const calls = []

  await handleClaimStart(
    req,
    res,
    {
      async startClaim(token, email) {
        calls.push({ token, email })
        return { ok: true, status: 202, attempt_id: 'attempt_route_123' }
      },
    },
    {
      async sendClaimMagicLink(payload) {
        calls.push({ mail: payload })
        return { redirectTo: payload.redirectTo }
      },
    }
  )

  assert.deepEqual(calls, [
    { token: 'claim_route_token', email: 'owner@example.com' },
    { mail: { email: 'owner@example.com', attemptId: 'attempt_route_123', redirectTo: 'http://localhost:5173/owner/auth/callback?attempt_id=attempt_route_123' } },
  ])
  assert.equal(res.statusCode, 202)
  assert.deepEqual(res.payload, {
    ok: true,
    status: 'pending_verification',
  })
})

test('handleClaimStart maps Supabase email rate limits to 429', async () => {
  const req = requestFrom('{"email":"owner@example.com"}')
  req.url = 'http://localhost/api/v1/claims/claim_route_token/start'
  const res = createResponseRecorder()

  await handleClaimStart(
    req,
    res,
    {
      async startClaim() {
        return { ok: true, status: 202, attempt_id: 'attempt_route_456' }
      },
    },
    {
      async sendClaimMagicLink() {
        const error = new Error('email rate limit exceeded')
        error.status = 429
        error.code = 'over_email_send_rate_limit'
        throw error
      },
    }
  )

  assert.equal(res.statusCode, 429)
  assert.equal(res.payload.error, 'Verification link rate limit exceeded. Please wait and try again.')
})

test('handleOwnerAuthCallback verifies bearer auth and returns redirect-ready JSON after claim completion', async () => {
  const req = requestFrom('{"attempt_id":"attempt_route_123"}', {
    'content-type': 'application/json',
    authorization: 'Bearer access_token_123',
  })
  req.url = 'http://localhost/api/v1/owner/auth/callback'
  const res = createResponseRecorder()
  const calls = []

  await handleOwnerAuthCallback(
    req,
    res,
    {
      async getClaimAttempt(attemptId) {
        calls.push({ attempt: attemptId })
        return { claim_token: 'claim_route_token', agent_id: 'agent_123' }
      },
      async completeClaim(input) {
        calls.push({ complete: input })
        return { ok: true, status: 200 }
      },
      async getClaim(token) {
        assert.equal(token, 'claim_route_token')
        return { agent: { handle: 'atlas-synth' } }
      },
    },
    {
      async verifyAccessToken(token) {
        calls.push({ verify: token })
        return { id: 'user_123', email: 'owner@example.com' }
      },
    }
  )

  assert.deepEqual(calls, [
    { verify: 'access_token_123' },
    { attempt: 'attempt_route_123' },
    {
      complete: {
        token: 'claim_route_token',
        email: 'owner@example.com',
        supabaseUserId: 'user_123',
      },
    },
  ])
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.payload, {
    ok: true,
    claimed: true,
    agent_handle: 'atlas-synth',
    redirect_to: '/owner?agent=atlas-synth&claimed=1',
  })
})

test('handleOwnerAuthCallback rejects missing or invalid Supabase bearer auth', async () => {
  const missingReq = requestFrom('{"attempt_id":"attempt_route_123"}')
  missingReq.url = 'http://localhost/api/v1/owner/auth/callback'
  const missingRes = createResponseRecorder()

  await handleOwnerAuthCallback(missingReq, missingRes, {}, { async verifyAccessToken() { return null } })
  assert.equal(missingRes.statusCode, 401)
  assert.equal(missingRes.payload.error, 'Missing Bearer access token.')

  const invalidReq = requestFrom('{"attempt_id":"attempt_route_123"}', {
    'content-type': 'application/json',
    authorization: 'Bearer invalid_token',
  })
  invalidReq.url = 'http://localhost/api/v1/owner/auth/callback'
  const invalidRes = createResponseRecorder()

  await handleOwnerAuthCallback(
    invalidReq,
    invalidRes,
    {},
    { async verifyAccessToken(token) { assert.equal(token, 'invalid_token'); return null } }
  )

  assert.equal(invalidRes.statusCode, 401)
  assert.equal(invalidRes.payload.error, 'Invalid or expired Supabase access token.')
})

test('handleOwnerAuthStart sends a sign-in verification link for a claimed owner email', async () => {
  const req = requestFrom('{"email":"owner@example.com"}', {
    'content-type': 'application/json',
  })
  req.url = 'http://localhost/api/v1/owner/auth/start'
  const res = createResponseRecorder()
  const calls = []

  await handleOwnerAuthStart(
    req,
    res,
    {
      async startOwnerSignIn(email) {
        calls.push({ start: email })
        return { ok: true, status: 202, email }
      },
    },
    {
      async sendOwnerSignInMagicLink(payload) {
        calls.push({ magic: payload })
        return { redirectTo: payload.redirectTo }
      },
    }
  )

  assert.deepEqual(calls, [
    { start: 'owner@example.com' },
    { magic: { email: 'owner@example.com', redirectTo: 'http://localhost:5173/owner/auth/callback?mode=sign_in' } },
  ])
  assert.equal(res.statusCode, 202)
  assert.deepEqual(res.payload, {
    ok: true,
    status: 'pending_verification',
  })
})

test('handleOwnerRotateKey verifies owner auth and returns one-time key payload', async () => {
  const req = requestFrom('', {
    authorization: 'Bearer owner_access_token',
  })
  req.url = 'http://localhost/api/v1/owner/agents/agent_abc/keys/rotate'
  const res = createResponseRecorder()
  const calls = []

  await handleOwnerRotateKey(
    req,
    res,
    {
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
    {
      async verifyAccessToken(token) {
        calls.push({ token })
        return { id: 'owner_user_123', email: 'owner@example.com' }
      },
    }
  )

  assert.deepEqual(calls, [
    { token: 'owner_access_token' },
    { agentRef: 'agent_abc', ownerId: 'owner_user_123' },
  ])
  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.api_key, 'claw_live_new_key')
  assert.equal(res.payload.handle, 'atlas-synth')
})

test('handleOwnerRevokeKey verifies owner auth and returns revoke result payload', async () => {
  const req = requestFrom('', {
    authorization: 'Bearer owner_access_token',
  })
  req.url = 'http://localhost/api/v1/owner/agents/agent_abc/keys/revoke'
  const res = createResponseRecorder()
  const calls = []

  await handleOwnerRevokeKey(
    req,
    res,
    {
      async revokeOwnerAgentApiKeys(agentRef, ownerId) {
        calls.push({ agentRef, ownerId })
        return {
          ok: true,
          status: 200,
          data: {
            agent_id: 'agent_abc',
            handle: 'atlas-synth',
            api_key_preview: 'No active key',
            revoked_count: 1,
            claim_status: 'claimed',
          },
        }
      },
    },
    {
      async verifyAccessToken(token) {
        calls.push({ token })
        return { id: 'owner_user_123', email: 'owner@example.com' }
      },
    }
  )

  assert.deepEqual(calls, [
    { token: 'owner_access_token' },
    { agentRef: 'agent_abc', ownerId: 'owner_user_123' },
  ])
  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.api_key_preview, 'No active key')
  assert.equal(res.payload.revoked_count, 1)
})

test('handleOwnerAgents returns owner claimed agents using verified auth', async () => {
  const req = requestFrom('', {
    authorization: 'Bearer owner_access_token',
  })
  req.method = 'GET'
  req.url = 'http://localhost/api/v1/owner/agents'
  const res = createResponseRecorder()

  await handleOwnerAgents(
    req,
    res,
    {
      async listOwnerAgents(ownerId) {
        assert.equal(ownerId, 'owner_user_123')
        return [{ agent_id: 'agent_abc', handle: 'atlas-synth' }]
      },
    },
    {
      async verifyAccessToken(token) {
        assert.equal(token, 'owner_access_token')
        return { id: 'owner_user_123', email: 'owner@example.com' }
      },
    }
  )

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.agents.length, 1)
  assert.equal(res.payload.agents[0].handle, 'atlas-synth')
})

test('handleOwnerAgentOutcomes returns owner outcome feed for selected agent', async () => {
  const req = requestFrom('', {
    authorization: 'Bearer owner_access_token',
  })
  req.method = 'GET'
  req.url = 'http://localhost/api/v1/owner/agents/agent_abc/outcomes'
  const res = createResponseRecorder()

  await handleOwnerAgentOutcomes(
    req,
    res,
    {
      async listOwnerAgentOutcomes(agentRef, ownerId) {
        assert.equal(agentRef, 'agent_abc')
        assert.equal(ownerId, 'owner_user_123')
        return {
          ok: true,
          status: 200,
          data: {
            agent: { agent_id: 'agent_abc', handle: 'atlas-synth' },
            outcomes: [{ outcome_id: 'outcome_1', status: 'published' }],
          },
        }
      },
    },
    {
      async verifyAccessToken(token) {
        assert.equal(token, 'owner_access_token')
        return { id: 'owner_user_123', email: 'owner@example.com' }
      },
    }
  )

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.outcomes.length, 1)
  assert.equal(res.payload.outcomes[0].outcome_id, 'outcome_1')
})

test('handleOwnerPolicy updates policy for the selected claimed owner agent', async () => {
  const req = requestFrom('{"mode":"auto_publish_selected","selected_artifact_types":["results_ledger"]}', {
    authorization: 'Bearer owner_access_token',
    'content-type': 'application/json',
  })
  req.method = 'PUT'
  req.url = 'http://localhost/api/v1/owner/agents/agent_abc/policy'
  const res = createResponseRecorder()

  await handleOwnerPolicy(
    req,
    res,
    {
      async updateOwnerAgentPolicy(agentRef, ownerId, payload) {
        assert.equal(agentRef, 'agent_abc')
        assert.equal(ownerId, 'owner_user_123')
        assert.equal(payload.mode, 'auto_publish_selected')
        assert.deepEqual(payload.selected_artifact_types, ['results_ledger'])
        return {
          ok: true,
          status: 200,
          data: {
            agent_id: 'agent_abc',
            handle: 'atlas-synth',
            publish_policy: {
              mode: 'auto_publish_selected',
              selected_artifact_types: ['results_ledger'],
            },
          },
        }
      },
    },
    {
      async verifyAccessToken(token) {
        assert.equal(token, 'owner_access_token')
        return { id: 'owner_user_123', email: 'owner@example.com' }
      },
    }
  )

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.publish_policy.mode, 'auto_publish_selected')
})

test('handlePublicationByRef supports authenticated delete', async () => {
  const req = requestFrom('', {
    authorization: 'Bearer claw_live_agent_key',
  })
  req.method = 'DELETE'
  req.url = 'http://localhost/api/v1/publications/pub_delete_route_123'
  const res = createResponseRecorder()

  await handlePublicationByRef(
    req,
    res,
    {
      async getAgentByApiKey(apiKey) {
        assert.equal(apiKey, 'claw_live_agent_key')
        return { agent_id: 'agent_delete_route_123' }
      },
      async deletePublication(publicationRef, agent) {
        assert.equal(publicationRef, 'pub_delete_route_123')
        assert.equal(agent.agent_id, 'agent_delete_route_123')
        return {
          ok: true,
          status: 200,
          data: {
            status: 'deleted',
            deleted: true,
            publication_id: publicationRef,
          },
        }
      },
      async getPublication() {
        return null
      },
    }
  )

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.status, 'deleted')
  assert.equal(res.payload.publication_id, 'pub_delete_route_123')
})

test('handlePublicationArtifacts supports authenticated artifact removal', async () => {
  const req = requestFrom('{"url":"https://example.com/results.tsv"}', {
    authorization: 'Bearer claw_live_agent_key',
    'content-type': 'application/json',
  })
  req.method = 'DELETE'
  req.url = 'http://localhost/api/v1/publications/pub_delete_route_123/artifacts'
  const res = createResponseRecorder()

  await handlePublicationArtifacts(
    req,
    res,
    {
      async getAgentByApiKey(apiKey) {
        assert.equal(apiKey, 'claw_live_agent_key')
        return { agent_id: 'agent_delete_route_123' }
      },
      async removePublicationArtifact(publicationRef, agent, payload) {
        assert.equal(publicationRef, 'pub_delete_route_123')
        assert.equal(agent.agent_id, 'agent_delete_route_123')
        assert.equal(payload.url, 'https://example.com/results.tsv')
        return {
          ok: true,
          status: 200,
          data: {
            status: 'artifact_removed',
            publication_id: publicationRef,
            removed_artifact_url: payload.url,
          },
        }
      },
    }
  )

  assert.equal(res.statusCode, 200)
  assert.equal(res.payload.status, 'artifact_removed')
  assert.equal(res.payload.publication_id, 'pub_delete_route_123')
})

test('register, claim start, callback, and publications entrypoints force node runtime', async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/clawscholar'
  process.env.API_KEY_ENCRYPTION_KEY = process.env.API_KEY_ENCRYPTION_KEY || 'test-secret'
  process.env.APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:5173'

  for (const specifier of [
    '../../api/agents/register.js',
    '../../api/claims/[token]/start.js',
    '../../api/owner/auth/[action].js',
    '../../api/owner/agents/index.js',
    '../../api/owner/agents/[agentRef]/[endpoint].js',
    '../../api/owner/agents/[agentRef]/keys/[action].js',
    '../../api/publications/index.js',
    '../../api/publications/[publicationRef].js',
  ]) {
    const module = await import(specifier)
    assert.equal(typeof module.default, 'function')
    assert.deepEqual(module.config, { runtime: 'nodejs' })
  }
})
