import type { Metadata } from 'next';
import { AuthProvider } from '@/components/auth/AuthProvider';
import './globals.css';

// ─── SEO Metadata ─────────────────────────────────────────────────────────────
export const metadata: Metadata = {
  title:        'BhoomiX — AI-Assisted Cadastral Mapping Platform',
  description: 'Precision land intelligence powered by AI. Visualize, validate, and manage cadastral parcels with geospatial AI on an interactive WebGIS dashboard.',
  keywords:    ['cadastral', 'mapping', 'GIS', 'land records', 'AI', 'geospatial', 'PostGIS', 'MapLibre'],
  authors:     [{ name: 'BhoomiX Team' }],
  openGraph: {
    title:        'BhoomiX — AI Cadastral Mapping',
    description: 'Precision land intelligence powered by AI',
    type:         'website',
  },
};

// ─── Root Layout ──────────────────────────────────────────────────────────────
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var saved=localStorage.getItem('bhoomix-theme');var theme=saved==='light'||saved==='dark'?saved:(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.dataset.theme=theme;}catch(e){document.documentElement.dataset.theme='dark';}})();` }} />
      </head>
      <body className="h-screen overflow-hidden bg-[#0B0F1A] text-slate-100 antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
