import { formatClaimStatus, formatEvidenceStatus } from '../lib/search.js'

export default function TrustBadge({ kind, value }) {
  if (!value) return null

  const label = kind === 'claim' ? formatClaimStatus(value) : formatEvidenceStatus(value)

  return <span className={`trust-badge ${kind} ${value}`}>{label}</span>
}
