'use client';

import type { Session, User } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { supabase } from '@/lib/supabase';

export type UserRole = 'admin' | 'surveyor' | 'reviewer';

export interface UserProfile {
  id: string;
  email: string | null;
  display_name: string | null;
  role: UserRole;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function fallbackProfile(user: User): UserProfile {
  return {
    id: user.id,
    email: user.email ?? null,
    display_name:
      typeof user.user_metadata?.display_name === 'string'
        ? user.user_metadata.display_name
        : null,
    role: 'reviewer',
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [storedProfile, setStoredProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) console.warn('[BhoomiX Auth] Could not restore session:', error.message);
      setSession(data.session ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const user = session?.user;
    if (!user) return;

    let active = true;

    void supabase
      .from('profiles')
      .select('id,email,display_name,role')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.warn('[BhoomiX Auth] Profile unavailable; using reviewer defaults:', error.message);
          return;
        }
        if (data) setStoredProfile(data as UserProfile);
      });

    return () => {
      active = false;
    };
  }, [session?.user]);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setSession(null);
    setStoredProfile(null);
  }, []);

  const profile = useMemo(() => {
    const user = session?.user;
    if (!user) return null;
    return storedProfile?.id === user.id ? storedProfile : fallbackProfile(user);
  }, [session?.user, storedProfile]);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    user: session?.user ?? null,
    profile,
    loading,
    signOut,
  }), [session, profile, loading, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
