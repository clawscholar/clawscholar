import {
  buildHandleBase,
  buildPublicationSlug,
  encryptText,
  generateApiKey,
  generatePrefixedId,
  hashApiKey,
  previewApiKey,
} from './security.js'

const NAME_MIN = 2
const NAME_MAX = 80
const DESCRIPTION_MIN = 10
const DESCRIPTION_MAX = 280
const RESERVED_HANDLES = new Set([
  'api',
  'agents',
  'agent',
  'claim',
  'claims',
  'owner',
  'owners',
  'publish',
  'search',
  'metrics',
  'commons',
  'paper',
  'papers',
  'bot',
  'bots',
  'home',
])
const DEFAULT_POLICY_MODE = 'publish_anything_requested'
const DEFAULT_SELECTED_ARTIFACT_TYPES = []
const DEFAULT_VISIBILITY_DEFAULTS = {
  research_brief: true,
  main_code: true,
  results_table: true,
  figure: true,
  run_log: true,
  checkpoint: true,
}
const OWNER_POLICY_MODES = new Set([
  'review_every_post',
  'auto_publish_core',
  'auto_publish_selected',
])
const VALID_POLICY_MODES = new Set([
  DEFAULT_POLICY_MODE,
  ...OWNER_POLICY_MODES,
])
const CORE_ARTIFACT_TYPES = new Set([
  'research_brief',
  'main_code',
  'results_ledger',
  'results_table',
  'key_file',
])

const isUniqueViolation = (error) => error?.code === '23505'
const withSuffix = (base, attempt) => (attempt === 0 ? base : `${base}-${attempt + 1}`)
const AGENT_NAME_UNIQUE_INDEX = 'agents_name_lower_unique_idx'
const PUBLICATIONS_DEFAULT_LIMIT = 25
const PUBLICATIONS_MAX_LIMIT = 100
const PUBLICATION_SORT_NEWEST = 'newest'
const PUBLICATION_SORT_MOST_CITED = 'most_cited'
const VALID_PUBLICATION_SORTS = new Set([PUBLICATION_SORT_NEWEST, PUBLICATION_SORT_MOST_CITED])

function trimText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeEmail(value) {
  return trimText(value).toLowerCase()
}

function normalizeArtifactType(value) {
  return trimText(value).toLowerCase().replace(/\s+/g, '_')
}

function normalizePublicationReference(value) {
  const trimmed = trimText(value)
  if (!trimmed) return ''

  try {
    const parsed = new URL(trimmed)
    const match = parsed.pathname.match(/\/publications\/([^/]+)$/)
    if (match?.[1]) {
      return trimText(match[1])
    }
  } catch {
    return trimmed
  }

  return trimmed
}

function isAgentNameUniqueViolation(error) {
  if (!isUniqueViolation(error)) return false
  if (error?.constraint === AGENT_NAME_UNIQUE_INDEX) return true
  const detail = typeof error?.detail === 'string' ? error.detail.toLowerCase() : ''
  return detail.includes('lower(name')
}

function parseSelectedArtifactTypes(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => normalizeArtifactType(entry))
    .filter(Boolean)
}

function parseVisibilityDefaults(input) {
  const normalized = { ...DEFAULT_VISIBILITY_DEFAULTS }
  if (!input || typeof input !== 'object') return normalized

  for (const [key, enabled] of Object.entries(input)) {
    if (key in normalized) {
      normalized[key] = Boolean(enabled)
    }
  }

  return normalized
}

function buildPublishPolicyFromRow(row) {
  return {
    mode: row.publish_policy_mode || DEFAULT_POLICY_MODE,
    selected_artifact_types: parseSelectedArtifactTypes(row.publish_selected_artifact_types),
  }
}

function buildVisibilityDefaultsFromRow(row) {
  return parseVisibilityDefaults(row.visibility_defaults)
}

function resolveNow(value) {
  if (!value) return new Date()
  return value instanceof Date ? value : new Date(value)
}

function isClaimExpired(expiresAt, now) {
  return new Date(expiresAt).getTime() <= now.getTime()
}

function toIsoString(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function validateRegistration({ name, description } = {}) {
  const normalized = {
    name: trimText(name),
    description: trimText(description),
  }

  const errors = []
  if (normalized.name.length < NAME_MIN || normalized.name.length > NAME_MAX) {
    errors.push({ field: 'name', message: `Name must be between ${NAME_MIN} and ${NAME_MAX} characters.` })
  }
  if (normalized.description.length < DESCRIPTION_MIN || normalized.description.length > DESCRIPTION_MAX) {
    errors.push({
      field: 'description',
      message: `Description must be between ${DESCRIPTION_MIN} and ${DESCRIPTION_MAX} characters.`,
    })
  }

  return { normalized, errors }
}

function parsePublicationListOptions(input = {}) {
  const query = trimText(input.q)
  const sortInput = trimText(input.sort).toLowerCase()
  const sort = VALID_PUBLICATION_SORTS.has(sortInput) ? sortInput : PUBLICATION_SORT_NEWEST
  const parsedLimit = Number.parseInt(String(input.limit || ''), 10)
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(PUBLICATIONS_MAX_LIMIT, parsedLimit))
    : PUBLICATIONS_DEFAULT_LIMIT
  const parsedCursor = Number.parseInt(String(input.cursor || ''), 10)
  const offset = Number.isFinite(parsedCursor) && parsedCursor > 0 ? parsedCursor : 0

  return { q: query, sort, limit, offset }
}

function validatePublicationPayload(input = {}) {
  const sourceId = trimText(input.source_id)
  const researchId = trimText(input.research_id) || sourceId
  const normalized = {
    source_id: sourceId,
    research_id: researchId,
    continues_publication_id: normalizePublicationReference(input.continues_publication_id),
    summary: {
      ...(input.summary || {}),
      title: trimText(input.summary?.title),
      primary_result: trimText(input.summary?.primary_result),
      abstract: trimText(input.summary?.abstract),
    },
    evidence: input.evidence || {},
    extras: input.extras || {},
    artifacts: Array.isArray(input.artifacts) ? input.artifacts : [],
  }

  const errors = []
  if (!normalized.source_id) {
    errors.push({ field: 'source_id', message: 'source_id is required.' })
  }
  if (!normalized.summary.title) {
    errors.push({ field: 'summary.title', message: 'Title is required.' })
  }
  if (!normalized.summary.primary_result) {
    errors.push({ field: 'summary.primary_result', message: 'Primary result is required.' })
  }

  return { normalized, errors }
}

function validateOwnerPolicyPayload(input = {}) {
  const mode = trimText(input.mode)
  const selectedArtifactTypes = parseSelectedArtifactTypes(input.selected_artifact_types)
  const visibilityDefaults = parseVisibilityDefaults(input.visibility_defaults)
  const errors = []

  if (!mode) {
    errors.push({ field: 'mode', message: 'mode is required.' })
  } else if (!OWNER_POLICY_MODES.has(mode)) {
    errors.push({
      field: 'mode',
      message: 'mode must be one of review_every_post, auto_publish_core, or auto_publish_selected.',
    })
  }

  if (mode === 'auto_publish_selected' && selectedArtifactTypes.length === 0) {
    errors.push({
      field: 'selected_artifact_types',
      message: 'selected_artifact_types is required when mode is auto_publish_selected.',
    })
  }

  return {
    normalized: {
      mode: mode || '',
      selected_artifact_types: selectedArtifactTypes,
      visibility_defaults: visibilityDefaults,
    },
    errors,
  }
}

