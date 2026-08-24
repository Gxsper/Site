/**
 * On-Chain-Bewertung (PROJECT_SPEC.md §6.5).
 *
 *   Realized Price = CapRealUSD / SplyCur
 *   MVRV           = CapMrktCurUSD / CapRealUSD
 *   MVRV-Z         = (CapMrktCurUSD − CapRealUSD) / stdev(CapMrktCurUSD)  [expanding]
 *   NUPL           = (CapMrktCurUSD − CapRealUSD) / CapMrktCurUSD
 *   Puell Multiple = RevUSD / SMA(RevUSD, 365)
 *
 * ══ Woher CapRealUSD kommt ══
 *
 * Coin Metrics gibt `CapRealUSD` im Community-Tier nicht frei (HTTP 403,
 * verifiziert — docs/api-samples/FINDINGS.md §3). `CapMVRVCur` ist dagegen frei.
 * Da MVRV = CapMrktCurUSD / CapRealUSD gilt, folgt:
 *
 *   CapRealUSD = CapMrktCurUSD / CapMVRVCur
 *
 * Das ist keine Schätzung, sondern eine algebraische Umformung — beide Größen
 * kommen aus derselben Quelle. Trotzdem gehört die Herleitung in den
 * Methodik-Tooltip, damit niemand denkt, wir hätten die Rohgröße.
 */

import { MetricError } from '@/lib/metrics/logreg';
import { sma } from '@/lib/series/transform';
import type { SeriesPoint } from '@/lib/series/types';

/** Rechnet zwei zeitgleiche Reihen punktweise zusammen. Fehlt einer, entsteht eine Lücke. */
function combine(
  a: readonly SeriesPoint[],
  b: readonly SeriesPoint[],
  fn: (x: number, y: number) => number | null,
): SeriesPoint[] {
  const lookup = new Map(b.map((p) => [p.t, p.v]));
  const out: SeriesPoint[] = [];

  for (const point of a) {
    const other = lookup.get(point.t);
    if (other === undefined) continue;
    const value = fn(point.v, other);
    if (value === null || !Number.isFinite(value)) continue;
    out.push({ t: point.t, v: value });
  }

  return out;
}

export const METHODOLOGY = {
  realizedCap:
    'CapRealUSD = CapMrktCurUSD / CapMVRVCur. Coin Metrics gibt CapRealUSD im ' +
    'Community-Tier nicht frei; da MVRV als Verhältnis beider Größen definiert ' +
    'ist, lässt es sich exakt zurückrechnen. Keine Schätzung, sondern Umformung.',
  realizedPrice:
    'Realized Price = Realized Cap / Umlaufmenge. Der durchschnittliche Preis, ' +
    'zu dem alle Coins zuletzt bewegt wurden — eine Art On-Chain-Einstandspreis.',
  mvrvZ:
    'MVRV-Z = (Market Cap − Realized Cap) / Standardabweichung der Market Cap. ' +
    'Die Standardabweichung läuft über ein mitwachsendes Fenster: an jedem Punkt ' +
    'fließen nur Daten bis zu diesem Punkt ein, kein Look-ahead-Bias.',
  nupl:
    'NUPL = (Market Cap − Realized Cap) / Market Cap. Anteil unrealisierter ' +
    'Gewinne an der Marktkapitalisierung. Negativ, wenn der Markt insgesamt im Verlust liegt.',
  puell:
    'Puell Multiple = tägliche Miner-Einnahmen in USD geteilt durch ihren ' +
    'gleitenden 365-Tage-Durchschnitt.',
} as const;

/** Realized Cap aus Market Cap und MVRV zurückrechnen. */
export function realizedCap(
  marketCap: readonly SeriesPoint[],
  mvrv: readonly SeriesPoint[],
): SeriesPoint[] {
  return combine(marketCap, mvrv, (cap, ratio) => (ratio > 0 ? cap / ratio : null));
}

