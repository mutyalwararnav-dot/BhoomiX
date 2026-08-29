'use client';

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-[#0B0F1A] px-6 text-slate-100">
        <main className="max-w-md text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-violet-400">BhoomiX</p>
          <h1 className="text-3xl font-semibold">Something went wrong</h1>
          <p className="mt-3 text-slate-400">The dashboard could not finish loading. Your saved parcel data has not been changed.</p>
          <button
            type="button"
            onClick={reset}
            className="mt-6 rounded-lg bg-violet-600 px-5 py-2.5 font-medium text-white hover:bg-violet-500"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
