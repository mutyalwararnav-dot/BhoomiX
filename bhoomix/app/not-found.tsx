import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0B0F1A] px-6 text-center text-slate-100">
      <div>
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-violet-400">404 · BhoomiX</p>
        <h1 className="text-3xl font-semibold">Page not found</h1>
        <p className="mt-3 text-slate-400">The requested page does not exist.</p>
        <Link className="mt-6 inline-block rounded-lg bg-violet-600 px-5 py-2.5 font-medium text-white hover:bg-violet-500" href="/">
          Return to dashboard
        </Link>
      </div>
    </main>
  );
}