export function realizedPrice(
  realized: readonly SeriesPoint[],
  supply: readonly SeriesPoint[],
): SeriesPoint[] {
  return combine(realized, supply, (cap, coins) => (coins > 0 ? cap / coins : null));
}

/**
 * MVRV-Z mit mitwachsendem Fenster für die Standardabweichung (§6.5).
 * Die Reihe muss aufsteigend sortiert sein.
 */
export function mvrvZScore(
  marketCap: readonly SeriesPoint[],
  realized: readonly SeriesPoint[],
): SeriesPoint[] {
  const realizedByT = new Map(realized.map((p) => [p.t, p.v]));
  const out: SeriesPoint[] = [];

  let count = 0;
  let sum = 0;
  let sumSquares = 0;

  for (const point of marketCap) {
    count++;
    sum += point.v;
    sumSquares += point.v * point.v;

    const realizedValue = realizedByT.get(point.t);
    if (realizedValue === undefined) continue;

    // Unter 30 Beobachtungen ist eine Standardabweichung nicht aussagekräftig.
    if (count < 30) continue;

    const mean = sum / count;
    const variance = sumSquares / count - mean * mean;
    if (variance <= 0) continue;

    out.push({ t: point.t, v: (point.v - realizedValue) / Math.sqrt(variance) });
  }

  return out;
}

export function nupl(
  marketCap: readonly SeriesPoint[],
  realized: readonly SeriesPoint[],
): SeriesPoint[] {
  return combine(marketCap, realized, (cap, real) => (cap > 0 ? (cap - real) / cap : null));
}

/**
 * Puell Multiple (§6.5).
 *
 * Erwartet die täglichen Miner-Einnahmen in USD. Coin Metrics gibt `RevUSD` im
 * Community-Tier nicht frei; die Zusammensetzung aus Ausgabe und Gebühren muss
 * der Aufrufer liefern und im UI als Annäherung kennzeichnen.
 */
export function puellMultiple(revenueUsd: readonly SeriesPoint[]): SeriesPoint[] {
  if (revenueUsd.length < 365) {
    throw new MetricError(
      `Puell Multiple braucht mindestens 365 Tage Miner-Einnahmen, hat ${revenueUsd.length}.`,
    );
  }

  const values = revenueUsd.map((p) => (Number.isFinite(p.v) && p.v > 0 ? p.v : null));
  const average = sma(values, 365);

  const out: SeriesPoint[] = [];
  for (let i = 0; i < revenueUsd.length; i++) {
    const value = values[i] ?? null;
    const mean = average[i] ?? null;
    if (value === null || mean === null || mean <= 0) continue;
    out.push({ t: revenueUsd[i]!.t, v: value / mean });
  }

  return out;
}

/**
 * Miner-Einnahmen in USD als Annäherung (§6.5).
 *
 * `RevUSD` ist im Community-Tier gesperrt. `IssTotUSD` (Ausgabe in USD) und
 * `FeeTotNtv` (Gebühren in BTC) sind frei:
 *
 *   RevUSD ≈ IssTotUSD + FeeTotNtv × PriceUSD
 *
 * Das ist ausdrücklich eine **Annäherung** — Coin Metrics kann anders
 * aggregieren. Ohne Kennzeichnung im UI wäre das ein §11-Verstoß.
 */
export function approximateMinerRevenueUsd(
  issuanceUsd: readonly SeriesPoint[],
  feesNative: readonly SeriesPoint[],
  priceUsd: readonly SeriesPoint[],
): SeriesPoint[] {
  const feesUsd = combine(feesNative, priceUsd, (fees, price) => fees * price);
  return combine(issuanceUsd, feesUsd, (issuance, fees) => issuance + fees);
}

export const APPROXIMATE_REVENUE_NOTE =
  'Angenähert als IssTotUSD + FeeTotNtv × PriceUSD, weil Coin Metrics RevUSD im ' +
  'Community-Tier nicht freigibt. Die offizielle Größe kann abweichen.';
