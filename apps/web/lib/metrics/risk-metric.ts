/**
 * Risk Metric (PROJECT_SPEC.md §6.1) — offengelegte Annäherung an ITC.
 *
 * ITCs Formel ist proprietär. Diese hier ist es nicht:
 *
 *   1. logreg_dev = log10(Preis) − logRegFit(t)                       [§6.2]
 *   2. ma_ratio   = log10(Preis / SMA(Preis, 365))
 *   3. mayer      = log10(Preis / SMA(Preis, 200))
 *   4. raw        = 0,5·z(logreg_dev) + 0,3·z(ma_ratio) + 0,2·z(mayer)
 *   5. risk       = minmax(raw) → [0, 1]
 *
 * ══ Zwei Varianten, und warum die zweite ehrlicher ist ══
 *
 * `full`: z-Standardisierung und Min-Max über die **gesamte** Historie, wie in
 * §6.1 beschrieben. Diese Variante ist rückwirkend **nicht stabil**: ein neues
 * Allzeithoch reskaliert jeden Wert der Vergangenheit. Ein Chart von heute
 * zeigt für 2017 andere Zahlen als ein Chart von 2018. Das muss im UI stehen.
 *
 * `expanding`: an jedem Punkt fließen nur Daten **bis zu diesem Punkt** ein.
 * Die Werte ändern sich später nie wieder. Diese Variante ist für alles
 * geeignet, was eine Aussage über den damaligen Kenntnisstand trifft.
 */

import {
  expandingLogRegDeviationLog10,
  fitLogRegression,
  logRegDeviationLog10,
  MetricError,
} from '@/lib/metrics/logreg';
import { sma } from '@/lib/series/transform';
import type { SeriesPoint } from '@/lib/series/types';

export type RiskVariant = 'full' | 'expanding';

/** Gewichte aus §6.1. Summe muss 1 ergeben. */
export const RISK_WEIGHTS = { logregDev: 0.5, maRatio: 0.3, mayer: 0.2 } as const;

const MA_LONG = 365;
const MAYER_WINDOW = 200;

/** Vor so vielen Beobachtungen ist eine Standardisierung bedeutungslos. */
const MIN_SAMPLE = 200;

export interface RiskMetricResult {
  points: SeriesPoint[];
  variant: RiskVariant;
  methodology: string;
  /** Bausteine, damit das UI sie einzeln zeigen kann. */
  components: {
    logregDev: (number | null)[];
    maRatio: (number | null)[];
    mayer: (number | null)[];
  };
}

function log10Ratio(values: readonly SeriesPoint[], window: number): (number | null)[] {
  const prices = values.map((p) => (Number.isFinite(p.v) && p.v > 0 ? p.v : null));
  const average = sma(prices, window);

  return prices.map((price, i) => {
    const mean = average[i] ?? null;
    if (price === null || mean === null || mean <= 0) return null;
    return Math.log10(price / mean);
  });
}

/** z-Standardisierung über die gesamte Stichprobe. */
function standardizeFull(values: readonly (number | null)[]): (number | null)[] {
  const sample = values.filter((v): v is number => v !== null);
  if (sample.length < MIN_SAMPLE) return values.map(() => null);

  const mean = sample.reduce((s, v) => s + v, 0) / sample.length;
  const sd = Math.sqrt(sample.reduce((s, v) => s + (v - mean) ** 2, 0) / sample.length);
  if (sd === 0) return values.map(() => null);

  return values.map((v) => (v === null ? null : (v - mean) / sd));
}

/** z-Standardisierung über ein mitwachsendes Fenster — kein Look-ahead. */
function standardizeExpanding(values: readonly (number | null)[]): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(values.length).fill(null);

  let count = 0;
  let sum = 0;
  let sumSquares = 0;

  for (let i = 0; i < values.length; i++) {
    const value = values[i] ?? null;
    if (value === null) continue;

    count++;
    sum += value;
    sumSquares += value * value;

    if (count < MIN_SAMPLE) continue;

    const mean = sum / count;
    const variance = sumSquares / count - mean * mean;
    if (variance <= 0) continue;

    out[i] = (value - mean) / Math.sqrt(variance);
  }

  return out;
}

