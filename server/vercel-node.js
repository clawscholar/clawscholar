import { getPool } from './db/pool.js'
import { assertRuntimeConfig, getConfig } from './config.js'
import { createAgentService } from './agent-service.js'
import {
  buildClaimMagicLinkRedirectUrl,
  buildOwnerSignInRedirectUrl,
  createSupabaseAuth,
  mapMagicLinkError,
} from './supabase-auth.js'

let cachedService = null
let cachedAuth = null

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

function getRequestUrl(req) {
  return new URL(req.url || '/', 'http://localhost')
}

function getQueryValue(req, name) {
  const value = req.query?.[name]
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0] || ''
  return getRequestUrl(req).searchParams.get(name) || ''
}

function getClaimToken(req) {
  const tokenFromQuery = getQueryValue(req, 'token')
  if (tokenFromQuery) return trimText(tokenFromQuery)

  const match = getRequestUrl(req).pathname.match(/^\/api\/v1\/claims\/([^/]+)\/start\/?$/)
  return trimText(match ? decodeURIComponent(match[1]) : '')
}

function getOwnerAgentRef(req, suffix) {
  const tokenFromQuery = getQueryValue(req, 'agentRef')
  if (tokenFromQuery) return trimText(tokenFromQuery)

  const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = getRequestUrl(req).pathname.match(new RegExp(`^/api/v1/owner/agents/([^/]+)/${escapedSuffix}/?$`))
  return trimText(match ? decodeURIComponent(match[1]) : '')
}

function getService() {
  if (!cachedService) {
    const config = assertRuntimeConfig(getConfig())
    const pool = getPool(config)
    cachedService = createAgentService({ pool, config })
  }
  return cachedService
}

function getAuth() {
  if (!cachedAuth) {
    const config = assertRuntimeConfig(getConfig())
    cachedAuth = createSupabaseAuth(config)
  }
  return cachedAuth
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body
  }

  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      throw new Error('Request body must be valid JSON.')
    }
  }

  const chunks = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}

  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('Request body must be valid JSON.')
  }
}

export function sendJson(res, status, payload) {
  res.status(status).json(payload)
}

export function getRequestIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For']
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim()
  }
  const realIp = req.headers['x-real-ip'] || req.headers['X-Real-IP']
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim()
  }
  return 'unknown'
}

export function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || ''
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return ''
  return header.slice('Bearer '.length).trim()
}

async function requireVerifiedOwner(req, res, auth) {
  const bearerToken = getBearerToken(req)
  if (!bearerToken) {
    sendJson(res, 401, { error: 'Missing Bearer access token.' })
    return null
  }

  const verifiedUser = await auth.verifyAccessToken(bearerToken)
  if (!verifiedUser) {
    sendJson(res, 401, { error: 'Invalid or expired Supabase access token.' })
    return null
  }

  return verifiedUser
}

export async function handleRegister(req, res) {
  try {
    const body = await readJsonBody(req)
    const result = await getService().registerAgent(body, { ipAddress: getRequestIp(req) })
    if (!result.ok) {
      return sendJson(res, result.status, {
        error: result.error,
        fields: result.fields,
        retry_after_seconds: result.retry_after_seconds,
      })
    }
    return sendJson(res, result.status, result.data)
  } catch (error) {
    console.error('[api] POST /api/v1/agents/register', error)
    if (error instanceof Error && error.message === 'Request body must be valid JSON.') {
      return sendJson(res, 400, { error: error.message })
    }
    return sendJson(res, 500, { error: 'Internal server error.' })
  }
}

export async function handleClaimStart(req, res, service = getService(), auth = getAuth()) {
  try {
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method not allowed.' })
    }

    const claimToken = getClaimToken(req)
    if (!claimToken) {
      return sendJson(res, 400, { error: 'Claim token is required.' })
    }

    const body = await readJsonBody(req)
    const email = trimText(body?.email)
    if (!email) {
      return sendJson(res, 400, { error: 'Email is required.' })
    }

    const result = await service.startClaim(claimToken, email)
    if (!result.ok) {
      return sendJson(res, result.status, { error: result.error })
    }

    await auth.sendClaimMagicLink({
      email,
      attemptId: result.attempt_id,
      redirectTo: buildClaimMagicLinkRedirectUrl(getConfig(), result.attempt_id),
    })

    return sendJson(res, result.status, {
      ok: true,
      status: 'pending_verification',
    })
  } catch (error) {
    console.error(`[api] ${req.method} /api/v1/claims/:token/start`, error)
    const mappedMagicLinkError = mapMagicLinkError(error)
    if (mappedMagicLinkError.status !== 502) {
      return sendJson(res, mappedMagicLinkError.status, { error: mappedMagicLinkError.error })
    }
    if (error instanceof Error && error.message === 'Request body must be valid JSON.') {
      return sendJson(res, 400, { error: error.message })
    }
    return sendJson(res, mappedMagicLinkError.status, { error: mappedMagicLinkError.error })
  }
}

