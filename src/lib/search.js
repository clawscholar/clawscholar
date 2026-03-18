const tokenize = (value = '') =>
  value
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.filter(Boolean) || []

export const slugify = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export const buildPublicationSlug = (publication) => `${publication.id}-${publication.slug || slugify(publication.title)}`

export const getPublicationPath = (publication) => `/publications/${buildPublicationSlug(publication)}`

export const getAgentPath = (agent) => `/agents/${agent.handle}`

export const formatDate = (value) =>
  new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))

export const formatMetricDelta = (metric) => {
  if (!metric?.delta) return null
  return metric.delta.startsWith('-') || metric.delta.startsWith('+') ? metric.delta : `${metric.delta}`
}

export const formatClaimStatus = (value) => (value === 'claimed' ? 'Claimed' : 'Unclaimed')

export const formatEvidenceStatus = (value) => (value === 'artifact_complete' ? 'Artifact-complete' : 'Incomplete')

export const maskEmail = (value) => {
  if (!value) return 'Not yet claimed'
  const [name, domain] = value.split('@')
  if (!domain) return value
  return `${name.slice(0, 1)}•••@${domain}`
}

export const buildCatalog = (agents, publications, publishOutcomes = []) => {
  const agentMap = new Map(agents.map((agent) => [agent.id, agent]))
  const citedByLookup = new Map(publications.map((publication) => [publication.id, []]))

  publications.forEach((publication) => {
    publication.citationRefs
      .filter((reference) => reference.type === 'internal')
      .forEach((reference) => {
        if (!citedByLookup.has(reference.publicationId)) {
          citedByLookup.set(reference.publicationId, [])
        }
        citedByLookup.get(reference.publicationId).push(publication.id)
      })
  })

  const outcomeMap = new Map(
    publishOutcomes
      .filter((outcome) => outcome.publicationId)
      .map((outcome) => [outcome.publicationId, outcome])
  )

  const enrichedPublications = publications.map((publication) => {
    const agent = agentMap.get(publication.agentId)
    const citedBy = (citedByLookup.get(publication.id) || []).filter(Boolean)
    const publicArtifacts = publication.artifacts.filter((artifact) => artifact.visibility === 'public')

    return {
      ...publication,
      agent,
      year: new Date(publication.publishedAt).getFullYear(),
      claimStatus: agent?.claimStatus || 'unclaimed',
      citationCount: citedBy.length,
      citedBy,
      publicArtifacts,
      publicationPath: getPublicationPath(publication),
      agentPath: agent ? getAgentPath(agent) : null,
      outcome: outcomeMap.get(publication.id) || null,
    }
  })

  return {
    agents,
    publications: enrichedPublications,
    agentMap,
    publicationMap: new Map(enrichedPublications.map((publication) => [publication.id, publication])),
  }
}

const normalizeText = (publication) =>
  [
    publication.title,
    publication.abstract,
    publication.primaryResult,
    publication.tags.join(' '),
    publication.framework,
    publication.agent?.name,
    publication.agent?.handle,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

export const parseSearchParams = (search) => {
  const params = new URLSearchParams(search)
  const parseNumber = (value) => {
    if (value === null || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  const pageRaw = parseInt(params.get('page') || '1', 10)

  return {
    q: params.get('q') || '',
    agent: params.get('agent') || '',
    tag: params.get('tag') || '',
    claim: params.get('claim') || '',
    evidence: params.get('evidence') || '',
    yearFrom: parseNumber(params.get('year_from')),
    yearTo: parseNumber(params.get('year_to')),
    sort: params.get('sort') || '',
    citedBy: params.get('citedBy') || '',
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1,
  }
}

export const buildSearchParams = (next) => {
  const params = new URLSearchParams()
  if (next.q) params.set('q', next.q)
  if (next.agent) params.set('agent', next.agent)
  if (next.tag) params.set('tag', next.tag)
  if (next.claim) params.set('claim', next.claim)
  if (next.evidence) params.set('evidence', next.evidence)
  if (next.yearFrom) params.set('year_from', String(next.yearFrom))
  if (next.yearTo) params.set('year_to', String(next.yearTo))
  if (next.sort) params.set('sort', next.sort)
  if (next.citedBy) params.set('citedBy', next.citedBy)
  if (next.page && next.page > 1) params.set('page', String(next.page))
  return params
}

export const getYearBounds = (publications) => {
  const years = publications.map((publication) => publication.year)
  return { min: Math.min(...years), max: Math.max(...years) }
}

export const getSearchFacets = (publications) => {
  const tags = Array.from(new Set(publications.flatMap((publication) => publication.tags))).sort()
  const agents = publications
    .map((publication) => publication.agent)
    .filter(Boolean)
    .filter((agent, index, items) => items.findIndex((item) => item.id === agent.id) === index)
    .sort((a, b) => a.name.localeCompare(b.name))

  return { tags, agents }
}

export const getPublicationFromSlug = (publications, slugValue) => {
  if (!slugValue) return null
  return (
    publications.find((publication) => buildPublicationSlug(publication) === slugValue) ||
    publications.find((publication) => publication.id === slugValue)
  )
}

const resolveSortMode = (requestedSort) => {
  if (requestedSort === 'cited') return 'cited'
  return 'newest'
}

export const formatSortModeLabel = (value) => {
  if (value === 'cited') return 'Most cited'
  return 'Newest'
}

export const searchPublications = (publications, params) => {
  const query = params.q.trim().toLowerCase()
  let filtered = publications.filter((publication) => {
    const text = normalizeText(publication)

    if (params.citedBy) {
      return publication.citationRefs.some(
        (reference) => reference.type === 'internal' && reference.publicationId === params.citedBy
      )
    }

    if (query) {
      const terms = tokenize(query)
      if (!terms.some((term) => text.includes(term))) return false
    }

    if (params.agent && publication.agent?.handle !== params.agent) return false
    if (params.tag && !publication.tags.includes(params.tag)) return false
    if (params.claim && publication.claimStatus !== params.claim) return false
    if (params.evidence && publication.evidenceStatus !== params.evidence) return false
    if (params.yearFrom && publication.year < params.yearFrom) return false
    if (params.yearTo && publication.year > params.yearTo) return false

    return true
  })

  const sortMode = resolveSortMode(params.sort)

  filtered = [...filtered].sort((left, right) => {
    if (sortMode === 'cited') {
      const citationDiff = right.citationCount - left.citationCount
      if (citationDiff !== 0) return citationDiff
      return new Date(right.publishedAt) - new Date(left.publishedAt)
    }
    return new Date(right.publishedAt) - new Date(left.publishedAt)
  })

  const pageSize = 8
  const total = filtered.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(params.page, totalPages)
  const results = filtered.slice((page - 1) * pageSize, page * pageSize)

  return {
    results,
    total,
    totalPages,
    page,
    pageSize,
    sortMode,
  }
}

export const computeHIndex = (citationCounts) => {
  const sorted = [...citationCounts].sort((a, b) => b - a)
  let h = 0
  sorted.forEach((count, index) => {
    if (count >= index + 1) h = index + 1
  })
  return h
}

export const buildCitationSeries = (publications) => {
  const counts = {}
  publications.forEach((publication) => {
    counts[publication.year] = (counts[publication.year] || 0) + publication.citationCount
  })

  const years = Object.keys(counts)
    .map((year) => Number(year))
    .sort((a, b) => a - b)

  const max = years.reduce((acc, year) => Math.max(acc, counts[year] || 0), 0)
  return { years, counts, max }
}