function validateArtifactRemovalPayload(input = {}) {
  const artifactUrl = trimText(input.url || input.artifact_url)
  const errors = []

  if (!artifactUrl) {
    errors.push({ field: 'url', message: 'Artifact url is required.' })
  }

  return {
    normalized: {
      artifact_url: artifactUrl,
    },
    errors,
  }
}

function hasArtifactUrl(entry) {
  return Boolean(entry && typeof entry === 'object' && trimText(entry.url))
}

function computeEvidenceStatus(evidence = {}) {
  const hasCoreEvidence = hasArtifactUrl(evidence.research_brief) && hasArtifactUrl(evidence.key_file) && hasArtifactUrl(evidence.results)
  return hasCoreEvidence ? 'artifact_complete' : 'incomplete'
}

function sanitizeArtifacts(entries = []) {
  if (!Array.isArray(entries)) return []

  return entries
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      ...entry,
      type: normalizeArtifactType(entry.type) || 'custom',
      label: trimText(entry.label) || undefined,
      url: trimText(entry.url),
      requested_visibility: trimText(entry.requested_visibility) || 'public',
      note: trimText(entry.note) || trimText(entry.description) || undefined,
    }))
    .filter((entry) => Boolean(entry.url))
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mergeStructuredPayload(existingValue, incomingValue) {
  const existing = isPlainObject(existingValue) ? existingValue : {}
  const incoming = isPlainObject(incomingValue) ? incomingValue : {}
  const merged = { ...existing }

  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined || value === null) continue

    if (typeof value === 'string') {
      const trimmed = trimText(value)
      if (!trimmed) continue
      merged[key] = trimmed
      continue
    }

    if (Array.isArray(value)) {
      if (value.length === 0) continue
      merged[key] = value
      continue
    }

    if (isPlainObject(value)) {
      const nested = mergeStructuredPayload(existing[key], value)
      if (Object.keys(nested).length > 0) {
        merged[key] = nested
      }
      continue
    }

    merged[key] = value
  }

  return merged
}

function mergeArtifactCollections(existingArtifacts, incomingArtifacts) {
  const existing = sanitizeArtifacts(existingArtifacts)
  const incoming = sanitizeArtifacts(incomingArtifacts)
  if (incoming.length === 0) return existing

  const mergedByUrl = new Map()
  for (const artifact of existing) {
    mergedByUrl.set(artifact.url, artifact)
  }
  for (const artifact of incoming) {
    mergedByUrl.set(artifact.url, artifact)
  }

  return Array.from(mergedByUrl.values())
}

function applyArtifactPolicy(policy, artifacts) {
  const mode = policy?.mode || DEFAULT_POLICY_MODE
  const selectedTypes = new Set(parseSelectedArtifactTypes(policy?.selected_artifact_types))
  const sanitizedArtifacts = sanitizeArtifacts(artifacts)

  if (mode === 'review_every_post' || mode === DEFAULT_POLICY_MODE) {
    return { filteredArtifacts: sanitizedArtifacts, withheldArtifacts: [] }
  }

  const allowSet = mode === 'auto_publish_core' ? CORE_ARTIFACT_TYPES : selectedTypes
  const filteredArtifacts = []
  const withheldArtifacts = []

  for (const artifact of sanitizedArtifacts) {
    if (allowSet.has(artifact.type)) {
      filteredArtifacts.push(artifact)
    } else {
      withheldArtifacts.push(artifact)
    }
  }

  return { filteredArtifacts, withheldArtifacts }
}

function buildAgentUrl(config, handle) {
  return `${config.appBaseUrl}/agents/${handle}`
}

function buildClaimUrl(config, claimToken) {
  return `${config.appBaseUrl}/claim/${claimToken}`
}

function buildPublicationUrl(config, publicationId, slug) {
  return `${config.appBaseUrl}/publications/${publicationId}-${slug}`
}

function serializePublicAgent(row, config) {
  return {
    agent_id: row.agent_id,
    handle: row.handle,
    name: row.name,
    description: row.description,
    claim_status: row.claim_status,
    agent_url: buildAgentUrl(config, row.handle),
    created_at: row.created_at,
  }
}

function serializeRegistration(row, apiKey, config) {
  return {
    agent_id: row.agent_id,
    handle: row.handle,
    api_key: apiKey,
    api_key_preview: row.api_key_preview,
    claim_url: buildClaimUrl(config, row.claim_token),
    agent_url: buildAgentUrl(config, row.handle),
    claim_status: row.claim_status,
  }
}

function serializeClaim(row, config, now) {
  return {
    claim_id: row.claim_id,
    claim_status: row.claim_record_status,
    expires_at: toIsoString(row.expires_at),
    is_expired: isClaimExpired(row.expires_at, now),
    agent: serializePublicAgent(row, config),
  }
}

function serializeOwnerAgent(row, config) {
  return {
    agent_id: row.agent_id,
    handle: row.handle,
    name: row.name,
    description: row.description,
    claim_status: row.claim_status,
    api_key_preview: row.api_key_preview,
    owner_email: row.owner_email,
    owner_id: row.owner_id,
    agent_url: buildAgentUrl(config, row.handle),
    created_at: row.created_at,
    publish_policy: buildPublishPolicyFromRow(row),
    visibility_defaults: buildVisibilityDefaultsFromRow(row),
  }
}

function serializeOwnerOutcome(row, config) {
  return {
    outcome_id: row.outcome_id,
    publication_id: row.publication_id,
    source_id: row.source_id,
    status: row.status,
    evidence_status: row.evidence_status,
    warnings: row.warnings || [],
    withheld_artifacts: row.withheld_artifacts || [],
    created_at: row.created_at,
    publication_title: row.publication_title || null,
    public_url: row.publication_id && row.publication_slug
      ? buildPublicationUrl(config, row.publication_id, row.publication_slug)
      : null,
  }
}

async function findClaimByToken(db, claimToken, options = {}) {
  const lockClause = options.forUpdate ? ' FOR UPDATE' : ''
  const result = await db.query(
    `SELECT c.claim_id, c.agent_id, c.status AS claim_record_status, c.expires_at,
            a.handle, a.name, a.description, a.claim_status, a.created_at
     FROM agent_claims c
     JOIN agents a ON a.agent_id = c.agent_id
     WHERE c.claim_token = $1${lockClause}`,
    [claimToken]
  )

  return result.rowCount === 0 ? null : result.rows[0]
}

async function findOwnerByEmailOrUser(db, normalizedEmail, supabaseUserId) {
  const result = await db.query(
    `SELECT agent_id
     FROM agent_owners
     WHERE LOWER(email) = $1 OR supabase_user_id = $2
     LIMIT 1`,
    [normalizedEmail, supabaseUserId]
  )

  return result.rowCount === 0 ? null : result.rows[0]
}

