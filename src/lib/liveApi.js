const defaultMetrics = {
  citations: 0,
  hIndex: 0,
  i10Index: 0,
  publications: 0,
}

const defaultPolicy = {
  mode: 'publish_anything_requested',
  selectedArtifactTypes: [],
}

const defaultVisibility = {
  research_brief: true,
  main_code: true,
  results_table: true,
  figure: true,
  run_log: true,
  checkpoint: true,
}

const API_BASE = '/api/v1'

function apiPath(path) {
  return `${API_BASE}${path}`
}

async function parseJson(response) {
  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    return { error: text }
  }
}

function buildErrorMessage(response, payload, fallback) {
  if (payload?.error) return payload.error
  if (payload?.message) return payload.message
  if (response.status === 404) return 'Not found.'
  if (response.status === 429) return 'Rate limit exceeded. Please wait and try again.'
  return fallback
}

function extractUrl(value) {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object' && typeof value.url === 'string') return value.url.trim()
  return ''
}

function buildSnapshotUrl(repoUrl, commitSha) {
  const normalizedRepoUrl = extractUrl(repoUrl)
  if (!normalizedRepoUrl) return ''
  const normalized = normalizedRepoUrl.replace(/\/+$/, '')
  return commitSha ? `${normalized}/tree/${commitSha}` : normalized
}

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim())
}

function toText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function firstNonEmptyText(values) {
  for (const value of values) {
    const text = toText(value)
    if (text) return text
  }
  return ''
}

function filenameFromUrl(value) {
  const url = toText(value)
  if (!url) return ''

  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split('/').filter(Boolean)
    const fileName = segments.at(-1) || ''
    return decodeURIComponent(fileName)
  } catch {
    const clean = url.split('?')[0].split('#')[0]
    const segments = clean.split('/').filter(Boolean)
    return segments.at(-1) || ''
  }
}

function humanizeArtifactType(value) {
  const type = toText(value)
  if (!type) return ''
  return type.replace(/[_-]+/g, ' ')
}

function toPublicArtifact(artifact = {}) {
  const artifactUrl = toText(artifact.url)
  const note = firstNonEmptyText([artifact.note, artifact.description, artifact.summary])
  const label = firstNonEmptyText([
    artifact.label,
    artifact.title,
    artifact.name,
    filenameFromUrl(artifactUrl),
    humanizeArtifactType(artifact.type),
  ])

  return {
    ...artifact,
    url: artifactUrl,
    label: label || 'Artifact',
    note: note || undefined,
    visibility: artifact.visibility || artifact.requested_visibility || 'public',
  }
}

function buildResultsHeadline(primaryResult, runStats = {}) {
  const attempted = Number(runStats.attempted_edits)
  const kept = Number(runStats.kept_commits)

  if (Number.isFinite(attempted) || Number.isFinite(kept)) {
    const keptValue = Number.isFinite(kept) ? kept : 0
    const attemptedValue = Number.isFinite(attempted) ? attempted : 0
    return `${keptValue} kept commit${keptValue === 1 ? '' : 's'} across ${attemptedValue} attempted edit${attemptedValue === 1 ? '' : 's'}.`
  }

  return primaryResult || 'No structured results summary was provided.'
}

function adaptMilestones(milestones = []) {
  if (!Array.isArray(milestones)) return []

  return milestones.map((milestone, index) => ({
    title: milestone.title || milestone.summary || `Milestone ${index + 1}`,
    summary: milestone.summary || milestone.note || 'No summary provided.',
    commitSha: milestone.commit_sha || milestone.commitSha || `step-${index + 1}`,
    timestamp: milestone.timestamp || milestone.created_at || new Date().toISOString(),
    metricAfter: milestone.metric_after || milestone.metricAfter || '',
    metricDelta: milestone.metric_delta || milestone.metricDelta || '',
  }))
}

function adaptCitationRefs(citationRefs = []) {
  if (!Array.isArray(citationRefs)) return []
  return citationRefs
    .filter((reference) => reference && typeof reference === 'object')
    .map((reference) => ({
      type: reference.type || 'internal',
      publicationId: reference.publication_id || reference.publicationId || null,
      label: reference.label || '',
      url: reference.url || '',
    }))
}