export async function handleOwnerAuthCallback(req, res, service = getService(), auth = getAuth()) {
  try {
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method not allowed.' })
    }

    const verifiedUser = await requireVerifiedOwner(req, res, auth)
    if (!verifiedUser) return

    const body = await readJsonBody(req)
    const attemptId = trimText(body?.attempt_id)
    if (!attemptId) {
      return sendJson(res, 400, { error: 'Claim attempt ID is required.' })
    }

    const attempt = await service.getClaimAttempt(attemptId)
    if (!attempt) {
      return sendJson(res, 404, { error: 'Claim attempt not found.' })
    }

    const result = await service.completeClaim({
      token: attempt.claim_token,
      email: verifiedUser.email,
      supabaseUserId: verifiedUser.id,
    })

    if (!result.ok) {
      return sendJson(res, result.status, { error: result.error })
    }

    const claim = await service.getClaim(attempt.claim_token)
    const agentHandle = claim?.agent?.handle || ''

    return sendJson(res, result.status, {
      ok: true,
      claimed: true,
      agent_handle: agentHandle,
      redirect_to: buildOwnerRedirect(agentHandle),
    })
  } catch (error) {
    console.error(`[api] ${req.method} /api/v1/owner/auth/callback`, error)
    if (error instanceof Error && error.message === 'Request body must be valid JSON.') {
      return sendJson(res, 400, { error: error.message })
    }
    return sendJson(res, 500, { error: 'Internal server error.' })
  }
}

export async function handleOwnerAuthStart(req, res, service = getService(), auth = getAuth()) {
  try {
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method not allowed.' })
    }

    const body = await readJsonBody(req)
    const email = trimText(body?.email)
    if (!email) {
      return sendJson(res, 400, { error: 'Email is required.' })
    }

    const result = await service.startOwnerSignIn(email)
    if (!result.ok) {
      return sendJson(res, result.status, { error: result.error })
    }

    await auth.sendOwnerSignInMagicLink({
      email: result.email || email,
      redirectTo: buildOwnerSignInRedirectUrl(getConfig()),
    })

    return sendJson(res, result.status, {
      ok: true,
      status: 'pending_verification',
    })
  } catch (error) {
    console.error(`[api] ${req.method} /api/v1/owner/auth/start`, error)
    const mappedMagicLinkError = mapMagicLinkError(error)
    if (mappedMagicLinkError.status !== 502) {
      return sendJson(res, mappedMagicLinkError.status, { error: mappedMagicLinkError.error })
    }
    if (error instanceof Error && error.message === 'Request body must be valid JSON.') {
      return sendJson(res, 400, { error: error.message })
    }
    return sendJson(res, mappedMagicLinkError.status, { error: mappedMagicLinkError.error })
  }
}

export async function handleOwnerRotateKey(req, res, service = getService(), auth = getAuth()) {
  try {
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method not allowed.' })
    }

    const verifiedUser = await requireVerifiedOwner(req, res, auth)
    if (!verifiedUser) return

    const agentRef = getOwnerAgentRef(req, 'keys/rotate')
    if (!agentRef) {
      return sendJson(res, 400, { error: 'Agent reference is required.' })
    }

    const result = await service.rotateOwnerAgentApiKey(agentRef, verifiedUser.id)
    if (!result.ok) {
      return sendJson(res, result.status, { error: result.error })
    }

    return sendJson(res, result.status, result.data)
  } catch (error) {
    console.error(`[api] ${req.method} /api/v1/owner/agents/:agentRef/keys/rotate`, error)
    return sendJson(res, 500, { error: 'Internal server error.' })
  }
}

export async function handleOwnerRevokeKey(req, res, service = getService(), auth = getAuth()) {
  try {
    if (req.method !== 'POST') {
      return sendJson(res, 405, { error: 'Method not allowed.' })
    }

    const verifiedUser = await requireVerifiedOwner(req, res, auth)
    if (!verifiedUser) return

    const agentRef = getOwnerAgentRef(req, 'keys/revoke')
    if (!agentRef) {
      return sendJson(res, 400, { error: 'Agent reference is required.' })
    }

    const result = await service.revokeOwnerAgentApiKeys(agentRef, verifiedUser.id)
    if (!result.ok) {
      return sendJson(res, result.status, { error: result.error })
    }

    return sendJson(res, result.status, result.data)
  } catch (error) {
    console.error(`[api] ${req.method} /api/v1/owner/agents/:agentRef/keys/revoke`, error)
    return sendJson(res, 500, { error: 'Internal server error.' })
  }
}

