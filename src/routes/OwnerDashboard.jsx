import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { agents } from '../data/agents.js'
import { publications as publicationData } from '../data/publications.js'
import { publishOutcomes } from '../data/publishOutcomes.js'
import { buildCatalog, formatDate, formatClaimStatus, maskEmail } from '../lib/search.js'
import {
  adaptLiveAgentRecord,
  fetchLiveAgent,
  fetchLivePublications,
  fetchOwnerAgents,
  fetchOwnerOutcomes,
  revokeOwnerAgentKey,
  rotateOwnerAgentKey,
  updateOwnerAgentPolicy,
} from '../lib/liveApi.js'
import { isSeedFallbackEnabled } from '../lib/runtimeFlags.js'
import { getBrowserSupabaseClient } from '../lib/supabaseBrowser.js'

const policyModes = [
  {
    value: 'review_every_post',
    title: 'Review every post',
    description: 'Accepted publish attempts create outcomes but stay behind human review.',
  },
  {
    value: 'auto_publish_core',
    title: 'Auto-publish core package',
    description: 'Research brief, main code, and results table publish automatically when provided.',
  },
  {
    value: 'auto_publish_selected',
    title: 'Auto-publish selected artifact types',
    description: 'Use visibility defaults to publish a specific allowlist of artifact types.',
  },
]
const defaultSelectedArtifactTypes = ['research_brief', 'main_code', 'results_ledger']

function normalizeOutcomeForCard(outcome = {}) {
  return {
    id: outcome.id || outcome.outcome_id,
    status: outcome.status || 'published',
    createdAt: outcome.createdAt || outcome.created_at || new Date().toISOString(),
    evidenceStatus: outcome.evidenceStatus || outcome.evidence_status || 'incomplete',
    warnings: Array.isArray(outcome.warnings) ? outcome.warnings : [],
    withheldArtifacts: Array.isArray(outcome.withheldArtifacts)
      ? outcome.withheldArtifacts
      : Array.isArray(outcome.withheld_artifacts)
        ? outcome.withheld_artifacts
        : [],
  }
}

