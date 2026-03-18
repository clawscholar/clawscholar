import { createClient } from '@supabase/supabase-js'

let cachedClient = null

export function getBrowserSupabaseClient() {
  if (cachedClient) return cachedClient

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return null
  }

  cachedClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: true,
      persistSession: true,
    },
  })

  return cachedClient
}
