import type { NextConfig } from 'next';

import { loadRootEnv } from './lib/root-env';

// Next liest .env-Dateien nur aus dem eigenen Verzeichnis; die Konfiguration
// dieses Monorepos liegt zentral im Repo-Root. Siehe lib/root-env.ts.
loadRootEnv();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Provider-Keys dürfen den Server nie verlassen (PROJECT_SPEC.md §0.2).
  // Deshalb hier bewusst KEIN env-Passthrough und kein NEXT_PUBLIC_* für Secrets.
  serverExternalPackages: ['pg'],
};

export default nextConfig;
