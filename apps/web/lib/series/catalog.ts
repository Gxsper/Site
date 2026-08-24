/**
 * Serien-Katalog (PROJECT_SPEC.md §3.1).
 *
 * Regel für diese Datei: **kein `earliest` ohne Beleg.** Jeder Eintrag wurde
 * gegen die echte API geprüft, die Belege stehen in docs/api-samples/FINDINGS.md.
 * Eine Serie, deren Historienbeginn nicht verifiziert ist, gehört nicht hierher
 * — geraten wäre sie eine Behauptung über Daten, die wir nicht haben (§0.3).
 *
 * Der Katalog wächst mit den Phasen. Alle aktuellen Quellen kommen ohne
 * API-Key aus, FRED über den CSV-Transport (docs/adr/0002-fred-transport.md).
 */

import type { SeriesDescriptor } from '@/lib/series/types';

const ATTRIBUTION_BINANCE = 'Marktdaten: Binance';
const ATTRIBUTION_COINMETRICS = 'Daten: Coin Metrics Community API';
const ATTRIBUTION_ALTERNATIVEME = 'Fear & Greed Index: alternative.me';
const ATTRIBUTION_FRED = 'Makrodaten: Federal Reserve Bank of St. Louis (FRED)';

/** Eine Stunde. Tagesserien werden häufiger geprüft als sie sich ändern, damit
 *  der letzte Tageswert zeitnah ankommt; der Cache fängt das ab (§10). */
const HOURLY = 3600;
const SIX_HOURS = 21_600;

