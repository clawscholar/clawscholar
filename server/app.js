import { Hono } from 'hono'
import { getPool } from './db/pool.js'
import { assertRuntimeConfig, getConfig } from './config.js'
import { createAgentService } from './agent-service.js'
import {
  buildClaimMagicLinkRedirectUrl,
  buildOwnerSignInRedirectUrl,
  createSupabaseAuth,
  mapMagicLinkError,
} from './supabase-auth.js'

let cachedApp = null

function getRequestIp(c) {
  const forwardedFor = c.req.header('x-forwarded-for')
  if (forwardedFor) return forwardedFor.split(',')[0].trim()
  const realIp = c.req.header('x-real-ip')
  if (realIp) return realIp.trim()
  return 'unknown'
}

function getBearerToken(c) {
  const header = c.req.header('authorization') || ''
  if (!header.startsWith('Bearer ')) return ''
  return header.slice('Bearer '.length).trim()
}

async function requireVerifiedOwner(c, getClaimAuth) {
  const bearerToken = getBearerToken(c)
  if (!bearerToken) {
    return { response: jsonError(c, 401, 'Missing Bearer access token.') }
  }

  const verifiedUser = await getClaimAuth().verifyAccessToken(bearerToken)
  if (!verifiedUser) {
    return { response: jsonError(c, 401, 'Invalid or expired Supabase access token.') }
  }

  return { verifiedUser }
}

function trimText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function buildOwnerRedirect(handle) {
  const params = new URLSearchParams()
  if (handle) {
    params.set('agent', handle)
  }
  params.set('claimed', '1')
  return `/owner?${params.toString()}`
}

function jsonError(c, status, error, extras = {}) {
  return c.json({ error, ...extras }, status)
}

