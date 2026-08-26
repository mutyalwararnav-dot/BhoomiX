import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Webpack (not Turbopack) handles maplibre-gl correctly out of the box.
  // Run dev with: next dev --no-turbopack (set in package.json scripts).
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
};

export default nextConfig;