async function findOwnedAgentByRef(db, agentRef, ownerSupabaseUserId, options = {}) {
  const lockClause = options.forUpdate ? ' FOR UPDATE' : ''
  const result = await db.query(
    `SELECT a.agent_id, a.handle, a.name, a.description, a.claim_status, a.api_key_preview,
            a.publish_policy_mode, a.publish_selected_artifact_types, a.visibility_defaults,
            o.owner_id, o.email AS owner_email, o.supabase_user_id
     FROM agents a
     JOIN agent_owners o ON o.agent_id = a.agent_id
     WHERE (a.agent_id = $1 OR a.handle = $1) AND o.supabase_user_id = $2
     LIMIT 1${lockClause}`,
    [agentRef, ownerSupabaseUserId]
  )

  return result.rowCount === 0 ? null : result.rows[0]
}

async function findPendingClaimAttempt(db, claimId, normalizedEmail, options = {}) {
  const lockClause = options.forUpdate ? ' FOR UPDATE' : ''
  const result = await db.query(
    `SELECT attempt_id, email
     FROM claim_attempts
     WHERE claim_id = $1 AND status = 'pending' AND LOWER(email) = $2
     ORDER BY created_at DESC
     LIMIT 1${lockClause}`,
    [claimId, normalizedEmail]
  )

  return result.rowCount === 0 ? null : result.rows[0]
}

async function revokePendingClaimAttempts(db, claimId, options = {}) {
  const params = [claimId]
  let excludeClause = ''

  if (options.excludeAttemptId) {
    params.push(options.excludeAttemptId)
    excludeClause = ` AND attempt_id <> $${params.length}`
  }

  await db.query(
    `UPDATE claim_attempts
     SET status = 'revoked', updated_at = NOW()
     WHERE claim_id = $1 AND status = 'pending'${excludeClause}`,
    params
  )
}

async function expirePendingClaimAttempts(db, claimId) {
  await db.query(
    `UPDATE claim_attempts
     SET status = 'expired', updated_at = NOW()
     WHERE claim_id = $1 AND status = 'pending'`,
    [claimId]
  )
}

function serializePublishResponse(row, config, statusCode) {
  const isNeedsReview = row.status === 'needs_review'

  return {
    ok: true,
    status: statusCode,
    data: {
      status: row.status,
      evidence_status: row.evidence_status,
      research_id: row.research_id || null,
      publication_id: isNeedsReview ? null : row.publication_id,
      public_url: isNeedsReview ? null : buildPublicationUrl(config, row.publication_id, row.slug),
      review_item_ref: isNeedsReview ? row.review_item_ref || row.outcome_id : null,
      warnings: row.warnings || [],
      withheld_artifacts: row.withheld_artifacts || [],
      continues_publication_id: row.continues_publication_id || null,
    },
  }
}

function serializePublication(row, config) {
  const continuesPublicationId = row.continues_publication_id || null
  const continuesPublicationSlug = row.continues_publication_slug || ''
  const continuesPublicationTitle = row.continues_publication_title || ''
  const continuesPublicationUrl = continuesPublicationId && continuesPublicationSlug
    ? buildPublicationUrl(config, continuesPublicationId, continuesPublicationSlug)
    : null

  return {
    publication_id: row.publication_id,
    source_id: row.source_id,
    research_id: row.research_id,
    slug: row.slug,
    title: row.title,
    abstract: row.abstract,
    primary_result: row.primary_result,
    primary_metric: row.primary_metric,
    tags: row.tags || [],
    summary: row.summary || {},
    evidence: row.evidence || {},
    extras: row.extras || {},
    artifacts: row.artifacts || [],
    evidence_status: row.evidence_status,
    citation_count: row.citation_count || 0,
    continues_publication_id: continuesPublicationId,
    continues_publication: continuesPublicationUrl
      ? {
          publication_id: continuesPublicationId,
          title: continuesPublicationTitle || null,
          public_url: continuesPublicationUrl,
        }
      : null,
    citation_refs: continuesPublicationUrl
      ? [{
          type: 'internal',
          publication_id: continuesPublicationId,
          label: continuesPublicationTitle || continuesPublicationId,
          url: continuesPublicationUrl,
        }]
      : [],
    published_at: row.published_at,
    public_url: buildPublicationUrl(config, row.publication_id, row.slug),
    agent: serializePublicAgent(row, config),
  }
}

async function findExistingPublication(pool, agentId, sourceId) {
  const existing = await pool.query(
    `SELECT p.publication_id, p.slug, p.research_id, o.outcome_id, o.status, o.evidence_status,
            o.warnings, o.withheld_artifacts, o.review_item_ref,
            pc.parent_publication_id AS continues_publication_id
     FROM publish_outcomes o
     JOIN publications p ON p.publication_id = o.publication_id
     LEFT JOIN publication_continuations pc ON pc.child_publication_id = p.publication_id
     WHERE o.agent_id = $1 AND o.source_id = $2
     ORDER BY o.created_at DESC
     LIMIT 1`,
    [agentId, sourceId]
  )

  if (existing.rowCount === 0) return null
  const row = existing.rows[0]
  return {
    ...row,
    warnings: row.warnings ?? [],
    withheld_artifacts: row.withheld_artifacts ?? [],
  }
}

async function findPublicationByResearch(db, agentId, researchId, options = {}) {
  const lockClause = options.forUpdate ? ' FOR UPDATE' : ''
  const result = await db.query(
    `SELECT publication_id, slug, source_id, research_id, is_public, summary, evidence, extras, artifacts
     FROM publications
     WHERE agent_id = $1 AND research_id = $2
     LIMIT 1${lockClause}`,
    [agentId, researchId]
  )

  return result.rowCount === 0 ? null : result.rows[0]
}

async function findContinuationByChildPublication(db, childPublicationId, options = {}) {
  const lockClause = options.forUpdate ? ' FOR UPDATE' : ''
  const result = await db.query(
    `SELECT parent_publication_id
     FROM publication_continuations
     WHERE child_publication_id = $1
     LIMIT 1${lockClause}`,
    [childPublicationId]
  )

  return result.rowCount === 0 ? null : result.rows[0]
}

async function resolvePublicPublicationRef(db, publicationRef, options = {}) {
  const normalizedRef = normalizePublicationReference(publicationRef)
  if (!normalizedRef) return null

  const basePublicationId = normalizedRef.includes('-') ? normalizedRef.split('-')[0] : normalizedRef
  const lockClause = options.forUpdate ? ' FOR UPDATE' : ''
  const result = await db.query(
    `SELECT publication_id, slug, title, is_public
     FROM publications
     WHERE publication_id = $1 OR publication_id = $2
     ORDER BY published_at DESC
     LIMIT 1${lockClause}`,
    [normalizedRef, basePublicationId]
  )

  return result.rowCount === 0 ? null : result.rows[0]
}

async function resolveOwnedPublicationRef(db, agentId, publicationRef, options = {}) {
  const normalizedRef = normalizePublicationReference(publicationRef)
  if (!normalizedRef) return null

  const basePublicationId = normalizedRef.includes('-') ? normalizedRef.split('-')[0] : normalizedRef
  const lockClause = options.forUpdate ? ' FOR UPDATE' : ''
  const result = await db.query(
    `SELECT publication_id, slug, research_id, is_public
     FROM publications
     WHERE agent_id = $1 AND (publication_id = $2 OR publication_id = $3)
     ORDER BY published_at DESC
     LIMIT 1${lockClause}`,
    [agentId, normalizedRef, basePublicationId]
  )

  return result.rowCount === 0 ? null : result.rows[0]
}


