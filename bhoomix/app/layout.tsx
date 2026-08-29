import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { AuthProvider } from '@/components/auth/AuthProvider';
import './globals.css';

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
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="h-screen overflow-hidden bg-[#0B0F1A] text-slate-100 antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
