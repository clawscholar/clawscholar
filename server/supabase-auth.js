import { createClient } from '@supabase/supabase-js'
import { assertSupabaseAuthConfig } from './config.js'

function trimText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function buildClaimMagicLinkRedirectUrl(config, attemptId) {
  const safeAttemptId = trimText(attemptId)
  return `${config.appBaseUrl}/owner/auth/callback?attempt_id=${encodeURIComponent(safeAttemptId)}`
}

export function buildOwnerSignInRedirectUrl(config) {
  return `${config.appBaseUrl}/owner/auth/callback?mode=sign_in`
}

function createServerSupabaseClient(config) {
  const runtimeConfig = assertSupabaseAuthConfig(config)

  return createClient(runtimeConfig.supabaseUrl, runtimeConfig.supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })
}

export function mapMagicLinkError(error) {
  const status = Number(error?.status)
  const code = trimText(error?.code)
  const message = trimText(error?.message)

  if (status === 429 || code === 'over_email_send_rate_limit') {
    return {
      status: 429,
      error: 'Verification link rate limit exceeded. Please wait and try again.',
    }
  }

  if (status >= 400 && status < 500) {
    return {
      status,
      error: message || 'Could not send verification link.',
    }
  }

  return {
    status: 502,
    error: 'Could not send verification link right now. Please try again shortly.',
  }
}

export function createSupabaseAuth(config) {
  return {
    async sendClaimMagicLink({ email, attemptId, redirectTo }) {
      const client = createServerSupabaseClient(config)
      const resolvedRedirectTo = redirectTo || buildClaimMagicLinkRedirectUrl(config, attemptId)
      const { error } = await client.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: resolvedRedirectTo,
          shouldCreateUser: true,
        },
      })

      if (error) {
        throw error
      }

      return { redirectTo: resolvedRedirectTo }
    },

    async sendOwnerSignInMagicLink({ email, redirectTo }) {
      const client = createServerSupabaseClient(config)
      const resolvedRedirectTo = redirectTo || buildOwnerSignInRedirectUrl(config)
      const { error } = await client.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: resolvedRedirectTo,
          shouldCreateUser: false,
        },
      })

      if (error) {
        throw error
      }

      return { redirectTo: resolvedRedirectTo }
    },

    async verifyAccessToken(accessToken) {
      const token = trimText(accessToken)
      if (!token) {
        return null
      }

      const client = createServerSupabaseClient(config)
      const { data, error } = await client.auth.getUser(token)

      if (error || !data?.user?.id || !data?.user?.email) {
        return null
      }

      return {
        id: data.user.id,
        email: data.user.email,
      }
    },
  }
}
