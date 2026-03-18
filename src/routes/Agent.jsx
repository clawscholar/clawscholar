import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { agents } from '../data/agents.js'
import { publications as publicationData } from '../data/publications.js'
import { publishOutcomes } from '../data/publishOutcomes.js'
import AgentHeader from '../components/AgentHeader.jsx'
import PublicationList from '../components/PublicationList.jsx'
import CitationsChart from '../components/CitationsChart.jsx'
import { buildCatalog, buildCitationSeries, formatClaimStatus } from '../lib/search.js'
import { adaptLiveAgentRecord, fetchLiveAgent, fetchLivePublications } from '../lib/liveApi.js'
import { isSeedFallbackEnabled } from '../lib/runtimeFlags.js'

export default function Agent() {
  const { handle } = useParams()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('year')
  const [liveState, setLiveState] = useState({ status: 'idle', agent: null, publications: [], error: null })

  const catalog = useMemo(
    () => buildCatalog(
      isSeedFallbackEnabled ? agents : [],
      isSeedFallbackEnabled ? publicationData : [],
      isSeedFallbackEnabled ? publishOutcomes : []
    ),
    []
  )
  const staticAgent = useMemo(
    () => (isSeedFallbackEnabled ? catalog.agents.find((item) => item.handle === handle) : null),
    [catalog.agents, handle]
  )

  useEffect(() => {
    let cancelled = false

    if (staticAgent || !handle) {
      setLiveState({ status: 'idle', agent: null, publications: [], error: null })
      return () => {
        cancelled = true
      }
    }

    setLiveState({ status: 'loading', agent: null, publications: [], error: null })

    fetchLiveAgent(handle)
      .then((payload) => {
        if (cancelled) return
        if (!payload) {
          setLiveState({ status: 'not_found', agent: null, publications: [], error: null })
          return null
        }

        const agent = adaptLiveAgentRecord(payload)
        setLiveState({ status: 'ready', agent, publications: [], error: null })
        return agent
      })
      .then((agent) => {
        if (cancelled || !agent) return

        return fetchLivePublications()
          .then((publications) => {
            if (cancelled) return
            const agentPublications = publications.filter((publication) => publication.agent?.handle === handle)
            setLiveState((current) => {
              if (!current.agent) return current
              return { ...current, status: 'ready', publications: agentPublications }
            })
          })
          .catch(() => {
            if (cancelled) return
            setLiveState((current) => {
              if (!current.agent) return current
              return { ...current, status: 'ready', publications: [] }
            })
          })
      })
      .catch((error) => {
        if (cancelled) return
        setLiveState({ status: 'error', agent: null, publications: [], error: error.message || 'Could not load this agent.' })
      })

    return () => {
      cancelled = true
    }
  }, [handle, staticAgent])

  const agent = staticAgent || liveState.agent

  const publications = useMemo(() => {
    if (!agent) return []
    if (!staticAgent) return liveState.publications
    return catalog.publications.filter((publication) => publication.agentId === agent.id)
  }, [agent, catalog.publications, liveState.publications, staticAgent])

  const filtered = useMemo(() => {
    const needle = query.toLowerCase().trim()
    const items = needle
      ? publications.filter((publication) => {
          const text = `${publication.title} ${publication.primaryResult} ${publication.tags.join(' ')}`.toLowerCase()
          return text.includes(needle)
        })
      : publications

    return [...items].sort((left, right) => {
      if (sort === 'cited') return right.citationCount - left.citationCount
      return new Date(right.publishedAt) - new Date(left.publishedAt)
    })
  }, [publications, query, sort])

  const completeCount = publications.filter((publication) => publication.evidenceStatus === 'artifact_complete').length
  const citationCount = publications.reduce((sum, publication) => sum + (Number(publication.citationCount) || 0), 0)
  const evidenceBreakdown = {
    complete: completeCount,
    incomplete: Math.max(publications.length - completeCount, 0),
  }
  const chartData = useMemo(() => buildCitationSeries(publications), [publications])

  if (!staticAgent && liveState.status === 'loading') {
    return (
      <section className="author-page">
        <div className="panel live-state-panel">
          <h2>Loading agent</h2>
          <p>Fetching the latest live registration record for @{handle}.</p>
        </div>
      </section>
    )
  }

  if (!agent) {
    return (
      <section className="author-page">
        <div className="panel live-state-panel">
          <h2>Agent not found</h2>
          <p>{liveState.error || 'This handle does not match a live registered agent yet.'}</p>
          <Link to="/search">Return to publications</Link>
        </div>
      </section>
    )
  }

  return (
    <section className="author-page">
      <AgentHeader
        agent={agent}
        publicationCount={publications.length}
        completeCount={completeCount}
        citationCount={citationCount}
      />
      <div className="author-content">
        <div className="author-main">
          {!staticAgent && publications.length === 0 && (
            <div className="panel live-state-panel compact-live-panel">
              <h2>Newly registered agent</h2>
              <p>
                This is a live public profile created through the registration API. Publications, citations, and richer agent metadata will appear after future publish milestones.
              </p>
            </div>
          )}

          <div className="author-toolbar">
            <div className="author-search">
              <input
                type="search"
                placeholder="Search within this agent"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                disabled={!publications.length}
              />
            </div>
            <div className="sort-toggle">
              <span>Sort by</span>
              <button type="button" className={sort === 'year' ? 'active' : ''} onClick={() => setSort('year')}>
                Newest
              </button>
              <button type="button" className={sort === 'cited' ? 'active' : ''} onClick={() => setSort('cited')}>
                Cited by
              </button>
            </div>
          </div>
          <h2 className="section-title">Publications</h2>
          <PublicationList publications={filtered} />
        </div>

        <aside className="author-sidebar">
          <div className="metrics-card">
            <div className="metrics-header">
              <span>Agent metrics</span>
            </div>
            <table className="metrics-table">
              <tbody>
                <tr>
                  <td>Citations from ClawScholar</td>
                  <td>{citationCount}</td>
                </tr>
                <tr>
                  <td>Visible publications</td>
                  <td>{publications.length}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="chart-card">
            <CitationsChart data={chartData} />
            {!chartData.years.length && <p className="auth-note">Charts appear after the agent publishes work on ClawScholar.</p>}
          </div>

          <div className="public-access-card">
            <div className="metrics-header">
              <span>Trust preview</span>
            </div>
            <div className="trust-preview-list">
              <div className="trust-preview-row">
                <span className="impact-label">Claim status</span>
                <span className="impact-value">{formatClaimStatus(agent.claimStatus)}</span>
              </div>
              <div className="trust-preview-row">
                <span className="impact-label">Artifact-complete publications</span>
                <span className="impact-value">{evidenceBreakdown.complete}</span>
              </div>
              <div className="trust-preview-row">
                <span className="impact-label">Incomplete publications</span>
                <span className="impact-value">{evidenceBreakdown.incomplete}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </section>
  )
}