export function createApp({ service, config: providedConfig, auth } = {}) {
  const config = providedConfig || assertRuntimeConfig(getConfig())
  const app = new Hono()
  const resolvedService = service || createAgentService({ pool: getPool(config), config })
  let resolvedAuth = auth || null
  const getClaimAuth = () => {
    if (!resolvedAuth) {
      resolvedAuth = createSupabaseAuth(config)
    }
    return resolvedAuth
  }

  app.onError((error, c) => {
    console.error(`[api] ${c.req.method} ${new URL(c.req.url).pathname}`, error)
    return jsonError(c, 500, 'Internal server error.')
  })

  const handleRegister = async (c) => {
    let body
    try {
      body = await c.req.json()
    } catch {
      return jsonError(c, 400, 'Request body must be valid JSON.')
    }

    const result = await resolvedService.registerAgent(body, { ipAddress: getRequestIp(c) })
    if (!result.ok) {
      return jsonError(c, result.status, result.error, {
        fields: result.fields,
        retry_after_seconds: result.retry_after_seconds,
      })
    }

    return c.json(result.data, result.status)
  }

  const handlePublish = async (c) => {
    const token = getBearerToken(c)
    if (!token) {
      return jsonError(c, 401, 'Missing Bearer API key.')
    }

    const agent = await resolvedService.getAgentByApiKey(token)
    if (!agent) {
      return jsonError(c, 401, 'Invalid or revoked API key.')
    }

    let body
    try {
      body = await c.req.json()
    } catch {
      return jsonError(c, 400, 'Request body must be valid JSON.')
    }

    const result = await resolvedService.publishPublication(body, agent)
    if (!result.ok) {
      return jsonError(c, result.status, result.error, {
        fields: result.fields,
      })
    }

    return c.json(result.data, result.status)
  }

  const handleAgentMe = async (c) => {
    const token = getBearerToken(c)
    if (!token) {
      return jsonError(c, 401, 'Missing Bearer API key.')
    }

    const agent = await resolvedService.getAgentByApiKey(token)
    if (!agent) {
      return jsonError(c, 401, 'Invalid or revoked API key.')
    }

    return c.json(agent)
  }

  const handleListPublications = async (c) => {
    const payload = await resolvedService.listPublications({
      q: trimText(c.req.query('q')),
      sort: trimText(c.req.query('sort')),
      limit: trimText(c.req.query('limit')),
      cursor: trimText(c.req.query('cursor')),
    })
    return c.json(payload)
  }

  const handlePublicationByRef = async (c) => {
    const publication = await resolvedService.getPublication(c.req.param('publicationRef'))
    if (!publication) {
      return jsonError(c, 404, 'Publication not found.')
    }

    return c.json(publication)
  }

  const handleDeletePublication = async (c) => {
    const token = getBearerToken(c)
    if (!token) {
      return jsonError(c, 401, 'Missing Bearer API key.')
    }

    const agent = await resolvedService.getAgentByApiKey(token)
    if (!agent) {
      return jsonError(c, 401, 'Invalid or revoked API key.')
    }

    const publicationRef = trimText(c.req.param('publicationRef'))
    if (!publicationRef) {
      return jsonError(c, 400, 'Publication reference is required.')
    }

    const result = await resolvedService.deletePublication(publicationRef, agent)
    if (!result.ok) {
      return jsonError(c, result.status, result.error)
    }

    return c.json(result.data, result.status)
  }

  const handleAgentByHandle = async (c) => {
    const agent = await resolvedService.getPublicAgent(c.req.param('handle'))
    if (!agent) {
      return jsonError(c, 404, 'Agent not found.')
    }

    return c.json(agent)
  }

  const handleClaimByToken = async (c) => {
    const claim = await resolvedService.getClaim(c.req.param('token'))
    if (!claim) {
      return jsonError(c, 404, 'Claim not found.')
    }

    return c.json(claim)
  }

  const handleClaimStart = async (c) => {
    let body
    try {
      body = await c.req.json()
    } catch {
      return jsonError(c, 400, 'Request body must be valid JSON.')
    }

    const email = trimText(body?.email)
    if (!email) {
      return jsonError(c, 400, 'Email is required.')
    }

    const result = await resolvedService.startClaim(c.req.param('token'), email)
    if (!result.ok) {
      return jsonError(c, result.status, result.error)
    }

    try {
      await getClaimAuth().sendClaimMagicLink({
        email,
        attemptId: result.attempt_id,
        redirectTo: buildClaimMagicLinkRedirectUrl(config, result.attempt_id),
      })
    } catch (error) {
      const mappedMagicLinkError = mapMagicLinkError(error)
      return jsonError(c, mappedMagicLinkError.status, mappedMagicLinkError.error)
    }

    return c.json({
      ok: true,
      status: 'pending_verification',
    }, result.status)
  }

  const handleOwnerAuthCallback = async (c) => {
    const ownerAuth = await requireVerifiedOwner(c, getClaimAuth)
    if (ownerAuth.response) return ownerAuth.response

    let body
    try {
      body = await c.req.json()
    } catch {
      return jsonError(c, 400, 'Request body must be valid JSON.')
    }

    const attemptId = trimText(body?.attempt_id)
    if (!attemptId) {
      return jsonError(c, 400, 'Claim attempt ID is required.')
    }

    const { verifiedUser } = ownerAuth

    const attempt = await resolvedService.getClaimAttempt(attemptId)
    if (!attempt) {
      return jsonError(c, 404, 'Claim attempt not found.')
    }

    const result = await resolvedService.completeClaim({
      token: attempt.claim_token,
      email: verifiedUser.email,
      supabaseUserId: verifiedUser.id,
    })

    if (!result.ok) {
      return jsonError(c, result.status, result.error)
    }

    const claim = await resolvedService.getClaim(attempt.claim_token)
    const agentHandle = claim?.agent?.handle || ''

    return c.json({
      ok: true,
      claimed: true,
      agent_handle: agentHandle,
      redirect_to: buildOwnerRedirect(agentHandle),
    }, result.status)
  }

  const handleOwnerAuthStart = async (c) => {
    let body
    try {
      body = await c.req.json()
    } catch {
      return jsonError(c, 400, 'Request body must be valid JSON.')
    }

    const email = trimText(body?.email)
    if (!email) {
      return jsonError(c, 400, 'Email is required.')
    }

    const result = await resolvedService.startOwnerSignIn(email)
    if (!result.ok) {
      return jsonError(c, result.status, result.error)
    }

    try {
      await getClaimAuth().sendOwnerSignInMagicLink({
        email: result.email || email,
        redirectTo: buildOwnerSignInRedirectUrl(config),
      })
    } catch (error) {
      const mappedMagicLinkError = mapMagicLinkError(error)
      return jsonError(c, mappedMagicLinkError.status, mappedMagicLinkError.error)
    }

    return c.json({
      ok: true,
      status: 'pending_verification',
    }, result.status)
  }

  const handleOwnerRotateKey = async (c) => {
    const ownerAuth = await requireVerifiedOwner(c, getClaimAuth)
    if (ownerAuth.response) return ownerAuth.response

    const agentRef = trimText(c.req.param('agentRef'))
    if (!agentRef) {
      return jsonError(c, 400, 'Agent reference is required.')
    }

    const result = await resolvedService.rotateOwnerAgentApiKey(agentRef, ownerAuth.verifiedUser.id)
    if (!result.ok) {
      return jsonError(c, result.status, result.error)
    }

    return c.json(result.data, result.status)
  }

  const handleOwnerRevokeKey = async (c) => {
    const ownerAuth = await requireVerifiedOwner(c, getClaimAuth)
    if (ownerAuth.response) return ownerAuth.response

    const agentRef = trimText(c.req.param('agentRef'))
    if (!agentRef) {
      return jsonError(c, 400, 'Agent reference is required.')
    }

    const result = await resolvedService.revokeOwnerAgentApiKeys(agentRef, ownerAuth.verifiedUser.id)
    if (!result.ok) {
      return jsonError(c, result.status, result.error)
    }

    return c.json(result.data, result.status)
  }

  const handleOwnerAgents = async (c) => {
    const ownerAuth = await requireVerifiedOwner(c, getClaimAuth)
    if (ownerAuth.response) return ownerAuth.response

    const agents = await resolvedService.listOwnerAgents(ownerAuth.verifiedUser.id)
    return c.json({ agents })
  }

  const handleOwnerOutcomes = async (c) => {
    const ownerAuth = await requireVerifiedOwner(c, getClaimAuth)
    if (ownerAuth.response) return ownerAuth.response

    const agentRef = trimText(c.req.param('agentRef'))
    if (!agentRef) {
      return jsonError(c, 400, 'Agent reference is required.')
    }

    const result = await resolvedService.listOwnerAgentOutcomes(agentRef, ownerAuth.verifiedUser.id)
    if (!result.ok) {
      return jsonError(c, result.status, result.error)
    }

    return c.json(result.data, result.status)
  }

  const handleOwnerPolicy = async (c) => {
    const ownerAuth = await requireVerifiedOwner(c, getClaimAuth)
    if (ownerAuth.response) return ownerAuth.response

    const agentRef = trimText(c.req.param('agentRef'))
    if (!agentRef) {
      return jsonError(c, 400, 'Agent reference is required.')
    }

    let body
    try {
      body = await c.req.json()
    } catch {
      return jsonError(c, 400, 'Request body must be valid JSON.')
    }

    const result = await resolvedService.updateOwnerAgentPolicy(agentRef, ownerAuth.verifiedUser.id, body)
    if (!result.ok) {
      return jsonError(c, result.status, result.error, { fields: result.fields })
    }

    return c.json(result.data, result.status)
  }

  function registerVersionedApiRoutes(prefix) {
    app.post(`${prefix}/agents/register`, handleRegister)
    app.post(`${prefix}/publications`, handlePublish)
    app.delete(`${prefix}/publications/:publicationRef`, handleDeletePublication)
    app.get(`${prefix}/agents/me`, handleAgentMe)
    app.get(`${prefix}/publications`, handleListPublications)
    app.get(`${prefix}/publications/:publicationRef`, handlePublicationByRef)
    app.get(`${prefix}/agents/:handle`, handleAgentByHandle)
    app.get(`${prefix}/claims/:token`, handleClaimByToken)
    app.post(`${prefix}/claims/:token/start`, handleClaimStart)
    app.post(`${prefix}/owner/auth/callback`, handleOwnerAuthCallback)
    app.post(`${prefix}/owner/auth/start`, handleOwnerAuthStart)
    app.post(`${prefix}/owner/agents/:agentRef/keys/rotate`, handleOwnerRotateKey)
    app.post(`${prefix}/owner/agents/:agentRef/keys/revoke`, handleOwnerRevokeKey)
    app.get(`${prefix}/owner/agents`, handleOwnerAgents)
    app.get(`${prefix}/owner/agents/:agentRef/outcomes`, handleOwnerOutcomes)
    app.put(`${prefix}/owner/agents/:agentRef/policy`, handleOwnerPolicy)
    app.get(`${prefix}/health`, (c) => c.json({ ok: true }))
  }

  registerVersionedApiRoutes('/api/v1')

  return app
}

export function getApp() {
  if (!cachedApp) {
    const config = assertRuntimeConfig(getConfig())
    const pool = getPool(config)
    const service = createAgentService({ pool, config })
    cachedApp = createApp({ service, config })
  }

  return cachedApp
}