export async function handleOwnerAgents(req, res, service = getService(), auth = getAuth()) {
  try {
    if (req.method !== 'GET') {
      return sendJson(res, 405, { error: 'Method not allowed.' })
    }

    const verifiedUser = await requireVerifiedOwner(req, res, auth)
    if (!verifiedUser) return

    const agents = await service.listOwnerAgents(verifiedUser.id)
    return sendJson(res, 200, { agents })
  } catch (error) {
    console.error(`[api] ${req.method} /api/v1/owner/agents`, error)
    return sendJson(res, 500, { error: 'Internal server error.' })
  }
}

export async function handleOwnerAgentOutcomes(req, res, service = getService(), auth = getAuth()) {
  try {
    if (req.method !== 'GET') {
      return sendJson(res, 405, { error: 'Method not allowed.' })
    }

    const verifiedUser = await requireVerifiedOwner(req, res, auth)
    if (!verifiedUser) return

    const agentRef = getOwnerAgentRef(req, 'outcomes')
    if (!agentRef) {
      return sendJson(res, 400, { error: 'Agent reference is required.' })
    }

    const result = await service.listOwnerAgentOutcomes(agentRef, verifiedUser.id)
    if (!result.ok) {
      return sendJson(res, result.status, { error: result.error })
    }

    return sendJson(res, result.status, result.data)
  } catch (error) {
    console.error(`[api] ${req.method} /api/v1/owner/agents/:agentRef/outcomes`, error)
    return sendJson(res, 500, { error: 'Internal server error.' })
  }
}

export async function handleOwnerPolicy(req, res, service = getService(), auth = getAuth()) {
  try {
    if (req.method !== 'PUT') {
      return sendJson(res, 405, { error: 'Method not allowed.' })
    }

    const verifiedUser = await requireVerifiedOwner(req, res, auth)
    if (!verifiedUser) return

    const agentRef = getOwnerAgentRef(req, 'policy')
    if (!agentRef) {
      return sendJson(res, 400, { error: 'Agent reference is required.' })
    }

    const body = await readJsonBody(req)
    const result = await service.updateOwnerAgentPolicy(agentRef, verifiedUser.id, body)
    if (!result.ok) {
      return sendJson(res, result.status, { error: result.error, fields: result.fields })
    }

    return sendJson(res, result.status, result.data)
  } catch (error) {
    console.error(`[api] ${req.method} /api/v1/owner/agents/:agentRef/policy`, error)
    if (error instanceof Error && error.message === 'Request body must be valid JSON.') {
      return sendJson(res, 400, { error: error.message })
    }
    return sendJson(res, 500, { error: 'Internal server error.' })
  }
}

export async function handlePublications(req, res) {
  try {
    const service = getService()
    if (req.method === 'GET') {
      const payload = await service.listPublications({
        q: trimText(getQueryValue(req, 'q')),
        sort: trimText(getQueryValue(req, 'sort')),
        limit: trimText(getQueryValue(req, 'limit')),
        cursor: trimText(getQueryValue(req, 'cursor')),
      })
      return sendJson(res, 200, payload)
    }

    if (req.method === 'POST') {
      const token = getBearerToken(req)
      if (!token) {
        return sendJson(res, 401, { error: 'Missing Bearer API key.' })
      }

      const agent = await service.getAgentByApiKey(token)
      if (!agent) {
        return sendJson(res, 401, { error: 'Invalid or revoked API key.' })
      }

      const body = await readJsonBody(req)
      const result = await service.publishPublication(body, agent)
      if (!result.ok) {
        return sendJson(res, result.status, {
          error: result.error,
          fields: result.fields,
        })
      }

      return sendJson(res, result.status, result.data)
    }

    return sendJson(res, 405, { error: 'Method not allowed.' })
  } catch (error) {
    console.error(`[api] ${req.method} /api/v1/publications`, error)
    if (error instanceof Error && error.message === 'Request body must be valid JSON.') {
      return sendJson(res, 400, { error: error.message })
    }
    return sendJson(res, 500, { error: 'Internal server error.' })
  }
}

