/**
 * Postgres-Verbindung (Drizzle + node-postgres).
 *
 * Lazy: der Pool entsteht erst beim ersten Zugriff, damit `next dev` auch ohne
 * laufende Datenbank startet und ein Verbindungsfehler dort auftaucht, wo er
 * hingehoert — beim Query, mit klarer Meldung statt mit Ersatzdaten (§11).
 */

import 'server-only';

import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';

import { getEnv } from '@/lib/env';
import * as schema from '@/lib/db/schema';

export { schema };

type Db = NodePgDatabase<typeof schema>;

declare global {
  var __macrodeckPool: Pool | undefined;
}

function getPool(): Pool {
  const existing = globalThis.__macrodeckPool;
  if (existing) return existing;

  const { DATABASE_URL } = getEnv();
  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 10,
    // Zeitzonenfreiheit erzwingen (§0.4): der Server rechnet nie in Ortszeit.
    options: '-c timezone=UTC',
  });

  // Ueber Hot-Reloads hinweg wiederverwenden, sonst laeuft der Pool voll.
  globalThis.__macrodeckPool = pool;
  return pool;
}

let cachedDb: Db | null = null;

export function getDb(): Db {
  if (!cachedDb) {
    cachedDb = drizzle(getPool(), { schema });
  }
  return cachedDb;
}
