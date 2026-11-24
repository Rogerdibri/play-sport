/** @type {import('next').NextConfig} */
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';

const nextConfig = (phase) => ({
  devIndicators: { position: 'top-right' },
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
  async rewrites() {
    const base = (process.env.PLAYSPORT_SPORTING_API_BASE ?? 'http://localhost:4000/api').replace(/\/$/, '');
    return ['official-scoring', 'registration', 'friendly-games'].map(resource => ({
      source: `/api/${resource}/:path*`,
      destination: `${base}/${resource}/:path*`,
    }));
  }
});
export default nextConfig;