function normalizeLinkEvidence(entry, fallbackLabel) {
  if (!entry) return null

  if (typeof entry === 'string') {
    const text = entry.trim()
    if (!text) return null
    if (isHttpUrl(text)) {
      return { label: fallbackLabel, url: text, text: '' }
    }
    return { label: fallbackLabel, url: '', text }
  }

  if (typeof entry === 'object') {
    const label = toText(entry.label) || fallbackLabel
    const url = toText(entry.url)
    const text = firstNonEmptyText([entry.text, entry.summary, entry.note, entry.path])
    return { label, url, text }
  }

  return null
}

function parseResultsEvidence(resultsEntry) {
  if (!resultsEntry) {
    return { artifactUrl: '', points: [] }
  }

  if (typeof resultsEntry === 'string') {
    const text = resultsEntry.trim()
    if (!text) return { artifactUrl: '', points: [] }
    if (isHttpUrl(text)) return { artifactUrl: text, points: [] }

    const points = text.includes('|')
      ? text.split('|').map((item) => item.trim()).filter(Boolean)
      : [text]

    return { artifactUrl: '', points }
  }

  if (typeof resultsEntry === 'object') {
    const url = toText(resultsEntry.url)
    const summaryText = firstNonEmptyText([resultsEntry.summary, resultsEntry.text, resultsEntry.note])
    const points = summaryText
      ? summaryText.split('|').map((item) => item.trim()).filter(Boolean)
      : []

    return { artifactUrl: url, points }
  }

  return { artifactUrl: '', points: [] }
}

function findArtifactUrl(artifacts, predicate) {
  const match = artifacts.find(predicate)
  return match?.url || ''
}

function parseRunStats(evidence, summary, primaryResult, abstract) {
  const source = evidence?.run_stats
  const attemptedDirect = Number(source?.attempted_edits)
  const keptDirect = Number(source?.kept_commits)

  let attemptedEdits = Number.isFinite(attemptedDirect) ? attemptedDirect : null
  let keptCommits = Number.isFinite(keptDirect) ? keptDirect : null

  if (attemptedEdits === null) {
    const corpus = [
      primaryResult,
      summary?.primary_result,
      abstract,
      summary?.abstract,
      typeof evidence?.research_brief === 'string' ? evidence.research_brief : evidence?.research_brief?.text,
      typeof evidence?.results === 'string' ? evidence.results : evidence?.results?.summary,
    ]
      .filter(Boolean)
      .join(' ')

    const match = corpus.match(/(\d+)\s+experiments?/i)
    if (match) attemptedEdits = Number(match[1])
  }

  if (attemptedEdits === null && keptCommits === null) return null

  return {
    attemptedEdits: attemptedEdits === null ? null : attemptedEdits,
    keptCommits: keptCommits === null ? null : keptCommits,
  }
}

function normalizePrimaryMetric(metric) {
  if (!metric || typeof metric !== 'object') return null

  const label = toText(metric.label) || toText(metric.name) || 'Primary metric'
  const value = metric.value ?? ''
  const baseline = metric.baseline ?? ''
  const deltaValue = metric.delta ?? (
    Number.isFinite(Number(value)) && Number.isFinite(Number(baseline))
      ? (Number(value) - Number(baseline)).toFixed(6)
      : ''
  )

  return {
    ...metric,
    label,
    value,
    baseline,
    delta: deltaValue,
  }
}

function normalizeFigure(figure, index) {
  if (typeof figure === 'string') {
    const url = figure.trim()
    if (!isHttpUrl(url)) return null
    return {
      title: `Figure ${index + 1}`,
      caption: '',
      url,
    }
  }

  if (!figure || typeof figure !== 'object') return null
  const url = toText(figure.url)
  if (!url) return null

  return {
    title: toText(figure.title) || `Figure ${index + 1}`,
    caption: toText(figure.caption) || toText(figure.note) || toText(figure.description) || '',
    url,
  }
}

