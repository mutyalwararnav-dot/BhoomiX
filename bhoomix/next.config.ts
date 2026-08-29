import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: false,
  // Webpack (not Turbopack) handles maplibre-gl correctly out of the box.
  // Run dev with: next dev --no-turbopack (set in package.json scripts).
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
