/**
 * Forward-Fill mit Höchstalter (PROJECT_SPEC.md §5.1).
 *
 * Baustein für die Overlay-Engine in Phase 2 und schon jetzt nötig, weil Net
 * Liquidity wöchentliche und tägliche Serien mischt (§4.3).
 *
 * Zwei Regeln, die beide teuer sind, wenn man sie verletzt:
 *
 *  1. **Nur vorwärts, nie rückwärts.** Ein Wert, der am 1. März veröffentlicht
 *     wurde, darf am 20. Februar nicht erscheinen. Rückwärtsfüllen erzeugt
 *     Look-ahead-Bias und lässt jede Backtest-Auswertung zu gut aussehen.
 *  2. **Höchstalter.** Ein Wert wird nicht endlos weitergetragen. Läuft die
 *     Quelle trocken, entsteht eine Lücke — sichtbar als `null`, nicht als
 *     eingefrorene Linie (§11).
 */

import type { SeriesPoint } from '@/lib/series/types';

/** Höchstalter je nativer Frequenz, in Sekunden (§5.1). */
export const MAX_FILL_AGE = {
  daily: 5 * 86_400,
  weekly: 10 * 86_400,
  monthly: 45 * 86_400,
} as const;

/**
 * Projiziert `points` auf `grid`.
 *
 * @param points Aufsteigend sortiert, streng monoton.
 * @param grid   Aufsteigend sortierte Zielzeitpunkte (Unix-Sekunden UTC).
 * @param maxAgeSeconds Nach dieser Zeit ohne neuen Wert entsteht eine Lücke.
 * @returns Ein Array in der Länge von `grid`; `null` steht für „hier gibt es
 *          nachweislich keinen gültigen Wert".
 */
export function forwardFill(
  points: readonly SeriesPoint[],
  grid: readonly number[],
  maxAgeSeconds: number,
): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(grid.length).fill(null);

  let cursor = 0;
  let lastValue: number | null = null;
  let lastT = 0;

  for (let i = 0; i < grid.length; i++) {
    const t = grid[i]!;

    // Alle Punkte übernehmen, die zeitlich bereits erreicht sind. Punkte aus
    // der Zukunft bleiben liegen — das ist die Regel „nur vorwärts".
    while (cursor < points.length && points[cursor]!.t <= t) {
      lastValue = points[cursor]!.v;
      lastT = points[cursor]!.t;
      cursor++;
    }

    if (lastValue === null) continue; // vor dem ersten Wert: Lücke, nie 0
    if (t - lastT > maxAgeSeconds) continue; // zu alt: Lücke statt eingefrorener Linie

    out[i] = lastValue;
  }

  return out;
}

/** Tagesraster von `from` bis `to`, Cut jeweils 00:00 UTC (§5.1). */
export function dailyGrid(from: number, to: number): number[] {
  const DAY = 86_400;
  const start = Math.ceil(from / DAY) * DAY;
  const grid: number[] = [];
  for (let t = start; t <= to; t += DAY) grid.push(t);
  return grid;
}
