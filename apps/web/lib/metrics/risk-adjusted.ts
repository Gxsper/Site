/**
 * Risikoadjustierte Kennzahlen (PROJECT_SPEC.md §6.7).
 *
 * Rollierender Sharpe und Sortino, Maximum Drawdown mit Underwater-Kurve,
 * annualisierte Volatilität.
 *
 * Alle Fenster laufen **nachlaufend**. Ein Sharpe-Ratio, das den Mittelwert der
 * gesamten Reihe kennt, sieht rückblickend hervorragend aus und sagt nichts
 * darüber, was man zu dem Zeitpunkt gewusst hätte.
 */

import type { SeriesPoint } from '@/lib/series/types';

/** Krypto handelt 365 Tage im Jahr — nicht 252 wie ein Aktienmarkt. */
export const TRADING_DAYS_PER_YEAR = 365;

/** Unter so vielen Beobachtungen ist eine Kennzahl reines Rauschen. */
const MIN_WINDOW = 20;

function mean(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdev(values: readonly number[], average: number): number {
  return Math.sqrt(values.reduce((s, v) => s + (v - average) ** 2, 0) / values.length);
}

/**
 * Ist die Streuung praktisch null?
 *
 * `sd === 0` reicht nicht: eine Reihe mit exakt konstanter Rendite erzeugt
 * durch Rundung im Fließkommaformat eine Streuung von etwa 1e-17. Geteilt wird
 * daraus ein Sharpe-Ratio von 1,8e15 — eine Zahl, die im Chart nach einem
 * sensationellen Ergebnis aussieht und in Wahrheit reines Rundungsrauschen ist.
 *
 * Verglichen wird deshalb relativ zur Größenordnung der Werte selbst.
 */
function isNegligible(sd: number, values: readonly number[]): boolean {
  if (sd === 0) return true;
  const scale = Math.max(...values.map((v) => Math.abs(v)), Number.EPSILON);
  return sd < scale * 1e-9;
}

/** Tägliche Log-Returns aus einer Preisreihe. */
export function dailyLogReturns(points: readonly SeriesPoint[]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    if (prev.v <= 0 || cur.v <= 0) continue;
    out.push({ t: cur.t, v: Math.log(cur.v / prev.v) });
  }
  return out;
}

/**
 * Annualisierte Volatilität über ein nachlaufendes Fenster.
 * Standardabweichung der Log-Returns × √365.
 */
export function rollingVolatility(
  returns: readonly SeriesPoint[],
  window: number,
): SeriesPoint[] {
  if (window < MIN_WINDOW) return [];
  const out: SeriesPoint[] = [];

  for (let i = window - 1; i < returns.length; i++) {
    const sample = returns.slice(i - window + 1, i + 1).map((p) => p.v);
    const sd = stdev(sample, mean(sample));
    // Rundungsrauschen wird als 0 ausgewiesen, nicht als winzige Volatilität.
    const clean = isNegligible(sd, sample) ? 0 : sd;
    out.push({ t: returns[i]!.t, v: clean * Math.sqrt(TRADING_DAYS_PER_YEAR) });
  }

  return out;
}

export interface SharpeOptions {
  /**
   * Risikofreier Zinssatz als Jahresrate in Prozent, je Zeitpunkt (z. B. DGS3MO).
   * Fehlt er, wird mit 0 gerechnet — das gehört dann in den Tooltip.
   */
  riskFreeAnnualPct?: readonly SeriesPoint[];
}

function riskFreeDailyLookup(
  riskFree: readonly SeriesPoint[] | undefined,
): (t: number) => number {
  if (!riskFree || riskFree.length === 0) return () => 0;
  const byT = new Map(riskFree.map((p) => [p.t, p.v]));
  // Prozent p. a. → tägliche Log-Rate.
  return (t) => {
    const annual = byT.get(t);
    if (annual === undefined || !Number.isFinite(annual)) return 0;
    return Math.log(1 + annual / 100) / TRADING_DAYS_PER_YEAR;
  };
}

/**
 * Rollierendes Sharpe-Ratio, annualisiert (§6.7).
 * Überschussrendite gegenüber dem risikofreien Zins, geteilt durch die Streuung.
 */
