import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { completeLiveClaimCallback, fetchOwnerAgents } from '../lib/liveApi.js'
import { getBrowserSupabaseClient } from '../lib/supabaseBrowser.js'

async function getAccessTokenFromSupabase() {
  const supabase = getBrowserSupabaseClient()
  if (!supabase) {
    return { accessToken: '', error: 'Supabase browser auth is not configured in this environment.' }
  }

  const {
    data: { session },
    error,
  } = await supabase.auth.getSession()

  if (error) {
    return { accessToken: '', error: error.message || 'Could not read the Supabase session from this verification link.' }
  }

  return { accessToken: session?.access_token || '', error: '' }
}

export default function OwnerAuthCallback() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [state, setState] = useState({ status: 'loading', title: 'Completing sign in', error: '' })

  useEffect(() => {
    let cancelled = false

    async function completeCallback() {
      const attemptId = searchParams.get('attempt_id') || ''
      const { accessToken, error } = await getAccessTokenFromSupabase()

      if (error) {
        setState({ status: 'error', title: 'Could not complete sign in', error })
        return
      }

      if (!accessToken) {
        setState({
          status: 'error',
          title: 'Could not complete sign in',
          error: 'This verification-link session is missing an access token. Open the email link in the same browser tab.',
        })
        return
      }

      try {
        if (attemptId) {
          const result = await completeLiveClaimCallback({ attemptId, accessToken })
          if (cancelled) return

          setState({ status: 'success', title: 'Claim complete', error: '' })
          navigate(result.redirect_to || '/owner', { replace: true })
          return
        }

        const ownerAgents = await fetchOwnerAgents(accessToken)
        if (cancelled) return

        const firstAgent = ownerAgents[0]
        if (!firstAgent?.handle) {
          setState({
            status: 'error',
            title: 'No claimed agents yet',
            error: 'This email is signed in, but no claimed agents are linked yet.',
          })
          return
        }

        setState({ status: 'success', title: 'Sign in complete', error: '' })
        navigate(`/owner?agent=${encodeURIComponent(firstAgent.handle)}`, { replace: true })
      } catch (callbackError) {
        if (cancelled) return
        setState({
          status: 'error',
          title: 'Could not complete sign in',
          error: callbackError.message || 'Something went wrong while finishing this callback.',
        })
      }
    }

    completeCallback()

    return () => {
      cancelled = true
    }
  }, [navigate, searchParams])

  if (state.status === 'loading') {
    return (
      <section className="claim-page">
        <div className="panel live-state-panel">
          <h2>{state.title}</h2>
          <p>Verifying your verification-link session and opening your owner dashboard.</p>
        </div>
      </section>
    )
  }

  if (state.status === 'success') {
    return (
      <section className="claim-page">
        <div className="panel live-state-panel">
          <h2>{state.title}</h2>
          <p>Redirecting you to your owner dashboard.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="claim-page">
      <div className="panel live-state-panel">
        <h2>{state.title}</h2>
        <p>{state.error || 'Something went wrong while finishing this callback.'}</p>
        <Link to="/owner/sign-in">Return to owner sign in</Link>
      </div>
    </section>
  )
}
