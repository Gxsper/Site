/**
 * CoinGecko (PROJECT_SPEC.md §4.1) — ausschließlich `/global`.
 *
 * ══ Warum nur dieser eine Endpunkt ══
 *
 * Am 2026-08-24 geprüft (docs/api-samples/FINDINGS.md §7):
 *
 *   /global                             → HTTP 200, nur eine Momentaufnahme
 *   /global/market_cap_chart            → HTTP 401, PRO-Abo erforderlich
 *   /coins/{id}/market_chart/range      → HTTP 401 über 365 Tage hinaus
 *
 * Eine **historische** Dominance ist mit dem freien Zugang damit nicht
 * erhältlich — und wird hier auch nicht erfunden.
 *
 * Stattdessen dasselbe Vorgehen wie bei Liquidationen und Open Interest: der
 * Nachtjob holt den aktuellen Stand täglich, die Persistenzschicht behält ihn,
 * und daraus wächst eine echte Zeitreihe — beginnend beim ersten Lauf, nicht
 * rückwirkend (§10 Layer 1, §11).
 */

import { z } from 'zod';

import { fetchJson } from '@/lib/providers/http';
import {
  ProviderError,
  type Provider,
  type SeriesDescriptor,
  type SeriesPoint,
  type SeriesRange,
} from '@/lib/series/types';

const PROVIDER = 'coingecko' as const;
const ROOT = 'https://api.coingecko.com/api/v3';

const globalSchema = z.object({
  data: z.object({
    active_cryptocurrencies: z.number(),
    total_market_cap: z.record(z.string(), z.number()),
    total_volume: z.record(z.string(), z.number()),
    market_cap_percentage: z.record(z.string(), z.number()),
    market_cap_change_percentage_24h_usd: z.number(),
    /** Unix-Sekunden. */
    updated_at: z.number(),
  }),
});

export interface GlobalSnapshot {
  /** Unix-Sekunden UTC, wann CoinGecko den Stand erhoben hat. */
  updatedAt: number;
  totalMarketCapUsd: number;
  totalVolumeUsd: number;
  /** Anteile in Prozent, z. B. `{ btc: 59.1, eth: 11.2 }`. */
  dominancePct: Record<string, number>;
  activeCryptocurrencies: number;
  change24hPct: number;
  attribution: string;
  methodology: string;
}

/**
 * Aktueller Marktüberblick. Bewusst kein `Provider`-Interface: das beschreibt
 * Zeitreihen, und hier gibt es nachweislich keine.
 */
export async function fetchGlobalSnapshot(): Promise<GlobalSnapshot> {
  const body = await fetchJson(globalSchema, {
    provider: PROVIDER,
    url: `${ROOT}/global`,
  });

  const data = body.data;

  return {
    updatedAt: data.updated_at,
    totalMarketCapUsd: data.total_market_cap['usd'] ?? Number.NaN,
    totalVolumeUsd: data.total_volume['usd'] ?? Number.NaN,
    dominancePct: data.market_cap_percentage,
    activeCryptocurrencies: data.active_cryptocurrencies,
    change24hPct: data.market_cap_change_percentage_24h_usd,
    attribution: 'Marktüberblick: CoinGecko',
    methodology:
      'Momentaufnahme von CoinGecko /global. Eine historische Dominance-Reihe ' +
      'ist im freien Zugang nicht erhältlich: /global/market_cap_chart erfordert ' +
      'ein PRO-Abo, und Kursverläufe reichen nur 365 Tage zurück. Für ' +
      'Zyklusvergleiche über mehrere Halvings wäre ein bezahlter Zugang nötig.',
  };
}

/**
 * Provider für die selbst aufgezeichnete Dominance.
 *
 * ══ Warum das anders funktioniert als jeder andere Provider ══
 *
 * Alle übrigen Provider holen Historie. Dieser kann das nicht — CoinGecko gibt
 * sie im freien Zugang nicht heraus. Er liefert deshalb **genau einen Punkt**:
 * den aktuellen Stand. Die Zeitreihe entsteht dadurch, dass der Nachtjob
 * diesen Punkt täglich holt und die Persistenzschicht ihn behält (§10 Layer 1).
 *
 * Ein Abruf für einen vergangenen Zeitraum liefert entsprechend nichts — und
 * das ist die richtige Antwort, nicht ein Fehler: für gestern existiert
 * nachweislich kein Wert, den wir hätten holen können (§3.2).
 */
async function fetchDominancePoint(
  descriptor: SeriesDescriptor,
  range: SeriesRange,
): Promise<SeriesPoint[]> {
  const field = descriptor.providerParams['field'];
  if (typeof field !== 'string' || field === '') {
    throw new ProviderError(PROVIDER, `${descriptor.id}: providerParams.field fehlt`);
  }

  const snapshot = await fetchGlobalSnapshot();

  const value =
    field === 'total' ? snapshot.totalMarketCapUsd : (snapshot.dominancePct[field] ?? null);

  if (value === null || !Number.isFinite(value)) {
    throw new ProviderError(
      PROVIDER,
      `${descriptor.id}: CoinGecko liefert kein Feld "${field}" im aktuellen Stand.`,
    );
  }

  // Auf den UTC-Tagesbeginn abrunden — eine Tagesreihe braucht eine
  // Tagesmarke, sonst entstünde je Lauf ein neuer Punkt am selben Tag.
  const t = Math.floor(snapshot.updatedAt / 86_400) * 86_400;

  // Liegt der heutige Tag außerhalb des angefragten Zeitraums, gibt es nichts
  // beizusteuern. Vergangene Tage existieren bei dieser Quelle schlicht nicht.
  if (t < range.from || t > range.to) return [];

  return [{ t, v: value }];
}

export const coinGeckoProvider: Provider = {
  id: PROVIDER,
  catalog: async () => {
    const { CATALOG } = await import('@/lib/series/catalog');
    return CATALOG.filter((d) => d.provider === PROVIDER);
  },
  fetch: fetchDominancePoint,
};

export const __testing = { globalSchema };
