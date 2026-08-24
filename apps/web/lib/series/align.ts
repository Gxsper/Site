/**
 * Alignment (PROJECT_SPEC.md §5.1).
 *
 * Das Problem: BTC handelt 24/7, SPX nur werktags, WALCL wöchentlich mittwochs,
 * CPI monatlich. Naives Zusammenwerfen erzeugt falsche Korrelationen und
 * verschobene Charts.
 *
 * Die vier Regeln, die hier durchgesetzt werden:
 *
 *  1. **Forward-Fill nur vorwärts, nie rückwärts.** Ein CPI-Wert vom 1. März
 *     darf nicht am 20. Februar erscheinen (Look-ahead-Bias).
 *  2. **Forward-Fill hat ein Höchstalter** je nativer Frequenz. Danach `null`,
 *     nicht endlos verlängern.
 *  3. **Vor dem `earliest` einer Serie: immer `null`**, nie 0.
 *  4. **Für Korrelationen ist `intersection` Pflicht** — ffill erzeugt
 *     künstliche Autokorrelation und schönt r.
 */

import { forwardFill, MAX_FILL_AGE } from '@/lib/series/ffill';
import type { Frequency, SeriesResponse } from '@/lib/series/types';

export type AlignMode = 'union_ffill' | 'intersection' | 'trading_days' | 'native';

export interface AlignOptions {
  mode: AlignMode;
  /** Bestimmt den Zeit-Cut. Bei '1d' ist das 00:00 UTC (§5.1). */
  grid: Frequency;
  from: number;
  to: number;
  /** Nur für `trading_days`: die Serie, deren Handelstage das Raster vorgeben. */
  referenceId?: string;
}

export interface AlignedSeries {
  /** Gemeinsames Zeitraster, aufsteigend, duplikatfrei. */
  t: number[];
  /** Je Eingabeserie ein Array in der Länge von `t`. `null` = keine Daten. */
  values: (number | null)[][];
  /** Reihenfolge der Serien, passend zu `values`. */
  ids: string[];
  /**
   * Je Serie und Zeitpunkt: wurde der Wert vorwärts gefüllt statt gemessen?
   * Das UI zeigt damit an, welche Punkte interpoliert sind (§9, §11).
   */
  filled: boolean[][];
}

const SECONDS = {
  '1m': 60,
  '5m': 300,
  '1h': 3600,
  '4h': 14_400,
  '1d': 86_400,
  '1w': 604_800,
} as const;

/**
 * Schneidet einen Zeitstempel auf den Rasterbeginn ab.
 * Bei '1d' ergibt das 00:00 UTC — die Regel aus §5.1.
 */
export function snapToGrid(t: number, grid: Frequency): number {
  const size = SECONDS[grid as keyof typeof SECONDS];
  if (!size) return t; // 'tick', 'irregular', '1mo': kein festes Raster
  return Math.floor(t / size) * size;
}

/** Höchstalter für den Forward-Fill, abgeleitet aus der nativen Frequenz (§5.1). */
export function maxFillAgeFor(frequency: Frequency): number {
  switch (frequency) {
    case '1w':
      return MAX_FILL_AGE.weekly;
    case '1mo':
      return MAX_FILL_AGE.monthly;
    default:
      // Tages- und Intraday-Serien: 5 Tage. Länger ist eine Lücke.
      return MAX_FILL_AGE.daily;
  }
}

function earliestSeconds(response: SeriesResponse): number {
  const ms = Date.parse(response.descriptor.earliest);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : Number.NEGATIVE_INFINITY;
}

/** Punkte auf das Raster schnappen. Bei Kollision gewinnt der spätere Wert. */
function snapPoints(
  response: SeriesResponse,
  grid: Frequency,
  from: number,
  to: number,
): Map<number, number> {
  const byT = new Map<number, number>();
  for (const point of response.points) {
    const t = snapToGrid(point.t, grid);
    if (t < from || t > to) continue;
    byT.set(t, point.v);
  }
  return byT;
}

export function alignSeries(
  series: readonly SeriesResponse[],
  opts: AlignOptions,
): AlignedSeries {
  const ids = series.map((s) => s.descriptor.id);
  const snapped = series.map((s) => snapPoints(s, opts.grid, opts.from, opts.to));

  const grid = buildGrid(series, snapped, opts);

  const values: (number | null)[][] = [];
  const filled: boolean[][] = [];

  for (let i = 0; i < series.length; i++) {
    const response = series[i]!;
    const own = snapped[i]!;
    const start = earliestSeconds(response);

    if (opts.mode === 'intersection' || opts.mode === 'native') {
      // Keine Füllung: nur echte Messwerte.
      const row = grid.map((t) => own.get(t) ?? null);
      values.push(row);
      filled.push(grid.map(() => false));
      continue;
    }

    const points = [...own.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, v]) => ({ t, v }));

    const row = forwardFill(points, grid, maxFillAgeFor(response.descriptor.nativeFrequency));

    // Regel 3: vor dem dokumentierten Start der Historie niemals ein Wert.
    for (let k = 0; k < grid.length; k++) {
      if (grid[k]! < start) row[k] = null;
    }

    values.push(row);
    filled.push(grid.map((t, k) => row[k] !== null && !own.has(t)));
  }

  return { t: grid, values, ids, filled };
}

function buildGrid(
  series: readonly SeriesResponse[],
  snapped: readonly Map<number, number>[],
  opts: AlignOptions,
): number[] {
  if (opts.mode === 'trading_days') {
    const index = opts.referenceId
      ? series.findIndex((s) => s.descriptor.id === opts.referenceId)
      : 0;
    if (index < 0) {
      throw new Error(
        `Alignment 'trading_days': Referenzserie "${opts.referenceId}" ist nicht Teil der Anfrage.`,
      );
    }
    return [...snapped[index]!.keys()].sort((a, b) => a - b);
  }

  if (opts.mode === 'intersection') {
    if (snapped.length === 0) return [];
    // Nur Zeitpunkte, an denen ALLE Serien einen echten Wert haben.
    const [first, ...rest] = snapped;
    return [...first!.keys()]
      .filter((t) => rest.every((m) => m.has(t)))
      .sort((a, b) => a - b);
  }

  // union_ffill und native: Vereinigung aller Zeitstempel.
  const union = new Set<number>();
  for (const map of snapped) {
    for (const t of map.keys()) union.add(t);
  }
  return [...union].sort((a, b) => a - b);
}