function normalizeProvenanceValue(value, fallback = 'Not provided') {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || fallback
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (!value || typeof value !== 'object') {
    return fallback
  }

  if (Array.isArray(value)) {
    const joined = value.map((entry) => normalizeProvenanceValue(entry, '')).filter(Boolean).join(' · ')
    return joined || fallback
  }

  const parts = []
  const gpu = toText(value.gpu || value.name || value.device)
  const vramGb = value.vram_gb ?? value.vramGb ?? value.vram
  const computeCapability = toText(value.compute_capability || value.computeCapability || value.cc)
  const driver = toText(value.driver || value.driver_version || value.driverVersion)
  const ampDtype = toText(value.amp_dtype || value.ampDtype || value.dtype)

  if (gpu) parts.push(gpu)
  if (vramGb !== undefined && vramGb !== null && String(vramGb).trim()) parts.push(`${vramGb} GB VRAM`)
  if (computeCapability) parts.push(`CC ${computeCapability}`)
  if (driver) parts.push(`driver ${driver}`)
  if (ampDtype) parts.push(`AMP ${ampDtype}`)

  if (parts.length > 0) return parts.join(' · ')

  const generic = Object.entries(value)
    .map(([key, entry]) => {
      const normalized = normalizeProvenanceValue(entry, '')
      return normalized ? `${key}: ${normalized}` : ''
    })
    .filter(Boolean)
    .join(' · ')

  return generic || fallback
}

function normalizeCommitSha(value) {
  const sha = toText(value)
  if (!sha) return ''
  if (/^[0-9a-f]{13,}$/i.test(sha)) return sha.slice(0, 7)
  return sha
}

function toCommitEntryList(value) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  }
  if (value && typeof value === 'object') return [value]
  return []
}

function normalizeCommitHistoryEntry(entry, index, fallbackTimestamp) {
  if (typeof entry === 'string') {
    const text = entry.trim()
    if (!text) return null

    const match = text.match(/^([0-9a-f]{7,40})\s+(.+)$/i)
    if (match) {
      return {
        sha: normalizeCommitSha(match[1]),
        summary: toText(match[2]) || 'Commit update',
        timestamp: fallbackTimestamp,
      }
    }

    return {
      sha: `entry-${index + 1}`,
      summary: text,
      timestamp: fallbackTimestamp,
    }
  }

  if (!entry || typeof entry !== 'object') return null

  const sha = normalizeCommitSha(
    firstNonEmptyText([entry.sha, entry.commit_sha, entry.commitSha, entry.hash, entry.commit, entry.id])
  )
  const summary = firstNonEmptyText([
    entry.summary,
    entry.message,
    entry.title,
    entry.note,
    entry.description,
  ])
  const timestamp = firstNonEmptyText([
    entry.timestamp,
    entry.created_at,
    entry.createdAt,
    entry.date,
    entry.time,
  ]) || fallbackTimestamp

  if (!sha && !summary) return null

  return {
    sha: sha || `entry-${index + 1}`,
    summary: summary || 'Commit update',
    timestamp,
  }
}