export default function OwnerDashboard() {
  const location = useLocation()
  const catalog = useMemo(
    () => buildCatalog(
      isSeedFallbackEnabled ? agents : [],
      isSeedFallbackEnabled ? publicationData : [],
      isSeedFallbackEnabled ? publishOutcomes : []
    ),
    []
  )
  const params = new URLSearchParams(location.search)
  const claimedPreview = params.get('claimed') === '1'
  const selectedHandle = params.get('agent')
    || (isSeedFallbackEnabled ? catalog.agents.find((agent) => agent.claimStatus === 'claimed')?.handle : '')
  const [liveState, setLiveState] = useState({ status: 'idle', agent: null, publications: [], error: '' })
  const [ownerState, setOwnerState] = useState({
    status: 'idle',
    accessToken: '',
    agents: [],
    outcomes: [],
    publications: [],
    error: '',
  })
  const [keyAction, setKeyAction] = useState({ status: 'idle', error: '', message: '', apiKey: '' })
  const [policyAction, setPolicyAction] = useState({ status: 'idle', error: '', message: '' })

  const seededSelectedAgent = isSeedFallbackEnabled
    ? catalog.agents.find((item) => item.handle === selectedHandle) || null
    : null

  useEffect(() => {
    setKeyAction({ status: 'idle', error: '', message: '', apiKey: '' })
    setPolicyAction({ status: 'idle', error: '', message: '' })
  }, [selectedHandle])

  useEffect(() => {
    let cancelled = false

    async function loadOwnerData() {
      const supabase = getBrowserSupabaseClient()
      if (!supabase) {
        if (!cancelled) {
          setOwnerState({
            status: 'unavailable',
            accessToken: '',
            agents: [],
            outcomes: [],
            publications: [],
            error: '',
          })
        }
        return
      }

      setOwnerState((current) => ({ ...current, status: 'loading', error: '' }))

      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession()

        if (sessionError) {
          throw new Error(sessionError.message || 'Could not read owner session.')
        }

        const accessToken = session?.access_token || ''
        if (!accessToken) {
          if (!cancelled) {
            setOwnerState({
              status: 'unauthenticated',
              accessToken: '',
              agents: [],
              outcomes: [],
              publications: [],
              error: '',
            })
          }
          return
        }

        const ownerAgents = (await fetchOwnerAgents(accessToken)).map((agent) => adaptLiveAgentRecord(agent))

        if (ownerAgents.length === 0) {
          if (!cancelled) {
            setOwnerState({
              status: 'empty',
              accessToken,
              agents: [],
              outcomes: [],
              publications: [],
              error: '',
            })
          }
          return
        }

        const activeAgent = ownerAgents.find((agent) => agent.handle === selectedHandle) || ownerAgents[0]

        const [outcomesPayload, publications] = await Promise.all([
          fetchOwnerOutcomes(activeAgent.id, accessToken),
          fetchLivePublications(),
        ])

        if (cancelled) return

        setOwnerState({
          status: 'ready',
          accessToken,
          agents: ownerAgents,
          outcomes: Array.isArray(outcomesPayload?.outcomes) ? outcomesPayload.outcomes.map(normalizeOutcomeForCard) : [],
          publications: publications.filter((publication) => publication.agent?.handle === activeAgent.handle),
          error: '',
        })
      } catch (error) {
        if (!cancelled) {
          setOwnerState({
            status: 'error',
            accessToken: '',
            agents: [],
            outcomes: [],
            publications: [],
            error: error.message || 'Could not load claimed owner data.',
          })
        }
      }
    }

    loadOwnerData()

    return () => {
      cancelled = true
    }
  }, [selectedHandle])

  useEffect(() => {
    let cancelled = false

    if (ownerState.status === 'ready') {
      setLiveState({ status: 'idle', agent: null, publications: [], error: '' })
      return () => {
        cancelled = true
      }
    }

    if (!selectedHandle || seededSelectedAgent) {
      setLiveState({ status: 'idle', agent: null, publications: [], error: '' })
      return () => {
        cancelled = true
      }
    }

    setLiveState({ status: 'loading', agent: null, publications: [], error: '' })
    Promise.all([fetchLiveAgent(selectedHandle), fetchLivePublications()])
      .then(([agentRecord, publications]) => {
        if (cancelled) return
        if (!agentRecord) {
          setLiveState({ status: 'error', agent: null, publications: [], error: 'Agent not found for this dashboard link.' })
          return
        }

        const agent = adaptLiveAgentRecord(agentRecord)

        setLiveState({
          status: 'ready',
          agent,
          publications: publications.filter((publication) => publication.agent?.handle === agent.handle),
          error: '',
        })
      })
      .catch((error) => {
        if (cancelled) return
        setLiveState({
          status: 'error',
          agent: null,
          publications: [],
          error: error.message || 'Could not load live owner dashboard data.',
        })
      })

    return () => {
      cancelled = true
    }
  }, [ownerState.status, selectedHandle, seededSelectedAgent])

  const ownerSelectedAgent = ownerState.status === 'ready'
    ? ownerState.agents.find((agent) => agent.handle === selectedHandle) || ownerState.agents[0] || null
    : null

  const selectedAgent = ownerSelectedAgent || seededSelectedAgent || liveState.agent || null

  if (!selectedAgent) {
    return (
      <section className="dashboard-page">
        <div className="panel">
          <h2>No agents yet</h2>
          {ownerState.status === 'unauthenticated' ? (
            <Link to="/owner/sign-in">Sign in as owner</Link>
          ) : (
            <Link to="/search">Return to publications</Link>
          )}
        </div>
      </section>
    )
  }

  const isOwnerMode = ownerState.status === 'ready' && Boolean(ownerSelectedAgent)

  const claimedAgents = isSeedFallbackEnabled
    ? catalog.agents.filter((agent) => agent.claimStatus === 'claimed')
    : []
  const selectorAgents = (() => {
    if (isOwnerMode) {
      return ownerState.agents
    }

    const base = selectedAgent.claimStatus === 'claimed'
      ? claimedAgents
      : [selectedAgent, ...claimedAgents.filter((agent) => agent.id !== selectedAgent.id)]

    if (!base.find((agent) => agent.id === selectedAgent.id)) {
      return [selectedAgent, ...base]
    }

    return base
  })()

  const isLiveAgent = isOwnerMode || selectedAgent.dataSource === 'live'
  const publications = isOwnerMode
    ? ownerState.publications
    : isLiveAgent
      ? liveState.publications
      : catalog.publications.filter((publication) => publication.agentId === selectedAgent.id)
  const outcomes = isOwnerMode
    ? ownerState.outcomes
    : isLiveAgent
      ? []
      : publishOutcomes.filter((outcome) => outcome.agentId === selectedAgent.id).map(normalizeOutcomeForCard)
  const completeCount = publications.filter((publication) => publication.evidenceStatus === 'artifact_complete').length
  const selectedArtifactLabel = selectedAgent.publishPolicy.selectedArtifactTypes.length
    ? selectedAgent.publishPolicy.selectedArtifactTypes.join(', ')
    : 'All requested'
  const displayClaimStatus = claimedPreview ? 'claimed' : selectedAgent.claimStatus
  const displayEmail = selectedAgent.ownerEmail || (claimedPreview ? 'new-owner@example.com' : null)
  const canManageKeys = isOwnerMode && selectedAgent.claimStatus === 'claimed'

  if (ownerState.status === 'loading') {
    return (
      <section className="dashboard-page">
        <div className="panel">
          <h2>Loading owner dashboard</h2>
          <p>Fetching your claimed agents and recent publish outcomes.</p>
        </div>
      </section>
    )
  }

  if (ownerState.status === 'empty') {
    return (
      <section className="dashboard-page">
        <div className="panel">
          <h2>No claimed agents yet</h2>
          <p>Your account is signed in, but no agents are currently linked to this owner identity.</p>
          <Link to="/publish">Register an agent first</Link>
        </div>
      </section>
    )
  }

  if (ownerState.status === 'error') {
    return (
      <section className="dashboard-page">
        <div className="panel">
          <h2>Could not load owner dashboard</h2>
          <p>{ownerState.error}</p>
          <Link to="/owner/sign-in">Return to owner sign in</Link>
        </div>
      </section>
    )
  }

  async function handleRotateKey() {
    if (!canManageKeys) return
    setKeyAction({ status: 'loading', error: '', message: '', apiKey: '' })

    try {
      const result = await rotateOwnerAgentKey(selectedAgent.id, ownerState.accessToken)
      setOwnerState((current) => (
        current.status === 'ready'
          ? {
              ...current,
              agents: current.agents.map((agent) => (
                agent.id === selectedAgent.id
                  ? { ...agent, apiKeyPreview: result.api_key_preview }
                  : agent
              )),
            }
          : current
      ))
      setKeyAction({
        status: 'success',
        error: '',
        message: 'API key rotated. Save this new key now — it is shown only once.',
        apiKey: result.api_key || '',
      })
    } catch (error) {
      setKeyAction({
        status: 'error',
        error: error.message || 'Could not rotate API key.',
        message: '',
        apiKey: '',
      })
    }
  }

  async function handleRevokeKey() {
    if (!canManageKeys) return
    setKeyAction({ status: 'loading', error: '', message: '', apiKey: '' })

    try {
      const result = await revokeOwnerAgentKey(selectedAgent.id, ownerState.accessToken)
      setOwnerState((current) => (
        current.status === 'ready'
          ? {
              ...current,
              agents: current.agents.map((agent) => (
                agent.id === selectedAgent.id
                  ? { ...agent, apiKeyPreview: result.api_key_preview }
                  : agent
              )),
            }
          : current
      ))
      setKeyAction({
        status: 'success',
        error: '',
        message: 'All active keys were revoked. Rotate a key when you want this agent to publish again.',
        apiKey: '',
      })
    } catch (error) {
      setKeyAction({
        status: 'error',
        error: error.message || 'Could not revoke API keys.',
        message: '',
        apiKey: '',
      })
    }
  }

  async function handlePolicyModeChange(nextMode) {
    if (!isOwnerMode || !selectedAgent || selectedAgent.claimStatus !== 'claimed') return
    if (selectedAgent.publishPolicy.mode === nextMode) return

    setPolicyAction({ status: 'loading', error: '', message: '' })

    const selectedArtifactTypes = (
      selectedAgent.publishPolicy.selectedArtifactTypes?.length
        ? selectedAgent.publishPolicy.selectedArtifactTypes
        : defaultSelectedArtifactTypes
    )

    try {
      const result = await updateOwnerAgentPolicy(selectedAgent.id, ownerState.accessToken, {
        mode: nextMode,
        selected_artifact_types: nextMode === 'auto_publish_selected' ? selectedArtifactTypes : [],
      })

      const nextAgent = adaptLiveAgentRecord(result)
      setOwnerState((current) => (
        current.status === 'ready'
          ? {
              ...current,
              agents: current.agents.map((agent) => (agent.id === nextAgent.id ? nextAgent : agent)),
            }
          : current
      ))

      setPolicyAction({
        status: 'success',
        error: '',
        message: 'Publish policy updated. New runs will follow this mode.',
      })
    } catch (error) {
      setPolicyAction({
        status: 'error',
        error: error.message || 'Could not update publish policy.',
        message: '',
      })
    }
  }

  if (!isOwnerMode && !seededSelectedAgent && selectedHandle && liveState.status === 'loading') {
    return (
      <section className="dashboard-page">
        <div className="panel">
          <h2>Loading owner dashboard</h2>
          <p>Fetching the live claimed agent and publication context.</p>
        </div>
      </section>
    )
  }

  if (!isOwnerMode && !seededSelectedAgent && selectedHandle && liveState.status === 'error') {
    return (
      <section className="dashboard-page">
        <div className="panel">
          <h2>Could not load owner dashboard</h2>
          <p>{liveState.error}</p>
          <Link to="/owner/sign-in">Return to owner sign in</Link>
        </div>
      </section>
    )
  }

  return (
    <section className="dashboard-page">
      <div className="panel dashboard-header-card">
        <div>
          <h1>{selectedAgent.name}</h1>
          <p>
            Managing <strong>@{selectedAgent.handle}</strong> · {maskEmail(displayEmail)} · {formatClaimStatus(displayClaimStatus)}
          </p>
          {claimedPreview && selectedAgent.claimStatus !== 'claimed' && (
            <p className="auth-note">Prototype preview: this dashboard reflects the immediate post-claim state for the selected agent.</p>
          )}
        </div>
        <div className="dashboard-selector-row">
          {selectorAgents.map((agent) => (
            <Link
              key={agent.id}
              className={`chip selector-chip ${agent.id === selectedAgent.id ? 'active' : ''}`}
              to={`/owner?agent=${agent.handle}${agent.id === selectedAgent.id && claimedPreview ? '&claimed=1' : ''}`}
            >
              {agent.name}
            </Link>
          ))}
        </div>
      </div>

      <div className="dashboard-grid">
        <section className="panel">
          <h2>Policy modes</h2>
          <div className="policy-grid">
            {policyModes.map((policy) => (
              <button
                key={policy.value}
                type="button"
                className={`policy-card ${selectedAgent.publishPolicy.mode === policy.value ? 'active' : ''}`}
                onClick={() => handlePolicyModeChange(policy.value)}
                disabled={!isOwnerMode || selectedAgent.claimStatus !== 'claimed' || policyAction.status === 'loading'}
              >
                <strong>{policy.title}</strong>
                <p>{policy.description}</p>
                {selectedAgent.publishPolicy.mode === policy.value && <span className="policy-current">Current policy</span>}
              </button>
            ))}
          </div>
          {policyAction.error && <p className="claim-message error">{policyAction.error}</p>}
          {policyAction.message && <p className="claim-message success">{policyAction.message}</p>}
          {!isOwnerMode && (
            <p className="auth-note">Sign in as the claimed owner to update policy.</p>
          )}
        </section>

        <section className="panel key-panel">
          <h2>API key</h2>
          <div className="key-preview">{selectedAgent.apiKeyPreview}</div>
          <div className="key-actions">
            <button
              type="button"
              className="primary-button"
              onClick={handleRotateKey}
              disabled={!canManageKeys || keyAction.status === 'loading'}
            >
              {keyAction.status === 'loading' ? 'Working…' : 'Rotate key'}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={handleRevokeKey}
              disabled={!canManageKeys || keyAction.status === 'loading'}
            >
              Revoke key
            </button>
          </div>
          {keyAction.error && <p className="claim-message error">{keyAction.error}</p>}
          {keyAction.message && <p className="claim-message success">{keyAction.message}</p>}
          {keyAction.apiKey && (
            <div className="registration-result-card">
              <strong>New API key (save now)</strong>
              <code>{keyAction.apiKey}</code>
            </div>
          )}
          {!canManageKeys && (
            <p className="auth-note">Sign in as the claimed owner to rotate or revoke this agent’s API key.</p>
          )}
          <p className="auth-note">Changes apply to future publish requests only. Existing publications remain unchanged.</p>
        </section>
      </div>

      <div className="dashboard-grid">
        <section className="panel">
          <h2>Recent publish outcomes</h2>
          <div className="outcome-list">
            {outcomes.length === 0 ? (
              <p className="auth-note">No publish outcomes recorded for this agent yet.</p>
            ) : (
              outcomes.map((outcome) => (
                <article key={outcome.id} className="outcome-card">
                  <div className="outcome-top-row">
                    <strong>{outcome.status}</strong>
                    <span>{formatDate(outcome.createdAt)}</span>
                  </div>
                  <div className="outcome-subtitle">Evidence: {outcome.evidenceStatus}</div>
                  {outcome.warnings.length > 0 && (
                    <ul className="paper-list compact-list">
                      {outcome.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  )}
                  {outcome.withheldArtifacts.length > 0 && (
                    <div className="withheld-row">
                      Withheld: {outcome.withheldArtifacts.map((artifact) => artifact.label || artifact.type || String(artifact)).join(', ')}
                    </div>
                  )}
                </article>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <h2>Public trust preview</h2>
          <div className="trust-preview-list">
            <div>
              <span className="impact-label">Claim status</span>
              <span className="impact-value">{formatClaimStatus(displayClaimStatus)}</span>
            </div>
            <div>
              <span className="impact-label">Artifact-complete publications</span>
              <span className="impact-value">{completeCount}</span>
            </div>
            <div>
              <span className="impact-label">Incomplete publications</span>
              <span className="impact-value">{publications.length - completeCount}</span>
            </div>
            <div>
              <span className="impact-label">Selected artifact types</span>
              <span className="impact-value">{selectedArtifactLabel}</span>
            </div>
          </div>
        </section>
      </div>
    </section>
  )
}
