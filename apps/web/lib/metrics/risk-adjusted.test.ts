import { describe, expect, it } from 'vitest';

import {
  dailyLogReturns,
  drawdown,
  rollingSharpe,
  rollingSortino,
  rollingVolatility,
  TRADING_DAYS_PER_YEAR,
} from '@/lib/metrics/risk-adjusted';
import { compareCycles, daysSinceLastHalving, HALVINGS } from '@/lib/metrics/cycles';
import type { SeriesPoint } from '@/lib/series/types';

const DAY = 86_400;
const T0 = Math.floor(Date.parse('2020-01-01T00:00:00Z') / 1000);
const at = (i: number) => T0 + i * DAY;

function series(values: number[]): SeriesPoint[] {
  return values.map((v, i) => ({ t: at(i), v }));
}

/** Preisreihe mit fester täglicher Rendite. */
function constantGrowth(count: number, dailyRate: number, start = 100): SeriesPoint[] {
  return series(Array.from({ length: count }, (_, i) => start * (1 + dailyRate) ** i));
}

describe('dailyLogReturns', () => {
  it('liefert einen Punkt weniger als die Preisreihe', () => {
    expect(dailyLogReturns(series([100, 110, 120]))).toHaveLength(2);
  });

  it('rechnet ln(x_t / x_{t-1})', () => {
    expect(dailyLogReturns(series([100, 110]))[0]!.v).toBeCloseTo(Math.log(1.1), 12);
  });

  it('überspringt nicht-positive Preise, statt ln davon zu bilden', () => {
    expect(dailyLogReturns(series([100, 0, 50]))).toEqual([]);
  });
});

describe('rollingVolatility', () => {
  it('ist bei konstanter Rendite genau 0 — es gibt keine Streuung', () => {
    const returns = dailyLogReturns(constantGrowth(200, 0.01));
    const vol = rollingVolatility(returns, 30);

    expect(vol.length).toBeGreaterThan(0);
    for (const point of vol) expect(point.v).toBeCloseTo(0, 12);
  });

  it('annualisiert mit √365', () => {
    // Renditen wechseln zwischen +0,01 und −0,01: Standardabweichung = 0,01
    const preise: number[] = [100];
    for (let i = 1; i < 200; i++) {
      preise.push(preise[i - 1]! * (i % 2 === 0 ? Math.exp(0.01) : Math.exp(-0.01)));
    }

    const vol = rollingVolatility(dailyLogReturns(series(preise)), 60);
    const letzter = vol[vol.length - 1]!;

    expect(letzter.v).toBeCloseTo(0.01 * Math.sqrt(TRADING_DAYS_PER_YEAR), 6);
  });

  it('benutzt nur vergangene Werte', () => {
    const basis = constantGrowth(150, 0.005);
    const laenger = [...basis, { t: at(150), v: basis[149]!.v * 5 }];

    const ohne = rollingVolatility(dailyLogReturns(basis), 30);
    const mit = rollingVolatility(dailyLogReturns(laenger), 30);
    const mitByT = new Map(mit.map((p) => [p.t, p.v]));

    for (const point of ohne) expect(mitByT.get(point.t)).toBeCloseTo(point.v, 12);
  });

  it('liefert nichts bei einem zu kleinen Fenster', () => {
    expect(rollingVolatility(dailyLogReturns(constantGrowth(100, 0.01)), 5)).toEqual([]);
  });
});

describe('rollingSharpe', () => {
  it('ist ohne Streuung nicht definiert und liefert nichts', () => {
    const returns = dailyLogReturns(constantGrowth(200, 0.01));
    expect(rollingSharpe(returns, 30)).toEqual([]);
  });

  it('ist positiv, wenn die Reihe im Fenster überwiegend steigt', () => {
    const preise: number[] = [100];
    for (let i = 1; i < 300; i++) {
      preise.push(preise[i - 1]! * Math.exp(0.004 + 0.01 * Math.sin(i)));
    }

    const sharpe = rollingSharpe(dailyLogReturns(series(preise)), 90);
    expect(sharpe[sharpe.length - 1]!.v).toBeGreaterThan(0);
  });

  it('sinkt, wenn ein risikofreier Zins abgezogen wird', () => {
    const preise: number[] = [100];
    for (let i = 1; i < 300; i++) {
      preise.push(preise[i - 1]! * Math.exp(0.004 + 0.01 * Math.sin(i)));
    }
    const returns = dailyLogReturns(series(preise));

    const ohne = rollingSharpe(returns, 90);
    const mit = rollingSharpe(returns, 90, {
      riskFreeAnnualPct: returns.map((p) => ({ t: p.t, v: 5 })),
    });

    expect(mit[mit.length - 1]!.v).toBeLessThan(ohne[ohne.length - 1]!.v);
  });

  it('rechnet ohne Zinsangabe mit 0 statt zu raten', () => {
    const preise: number[] = [100];
    for (let i = 1; i < 200; i++) preise.push(preise[i - 1]! * Math.exp(0.002 + 0.01 * Math.sin(i)));
    const returns = dailyLogReturns(series(preise));

    const ohne = rollingSharpe(returns, 60);
    const mitNull = rollingSharpe(returns, 60, {
      riskFreeAnnualPct: returns.map((p) => ({ t: p.t, v: 0 })),
    });

    expect(ohne[ohne.length - 1]!.v).toBeCloseTo(mitNull[mitNull.length - 1]!.v, 12);
  });
});

