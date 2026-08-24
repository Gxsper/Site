/**
 * Führt Datenbank (Layer 1), Cache (Layer 2) und Provider zusammen
 * (PROJECT_SPEC.md §4.0, §10).
 *
 * Verhalten bei Provider-Fehlern folgt der Tabelle aus §11:
 *  - Datenbank hat Daten  → diese ausliefern, `stale = true`, Fehler melden
 *  - Datenbank ist leer   → Fehler durchreichen, nichts erfinden
 *
 * Es gibt hier keinen Zweig, der bei einem Fehlschlag Werte erzeugt.
 */

import 'server-only';

import { getCache } from '@/lib/cache';
import { assertRealData } from '@/lib/guard';
import { getProvider } from '@/lib/providers';
import { getRateLimit, rateLimitBucketKey } from '@/lib/series/limits';
import { planFetches } from '@/lib/series/plan';
import {
  readExtent,
  readPoints,
  readSyncState,
  recordFailure,
  recordSuccess,
  upsertDescriptor,
  writePoints,
} from '@/lib/series/store';
import {
  ProviderError,
  type SeriesDescriptor,
  type SeriesRange,
  type SeriesResponse,
} from '@/lib/series/types';

export interface LoadResult {
  response: SeriesResponse;
  /** Gesetzt, wenn der Provider nicht erreichbar war, aber Bestandsdaten existieren. */
  warning?: string;
}

function headCacheKey(seriesId: string): string {
  return `series:head:${seriesId}`;
}

/** Ein Wert gilt als abgestanden, wenn er älter als updateCadence * 3 ist (§3.1). */
function isStale(lastSuccessAt: Date | null, updateCadence: number): boolean {
  if (!lastSuccessAt) return true;
  const ageSeconds = (Date.now() - lastSuccessAt.getTime()) / 1000;
  return ageSeconds > updateCadence * 3;
}

async function takeTokenOrThrow(descriptor: SeriesDescriptor): Promise<void> {
  const cache = getCache();
  const result = await cache.takeToken(
    rateLimitBucketKey(descriptor.provider),
    getRateLimit(descriptor.provider),
  );
  if (!result.granted) {
    throw new ProviderError(
      descriptor.provider,
      `Rate-Limit erreicht. Nächster Versuch in ${result.retryAfterSeconds}s.`,
    );
  }
}

export async function loadSeries(
  descriptor: SeriesDescriptor,
  range: SeriesRange,
): Promise<LoadResult> {
  const cache = getCache();
  await upsertDescriptor(descriptor);

  const extent = await readExtent(descriptor.id);
  const previous = await readSyncState(descriptor.id);
  const head = await cache.get(headCacheKey(descriptor.id));

  const covered =
    previous?.coveredFromT !== null && previous?.coveredFromT !== undefined &&
    previous.coveredToT !== null
      ? { from: previous.coveredFromT, to: previous.coveredToT }
      : undefined;

  /**
   * Der Head-Cache allein genügt nicht.
   *
   * Er hält fest, dass der Rand kürzlich geprüft wurde — aber nicht, **bis
   * wann**. Wurde er für eine Anfrage bis Ende 2024 gesetzt und fragt jemand
   * kurz darauf bis heute, blockierte er das Nachladen von Monaten an Daten.
   * Deshalb zählt der Cache-Treffer nur, solange die Lücke am Rand kleiner ist
   * als eine Aktualisierungsperiode.
   */
  const knownTo = covered?.to ?? extent?.maxT ?? range.to;
  const headGapSeconds = range.to - knownTo;
  const headIsFresh = head !== null && headGapSeconds <= descriptor.updateCadence;

  const plans = planFetches(range, extent, {
    headIsFresh,
    earliestSeconds: Math.floor(Date.parse(descriptor.earliest) / 1000),
    covered,
  });

  let warning: string | undefined;

  if (plans.length > 0) {
    const provider = getProvider(descriptor.provider);
    try {
      let newest: number | null = extent?.maxT ?? null;
      let askedFrom = covered?.from ?? Number.POSITIVE_INFINITY;
      let askedTo = covered?.to ?? Number.NEGATIVE_INFINITY;

      for (const plan of plans) {
        await takeTokenOrThrow(descriptor);
        const points = await provider.fetch(descriptor, { from: plan.from, to: plan.to });
        await writePoints(descriptor.id, points);

        // Den angefragten Bereich merken, auch wenn er leer blieb.
        askedFrom = Math.min(askedFrom, plan.from);
        askedTo = Math.max(askedTo, plan.to);

        const last = points[points.length - 1];
        if (last && (newest === null || last.t > newest)) newest = last.t;
      }

      await recordSuccess(descriptor.id, newest, { from: askedFrom, to: askedTo });
      // Rand als frisch markieren, damit die nächste Anfrage innerhalb der
      // updateCadence nicht erneut beim Provider landet.
      await cache.set(headCacheKey(descriptor.id), { checkedAt: Date.now() }, descriptor.updateCadence);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordFailure(descriptor.id, message);

      // Ohne Bestandsdaten gibt es nichts auszuliefern — Fehler durchreichen.
      if (!extent) throw error;

      // Mit Bestandsdaten: ausliefern, aber sichtbar als abgestanden markieren.
      warning = message;
    }
  }

  const points = await readPoints(descriptor.id, range);
  const sync = await readSyncState(descriptor.id);

  const response: SeriesResponse = {
    descriptor,
    points,
    lastUpdated: Math.floor((sync?.lastSuccessAt?.getTime() ?? Date.now()) / 1000),
    stale: warning !== undefined || isStale(sync?.lastSuccessAt ?? null, descriptor.updateCadence),
  };

  // Letzte Verteidigungslinie vor der Auslieferung (§11).
  assertRealData(response);

  return warning === undefined ? { response } : { response, warning };
}
