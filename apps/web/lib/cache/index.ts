/**
 * Auswahl des Cache-Backends (docs/adr/0001-cache-backend.md).
 */

import 'server-only';

import { createPostgresCache } from '@/lib/cache/postgres';
import type { CacheStore } from '@/lib/cache/types';
import { getDb } from '@/lib/db';
import { getCacheBackend, getEnv } from '@/lib/env';

export type { CacheStore, CacheHit, TokenResult, TokenBucketConfig } from '@/lib/cache/types';

let cached: CacheStore | null = null;

export function getCache(): CacheStore {
  if (cached) return cached;

  const backend = getCacheBackend(getEnv());

  if (backend === 'redis') {
    // Bewusst ein harter Fehler statt eines stillen Ausweichens auf Postgres:
    // wer REDIS_URL setzt, erwartet Redis. Ein unbemerkter Wechsel des Backends
    // wäre genau die Art stiller Ersatzhandlung, die §11 ausschließt.
    throw new Error(
      'REDIS_URL ist gesetzt, aber das Redis-Backend ist noch nicht implementiert.\n' +
        'Entweder REDIS_URL leeren (dann läuft der Cache über Postgres) oder das\n' +
        'Backend nachrüsten. Hintergrund: docs/adr/0001-cache-backend.md',
    );
  }

  cached = createPostgresCache(getDb());
  return cached;
}

/** Nur für Tests. */
export function resetCache(): void {
  cached = null;
}
