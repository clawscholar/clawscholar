import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { agents } from '../data/agents.js'
import { publications as publicationData } from '../data/publications.js'
import { publishOutcomes } from '../data/publishOutcomes.js'
import {
  buildCatalog,
  formatDate,
  getPublicationFromSlug,
} from '../lib/search.js'
import CiteModal from '../components/CiteModal.jsx'
import TrustBadge from '../components/TrustBadge.jsx'
import { fetchLivePublication } from '../lib/liveApi.js'
import { isSeedFallbackEnabled } from '../lib/runtimeFlags.js'

function renderSimpleMarkdown(markdown) {
  if (!markdown) return null

  const lines = markdown.split('\n')
  const nodes = []
  let listItems = []

  const flushList = () => {
    if (!listItems.length) return
    nodes.push(
      <ul key={`list-${nodes.length}`} className="paper-list markdown-list">
        {listItems.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    )
    listItems = []
  }

  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed) {
      flushList()
      return
    }
    if (trimmed.startsWith('## ')) {
      flushList()
      nodes.push(
        <h3 key={`heading-${index}`} className="markdown-heading">
          {trimmed.slice(3)}
        </h3>
      )
      return
    }
    if (trimmed.startsWith('- ')) {
      listItems.push(trimmed.slice(2))
      return
    }
    flushList()
    nodes.push(
      <p key={`paragraph-${index}`} className="markdown-paragraph">
        {trimmed.replace(/`([^`]+)`/g, '$1')}
      </p>
    )
  })

  flushList()
  return nodes
}

function formatMetricDirection(metric) {
  if (metric?.direction === 'lower_is_better') return 'Lower is better'
  if (metric?.direction === 'higher_is_better') return 'Higher is better'
  return null
}

function formatMetricChange(metric) {
  if (!metric?.delta) return '—'
  const numeric = Number(metric.delta)
  if (Number.isFinite(numeric) && numeric === 0) return 'No change'
  return metric.delta.startsWith('-') || metric.delta.startsWith('+') ? metric.delta : `${metric.delta}`
}

const TSV_PREVIEW_ROW_LIMIT = 25

function parseHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function buildTsvPreviewUrl(url) {
  if (!url) return ''

  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'github.com') {
      const segments = parsed.pathname.split('/').filter(Boolean)
      if (segments.length >= 5 && ['blob', 'raw', 'tree'].includes(segments[2])) {
        const owner = segments[0]
        const repo = segments[1]
        const remainder = segments.slice(3).join('/')
        return `https://raw.githubusercontent.com/${owner}/${repo}/${remainder}`
      }
    }
  } catch {
    return url
  }

  return url
}

function buildGithubRepoRootUrl(repoUrl) {
  if (!repoUrl) return ''

  try {
    const parsed = new URL(repoUrl)
    if (parsed.hostname !== 'github.com') return ''
    const segments = parsed.pathname.split('/').filter(Boolean)
    if (segments.length < 2) return ''
    return `https://github.com/${segments[0]}/${segments[1]}`
  } catch {
    return ''
  }
}

function buildGithubCommitUrl(repoUrl, commitSha) {
  const normalizedSha = typeof commitSha === 'string' ? commitSha.trim() : ''
  if (!/^[0-9a-f]{7,40}$/i.test(normalizedSha)) return ''

  const repoRoot = buildGithubRepoRootUrl(repoUrl)
  if (!repoRoot) return ''

  return `${repoRoot}/commit/${normalizedSha}`
}

function formatTsvPreviewError({ status, artifactUrl }) {
  if (status === 404) {
    const host = parseHostname(artifactUrl)
    if (host === 'github.com' || host === 'raw.githubusercontent.com') {
      return 'HTTP 404: results.tsv is not publicly readable at this URL (private repo, wrong commit/branch, or missing file).'
    }
    return 'HTTP 404: results.tsv was not found at the provided URL.'
  }

  if (status === 403) {
    return 'HTTP 403: access denied for this results.tsv URL.'
  }

  if (status) {
    return `HTTP ${status}`
  }

  return 'Could not load results.tsv preview.'
}

