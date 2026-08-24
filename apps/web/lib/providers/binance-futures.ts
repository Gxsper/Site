/**
 * Binance USDⓈ-M Futures — Open Interest, Funding, Long/Short (PROJECT_SPEC.md §4.4).
 *
 * Kein API-Key nötig. Verifizierte Eigenheiten (docs/api-samples/FINDINGS.md §8):
 *
 *  - `openInterestHist` reicht **nur 31 Tage** zurück, auch mit `limit=500`.
 *    Wer eine längere OI-Historie will, muss sie selbst mitschreiben — genau
 *    dafür gibt es die Persistenz in Postgres (§10 Layer 1).
 *  - `fundingRate` hat dagegen die volle Historie, paginiert über `startTime`.
 *  - Funding-Zeitstempel liegen ein paar Millisekunden neben der 8h-Grenze und
 *    werden vor dem Speichern auf das Intervall gerundet.
 *  - Alle Zahlen kommen als Strings.
 */

import { z } from 'zod';

import { fetchJson } from '@/lib/providers/http';
import {
  assertStrictlyIncreasing,
  clampToRange,
  msToUtcSeconds,
  parseFiniteNumber,
} from '@/lib/providers/util';
import {
  ProviderError,
  type Provider,
  type SeriesDescriptor,
  type SeriesPoint,
  type SeriesRange,
} from '@/lib/series/types';

const PROVIDER = 'binance' as const;
const FUTURES_ROOT = 'https://fapi.binance.com';

/** Maximum des Funding-Endpunkts. */
const FUNDING_LIMIT = 1000;
const MAX_PAGES = 200;

/** Achtstundenraster des Funding-Intervalls. */
const FUNDING_INTERVAL_MS = 8 * 3600 * 1000;

const openInterestSchema = z.array(
  z.object({
    symbol: z.string(),
    /** Kontrakte in Basiswährung. */
    sumOpenInterest: z.string(),
    /** Gegenwert in USD. */
    sumOpenInterestValue: z.string(),
    timestamp: z.number(),
  }),
);

const fundingSchema = z.array(
  z.object({
    symbol: z.string(),
    fundingTime: z.number(),
    fundingRate: z.string(),
    markPrice: z.string().optional(),
    rateType: z.string().optional(),
  }),
);

const longShortSchema = z.array(
  z.object({
    symbol: z.string(),
    longAccount: z.string(),
    longShortRatio: z.string(),
    shortAccount: z.string(),
    timestamp: z.number(),
  }),
);

type DerivativeKind = 'open_interest' | 'open_interest_value' | 'funding' | 'long_short_ratio';

function readParams(descriptor: SeriesDescriptor): { symbol: string; kind: DerivativeKind } {
  const symbol = descriptor.providerParams['symbol'];
  const kind = descriptor.providerParams['kind'];

  if (typeof symbol !== 'string' || symbol === '') {
    throw new ProviderError(PROVIDER, `${descriptor.id}: providerParams.symbol fehlt`);
  }
  if (
    kind !== 'open_interest' &&
    kind !== 'open_interest_value' &&
    kind !== 'funding' &&
    kind !== 'long_short_ratio'
  ) {
    throw new ProviderError(
      PROVIDER,
      `${descriptor.id}: providerParams.kind muss open_interest, open_interest_value, ` +
        `funding oder long_short_ratio sein`,
    );
  }
  return { symbol, kind };
}

/** Rundet einen Funding-Zeitstempel auf das 8h-Raster (§4.4). */
export function roundFundingTime(ms: number): number {
  return Math.round(ms / FUNDING_INTERVAL_MS) * FUNDING_INTERVAL_MS;
}