export function rollingSharpe(
  returns: readonly SeriesPoint[],
  window: number,
  options: SharpeOptions = {},
): SeriesPoint[] {
  if (window < MIN_WINDOW) return [];
  const riskFree = riskFreeDailyLookup(options.riskFreeAnnualPct);
  const out: SeriesPoint[] = [];

  for (let i = window - 1; i < returns.length; i++) {
    const slice = returns.slice(i - window + 1, i + 1);
    const excess = slice.map((p) => p.v - riskFree(p.t));
    const average = mean(excess);
    const sd = stdev(excess, average);

    // Ohne nennenswerte Streuung ist das Verhältnis nicht definiert.
    if (isNegligible(sd, excess)) continue;

    out.push({
      t: returns[i]!.t,
      v: (average / sd) * Math.sqrt(TRADING_DAYS_PER_YEAR),
    });
  }

  return out;
}

/**
 * Rollierendes Sortino-Ratio (§6.7).
 * Wie Sharpe, aber im Nenner steht nur die Abwärtsabweichung — Aufwärtsvolatilität
 * ist kein Risiko.
 */
export function rollingSortino(
  returns: readonly SeriesPoint[],
  window: number,
  options: SharpeOptions = {},
): SeriesPoint[] {
  if (window < MIN_WINDOW) return [];
  const riskFree = riskFreeDailyLookup(options.riskFreeAnnualPct);
  const out: SeriesPoint[] = [];

  for (let i = window - 1; i < returns.length; i++) {
    const slice = returns.slice(i - window + 1, i + 1);
    const excess = slice.map((p) => p.v - riskFree(p.t));
    const average = mean(excess);

    const downside = excess.filter((v) => v < 0);
    if (downside.length === 0) continue; // kein Abwärtsrisiko im Fenster

    const downsideDeviation = Math.sqrt(
      downside.reduce((s, v) => s + v * v, 0) / excess.length,
    );
    if (isNegligible(downsideDeviation, excess)) continue;

    out.push({
      t: returns[i]!.t,
      v: (average / downsideDeviation) * Math.sqrt(TRADING_DAYS_PER_YEAR),
    });
  }

  return out;
}

export interface DrawdownResult {
  /** Underwater-Kurve: aktueller Abstand zum bisherigen Hoch, in Prozent (≤ 0). */
  underwater: SeriesPoint[];
  /** Tiefster Punkt der Underwater-Kurve, in Prozent. */
  maxDrawdownPct: number;
  /** Zeitpunkt des tiefsten Punktes. */
  maxDrawdownAt: number | null;
  /** Zeitpunkt des vorangehenden Hochs. */
  peakAt: number | null;
}

/**
 * Maximum Drawdown und Underwater-Kurve (§6.7).
 * Das laufende Hoch wächst nur mit — ausschließlich Vergangenheit.
 */
export function drawdown(points: readonly SeriesPoint[]): DrawdownResult {
  const underwater: SeriesPoint[] = [];

  let peak = Number.NEGATIVE_INFINITY;
  let peakTime: number | null = null;
  let worst = 0;
  let worstAt: number | null = null;
  let worstPeakAt: number | null = null;

  for (const point of points) {
    if (!Number.isFinite(point.v) || point.v <= 0) continue;

    if (point.v > peak) {
      peak = point.v;
      peakTime = point.t;
    }

    const value = (point.v / peak - 1) * 100;
    underwater.push({ t: point.t, v: value });

    if (value < worst) {
      worst = value;
      worstAt = point.t;
      worstPeakAt = peakTime;
    }
  }

  return {
    underwater,
    maxDrawdownPct: worst,
    maxDrawdownAt: worstAt,
    peakAt: worstPeakAt,
  };
}

export const METHODOLOGY = {
  sharpe:
    'Rollierendes Sharpe-Ratio: mittlere Überschussrendite gegenüber dem ' +
    'risikofreien Zins, geteilt durch deren Standardabweichung, annualisiert ' +
    'mit √365 (Krypto handelt täglich). Nachlaufendes Fenster — es fließen nur ' +
    'Daten bis zum jeweiligen Punkt ein.',
  sortino:
    'Wie Sharpe, aber im Nenner steht nur die Abwärtsabweichung. Aufwärts- ' +
    'volatilität zählt nicht als Risiko.',
  volatility:
    'Standardabweichung der täglichen Log-Returns über ein nachlaufendes ' +
    'Fenster, annualisiert mit √365.',
  drawdown:
    'Abstand zum bisherigen Höchststand in Prozent. Das laufende Hoch wächst ' +
    'nur mit, es fließt keine Zukunft ein.',
} as const;
