/**
 * alternative.me — Crypto Fear & Greed Index (PROJECT_SPEC.md §4.6).
 *
 * Kein Key, volle Historie ab 2018-02-01 (verifiziert: 3123 Eintraege).
 * Verifizierte Eigenheiten (docs/api-samples/FINDINGS.md §4):
 *
 *  - `value` und `timestamp` sind Strings, `timestamp` bereits in Sekunden.
 *  - `time_until_update` gibt es nur beim juengsten Eintrag.
 *  - Die Reihenfolge ist absteigend und muss umgedreht werden.
 *  - `metadata.error` ist der Fehlerkanal und im Erfolgsfall `null`.
 */

import { z } from 'zod';

import { fetchJson } from '@/lib/providers/http';
import {
  assertStrictlyIncreasing,
  clampToRange,
  parseFiniteNumber,
} from '@/lib/providers/util';
import {
  ProviderError,
  type Provider,
  type SeriesDescriptor,
  type SeriesPoint,
  type SeriesRange,
} from '@/lib/series/types';

const PROVIDER = 'alternativeme' as const;
const ROOT = 'https://api.alternative.me';

const entrySchema = z.object({
  value: z.string(),
  value_classification: z.string(),
  timestamp: z.string(),
  time_until_update: z.string().optional(),
});

const fngSchema = z.object({
  name: z.string(),
  data: z.array(entrySchema),
  metadata: z.object({ error: z.string().nullable() }),
});

type Entry = z.infer<typeof entrySchema>;

/**
 * Reine Umformung: absteigende String-Eintraege zu aufsteigenden SeriesPoints.
 */
export function mapEntriesToPoints(entries: readonly Entry[], seriesId: string): SeriesPoint[] {
  const points = entries.map((entry) => ({
    t: parseFiniteNumber(entry.timestamp, PROVIDER, `${seriesId} timestamp`),
    v: parseFiniteNumber(entry.value, PROVIDER, `${seriesId} value @${entry.timestamp}`),
  }));

  // Die API liefert neueste zuerst. Aufsteigend sortieren statt nur umdrehen —
  // die Reihenfolge ist dokumentiert, aber nicht vertraglich zugesichert.
  points.sort((a, b) => a.t - b.t);
  return points;
}

async function fetchIndex(
  descriptor: SeriesDescriptor,
  range: SeriesRange,
): Promise<SeriesPoint[]> {
  // `limit=0` liefert die vollstaendige Historie. Der Endpunkt kennt keine
  // Zeitraumfilter, deshalb wird serverseitig zugeschnitten. Bei ~3000
  // Tageswerten ist das unkritisch und spart Paginierungslogik.
  const url = `${ROOT}/fng/?limit=0&format=json`;
  const body = await fetchJson(fngSchema, { provider: PROVIDER, url });

  if (body.metadata.error !== null) {
    throw new ProviderError(PROVIDER, `${descriptor.id}: API meldet "${body.metadata.error}"`);
  }

  const points = mapEntriesToPoints(body.data, descriptor.id);
  assertStrictlyIncreasing(points, PROVIDER, descriptor.id);
  return clampToRange(points, range);
}

export const alternativeMeProvider: Provider = {
  id: PROVIDER,
  catalog: async () => {
    const { CATALOG } = await import('@/lib/series/catalog');
    return CATALOG.filter((d) => d.provider === PROVIDER);
  },
  fetch: fetchIndex,
};

export const __testing = { fngSchema, entrySchema };
