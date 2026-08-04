import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// Used only for authenticated portal features. This client intentionally
// accepts only the browser-safe publishable key, never a service-role key.
export const supabase = url && publishableKey
  ? createClient(url, publishableKey)
  : null
