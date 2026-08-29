import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase-server';

export const GUEST_ACTOR = 'Guest';
export type AppRole = 'admin' | 'surveyor' | 'reviewer';

export interface RequestPrincipal {
  actor: string;
  userId: string | null;
  role: AppRole | 'guest';
}

/**
 * Resolves a trustworthy workflow identity from a bearer token. A missing or
 * invalid token is deliberately treated as a public Guest instead of blocking
 * the request because BhoomiX supports open access.
 */
export async function resolveRequestPrincipal(request: Request): Promise<RequestPrincipal> {
  const authorization = request.headers.get('authorization');
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) return { actor: GUEST_ACTOR, userId: null, role: 'guest' };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return { actor: GUEST_ACTOR, userId: null, role: 'guest' };

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await authClient.auth.getUser(match[1]);
  if (error || !data.user) return { actor: GUEST_ACTOR, userId: null, role: 'guest' };

  const { data: profile } = await supabaseServer
    .from('profiles')
    .select('display_name,role')
    .eq('id', data.user.id)
    .maybeSingle();

  const displayName = profile?.display_name ?? data.user.user_metadata?.display_name;
  const profileRole = profile?.role;
  const role: AppRole = typeof profileRole === 'string' && ['admin', 'surveyor', 'reviewer'].includes(profileRole)
    ? profileRole as AppRole
    : 'reviewer';
  if (typeof displayName === 'string' && displayName.trim()) {
    return { actor: displayName.trim().slice(0, 120), userId: data.user.id, role };
  }

  return { actor: `User ${data.user.id.slice(0, 8)}`, userId: data.user.id, role };
}

export async function resolveRequestActor(request: Request): Promise<string> {
  return (await resolveRequestPrincipal(request)).actor;
}
