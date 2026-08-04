import { createClient } from '@supabase/supabase-js'

export function isSupabaseConfigured() {
  const configured = (value) => typeof value === 'string' && value.length > 0 && !/(your[-_]|placeholder|example\.com)/i.test(value)
  return configured(process.env.SUPABASE_URL) && configured(process.env.SUPABASE_SERVICE_ROLE_KEY)
}

// This client is server-only. Never import this module into the Vite/React app.
export function createSupabaseAdminClient() {
  if (!isSupabaseConfigured()) throw new Error('Supabase is not configured.')

  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
}