describe('rollingSortino', () => {
  it('liefert nichts, wenn es im Fenster keinen Verlusttag gibt', () => {
    const returns = dailyLogReturns(constantGrowth(200, 0.01));
    expect(rollingSortino(returns, 30)).toEqual([]);
  });

  it('liegt über dem Sharpe, wenn die Aufwärtsbewegungen stärker streuen', () => {
    // Viele kleine Verluste, wenige große Gewinne: Abwärtsabweichung < Gesamtstreuung.
    const preise: number[] = [100];
    for (let i = 1; i < 300; i++) {
      const rendite = i % 10 === 0 ? 0.08 : -0.005;
      preise.push(preise[i - 1]! * Math.exp(rendite));
    }
    const returns = dailyLogReturns(series(preise));

    const sharpe = rollingSharpe(returns, 90);
    const sortino = rollingSortino(returns, 90);

    expect(sortino[sortino.length - 1]!.v).toBeGreaterThan(sharpe[sharpe.length - 1]!.v);
  });
});

describe('drawdown', () => {
  it('ist am Allzeithoch genau 0', () => {
    const result = drawdown(series([100, 110, 120]));
    expect(result.underwater[2]!.v).toBe(0);
    expect(result.maxDrawdownPct).toBe(0);
  });

  it('rechnet den Abstand zum bisherigen Hoch in Prozent', () => {
    // Hoch 100, dann 60 → −40 %
    const result = drawdown(series([100, 60, 80]));

    expect(result.underwater[1]!.v).toBeCloseTo(-40, 12);
    expect(result.underwater[2]!.v).toBeCloseTo(-20, 12);
    expect(result.maxDrawdownPct).toBeCloseTo(-40, 12);
  });

  it('nennt den Zeitpunkt des Tiefs und des vorangehenden Hochs', () => {
    const result = drawdown(series([100, 150, 75, 120]));

    expect(result.peakAt).toBe(at(1));
    expect(result.maxDrawdownAt).toBe(at(2));
    expect(result.maxDrawdownPct).toBeCloseTo(-50, 12);
  });

  it('lässt das laufende Hoch nur wachsen — keine Zukunft', () => {
    const result = drawdown(series([100, 50, 200, 100]));
    // Bei Index 1 ist das Hoch 100, nicht die späteren 200.
    expect(result.underwater[1]!.v).toBeCloseTo(-50, 12);
    expect(result.underwater[3]!.v).toBeCloseTo(-50, 12);
  });

  it('überspringt nicht-positive Preise', () => {
    expect(drawdown(series([100, 0, 90])).underwater).toHaveLength(2);
  });
});

describe('compareCycles', () => {
  const halvingT = HALVINGS[2]!.t; // 2020-05-11
  const points = Array.from({ length: 1000 }, (_, i) => ({
    t: halvingT + i * DAY,
    v: 8000 * (1 + i / 500),
  }));

  it('setzt jeden Zyklus am Anker auf 100', () => {
    const result = compareCycles(points, 'halving');
    for (const cycle of result.cycles) expect(cycle.points[0]!.v).toBeCloseTo(100, 9);
  });

  it('zählt die X-Achse in Tagen seit dem Anker', () => {
    const result = compareCycles(points, 'halving');
    const cycle = result.cycles.find((c) => c.anchorT === halvingT)!;

    expect(cycle.points[0]!.t).toBe(0);
    expect(cycle.points[10]!.t).toBe(10);
  });

  it('schneidet einen Zyklus beim nächsten Anker ab', () => {
    const result = compareCycles(points, 'halving');
    const cycle2020 = result.cycles.find((c) => c.anchorT === halvingT)!;
    const tageBisNaechstes = Math.round((HALVINGS[3]!.t - halvingT) / DAY);

    expect(cycle2020.points[cycle2020.points.length - 1]!.t).toBeLessThan(tageBisNaechstes);
  });

  it('markiert den laufenden Zyklus', () => {
    const bisHeute = Array.from({ length: 400 }, (_, i) => ({
      t: HALVINGS[3]!.t + i * DAY,
      v: 60_000 + i * 50,
    }));
    const result = compareCycles(bisHeute, 'halving');

    expect(result.cycles.filter((c) => c.current)).toHaveLength(1);
    expect(result.cycles.find((c) => c.current)!.anchorT).toBe(HALVINGS[3]!.t);
  });

  it('weist in der Methodik darauf hin, dass der laufende Zyklus unvollständig ist', () => {
    expect(compareCycles(points).methodology).toMatch(/laufende ist es naturgemäß nicht/);
  });

  it('kann auch auf Zyklus-Tiefs ankern', () => {
    const bottomPoints = Array.from({ length: 500 }, (_, i) => ({
      t: Math.floor(Date.parse('2022-11-21T00:00:00Z') / 1000) + i * DAY,
      v: 16_000 + i * 100,
    }));
    const result = compareCycles(bottomPoints, 'bottom');

    expect(result.cycles).toHaveLength(1);
    expect(result.methodology).toMatch(/Zyklus-Tief/);
  });
});

describe('daysSinceLastHalving', () => {
  it('zählt ab dem letzten stattgefundenen Halving', () => {
    const zehnTageNach = HALVINGS[3]!.t + 10 * DAY;
    expect(daysSinceLastHalving(zehnTageNach)).toBe(10);
  });

  it('liefert null vor dem ersten Halving', () => {
    expect(daysSinceLastHalving(HALVINGS[0]!.t - DAY)).toBeNull();
  });
});
