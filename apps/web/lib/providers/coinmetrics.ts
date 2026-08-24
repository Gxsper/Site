/**
 * Coin Metrics Community API (PROJECT_SPEC.md §4.1, §4.5).
 *
 * Backbone fuer alles Historische ab 2010. Kein API-Key, 1d-Frequenz.
 * Verifizierte Eigenheiten (docs/api-samples/FINDINGS.md §3):
 *
 *  - `paging_from` steht default auf `end`. Ohne `paging_from=start` liefert
 *    eine Abfrage die juengsten statt der aeltesten Datensaetze — ein Backfill
 *    wuerde still die falschen Zeitraeume laden.
 *  - Alle Werte sind Strings, teils mit mehr Stellen als ein float64 traegt.
 *  - `time` kommt mit Nanosekunden-Praezision.
 *  - Nicht jede Metrik ist im Community-Tier freigegeben; gesperrte Metriken
 *    beantwortet die API mit HTTP 403.
 */

import { z } from 'zod';

import { fetchJson } from '@/lib/providers/http';
import {
  assertStrictlyIncreasing,
  clampToRange,
  parseFiniteNumber,
  parseUtcSeconds,
} from '@/lib/providers/util';
import {
  ProviderError,
  type Provider,
  type SeriesDescriptor,
  type SeriesPoint,
  type SeriesRange,
} from '@/lib/series/types';

const PROVIDER = 'coinmetrics' as const;
const ROOT = 'https://community-api.coinmetrics.io/v4';

/** Vom Community-Tier akzeptiertes Maximum. */
const PAGE_SIZE = 10_000;
const MAX_PAGES = 100;

/**
 * Eine Zeile traegt `asset`, `time` und je Metrik ein Feld. Der Metrikname ist
 * dynamisch, deshalb `catchall`. `null` ist ein legitimer Wert und bedeutet
 * "an diesem Tag existiert kein Wert" — daraus wird eine Luecke, keine 0 (§11).
 */
const rowSchema = z
  .object({
    asset: z.string(),
    time: z.string(),
  })
  .catchall(z.union([z.string(), z.null()]));

const pageSchema = z.object({
  data: z.array(rowSchema),
  next_page_token: z.string().optional(),
  next_page_url: z.string().optional(),
});

interface CoinMetricsParams {
  asset: string;
  metric: string;
}

function readParams(descriptor: SeriesDescriptor): CoinMetricsParams {
  const asset = descriptor.providerParams['asset'];
  const metric = descriptor.providerParams['metric'];
  if (typeof asset !== 'string' || asset === '') {
    throw new ProviderError(PROVIDER, `${descriptor.id}: providerParams.asset fehlt`);
  }
  if (typeof metric !== 'string' || metric === '') {
    throw new ProviderError(PROVIDER, `${descriptor.id}: providerParams.metric fehlt`);
  }
  return { asset, metric };
}

/** ISO-Datum aus Unix-Sekunden, wie die API es fuer start_time/end_time erwartet. */
function toIsoDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

type Row = z.infer<typeof rowSchema>;
type Page = z.infer<typeof pageSchema>;

/**
 * Reine Umformung. Zeilen ohne Wert fuer die angefragte Metrik werden
 * uebersprungen — als Luecke, nicht als Null.
 */
export function mapRowsToPoints(
  rows: readonly Row[],
  metric: string,
  seriesId: string,
): SeriesPoint[] {
  const points: SeriesPoint[] = [];

  for (const row of rows) {
    const raw = row[metric];

    if (raw === undefined) {
      throw new ProviderError(
        PROVIDER,
        `${seriesId}: Antwort enthaelt kein Feld "${metric}" (Zeile ${row.time}). ` +
          `Metrikname pruefen oder Katalog neu erheben.`,
      );
    }
    if (raw === null) continue;

    points.push({
      t: parseUtcSeconds(row.time, PROVIDER, `${seriesId} time`),
      v: parseFiniteNumber(raw, PROVIDER, `${seriesId} ${metric} @${row.time}`),
    });
  }

  return points;
}

async function fetchMetric(
  descriptor: SeriesDescriptor,
  range: SeriesRange,
): Promise<SeriesPoint[]> {
  const { asset, metric } = readParams(descriptor);

  const params = new URLSearchParams({
    assets: asset,
    metrics: metric,
    frequency: '1d',
    page_size: String(PAGE_SIZE),
    start_time: toIsoDate(range.from),
    end_time: toIsoDate(range.to),
    // Ohne das hier laedt der Backfill die falschen Zeitraeume. Siehe FINDINGS.md §3.
    paging_from: 'start',
  });

  const points: SeriesPoint[] = [];
  let url: string | undefined = `${ROOT}/timeseries/asset-metrics?${params.toString()}`;

  for (let page = 0; page < MAX_PAGES && url; page++) {
    // Annotation nötig: `url` entsteht aus `body`, das macht die Ableitung zirkulär.
    const body: Page = await fetchJson(pageSchema, { provider: PROVIDER, url });
    points.push(...mapRowsToPoints(body.data, metric, descriptor.id));

    // Die API liefert die vollstaendige Folge-URL mit; sie selbst zusammen-
    // zubauen waere fehleranfaellig, weil der Token undurchsichtig ist.
    url = body.next_page_url;
    if (body.data.length === 0) break;
  }

  assertStrictlyIncreasing(points, PROVIDER, descriptor.id);
  return clampToRange(points, range);
}

export const coinMetricsProvider: Provider = {
  id: PROVIDER,
  catalog: async () => {
    const { CATALOG } = await import('@/lib/series/catalog');
    return CATALOG.filter((d) => d.provider === PROVIDER);
  },
  fetch: fetchMetric,
};

export const __testing = { pageSchema, rowSchema, readParams, toIsoDate };
