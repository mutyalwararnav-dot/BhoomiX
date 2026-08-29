import 'server-only';

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const fallbackAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!serviceRoleKey) {
  console.warn('[BhoomiX] SUPABASE_SERVICE_ROLE_KEY is not configured; server APIs are using the anon key.');
}

/** Server-only database client. The service key is never included in browser code. */
export const supabaseServer = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  serviceRoleKey || fallbackAnonKey || 'placeholder-anon-key',
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  },
);

export function isServiceRoleConfigured() {
  return Boolean(supabaseUrl && serviceRoleKey);
}