export async function handleAgentMe(req, res) {
  try {
    if (req.method !== 'GET') {
      return sendJson(res, 405, { error: 'Method not allowed.' })
    }

    const token = getBearerToken(req)
    if (!token) {
      return sendJson(res, 401, { error: 'Missing Bearer API key.' })
    }

    const agent = await getService().getAgentByApiKey(token)
    if (!agent) {
      return sendJson(res, 401, { error: 'Invalid or revoked API key.' })
    }

    return sendJson(res, 200, agent)
  } catch (error) {
    console.error(`[api] ${req.method} /api/v1/agents/me`, error)
    return sendJson(res, 500, { error: 'Internal server error.' })
  }
}

export async function handlePublicationByRef(req, res, service = getService()) {
  try {
    const publicationRef = req.query?.publicationRef || new URL(req.url || '/', 'http://localhost').pathname.split('/').pop()
    const normalizedPublicationRef = trimText(publicationRef)

    if (!normalizedPublicationRef) {
      return sendJson(res, 400, { error: 'Publication reference is required.' })
    }

    if (req.method === 'GET') {
      const publication = await service.getPublication(normalizedPublicationRef)
      if (!publication) {
        return sendJson(res, 404, { error: 'Publication not found.' })
      }

      return sendJson(res, 200, publication)
    }

    if (req.method === 'DELETE') {
      const token = getBearerToken(req)
      if (!token) {
        return sendJson(res, 401, { error: 'Missing Bearer API key.' })
      }

      const agent = await service.getAgentByApiKey(token)
      if (!agent) {
        return sendJson(res, 401, { error: 'Invalid or revoked API key.' })
      }

      const result = await service.deletePublication(normalizedPublicationRef, agent)
      if (!result.ok) {
        return sendJson(res, result.status, { error: result.error })
      }

      return sendJson(res, result.status, result.data)
    }

    return sendJson(res, 405, { error: 'Method not allowed.' })
  } catch (error) {
    console.error(`[api] ${req.method} /api/v1/publications/:publicationRef`, error)
    return sendJson(res, 500, { error: 'Internal server error.' })
  }
}

export async function handlePublicationArtifacts(req, res, service = getService()) {
  try {
    if (req.method !== 'DELETE') {
      return sendJson(res, 405, { error: 'Method not allowed.' })
    }

    const publicationRefFromQuery = req.query?.publicationRef
    const pathMatch = getRequestUrl(req).pathname.match(/\/publications\/([^/]+)(?:\/artifacts)?\/?$/)
    const publicationRefFromPath = pathMatch?.[1] || ''
    const publicationRef = publicationRefFromQuery || publicationRefFromPath
    const normalizedPublicationRef = trimText(publicationRef)
    if (!normalizedPublicationRef) {
      return sendJson(res, 400, { error: 'Publication reference is required.' })
    }

    const token = getBearerToken(req)
    if (!token) {
      return sendJson(res, 401, { error: 'Missing Bearer API key.' })
    }

    const agent = await service.getAgentByApiKey(token)
    if (!agent) {
      return sendJson(res, 401, { error: 'Invalid or revoked API key.' })
    }

    const body = await readJsonBody(req)
    const result = await service.removePublicationArtifact(normalizedPublicationRef, agent, body)
    if (!result.ok) {
      return sendJson(res, result.status, { error: result.error, fields: result.fields })
    }

    return sendJson(res, result.status, result.data)
  } catch (error) {
    console.error(`[api] ${req.method} /api/v1/publications/:publicationRef/artifacts`, error)
    if (error instanceof Error && error.message === 'Request body must be valid JSON.') {
      return sendJson(res, 400, { error: error.message })
    }
    return sendJson(res, 500, { error: 'Internal server error.' })
  }
}

export async function handleAgentByHandle(req, res) {
  try {
    const handle = req.query?.handle || new URL(req.url || '/', 'http://localhost').pathname.split('/').pop()
    const agent = await getService().getPublicAgent(trimText(handle))

    if (!agent) {
      return sendJson(res, 404, { error: 'Agent not found.' })
    }

    return sendJson(res, 200, agent)
  } catch (error) {
    console.error(`[api] ${req.method} /api/v1/agents/:handle`, error)
    return sendJson(res, 500, { error: 'Internal server error.' })
  }
}

export async function handleClaimByToken(req, res) {
  try {
    const token = req.query?.token || new URL(req.url || '/', 'http://localhost').pathname.split('/').pop()
    const claim = await getService().getClaim(trimText(token))

    if (!claim) {
      return sendJson(res, 404, { error: 'Claim not found.' })
    }

    return sendJson(res, 200, claim)
  } catch (error) {
    console.error(`[api] ${req.method} /api/v1/claims/:token`, error)
    return sendJson(res, 500, { error: 'Internal server error.' })
  }
}
