/**
 * Zyklus-Vergleich (PROJECT_SPEC.md §6.3).
 *
 * X-Achse = Tage seit Anker, Y = Preis auf 100 rebased. Anker wahlweise die
 * Halvings oder die Zyklus-Tiefs.
 *
 * ══ Warum die Halving-Daten hart hinterlegt sind ══
 *
 * Ein Halving ist ein Ereignis auf einer Blockhöhe, kein Kalendertermin. Die
 * vergangenen vier stehen fest und werden deshalb als Konstante geführt.
 * Künftige Halvings ließen sich aus der Blockhöhe schätzen — genau das tut
 * diese Datei bewusst **nicht**: ein geschätztes Datum in einer Zeitreihe wäre
 * eine Zahl ohne Quelle (§11). Sobald ein Halving stattgefunden hat, kommt es
 * hier dazu.
 */

import type { SeriesPoint } from '@/lib/series/types';

const DAY = 86_400;

function day(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);
}

/** Stattgefundene Bitcoin-Halvings (§6.3). */
export const HALVINGS = [
  { label: 'Halving 2012', t: day('2012-11-28') },
  { label: 'Halving 2016', t: day('2016-07-09') },
  { label: 'Halving 2020', t: day('2020-05-11') },
  { label: 'Halving 2024', t: day('2024-04-20') },
] as const;

/** Zyklus-Tiefs (§6.3). */
export const CYCLE_BOTTOMS = [
  { label: 'Tief 2011', t: day('2011-11-18') },
  { label: 'Tief 2015', t: day('2015-01-14') },
  { label: 'Tief 2018', t: day('2018-12-15') },
  { label: 'Tief 2022', t: day('2022-11-21') },
] as const;

export type CycleAnchor = 'halving' | 'bottom';

export interface CycleSeries {
  label: string;
  anchorT: number;
  /** t ist hier **Tage seit Anker**, nicht ein Zeitstempel. */
  points: { t: number; v: number }[];
  /** true für den Zyklus, der noch läuft. */
  current: boolean;
}

export interface CycleComparison {
  cycles: CycleSeries[];
  methodology: string;
}

/**
 * Legt die Zyklen übereinander.
 *
 * @param points   Preisreihe, aufsteigend.
 * @param anchor   Halvings oder Zyklus-Tiefs als Nullpunkt.
 * @param maxDays  Länge des betrachteten Fensters ab Anker.
 */
export function compareCycles(
  points: readonly SeriesPoint[],
  anchor: CycleAnchor = 'halving',
  maxDays = 1461,
): CycleComparison {
  const anchors = anchor === 'halving' ? HALVINGS : CYCLE_BOTTOMS;
  const now = points.length > 0 ? points[points.length - 1]!.t : 0;

  const cycles: CycleSeries[] = [];

  for (const [index, entry] of anchors.entries()) {
    const next = anchors[index + 1];
    const windowEnd = Math.min(entry.t + maxDays * DAY, next ? next.t - DAY : Number.POSITIVE_INFINITY);

    const inWindow = points.filter((p) => p.t >= entry.t && p.t <= windowEnd);
    if (inWindow.length === 0) continue;

    // Basis ist der erste Punkt am oder nach dem Anker. Fehlt der Ankertag
    // selbst (Datenlücke), wird nicht rückwärts gesucht.
    const base = inWindow[0]!.v;
    if (!Number.isFinite(base) || base <= 0) continue;

    cycles.push({
      label: entry.label,
      anchorT: entry.t,
      points: inWindow.map((p) => ({
        t: Math.round((p.t - entry.t) / DAY),
        v: (p.v / base) * 100,
      })),
      current: next === undefined && now >= entry.t,
    });
  }

  const anchorLabel = anchor === 'halving' ? 'Halving' : 'Zyklus-Tief';

  return {
    cycles,
    methodology:
      `Jeder Zyklus beginnt am jeweiligen ${anchorLabel} und wird dort auf 100 ` +
      `rebased. X-Achse ist die Zahl der Tage seit dem Anker, nicht das Datum. ` +
      `Ein Zyklus endet spätestens beim nächsten Anker oder nach ${maxDays} Tagen. ` +
      `Vergangene Zyklen sind vollständig, der laufende ist es naturgemäß nicht — ` +
      `ein Vergleich der Endpunkte wäre irreführend.`,
  };
}

/** Tage seit dem letzten stattgefundenen Halving. */
export function daysSinceLastHalving(now = Math.floor(Date.now() / 1000)): number | null {
  const past = HALVINGS.filter((h) => h.t <= now);
  const last = past[past.length - 1];
  return last ? Math.floor((now - last.t) / DAY) : null;
}
