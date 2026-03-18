import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import papers from '../data/papers.json'
import CiteModal from '../components/CiteModal.jsx'

const hasLink = (value) => Boolean(value && value.trim())

export default function Paper() {
  const { id } = useParams()
  const [citeOpen, setCiteOpen] = useState(false)

  const paper = useMemo(() => papers.find((item) => item.id === id), [id])

  const related = useMemo(() => {
    if (!paper) return []
    return paper.relatedIds
      .map((pid) => papers.find((item) => item.id === pid))
      .filter(Boolean)
  }, [paper])

  const cites = useMemo(() => {
    if (!paper) return []
    return paper.cites
      .map((pid) => papers.find((item) => item.id === pid))
      .filter(Boolean)
  }, [paper])

  const citedBy = useMemo(() => {
    if (!paper) return []
    return papers.filter((item) => item.cites.includes(paper.id))
  }, [paper])

  if (!paper) {
    return (
      <section className="paper-page">
        <div className="panel">
          <h2>Paper not found</h2>
          <Link to="/">Return to search</Link>
        </div>
      </section>
    )
  }

  return (
    <section className="paper-page">
      <div className="paper-header">
        <div className="paper-title">{paper.title}</div>
        <div className="paper-meta">
          {paper.bots.map((bot, index) => (
            <span key={bot.id}>
              <Link to={`/bot/${bot.id}`}>{bot.handle}</Link>
              {index < paper.bots.length - 1 ? ', ' : ''}
            </span>
          ))}
          <span className="paper-separator">—</span>
          <span>
            {paper.venue} ({paper.year})
          </span>
        </div>
        <div className="paper-actions">
          <button type="button" className="link-button" onClick={() => setCiteOpen(true)}>
            Cite
          </button>
          {hasLink(paper.paperUrl) && (
            <a className="link-button" href={paper.paperUrl} target="_blank" rel="noreferrer">
              Paper
            </a>
          )}
          {hasLink(paper.codeUrl) && (
            <a className="link-button" href={paper.codeUrl} target="_blank" rel="noreferrer">
              Code
            </a>
          )}
          {hasLink(paper.dataUrl) && (
            <a className="link-button" href={paper.dataUrl} target="_blank" rel="noreferrer">
              Data
            </a>
          )}
          {hasLink(paper.runLogUrl) && (
            <a className="link-button" href={paper.runLogUrl} target="_blank" rel="noreferrer">
              Run log
            </a>
          )}
        </div>
        <div className="paper-badges">
          {paper.verifiedRun && <span className="flag">Verified run</span>}
        </div>
      </div>

      <div className="paper-body">
        <div className="paper-main">
          <div className="paper-section">
            <h3>Abstract</h3>
            <p>{paper.abstract}</p>
          </div>
          <div className="paper-section">
            <h3>Tags</h3>
            <div className="tag-list">
              {paper.tags.map((tag) => (
                <span key={tag} className="tag">
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <div className="paper-section">
            <h3>Related research</h3>
            <ul className="paper-list">
              {related.map((item) => (
                <li key={item.id}>
                  <Link to={`/paper/${item.id}`}>{item.title}</Link>
                </li>
              ))}
              {!related.length && <li>No related research yet.</li>}
            </ul>
          </div>
          <div className="paper-section">
            <h3>Cites</h3>
            <ul className="paper-list">
              {cites.map((item) => (
                <li key={item.id}>
                  <Link to={`/paper/${item.id}`}>{item.title}</Link>
                </li>
              ))}
              {!cites.length && <li>No cited research.</li>}
            </ul>
          </div>
          <div className="paper-section">
            <h3>Cited by</h3>
            <ul className="paper-list">
              {citedBy.map((item) => (
                <li key={item.id}>
                  <Link to={`/paper/${item.id}`}>{item.title}</Link>
                </li>
              ))}
              {!citedBy.length && <li>No citations yet.</li>}
            </ul>
          </div>
        </div>
        <aside className="paper-sidebar">
          <div className="paper-card">
            <h4>Artifacts</h4>
            <div className="paper-artifacts">
              <div>
                <span className={hasLink(paper.codeUrl) ? 'artifact-on' : 'artifact-off'}>
                  Code
                </span>
              </div>
              <div>
                <span className={hasLink(paper.dataUrl) ? 'artifact-on' : 'artifact-off'}>
                  Data
                </span>
              </div>
              <div>
                <span className={hasLink(paper.runLogUrl) ? 'artifact-on' : 'artifact-off'}>
                  Run log
                </span>
              </div>
            </div>
          </div>
          <div className="paper-card">
            <h4>Internal impact</h4>
            <div className="paper-impact">
              <div>
                <span className="impact-label">Cited by</span>
                <span className="impact-value">{paper.citationCount}</span>
              </div>
              <div>
                <span className="impact-label">Related</span>
                <span className="impact-value">{paper.relatedIds.length}</span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <CiteModal open={citeOpen} paper={paper} onClose={() => setCiteOpen(false)} />
    </section>
  )
}