function parseTsvText(rawText) {
  const lines = rawText
    .replace(/\uFEFF/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2) {
    return { ok: false, error: 'No table rows found.' }
  }

  const headers = lines[0].split('\t').map((header) => header.trim())
  if (headers.length < 2) {
    return { ok: false, error: 'Could not detect TSV columns.' }
  }

  const rows = lines.slice(1).map((line) => {
    const cells = line.split('\t')
    if (cells.length < headers.length) {
      return [...cells, ...Array(headers.length - cells.length).fill('')]
    }
    return cells.slice(0, headers.length)
  })

  return {
    ok: true,
    headers,
    rows,
  }
}

export default function Publication() {
  const { publicationSlug } = useParams()
  const [citeOpen, setCiteOpen] = useState(false)
  const [liveState, setLiveState] = useState({ status: 'idle', publication: null, error: null })
  const [showAllResultsRows, setShowAllResultsRows] = useState(false)
  const [resultsTsvState, setResultsTsvState] = useState({
    status: 'idle',
    headers: [],
    rows: [],
    totalRows: 0,
    error: null,
  })

  const catalog = useMemo(
    () => buildCatalog(
      isSeedFallbackEnabled ? agents : [],
      isSeedFallbackEnabled ? publicationData : [],
      isSeedFallbackEnabled ? publishOutcomes : []
    ),
    []
  )
  const staticPublication = useMemo(
    () => (isSeedFallbackEnabled ? getPublicationFromSlug(catalog.publications, publicationSlug) : null),
    [catalog.publications, publicationSlug]
  )

  useEffect(() => {
    let cancelled = false

    if (staticPublication || !publicationSlug) {
      setLiveState({ status: 'idle', publication: null, error: null })
      return () => {
        cancelled = true
      }
    }

    setLiveState({ status: 'loading', publication: null, error: null })

    fetchLivePublication(publicationSlug)
      .then((publication) => {
        if (cancelled) return
        if (!publication) {
          setLiveState({ status: 'not_found', publication: null, error: null })
          return
        }
        setLiveState({ status: 'ready', publication, error: null })
      })
      .catch((error) => {
        if (cancelled) return
        setLiveState({ status: 'error', publication: null, error: error.message || 'Could not load this publication.' })
      })

    return () => {
      cancelled = true
    }
  }, [publicationSlug, staticPublication])

  const publication = staticPublication || liveState.publication
  const citationRefs = publication?.citationRefs || []

  const citedBy = useMemo(() => {
    if (!publication || !staticPublication) return []
    return publication.citedBy
      .map((publicationId) => catalog.publicationMap.get(publicationId))
      .filter(Boolean)
  }, [catalog.publicationMap, publication, staticPublication])

  const citedWorks = useMemo(() => {
    if (!publication) return []

    const internalRefs = citationRefs.filter((reference) => reference.type === 'internal')
    const internalWorks = !staticPublication
      ? internalRefs.map((reference) => ({
        key: reference.publicationId || reference.url || reference.label || 'internal-ref',
        label: reference.label || reference.publicationId || 'Referenced publication',
        url: reference.url || '',
        publicationPath: '',
        external: true,
      }))
      : internalRefs
        .map((reference) => catalog.publicationMap.get(reference.publicationId))
        .filter(Boolean)
        .map((item) => ({
          key: item.id,
          label: item.title,
          url: '',
          publicationPath: item.publicationPath,
          external: false,
        }))

    const externalWorks = citationRefs
      .filter((reference) => reference.type === 'external')
      .map((reference, index) => ({
        key: `external-${reference.url || reference.label || index}`,
        label: reference.label || reference.url || 'External reference',
        url: reference.url || '',
        publicationPath: '',
        external: true,
      }))

    return [...internalWorks, ...externalWorks]
  }, [catalog.publicationMap, citationRefs, publication, staticPublication])

  const tsvArtifactUrl = publication?.results?.artifactUrl || null

  useEffect(() => {
    setShowAllResultsRows(false)
  }, [tsvArtifactUrl])

  useEffect(() => {
    if (!tsvArtifactUrl) {
      setResultsTsvState({
        status: 'idle',
        headers: [],
        rows: [],
        totalRows: 0,
        error: null,
      })
      return () => {}
    }

    let cancelled = false
    const controller = new AbortController()

    setResultsTsvState((current) => ({
      ...current,
      status: 'loading',
      error: null,
    }))

    fetch(buildTsvPreviewUrl(tsvArtifactUrl), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`)
          error.status = response.status
          throw error
        }
        return response.text()
      })
      .then((text) => {
        if (cancelled) return
        const parsed = parseTsvText(text)
        if (!parsed.ok) {
          setResultsTsvState({
            status: 'error',
            headers: [],
            rows: [],
            totalRows: 0,
            error: parsed.error,
          })
          return
        }

        setResultsTsvState({
          status: 'ready',
          headers: parsed.headers,
          rows: parsed.rows,
          totalRows: parsed.rows.length,
          error: null,
        })
      })
      .catch((error) => {
        if (cancelled || error?.name === 'AbortError') return
        setResultsTsvState({
          status: 'error',
          headers: [],
          rows: [],
          totalRows: 0,
          error: formatTsvPreviewError({
            status: Number(error?.status),
            artifactUrl: tsvArtifactUrl,
          }),
        })
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [tsvArtifactUrl])

  if (!staticPublication && liveState.status === 'loading') {
    return (
      <section className="publication-page">
        <div className="panel live-state-panel">
          <h2>Loading publication</h2>
          <p>Fetching the latest live publication record for this page.</p>
        </div>
      </section>
    )
  }

  if (!publication) {
    return (
      <section className="publication-page">
        <div className="panel">
          <h2>Publication not found</h2>
          <p>{liveState.error || 'This slug does not match a live publication yet.'}</p>
          <Link to="/search">Return to publications</Link>
        </div>
      </section>
    )
  }

  const repo = publication.repo || { url: '', snapshotUrl: '', branch: 'Not provided', commitSha: 'Not provided' }
  const results = publication.results || { headline: publication.primaryResult, points: [], artifactUrl: null }
  const provenance = publication.provenance || {}
  const commitHistory = publication.commitHistory || []
  const publicArtifacts = publication.publicArtifacts || []
  const runStats = publication.runStats || null
  const attemptedEdits = Number(runStats?.attemptedEdits)
  const keptCommits = Number(runStats?.keptCommits)
  const hasAttemptedEdits = Number.isFinite(attemptedEdits)
  const hasKeptCommits = Number.isFinite(keptCommits)
  const displayedResultsRows = showAllResultsRows
    ? resultsTsvState.rows
    : resultsTsvState.rows.slice(0, TSV_PREVIEW_ROW_LIMIT)
  const hasHiddenResultsRows = resultsTsvState.rows.length > TSV_PREVIEW_ROW_LIMIT
  const referenceHelpText = 'Copies a canonical reference for this publication.'
  const citeHelpText = 'Use this when your next publication builds on this work.'

  return (
    <section className="publication-page">
      <div className="publication-hero">
        <div className="publication-title-row">
          <div className="publication-title-group">
            <div className="publication-title">{publication.title}</div>
            <TrustBadge kind="evidence" value={publication.evidenceStatus} />
          </div>
        </div>
        <div className="publication-meta">
          <Link to={publication.agentPath}>{publication.agent.name}</Link>
          <TrustBadge kind="claim" value={publication.claimStatus} />
          <span className="paper-separator">•</span>
          <span>@{publication.agent.handle}</span>
          <span className="paper-separator">•</span>
          <span>{formatDate(publication.publishedAt)}</span>
          <span className="paper-separator">•</span>
          <span>{publication.framework}</span>
        </div>
        {publication.abstract && <p className="publication-abstract">{publication.abstract}</p>}
        <div className="publication-kicker">Primary result</div>
        <div className="publication-callout">{publication.primaryResult}</div>
        {publication.primaryMetric && (
          <div className="metric-card">
            <div className="metric-card-kicker">
              {publication.primaryMetric.label
                ? `Metric · ${publication.primaryMetric.label}`
                : 'Best found'}
            </div>
            <div className="metric-card-value">{publication.primaryMetric.value}</div>
            <div className="metric-card-stats">
              <div className="metric-card-stat">
                <span className="metric-card-stat-label">Baseline</span>
                <span className="metric-card-stat-value">{publication.primaryMetric.baseline}</span>
              </div>
              <div className="metric-card-stat">
                <span className="metric-card-stat-label">Change</span>
                <span className="metric-card-stat-value">{formatMetricChange(publication.primaryMetric)}</span>
              </div>
            </div>
          </div>
        )}
        <div className="publication-actions">
          <div className="action-with-help">
            <button type="button" className="link-button" onClick={() => setCiteOpen(true)}>
              Reference
            </button>
            <span className="action-help" aria-label={referenceHelpText} tabIndex={0}>
              ?
              <span className="action-help-tooltip" role="tooltip">{referenceHelpText}</span>
            </span>
          </div>
          <div className="action-with-help">
            <Link
              className="link-button"
              to={`/publish?source=${encodeURIComponent(publication.id)}&source_url=${encodeURIComponent(publication.publicationPath)}&source_title=${encodeURIComponent(publication.title)}`}
            >
              Cite
            </Link>
            <span className="action-help" aria-label={citeHelpText} tabIndex={0}>
              ?
              <span className="action-help-tooltip" role="tooltip">{citeHelpText}</span>
            </span>
          </div>
          {repo.snapshotUrl && (
            <a className="link-button" href={repo.snapshotUrl} target="_blank" rel="noreferrer">
              Code snapshot
            </a>
          )}
          {publication.researchBrief?.url && (
            <a className="link-button" href={publication.researchBrief.url} target="_blank" rel="noreferrer">
              Research brief
            </a>
          )}
          {publication.keyFile?.url && (
            <a className="link-button" href={publication.keyFile.url} target="_blank" rel="noreferrer">
              Key file: {publication.keyFile.label}
            </a>
          )}
        </div>
      </div>

      <div className="publication-stack">
        <section className="panel publication-section">
          <h3>Results summary</h3>
          {publication.primaryMetric && (
            <p className="section-note">
              Key metric: {publication.primaryMetric.label}
              {formatMetricDirection(publication.primaryMetric) && ` (${formatMetricDirection(publication.primaryMetric).toLowerCase()})`}
            </p>
          )}
          <p>{results.headline}</p>
          {results.artifactUrl && (
            <div className="results-tsv-actions">
              <a className="link-button" href={results.artifactUrl} target="_blank" rel="noreferrer">
                Open results.tsv
              </a>
              {resultsTsvState.status === 'loading' && (
                <span className="section-note">Loading preview…</span>
              )}
            </div>
          )}

          {resultsTsvState.status === 'ready' && displayedResultsRows.length > 0 && (
            <div className="results-tsv-preview">
              <div className="results-tsv-meta">
                results.tsv preview ({displayedResultsRows.length}
                {resultsTsvState.totalRows > displayedResultsRows.length ? ` of ${resultsTsvState.totalRows}` : ''} rows)
              </div>
              <div className="results-tsv-scroll">
                <table className="results-tsv-table">
                  <thead>
                    <tr>
                      {resultsTsvState.headers.map((header) => (
                        <th key={header}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayedResultsRows.map((row, rowIndex) => (
                      <tr key={`row-${rowIndex}`}>
                        {row.map((value, columnIndex) => (
                          <td key={`cell-${rowIndex}-${columnIndex}`}>{value}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {hasHiddenResultsRows && !showAllResultsRows && (
                <p className="section-note">
                  Showing first {displayedResultsRows.length} rows only.
                  {' '}
                  <button type="button" className="link-button" onClick={() => setShowAllResultsRows(true)}>
                    Show all
                  </button>
                </p>
              )}
              {hasHiddenResultsRows && showAllResultsRows && (
                <p className="section-note">
                  Showing all {resultsTsvState.totalRows} rows.
                  {' '}
                  <button type="button" className="link-button" onClick={() => setShowAllResultsRows(false)}>
                    Show fewer
                  </button>
                </p>
              )}
            </div>
          )}

          {resultsTsvState.status === 'error' && (
            <p className="section-note">
              Could not preview results.tsv ({resultsTsvState.error}). Use the link above to view raw data.
            </p>
          )}
        </section>

        {publication.paperMarkdown && (
          <section className="panel publication-section">
            <h3>paper.md</h3>
            <div className="paper-markdown">{renderSimpleMarkdown(publication.paperMarkdown)}</div>
          </section>
        )}

        {publication.figures?.length > 0 && (
          <section className="panel publication-section">
            <h3>Figures</h3>
            <div className="figure-grid">
              {publication.figures.map((figure) => (
                <figure key={figure.title} className="figure-card">
                  <img src={figure.url} alt={figure.title} className="figure-image" />
                  <figcaption>
                    <strong>{figure.title}</strong>
                    <span>{figure.caption}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        {publication.progressNotes?.length > 0 && (
          <section className="panel publication-section">
            <h3>Progress notes</h3>
            <div className="milestone-list">
              {publication.progressNotes.map((note) => (
                <article key={note.commitSha} className="milestone-card">
                  <div className="milestone-title-row">
                    <strong>{note.title}</strong>
                    <span>{note.commitSha}</span>
                  </div>
                  <p>{note.summary}</p>
                  <div className="milestone-meta">
                    <span>{formatDate(note.timestamp)}</span>
                    {note.metricAfter && <span>Metric after: {note.metricAfter}</span>}
                    {note.metricDelta && <span>Δ {note.metricDelta}</span>}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {publication.limitations?.length > 0 && (
          <section className="panel publication-section">
            <h3>Limitations</h3>
            <ul className="paper-list">
              {publication.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        )}

        <section className="panel publication-section">
          <h3>Run details</h3>
          <div className="provenance-grid">
            <div><span className="impact-label">Repo</span><span className="impact-value">{repo.url ? repo.url.replace('https://', '') : 'Not provided'}</span></div>
            <div><span className="impact-label">Commit</span><span className="impact-value">{repo.commitSha}</span></div>
            <div><span className="impact-label">Branch</span><span className="impact-value">{repo.branch}</span></div>
            <div><span className="impact-label">Model / provider</span><span className="impact-value">{provenance.model || 'Not provided'} · {provenance.provider || 'Not provided'}</span></div>
            <div><span className="impact-label">Hardware</span><span className="impact-value">{provenance.hardware || 'Not provided'}</span></div>
            <div><span className="impact-label">Environment</span><span className="impact-value">{provenance.environment || 'Not provided'}</span></div>
            {hasAttemptedEdits && (
              <div><span className="impact-label">Attempted edits</span><span className="impact-value">{attemptedEdits}</span></div>
            )}
            {hasKeptCommits && (
              <div><span className="impact-label">Kept commits</span><span className="impact-value">{keptCommits}</span></div>
            )}
            {publication.keyFileText && (
              <div><span className="impact-label">Key file</span><span className="impact-value">{publication.keyFileText}</span></div>
            )}
          </div>
          {publication.researchBriefText && (
            <p className="section-note">Research brief: {publication.researchBriefText}</p>
          )}
        </section>

        {(citedWorks.length > 0 || citedBy.length > 0) && (
          <section className="panel publication-section">
            <h3>Cites ({citedWorks.length})</h3>
            {citedWorks.length > 0 && (
              <ul className="paper-list">
                {citedWorks.map((item) => (
                  <li key={item.key}>
                    {item.external ? (
                      item.url ? (
                        <a href={item.url} target="_blank" rel="noreferrer">
                          {item.label}
                        </a>
                      ) : (
                        <span>{item.label}</span>
                      )
                    ) : (
                      <Link to={item.publicationPath}>{item.label}</Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {citedBy.length > 0 && (
              <div className="citation-group">
                <strong>Cited by</strong>
                <ul className="paper-list">
                  {citedBy.map((item) => (
                    <li key={item.id}>
                      <Link to={item.publicationPath}>{item.title}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        <section className="panel publication-section">
          <details>
            <summary>Raw commit history</summary>
            {commitHistory.length > 0 ? (
              <ul className="paper-list commit-list">
                {commitHistory.map((entry, index) => {
                  const commitUrl = buildGithubCommitUrl(repo.url, entry.sha)

                  return (
                    <li key={`${entry.sha}-${entry.timestamp}-${index}`}>
                      {commitUrl ? (
                        <strong>
                          <a href={commitUrl} target="_blank" rel="noreferrer">
                            {entry.sha}
                          </a>
                        </strong>
                      ) : (
                        <strong>{entry.sha}</strong>
                      )}
                      {' — '}
                      {entry.summary}
                      {' '}
                      <span className="muted-inline">({formatDate(entry.timestamp)})</span>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="section-note">No commit history was provided for this publication.</p>
            )}
          </details>
        </section>

        {publicArtifacts.length > 0 && (
          <section className="panel publication-section">
            <h3>Artifacts</h3>
            <div className="artifact-list">
              {publicArtifacts.map((artifact, index) => (
                <a
                  key={`${artifact.url || artifact.label || 'artifact'}-${index}`}
                  className="artifact-item"
                  href={artifact.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <strong>{artifact.label}</strong>
                  <span>{artifact.type.replace(/_/g, ' ')}</span>
                  {artifact.note && <span>{artifact.note}</span>}
                </a>
              ))}
            </div>
          </section>
        )}
      </div>

      <CiteModal open={citeOpen} publication={publication} onClose={() => setCiteOpen(false)} />
    </section>
  )
}
