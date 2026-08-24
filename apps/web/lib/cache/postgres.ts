/**
 * Cache-Layer 2 auf Postgres (docs/adr/0001-cache-backend.md).
 *
 * Der Token-Bucket ist der heikle Teil: er muss atomar sein, sonst holen sich
 * zwei gleichzeitige Requests dasselbe Token und wir laufen ins Rate-Limit des
 * Providers. Deshalb steckt Nachfüllen, Prüfen und Entnehmen in einer einzigen
 * INSERT ... ON CONFLICT DO UPDATE ... WHERE-Anweisung. Kommt keine Zeile
 * zurück, war kein Token verfügbar.
 */

import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from '@/lib/db/schema';
import type {
  CacheHit,
  CacheStore,
  TokenBucketConfig,
  TokenResult,
} from '@/lib/cache/types';

type Db = NodePgDatabase<typeof schema>;

export function createPostgresCache(db: Db): CacheStore {
  return {
    backend: 'postgres',

    async get<T>(key: string): Promise<CacheHit<T> | null> {
      const rows = await db
        .select({
          value: schema.cacheEntries.value,
          storedAt: schema.cacheEntries.storedAt,
          expiresAt: schema.cacheEntries.expiresAt,
        })
        .from(schema.cacheEntries)
        .where(eq(schema.cacheEntries.key, key))
        .limit(1);

      const row = rows[0];
      if (!row) return null;

      const now = Date.now();
      // Abgelaufen zählt als Treffer-los. Nicht löschen — das erledigt das
      // nächste set(), und ein Löschvorgang beim Lesen macht Reads schreibend.
      if (row.expiresAt.getTime() <= now) return null;

      const storedAtMs = row.storedAt.getTime();
      return {
        value: row.value as T,
        storedAt: Math.floor(storedAtMs / 1000),
        ageSeconds: Math.max(0, Math.floor((now - storedAtMs) / 1000)),
      };
    },

    async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
      if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
        throw new Error(`Cache-TTL muss positiv sein, war ${ttlSeconds} (key: ${key})`);
      }
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

      await db
        .insert(schema.cacheEntries)
        .values({ key, value, expiresAt })
        .onConflictDoUpdate({
          target: schema.cacheEntries.key,
          set: { value, expiresAt, storedAt: sql`now()` },
        });
    },

    async delete(key: string): Promise<void> {
      await db.delete(schema.cacheEntries).where(eq(schema.cacheEntries.key, key));
    },

    async takeToken(bucket: string, config: TokenBucketConfig): Promise<TokenResult> {
      const { capacity, refillPerSecond } = config;
      if (capacity <= 0 || refillPerSecond <= 0) {
        throw new Error(
          `Token-Bucket "${bucket}": capacity und refillPerSecond müssen positiv sein`,
        );
      }

      // Nachgefüllter Stand = min(capacity, tokens + verstrichene Sekunden * Rate).
      const refilled = sql`least(
        ${capacity}::double precision,
        ${schema.rateLimitBuckets.tokens}
          + extract(epoch from (now() - ${schema.rateLimitBuckets.updatedAt}))
          * ${refillPerSecond}::double precision
      )`;

      const granted = await db
        .insert(schema.rateLimitBuckets)
        .values({ bucket, tokens: capacity - 1 })
        .onConflictDoUpdate({
          target: schema.rateLimitBuckets.bucket,
          set: { tokens: sql`${refilled} - 1`, updatedAt: sql`now()` },
          // Ohne diese Bedingung würde der Stand negativ und der Eimer wäre wirkungslos.
          where: sql`${refilled} >= 1`,
        })
        .returning({ tokens: schema.rateLimitBuckets.tokens });

      const row = granted[0];
      if (row) return { granted: true, remaining: row.tokens };

      // Kein Token: aus dem aktuellen Stand ausrechnen, wie lange es dauert.
      const current = await db
        .select({
          tokens: schema.rateLimitBuckets.tokens,
          updatedAt: schema.rateLimitBuckets.updatedAt,
        })
        .from(schema.rateLimitBuckets)
        .where(eq(schema.rateLimitBuckets.bucket, bucket))
        .limit(1);

      const state = current[0];
      if (!state) {
        // Zwischen Konflikt und Nachschlagen gelöscht — ein Versuch später ist frei.
        return { granted: false, retryAfterSeconds: 1 };
      }

      const elapsed = (Date.now() - state.updatedAt.getTime()) / 1000;
      const available = Math.min(capacity, state.tokens + elapsed * refillPerSecond);
      const missing = Math.max(0, 1 - available);
      return {
        granted: false,
        retryAfterSeconds: Math.max(1, Math.ceil(missing / refillPerSecond)),
      };
    },
  };
}
