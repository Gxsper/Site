/**
 * Logarithmische Regressionsbänder (PROJECT_SPEC.md §6.2).
 *
 *   x = ln(Tage seit Genesis)     Genesis = 2009-01-03
 *   y = ln(Preis)
 *   OLS: y = a·x + b
 *   Residuen r = y − ŷ
 *   Bänder bei den Quantilen von r
 *   Ausgabe: exp(ŷ + r_q)
 *
 * ══ Was diese Bänder sind und was nicht ══
 *
 * Sie beschreiben, wie weit der Preis in der Vergangenheit von seinem
 * langfristigen Trend abgewichen ist. Sie sind **keine** Prognose. Der Fit
 * ändert sich mit jedem neuen Datenpunkt, und die Bänder von heute sind nicht
 * die von morgen. `R²` und Fit-Zeitraum gehören deshalb sichtbar ins UI (§6.2).
 */

import type { SeriesPoint } from '@/lib/series/types';

/** Bitcoin-Genesis-Block, 2009-01-03 (§6.2). */
export const GENESIS_SECONDS = Math.floor(Date.parse('2009-01-03T00:00:00Z') / 1000);

const DAY = 86_400;

/** Quantile der Residuen, an denen Bänder gezeichnet werden (§6.2). */
export const BAND_QUANTILES = [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99] as const;

export class MetricError extends Error {
  override readonly name = 'MetricError';
}

export interface LogRegFit {
  /** Steigung in ln-ln-Raum. */
  a: number;
  /** Achsenabschnitt. */
  b: number;
  /** Bestimmtheitsmaß. */
  r2: number;
  /** Zahl der Punkte, die in den Fit eingegangen sind. */
  n: number;
  /** Fit-Zeitraum als Unix-Sekunden — gehört in den Methodik-Tooltip. */
  from: number;
  to: number;
  /** Sortierte Residuen, Grundlage der Bänder. */
  residuals: number[];
}

/** Tage seit Genesis. Mindestens 1, damit ln definiert bleibt. */
export function daysSinceGenesis(t: number): number {
  return Math.max(1, (t - GENESIS_SECONDS) / DAY);
}

/**
 * OLS-Fit von ln(Preis) gegen ln(Tage seit Genesis).
 *
 * Punkte mit Preis ≤ 0 fallen heraus — ln ist dort nicht definiert. Sie werden
 * nicht durch einen Ersatzwert überbrückt (§11).
 */
export function fitLogRegression(points: readonly SeriesPoint[]): LogRegFit {
  const xs: number[] = [];
  const ys: number[] = [];
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    if (!Number.isFinite(point.v) || point.v <= 0) continue;
    if (point.t <= GENESIS_SECONDS) continue;
    xs.push(Math.log(daysSinceGenesis(point.t)));
    ys.push(Math.log(point.v));
    from = Math.min(from, point.t);
    to = Math.max(to, point.t);
  }

  const n = xs.length;
  // Unter 30 Punkten ist eine Regression über Jahrzehnte nicht seriös.
  if (n < 30) {
    throw new MetricError(
      `Logarithmische Regression braucht mindestens 30 Punkte mit positivem Preis, hat ${n}.`,
    );
  }

  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;

  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    sxy += dx * (ys[i]! - meanY);
    sxx += dx * dx;
  }

  if (sxx === 0) {
    throw new MetricError('Logarithmische Regression: alle Zeitpunkte identisch, Steigung nicht definiert.');
  }

  const a = sxy / sxx;
  const b = meanY - a * meanX;

  const residuals: number[] = [];
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = a * xs[i]! + b;
    const residual = ys[i]! - predicted;
    residuals.push(residual);
    ssRes += residual * residual;
    ssTot += (ys[i]! - meanY) ** 2;
  }

  return {
    a,
    b,
    r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot,
    n,
    from,
    to,
    residuals: [...residuals].sort((x, y) => x - y),
  };
}

/** Vorhergesagter ln(Preis) zum Zeitpunkt t. */
export function predictLn(fit: LogRegFit, t: number): number {
  return fit.a * Math.log(daysSinceGenesis(t)) + fit.b;
}

/**
 * Empirisches Quantil mit linearer Interpolation zwischen den Rängen.
 * Erwartet ein aufsteigend sortiertes Array.
 */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) {
    throw new MetricError('Quantil einer leeren Stichprobe ist nicht definiert.');
  }
  if (q <= 0) return sorted[0]!;
  if (q >= 1) return sorted[sorted.length - 1]!;

  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;

  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