/** Min-Max über die gesamte Stichprobe. */
function minmaxFull(values: readonly (number | null)[]): (number | null)[] {
  const sample = values.filter((v): v is number => v !== null);
  if (sample.length === 0) return values.map(() => null);

  const min = Math.min(...sample);
  const max = Math.max(...sample);
  if (max === min) return values.map(() => null);

  return values.map((v) => (v === null ? null : (v - min) / (max - min)));
}

/** Min-Max über ein mitwachsendes Fenster — kein Look-ahead. */
function minmaxExpanding(values: readonly (number | null)[]): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(values.length).fill(null);

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < values.length; i++) {
    const value = values[i] ?? null;
    if (value === null) continue;

    min = Math.min(min, value);
    max = Math.max(max, value);
    if (max === min) continue;

    out[i] = (value - min) / (max - min);
  }

  return out;
}

/**
 * @param points Preisreihe, aufsteigend, möglichst die gesamte Historie —
 *               die Metrik ist über die volle Historie definiert (§6.1).
 */
export function riskMetric(
  points: readonly SeriesPoint[],
  variant: RiskVariant = 'expanding',
): RiskMetricResult {
  if (points.length < MIN_SAMPLE) {
    throw new MetricError(
      `Risk Metric braucht mindestens ${MIN_SAMPLE} Punkte, hat ${points.length}. ` +
        `Zeitraum vergrößern — die Metrik ist über die gesamte Historie definiert.`,
    );
  }

  const fit = fitLogRegression(points);

  // Der Fit selbst muss zur Variante passen. Ein Fit über die gesamte Historie
  // kennt kommende Hochs und Tiefs — in der expanding-Variante wäre das genau
  // der Look-ahead, den sie vermeiden soll.
  const logregDev =
    variant === 'full'
      ? logRegDeviationLog10(fit, points)
      : expandingLogRegDeviationLog10(points);

  const maRatio = log10Ratio(points, MA_LONG);
  const mayer = log10Ratio(points, MAYER_WINDOW);

  const standardize = variant === 'full' ? standardizeFull : standardizeExpanding;
  const zLogreg = standardize(logregDev);
  const zMaRatio = standardize(maRatio);
  const zMayer = standardize(mayer);

  const raw: (number | null)[] = points.map((_, i) => {
    const a = zLogreg[i] ?? null;
    const b = zMaRatio[i] ?? null;
    const c = zMayer[i] ?? null;
    // Nur ein vollständiger Satz Bausteine ergibt einen Wert — eine
    // Teilsumme wäre eine andere Metrik, die niemand angefragt hat.
    if (a === null || b === null || c === null) return null;
    return RISK_WEIGHTS.logregDev * a + RISK_WEIGHTS.maRatio * b + RISK_WEIGHTS.mayer * c;
  });

  const scaled = variant === 'full' ? minmaxFull(raw) : minmaxExpanding(raw);

  const result: SeriesPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const value = scaled[i] ?? null;
    if (value === null) continue;
    result.push({ t: points[i]!.t, v: value });
  }

  const stabilityNote =
    variant === 'full'
      ? 'Achtung: rückwirkend nicht stabil. Ein neues Extrem reskaliert alle ' +
        'früheren Werte — ein Chart von heute zeigt für die Vergangenheit andere ' +
        'Zahlen als ein Chart von damals.'
      : 'An jedem Punkt fließen nur Daten bis zu diesem Punkt ein. Die Werte ' +
        'ändern sich später nicht mehr und enthalten keinen Look-ahead-Bias.';

  return {
    points: result,
    variant,
    components: { logregDev, maRatio, mayer },
    methodology:
      `Eigene, offengelegte Annäherung an ITCs Risk Metric — nicht deren Formel. ` +
      `risk = minmax(0,5·z(Abweichung von der Log-Regression) + ` +
      `0,3·z(log10(Preis / SMA365)) + 0,2·z(log10(Preis / SMA200))). ` +
      `Variante „${variant}". ${stabilityNote} ` +
      `Regression: n = ${fit.n}, R² = ${fit.r2.toFixed(4)}.`,
  };
}
