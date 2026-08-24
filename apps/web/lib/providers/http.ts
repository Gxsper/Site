/**
 * Gemeinsame HTTP-Schicht aller Provider (PROJECT_SPEC.md §10).
 *
 * Grundsatz: Fehler werden durchgereicht, nie versteckt. Es gibt hier keinen
 * Pfad, der bei einem Fehlschlag einen Ersatzwert oder ein leeres Ergebnis
 * zurueckgibt — jeder Fehler endet als ProviderError beim Aufrufer (§11).
 *
 * Retry-Politik: exponentielles Backoff mit Jitter, maximal 3 Versuche, nur bei
 * 429 und 5xx sowie bei Netzwerk- und Timeout-Fehlern. Ein 4xx ausser 429 ist
 * ein Programmierfehler und wird sofort geworfen.
 */

import type { z } from 'zod';

import { ProviderError, type ProviderId } from '@/lib/series/types';

export interface FetchOptions {
  provider: ProviderId;
  url: string;
  headers?: Record<string, string>;
  /** Abbruch pro Versuch. */
  timeoutMs?: number;
  /** Zusaetzliche Versuche nach dem ersten. */
  maxRetries?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;

/**
 * Jitter ohne `Math.random`. Das ist keine Schikane: der No-Mock-Check aus §11
 * verbietet `Math.random` im gesamten Laufzeitcode, damit niemand versehentlich
 * Zufall in einen Datenpfad traegt. `crypto.getRandomValues` erfuellt denselben
 * Zweck und laeuft in Node wie in Edge-Runtimes.
 */
function jitterMs(maxMs: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0]! / 0xff_ff_ff_ff) * maxMs;
}

function backoffMs(attempt: number): number {
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return exponential + jitterMs(exponential / 2);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Zieht eine lesbare Fehlermeldung aus einem Fehler-Body. Coin Metrics
 * antwortet mit `{ error: { type, message } }`, Binance mit `{ code, msg }`.
 */
function describeErrorBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '(leerer Body)';
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      const error = record['error'];
      if (error && typeof error === 'object') {
        const inner = error as Record<string, unknown>;
        if (typeof inner['message'] === 'string') return inner['message'];
      }
      if (typeof record['msg'] === 'string') return record['msg'];
    }
  } catch {
    // Kein JSON — der Rohtext ist dann die beste verfuegbare Auskunft.
  }
  return trimmed.slice(0, 300);
}

/** Ein einzelner Versuch. Wirft bei HTTP-Fehler, gibt sonst den Body zurueck. */
async function attemptFetch(opts: FetchOptions): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const response = await fetch(opts.url, {
    headers: { accept: 'application/json', ...opts.headers },
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  });

  const body = await response.text();

  if (!response.ok) {
    const error = new ProviderError(
      opts.provider,
      `HTTP ${response.status} bei ${opts.url}: ${describeErrorBody(body)}`,
    );
    // Am Fehlerobjekt festhalten, ob ein erneuter Versuch sinnvoll ist.
    Object.assign(error, { httpStatus: response.status });
    throw error;
  }

  return body;
}

function shouldRetry(error: unknown): boolean {
  if (error instanceof ProviderError) {
    const status = (error as ProviderError & { httpStatus?: number }).httpStatus;
    return status === undefined ? false : isRetryableStatus(status);
  }
  // Netzwerkabbruch, DNS-Fehler, Timeout: erneut versuchen.
  return true;
}

/** Roher Textabruf mit Retry. Fuer CSV-Quellen und Diagnostik. */
export async function fetchText(opts: FetchOptions): Promise<string> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await attemptFetch(opts);
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries || !shouldRetry(error)) break;
      await sleep(backoffMs(attempt));
    }
  }

  if (lastError instanceof ProviderError) throw lastError;
  throw new ProviderError(
    opts.provider,
    `Abruf von ${opts.url} fehlgeschlagen: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    { cause: lastError },
  );
}

/**
 * Abruf mit Zod-Validierung. Ein Parse-Fehler ist ein harter Fehler (§0.5) —
 * die Antwort hat nicht die Form, mit der wir gerechnet haben, also stimmt
 * unsere Annahme ueber den Provider nicht mehr.
 */
export async function fetchJson<T>(schema: z.ZodType<T>, opts: FetchOptions): Promise<T> {
  const body = await fetchText(opts);

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new ProviderError(
      opts.provider,
      `Antwort von ${opts.url} ist kein gueltiges JSON: ${body.slice(0, 200)}`,
    );
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new ProviderError(
      opts.provider,
      `Antwort von ${opts.url} entspricht nicht dem erwarteten Schema — ${issues}. ` +
        `Response-Shape hat sich vermutlich geaendert; docs/api-samples/ neu erheben.`,
    );
  }

  return parsed.data;
}