async function fetchOpenInterest(
  descriptor: SeriesDescriptor,
  range: SeriesRange,
  valueInUsd: boolean,
): Promise<SeriesPoint[]> {
  const { symbol } = readParams(descriptor);
  const url =
    `${FUTURES_ROOT}/futures/data/openInterestHist` +
    `?symbol=${encodeURIComponent(symbol)}&period=1d&limit=500`;

  const rows = await fetchJson(openInterestSchema, { provider: PROVIDER, url });

  const points = rows.map((row) => ({
    t: msToUtcSeconds(row.timestamp, PROVIDER, `${descriptor.id} timestamp`),
    v: parseFiniteNumber(
      valueInUsd ? row.sumOpenInterestValue : row.sumOpenInterest,
      PROVIDER,
      `${descriptor.id} @${row.timestamp}`,
    ),
  }));

  assertStrictlyIncreasing(points, PROVIDER, descriptor.id);
  return clampToRange(points, range);
}

async function fetchFunding(
  descriptor: SeriesDescriptor,
  range: SeriesRange,
): Promise<SeriesPoint[]> {
  const { symbol } = readParams(descriptor);
  const endMs = range.to * 1000;
  let startMs = range.from * 1000;

  const points: SeriesPoint[] = [];
  const seen = new Set<number>();

  for (let page = 0; page < MAX_PAGES; page++) {
    const url =
      `${FUTURES_ROOT}/fapi/v1/fundingRate?symbol=${encodeURIComponent(symbol)}` +
      `&startTime=${startMs}&endTime=${endMs}&limit=${FUNDING_LIMIT}`;

    const rows = await fetchJson(fundingSchema, { provider: PROVIDER, url });
    if (rows.length === 0) break;

    for (const row of rows) {
      const rounded = roundFundingTime(row.fundingTime);
      const t = msToUtcSeconds(rounded, PROVIDER, `${descriptor.id} fundingTime`);
      // Nach dem Runden können zwei Meldungen auf denselben Slot fallen.
      if (seen.has(t)) continue;
      seen.add(t);
      points.push({
        t,
        v: parseFiniteNumber(row.fundingRate, PROVIDER, `${descriptor.id} @${row.fundingTime}`),
      });
    }

    if (rows.length < FUNDING_LIMIT) break;
    const last = rows[rows.length - 1]!.fundingTime;
    startMs = last + 1;
    if (startMs > endMs) break;
  }

  points.sort((a, b) => a.t - b.t);
  assertStrictlyIncreasing(points, PROVIDER, descriptor.id);
  return clampToRange(points, range);
}

async function fetchLongShort(
  descriptor: SeriesDescriptor,
  range: SeriesRange,
): Promise<SeriesPoint[]> {
  const { symbol } = readParams(descriptor);
  const url =
    `${FUTURES_ROOT}/futures/data/globalLongShortAccountRatio` +
    `?symbol=${encodeURIComponent(symbol)}&period=1d&limit=500`;

  const rows = await fetchJson(longShortSchema, { provider: PROVIDER, url });

  const points = rows.map((row) => ({
    t: msToUtcSeconds(row.timestamp, PROVIDER, `${descriptor.id} timestamp`),
    v: parseFiniteNumber(row.longShortRatio, PROVIDER, `${descriptor.id} @${row.timestamp}`),
  }));

  assertStrictlyIncreasing(points, PROVIDER, descriptor.id);
  return clampToRange(points, range);
}

export const binanceFuturesProvider: Provider = {
  id: PROVIDER,
  catalog: async () => {
    const { CATALOG } = await import('@/lib/series/catalog');
    return CATALOG.filter((d) => d.provider === PROVIDER && 'kind' in d.providerParams);
  },
  fetch: async (descriptor, range) => {
    const { kind } = readParams(descriptor);
    switch (kind) {
      case 'open_interest':
        return fetchOpenInterest(descriptor, range, false);
      case 'open_interest_value':
        return fetchOpenInterest(descriptor, range, true);
      case 'funding':
        return fetchFunding(descriptor, range);
      case 'long_short_ratio':
        return fetchLongShort(descriptor, range);
    }
  },
};

export const __testing = { openInterestSchema, fundingSchema, longShortSchema, readParams };
