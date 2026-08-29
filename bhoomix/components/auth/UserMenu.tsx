'use client';

import { LogOut, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from './AuthProvider';

const ROLE_LABELS = {
  admin: 'Admin',
  surveyor: 'Surveyor',
  reviewer: 'Reviewer',
} as const;

export default function UserMenu() {
  const { user, profile, signOut } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (!user) {
    return (
      <Link
        href="/login"
        className="flex items-center gap-2 rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold text-indigo-200 transition-colors hover:bg-indigo-500/20"
      >
        <UserRound className="h-3.5 w-3.5" />
        Sign in
      </Link>
    );
  }

  const name = profile?.display_name?.trim() || user.email?.split('@')[0] || 'BhoomiX user';
  const role = profile?.role ?? 'surveyor';

  const handleSignOut = async () => {
    setBusy(true);
    try {
      await signOut();
      router.replace('/login');
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 border-r border-slate-700 pr-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-400/30 bg-indigo-500/10 text-indigo-300">
        <UserRound className="h-4 w-4" />
      </div>
      <div className="hidden min-w-0 lg:block">
        <p className="max-w-28 truncate text-[11px] font-semibold text-slate-100">{name}</p>
        <p className="text-[9px] font-bold uppercase tracking-wider text-indigo-300">{ROLE_LABELS[role]}</p>
      </div>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={busy}
        title="Sign out"
        aria-label="Sign out"
        className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-rose-300 disabled:opacity-50"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}
