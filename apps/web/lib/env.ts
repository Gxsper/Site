/**
 * Environment-Validierung (PROJECT_SPEC.md §12).
 *
 * Zweistufig:
 *  1. `getEnv()`  — Infrastruktur, die die App immer braucht. Fehlt etwas,
 *                   harter Abbruch mit klarer Meldung.
 *  2. `requireProviderKey()` — Provider-Keys werden erst dort erzwungen, wo ein
 *     Provider tatsaechlich konstruiert wird (ab Phase 1). So laeuft Phase 0
 *     ohne Keys, aber kein Provider startet je mit fehlendem Key.
 *
 * Es gibt bewusst keinen Default und keinen Fallback fuer einen fehlenden Key —
 * ein fehlender Key fuehrt zu einem Fehler, nie zu ersatzweisen Daten (§11).
 */

import { z } from 'zod';

/**
 * Absichtlich nicht `NodeJS.ProcessEnv`: Next.js deklariert dort `NODE_ENV` als
 * Pflichtfeld, was jeden Aufruf mit einem Teil-Environment (Tests, Worker)
 * unnoetig verkompliziert. Gelesen werden ohnehin nur String-Keys.
 */
export type EnvSource = Readonly<Record<string, string | undefined>>;

const booleanFromString = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const infraSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, 'fehlt')
    .refine((v) => v.startsWith('postgres://') || v.startsWith('postgresql://'), {
      message: 'muss eine postgres:// oder postgresql:// URL sein',
    }),
  REDIS_URL: z
    .string()
    .min(1, 'fehlt')
    .refine((v) => v.startsWith('redis://') || v.startsWith('rediss://'), {
      message: 'muss eine redis:// oder rediss:// URL sein',
    }),
  ENABLE_WS_INGEST: booleanFromString.default('false'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type InfraEnv = z.infer<typeof infraSchema>;

/** Woher man den jeweiligen Key bekommt — erscheint im Fehlertext. */
export const PROVIDER_KEYS = {
  FRED_API_KEY: {
    required: true,
    provider: 'FRED (St. Louis Fed)',
    where: 'https://fredaccount.stlouisfed.org/apikeys — kostenlos, sofort aktiv',
  },
  COINGECKO_API_KEY: {
    required: false,
    provider: 'CoinGecko',
    where: 'https://www.coingecko.com/en/developers/dashboard — Demo-Plan, optional',
  },
  COINGLASS_API_KEY: {
    required: false,
    provider: 'Coinglass',
    where: 'https://www.coinglass.com/pricing — nur mit Abo',
  },
} as const satisfies Record<string, { required: boolean; provider: string; where: string }>;

export type ProviderKeyName = keyof typeof PROVIDER_KEYS;

export class EnvError extends Error {
  override readonly name = 'EnvError';
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

let cached: InfraEnv | null = null;

/**
 * Liest und validiert die Infrastruktur-Variablen. Wirft bei Problemen.
 * Nur serverseitig aufrufen.
 */
export function getEnv(source: EnvSource = process.env): InfraEnv {
  if (cached && source === process.env) return cached;

  const parsed = infraSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvError(
      'Environment unvollstaendig oder ungueltig:\n' +
        formatIssues(parsed.error) +
        '\n\n.env.example nach .env.local kopieren und ausfuellen.' +
        '\nInfrastruktur lokal starten: npm run docker:up',
    );
  }

  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

/**
 * Erzwingt einen Provider-Key an der Stelle, an der er gebraucht wird.
 * Wirft mit Bezugsquelle, statt still ohne Key weiterzulaufen.
 */
export function requireProviderKey(
  name: ProviderKeyName,
  source: EnvSource = process.env,
): string {
  const value = source[name];
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();

  const meta = PROVIDER_KEYS[name];
  throw new EnvError(
    `${name} fehlt — ${meta.provider} kann nicht abgefragt werden.\n` +
      `Key holen: ${meta.where}\n` +
      `Danach in .env.local eintragen. Ohne Key werden keine Ersatzdaten erzeugt (§11).`,
  );
}

/** Optionaler Key: gibt null zurueck, wenn nicht gesetzt. Wirft nie. */
export function optionalProviderKey(
  name: ProviderKeyName,
  source: EnvSource = process.env,
): string | null {
  const value = source[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Nur fuer Tests: den Cache von `getEnv` leeren. */
export function resetEnvCache(): void {
  cached = null;
}
