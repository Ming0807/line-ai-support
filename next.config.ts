import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Hermes uses a separately provisioned local Windows runtime, not build assets.
  // Keep cached dependencies and per-run private data out of standalone traces.
  outputFileTracingExcludes: {
    '/api/tickets/*/copilot': ['./.superpowers/staging/hermes-runtime/**/*'],
  },
};

export default nextConfig;
