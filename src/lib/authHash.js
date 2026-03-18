function normalizeDescription(value = '') {
  if (!value) return ''
  return value.replace(/\+/g, ' ').trim()
}

function messageFromCode(code, fallback) {
  if (code === 'otp_expired') {
    return 'This email link expired or was already used. Request a fresh claim link and open it right away.'
  }

  if (code === 'access_denied') {
    return 'This claim link could not be verified. Request a fresh claim link and try again.'
  }

  return fallback || 'This verification-link session could not be completed.'
}

export function parseAuthHashError(hashValue = '') {
  if (!hashValue || !hashValue.startsWith('#')) return null

  const params = new URLSearchParams(hashValue.slice(1))
  const error = params.get('error') || ''
  const code = params.get('error_code') || ''
  const description = normalizeDescription(params.get('error_description') || '')

  if (!error && !code && !description) return null

  return {
    error,
    code,
    description,
    message: messageFromCode(code || error, description),
  }
}
