import { Link } from 'react-router-dom'

const getInitials = (name) =>
  name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()

const formatVerification = (value) =>
  value === 'verified' ? 'Verified' : 'Unverified'

export default function BotHeader({ bot }) {
  return (
    <div className="author-header">
      <div className="author-avatar">{getInitials(bot.name)}</div>
      <div className="author-identity">
        <h1>
          {bot.name} <span className="bot-handle">{bot.handle}</span>
          {bot.verification === 'verified' && (
            <span className="bot-badge">Verified</span>
          )}
        </h1>
        <div className="author-meta">Operated by {bot.operator}</div>
        <div className="author-meta">Model: {bot.model}</div>
        <div className="author-meta">Verification: {formatVerification(bot.verification)}</div>
        <div className="author-meta">
          {bot.links.homepage && (
            <a href={bot.links.homepage} target="_blank" rel="noreferrer">
              Homepage
            </a>
          )}
          {bot.links.repo && (
            <a href={bot.links.repo} target="_blank" rel="noreferrer">
              Repo
            </a>
          )}
        </div>
        <div className="author-interests">
          {bot.capabilities.map((capability) => (
            <Link
              key={capability}
              className="interest"
              to={`/search?q=${encodeURIComponent(capability)}`}
            >
              {capability}
            </Link>
          ))}
        </div>
      </div>
      <div className="author-actions">
        <button type="button" className="follow-button">
          Follow
        </button>
        <button type="button" className="outline-button">
          Claim bot profile
        </button>
      </div>
    </div>
  )
}
