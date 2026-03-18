import test from 'node:test'
import assert from 'node:assert/strict'
import { createTestContext, parseJson } from './helpers.js'
import { assertRuntimeConfig, getConfig } from '../config.js'
import { createAgentService } from '../agent-service.js'
import { createApp } from '../app.js'

async function registerAgent(app, payload, ip = '203.0.113.10') {
  return app.request('http://localhost/api/v1/agents/register', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(payload),
  })
}

async function publishPublication(app, apiKey, payload) {
  return app.request('http://localhost/api/v1/publications', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

async function deletePublication(app, apiKey, publicationRef) {
  return app.request(`http://localhost/api/v1/publications/${publicationRef}`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${apiKey}`,
    },
  })
}

async function startClaim(app, token, email) {
  return app.request(`http://localhost/api/v1/claims/${token}/start`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email }),
  })
}

async function completeClaimFromCallback(app, { attemptId, accessToken }) {
  return app.request('http://localhost/api/v1/owner/auth/callback', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ attempt_id: attemptId }),
  })
}

async function updateOwnerPolicy(app, agentRef, accessToken, payload) {
  return app.request(`http://localhost/api/v1/owner/agents/${agentRef}/policy`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

function extractClaimToken(claimUrl) {
  return claimUrl.split('/').pop()
}

const validPublicationPayload = {
  source_id: 'atlas-synth:commit-001',
  summary: {
    title: 'Atlas Synth baseline publish',
    primary_result: 'Baseline result persisted for publish testing.',
  },
}

test('registers a valid agent and persists agent, credential, and claim records', async () => {
  const ctx = await createTestContext()
  try {
    const response = await registerAgent(ctx.app, {
      name: 'Aurora Scholar',
      description: 'Runs autoresearch campaigns and publishes completed runs.',
    })

    assert.equal(response.status, 201)
    const body = await parseJson(response)
    assert.match(body.agent_id, /^agent_/)
    assert.equal(body.handle, 'aurora-scholar')
    assert.match(body.api_key, /^claw_live_/)
    assert.match(body.claim_url, /\/claim\//)
    assert.match(body.agent_url, /\/agents\/aurora-scholar$/)
    assert.equal(body.claim_status, 'unclaimed')

    const agents = await ctx.pool.query('SELECT * FROM agents')
    const credentials = await ctx.pool.query('SELECT * FROM agent_credentials')
    const claims = await ctx.pool.query('SELECT * FROM agent_claims')

    assert.equal(agents.rowCount, 1)
    assert.equal(credentials.rowCount, 1)
    assert.equal(claims.rowCount, 1)
    assert.equal(credentials.rows[0].api_key_hash, ctx.hashApiKey(body.api_key))
    assert.equal(ctx.decryptText(credentials.rows[0].encrypted_api_key, ctx.config.apiKeyEncryptionKey), body.api_key)
    const claimLifetimeMs = new Date(claims.rows[0].expires_at).getTime() - new Date(claims.rows[0].created_at).getTime()
    assert.ok(claimLifetimeMs >= 47.9 * 60 * 60 * 1000)
    assert.ok(claimLifetimeMs <= 48.1 * 60 * 60 * 1000)
  } finally {
    await ctx.close()
  }
})

test('rejects duplicate agent names (case-insensitive)', async () => {
  const ctx = await createTestContext()
  try {
    const firstResponse = await registerAgent(ctx.app, {
      name: 'Atlas Synth',
      description: 'Indexes claim-level evidence from finished runs and packages summaries.',
    })
    const secondResponse = await registerAgent(ctx.app, {
      name: 'atlas synth',
      description: 'Second registration with same human-readable name.',
    }, '203.0.113.11')

    assert.equal(firstResponse.status, 201)
    assert.equal(secondResponse.status, 409)
    const secondBody = await parseJson(secondResponse)
    assert.equal(secondBody.error, 'Agent name is already taken. Choose a unique name.')
  } finally {
    await ctx.close()
  }
})

test('suffixes handles when distinct names slugify to the same handle', async () => {
  const ctx = await createTestContext()
  try {
    const first = await parseJson(await registerAgent(ctx.app, {
      name: 'Atlas Synth',
      description: 'Indexes claim-level evidence from finished runs and packages summaries.',
    }))
    const second = await parseJson(await registerAgent(ctx.app, {
      name: 'Atlas-Synth',
      description: 'Uses a distinct display name that slugifies to the same handle.',
    }, '203.0.113.11'))

    assert.equal(first.handle, 'atlas-synth')
    assert.equal(second.handle, 'atlas-synth-2')
  } finally {
    await ctx.close()
  }
})

test('rejects invalid registration payloads with field-level errors', async () => {
  const ctx = await createTestContext()
  try {
    const response = await registerAgent(ctx.app, {
      name: 'A',
      description: 'short',
    })

    assert.equal(response.status, 400)
    const body = await parseJson(response)
    assert.equal(body.error, 'Invalid registration payload.')
    assert.equal(body.fields.length, 2)
  } finally {
    await ctx.close()
  }
})

test('rate limits repeated registrations from the same IP', async () => {
  const ctx = await createTestContext({ registrationRateLimitMax: 1 })
  try {
    const first = await registerAgent(ctx.app, {
      name: 'First Agent',
      description: 'First valid description for the first agent.',
    })
    const second = await registerAgent(ctx.app, {
      name: 'Second Agent',
      description: 'Second valid description for the same rate-limited IP.',
    })

    assert.equal(first.status, 201)
    assert.equal(second.status, 429)
    const body = await parseJson(second)
    assert.equal(body.error, 'Registration rate limit exceeded.')
    assert.ok(body.retry_after_seconds >= 1)
  } finally {
    await ctx.close()
  }
})

test('returns the authenticated agent from GET /api/agents/me', async () => {
  const ctx = await createTestContext()
  try {
    const registration = await parseJson(await registerAgent(ctx.app, {
      name: 'Turing Weaver',
      description: 'Explores optimizer and schedule edits inside autoresearch branches.',
    }))

    const response = await ctx.app.request('http://localhost/api/v1/agents/me', {
      headers: {
        authorization: `Bearer ${registration.api_key}`,
      },
    })

    assert.equal(response.status, 200)
    const body = await parseJson(response)
    assert.equal(body.handle, 'turing-weaver')
    assert.equal(body.api_key_preview, registration.api_key_preview)
    assert.equal(body.claim_status, 'unclaimed')
  } finally {
    await ctx.close()
  }
})

test('rejects invalid and revoked API keys on GET /api/agents/me', async () => {
  const ctx = await createTestContext()
  try {
    const registration = await parseJson(await registerAgent(ctx.app, {
      name: 'Citation Ranger',
      description: 'Tracks internal citations across agent-authored publications.',
    }))

    const invalid = await ctx.app.request('http://localhost/api/v1/agents/me', {
      headers: { authorization: 'Bearer claw_live_invalid' },
    })
    assert.equal(invalid.status, 401)

    await ctx.pool.query(`UPDATE agent_credentials SET status = 'revoked' WHERE api_key_hash = $1`, [ctx.hashApiKey(registration.api_key)])
    const revoked = await ctx.app.request('http://localhost/api/v1/agents/me', {
      headers: { authorization: `Bearer ${registration.api_key}` },
    })
    assert.equal(revoked.status, 401)
  } finally {
    await ctx.close()
  }
})

test('returns a newly registered public agent profile with zero-publication friendly data', async () => {
  const ctx = await createTestContext()
  try {
    const registration = await parseJson(await registerAgent(ctx.app, {
      name: 'Nova Bench',
      description: 'Reruns published branches to measure repeatability.',
    }))

    const response = await ctx.app.request(`http://localhost/api/v1/agents/${registration.handle}`)
    assert.equal(response.status, 200)
    const body = await parseJson(response)
    assert.equal(body.handle, registration.handle)
    assert.equal(body.claim_status, 'unclaimed')
    assert.equal('claim_url' in body, false)
    assert.equal('claim_token' in body, false)
  } finally {
    await ctx.close()
  }
})

test('returns a live claim record for a pending claim token', async () => {
  const ctx = await createTestContext()
  try {
    const registration = await parseJson(await registerAgent(ctx.app, {
      name: 'Atlas Synth',
      description: 'Indexes claim-level evidence from finished runs and packages summaries.',
    }))

    const token = registration.claim_url.split('/').pop()
    const response = await ctx.app.request(`http://localhost/api/v1/claims/${token}`)
    assert.equal(response.status, 200)
    const body = await parseJson(response)
    assert.equal(body.claim_status, 'pending')
    assert.equal(body.is_expired, false)
    assert.match(body.expires_at, /T/)
    assert.equal(body.agent.handle, 'atlas-synth')
    assert.equal('claim_url' in body.agent, false)
    assert.equal('claim_token' in body.agent, false)
  } finally {
    await ctx.close()
  }
})

test('returns expiry state for an expired claim token', async () => {
  const ctx = await createTestContext()
  try {
    const registration = await parseJson(await registerAgent(ctx.app, {
      name: 'Expired Claim View Agent',
      description: 'Shows expired claim metadata when the token window is over.',
    }))

    const token = registration.claim_url.split('/').pop()
    await ctx.pool.query(`UPDATE agent_claims SET expires_at = $2 WHERE claim_token = $1`, [
      token,
      '2000-01-01T00:00:00.000Z',
    ])

    const response = await ctx.app.request(`http://localhost/api/v1/claims/${token}`)
    assert.equal(response.status, 200)
    const body = await parseJson(response)
    assert.equal(body.claim_status, 'pending')
    assert.equal(body.is_expired, true)
    assert.equal(body.expires_at, '2000-01-01T00:00:00.000Z')
  } finally {
    await ctx.close()
  }
})

test('POST /api/claims/:token/start returns success for a valid email submission and sends a Supabase verification link', async () => {
  const ctx = await createTestContext()
  try {
    const sentLinks = []
    const service = createAgentService({ pool: ctx.pool, config: ctx.config })
    const app = createApp({
      service,
      config: ctx.config,
      auth: {
        async sendClaimMagicLink(payload) {
          sentLinks.push(payload)
          return { redirectTo: payload.redirectTo }
        },
      },
    })

    const registration = await parseJson(await registerAgent(app, {
      name: 'Route Claim Start Agent',
      description: 'Starts claim attempts through the public claim-start endpoint.',
    }))

    const claimToken = extractClaimToken(registration.claim_url)
    const response = await startClaim(app, claimToken, 'owner@example.com')

    assert.equal(response.status, 202)
    const body = await parseJson(response)
    assert.equal(body.ok, true)
    assert.equal(body.status, 'pending_verification')
    assert.equal('callback_token' in body, false)

    const attempts = await ctx.pool.query(
      `SELECT ca.attempt_id, ca.email, ca.status
       FROM claim_attempts ca
       JOIN agent_claims c ON c.claim_id = ca.claim_id
       WHERE c.claim_token = $1`,
      [claimToken]
    )

    assert.equal(attempts.rowCount, 1)
    assert.equal(attempts.rows[0].email, 'owner@example.com')
    assert.equal(attempts.rows[0].status, 'pending')
    assert.deepEqual(sentLinks, [{
      email: 'owner@example.com',
      attemptId: attempts.rows[0].attempt_id,
      redirectTo: `${ctx.config.appBaseUrl}/owner/auth/callback?attempt_id=${attempts.rows[0].attempt_id}`,
    }])
  } finally {
    await ctx.close()
  }
})

test('POST /api/claims/:token/start maps Supabase email rate limits to 429', async () => {
  const ctx = await createTestContext()
  try {
    const service = createAgentService({ pool: ctx.pool, config: ctx.config })
    const app = createApp({
      service,
      config: ctx.config,
      auth: {
        async sendClaimMagicLink() {
          const error = new Error('email rate limit exceeded')
          error.status = 429
          error.code = 'over_email_send_rate_limit'
          throw error
        },
      },
    })

    const registration = await parseJson(await registerAgent(app, {
      name: 'Route Claim Rate Limit Agent',
      description: 'Maps provider verification-link throttles to a client-friendly HTTP response.',
    }))

    const claimToken = extractClaimToken(registration.claim_url)
    const response = await startClaim(app, claimToken, 'owner@example.com')

    assert.equal(response.status, 429)
    const body = await parseJson(response)
    assert.equal(body.error, 'Verification link rate limit exceeded. Please wait and try again.')
  } finally {
    await ctx.close()
  }
})

test('POST /api/claims/:token/start returns correct errors for invalid, expired, and used claims', async () => {
  const ctx = await createTestContext()
  try {
    const unknown = await startClaim(ctx.app, 'claim_missing_token', 'owner@example.com')
    assert.equal(unknown.status, 404)
    assert.equal((await parseJson(unknown)).error, 'Claim not found.')

    const expiredRegistration = await parseJson(await registerAgent(ctx.app, {
      name: 'Route Expired Claim Start Agent',
      description: 'Rejects expired claim tokens on the claim-start endpoint.',
    }))
    const expiredToken = extractClaimToken(expiredRegistration.claim_url)
    await ctx.pool.query(`UPDATE agent_claims SET expires_at = $2 WHERE claim_token = $1`, [
      expiredToken,
      '2000-01-01T00:00:00.000Z',
    ])

    const expired = await startClaim(ctx.app, expiredToken, 'owner@example.com')
    assert.equal(expired.status, 410)
    assert.equal((await parseJson(expired)).error, 'Claim token has expired.')

    const usedRegistration = await parseJson(await registerAgent(ctx.app, {
      name: 'Route Used Claim Start Agent',
      description: 'Rejects already-claimed tokens on the claim-start endpoint.',
    }, '203.0.113.11'))
    const usedToken = extractClaimToken(usedRegistration.claim_url)
    const service = createAgentService({ pool: ctx.pool, config: ctx.config })

    const startResult = await service.startClaim(usedToken, 'owner@example.com')
    assert.equal(startResult.status, 202)
    const completeResult = await service.completeClaim({
      token: usedToken,
      email: 'owner@example.com',
      supabaseUserId: 'user_route_used_claim_start',
    })
    assert.equal(completeResult.status, 200)

    const used = await startClaim(ctx.app, usedToken, 'owner@example.com')
    assert.equal(used.status, 409)
    assert.equal((await parseJson(used)).error, 'Claim token has already been used.')
  } finally {
    await ctx.close()
  }
})

test('POST /api/owner/auth/callback completes a claim from verified Supabase user data and returns redirect-ready success data', async () => {
  const ctx = await createTestContext()
  try {
    const service = createAgentService({ pool: ctx.pool, config: ctx.config })
    const app = createApp({
      service,
      config: ctx.config,
      auth: {
        async sendClaimMagicLink() {
          return { redirectTo: `${ctx.config.appBaseUrl}/owner/auth/callback` }
        },
        async verifyAccessToken(token) {
          assert.equal(token, 'supabase_access_token')
          return { id: 'user_route_callback_owner', email: 'owner@example.com' }
        },
      },
    })

    const registration = await parseJson(await registerAgent(app, {
      name: 'Route Callback Claim Agent',
      description: 'Completes claim attempts through the owner auth callback endpoint.',
    }))
    const claimToken = extractClaimToken(registration.claim_url)

    const startResponse = await startClaim(app, claimToken, 'owner@example.com')
    assert.equal(startResponse.status, 202)

    const attempts = await ctx.pool.query(
      `SELECT ca.attempt_id
       FROM claim_attempts ca
       JOIN agent_claims c ON c.claim_id = ca.claim_id
       WHERE c.claim_token = $1`,
      [claimToken]
    )

    const response = await completeClaimFromCallback(app, {
      attemptId: attempts.rows[0].attempt_id,
      accessToken: 'supabase_access_token',
    })

    assert.equal(response.status, 200)
    const body = await parseJson(response)
    assert.equal(body.ok, true)
    assert.equal(body.claimed, true)
    assert.equal(body.agent_handle, registration.handle)
    assert.equal(body.redirect_to, `/owner?agent=${registration.handle}&claimed=1`)

    const owner = await ctx.pool.query('SELECT email, supabase_user_id FROM agent_owners WHERE agent_id = $1', [registration.agent_id])
    const claim = await ctx.pool.query('SELECT status FROM agent_claims WHERE claim_token = $1', [claimToken])

    assert.equal(owner.rowCount, 1)
    assert.equal(owner.rows[0].email, 'owner@example.com')
    assert.equal(owner.rows[0].supabase_user_id, 'user_route_callback_owner')
    assert.equal(claim.rows[0].status, 'claimed')
  } finally {
    await ctx.close()
  }
})

test('POST /api/owner/auth/callback requires verified auth and returns correct errors for invalid, expired, and used claims', async () => {
  const ctx = await createTestContext()
  try {
    const service = createAgentService({ pool: ctx.pool, config: ctx.config })
    const app = createApp({
      service,
      config: ctx.config,
      auth: {
        async sendClaimMagicLink() {
          return { redirectTo: `${ctx.config.appBaseUrl}/owner/auth/callback` }
        },
        async verifyAccessToken(token) {
          if (token === 'good_token') return { id: 'user_good', email: 'owner@example.com' }
          if (token === 'used_token') return { id: 'user_used_callback', email: 'owner@example.com' }
          if (token === 'expired_token') return { id: 'user_expired_claim', email: 'owner@example.com' }
          return null
        },
      },
    })

    const missingAuth = await completeClaimFromCallback(app, { attemptId: 'attempt_missing', accessToken: '' })
    assert.equal(missingAuth.status, 401)
    assert.equal((await parseJson(missingAuth)).error, 'Missing Bearer access token.')

    const invalidAuth = await completeClaimFromCallback(app, { attemptId: 'attempt_missing', accessToken: 'invalid_token' })
    assert.equal(invalidAuth.status, 401)
    assert.equal((await parseJson(invalidAuth)).error, 'Invalid or expired Supabase access token.')

    const expiredRegistration = await parseJson(await registerAgent(app, {
      name: 'Route Expired Callback Agent',
      description: 'Rejects expired claims on the owner auth callback endpoint.',
    }))
    const expiredToken = extractClaimToken(expiredRegistration.claim_url)
    const expiredStart = await startClaim(app, expiredToken, 'owner@example.com')
    assert.equal(expiredStart.status, 202)
    const expiredAttempts = await ctx.pool.query(
      `SELECT ca.attempt_id
       FROM claim_attempts ca
       JOIN agent_claims c ON c.claim_id = ca.claim_id
       WHERE c.claim_token = $1`,
      [expiredToken]
    )
    await ctx.pool.query(`UPDATE agent_claims SET expires_at = $2 WHERE claim_token = $1`, [
      expiredToken,
      '2000-01-01T00:00:00.000Z',
    ])

    const expired = await completeClaimFromCallback(app, {
      attemptId: expiredAttempts.rows[0].attempt_id,
      accessToken: 'expired_token',
    })
    assert.equal(expired.status, 410)
    assert.equal((await parseJson(expired)).error, 'Claim token has expired.')

    const usedRegistration = await parseJson(await registerAgent(app, {
      name: 'Route Used Callback Agent',
      description: 'Rejects already-used claims on the owner auth callback endpoint.',
    }, '203.0.113.11'))
    const usedToken = extractClaimToken(usedRegistration.claim_url)
    const usedStart = await startClaim(app, usedToken, 'owner@example.com')
    assert.equal(usedStart.status, 202)
    const usedAttempts = await ctx.pool.query(
      `SELECT ca.attempt_id
       FROM claim_attempts ca
       JOIN agent_claims c ON c.claim_id = ca.claim_id
       WHERE c.claim_token = $1`,
      [usedToken]
    )

    const firstCallback = await completeClaimFromCallback(app, {
      attemptId: usedAttempts.rows[0].attempt_id,
      accessToken: 'used_token',
    })
    assert.equal(firstCallback.status, 200)

    const used = await completeClaimFromCallback(app, {
      attemptId: usedAttempts.rows[0].attempt_id,
      accessToken: 'used_token',
    })
    assert.equal(used.status, 409)
    assert.equal((await parseJson(used)).error, 'Claim token has already been used.')
  } finally {
    await ctx.close()
  }
})

test('starting a claim creates a pending claim_attempt row', async () => {
  const ctx = await createTestContext()
  try {
    const registration = await parseJson(await registerAgent(ctx.app, {
      name: 'Claim Start Agent',
      description: 'Begins owner claim attempts for registered agents.',
    }))

    const service = createAgentService({ pool: ctx.pool, config: ctx.config })
    const claimToken = extractClaimToken(registration.claim_url)
    const result = await service.startClaim(claimToken, 'owner@example.com')

    assert.equal(result.ok, true)
    assert.equal(result.status, 202)

    const attempts = await ctx.pool.query(
      `SELECT ca.email, ca.status, ca.expires_at, c.claim_token, c.expires_at AS claim_expires_at
       FROM claim_attempts ca
       JOIN agent_claims c ON c.claim_id = ca.claim_id`
    )

    assert.equal(attempts.rowCount, 1)
    assert.equal(attempts.rows[0].email, 'owner@example.com')
    assert.equal(attempts.rows[0].status, 'pending')
    assert.equal(new Date(attempts.rows[0].expires_at).toISOString(), new Date(attempts.rows[0].claim_expires_at).toISOString())
    assert.equal(attempts.rows[0].claim_token, claimToken)
  } finally {
    await ctx.close()
  }
})

test('starting a claim rejects unknown claim tokens', async () => {
  const ctx = await createTestContext()
  try {
    const service = createAgentService({ pool: ctx.pool, config: ctx.config })
    const result = await service.startClaim('claim_missing_token', 'owner@example.com')

    assert.equal(result.ok, false)
    assert.equal(result.status, 404)

    const attempts = await ctx.pool.query('SELECT * FROM claim_attempts')
    assert.equal(attempts.rowCount, 0)
  } finally {
    await ctx.close()
  }
})


test('starting a claim is idempotent for repeated same token and email submissions', async () => {
  const ctx = await createTestContext()
  try {
    const registration = await parseJson(await registerAgent(ctx.app, {
      name: 'Claim Repeat Agent',
      description: 'Does not create duplicate pending attempts for the same owner email.',
    }))

    const service = createAgentService({ pool: ctx.pool, config: ctx.config })
    const claimToken = extractClaimToken(registration.claim_url)

    const firstResult = await service.startClaim(claimToken, 'owner@example.com')
    const secondResult = await service.startClaim(claimToken, 'owner@example.com')

    assert.equal(firstResult.status, 202)
    assert.equal(secondResult.status, 202)

    const attempts = await ctx.pool.query(
      `SELECT ca.email, ca.status
       FROM claim_attempts ca
       JOIN agent_claims c ON c.claim_id = ca.claim_id
       WHERE c.claim_token = $1`,
      [claimToken]
    )

    assert.equal(attempts.rowCount, 1)
    assert.equal(attempts.rows[0].email, 'owner@example.com')
    assert.equal(attempts.rows[0].status, 'pending')
  } finally {
    await ctx.close()
  }
})

test('starting a claim revokes older pending attempts when the email changes', async () => {
  const ctx = await createTestContext()
  try {
    const registration = await parseJson(await registerAgent(ctx.app, {
      name: 'Claim Rotation Agent',
      description: 'Replaces stale pending attempts when a new owner email starts the claim.',
    }))

    const service = createAgentService({ pool: ctx.pool, config: ctx.config })
    const claimToken = extractClaimToken(registration.claim_url)

    const firstResult = await service.startClaim(claimToken, 'first-owner@example.com')
    const secondResult = await service.startClaim(claimToken, 'second-owner@example.com')

    assert.equal(firstResult.status, 202)
    assert.equal(secondResult.status, 202)

    const attempts = await ctx.pool.query(
      `SELECT ca.email, ca.status
       FROM claim_attempts ca
       JOIN agent_claims c ON c.claim_id = ca.claim_id
       WHERE c.claim_token = $1
       ORDER BY ca.created_at ASC, ca.attempt_id ASC`,
      [claimToken]
    )

    assert.equal(attempts.rowCount, 2)
    assert.equal(attempts.rows[0].email, 'first-owner@example.com')
    assert.equal(attempts.rows[0].status, 'revoked')
    assert.equal(attempts.rows[1].email, 'second-owner@example.com')
    assert.equal(attempts.rows[1].status, 'pending')
  } finally {
    await ctx.close()
  }
})

test('completing a claim creates an owner record and marks the agent as claimed', async () => {
  const ctx = await createTestContext()
  try {
    const registration = await parseJson(await registerAgent(ctx.app, {
      name: 'Claim Complete Agent',
      description: 'Completes owner claims for registered agents.',
    }))

    const service = createAgentService({ pool: ctx.pool, config: ctx.config })
    const claimToken = extractClaimToken(registration.claim_url)

    const startResult = await service.startClaim(claimToken, 'owner@example.com')
    assert.equal(startResult.status, 202)

    const completeResult = await service.completeClaim({
      token: claimToken,
      email: 'owner@example.com',
      supabaseUserId: 'user_owner_example',
    })

    assert.equal(completeResult.ok, true)
    assert.equal(completeResult.status, 200)

    const owners = await ctx.pool.query('SELECT agent_id, supabase_user_id, email FROM agent_owners')
    const attempts = await ctx.pool.query(
      `SELECT ca.status, ca.expires_at, c.expires_at AS claim_expires_at
       FROM claim_attempts ca
       JOIN agent_claims c ON c.claim_id = ca.claim_id
       WHERE c.claim_token = $1`,
      [claimToken]
    )
    const agent = await ctx.pool.query('SELECT claim_status FROM agents WHERE agent_id = $1', [registration.agent_id])
    const claim = await ctx.pool.query('SELECT status, claimed_at FROM agent_claims WHERE claim_token = $1', [claimToken])

    assert.equal(owners.rowCount, 1)
    assert.equal(owners.rows[0].agent_id, registration.agent_id)
    assert.equal(owners.rows[0].supabase_user_id, 'user_owner_example')
    assert.equal(owners.rows[0].email, 'owner@example.com')
    assert.equal(attempts.rowCount, 1)
    assert.equal(attempts.rows[0].status, 'completed')
    assert.equal(new Date(attempts.rows[0].expires_at).toISOString(), new Date(attempts.rows[0].claim_expires_at).toISOString())
    assert.equal(agent.rows[0].claim_status, 'claimed')
    assert.equal(claim.rows[0].status, 'claimed')
    assert.ok(claim.rows[0].claimed_at)
  } finally {
    await ctx.close()
  }
})


test('completing a claim rejects unknown claim tokens', async () => {
  const ctx = await createTestContext()
  try {
    const service = createAgentService({ pool: ctx.pool, config: ctx.config })
    const result = await service.completeClaim({
      token: 'claim_missing_token',
      email: 'owner@example.com',
      supabaseUserId: 'user_owner_example',
    })

    assert.equal(result.ok, false)
    assert.equal(result.status, 404)

    const owners = await ctx.pool.query('SELECT * FROM agent_owners')
    assert.equal(owners.rowCount, 0)
  } finally {
    await ctx.close()
  }
})

test('completing a claim rejects expired tokens', async () => {
  const ctx = await createTestContext()
  try {
    const registration = await parseJson(await registerAgent(ctx.app, {
      name: 'Expired Complete Claim Agent',
      description: 'Rejects owner claim completion after the token expires.',
    }))

    const service = createAgentService({ pool: ctx.pool, config: ctx.config })
    const claimToken = extractClaimToken(registration.claim_url)
    const startResult = await service.startClaim(claimToken, 'owner@example.com')
    assert.equal(startResult.status, 202)

    const result = await service.completeClaim({
      token: claimToken,
      email: 'owner@example.com',
      supabaseUserId: 'user_owner_example',
    }, {
      now: new Date('2100-01-01T00:00:00.000Z'),
    })

    assert.equal(result.ok, false)
    assert.equal(result.status, 410)

    const owners = await ctx.pool.query('SELECT * FROM agent_owners')
    const attempts = await ctx.pool.query(
      `SELECT ca.status
       FROM claim_attempts ca
       JOIN agent_claims c ON c.claim_id = ca.claim_id
       WHERE c.claim_token = $1`,
      [claimToken]
    )

    assert.equal(owners.rowCount, 0)
    assert.equal(attempts.rowCount, 1)
    assert.equal(attempts.rows[0].status, 'expired')
  } finally {
    await ctx.close()
  }
})

test('completing a claim requires the verified email to match the submitted email', async () => {
  const ctx = await createTestContext()
  try {
    const registration = await parseJson(await registerAgent(ctx.app, {
      name: 'Claim Email Match Agent',
      description: 'Requires the verified owner email to match the submitted claim email.',
    }))

    const service = createAgentService({ pool: ctx.pool, config: ctx.config })
    const claimToken = extractClaimToken(registration.claim_url)

    const startResult = await service.startClaim(claimToken, 'owner@example.com')
    assert.equal(startResult.status, 202)

    const completeResult = await service.completeClaim({
      token: claimToken,
      email: 'other-owner@example.com',
      supabaseUserId: 'user_owner_example',
    })

    assert.equal(completeResult.ok, false)
    assert.equal(completeResult.status, 409)

    const owners = await ctx.pool.query('SELECT agent_id, supabase_user_id, email FROM agent_owners')
    const attempts = await ctx.pool.query('SELECT status FROM claim_attempts')
    const agent = await ctx.pool.query('SELECT claim_status FROM agents WHERE agent_id = $1', [registration.agent_id])

    assert.equal(owners.rowCount, 0)
    assert.equal(attempts.rowCount, 1)
    assert.equal(attempts.rows[0].status, 'pending')
    assert.equal(agent.rows[0].claim_status, 'unclaimed')
  } finally {
    await ctx.close()
  }
})

test('claimed tokens cannot be completed a second time', async () => {
  const ctx = await createTestContext()
  try {
    const registration = await parseJson(await registerAgent(ctx.app, {
      name: 'Claim Reuse Agent',
      description: 'Rejects repeated claim completion after a token has already been used.',
    }))

    const service = createAgentService({ pool: ctx.pool, config: ctx.config })
    const claimToken = extractClaimToken(registration.claim_url)

    await service.startClaim(claimToken, 'owner@example.com')
    const firstCompleteResult = await service.completeClaim({
      token: claimToken,
      email: 'owner@example.com',
      supabaseUserId: 'user_owner_example',
    })
    assert.equal(firstCompleteResult.status, 200)

    const secondCompleteResult = await service.completeClaim({
      token: claimToken,
      email: 'owner@example.com',
      supabaseUserId: 'user_owner_example',
    })

    assert.equal(secondCompleteResult.ok, false)
    assert.equal(secondCompleteResult.status, 409)
  } finally {
    await ctx.close()
  }
})

test('one email cannot claim a second agent', async () => {
  const ctx = await createTestContext()
  try {
    const firstRegistration = await parseJson(await registerAgent(ctx.app, {
      name: 'First Claim Agent',
      description: 'First agent owned by the test owner email.',
    }))
    const secondRegistration = await parseJson(await registerAgent(ctx.app, {
      name: 'Second Claim Agent',
      description: 'Second agent that should reject the same owner email.',
    }, '203.0.113.11'))

    const service = createAgentService({ pool: ctx.pool, config: ctx.config })
    const ownerEmail = 'Owner@Example.com'

    const firstClaimToken = extractClaimToken(firstRegistration.claim_url)
    await service.startClaim(firstClaimToken, ownerEmail)
    const firstCompleteResult = await service.completeClaim({
      token: firstClaimToken,
      email: 'owner@example.com',
      supabaseUserId: 'user_owner_example',
    })
    assert.equal(firstCompleteResult.status, 200)

    const secondClaimToken = extractClaimToken(secondRegistration.claim_url)
    const secondStartResult = await service.startClaim(secondClaimToken, 'owner@example.com')
    assert.equal(secondStartResult.status, 202)

    const secondCompleteResult = await service.completeClaim({
      token: secondClaimToken,
      email: ownerEmail,
      supabaseUserId: 'user_owner_example_second',
    })

    assert.equal(secondCompleteResult.ok, false)
    assert.equal(secondCompleteResult.status, 409)

    const owners = await ctx.pool.query('SELECT agent_id, supabase_user_id, email FROM agent_owners ORDER BY agent_id')
    const secondAgent = await ctx.pool.query('SELECT claim_status FROM agents WHERE agent_id = $1', [secondRegistration.agent_id])

    assert.equal(owners.rowCount, 1)
    assert.equal(owners.rows[0].agent_id, firstRegistration.agent_id)
    assert.equal(owners.rows[0].supabase_user_id, 'user_owner_example')
    assert.equal(owners.rows[0].email, ownerEmail)
    assert.equal(secondAgent.rows[0].claim_status, 'unclaimed')
  } finally {
    await ctx.close()
  }
})

test('one supabase user cannot claim a second agent', async () => {
  const ctx = await createTestContext()
  try {
    const firstRegistration = await parseJson(await registerAgent(ctx.app, {
      name: 'First User Claim Agent',
      description: 'First agent owned by the test Supabase user id.',
    }))
    const secondRegistration = await parseJson(await registerAgent(ctx.app, {
      name: 'Second User Claim Agent',
      description: 'Second agent that should reject the same owner user id.',
    }, '203.0.113.12'))

    const service = createAgentService({ pool: ctx.pool, config: ctx.config })
    const ownerUserId = 'user_owner_example'

    const firstClaimToken = extractClaimToken(firstRegistration.claim_url)
    await service.startClaim(firstClaimToken, 'owner@example.com')
    const firstCompleteResult = await service.completeClaim({
      token: firstClaimToken,
      email: 'owner@example.com',
      supabaseUserId: ownerUserId,
    })
    assert.equal(firstCompleteResult.status, 200)

    const secondClaimToken = extractClaimToken(secondRegistration.claim_url)
    const secondStartResult = await service.startClaim(secondClaimToken, 'other-owner@example.com')
    assert.equal(secondStartResult.status, 202)

    const secondCompleteResult = await service.completeClaim({
      token: secondClaimToken,
      email: 'other-owner@example.com',
      supabaseUserId: ownerUserId,
    })

    assert.equal(secondCompleteResult.ok, false)
    assert.equal(secondCompleteResult.status, 409)

    const owners = await ctx.pool.query('SELECT agent_id, supabase_user_id, email FROM agent_owners ORDER BY agent_id')
    const secondAgent = await ctx.pool.query('SELECT claim_status FROM agents WHERE agent_id = $1', [secondRegistration.agent_id])

    assert.equal(owners.rowCount, 1)
    assert.equal(owners.rows[0].agent_id, firstRegistration.agent_id)
    assert.equal(owners.rows[0].supabase_user_id, ownerUserId)
    assert.equal(owners.rows[0].email, 'owner@example.com')
    assert.equal(secondAgent.rows[0].claim_status, 'unclaimed')
  } finally {
    await ctx.close()
  }
})

test('expired claim tokens are rejected', async () => {
  const ctx = await createTestContext()
  try {
    const registration = await parseJson(await registerAgent(ctx.app, {
      name: 'Expired Claim Agent',
      description: 'Rejects owner claim attempts after the token expires.',
    }))

    const service = createAgentService({ pool: ctx.pool, config: ctx.config })
    const claimToken = extractClaimToken(registration.claim_url)
    const result = await service.startClaim(claimToken, 'owner@example.com', {
      now: new Date('2100-01-01T00:00:00.000Z'),
    })

    assert.equal(result.ok, false)
    assert.equal(result.status, 410)

    const attempts = await ctx.pool.query(
      `SELECT ca.status, ca.expires_at, c.expires_at AS claim_expires_at
       FROM claim_attempts ca
       JOIN agent_claims c ON c.claim_id = ca.claim_id
       WHERE c.claim_token = $1`,
      [claimToken]
    )

    assert.equal(attempts.rows.some((attempt) => attempt.status === 'pending'), false)
    if (attempts.rowCount > 0) {
      assert.equal(attempts.rows[0].status, 'expired')
      assert.equal(new Date(attempts.rows[0].expires_at).toISOString(), new Date(attempts.rows[0].claim_expires_at).toISOString())
    }
  } finally {
    await ctx.close()
  }
})


test('requires APP_BASE_URL when building production runtime config', () => {
  const config = getConfig({
    nodeEnv: 'production',
    databaseUrl: 'postgres://postgres:postgres@localhost:5432/clawscholar',
    apiKeyEncryptionKey: 'test-secret',
    appBaseUrl: '',
  })

  assert.throws(() => assertRuntimeConfig(config), /APP_BASE_URL/)
})


test('creates publication and publish outcome rows after a valid publish', async () => {
  const ctx = await createTestContext()
  try {
    const registration = await parseJson(await registerAgent(ctx.app, {
      name: 'Publish Atlas',
      description: 'Publishes completed research runs to ClawScholar.',
    }))

    const response = await publishPublication(ctx.app, registration.api_key, validPublicationPayload)

    assert.equal(response.status, 201)

    const publications = await ctx.pool.query('SELECT * FROM publications')
    const outcomes = await ctx.pool.query('SELECT * FROM publish_outcomes')

    assert.equal(publications.rowCount, 1)
    assert.equal(outcomes.rowCount, 1)
    assert.equal(publications.rows[0].source_id, validPublicationPayload.source_id)
    assert.equal(outcomes.rows[0].source_id, validPublicationPayload.source_id)
  } finally {
    await ctx.close()
  }
})

test('supports continues_publication_id and increments parent citation count', async () => {
  const ctx = await createTestContext()
  try {
    const parentAgent = await parseJson(await registerAgent(ctx.app, {
      name: 'Parent Continue Agent',
      description: 'Publishes a parent run that downstream agents can continue.',
    }))
    const childAgent = await parseJson(await registerAgent(ctx.app, {
      name: 'Child Continue Agent',
      description: 'Publishes a follow-up run that continues a prior publication.',
    }, '203.0.113.11'))

    const parentResponse = await publishPublication(ctx.app, parentAgent.api_key, {
      source_id: 'parent-continue-agent:run-1',
      summary: {
        title: 'Parent publication',
        primary_result: 'Parent baseline result.',
      },
    })
    assert.equal(parentResponse.status, 201)
    const parentBody = await parseJson(parentResponse)

    const childResponse = await publishPublication(ctx.app, childAgent.api_key, {
      source_id: 'child-continue-agent:run-1',
      continues_publication_id: parentBody.public_url,
      summary: {
        title: 'Child continuation publication',
        primary_result: 'Child follow-up result that builds on parent.',
      },
    })
    assert.equal(childResponse.status, 201)
    const childBody = await parseJson(childResponse)
    assert.equal(childBody.continues_publication_id, parentBody.publication_id)

    const parentPublication = await ctx.pool.query(
      'SELECT citation_count FROM publications WHERE publication_id = $1',
      [parentBody.publication_id]
    )
    assert.equal(parentPublication.rowCount, 1)
    assert.equal(parentPublication.rows[0].citation_count, 1)

    const continuations = await ctx.pool.query(
      'SELECT parent_publication_id, child_publication_id FROM publication_continuations'
    )
    assert.equal(continuations.rowCount, 1)
    assert.equal(continuations.rows[0].parent_publication_id, parentBody.publication_id)
    assert.equal(continuations.rows[0].child_publication_id, childBody.publication_id)

    const childDetail = await ctx.app.request(`http://localhost/api/v1/publications/${childBody.publication_id}`)
    assert.equal(childDetail.status, 200)
    const childDetailBody = await parseJson(childDetail)
    assert.equal(childDetailBody.continues_publication_id, parentBody.publication_id)
    assert.equal(childDetailBody.citation_refs.length, 1)
    assert.equal(childDetailBody.citation_refs[0].type, 'internal')
    assert.equal(childDetailBody.citation_refs[0].publication_id, parentBody.publication_id)
  } finally {
    await ctx.close()
  }
})

test('deleting a continuation publication removes link and decrements parent citation count', async () => {
  const ctx = await createTestContext()
  try {
    const parentAgent = await parseJson(await registerAgent(ctx.app, {
      name: 'Continuation Parent',
      description: 'Publishes a parent publication for continuation delete checks.',
    }))
    const childAgent = await parseJson(await registerAgent(ctx.app, {
      name: 'Continuation Child',
      description: 'Publishes and then deletes a continuation publication.',
    }, '203.0.113.112'))

    const parentResponse = await publishPublication(ctx.app, parentAgent.api_key, {
      source_id: 'continuation-parent:run-1',
      summary: {
        title: 'Parent publication for deletion test',
        primary_result: 'Parent result.',
      },
    })
    const parentBody = await parseJson(parentResponse)
    assert.equal(parentResponse.status, 201)

    const childResponse = await publishPublication(ctx.app, childAgent.api_key, {
      source_id: 'continuation-child:run-1',
      continues_publication_id: parentBody.publication_id,
      summary: {
        title: 'Child continuation for deletion test',
        primary_result: 'Child result.',
      },
    })
    const childBody = await parseJson(childResponse)
    assert.equal(childResponse.status, 201)

    const deleteResponse = await deletePublication(ctx.app, childAgent.api_key, childBody.publication_id)
    assert.equal(deleteResponse.status, 200)
    assert.equal((await parseJson(deleteResponse)).status, 'deleted')

    const parentPublication = await ctx.pool.query(
      'SELECT citation_count FROM publications WHERE publication_id = $1',
      [parentBody.publication_id]
    )
    assert.equal(parentPublication.rowCount, 1)
    assert.equal(parentPublication.rows[0].citation_count, 0)

    const continuations = await ctx.pool.query(
      'SELECT parent_publication_id, child_publication_id FROM publication_continuations WHERE child_publication_id = $1',
      [childBody.publication_id]
    )
    assert.equal(continuations.rowCount, 0)
  } finally {
    await ctx.close()
  }
})

test('rejects continues_publication_id when the referenced publication does not exist', async () => {
  const ctx = await createTestContext()
  try {
    const registration = await parseJson(await registerAgent(ctx.app, {
      name: 'Bad Continue Agent',
      description: 'Attempts to continue a publication that does not exist.',
    }))

    const response = await publishPublication(ctx.app, registration.api_key, {
      source_id: 'bad-continue-agent:run-1',
      continues_publication_id: 'pub_missing-reference',
      summary: {
        title: 'Invalid continuation',
        primary_result: 'This should fail because parent publication is unknown.',
      },
    })

    assert.equal(response.status, 404)
    const body = await parseJson(response)
    assert.equal(body.error, 'Referenced continuation publication was not found.')

    const publications = await ctx.pool.query('SELECT * FROM publications')
    assert.equal(publications.rowCount, 0)
  } finally {
    await ctx.close()
  }
})


const completePublicationPayload = {
  source_id: 'atlas-synth:commit-002',
  summary: {
    title: 'Atlas Synth complete publish',
    primary_result: 'Complete evidence payload persisted for publish testing.',
  },
  evidence: {
    research_brief: {
      label: 'program.md',
      url: 'https://example.com/program.md',
    },
    key_file: {
      label: 'train.py',
      path: 'train.py',
      url: 'https://example.com/train.py',
    },
    results: {
      label: 'results.tsv',
      url: 'https://example.com/results.tsv',
    },
  },
}

test('rejects publication publish when Bearer token is missing', async () => {
  const ctx = await createTestContext()
  try {
    const response = await ctx.app.request('http://localhost/api/v1/publications', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(validPublicationPayload),
    })

    assert.equal(response.status, 401)
    const body = await parseJson(response)
    assert.equal(body.error, 'Missing Bearer API key.')
  } finally {
    await ctx.close()
  }
})

test('rejects publication publish when Bearer token is invalid', async () => {
  const ctx = await createTestContext()
  try {
    const response = await publishPublication(ctx.app, 'claw_live_invalid', validPublicationPayload)

    assert.equal(response.status, 401)
    const body = await parseJson(response)
    assert.equal(body.error, 'Invalid or revoked API key.')
  } finally {
    await ctx.close()
  }
})

test('deletes an owned publication from public reads', async () => {
  const ctx = await createTestContext()
  try {
    const registration = await parseJson(await registerAgent(ctx.app, {
      name: 'Delete Agent',
      description: 'Deletes mistaken publications from public listing.',
    }))

    const publishResponse = await publishPublication(ctx.app, registration.api_key, {
      source_id: 'delete-agent:run-1',
      summary: {
        title: 'Delete me',
        primary_result: 'This should be removed.',
      },
    })
    assert.equal(publishResponse.status, 201)
    const published = await parseJson(publishResponse)

    const deleteResponse = await deletePublication(ctx.app, registration.api_key, published.publication_id)
    assert.equal(deleteResponse.status, 200)
    const deleteBody = await parseJson(deleteResponse)
    assert.equal(deleteBody.status, 'deleted')
    assert.equal(deleteBody.deleted, true)
    assert.equal(deleteBody.publication_id, published.publication_id)

    const detailResponse = await ctx.app.request(`http://localhost/api/v1/publications/${published.publication_id}`)
    assert.equal(detailResponse.status, 404)

    const listResponse = await ctx.app.request('http://localhost/api/v1/publications')
    assert.equal(listResponse.status, 200)
    const listBody = await parseJson(listResponse)
    assert.equal(listBody.publications.length, 0)
  } finally {
    await ctx.close()
  }
})

test('delete publication requires valid bearer token and ownership', async () => {
  const ctx = await createTestContext()
  try {
    const owner = await parseJson(await registerAgent(ctx.app, {
      name: 'Delete Owner',
      description: 'Owns the publication used for delete authorization checks.',
    }))
    const stranger = await parseJson(await registerAgent(ctx.app, {
      name: 'Delete Stranger',
      description: 'Attempts to delete another agent publication.',
    }, '203.0.113.111'))

    const publishResponse = await publishPublication(ctx.app, owner.api_key, {
      source_id: 'delete-owner:run-1',
      summary: {
        title: 'Protected publication',
        primary_result: 'Only owner can delete this.',
      },
    })
    assert.equal(publishResponse.status, 201)
    const published = await parseJson(publishResponse)

    const missingToken = await ctx.app.request(`http://localhost/api/v1/publications/${published.publication_id}`, {
      method: 'DELETE',
    })
    assert.equal(missingToken.status, 401)
    assert.equal((await parseJson(missingToken)).error, 'Missing Bearer API key.')

    const invalidToken = await deletePublication(ctx.app, 'claw_live_invalid', published.publication_id)
    assert.equal(invalidToken.status, 401)
    assert.equal((await parseJson(invalidToken)).error, 'Invalid or revoked API key.')

    const wrongOwner = await deletePublication(ctx.app, stranger.api_key, published.publication_id)
    assert.equal(wrongOwner.status, 404)
    assert.equal((await parseJson(wrongOwner)).error, 'Publication not found.')
  } finally {
    await ctx.close()
  }
})

test('rejects invalid publication payloads with field-level errors', async () => {
  const ctx = await createTestContext()
  try {
    const registration = await parseJson(await registerAgent(ctx.app, {
      name: 'Validation Agent',
      description: 'Validates minimal publication payload requirements.',
    }))

    const response = await publishPublication(ctx.app, registration.api_key, {
      source_id: '',
      summary: {
        title: '   ',
        primary_result: '   ',
      },
    })

    assert.equal(response.status, 400)
    const body = await parseJson(response)
    assert.equal(body.error, 'Invalid publication payload.')
    assert.equal(body.fields.length, 3)
  } finally {
    await ctx.close()
  }
})

test('marks evidence_status as artifact_complete when brief, key file, and results urls are present', async () => {
  const ctx = await createTestContext()
  try {
    const registration = await parseJson(await registerAgent(ctx.app, {
      name: 'Complete Evidence Agent',
      description: 'Publishes complete evidence bundles for artifact-complete checks.',
    }))

    const response = await publishPublication(ctx.app, registration.api_key, completePublicationPayload)

    assert.equal(response.status, 201)
    const body = await parseJson(response)
    assert.equal(body.evidence_status, 'artifact_complete')
  } finally {
    await ctx.close()
  }
})

test('marks evidence_status as incomplete when the core evidence trio is missing', async () => {
  const ctx = await createTestContext()
  try {
    const registration = await parseJson(await registerAgent(ctx.app, {
      name: 'Partial Evidence Agent',
      description: 'Publishes incomplete evidence bundles for trust-label checks.',
    }))

    const response = await publishPublication(ctx.app, registration.api_key, validPublicationPayload)

    assert.equal(response.status, 201)
    const body = await parseJson(response)
    assert.equal(body.evidence_status, 'incomplete')
  } finally {
    await ctx.close()
  }
})

test('reuses the same publication for repeated agent source_id publishes', async () => {
  const ctx = await createTestContext()
  try {
    const registration = await parseJson(await registerAgent(ctx.app, {
      name: 'Replay Agent',
      description: 'Replays the same publication payload to test idempotency.',
    }))

    const first = await publishPublication(ctx.app, registration.api_key, validPublicationPayload)
    const second = await publishPublication(ctx.app, registration.api_key, validPublicationPayload)

    assert.equal(first.status, 201)
    assert.equal(second.status, 200)

    const publications = await ctx.pool.query('SELECT * FROM publications')
    const outcomes = await ctx.pool.query('SELECT * FROM publish_outcomes')

    assert.equal(publications.rowCount, 1)
    assert.equal(outcomes.rowCount, 1)
  } finally {
    await ctx.close()
  }
})

test('updates existing publication when research_id matches a new source snapshot', async () => {
  const ctx = await createTestContext()
  try {
    const registration = await parseJson(await registerAgent(ctx.app, {
      name: 'Research Update Agent',
      description: 'Publishes multiple snapshots for one research thread without creating duplicates.',
    }))

    const firstPayload = {
      source_id: 'research-update-agent:run-1',
      research_id: 'research-update-agent:t4-depth-batch',
      summary: {
        title: 'Research thread v1',
        primary_result: 'Initial finding from the first snapshot.',
      },
      evidence: {
        commit_sha: 'aaa111',
      },
    }

    const secondPayload = {
      source_id: 'research-update-agent:run-2',
      research_id: 'research-update-agent:t4-depth-batch',
      summary: {
        title: 'Research thread v2',
        primary_result: 'Updated finding from the second snapshot.',
      },
      evidence: {
        commit_sha: 'bbb222',
      },
    }

    const firstResponse = await publishPublication(ctx.app, registration.api_key, firstPayload)
    const firstBody = await parseJson(firstResponse)
    const secondResponse = await publishPublication(ctx.app, registration.api_key, secondPayload)
    const secondBody = await parseJson(secondResponse)

    assert.equal(firstResponse.status, 201)
    assert.equal(secondResponse.status, 200)
    assert.equal(firstBody.publication_id, secondBody.publication_id)
    assert.equal(secondBody.research_id, firstPayload.research_id)

    const publications = await ctx.pool.query(
      `SELECT publication_id, source_id, research_id, title, primary_result
       FROM publications
       WHERE agent_id = $1`,
      [registration.agent_id]
    )
    const outcomes = await ctx.pool.query(
      `SELECT outcome_id, source_id
       FROM publish_outcomes
       WHERE agent_id = $1`,
      [registration.agent_id]
    )

    assert.equal(publications.rowCount, 1)
    assert.equal(outcomes.rowCount, 2)
    assert.equal(publications.rows[0].source_id, secondPayload.source_id)
    assert.equal(publications.rows[0].research_id, secondPayload.research_id)
    assert.equal(publications.rows[0].title, secondPayload.summary.title)
    assert.equal(publications.rows[0].primary_result, secondPayload.summary.primary_result)
  } finally {
    await ctx.close()
  }
})

test('preserves existing evidence artifacts when research updates are partial', async () => {
  const ctx = await createTestContext()
  try {
    const registration = await parseJson(await registerAgent(ctx.app, {
      name: 'Research Merge Agent',
      description: 'Keeps prior evidence links when a later update omits optional fields.',
    }))

    const firstPayload = {
      source_id: 'research-merge-agent:run-1',
      research_id: 'research-merge-agent:t4-thread',
      summary: {
        title: 'Research merge thread',
        primary_result: 'Baseline run with full evidence bundle.',
      },
      evidence: {
        research_brief: {
          label: 'program.md',
          url: 'https://example.com/program.md',
        },
        key_file: {
          label: 'train.py',
          url: 'https://example.com/train.py',
        },
        results: {
          label: 'results.tsv',
          url: 'https://example.com/results.tsv',
        },
      },
      artifacts: [
        {
          type: 'results_ledger',
          label: 'results.tsv',
          url: 'https://example.com/results.tsv',
          requested_visibility: 'public',
        },
      ],
    }

    const secondPayload = {
      source_id: 'research-merge-agent:run-2',
      research_id: 'research-merge-agent:t4-thread',
      summary: {
        title: 'Research merge thread (updated)',
        primary_result: 'Second snapshot updates headline only.',
      },
      evidence: {
        commit_sha: 'bbb222',
      },
      artifacts: [],
    }

    const firstResponse = await publishPublication(ctx.app, registration.api_key, firstPayload)
    const secondResponse = await publishPublication(ctx.app, registration.api_key, secondPayload)

    assert.equal(firstResponse.status, 201)
    assert.equal(secondResponse.status, 200)
    assert.equal((await parseJson(secondResponse)).evidence_status, 'artifact_complete')

    const publication = await ctx.pool.query(
      `SELECT source_id, evidence_status, evidence, artifacts
       FROM publications
       WHERE agent_id = $1`,
      [registration.agent_id]
    )

    assert.equal(publication.rowCount, 1)
    assert.equal(publication.rows[0].source_id, secondPayload.source_id)
    assert.equal(publication.rows[0].evidence_status, 'artifact_complete')
    assert.equal(publication.rows[0].evidence.results.url, 'https://example.com/results.tsv')
    assert.equal(publication.rows[0].artifacts.length, 1)
    assert.equal(publication.rows[0].artifacts[0].url, 'https://example.com/results.tsv')
  } finally {
    await ctx.close()
  }
})


test('lists live publications newest first with embedded public agent trust fields', async () => {
  const ctx = await createTestContext()
  try {
    const firstAgent = await parseJson(await registerAgent(ctx.app, {
      name: 'List Agent One',
      description: 'Publishes the older live publication for listing tests.',
    }))
    const secondAgent = await parseJson(await registerAgent(ctx.app, {
      name: 'List Agent Two',
      description: 'Publishes the newer live publication for listing tests.',
    }))

    const olderPayload = {
      ...validPublicationPayload,
      source_id: 'list-agent-one:alpha',
      summary: {
        ...validPublicationPayload.summary,
        title: 'Older live publication',
        primary_result: 'Older result',
      },
    }
    const newerPayload = {
      ...completePublicationPayload,
      source_id: 'list-agent-two:beta',
      summary: {
        ...completePublicationPayload.summary,
        title: 'Newer live publication',
        primary_result: 'Newer result',
      },
    }

    const olderResponse = await publishPublication(ctx.app, firstAgent.api_key, olderPayload)
    assert.equal(olderResponse.status, 201)
    await new Promise((resolve) => setTimeout(resolve, 5))
    const newerResponse = await publishPublication(ctx.app, secondAgent.api_key, newerPayload)
    assert.equal(newerResponse.status, 201)

    const response = await ctx.app.request('http://localhost/api/v1/publications')
    assert.equal(response.status, 200)
    const body = await parseJson(response)

    assert.equal(Array.isArray(body.publications), true)
    assert.equal(body.publications.length, 2)
    assert.equal(body.publications[0].title, 'Newer live publication')
    assert.equal(body.publications[1].title, 'Older live publication')
    assert.equal(body.publications[0].agent.handle, 'list-agent-two')
    assert.equal(body.publications[0].agent.claim_status, 'unclaimed')
    assert.equal('claim_token' in body.publications[0].agent, false)
    assert.equal('claim_url' in body.publications[0].agent, false)
  } finally {
    await ctx.close()
  }
})

test('returns a persisted publication by exact id and id-slug', async () => {
  const ctx = await createTestContext()
  try {
    const registration = await parseJson(await registerAgent(ctx.app, {
      name: 'Detail Agent',
      description: 'Publishes one record for publication detail tests.',
    }))

    const publishResponse = await publishPublication(ctx.app, registration.api_key, completePublicationPayload)
    assert.equal(publishResponse.status, 201)
    const published = await parseJson(publishResponse)

    const byId = await ctx.app.request(`http://localhost/api/v1/publications/${published.publication_id}`)
    const bySlug = await ctx.app.request(`http://localhost/api/v1/publications/${published.publication_id}-baseline-depth-4-gpt-remains-optimal-under-extreme-mps-throughput-constraints`)

    assert.equal(byId.status, 200)
    assert.equal(bySlug.status, 200)

    const idBody = await parseJson(byId)
    const slugBody = await parseJson(bySlug)

    assert.equal(idBody.publication_id, published.publication_id)
    assert.equal(slugBody.publication_id, published.publication_id)
    assert.equal(idBody.agent.handle, 'detail-agent')
    assert.equal(idBody.evidence_status, 'artifact_complete')
    assert.equal(idBody.title, completePublicationPayload.summary.title)
    assert.equal(idBody.summary.primary_result, completePublicationPayload.summary.primary_result)
    assert.equal('claim_token' in idBody.agent, false)
    assert.equal('claim_url' in idBody.agent, false)
  } finally {
    await ctx.close()
  }
})

test('returns live publications for a specific agent from the service layer', async () => {
  const ctx = await createTestContext()
  try {
    const registration = await parseJson(await registerAgent(ctx.app, {
      name: 'Agent Publications',
      description: 'Owns multiple publications used for agent-profile read tests.',
    }))

    await publishPublication(ctx.app, registration.api_key, {
      ...validPublicationPayload,
      source_id: 'agent-publications:one',
      summary: {
        ...validPublicationPayload.summary,
        title: 'Agent publication one',
        primary_result: 'First live publication',
      },
    })
    await publishPublication(ctx.app, registration.api_key, {
      ...completePublicationPayload,
      source_id: 'agent-publications:two',
      summary: {
        ...completePublicationPayload.summary,
        title: 'Agent publication two',
        primary_result: 'Second live publication',
      },
    })

    const service = createAgentService({ pool: ctx.pool, config: ctx.config })
    const publications = await service.listPublicationsForAgent('agent-publications')
    assert.equal(publications.length, 2)
    assert.equal(publications[0].agent.handle, 'agent-publications')
    assert.equal(publications[0].agent.claim_status, 'unclaimed')
    assert.equal('claim_token' in publications[0].agent, false)
    assert.equal('claim_url' in publications[0].agent, false)
  } finally {
    await ctx.close()
  }
})

test('claimed owners can update publish policy through the owner API', async () => {
  const ctx = await createTestContext()
  try {
    const service = createAgentService({ pool: ctx.pool, config: ctx.config })
    const app = createApp({
      service,
      config: ctx.config,
      auth: {
        async verifyAccessToken(token) {
          assert.equal(token, 'owner_access_token')
          return { id: 'owner_user_policy', email: 'owner@example.com' }
        },
      },
    })

    const registration = await parseJson(await registerAgent(app, {
      name: 'Policy Control Agent',
      description: 'Allows claimed owners to set publish behavior for future submissions.',
    }))
    const claimToken = extractClaimToken(registration.claim_url)
    await service.startClaim(claimToken, 'owner@example.com')
    await service.completeClaim({
      token: claimToken,
      email: 'owner@example.com',
      supabaseUserId: 'owner_user_policy',
    })

    const response = await updateOwnerPolicy(app, registration.agent_id, 'owner_access_token', {
      mode: 'auto_publish_selected',
      selected_artifact_types: ['results_ledger'],
    })

    assert.equal(response.status, 200)
    const body = await parseJson(response)
    assert.equal(body.agent_id, registration.agent_id)
    assert.equal(body.publish_policy.mode, 'auto_publish_selected')
    assert.deepEqual(body.publish_policy.selected_artifact_types, ['results_ledger'])
  } finally {
    await ctx.close()
  }
})

test('review_every_post policy records needs_review outcomes but hides publication from public feed', async () => {
  const ctx = await createTestContext()
  try {
    const service = createAgentService({ pool: ctx.pool, config: ctx.config })
    const app = createApp({
      service,
      config: ctx.config,
      auth: {
        async verifyAccessToken(token) {
          assert.equal(token, 'owner_review_token')
          return { id: 'owner_user_review', email: 'owner@example.com' }
        },
      },
    })

    const registration = await parseJson(await registerAgent(app, {
      name: 'Needs Review Agent',
      description: 'Routes publish attempts into review before any public listing appears.',
    }))
    const claimToken = extractClaimToken(registration.claim_url)
    await service.startClaim(claimToken, 'owner@example.com')
    await service.completeClaim({
      token: claimToken,
      email: 'owner@example.com',
      supabaseUserId: 'owner_user_review',
    })

    const policyUpdate = await updateOwnerPolicy(app, registration.agent_id, 'owner_review_token', {
      mode: 'review_every_post',
    })
    assert.equal(policyUpdate.status, 200)

    const publishResponse = await publishPublication(app, registration.api_key, {
      source_id: 'needs-review-agent:run-1',
      summary: {
        title: 'Needs review publish candidate',
        primary_result: 'This publish should require human review before public visibility.',
      },
      artifacts: [
        {
          type: 'results_ledger',
          label: 'results.tsv',
          url: 'https://example.com/results.tsv',
          requested_visibility: 'public',
        },
      ],
    })

    assert.equal(publishResponse.status, 201)
    const publishBody = await parseJson(publishResponse)
    assert.equal(publishBody.status, 'needs_review')
    assert.equal(typeof publishBody.review_item_ref, 'string')
    assert.equal(publishBody.publication_id, null)
    assert.equal(publishBody.public_url, null)

    const listResponse = await app.request('http://localhost/api/v1/publications')
    assert.equal(listResponse.status, 200)
    const listBody = await parseJson(listResponse)
    assert.equal(listBody.publications.length, 0)

    const ownerOutcomesResponse = await app.request(`http://localhost/api/v1/owner/agents/${registration.agent_id}/outcomes`, {
      headers: {
        authorization: 'Bearer owner_review_token',
      },
    })
    assert.equal(ownerOutcomesResponse.status, 200)
    const ownerOutcomesBody = await parseJson(ownerOutcomesResponse)
    assert.equal(ownerOutcomesBody.outcomes.length, 1)
    assert.equal(ownerOutcomesBody.outcomes[0].status, 'needs_review')
  } finally {
    await ctx.close()
  }
})

test('auto_publish_selected withholds non-allowed artifacts and returns published_with_restrictions', async () => {
  const ctx = await createTestContext()
  try {
    const service = createAgentService({ pool: ctx.pool, config: ctx.config })
    const app = createApp({
      service,
      config: ctx.config,
      auth: {
        async verifyAccessToken(token) {
          assert.equal(token, 'owner_selected_token')
          return { id: 'owner_user_selected', email: 'owner@example.com' }
        },
      },
    })

    const registration = await parseJson(await registerAgent(app, {
      name: 'Restricted Artifact Agent',
      description: 'Publishes only selected artifact types while withholding all others.',
    }))
    const claimToken = extractClaimToken(registration.claim_url)
    await service.startClaim(claimToken, 'owner@example.com')
    await service.completeClaim({
      token: claimToken,
      email: 'owner@example.com',
      supabaseUserId: 'owner_user_selected',
    })

    const policyUpdate = await updateOwnerPolicy(app, registration.agent_id, 'owner_selected_token', {
      mode: 'auto_publish_selected',
      selected_artifact_types: ['results_ledger'],
    })
    assert.equal(policyUpdate.status, 200)

    const publishResponse = await publishPublication(app, registration.api_key, {
      source_id: 'restricted-artifact-agent:run-1',
      summary: {
        title: 'Restricted artifact publish',
        primary_result: 'Only selected artifacts should remain public in the saved publication.',
      },
      artifacts: [
        {
          type: 'results_ledger',
          label: 'results.tsv',
          url: 'https://example.com/results.tsv',
          requested_visibility: 'public',
        },
        {
          type: 'checkpoint',
          label: 'model.ckpt',
          url: 'https://example.com/model.ckpt',
          requested_visibility: 'public',
        },
      ],
    })

    assert.equal(publishResponse.status, 201)
    const publishBody = await parseJson(publishResponse)
    assert.equal(publishBody.status, 'published_with_restrictions')
    assert.equal(Array.isArray(publishBody.withheld_artifacts), true)
    assert.equal(publishBody.withheld_artifacts.length, 1)
    assert.equal(publishBody.withheld_artifacts[0].type, 'checkpoint')

    const storedPublication = await ctx.pool.query('SELECT artifacts FROM publications WHERE agent_id = $1', [registration.agent_id])
    assert.equal(storedPublication.rowCount, 1)
    assert.equal(storedPublication.rows[0].artifacts.length, 1)
    assert.equal(storedPublication.rows[0].artifacts[0].type, 'results_ledger')
  } finally {
    await ctx.close()
  }
})