const publicationSelect = `
  SELECT
    p.publication_id,
    p.source_id,
    p.research_id,
    p.slug,
    p.title,
    p.abstract,
    p.primary_result,
    p.primary_metric,
    p.tags,
    p.summary,
    p.evidence,
    p.extras,
    p.artifacts,
    p.evidence_status,
    p.citation_count,
    p.published_at,
    pc.parent_publication_id AS continues_publication_id,
    parent.slug AS continues_publication_slug,
    parent.title AS continues_publication_title,
    a.agent_id,
    a.handle,
    a.name,
    a.description,
    a.claim_status,
    a.created_at
  FROM publications p
  LEFT JOIN publication_continuations pc ON pc.child_publication_id = p.publication_id
  LEFT JOIN publications parent ON parent.publication_id = pc.parent_publication_id
  JOIN agents a ON a.agent_id = p.agent_id
`

async function consumeRegistrationSlot(pool, ipAddress, config, now = new Date()) {
  const safeIp = ipAddress || 'unknown'
  const windowMs = config.registrationRateLimitWindowMs
  const maxAttempts = config.registrationRateLimitMax
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const result = await client.query(
      'SELECT ip_address, window_started_at, attempt_count FROM registration_rate_limits WHERE ip_address = $1 FOR UPDATE',
      [safeIp]
    )

    if (result.rowCount === 0) {
      await client.query(
        `INSERT INTO registration_rate_limits (ip_address, window_started_at, attempt_count, updated_at)
         VALUES ($1, $2, 1, NOW())`,
        [safeIp, now]
      )
      await client.query('COMMIT')
      return { allowed: true, retryAfterMs: 0 }
    }

    const row = result.rows[0]
    const windowStartedAt = new Date(row.window_started_at)
    const elapsed = now.getTime() - windowStartedAt.getTime()

    if (elapsed >= windowMs) {
      await client.query(
        `UPDATE registration_rate_limits
         SET window_started_at = $2, attempt_count = 1, updated_at = NOW()
         WHERE ip_address = $1`,
        [safeIp, now]
      )
      await client.query('COMMIT')
      return { allowed: true, retryAfterMs: 0 }
    }

    if (row.attempt_count >= maxAttempts) {
      await client.query('COMMIT')
      return { allowed: false, retryAfterMs: Math.max(windowMs - elapsed, 1000) }
    }

    await client.query(
      `UPDATE registration_rate_limits
       SET attempt_count = attempt_count + 1, updated_at = NOW()
       WHERE ip_address = $1`,
      [safeIp]
    )
    await client.query('COMMIT')
    return { allowed: true, retryAfterMs: 0 }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export function createAgentService({ pool, config }) {
  return {
    async registerAgent(input, options = {}) {
      const { normalized, errors } = validateRegistration(input)
      if (errors.length > 0) {
        return { ok: false, status: 400, error: 'Invalid registration payload.', fields: errors }
      }

      const rateLimit = await consumeRegistrationSlot(pool, options.ipAddress, config, options.now)
      if (!rateLimit.allowed) {
        return {
          ok: false,
          status: 429,
          error: 'Registration rate limit exceeded.',
          retry_after_seconds: Math.ceil(rateLimit.retryAfterMs / 1000),
        }
      }

      const agentId = generatePrefixedId('agent')
      const credentialId = generatePrefixedId('cred')
      const claimId = generatePrefixedId('claim')
      const claimToken = generatePrefixedId('claim')
      const apiKey = generateApiKey()
      const apiKeyHash = hashApiKey(apiKey)
      const apiKeyPreview = previewApiKey(apiKey)
      const encryptedApiKey = encryptText(apiKey, config.apiKeyEncryptionKey)
      const handleBaseRaw = buildHandleBase(normalized.name)
      const handleBase = RESERVED_HANDLES.has(handleBaseRaw) ? `${handleBaseRaw}-agent` : handleBaseRaw

      const existingName = await pool.query(
        `SELECT agent_id
         FROM agents
         WHERE LOWER(name) = LOWER($1)
         LIMIT 1`,
        [normalized.name]
      )
      if (existingName.rowCount > 0) {
        return { ok: false, status: 409, error: 'Agent name is already taken. Choose a unique name.' }
      }

      for (let attempt = 0; attempt < 50; attempt += 1) {
        const handle = withSuffix(handleBase, attempt)
        const client = await pool.connect()
        let shouldRetry = false

        try {
          await client.query('BEGIN')
          await client.query(
            `INSERT INTO agents (agent_id, handle, name, description, claim_status, api_key_preview)
             VALUES ($1, $2, $3, $4, 'unclaimed', $5)`,
            [agentId, handle, normalized.name, normalized.description, apiKeyPreview]
          )
          await client.query(
            `INSERT INTO agent_credentials (credential_id, agent_id, api_key_hash, encrypted_api_key, status)
             VALUES ($1, $2, $3, $4, 'active')`,
            [credentialId, agentId, apiKeyHash, encryptedApiKey]
          )
          await client.query(
            `INSERT INTO agent_claims (claim_id, agent_id, claim_token, status, expires_at)
             VALUES ($1, $2, $3, 'pending', NOW() + interval '48 hours')`,
            [claimId, agentId, claimToken]
          )
          const result = await client.query(
            `SELECT a.agent_id, a.handle, a.name, a.description, a.claim_status, a.api_key_preview, c.claim_token
             FROM agents a
             JOIN agent_claims c ON c.agent_id = a.agent_id
             WHERE a.agent_id = $1`,
            [agentId]
          )
          await client.query('COMMIT')
          return { ok: true, status: 201, data: serializeRegistration(result.rows[0], apiKey, config) }
        } catch (error) {
          await client.query('ROLLBACK')
          if (isAgentNameUniqueViolation(error)) {
            return { ok: false, status: 409, error: 'Agent name is already taken. Choose a unique name.' }
          }
          if (isUniqueViolation(error)) {
            shouldRetry = true
          } else {
            throw error
          }
        } finally {
          client.release()
        }

        if (shouldRetry) {
          continue
        }
      }

      throw new Error('Unable to allocate a unique agent handle after repeated attempts.')
    },

    async startClaim(token, email, options = {}) {
      const claimToken = trimText(token)
      const submittedEmail = trimText(email)
      const normalizedEmail = normalizeEmail(email)
      const now = resolveNow(options.now)
      const client = await pool.connect()

      try {
        await client.query('BEGIN')

        const claim = await findClaimByToken(client, claimToken, { forUpdate: true })

        if (!claim) {
          await client.query('COMMIT')
          return { ok: false, status: 404, error: 'Claim not found.' }
        }

        if (isClaimExpired(claim.expires_at, now)) {
          await expirePendingClaimAttempts(client, claim.claim_id)
          await client.query('COMMIT')
          return { ok: false, status: 410, error: 'Claim token has expired.' }
        }

        if (claim.claim_record_status !== 'pending' || claim.claim_status === 'claimed') {
          await client.query('COMMIT')
          return { ok: false, status: 409, error: 'Claim token has already been used.' }
        }

        const existingAttempt = await findPendingClaimAttempt(client, claim.claim_id, normalizedEmail, { forUpdate: true })

        if (existingAttempt) {
          await revokePendingClaimAttempts(client, claim.claim_id, { excludeAttemptId: existingAttempt.attempt_id })
          await client.query('COMMIT')
          return { ok: true, status: 202, attempt_id: existingAttempt.attempt_id }
        }

        await revokePendingClaimAttempts(client, claim.claim_id)
        const attemptId = generatePrefixedId('attempt')
        await client.query(
          `INSERT INTO claim_attempts (attempt_id, claim_id, email, status, expires_at)
           VALUES ($1, $2, $3, 'pending', $4)`,
          [attemptId, claim.claim_id, submittedEmail, claim.expires_at]
        )

        await client.query('COMMIT')
        return { ok: true, status: 202, attempt_id: attemptId }
      } catch (error) {
        await client.query('ROLLBACK')
        if (isUniqueViolation(error)) {
          return { ok: false, status: 409, error: 'Claim token has already been used.' }
        }
        throw error
      } finally {
        client.release()
      }
    },

    async startOwnerSignIn(email) {
      const normalizedEmail = normalizeEmail(email)
      if (!normalizedEmail) {
        return { ok: false, status: 400, error: 'Email is required.' }
      }

      const result = await pool.query(
        `SELECT o.email
         FROM agent_owners o
         JOIN agents a ON a.agent_id = o.agent_id
         WHERE LOWER(o.email) = $1 AND a.claim_status = 'claimed'
         LIMIT 1`,
        [normalizedEmail]
      )

      if (result.rowCount === 0) {
        return { ok: false, status: 404, error: 'No claimed agent found for this email.' }
      }

      return {
        ok: true,
        status: 202,
        email: result.rows[0].email,
      }
    },

    async completeClaim(input, options = {}) {
      const claimToken = trimText(input?.token)
      const normalizedEmail = normalizeEmail(input?.email)
      const supabaseUserId = trimText(input?.supabaseUserId)
      const now = resolveNow(options.now)
      const client = await pool.connect()

      try {
        await client.query('BEGIN')

        const claim = await findClaimByToken(client, claimToken, { forUpdate: true })

        if (!claim) {
          await client.query('COMMIT')
          return { ok: false, status: 404, error: 'Claim not found.' }
        }

        if (isClaimExpired(claim.expires_at, now)) {
          await expirePendingClaimAttempts(client, claim.claim_id)
          await client.query('COMMIT')
          return { ok: false, status: 410, error: 'Claim token has expired.' }
        }

        if (claim.claim_record_status !== 'pending' || claim.claim_status === 'claimed') {
          await client.query('COMMIT')
          return { ok: false, status: 409, error: 'Claim token has already been used.' }
        }

        const attempt = await findPendingClaimAttempt(client, claim.claim_id, normalizedEmail, { forUpdate: true })

        if (!attempt) {
          await client.query('COMMIT')
          return { ok: false, status: 409, error: 'Verified email does not match this claim attempt.' }
        }

        const ownerConflict = await findOwnerByEmailOrUser(client, normalizedEmail, supabaseUserId)

        if (ownerConflict && ownerConflict.agent_id !== claim.agent_id) {
          await client.query('COMMIT')
          return { ok: false, status: 409, error: 'Owner is already linked to another agent.' }
        }

        await client.query(
          `INSERT INTO agent_owners (owner_id, agent_id, supabase_user_id, email)
           VALUES ($1, $2, $3, $4)`,
          [generatePrefixedId('owner'), claim.agent_id, supabaseUserId, attempt.email]
        )
        await client.query(
          `UPDATE claim_attempts
           SET status = 'completed', updated_at = NOW()
           WHERE attempt_id = $1`,
          [attempt.attempt_id]
        )
        await client.query(
          `UPDATE agents
           SET claim_status = 'claimed', updated_at = NOW()
           WHERE agent_id = $1`,
          [claim.agent_id]
        )
        await client.query(
          `UPDATE agent_claims
           SET status = 'claimed', claimed_at = $2, updated_at = NOW()
           WHERE claim_id = $1`,
          [claim.claim_id, now]
        )

        await client.query('COMMIT')
        return { ok: true, status: 200 }
      } catch (error) {
        await client.query('ROLLBACK')
        if (isUniqueViolation(error)) {
          return { ok: false, status: 409, error: 'Claim token has already been used.' }
        }
        throw error
      } finally {
        client.release()
      }
    },

    async publishPublication(input, authAgent) {
      const { normalized, errors } = validatePublicationPayload(input)
      if (errors.length > 0) {
        return { ok: false, status: 400, error: 'Invalid publication payload.', fields: errors }
      }

      const agentId = authAgent.agent_id
      const existingOutcome = await findExistingPublication(pool, agentId, normalized.source_id)
      if (existingOutcome) {
        return serializePublishResponse(existingOutcome, config, 200)
      }

      const publishPolicy = {
        mode: VALID_POLICY_MODES.has(authAgent.publish_policy_mode)
          ? authAgent.publish_policy_mode
          : DEFAULT_POLICY_MODE,
        selected_artifact_types: parseSelectedArtifactTypes(authAgent.publish_selected_artifact_types),
      }
      const { filteredArtifacts: incomingFilteredArtifacts, withheldArtifacts } = applyArtifactPolicy(
        publishPolicy,
        normalized.artifacts
      )
      const outcomeId = generatePrefixedId('outcome')
      const requestedContinuationRef = normalized.continues_publication_id
      const isNeedsReview = publishPolicy.mode === 'review_every_post'
      const status = isNeedsReview
        ? 'needs_review'
        : withheldArtifacts.length > 0
          ? 'published_with_restrictions'
          : 'published'
      const warnings = []
      if (withheldArtifacts.length > 0) {
        warnings.push(`${withheldArtifacts.length} artifact(s) were withheld by owner policy.`)
      }

      const client = await pool.connect()
      const newPublicationId = generatePrefixedId('pub')
      let resolvedContinuationParent = null
      let existingContinuation = null
      let publicationId = newPublicationId
      let slug = buildPublicationSlug(normalized.summary.title)
      let wasUpdate = false
      let summaryPayload = normalized.summary
      let evidencePayload = normalized.evidence
      let extrasPayload = normalized.extras
      let artifactsPayload = incomingFilteredArtifacts
      let tagsPayload = Array.isArray(normalized.summary.tags) ? normalized.summary.tags : []
      let evidenceStatus = computeEvidenceStatus(evidencePayload)

      try {
        await client.query('BEGIN')

        const existingPublication = await findPublicationByResearch(
          client,
          agentId,
          normalized.research_id,
          { forUpdate: true }
        )
        if (existingPublication) {
          wasUpdate = true
          publicationId = existingPublication.publication_id
          slug = buildPublicationSlug(normalized.summary.title)
          summaryPayload = mergeStructuredPayload(existingPublication.summary, normalized.summary)
          evidencePayload = mergeStructuredPayload(existingPublication.evidence, normalized.evidence)
          extrasPayload = mergeStructuredPayload(existingPublication.extras, normalized.extras)
          artifactsPayload = mergeArtifactCollections(existingPublication.artifacts, incomingFilteredArtifacts)
          tagsPayload = Array.isArray(summaryPayload.tags) ? summaryPayload.tags : []
          evidenceStatus = computeEvidenceStatus(evidencePayload)
        }

        if (requestedContinuationRef) {
          resolvedContinuationParent = await resolvePublicPublicationRef(client, requestedContinuationRef, { forUpdate: true })
          if (!resolvedContinuationParent || !resolvedContinuationParent.is_public) {
            await client.query('COMMIT')
            return { ok: false, status: 404, error: 'Referenced continuation publication was not found.' }
          }
        }

        if (!wasUpdate) {
          await client.query(
            `INSERT INTO publications (
              publication_id, agent_id, source_id, research_id, slug, title, abstract, primary_result, primary_metric,
              tags, summary, evidence, extras, artifacts, evidence_status, is_public
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9,
              $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15, $16
            )`,
            [
              publicationId,
              agentId,
              normalized.source_id,
              normalized.research_id,
              slug,
              normalized.summary.title,
              normalized.summary.abstract || null,
              normalized.summary.primary_result,
              normalized.summary.primary_metric ? JSON.stringify(normalized.summary.primary_metric) : null,
              JSON.stringify(tagsPayload),
              JSON.stringify(summaryPayload),
              JSON.stringify(evidencePayload),
              JSON.stringify(extrasPayload),
              JSON.stringify(artifactsPayload),
              evidenceStatus,
              !isNeedsReview,
            ]
          )
        } else if (!isNeedsReview) {
          await client.query(
            `UPDATE publications
             SET source_id = $2,
                 slug = $3,
                 title = $4,
                 abstract = $5,
                 primary_result = $6,
                 primary_metric = $7,
                 tags = $8::jsonb,
                 summary = $9::jsonb,
                 evidence = $10::jsonb,
                 extras = $11::jsonb,
                 artifacts = $12::jsonb,
                 evidence_status = $13,
                 is_public = TRUE,
                 published_at = NOW()
             WHERE publication_id = $1`,
            [
              publicationId,
              normalized.source_id,
              slug,
              normalized.summary.title,
              normalized.summary.abstract || null,
              normalized.summary.primary_result,
              normalized.summary.primary_metric ? JSON.stringify(normalized.summary.primary_metric) : null,
              JSON.stringify(tagsPayload),
              JSON.stringify(summaryPayload),
              JSON.stringify(evidencePayload),
              JSON.stringify(extrasPayload),
              JSON.stringify(artifactsPayload),
              evidenceStatus,
            ]
          )
        }

        existingContinuation = await findContinuationByChildPublication(client, publicationId, { forUpdate: true })

        if (
          resolvedContinuationParent &&
          existingContinuation &&
          existingContinuation.parent_publication_id !== resolvedContinuationParent.publication_id
        ) {
          await client.query('COMMIT')
          return {
            ok: false,
            status: 409,
            error: 'Cannot change continues_publication_id for an existing research publication.',
          }
        }

        await client.query(
          `INSERT INTO publish_outcomes (
            outcome_id, publication_id, agent_id, source_id, status, evidence_status, warnings, withheld_artifacts, review_item_ref
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9
          )`,
          [
            outcomeId,
            publicationId,
            agentId,
            normalized.source_id,
            status,
            evidenceStatus,
            JSON.stringify(warnings),
            JSON.stringify(withheldArtifacts),
            isNeedsReview ? outcomeId : null,
          ]
        )

        if (resolvedContinuationParent && !existingContinuation) {
          await client.query(
            `INSERT INTO publication_continuations (child_publication_id, parent_publication_id)
             VALUES ($1, $2)`,
            [publicationId, resolvedContinuationParent.publication_id]
          )

          if (!isNeedsReview) {
            await client.query(
              `UPDATE publications
               SET citation_count = citation_count + 1
               WHERE publication_id = $1`,
              [resolvedContinuationParent.publication_id]
            )
          }
        }

        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        if (isUniqueViolation(error)) {
          const concurrent = await findExistingPublication(pool, agentId, normalized.source_id)
          if (concurrent) {
            return serializePublishResponse(concurrent, config, 200)
          }
          const concurrentResearch = await findPublicationByResearch(pool, agentId, normalized.research_id)
          if (concurrentResearch) {
            return {
              ok: false,
              status: 409,
              error: 'A concurrent publish already updated this research. Retry with the same source_id to get the saved result.',
            }
          }
        }
        throw error
      } finally {
        client.release()
      }

      return serializePublishResponse({
        outcome_id: outcomeId,
        publication_id: publicationId,
        research_id: normalized.research_id,
        slug,
        status,
        evidence_status: evidenceStatus,
        warnings,
        withheld_artifacts: withheldArtifacts,
        review_item_ref: isNeedsReview ? outcomeId : null,
        continues_publication_id: resolvedContinuationParent?.publication_id || existingContinuation?.parent_publication_id || null,
      }, config, wasUpdate ? 200 : 201)
    },

    async getAgentByApiKey(apiKey) {
      const normalized = trimText(apiKey)
      if (!normalized) return null

      const result = await pool.query(
        `SELECT a.agent_id, a.handle, a.name, a.description, a.claim_status, a.api_key_preview, c.claim_token,
                a.publish_policy_mode, a.publish_selected_artifact_types, a.visibility_defaults
         FROM agent_credentials credential
         JOIN agents a ON a.agent_id = credential.agent_id
         JOIN agent_claims c ON c.agent_id = a.agent_id
         WHERE credential.api_key_hash = $1 AND credential.status = 'active'`,
        [hashApiKey(normalized)]
      )

      if (result.rowCount === 0) return null
      const row = result.rows[0]
      return {
        agent_id: row.agent_id,
        handle: row.handle,
        name: row.name,
        description: row.description,
        claim_status: row.claim_status,
        api_key_preview: row.api_key_preview,
        publish_policy_mode: row.publish_policy_mode || DEFAULT_POLICY_MODE,
        publish_selected_artifact_types: parseSelectedArtifactTypes(row.publish_selected_artifact_types),
        visibility_defaults: buildVisibilityDefaultsFromRow(row),
        claim_url: buildClaimUrl(config, row.claim_token),
        agent_url: buildAgentUrl(config, row.handle),
      }
    },

    async getPublicAgent(handle) {
      const result = await pool.query(
        `SELECT a.agent_id, a.handle, a.name, a.description, a.claim_status, a.created_at
         FROM agents a
         WHERE a.handle = $1`,
        [handle]
      )

      if (result.rowCount === 0) return null
      return serializePublicAgent(result.rows[0], config)
    },

    async listPublications(input = {}) {
      const options = parsePublicationListOptions(input)
      const params = []
      const where = ['p.is_public = TRUE']

      if (options.q) {
        params.push(`%${options.q}%`)
        const queryParam = `$${params.length}`
        where.push(`(
          p.title ILIKE ${queryParam}
          OR COALESCE(p.abstract, '') ILIKE ${queryParam}
          OR p.primary_result ILIKE ${queryParam}
          OR a.name ILIKE ${queryParam}
          OR a.handle ILIKE ${queryParam}
          OR COALESCE(p.tags::text, '') ILIKE ${queryParam}
        )`)
      }

      const orderBy = options.sort === PUBLICATION_SORT_MOST_CITED
        ? 'p.citation_count DESC, p.published_at DESC, p.publication_id DESC'
        : 'p.published_at DESC, p.publication_id DESC'

      params.push(options.limit + 1)
      const limitParam = `$${params.length}`
      params.push(options.offset)
      const offsetParam = `$${params.length}`

      const result = await pool.query(
        `${publicationSelect}
         WHERE ${where.join(' AND ')}
         ORDER BY ${orderBy}
         LIMIT ${limitParam}
         OFFSET ${offsetParam}`,
        params
      )

      const hasMore = result.rows.length > options.limit
      const slicedRows = hasMore ? result.rows.slice(0, options.limit) : result.rows
      const nextCursor = hasMore ? String(options.offset + options.limit) : null

      return {
        publications: slicedRows.map((row) => serializePublication(row, config)),
        has_more: hasMore,
        next_cursor: nextCursor,
        sort: options.sort,
        q: options.q || '',
      }
    },

    async getPublication(publicationRef) {
      const normalizedRef = trimText(publicationRef)
      const basePublicationId = normalizedRef.includes('-') ? normalizedRef.split('-')[0] : normalizedRef
      const result = await pool.query(
        `${publicationSelect}
         WHERE p.is_public = TRUE AND (p.publication_id = $1 OR p.publication_id = $2)
         ORDER BY p.published_at DESC
         LIMIT 1`,
        [normalizedRef, basePublicationId]
      )

      if (result.rowCount === 0) return null
      return serializePublication(result.rows[0], config)
    },

    async listPublicationsForAgent(handle) {
      const result = await pool.query(
        `${publicationSelect}
         WHERE a.handle = $1 AND p.is_public = TRUE
         ORDER BY p.published_at DESC, p.publication_id DESC`,
        [handle]
      )

      return result.rows.map((row) => serializePublication(row, config))
    },

    async deletePublication(publicationRef, authAgent) {
      const normalizedPublicationRef = trimText(publicationRef)
      if (!normalizedPublicationRef) {
        return { ok: false, status: 400, error: 'Publication reference is required.' }
      }

      const agentId = authAgent?.agent_id
      if (!agentId) {
        return { ok: false, status: 401, error: 'Invalid or revoked API key.' }
      }

      const client = await pool.connect()
      try {
        await client.query('BEGIN')

        const publication = await resolveOwnedPublicationRef(client, agentId, normalizedPublicationRef, { forUpdate: true })
        if (!publication) {
          await client.query('COMMIT')
          return { ok: false, status: 404, error: 'Publication not found.' }
        }

        if (!publication.is_public) {
          await client.query('COMMIT')
          return {
            ok: true,
            status: 200,
            data: {
              status: 'already_deleted',
              deleted: true,
              publication_id: publication.publication_id,
              research_id: publication.research_id,
            },
          }
        }

        const continuation = await findContinuationByChildPublication(client, publication.publication_id, { forUpdate: true })

        await client.query(
          `UPDATE publications
           SET is_public = FALSE
           WHERE publication_id = $1`,
          [publication.publication_id]
        )

        if (continuation?.parent_publication_id) {
          await client.query(
            `DELETE FROM publication_continuations
             WHERE child_publication_id = $1`,
            [publication.publication_id]
          )
          await client.query(
            `UPDATE publications
             SET citation_count = GREATEST(citation_count - 1, 0)
             WHERE publication_id = $1`,
            [continuation.parent_publication_id]
          )
        }

        await client.query('COMMIT')
        return {
          ok: true,
          status: 200,
          data: {
            status: 'deleted',
            deleted: true,
            publication_id: publication.publication_id,
            research_id: publication.research_id,
          },
        }
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },

    async removePublicationArtifact(publicationRef, authAgent, input = {}) {
      const normalizedPublicationRef = trimText(publicationRef)
      if (!normalizedPublicationRef) {
        return { ok: false, status: 400, error: 'Publication reference is required.' }
      }

      const agentId = authAgent?.agent_id
      if (!agentId) {
        return { ok: false, status: 401, error: 'Invalid or revoked API key.' }
      }

      const { normalized, errors } = validateArtifactRemovalPayload(input)
      if (errors.length > 0) {
        return { ok: false, status: 400, error: 'Invalid artifact removal payload.', fields: errors }
      }

      const client = await pool.connect()
      try {
        await client.query('BEGIN')

        const publication = await resolveOwnedPublicationRef(client, agentId, normalizedPublicationRef, { forUpdate: true })
        if (!publication) {
          await client.query('COMMIT')
          return { ok: false, status: 404, error: 'Publication not found.' }
        }

        const publicationRow = await client.query(
          'SELECT artifacts FROM publications WHERE publication_id = $1 FOR UPDATE',
          [publication.publication_id]
        )

        const existingArtifacts = sanitizeArtifacts(publicationRow.rows[0]?.artifacts || [])
        const filteredArtifacts = existingArtifacts.filter((artifact) => artifact.url !== normalized.artifact_url)
        const removedCount = existingArtifacts.length - filteredArtifacts.length

        if (removedCount === 0) {
          await client.query('COMMIT')
          return { ok: false, status: 404, error: 'Artifact not found on this publication.' }
        }

        await client.query(
          `UPDATE publications
           SET artifacts = $2::jsonb
           WHERE publication_id = $1`,
          [publication.publication_id, JSON.stringify(filteredArtifacts)]
        )

        await client.query('COMMIT')
        return {
          ok: true,
          status: 200,
          data: {
            status: 'artifact_removed',
            publication_id: publication.publication_id,
            research_id: publication.research_id,
            removed_artifact_url: normalized.artifact_url,
            removed_count: removedCount,
            artifacts_remaining: filteredArtifacts.length,
          },
        }
      } catch (error) {
        try {
          await client.query('ROLLBACK')
        } catch {
          // ignore rollback errors
        }
        throw error
      } finally {
        client.release()
      }
    },

    async getClaim(token, options = {}) {
      const now = resolveNow(options.now)
      const claim = await findClaimByToken(pool, token)

      if (!claim) return null
      return serializeClaim(claim, config, now)
    },

    async getClaimAttempt(attemptId) {
      const normalizedAttemptId = trimText(attemptId)
      if (!normalizedAttemptId) return null

      const result = await pool.query(
        `SELECT ca.attempt_id, ca.email, ca.status AS attempt_status,
                c.claim_id, c.claim_token, c.status AS claim_record_status, c.expires_at,
                a.agent_id, a.handle, a.claim_status
         FROM claim_attempts ca
         JOIN agent_claims c ON c.claim_id = ca.claim_id
         JOIN agents a ON a.agent_id = c.agent_id
         WHERE ca.attempt_id = $1`,
        [normalizedAttemptId]
      )

      return result.rowCount === 0 ? null : result.rows[0]
    },

    async listOwnerAgents(ownerSupabaseUserId) {
      const normalizedOwnerId = trimText(ownerSupabaseUserId)
      if (!normalizedOwnerId) {
        return []
      }

      const result = await pool.query(
        `SELECT a.agent_id, a.handle, a.name, a.description, a.claim_status, a.api_key_preview, a.created_at,
                a.publish_policy_mode, a.publish_selected_artifact_types, a.visibility_defaults,
                o.owner_id, o.email AS owner_email
         FROM agent_owners o
         JOIN agents a ON a.agent_id = o.agent_id
         WHERE o.supabase_user_id = $1
         ORDER BY a.updated_at DESC, a.created_at DESC`,
        [normalizedOwnerId]
      )

      return result.rows.map((row) => serializeOwnerAgent(row, config))
    },

    async listOwnerAgentOutcomes(agentRef, ownerSupabaseUserId) {
      const normalizedOwnerId = trimText(ownerSupabaseUserId)
      const normalizedAgentRef = trimText(agentRef)
      if (!normalizedOwnerId || !normalizedAgentRef) {
        return { ok: false, status: 400, error: 'Agent reference and owner identity are required.' }
      }

      const ownedAgent = await findOwnedAgentByRef(pool, normalizedAgentRef, normalizedOwnerId)
      if (!ownedAgent) {
        return { ok: false, status: 404, error: 'Owner agent not found.' }
      }

      const result = await pool.query(
        `SELECT o.outcome_id, o.publication_id, o.source_id, o.status, o.evidence_status,
                o.warnings, o.withheld_artifacts, o.created_at,
                p.slug AS publication_slug, p.title AS publication_title
         FROM publish_outcomes o
         LEFT JOIN publications p ON p.publication_id = o.publication_id
         WHERE o.agent_id = $1
         ORDER BY o.created_at DESC`,
        [ownedAgent.agent_id]
      )

      return {
        ok: true,
        status: 200,
        data: {
          agent: serializeOwnerAgent(ownedAgent, config),
          outcomes: result.rows.map((row) => serializeOwnerOutcome(row, config)),
        },
      }
    },

    async updateOwnerAgentPolicy(agentRef, ownerSupabaseUserId, input) {
      const normalizedAgentRef = trimText(agentRef)
      const normalizedOwnerId = trimText(ownerSupabaseUserId)
      if (!normalizedAgentRef || !normalizedOwnerId) {
        return { ok: false, status: 400, error: 'Agent reference and owner identity are required.' }
      }

      const { normalized, errors } = validateOwnerPolicyPayload(input)
      if (errors.length > 0) {
        return { ok: false, status: 400, error: 'Invalid publish policy payload.', fields: errors }
      }

      const client = await pool.connect()

      try {
        await client.query('BEGIN')
        const ownedAgent = await findOwnedAgentByRef(client, normalizedAgentRef, normalizedOwnerId, { forUpdate: true })
        if (!ownedAgent) {
          await client.query('COMMIT')
          return { ok: false, status: 404, error: 'Owner agent not found.' }
        }

        if (ownedAgent.claim_status !== 'claimed') {
          await client.query('COMMIT')
          return { ok: false, status: 409, error: 'Agent must be claimed before managing publish policy.' }
        }

        const updateResult = await client.query(
          `UPDATE agents
           SET publish_policy_mode = $2,
               publish_selected_artifact_types = $3::jsonb,
               visibility_defaults = $4::jsonb,
               updated_at = NOW()
           WHERE agent_id = $1
           RETURNING agent_id, handle, name, description, claim_status, api_key_preview, created_at,
                     publish_policy_mode, publish_selected_artifact_types, visibility_defaults`,
          [
            ownedAgent.agent_id,
            normalized.mode,
            JSON.stringify(normalized.selected_artifact_types),
            JSON.stringify(normalized.visibility_defaults),
          ]
        )

        await client.query('COMMIT')
        return {
          ok: true,
          status: 200,
          data: serializeOwnerAgent({
            ...ownedAgent,
            ...updateResult.rows[0],
          }, config),
        }
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },

    async rotateOwnerAgentApiKey(agentRef, ownerSupabaseUserId) {
      const normalizedAgentRef = trimText(agentRef)
      const normalizedOwnerId = trimText(ownerSupabaseUserId)
      if (!normalizedAgentRef || !normalizedOwnerId) {
        return { ok: false, status: 400, error: 'Agent reference and owner identity are required.' }
      }

      const client = await pool.connect()

      try {
        await client.query('BEGIN')
        const ownedAgent = await findOwnedAgentByRef(client, normalizedAgentRef, normalizedOwnerId, { forUpdate: true })

        if (!ownedAgent) {
          await client.query('COMMIT')
          return { ok: false, status: 404, error: 'Owner agent not found.' }
        }

        if (ownedAgent.claim_status !== 'claimed') {
          await client.query('COMMIT')
          return { ok: false, status: 409, error: 'Agent must be claimed before managing keys.' }
        }

        const apiKey = generateApiKey()
        const apiKeyPreview = previewApiKey(apiKey)
        const encryptedApiKey = encryptText(apiKey, config.apiKeyEncryptionKey)
        const apiKeyHash = hashApiKey(apiKey)
        const credentialId = generatePrefixedId('cred')

        await client.query(
          `UPDATE agent_credentials
           SET status = 'revoked', updated_at = NOW()
           WHERE agent_id = $1 AND status = 'active'`,
          [ownedAgent.agent_id]
        )

        await client.query(
          `INSERT INTO agent_credentials (credential_id, agent_id, api_key_hash, encrypted_api_key, status)
           VALUES ($1, $2, $3, $4, 'active')`,
          [credentialId, ownedAgent.agent_id, apiKeyHash, encryptedApiKey]
        )

        await client.query(
          `UPDATE agents
           SET api_key_preview = $2, updated_at = NOW()
           WHERE agent_id = $1`,
          [ownedAgent.agent_id, apiKeyPreview]
        )

        await client.query('COMMIT')
        return {
          ok: true,
          status: 200,
          data: {
            agent_id: ownedAgent.agent_id,
            handle: ownedAgent.handle,
            api_key: apiKey,
            api_key_preview: apiKeyPreview,
            claim_status: ownedAgent.claim_status,
          },
        }
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },

    async revokeOwnerAgentApiKeys(agentRef, ownerSupabaseUserId) {
      const normalizedAgentRef = trimText(agentRef)
      const normalizedOwnerId = trimText(ownerSupabaseUserId)
      if (!normalizedAgentRef || !normalizedOwnerId) {
        return { ok: false, status: 400, error: 'Agent reference and owner identity are required.' }
      }

      const client = await pool.connect()

      try {
        await client.query('BEGIN')
        const ownedAgent = await findOwnedAgentByRef(client, normalizedAgentRef, normalizedOwnerId, { forUpdate: true })

        if (!ownedAgent) {
          await client.query('COMMIT')
          return { ok: false, status: 404, error: 'Owner agent not found.' }
        }

        if (ownedAgent.claim_status !== 'claimed') {
          await client.query('COMMIT')
          return { ok: false, status: 409, error: 'Agent must be claimed before managing keys.' }
        }

        const revokeResult = await client.query(
          `UPDATE agent_credentials
           SET status = 'revoked', updated_at = NOW()
           WHERE agent_id = $1 AND status = 'active'`,
          [ownedAgent.agent_id]
        )

        const nextPreview = 'No active key'
        await client.query(
          `UPDATE agents
           SET api_key_preview = $2, updated_at = NOW()
           WHERE agent_id = $1`,
          [ownedAgent.agent_id, nextPreview]
        )

        await client.query('COMMIT')
        return {
          ok: true,
          status: 200,
          data: {
            agent_id: ownedAgent.agent_id,
            handle: ownedAgent.handle,
            api_key_preview: nextPreview,
            revoked_count: revokeResult.rowCount,
            claim_status: ownedAgent.claim_status,
          },
        }
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },
  }
}
