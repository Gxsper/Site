/**
 * Binance Spot — Klines (PROJECT_SPEC.md §4.1).
 *
 * Kein API-Key noetig, Historie ab 2017-08-17 (verifiziert, nicht angenommen).
 * Response-Shape siehe docs/api-samples/binance-klines.json und FINDINGS.md §1:
 * ein Array von Arrays, Zeitstempel in Millisekunden, Preise als Strings.
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
const SPOT_ROOT = 'https://api.binance.com';

/** `limit` ist bei diesem Endpunkt hart auf 1000 gedeckelt. */
const MAX_LIMIT = 1000;

/** Schutz gegen eine Endlosschleife, falls der Endpunkt sich unerwartet verhaelt. */
const MAX_PAGES = 500;

/**
 * Binance haengt gelegentlich Felder an. `.rest(z.unknown())` laesst zusaetzliche
 * Positionen zu, ohne die geprueften Positionen aufzuweichen.
 */
const klineSchema = z
  .tuple([
    z.number(), //  0 openTime (ms)
    z.string(), //  1 open
    z.string(), //  2 high
    z.string(), //  3 low
    z.string(), //  4 close
    z.string(), //  5 volume
    z.number(), //  6 closeTime (ms)
    z.string(), //  7 quoteAssetVolume
    z.number(), //  8 trades
    z.string(), //  9 takerBuyBaseVolume
    z.string(), // 10 takerBuyQuoteVolume
  ])
  .rest(z.unknown());

const klinesSchema = z.array(klineSchema);

const OPEN_TIME = 0;
const CLOSE = 4;

interface BinanceParams {
  symbol: string;
  interval: string;
}

function readParams(descriptor: SeriesDescriptor): BinanceParams {
  const symbol = descriptor.providerParams['symbol'];
  const interval = descriptor.providerParams['interval'];
  if (typeof symbol !== 'string' || symbol === '') {
    throw new ProviderError(PROVIDER, `${descriptor.id}: providerParams.symbol fehlt`);
  }
  if (typeof interval !== 'string' || interval === '') {
    throw new ProviderError(PROVIDER, `${descriptor.id}: providerParams.interval fehlt`);
  }
  return { symbol, interval };
}

type Kline = z.infer<typeof klineSchema>;

/**
 * Reine Umformung Kline → SeriesPoint. Ohne Netzwerk, damit die eigentliche
 * Fehlerquelle — Indexpositionen, Einheiten, Zeitbasis — direkt testbar ist.
 */
export function mapKlinesToPoints(rows: readonly Kline[], seriesId: string): SeriesPoint[] {
  return rows.map((row) => {
    const openTimeMs = row[OPEN_TIME];
    return {
      t: msToUtcSeconds(openTimeMs, PROVIDER, `${seriesId} openTime`),
      v: parseFiniteNumber(row[CLOSE], PROVIDER, `${seriesId} close @${openTimeMs}`),
    };
  });
}

async function fetchKlines(
  descriptor: SeriesDescriptor,
  range: SeriesRange,
): Promise<SeriesPoint[]> {
  const { symbol, interval } = readParams(descriptor);
  const endMs = range.to * 1000;

  const points: SeriesPoint[] = [];
  let startMs = range.from * 1000;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url =
      `${SPOT_ROOT}/api/v3/klines?symbol=${encodeURIComponent(symbol)}` +
      `&interval=${encodeURIComponent(interval)}` +
      `&startTime=${startMs}&endTime=${endMs}&limit=${MAX_LIMIT}`;

    const rows = await fetchJson(klinesSchema, { provider: PROVIDER, url });

    // Leer heisst hier nachweislich "keine weiteren Daten im Fenster" — der
    // Endpunkt signalisiert Fehler ueber HTTP-Status, nicht ueber ein leeres
    // Array. Deshalb ist der Abbruch an dieser Stelle korrekt (§3.2).
    if (rows.length === 0) break;

    points.push(...mapKlinesToPoints(rows, descriptor.id));

    if (rows.length < MAX_LIMIT) break;

    const lastOpenMs = rows[rows.length - 1]![OPEN_TIME];
    // Eine Millisekunde weiter, sonst liefert die naechste Seite denselben
    // Kline noch einmal und die Reihe waere nicht mehr streng monoton.
    startMs = lastOpenMs + 1;
    if (startMs > endMs) break;
  }

  assertStrictlyIncreasing(points, PROVIDER, descriptor.id);
  return clampToRange(points, range);
}

/**
 * Spot und Futures teilen sich die ProviderId `binance`. Statt dafür einen
 * zweiten Enum-Wert samt Datenbank-Migration einzuführen, entscheidet
 * `providerParams.kind`: ist es gesetzt, geht die Anfrage an die
 * Futures-Endpunkte (Open Interest, Funding, Long/Short), sonst an die Klines.
 */
export const binanceProvider: Provider = {
  id: PROVIDER,
  catalog: async () => {
    const { CATALOG } = await import('@/lib/series/catalog');
    return CATALOG.filter((d) => d.provider === PROVIDER);
  },
  fetch: async (descriptor, range) => {
    if ('kind' in descriptor.providerParams) {
      const { binanceFuturesProvider } = await import('@/lib/providers/binance-futures');
      return binanceFuturesProvider.fetch(descriptor, range);
    }
    return fetchKlines(descriptor, range);
  },
};

/** Nur fuer Tests: die reine Umformung ohne Netzwerkzugriff. */
export const __testing = { klinesSchema, readParams, OPEN_TIME, CLOSE };