export const CATALOG: readonly SeriesDescriptor[] = [
  // ---------------------------------------------------------------- Crypto
  {
    id: 'btc.usd.close',
    label: 'Bitcoin (USD, Binance)',
    group: 'crypto',
    unit: 'usd',
    nativeFrequency: '1d',
    provider: 'binance',
    providerParams: { symbol: 'BTCUSDT', interval: '1d' },
    // Verifiziert: erster 1d-Kline BTCUSDT am 2017-08-17, Close 4285.08
    earliest: '2017-08-17T00:00:00Z',
    supportsLog: true,
    updateCadence: HOURLY,
    attribution: ATTRIBUTION_BINANCE,
  },
  {
    id: 'eth.usd.close',
    label: 'Ethereum (USD, Binance)',
    group: 'crypto',
    unit: 'usd',
    nativeFrequency: '1d',
    provider: 'binance',
    providerParams: { symbol: 'ETHUSDT', interval: '1d' },
    // Verifiziert: erster 1d-Kline ETHUSDT am 2017-08-17, Close 302.00
    earliest: '2017-08-17T00:00:00Z',
    supportsLog: true,
    updateCadence: HOURLY,
    attribution: ATTRIBUTION_BINANCE,
  },
  {
    /**
     * Die Langhistorie. Binance beginnt erst 2017 — für Zyklusvergleiche über
     * mehrere Halvings ist das zu kurz. §4.1 sieht deshalb einen Splice vor;
     * bis dahin steht diese Reihe eigenständig daneben.
     */
    id: 'btc.usd.cm',
    label: 'Bitcoin (USD, Coin Metrics)',
    group: 'crypto',
    unit: 'usd',
    nativeFrequency: '1d',
    provider: 'coinmetrics',
    providerParams: { asset: 'btc', metric: 'PriceUSD' },
    // Verifiziert: erster Wert 2010-07-18, 0.08584 USD
    earliest: '2010-07-18T00:00:00Z',
    supportsLog: true,
    updateCadence: SIX_HOURS,
    attribution: ATTRIBUTION_COINMETRICS,
  },

  // --------------------------------------------------------------- On-Chain
  {
    id: 'onchain.btc.marketcap',
    label: 'Bitcoin Market Cap',
    group: 'onchain',
    unit: 'usd',
    nativeFrequency: '1d',
    provider: 'coinmetrics',
    providerParams: { asset: 'btc', metric: 'CapMrktCurUSD' },
    earliest: '2010-07-18T00:00:00Z',
    supportsLog: true,
    updateCadence: SIX_HOURS,
    attribution: ATTRIBUTION_COINMETRICS,
  },
  {
    id: 'onchain.btc.supply',
    label: 'Bitcoin Umlaufmenge',
    group: 'onchain',
    unit: 'count',
    nativeFrequency: '1d',
    provider: 'coinmetrics',
    providerParams: { asset: 'btc', metric: 'SplyCur' },
    earliest: '2009-01-03T00:00:00Z',
    supportsLog: true,
    updateCadence: SIX_HOURS,
    attribution: ATTRIBUTION_COINMETRICS,
  },
  {
    /**
     * MVRV kommt direkt von Coin Metrics. Wichtig für §6.5: `CapRealUSD` ist im
     * Community-Tier gesperrt (HTTP 403), lässt sich aber als
     * `CapMrktCurUSD / CapMVRVCur` exakt rekonstruieren. Realized Price, MVRV-Z
     * und NUPL bleiben damit berechenbar.
     */
    id: 'onchain.btc.mvrv',
    label: 'Bitcoin MVRV',
    group: 'onchain',
    unit: 'ratio',
    nativeFrequency: '1d',
    provider: 'coinmetrics',
    providerParams: { asset: 'btc', metric: 'CapMVRVCur' },
    earliest: '2010-07-18T00:00:00Z',
    supportsLog: true,
    updateCadence: SIX_HOURS,
    attribution: ATTRIBUTION_COINMETRICS,
  },
  {
    id: 'onchain.btc.hashrate',
    label: 'Bitcoin Hashrate',
    group: 'onchain',
    unit: 'hashrate',
    nativeFrequency: '1d',
    provider: 'coinmetrics',
    providerParams: { asset: 'btc', metric: 'HashRate' },
    earliest: '2009-01-09T00:00:00Z',
    supportsLog: true,
    updateCadence: SIX_HOURS,
    attribution: ATTRIBUTION_COINMETRICS,
  },

  // ------------------------------------------------------------------ Makro
  // Einheiten am 2026-08-24 direkt bei FRED nachgeschlagen. Die Angaben in
  // PROJECT_SPEC.md §4.3 sind für WTREGEN und WRESBAL falsch — beide sind in
  // Millionen, nicht in Milliarden. Siehe docs/api-samples/FINDINGS.md §6.
  {
    id: 'fred.WALCL',
    label: 'Fed Bilanzsumme (WALCL)',
    group: 'macro',
    unit: 'usd_bn',
    nativeFrequency: '1w',
    provider: 'fred',
    providerParams: { series_id: 'WALCL', scale: 0.001 },
    earliest: '2002-12-18T00:00:00Z',
    supportsLog: true,
    updateCadence: SIX_HOURS,
    attribution: ATTRIBUTION_FRED,
  },
  {
    id: 'fred.WTREGEN',
    label: 'Treasury General Account (WTREGEN)',
    group: 'macro',
    unit: 'usd_bn',
    nativeFrequency: '1w',
    provider: 'fred',
    providerParams: { series_id: 'WTREGEN', scale: 0.001 },
    earliest: '2002-12-18T00:00:00Z',
    supportsLog: true,
    updateCadence: SIX_HOURS,
    attribution: ATTRIBUTION_FRED,
  },
  {
    id: 'fred.RRPONTSYD',
    label: 'Overnight Reverse Repo (RRPONTSYD)',
    group: 'macro',
    unit: 'usd_bn',
    nativeFrequency: '1d',
    provider: 'fred',
    providerParams: { series_id: 'RRPONTSYD', scale: 1 },
    earliest: '2003-02-07T00:00:00Z',
    supportsLog: false,
    updateCadence: SIX_HOURS,
    attribution: ATTRIBUTION_FRED,
  },
  {
    id: 'fred.WM2NS',
    label: 'US M2 Geldmenge (WM2NS)',
    group: 'macro',
    unit: 'usd_bn',
    nativeFrequency: '1w',
    provider: 'fred',
    providerParams: { series_id: 'WM2NS', scale: 1 },
    earliest: '1981-01-05T00:00:00Z',
    supportsLog: true,
    updateCadence: SIX_HOURS,
    attribution: ATTRIBUTION_FRED,
  },
  {
    /**
     * Das Hauptchart der Macro-Seite (§8). Formel und Einheiten-Behandlung in
     * lib/metrics/net-liquidity.ts, Methodik im UI-Tooltip.
     */
    id: 'macro.net_liquidity',
    label: 'Fed Net Liquidity',
    group: 'macro',
    unit: 'usd_bn',
    nativeFrequency: '1d',
    provider: 'derived',
    providerParams: {},
    // Erst ab hier existieren alle drei Komponenten — RRPONTSYD ist die jüngste.
    earliest: '2003-02-07T00:00:00Z',
    supportsLog: false,
    updateCadence: SIX_HOURS,
    attribution: ATTRIBUTION_FRED,
  },

  // ------------------------------------------------------------------ Zinsen
  {
    id: 'fred.DGS10',
    label: 'US 10Y Treasury Yield',
    group: 'rates',
    unit: 'pct',
    nativeFrequency: '1d',
    provider: 'fred',
    providerParams: { series_id: 'DGS10', scale: 1 },
    earliest: '1962-01-02T00:00:00Z',
    supportsLog: false,
    updateCadence: SIX_HOURS,
    attribution: ATTRIBUTION_FRED,
  },
  {
    id: 'fred.T10Y2Y',
    label: 'Zinskurve 10Y minus 2Y',
    group: 'rates',
    unit: 'pct',
    nativeFrequency: '1d',
    provider: 'fred',
    providerParams: { series_id: 'T10Y2Y', scale: 1 },
    earliest: '1976-06-01T00:00:00Z',
    // Wird regelmäßig negativ — invertierte Kurve.
    supportsLog: false,
    updateCadence: SIX_HOURS,
    attribution: ATTRIBUTION_FRED,
  },

  // ------------------------------------------------------- Aktien / Volatilität
  {
    id: 'fred.VIXCLS',
    label: 'VIX',
    group: 'equities',
    unit: 'index',
    nativeFrequency: '1d',
    provider: 'fred',
    providerParams: { series_id: 'VIXCLS', scale: 1 },
    earliest: '1990-01-02T00:00:00Z',
    supportsLog: true,
    updateCadence: SIX_HOURS,
    attribution: ATTRIBUTION_FRED,
  },
  {
    /**
     * ⚠️ Nur ~10 Jahre Historie — FRED hält für SP500 ein rollierendes Fenster
     * vor (verifiziert: Beginn 2016-08-22). Für Zyklusvergleiche über mehrere
     * Halvings zu kurz; §4.2 sieht dafür eine andere Quelle vor, die noch
     * offen ist. Als Makro-Overlay der letzten Jahre brauchbar.
     */
    id: 'fred.SP500',
    label: 'S&P 500 (FRED, ~10 Jahre)',
    group: 'equities',
    unit: 'index',
    nativeFrequency: '1d',
    provider: 'fred',
    providerParams: { series_id: 'SP500', scale: 1 },
    earliest: '2016-08-22T00:00:00Z',
    supportsLog: true,
    updateCadence: SIX_HOURS,
    attribution: ATTRIBUTION_FRED,
  },
  {
    id: 'fred.DTWEXBGS',
    label: 'US-Dollar-Index breit (DTWEXBGS)',
    group: 'fx',
    unit: 'index',
    nativeFrequency: '1d',
    provider: 'fred',
    providerParams: { series_id: 'DTWEXBGS', scale: 1 },
    earliest: '2006-01-02T00:00:00Z',
    supportsLog: true,
    updateCadence: SIX_HOURS,
    attribution: ATTRIBUTION_FRED,
  },

  // -------------------------------------------------------------- Sentiment
  {
    id: 'sentiment.fng',
    label: 'Crypto Fear & Greed Index',
    group: 'sentiment',
    unit: 'index',
    nativeFrequency: '1d',
    provider: 'alternativeme',
    providerParams: {},
    // Verifiziert: ältester Eintrag 2018-02-01, Wert 30
    earliest: '2018-02-01T00:00:00Z',
    supportsLog: false,
    updateCadence: HOURLY,
    attribution: ATTRIBUTION_ALTERNATIVEME,
  },
];

const BY_ID = new Map(CATALOG.map((d) => [d.id, d]));

export function findDescriptor(id: string): SeriesDescriptor | undefined {
  return BY_ID.get(id);
}

export function listDescriptors(): readonly SeriesDescriptor[] {
  return CATALOG;
}