export interface LogRegBands {
  fit: LogRegFit;
  /** Je Quantil eine Serie in Preiseinheiten. */
  bands: { quantile: number; points: SeriesPoint[] }[];
  methodology: string;
}

/**
 * Bänder für den angefragten Zeitraum.
 * Der Fit läuft über `fitPoints` — per Default die gesamte Historie (§6.2).
 */
export function logRegressionBands(
  fitPoints: readonly SeriesPoint[],
  outputTimes: readonly number[],
): LogRegBands {
  const fit = fitLogRegression(fitPoints);

  const bands = BAND_QUANTILES.map((q) => {
    const offset = quantile(fit.residuals, q);
    return {
      quantile: q,
      points: outputTimes
        .filter((t) => t > GENESIS_SECONDS)
        .map((t) => ({ t, v: Math.exp(predictLn(fit, t) + offset) })),
    };
  });

  const fitFrom = new Date(fit.from * 1000).toISOString().slice(0, 10);
  const fitTo = new Date(fit.to * 1000).toISOString().slice(0, 10);

  return {
    fit,
    bands,
    methodology:
      `OLS-Fit von ln(Preis) gegen ln(Tage seit Genesis, 2009-01-03). ` +
      `Bänder sind die Quantile der Residuen, zurückgerechnet als exp(ŷ + r_q). ` +
      `Fit-Zeitraum ${fitFrom} bis ${fitTo}, n = ${fit.n}, R² = ${fit.r2.toFixed(4)}. ` +
      `Keine Prognose: der Fit ändert sich mit jedem neuen Datenpunkt, die Bänder ` +
      `von heute sind nicht die von morgen.`,
  };
}

/**
 * Abweichung vom Fit in log10-Einheiten — Baustein der Risk Metric (§6.1).
 *
 * §6.2 rechnet in ln, §6.1 in log10. Umgerechnet wird über ln(10), damit beide
 * Abschnitte dieselbe Regression benutzen und nicht zwei Fits nebeneinander
 * existieren, die auseinanderlaufen können.
 */
export function logRegDeviationLog10(
  fit: LogRegFit,
  points: readonly SeriesPoint[],
): (number | null)[] {
  const LN10 = Math.log(10);
  return points.map((point) => {
    if (!Number.isFinite(point.v) || point.v <= 0) return null;
    if (point.t <= GENESIS_SECONDS) return null;
    return (Math.log(point.v) - predictLn(fit, point.t)) / LN10;
  });
}

/** Ab so vielen Beobachtungen wird ein mitwachsender Fit ausgewertet. */
const MIN_EXPANDING_SAMPLE = 30;

/**
 * Abweichung vom Fit, aber mit **mitwachsender** Regression: an jedem Punkt
 * wird nur aus den Daten bis zu diesem Punkt gefittet.
 *
 * Das ist der Unterschied zwischen „so sah es damals aus" und „so sieht es
 * heute rückblickend aus". Ein Fit über die gesamte Historie kennt kommende
 * Hochs und Tiefs; seine Abweichungen taugen deshalb nicht für eine Aussage
 * über den damaligen Kenntnisstand — und damit auch nicht für die
 * `expanding`-Variante der Risk Metric (§6.1).
 *
 * OLS braucht nur vier laufende Summen, deshalb ist das in einem Durchlauf
 * möglich und nicht quadratisch.
 */
export function expandingLogRegDeviationLog10(
  points: readonly SeriesPoint[],
): (number | null)[] {
  const LN10 = Math.log(10);
  const out: (number | null)[] = new Array<number | null>(points.length).fill(null);

  let n = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    if (!Number.isFinite(point.v) || point.v <= 0) continue;
    if (point.t <= GENESIS_SECONDS) continue;

    const x = Math.log(daysSinceGenesis(point.t));
    const y = Math.log(point.v);

    // Erst aufnehmen, dann auswerten: der aktuelle Punkt gehört zur
    // Vergangenheit, sobald er beobachtet wurde.
    n++;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;

    if (n < MIN_EXPANDING_SAMPLE) continue;

    const denominator = n * sumXX - sumX * sumX;
    if (denominator === 0) continue;

    const a = (n * sumXY - sumX * sumY) / denominator;
    const b = (sumY - a * sumX) / n;

    out[i] = (y - (a * x + b)) / LN10;
  }

  return out;
}
