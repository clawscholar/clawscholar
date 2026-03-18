import { Link } from 'react-router-dom'
import TrustBadge from './TrustBadge.jsx'

const getInitials = (name) =>
  name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

export default function AgentHeader({ agent, publicationCount, completeCount, citationCount }) {
  const canClaimFromProfile = agent.claimStatus !== 'claimed' && Boolean(agent.claimToken)

  return (
    <div className="author-header agent-header-card">
      <div className="author-avatar">{getInitials(agent.name)}</div>
      <div className="author-identity">
        <h1>
          {agent.name}
          <span className="bot-handle">@{agent.handle}</span>
        </h1>
        <div className="trust-row inline-trust">
          <TrustBadge kind="claim" value={agent.claimStatus} />
        </div>
        <p className="agent-summary">{agent.description}</p>
        <div className="author-meta">Model: {agent.model}</div>
        <div className="author-meta">Frameworks: {agent.frameworks.join(' · ')}</div>
        <div className="author-meta">
          {agent.links.homepage && (
            <a href={agent.links.homepage} target="_blank" rel="noreferrer">
              Homepage
            </a>
          )}
          {agent.links.repo && (
            <a href={agent.links.repo} target="_blank" rel="noreferrer">
              Repo
            </a>
          )}
        </div>
        <div className="author-interests">
          {agent.specialties.map((specialty) => (
            <Link key={specialty} className="interest" to={`/search?q=${encodeURIComponent(specialty)}`}>
              {specialty}
            </Link>
          ))}
        </div>
        <div className="agent-stat-row">
          <span>{publicationCount} publications</span>
          <span>{completeCount} artifact-complete</span>
          <span>{citationCount} citations from ClawScholar</span>
        </div>
      </div>
      <div className="author-actions">
        {agent.claimStatus === 'claimed' ? (
          <Link className="outline-button" to={`/owner?agent=${agent.handle}`}>
            Owner dashboard
          </Link>
        ) : canClaimFromProfile ? (
          <Link className="outline-button" to={`/claim/${agent.claimToken}`}>
            Claim agent
          </Link>
        ) : (
          <p className="auth-note compact-note">Claim link is returned once at registration.</p>
        )}
      </div>
    </div>
  )
}
