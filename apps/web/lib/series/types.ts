/**
 * Die zentrale Abstraktion (PROJECT_SPEC.md §3.1).
 * Alles im Frontend spricht nur diese Sprache — kein Chart kennt einen Provider.
 *
 * Zeit ist ueberall Unix-Sekunden in UTC (§0.4).
 */

export type Frequency =
  | 'tick'
  | '1m'
  | '5m'
  | '1h'
  | '4h'
  | '1d'
  | '1w'
  | '1mo'
  | 'irregular';

export type SeriesGroup =
  | 'crypto'
  | 'equities'
  | 'fx'
  | 'rates'
  | 'macro'
  | 'onchain'
  | 'derivatives'
  | 'sentiment';

export type SeriesUnit =
  | 'usd'
  | 'pct'
  | 'ratio'
  | 'index'
  | 'bps'
  | 'usd_bn'
  | 'hashrate'
  | 'count';

/** Provider werden ab Phase 1 implementiert; die IDs stehen hier zentral. */
export type ProviderId =
  | 'fred'
  | 'binance'
  | 'bybit'
  | 'coinmetrics'
  | 'coingecko'
  | 'stooq'
  | 'coinglass'
  | 'yahoo'
  | 'alternativeme'
  | 'mempool'
  | 'derived';

export interface SeriesDescriptor {
  /** z.B. 'btc.usd.close', 'fred.WALCL', 'spx.close', 'onchain.mvrv' */
  id: string;
  label: string;
  group: SeriesGroup;
  unit: SeriesUnit;
  nativeFrequency: Frequency;
  provider: ProviderId;
  providerParams: Record<string, string | number>;
  /** ISO — echter Start der Historie, NICHT geraten. */
  earliest: string;
  /** false bei Serien, die <= 0 werden koennen. */
  supportsLog: boolean;
  /** Sekunden — bestimmt Cache-TTL und Polling. */
  updateCadence: number;
  /** Pflichttext fuer die UI (§15). */
  attribution: string;
}

/** t = Unix seconds UTC. */
export interface SeriesPoint {
  t: number;
  v: number;
}

export interface SeriesResponse {
  descriptor: SeriesDescriptor;
  points: SeriesPoint[];
  lastUpdated: number;
  /** true wenn aus Cache und aelter als updateCadence * 3. */
  stale: boolean;
}

export interface SeriesRange {
  from: number;
  to: number;
}

/**
 * Provider-Interface (§3.2).
 *
 * `fetch` wirft `ProviderError` bei Fehlern und gibt NIEMALS ein leeres Array
 * als Fallback zurueck, um einen Fehler zu verstecken. Ein leeres Array
 * bedeutet ausschliesslich: in diesem Zeitraum existieren nachweislich keine Daten.
 */
export interface Provider {
  id: ProviderId;
  catalog(): Promise<SeriesDescriptor[]>;
  fetch(descriptor: SeriesDescriptor, range: SeriesRange): Promise<SeriesPoint[]>;
}

export class ProviderError extends Error {
  override readonly name = 'ProviderError';
  readonly provider: ProviderId;

  constructor(provider: ProviderId, message: string, options?: ErrorOptions) {
    super(`[${provider}] ${message}`, options);
    this.provider = provider;
  }
}
