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

/**
 * Läuft die App als kurzlebige Serverless-Funktion (Vercel, Netlify, Lambda)?
 *
 * Der Unterschied ist für den Verbindungspool entscheidend: dort existiert je
 * gleichzeitigem Aufruf eine eigene Instanz mit eigenem Pool. Zehn Verbindungen
 * pro Instanz × dreißig Instanzen sprengt jede kleine Postgres-Instanz, lange
 * bevor die Last es rechtfertigt.
 */
function isServerless(): boolean {
  return Boolean(
    process.env['VERCEL'] ??
      process.env['NETLIFY'] ??
      process.env['AWS_LAMBDA_FUNCTION_NAME'] ??
      process.env['FUNCTIONS_WORKER_RUNTIME'],
  );
}

function getPool(): Pool {
  const existing = globalThis.__macrodeckPool;
  if (existing) return existing;

  const { DATABASE_URL } = getEnv();
  const serverless = isServerless();

  const pool = new Pool({
    connectionString: DATABASE_URL,
    // Auf einem eigenen Server ein normaler Pool; serverless genau eine
    // Verbindung je Instanz, sonst summieren sie sich über die Instanzen auf.
    max: serverless ? 1 : 10,
    // Ungenutzte Verbindungen serverless zügig schließen — die Instanz wird
    // ohnehin eingefroren, eine offene Verbindung blockiert dann nur einen
    // Platz im Server.
    idleTimeoutMillis: serverless ? 10_000 : 30_000,
    connectionTimeoutMillis: 10_000,
    // Zeitzonenfreiheit erzwingen (§0.4): der Server rechnet nie in Ortszeit.
    options: '-c timezone=UTC',
  });

  // Ein Verbindungsfehler im Leerlauf darf den Prozess nicht beenden. Ohne
  // diesen Zuhörer wirft `pg` ein unbehandeltes Ereignis, sobald der Server
  // eine ruhende Verbindung schliesst — bei gehosteten Datenbanken normal.
  pool.on('error', (error) => {
    console.error('Postgres-Pool meldet einen Fehler an einer ruhenden Verbindung:', error);
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
