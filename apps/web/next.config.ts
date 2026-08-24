import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Provider-Keys duerfen den Server nie verlassen (PROJECT_SPEC.md §0.2).
  // Deshalb hier bewusst KEIN env-Passthrough und kein NEXT_PUBLIC_* fuer Secrets.
  serverExternalPackages: ['pg'],
};

export default nextConfig;
