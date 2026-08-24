import 'server-only';

/**
 * Der Nachtjob als Funktion (PROJECT_SPEC.md §10).
 *
 * Steckt hier statt im Skript, weil er auf zwei Wegen laufen muss:
 *
 *  - lokal über `npm run nightly` (scripts/nightly.ts)
 *  - gehostet über `/api/cron/nightly`, angestoßen von einer geplanten
 *    Netlify-Funktion — dort gibt es keine Kommandozeile, die ein tsx-Skript
 *    starten könnte.
 *
 * Beide Wege benutzen dieselbe Logik, damit sie nicht auseinanderlaufen.
 */

import { CATALOG } from '@/lib/series/catalog';
import { loadSeries } from '@/lib/series/service';

/** Wie weit zurück geprüft wird. Ältere Lücken schließt der Backfill. */
export const LOOKBACK_DAYS = 30;
const DAY = 86_400;

/** Kurze Pause zwischen Serien, damit der Token-Bucket nicht ständig greift. */
const PAUSE_MS = 250;

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface NightlyResult {
  id: string;
  ok: boolean;
  points: number;
  durationMs: number;
  newestAt: number | null;
  message?: string;
}

export interface NightlyReport {
  from: number;
  to: number;
  total: number;
  succeeded: number;
  failed: number;
  /** Serien, die im Fenster keine Punkte hatten — kein Fehler, nur nichts Neues. */
  empty: number;
  results: NightlyResult[];
  durationMs: number;
  /**
   * Index der ersten Serie, die im Zeitbudget nicht mehr drankam — oder `null`,
   * wenn der Katalog vollständig durchlief. Der Aufrufer reicht ihn als
   * `offset` in den nächsten Aufruf und setzt so fort, wo abgebrochen wurde.
   */
  nextOffset: number | null;
}

export interface NightlyOptions {
  /** Zeitbudget. Serverless-Funktionen werden hart abgeschnitten. */
  deadlineMs?: number;
  /** Ab welcher Katalogposition begonnen wird. Für die Fortsetzung nach einem
   *  Abbruch am Zeitbudget. */
  offset?: number;
  onResult?: (result: NightlyResult) => void;
}

/**
 * Holt für jede Katalogserie das Delta der letzten Tage.
 *
 * Läuft nacheinander, nicht parallel: die Rate-Limits gelten pro Provider, und
 * zwölf FRED-Serien gleichzeitig anzufragen bringt nichts außer abgelehnten
 * Anfragen.
 */
export async function runNightly(options: NightlyOptions = {}): Promise<NightlyReport> {
  const started = Date.now();
  const to = Math.floor(Date.now() / 1000);
  const from = to - LOOKBACK_DAYS * DAY;

  const results: NightlyResult[] = [];
  const offset = options.offset ?? 0;
  let nextOffset: number | null = null;

  for (let index = offset; index < CATALOG.length; index += 1) {
    const descriptor = CATALOG[index]!;

    // Serverless-Funktionen haben ein hartes Zeitlimit. Hier wird deshalb
    // abgebrochen und die Position gemerkt, statt die restlichen Serien als
    // Fehlschläge zu melden — offen ist nicht dasselbe wie kaputt.
    if (options.deadlineMs && Date.now() - started > options.deadlineMs) {
      nextOffset = index;
      break;
    }

    const seriesStarted = Date.now();
    let result: NightlyResult;

    try {
      const { response, warning } = await loadSeries(descriptor, { from, to });
      const newest = response.points[response.points.length - 1];

      result = {
        id: descriptor.id,
        ok: warning === undefined,
        points: response.points.length,
        durationMs: Date.now() - seriesStarted,
        newestAt: newest?.t ?? null,
        ...(warning ? { message: warning } : {}),
      };
    } catch (error) {
      result = {
        id: descriptor.id,
        ok: false,
        points: 0,
        durationMs: Date.now() - seriesStarted,
        newestAt: null,
        message: error instanceof Error ? error.message : String(error),
      };
    }

    results.push(result);
    options.onResult?.(result);
    await pause(PAUSE_MS);
  }

  return {
    from,
    to,
    total: results.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    empty: results.filter((r) => r.ok && r.points === 0).length,
    results,
    durationMs: Date.now() - started,
    nextOffset,
  };
}
