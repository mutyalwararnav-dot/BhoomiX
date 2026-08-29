'use client';

import { AlertCircle, Eye, EyeOff, Loader2, LockKeyhole, MapPinned } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { supabase } from '@/lib/supabase';

function LoginForm() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!loading && user) router.replace('/');
  }, [loading, router, user]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    setSuccess('');

    if (mode === 'signup') {
      if (password.length < 8) {
        setError('Password must contain at least 8 characters.');
        setSubmitting(false);
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        setSubmitting(false);
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { display_name: displayName.trim() },
          emailRedirectTo: `${window.location.origin}/login`,
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        setSubmitting(false);
        return;
      }

      if (!data.session) {
        setSuccess('Account created. Check your email to confirm it, then sign in.');
        setPassword('');
        setConfirmPassword('');
        setSubmitting(false);
        return;
      }

      router.replace('/');
      router.refresh();
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(signInError.message === 'Invalid login credentials'
        ? 'Email or password is incorrect.'
        : signInError.message);
      setSubmitting(false);
      return;
    }

    const requestedPath = searchParams.get('next');
    const destination = requestedPath?.startsWith('/') && !requestedPath.startsWith('//')
      ? requestedPath
      : '/';
    router.replace(destination);
    router.refresh();
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-auto bg-[#070B14] px-5 py-10 text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(79,70,229,0.18),transparent_35%),radial-gradient(circle_at_80%_85%,rgba(16,185,129,0.10),transparent_30%)]" />
      <div className="relative grid w-full max-w-4xl overflow-hidden rounded-3xl border border-slate-800 bg-slate-950/90 shadow-2xl shadow-black/40 md:grid-cols-[1.05fr_0.95fr]">
        <section className="hidden border-r border-slate-800 bg-slate-900/55 p-10 md:flex md:flex-col md:justify-between">
          <div>
            <div className="mb-10 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-lg shadow-indigo-950">
                <MapPinned className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-wide">BhoomiX</h1>
                <p className="text-xs text-slate-400">AI-assisted cadastral intelligence</p>
              </div>
            </div>
            <h2 className="max-w-sm text-3xl font-semibold leading-tight text-white">
              Review land boundaries with confidence.
            </h2>
            <p className="mt-4 max-w-sm text-sm leading-6 text-slate-400">
              Secure access for surveyors, reviewers, and administrators working with cadastral parcel data.
            </p>
          </div>
          <p className="text-xs text-slate-600">BhoomiX Surveyor Triage Workspace</p>
        </section>

        <section className="p-7 sm:p-10">
          <div className="mb-8 md:hidden">
            <div className="flex items-center gap-3">
              <MapPinned className="h-7 w-7 text-indigo-400" />
              <h1 className="text-xl font-bold">BhoomiX</h1>
            </div>
          </div>
          <div className="mb-7">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-indigo-400/20 bg-indigo-500/10 text-indigo-300">
              <LockKeyhole className="h-5 w-5" />
            </div>
            <h2 className="text-2xl font-semibold text-white">
              {mode === 'signin' ? 'Welcome back' : 'Create your account'}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              {mode === 'signin'
                ? 'Sign in to save your identity with your work.'
                : 'Sign up free to create your BhoomiX identity.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {mode === 'signup' && (
              <div>
                <label htmlFor="display-name" className="mb-2 block text-xs font-semibold text-slate-300">Display name</label>
                <input
                  id="display-name"
                  type="text"
                  autoComplete="name"
                  required
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Your name"
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            )}
            <div>
              <label htmlFor="email" className="mb-2 block text-xs font-semibold text-slate-300">Email address</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@department.gov.in"
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-2 block text-xs font-semibold text-slate-300">Password</label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  required
                  minLength={mode === 'signup' ? 8 : undefined}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 pr-11 text-sm text-white outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:text-slate-300"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {mode === 'signup' && (
              <div>
                <label htmlFor="confirm-password" className="mb-2 block text-xs font-semibold text-slate-300">Confirm password</label>
                <input
                  id="confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            )}

            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-200">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div role="status" className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2.5 text-xs leading-5 text-emerald-200">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-950/50 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting
                ? (mode === 'signin' ? 'Signing in...' : 'Creating account...')
                : (mode === 'signin' ? 'Sign in securely' : 'Create free account')}
            </button>
          </form>

          <div className="mt-6 space-y-3 text-center text-xs">
            <button
              type="button"
              onClick={() => {
                setMode((current) => current === 'signin' ? 'signup' : 'signin');
                setError('');
                setSuccess('');
              }}
              className="font-semibold text-indigo-300 hover:text-indigo-200"
            >
              {mode === 'signin'
                ? "Don't have an account? Sign up free"
                : 'Already have an account? Sign in'}
            </button>
            <div className="flex items-center gap-3 text-slate-700">
              <span className="h-px flex-1 bg-slate-800" />
              <span className="text-slate-500">or</span>
              <span className="h-px flex-1 bg-slate-800" />
            </div>
            <Link href="/" className="inline-block font-semibold text-slate-400 hover:text-white">
              Continue without login
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="h-screen w-screen bg-[#070B14]" />}>
      <LoginForm />
    </Suspense>
  );
}