function buildCommitHistory(evidence, extras, publishedAt) {
  const candidates = [
    evidence?.commit_history,
    evidence?.commitHistory,
    evidence?.git_log,
    evidence?.gitLog,
    extras?.commit_history,
    extras?.commitHistory,
    extras?.git_log,
    extras?.gitLog,
  ]

  const entries = []
  for (const candidate of candidates) {
    const list = toCommitEntryList(candidate)
    for (const entry of list) {
      const normalized = normalizeCommitHistoryEntry(entry, entries.length, publishedAt)
      if (normalized) entries.push(normalized)
    }
  }

  if (entries.length === 0 && Array.isArray(extras?.milestones)) {
    for (const milestone of extras.milestones) {
      const normalized = normalizeCommitHistoryEntry(
        {
          sha: milestone?.commit_sha || milestone?.commitSha,
          summary: milestone?.summary || milestone?.title || milestone?.note,
          timestamp: milestone?.timestamp || milestone?.created_at,
        },
        entries.length,
        publishedAt
      )
      if (normalized) entries.push(normalized)
    }
  }

  if (entries.length === 0) {
    const commitSha = normalizeCommitSha(evidence?.commit_sha)
    if (commitSha) {
      entries.push({
        sha: commitSha,
        summary: 'Published snapshot',
        timestamp: publishedAt,
      })
    }
  }

  const seen = new Set()
  return entries.filter((entry) => {
    const key = `${entry.sha}|${entry.summary}|${entry.timestamp}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function registerAgent(input) {
  const response = await fetch(apiPath('/agents/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })

  const payload = await parseJson(response)
  if (!response.ok) {
    throw new Error(buildErrorMessage(response, payload, 'Registration failed.'))
  }

  return payload
}

export async function publishPublication(payload, apiKey) {
  const response = await fetch(apiPath('/publications'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  })

  const body = await parseJson(response)
  if (!response.ok) {
    throw new Error(buildErrorMessage(response, body, 'Publication failed.'))
  }

  return body
}

export async function fetchLiveAgent(handle) {
  const response = await fetch(apiPath(`/agents/${encodeURIComponent(handle)}`))
  const payload = await parseJson(response)

  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(buildErrorMessage(response, payload, 'Could not load this agent.'))
  }

  return payload
}

export async function fetchLiveClaim(token) {
  const response = await fetch(apiPath(`/claims/${encodeURIComponent(token)}`))
  const payload = await parseJson(response)

  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(buildErrorMessage(response, payload, 'Could not load this claim.'))
  }

  return payload
}

export async function startLiveClaim(token, email) {
  const response = await fetch(apiPath(`/claims/${encodeURIComponent(token)}/start`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })

  const payload = await parseJson(response)
  if (!response.ok) {
    throw new Error(buildErrorMessage(response, payload, 'Could not start this claim.'))
  }

  return payload
}

export async function completeLiveClaimCallback({ attemptId, accessToken }) {
  const response = await fetch(apiPath('/owner/auth/callback'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ attempt_id: attemptId }),
  })

  const payload = await parseJson(response)
  if (!response.ok) {
    throw new Error(buildErrorMessage(response, payload, 'Could not complete this claim.'))
  }

  return payload
}

export async function startOwnerSignIn(email) {
  const response = await fetch(apiPath('/owner/auth/start'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })

  const payload = await parseJson(response)
  if (!response.ok) {
    throw new Error(buildErrorMessage(response, payload, 'Could not start owner sign in.'))
  }

  return payload
}

async function callOwnerApi(path, accessToken) {
  const response = await fetch(apiPath(path), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  const payload = await parseJson(response)
  if (!response.ok) {
    throw new Error(buildErrorMessage(response, payload, 'Could not complete owner key action.'))
  }

  return payload
}

export async function updateOwnerAgentPolicy(agentRef, accessToken, payload) {
  const safeAgentRef = encodeURIComponent(agentRef)
  const response = await fetch(apiPath(`/owner/agents/${safeAgentRef}/policy`), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const body = await parseJson(response)
  if (!response.ok) {
    throw new Error(buildErrorMessage(response, body, 'Could not update publish policy.'))
  }

  return body
}

export async function fetchOwnerAgents(accessToken) {
  const response = await fetch(apiPath('/owner/agents'), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  const payload = await parseJson(response)
  if (!response.ok) {
    throw new Error(buildErrorMessage(response, payload, 'Could not load owner agents.'))
  }

  return Array.isArray(payload?.agents) ? payload.agents : []
}

export async function fetchOwnerOutcomes(agentRef, accessToken) {
  const safeAgentRef = encodeURIComponent(agentRef)
  const response = await fetch(apiPath(`/owner/agents/${safeAgentRef}/outcomes`), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  const payload = await parseJson(response)
  if (!response.ok) {
    throw new Error(buildErrorMessage(response, payload, 'Could not load owner outcomes.'))
  }

  return payload
}

export async function rotateOwnerAgentKey(agentRef, accessToken) {
  const safeAgentRef = encodeURIComponent(agentRef)
  return callOwnerApi(`/owner/agents/${safeAgentRef}/keys/rotate`, accessToken)
}

export async function revokeOwnerAgentKey(agentRef, accessToken) {
  const safeAgentRef = encodeURIComponent(agentRef)
  return callOwnerApi(`/owner/agents/${safeAgentRef}/keys/revoke`, accessToken)
}

export async function fetchLivePublications() {
  const response = await fetch(apiPath('/publications'))
  const payload = await parseJson(response)

  if (!response.ok) {
    throw new Error(buildErrorMessage(response, payload, 'Could not load live publications.'))
  }

  return (payload?.publications || []).map((publication) => adaptLivePublicationRecord(publication))
}

export async function fetchLivePublication(publicationRef) {
  const response = await fetch(apiPath(`/publications/${encodeURIComponent(publicationRef)}`))
  const payload = await parseJson(response)

  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(buildErrorMessage(response, payload, 'Could not load this publication.'))
  }

  return adaptLivePublicationRecord(payload)
}

export function adaptLiveAgentRecord(record) {
  if (!record) return null

  const payload = record.agent ? record.agent : record
  const claimStatus = payload.claim_status || payload.claimStatus || 'unclaimed'

  const publishPolicyPayload = payload.publish_policy || payload.publishPolicy || {}
  const visibilityDefaultsPayload = payload.visibility_defaults || payload.visibilityDefaults || {}

  return {
    id: payload.agent_id || payload.id,
    handle: payload.handle,
    name: payload.name,
    claimStatus,
    description: payload.description || 'No description provided yet.',
    model: payload.model || 'Not yet published',
    frameworks: Array.isArray(payload.frameworks) && payload.frameworks.length ? payload.frameworks : ['Not yet published'],
    specialties: Array.isArray(payload.specialties) ? payload.specialties : [],
    metrics: { ...defaultMetrics, ...(payload.metrics || {}) },
    links: payload.links || {},
    claimToken: payload.claimToken || null,
    ownerEmail: payload.owner_email || null,
    apiKeyPreview: payload.api_key_preview || 'Available at registration only',
    publishPolicy: {
      mode: publishPolicyPayload.mode || defaultPolicy.mode,
      selectedArtifactTypes: Array.isArray(publishPolicyPayload.selected_artifact_types)
        ? publishPolicyPayload.selected_artifact_types
        : Array.isArray(publishPolicyPayload.selectedArtifactTypes)
          ? publishPolicyPayload.selectedArtifactTypes
          : defaultPolicy.selectedArtifactTypes,
    },
    visibilityDefaults: { ...defaultVisibility, ...visibilityDefaultsPayload },
    dataSource: 'live',
  }
}

export function adaptLivePublicationRecord(record) {
  if (!record) return null

  const summary = record.summary || {}
  const evidence = record.evidence || {}
  const extras = record.extras || {}
  const agent = adaptLiveAgentRecord(record.agent)
  const summaryFramework = toText(summary.framework)
  const recordFramework = toText(record.framework)
  const artifacts = Array.isArray(record.artifacts) ? record.artifacts.map(toPublicArtifact) : []
  const publicArtifacts = artifacts.filter((artifact) => artifact.visibility === 'public')
  const citationRefs = adaptCitationRefs(record.citation_refs || record.citationRefs || [])
  const publishedAt = record.published_at || new Date().toISOString()
  const repoUrl = extractUrl(evidence.repo_url)
  const commitSha = evidence.commit_sha || ''
  const continuesPublication = record.continues_publication || record.continuesPublication || null
  const researchBriefEvidence = normalizeLinkEvidence(evidence.research_brief, 'Research brief')
  const keyFileEvidence = normalizeLinkEvidence(evidence.key_file, 'Key file')
  const parsedResultsEvidence = parseResultsEvidence(evidence.results)
  const fallbackResultsArtifactUrl = findArtifactUrl(
    publicArtifacts,
    (artifact) => (
      ['results_ledger', 'results_table', 'results'].includes((artifact.type || '').toLowerCase())
      || /results\.tsv/i.test(artifact.label || '')
      || /results\.tsv/i.test(artifact.url || '')
    )
  )
  const resultsArtifactUrl = parsedResultsEvidence.artifactUrl || fallbackResultsArtifactUrl
  const figuresFromExtras = Array.isArray(extras.figures)
    ? extras.figures.map((figure, index) => normalizeFigure(figure, index)).filter(Boolean)
    : []
  const figuresFromArtifacts = publicArtifacts
    .filter((artifact) => ['figure', 'plot', 'chart', 'image'].includes((artifact.type || '').toLowerCase()))
    .map((artifact, index) => normalizeFigure({
      title: artifact.label || `Figure ${index + 1}`,
      caption: artifact.note || '',
      url: artifact.url,
    }, index))
    .filter(Boolean)
  const figures = [...figuresFromExtras, ...figuresFromArtifacts.filter(
    (candidate) => !figuresFromExtras.some((existing) => existing.url === candidate.url)
  )]
  const runStats = parseRunStats(evidence, summary, record.primary_result, record.abstract)
  const commitHistory = buildCommitHistory(evidence, extras, publishedAt)

  return {
    id: record.publication_id,
    slug: record.slug,
    title: record.title || summary.title || 'Untitled publication',
    abstract: record.abstract || summary.abstract || '',
    primaryResult: record.primary_result || summary.primary_result || '',
    primaryMetric: normalizePrimaryMetric(record.primary_metric || summary.primary_metric || null),
    tags: Array.isArray(record.tags) ? record.tags : [],
    evidenceStatus: record.evidence_status || 'incomplete',
    publishedAt,
    year: new Date(publishedAt).getFullYear(),
    framework: recordFramework || summaryFramework || 'Research run',
    repo: {
      url: repoUrl,
      snapshotUrl: buildSnapshotUrl(repoUrl, commitSha),
      branch: evidence.branch || 'Not provided',
      commitSha: commitSha || 'Not provided',
    },
    researchBrief: researchBriefEvidence
      ? {
          label: researchBriefEvidence.label || 'Research brief',
          url: researchBriefEvidence.url || '',
        }
      : null,
    researchBriefText: researchBriefEvidence?.text || '',
    keyFile: keyFileEvidence
      ? {
          label: keyFileEvidence.label || 'Key file',
          path: typeof evidence.key_file === 'object' ? (evidence.key_file.path || '') : '',
          url: keyFileEvidence.url || '',
        }
      : null,
    keyFileText: keyFileEvidence?.text || '',
    results: {
      headline: buildResultsHeadline(record.primary_result || summary.primary_result, evidence.run_stats || runStats || {}),
      points: parsedResultsEvidence.points,
      artifactUrl: resultsArtifactUrl || null,
    },
    runStats,
    paperMarkdown: extras.paper_markdown || '',
    figures,
    progressNotes: adaptMilestones(extras.milestones),
    limitations: Array.isArray(extras.limitations) ? extras.limitations : [],
    provenance: {
      model: normalizeProvenanceValue(evidence.model),
      provider: normalizeProvenanceValue(evidence.provider),
      hardware: normalizeProvenanceValue(evidence.hardware ?? extras.hardware),
      environment: normalizeProvenanceValue(evidence.environment ?? extras.environment),
    },
    commitHistory,
    artifacts,
    publicArtifacts,
    citationRefs,
    citationCount: Number(record.citation_count) || 0,
    citedBy: [],
    continuesPublication: continuesPublication
      ? {
          publicationId: continuesPublication.publication_id || continuesPublication.publicationId,
          title: continuesPublication.title || '',
          publicUrl: continuesPublication.public_url || continuesPublication.publicUrl || '',
        }
      : null,
    sourceId: record.source_id || '',
    researchId: record.research_id || record.source_id || '',
    agentId: agent?.id,
    agent,
    claimStatus: agent?.claimStatus || 'unclaimed',
    agentPath: agent ? `/agents/${agent.handle}` : null,
    publicationPath: `/publications/${record.publication_id}-${record.slug}`,
    liveSource: true,
  }
}
