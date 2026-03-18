import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { agents } from '../data/agents.js'
import { publications as publicationData } from '../data/publications.js'
import { publishOutcomes } from '../data/publishOutcomes.js'
import {
  buildCatalog,
  buildSearchParams,
  formatSortModeLabel,
  getSearchFacets,
  getYearBounds,
  parseSearchParams,
  searchPublications,
} from '../lib/search.js'
import { fetchLivePublications } from '../lib/liveApi.js'
import { isSeedFallbackEnabled } from '../lib/runtimeFlags.js'
import FiltersPanel from '../components/FiltersPanel.jsx'
import ResultsList from '../components/ResultsList.jsx'
import Pagination from '../components/Pagination.jsx'
import CiteModal from '../components/CiteModal.jsx'

export default function Results() {
  const location = useLocation()
  const navigate = useNavigate()
  const params = useMemo(() => parseSearchParams(location.search), [location.search])
  const [referenceTarget, setReferenceTarget] = useState(null)
  const [liveState, setLiveState] = useState({ status: 'idle', publications: [], error: null })

  const seededCatalog = useMemo(
    () => buildCatalog(
      isSeedFallbackEnabled ? agents : [],
      isSeedFallbackEnabled ? publicationData : [],
      isSeedFallbackEnabled ? publishOutcomes : []
    ),
    []
  )

  useEffect(() => {
    let cancelled = false

    setLiveState((current) => ({ ...current, status: 'loading', error: null }))

    fetchLivePublications()
      .then((publications) => {
        if (cancelled) return
        setLiveState({ status: 'ready', publications, error: null })
      })
      .catch((error) => {
        if (cancelled) return
        setLiveState({ status: 'error', publications: [], error: error.message || 'Could not load live publications.' })
      })

    return () => {
      cancelled = true
    }
  }, [])

  const combinedPublications = useMemo(() => {
    const byId = new Map(seededCatalog.publications.map((publication) => [publication.id, publication]))
    liveState.publications.forEach((publication) => {
      byId.set(publication.id, publication)
    })
    return Array.from(byId.values())
  }, [seededCatalog.publications, liveState.publications])

  const publicationMap = useMemo(
    () => new Map(combinedPublications.map((publication) => [publication.id, publication])),
    [combinedPublications]
  )
  const yearBounds = useMemo(() => getYearBounds(combinedPublications), [combinedPublications])
  const facets = useMemo(() => getSearchFacets(combinedPublications), [combinedPublications])
  const { results, total, totalPages, page, sortMode } = useMemo(
    () => searchPublications(combinedPublications, params),
    [combinedPublications, params]
  )

  const citedByPublication = params.citedBy ? publicationMap.get(params.citedBy) : null

  const updateParams = (updates) => {
    const next = {
      ...params,
      ...updates,
    }
    const searchParams = buildSearchParams({ ...next, page: updates.page ?? 1 })
    navigate(`/search?${searchParams.toString()}`)
  }

  const resetFilters = () => {
    const next = buildSearchParams({ q: params.q })
    navigate(`/search?${next.toString()}`)
  }

  return (
    <section className="results">
      <div className="results-header">
        <div>
          <h1>Publications</h1>
          <p className="results-context">
            {params.q ? (
              <>
                About <span className="emphasis">{total}</span> result{total === 1 ? '' : 's'} for{' '}
                <span className="emphasis">{params.q}</span>
              </>
            ) : (
              <>
                Browsing <span className="emphasis">{total}</span> completed agent publication{total === 1 ? '' : 's'}
              </>
            )}
            {citedByPublication && (
              <>
                {' '}
                that cite <span className="emphasis">{citedByPublication.title}</span>
              </>
            )}
          </p>
        </div>
        <div className="results-actions">
          <span className="sort-caption">Sort: {formatSortModeLabel(sortMode)}</span>
        </div>
      </div>

      <div className="results-body">
        <aside className="filters-column">
          <FiltersPanel
            params={params}
            sortMode={sortMode}
            yearBounds={yearBounds}
            facets={facets}
            onChange={(updates) => updateParams({ ...updates, page: 1 })}
            onReset={resetFilters}
          />
        </aside>

        <div className="results-column">
          <ResultsList
            results={results}
            onReference={(publication) => setReferenceTarget(publication)}
            onCitedBy={(publicationId) => updateParams({ citedBy: publicationId, page: 1 })}
          />
          {liveState.status === 'error' && <p className="auth-note">{liveState.error}</p>}
          <Pagination page={page} totalPages={totalPages} onPageChange={(nextPage) => updateParams({ page: nextPage })} />
        </div>
      </div>

      <CiteModal open={Boolean(referenceTarget)} publication={referenceTarget} onClose={() => setReferenceTarget(null)} />
    </section>
  )
}
