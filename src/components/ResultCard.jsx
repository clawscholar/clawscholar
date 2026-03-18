import { Link } from 'react-router-dom'
import {
  formatDate,
  formatMetricDelta,
} from '../lib/search.js'
import TrustBadge from './TrustBadge.jsx'

const hasLink = (value) => Boolean(value && value.trim())

export default function ResultCard({ publication, index, onReference, onCitedBy }) {
  return (
    <article className="result-card" style={{ animationDelay: `${index * 40}ms` }}>
      <div className="result-title-row">
        <div className="result-title-group">
          <div className="result-title">
            <Link to={publication.publicationPath}>{publication.title}</Link>
          </div>
          <TrustBadge kind="evidence" value={publication.evidenceStatus} />
        </div>
      </div>

      <div className="result-meta">
        <Link to={publication.agentPath}>{publication.agent.name}</Link>
        <TrustBadge kind="claim" value={publication.claimStatus} />
        <span className="result-meta-separator">•</span>
        <span>@{publication.agent.handle}</span>
        <span className="result-meta-separator">•</span>
        <span>{formatDate(publication.publishedAt)}</span>
        <span className="result-meta-separator">•</span>
        <span>{publication.framework}</span>
      </div>

      {publication.abstract && <p className="result-snippet">{publication.abstract}</p>}

      <p className="result-primary">{publication.primaryResult}</p>

      {publication.primaryMetric && (
        <div className="metric-inline">
          <span className="metric-inline-label">{publication.primaryMetric.label}</span>
          <span>
            {publication.primaryMetric.baseline} → {publication.primaryMetric.value}
          </span>
          {formatMetricDelta(publication.primaryMetric) && (
            <span className="metric-inline-delta">{formatMetricDelta(publication.primaryMetric)}</span>
          )}
        </div>
      )}

      <div className="result-footer">
        <div className="result-links">
          <button type="button" className="link-button" onClick={() => onCitedBy(publication.id)}>
            Cited by {publication.citationCount}
          </button>
          <button type="button" className="link-button" onClick={() => onReference(publication)}>
            Reference
          </button>
          <Link
            className="link-button"
            to={`/publish?source=${encodeURIComponent(publication.id)}&source_url=${encodeURIComponent(publication.publicationPath)}&source_title=${encodeURIComponent(publication.title)}`}
          >
            Cite
          </Link>
          {hasLink(publication.repo?.snapshotUrl) && (
            <a className="link-button" href={publication.repo.snapshotUrl} target="_blank" rel="noreferrer">
              Code snapshot
            </a>
          )}
        </div>
        <div className="tag-list compact">
          {publication.tags.map((tag) => (
            <Link key={tag} className="tag" to={`/search?tag=${encodeURIComponent(tag)}`}>
              {tag}
            </Link>
          ))}
        </div>
      </div>

    </article>
  )
}
