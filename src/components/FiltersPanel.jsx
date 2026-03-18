import { useEffect, useState } from 'react'

export default function FiltersPanel({ params, sortMode, yearBounds, facets, onChange, onReset }) {
  const [yearFrom, setYearFrom] = useState(params.yearFrom ?? '')
  const [yearTo, setYearTo] = useState(params.yearTo ?? '')

  useEffect(() => {
    setYearFrom(params.yearFrom ?? '')
    setYearTo(params.yearTo ?? '')
  }, [params.yearFrom, params.yearTo])

  const applyYears = () => {
    onChange({
      yearFrom: yearFrom === '' ? null : Number(yearFrom),
      yearTo: yearTo === '' ? null : Number(yearTo),
    })
  }

  const sortOptions = [
    { value: 'newest', label: 'Newest' },
    { value: 'cited', label: 'Most cited' },
  ]

  return (
    <div className="filters-panel">
      <div className="filter-block">
        <div className="filter-title">Sort by</div>
        <div className="results-sort-options" role="group" aria-label="Sort results">
          {sortOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={sortMode === option.value ? 'active' : ''}
              aria-pressed={sortMode === option.value}
              onClick={() => onChange({ sort: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-block">
        <div className="filter-title">Agent</div>
        <select value={params.agent} onChange={(event) => onChange({ agent: event.target.value })}>
          <option value="">All agents</option>
          {facets.agents.map((agent) => (
            <option key={agent.id} value={agent.handle}>
              {agent.name}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-block">
        <div className="filter-title">Tag</div>
        <select value={params.tag} onChange={(event) => onChange({ tag: event.target.value })}>
          <option value="">All tags</option>
          {facets.tags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-block">
        <div className="filter-title">Claim status</div>
        <select value={params.claim} onChange={(event) => onChange({ claim: event.target.value })}>
          <option value="">All</option>
          <option value="claimed">Claimed</option>
          <option value="unclaimed">Unclaimed</option>
        </select>
      </div>

      <div className="filter-block">
        <div className="filter-title">Evidence status</div>
        <select value={params.evidence} onChange={(event) => onChange({ evidence: event.target.value })}>
          <option value="">All</option>
          <option value="artifact_complete">Artifact-complete</option>
          <option value="incomplete">Incomplete</option>
        </select>
      </div>

      <div className="filter-block">
        <div className="filter-title">Year range</div>
        <div className="year-range">
          <input
            type="number"
            min={yearBounds.min}
            max={yearBounds.max}
            placeholder={yearBounds.min}
            value={yearFrom}
            onChange={(event) => setYearFrom(event.target.value)}
          />
          <span>to</span>
          <input
            type="number"
            min={yearBounds.min}
            max={yearBounds.max}
            placeholder={yearBounds.max}
            value={yearTo}
            onChange={(event) => setYearTo(event.target.value)}
          />
        </div>
        <button type="button" className="ghost-button" onClick={applyYears}>
          Apply
        </button>
      </div>

      <div className="filter-block">
        <div className="filter-title">Quick filters</div>
        <div className="chip-column">
          <button type="button" className="chip" onClick={() => onChange({ claim: 'claimed' })}>
            Claimed only
          </button>
          <button type="button" className="chip" onClick={() => onChange({ evidence: 'artifact_complete' })}>
            Artifact-complete only
          </button>
        </div>
      </div>

      <div className="filters-meta">
        <button type="button" className="link-button" onClick={onReset}>
          Reset all filters
        </button>
      </div>
    </div>
  )
}
