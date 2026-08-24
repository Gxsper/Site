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
 * erhältlich. Diese Datei liefert deshalb bewusst keine Zeitreihe, sondern nur
 * den aktuellen Stand — eine Zeitreihe aus einem einzigen Punkt wäre eine
 * Behauptung über Daten, die wir nicht haben (§11).
 */

import { z } from 'zod';

import { fetchJson } from '@/lib/providers/http';

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

export const __testing = { globalSchema };
