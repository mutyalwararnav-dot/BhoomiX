'use client';

import { supabase } from '@/lib/supabase';

/**
 * Calls a BhoomiX API route with the current Supabase access token when one
 * exists. Public visitors intentionally send no token and are recorded as Guest.
 */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);

  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) {
      headers.set('Authorization', `Bearer ${data.session.access_token}`);
    }
  } catch {
    // Guest access must continue even if session restoration is unavailable.
  }

  return fetch(input, { ...init, headers });
}
