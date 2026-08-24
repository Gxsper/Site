/**
 * Laufzeit-Durchsetzung von PROJECT_SPEC.md §11.
 *
 * `assertRealData` laeuft auf jeder SeriesResponse, bevor sie das Backend
 * verlaesst. Der Check ist absichtlich streng: lieber ein harter Fehler als
 * eine Zahl im UI, deren Herkunft unklar ist.
 */

import type { SeriesResponse } from '@/lib/series/types';

export class MockDataError extends Error {
  override readonly name = 'MockDataError';
}

export function assertRealData(r: SeriesResponse): void {
  const id = r.descriptor?.id ?? '(ohne descriptor)';

  if (!r.descriptor) {
    throw new MockDataError('SeriesResponse ohne descriptor — Herkunft unklar');
  }
  if (!r.lastUpdated || !Number.isFinite(r.lastUpdated) || r.lastUpdated <= 0) {
    throw new MockDataError(`Series ${id}: kein lastUpdated — Herkunft unklar`);
  }
  if (!Array.isArray(r.points)) {
    throw new MockDataError(`Series ${id}: points ist kein Array`);
  }

  for (let i = 0; i < r.points.length; i++) {
    const point = r.points[i]!;
    if (!Number.isFinite(point.v)) {
      throw new MockDataError(`Series ${id}: non-finite value an Index ${i}`);
    }
    if (!Number.isFinite(point.t) || !Number.isInteger(point.t)) {
      throw new MockDataError(
        `Series ${id}: Zeitstempel an Index ${i} ist keine ganze Unix-Sekunde`,
      );
    }
    if (i > 0) {
      const prev = r.points[i - 1]!;
      if (point.t <= prev.t) {
        throw new MockDataError(
          `Series ${id}: Zeitstempel nicht streng monoton (Index ${i}: ${point.t} <= ${prev.t})`,
        );
      }
    }
  }
}

/**
 * Ein leeres Ergebnis ist erlaubt, aber nur als Aussage "hier existieren keine
 * Daten" — nie als kaschierter Fehler. Diese Helferin macht die Unterscheidung
 * im Aufrufer explizit.
 */
export function assertNoSilentEmpty(r: SeriesResponse, range: { from: number; to: number }): void {
  if (r.points.length > 0) return;
  const earliestSec = Math.floor(Date.parse(r.descriptor.earliest) / 1000);
  if (Number.isFinite(earliestSec) && range.to < earliestSec) return;
  throw new MockDataError(
    `Series ${r.descriptor.id}: leeres Ergebnis im Zeitraum ${range.from}..${range.to}, ` +
      `obwohl die Historie laut Descriptor ab ${r.descriptor.earliest} existiert. ` +
      `Fehler durchreichen statt leer zurueckgeben (§11).`,
  );
}
