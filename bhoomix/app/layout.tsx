import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import Link from 'next/link';

// ─── Fonts ────────────────────────────────────────────────────────────────────
const inter = Inter({
  variable:  '--font-inter',
  subsets:   ['latin'],
  display:   'swap',
  weight:    ['300', '400', '500', '600', '700'],
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains',
  subsets:  ['latin'],
  display:  'swap',
  weight:   ['400', '500', '600'],
});

// ─── SEO Metadata ─────────────────────────────────────────────────────────────
export const metadata: Metadata = {
  title:       'BhoomiX — AI-Assisted Cadastral Mapping Platform',
  description: 'Precision land intelligence powered by AI. Visualize, validate, and manage cadastral parcels with geospatial AI on an interactive WebGIS dashboard.',
  keywords:    ['cadastral', 'mapping', 'GIS', 'land records', 'AI', 'geospatial', 'PostGIS', 'MapLibre'],
  authors:     [{ name: 'BhoomiX Team' }],
  openGraph: {
    title:       'BhoomiX — AI Cadastral Mapping',
    description: 'Precision land intelligence powered by AI',
    type:        'website',
  },
};

// ─── Root Layout ──────────────────────────────────────────────────────────────
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="bg-bhoomix-bg text-bhoomix-text antialiased overflow-hidden h-screen flex flex-col">
        {/* ── App Shell ───────────────────────────────────────────────── */}
        <div className="flex flex-col h-screen overflow-hidden">
          {/* Header */}
          <header className="h-header flex-shrink-0 flex items-center justify-between px-4
            bg-bhoomix-surface border-b border-bhoomix-border
            bg-header-gradient shadow-bhoomix-sm z-30">

            {/* Brand */}
            <a href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg
                bg-bhoomix-primary shadow-bhoomix-glow">
                <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white">
                  <path
                    d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                    stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div>
                <div className="text-sm font-bold text-bhoomix-text tracking-tight leading-none">
                  BhoomiX
                </div>
                <div className="text-[10px] text-bhoomix-subtext leading-none mt-0.5">
                  AI Cadastral Mapping
                </div>
              </div>
            </a>

            {/* Center: Status bar */}
            <div className="hidden md:flex items-center gap-2 text-xs text-bhoomix-subtext">
              <span className="w-1.5 h-1.5 rounded-full bg-parcel-confirmed animate-pulse inline-block" />
              <span>PostGIS Connected</span>
              <span className="text-bhoomix-border mx-1">·</span>
              <span>OpenFreeMap</span>
              <span className="text-bhoomix-border mx-1">·</span>
              <span>Pune, Maharashtra</span>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2">
              <a
                href="/upload"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold
                  text-white bg-indigo-600 rounded-md shadow-bhoomix-sm
                  hover:bg-indigo-500 transition-all duration-150"
              >
                UPLOAD TEST
              </a>
              <button
                id="btn-seed-hint"
                className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-xs
                  text-bhoomix-subtext border border-bhoomix-border rounded-md
                  hover:border-bhoomix-primary hover:text-bhoomix-primary
                  transition-all duration-150 font-mono"
              >
                <span>npx tsx scripts/seed_parcels.ts</span>
              </button>
              <div className="w-7 h-7 rounded-full bg-bhoomix-surface2 border border-bhoomix-border
                flex items-center justify-center text-xs text-bhoomix-subtext cursor-pointer
                hover:border-bhoomix-primary hover:text-bhoomix-primary transition-all duration-150">
                A
              </div>
            </div>
          </header>

          {/* Main content area */}
          <main className="flex-1 overflow-hidden relative">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}