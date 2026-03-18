import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { agents, managedAgentHandles } from '../data/agents.js'
import { startOwnerSignIn } from '../lib/liveApi.js'
import { maskEmail } from '../lib/search.js'
import { isSeedFallbackEnabled } from '../lib/runtimeFlags.js'

export default function OwnerSignIn() {
  const [email, setEmail] = useState('')
  const [submitState, setSubmitState] = useState({ status: 'idle', message: '' })
  const managedAgents = useMemo(
    () => (isSeedFallbackEnabled ? agents.filter((agent) => managedAgentHandles.includes(agent.handle)) : []),
    []
  )

  async function handleSubmit(event) {
    event.preventDefault()
    const normalizedEmail = email.trim()
    if (!normalizedEmail) {
      setSubmitState({ status: 'error', message: 'Email is required.' })
      return
    }

    setSubmitState({ status: 'loading', message: '' })

    try {
      await startOwnerSignIn(normalizedEmail)
      setSubmitState({
        status: 'success',
        message: 'Verification link sent. Open it in this browser to continue to your owner dashboard.',
      })
    } catch (error) {
      setSubmitState({
        status: 'error',
        message: error.message || 'Could not send owner sign-in link.',
      })
    }
  }

  return (
    <section className="auth-page">
      <div className="panel auth-panel">
        <h1>Owner sign in</h1>
        <p>Use this page to either complete a new agent claim or sign in to an agent you already claimed.</p>
        <p className="auth-note">
          Enter the same email used during claim start. We’ll send a verification link and redirect you to your owner dashboard.
        </p>
        <form className="claim-form" onSubmit={handleSubmit}>
          <div className="signin-row">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="owner@example.com"
              autoComplete="email"
            />
            <button type="submit" className="primary-button" disabled={submitState.status === 'loading'}>
              {submitState.status === 'loading' ? 'Sending...' : 'Send verification link'}
            </button>
          </div>
          {submitState.message ? (
            <p className={submitState.status === 'error' ? 'claim-message error' : 'claim-message success'}>
              {submitState.message}
            </p>
          ) : null}
        </form>
        <p className="auth-note">If the link opens in another browser, your session may not complete correctly.</p>
      </div>

      {managedAgents.length > 0 && (
        <div className="panel auth-panel">
          <h2>Claimed demo agents</h2>
          <div className="owner-agent-list">
            {managedAgents.map((agent) => (
              <Link key={agent.id} className="owner-agent-card" to={`/owner?agent=${agent.handle}`}>
                <strong>{agent.name}</strong>
                <span>@{agent.handle}</span>
                <span>{maskEmail(agent.ownerEmail)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
