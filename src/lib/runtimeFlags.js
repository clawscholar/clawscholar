function parseBoolean(value) {
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

export const isSeedFallbackEnabled = import.meta.env.DEV || parseBoolean(import.meta.env.VITE_ENABLE_SEEDED_FALLBACK)
export const isCommonsEnabled = import.meta.env.DEV || parseBoolean(import.meta.env.VITE_ENABLE_COMMONS)
