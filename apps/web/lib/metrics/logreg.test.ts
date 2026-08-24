import { describe, expect, it } from 'vitest';

import {
  BAND_QUANTILES,
  daysSinceGenesis,
  fitLogRegression,
  GENESIS_SECONDS,
  logRegDeviationLog10,
  logRegressionBands,
  MetricError,
  predictLn,
  quantile,
} from '@/lib/metrics/logreg';
import type { SeriesPoint } from '@/lib/series/types';

const DAY = 86_400;

/** Erzeugt eine Reihe, die der Regression exakt folgt: ln(y) = a·ln(x) + b. */
function perfectSeries(a: number, b: number, count: number): SeriesPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const t = GENESIS_SECONDS + (i + 100) * DAY;
    const x = Math.log(daysSinceGenesis(t));
    return { t, v: Math.exp(a * x + b) };
  });
}

describe('daysSinceGenesis', () => {
  it('zählt ab dem Genesis-Block 2009-01-03', () => {
    expect(daysSinceGenesis(GENESIS_SECONDS + 100 * DAY)).toBe(100);
  });

  it('bleibt bei mindestens 1, damit ln definiert ist', () => {
    expect(daysSinceGenesis(GENESIS_SECONDS)).toBe(1);
    expect(daysSinceGenesis(GENESIS_SECONDS - 999 * DAY)).toBe(1);
  });
});

describe('quantile', () => {
  it('trifft den Median einer ungeraden Stichprobe', () => {
    expect(quantile([1, 2, 3], 0.5)).toBe(2);
  });

  it('interpoliert zwischen den Rängen', () => {
    // Von Hand: Position = (4−1)·0,5 = 1,5 → zwischen 2 und 3 → 2,5
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  it('liefert an den Rändern Minimum und Maximum', () => {
    expect(quantile([1, 2, 3], 0)).toBe(1);
    expect(quantile([1, 2, 3], 1)).toBe(3);
  });

  it('wirft bei leerer Stichprobe, statt 0 zu liefern', () => {
    expect(() => quantile([], 0.5)).toThrow(MetricError);
  });
});

describe('fitLogRegression', () => {
  it('findet die Parameter einer exakt konstruierten Reihe wieder', () => {
    // Von Hand konstruiert: ln(Preis) = 5,8 · ln(Tage) − 17,0
    const fit = fitLogRegression(perfectSeries(5.8, -17, 500));

    expect(fit.a).toBeCloseTo(5.8, 9);
    expect(fit.b).toBeCloseTo(-17, 9);
    expect(fit.r2).toBeCloseTo(1, 12);
    expect(fit.n).toBe(500);
  });

  it('liefert bei perfektem Fit lauter Residuen von 0', () => {
    const fit = fitLogRegression(perfectSeries(5.8, -17, 200));
    for (const residual of fit.residuals) expect(Math.abs(residual)).toBeLessThan(1e-9);
  });

  it('meldet den tatsächlichen Fit-Zeitraum', () => {
    const points = perfectSeries(5, -15, 300);
    const fit = fitLogRegression(points);

    expect(fit.from).toBe(points[0]!.t);
    expect(fit.to).toBe(points[points.length - 1]!.t);
  });

  it('überspringt Preise ≤ 0, statt ln davon zu bilden', () => {
    const points = perfectSeries(5, -15, 300);
    const mitNull = [...points];
    mitNull[10] = { t: mitNull[10]!.t, v: 0 };
    mitNull[20] = { t: mitNull[20]!.t, v: -5 };

    const fit = fitLogRegression(mitNull);
    expect(fit.n).toBe(298);
    expect(Number.isFinite(fit.a)).toBe(true);
  });

  it('wirft bei zu wenigen Punkten, statt eine Scheinregression zu liefern', () => {
    expect(() => fitLogRegression(perfectSeries(5, -15, 10))).toThrow(/mindestens 30/);
  });

  it('erkennt eine Reihe mit Streuung an einem niedrigeren R²', () => {
    const basis = perfectSeries(5.8, -17, 400);
    // Deterministische Störung — kein Math.random (§11).
    const gestoert = basis.map((p, i) => ({ t: p.t, v: p.v * (1 + 0.3 * Math.sin(i)) }));

    const fit = fitLogRegression(gestoert);
    expect(fit.r2).toBeLessThan(1);
    expect(fit.r2).toBeGreaterThan(0.9);
  });
});

describe('predictLn', () => {
  it('gibt für einen perfekten Fit genau den Ausgangswert zurück', () => {
    const points = perfectSeries(5.8, -17, 200);
    const fit = fitLogRegression(points);
    const probe = points[100]!;

    expect(Math.exp(predictLn(fit, probe.t))).toBeCloseTo(probe.v, 6);
  });
});

describe('logRegressionBands', () => {
  const points = perfectSeries(5.8, -17, 600);

  it('liefert alle sieben Quantile aus §6.2', () => {
    const result = logRegressionBands(points, points.map((p) => p.t));
    expect(result.bands.map((b) => b.quantile)).toEqual([...BAND_QUANTILES]);
  });

  it('ordnet die Bänder aufsteigend — höheres Quantil, höherer Preis', () => {
    const result = logRegressionBands(points, points.map((p) => p.t));
    const letzte = result.bands.map((b) => b.points[b.points.length - 1]!.v);

    for (let i = 1; i < letzte.length; i++) {
      expect(letzte[i]!).toBeGreaterThanOrEqual(letzte[i - 1]!);
    }
  });

  it('legt bei perfektem Fit alle Bänder auf die Kurve', () => {
    const result = logRegressionBands(points, points.map((p) => p.t));
    const median = result.bands.find((b) => b.quantile === 0.5)!;

    expect(median.points[300]!.v).toBeCloseTo(points[300]!.v, 6);
  });

  it('nennt R², Stichprobengröße und Fit-Zeitraum in der Methodik', () => {
    const result = logRegressionBands(points, points.map((p) => p.t));

    expect(result.methodology).toMatch(/R² = /);
    expect(result.methodology).toMatch(/n = 600/);
    expect(result.methodology).toMatch(/Keine Prognose/);
  });

  it('lässt Zeitpunkte vor dem Genesis-Block weg', () => {
    const result = logRegressionBands(points, [GENESIS_SECONDS - DAY, points[0]!.t]);
    expect(result.bands[0]!.points).toHaveLength(1);
  });
});

describe('logRegDeviationLog10', () => {
  it('liefert bei perfektem Fit überall 0', () => {
    const points = perfectSeries(5.8, -17, 200);
    const fit = fitLogRegression(points);

    for (const deviation of logRegDeviationLog10(fit, points)) {
      expect(Math.abs(deviation!)).toBeLessThan(1e-9);
    }
  });

  it('rechnet in log10 — ein Preis um Faktor 10 über dem Fit ergibt genau 1', () => {
    const points = perfectSeries(5.8, -17, 200);
    const fit = fitLogRegression(points);
    const probe = points[100]!;

    const [deviation] = logRegDeviationLog10(fit, [{ t: probe.t, v: probe.v * 10 }]);
    expect(deviation!).toBeCloseTo(1, 9);
  });

  it('liefert für nicht-positive Preise null statt einer Zahl', () => {
    const points = perfectSeries(5.8, -17, 200);
    const fit = fitLogRegression(points);

    expect(logRegDeviationLog10(fit, [{ t: points[0]!.t, v: 0 }])).toEqual([null]);
    expect(logRegDeviationLog10(fit, [{ t: points[0]!.t, v: -1 }])).toEqual([null]);
  });
});
