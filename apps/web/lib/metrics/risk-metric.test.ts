import { describe, expect, it } from 'vitest';

import { GENESIS_SECONDS, MetricError } from '@/lib/metrics/logreg';
import { riskMetric, RISK_WEIGHTS } from '@/lib/metrics/risk-metric';
import type { SeriesPoint } from '@/lib/series/types';

const DAY = 86_400;

/**
 * Preisreihe mit Trend und Zyklus — deterministisch, kein Math.random (§11).
 * Der Sinus erzeugt Über- und Unterbewertungsphasen, damit die Metrik etwas
 * zu skalieren hat.
 */
function cyclicalSeries(count: number, amplitude = 0.6): SeriesPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const t = GENESIS_SECONDS + (i + 500) * DAY;
    const trend = Math.exp(5.5 * Math.log((i + 500) / 500) + 5);
    const cycle = Math.exp(amplitude * Math.sin((i / 365) * 2 * Math.PI));
    return { t, v: trend * cycle };
  });
}

describe('Gewichte', () => {
  it('summieren sich zu 1 — sonst ist die Skalierung willkürlich', () => {
    const sum = RISK_WEIGHTS.logregDev + RISK_WEIGHTS.maRatio + RISK_WEIGHTS.mayer;
    expect(sum).toBeCloseTo(1, 12);
  });

  it('entsprechen den Vorgaben aus §6.1', () => {
    expect(RISK_WEIGHTS).toEqual({ logregDev: 0.5, maRatio: 0.3, mayer: 0.2 });
  });
});

describe('riskMetric', () => {
  const points = cyclicalSeries(2000);

  it('liegt immer zwischen 0 und 1', () => {
    for (const variant of ['full', 'expanding'] as const) {
      for (const point of riskMetric(points, variant).points) {
        expect(point.v, `${variant} @${point.t}`).toBeGreaterThanOrEqual(0);
        expect(point.v, `${variant} @${point.t}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('erreicht in der full-Variante beide Extreme', () => {
    const values = riskMetric(points, 'full').points.map((p) => p.v);
    expect(Math.min(...values)).toBeCloseTo(0, 9);
    expect(Math.max(...values)).toBeCloseTo(1, 9);
  });

  it('steigt, wenn der Preis über seinen Trend läuft', () => {
    const result = riskMetric(points, 'full').points;
    const byT = new Map(result.map((p) => [p.t, p.v]));

    // Hoch- und Tiefpunkt des Zyklus im selben Jahr vergleichen.
    const hoch = points[1500 + 91]!; // Sinus-Maximum
    const tief = points[1500 + 273]!; // Sinus-Minimum

    expect(byT.get(hoch.t)!).toBeGreaterThan(byT.get(tief.t)!);
  });

  it('wirft bei zu kurzer Historie, statt eine Scheinmetrik zu liefern', () => {
    expect(() => riskMetric(cyclicalSeries(50))).toThrow(MetricError);
    expect(() => riskMetric(cyclicalSeries(50))).toThrow(/gesamte Historie/);
  });

  it('liefert die Bausteine einzeln mit', () => {
    const result = riskMetric(points, 'full');
    expect(result.components.logregDev).toHaveLength(points.length);
    expect(result.components.maRatio).toHaveLength(points.length);
    expect(result.components.mayer).toHaveLength(points.length);
  });
});

describe('expanding — kein Look-ahead', () => {
  /**
   * Der entscheidende Unterschied zur full-Variante: bereits berechnete Werte
   * dürfen sich durch spätere Daten nicht mehr ändern.
   */
  it('lässt frühere Werte unverändert, wenn Daten hinzukommen', () => {
    const basis = cyclicalSeries(1500);
    const laenger = cyclicalSeries(1800);

    const kurz = riskMetric(basis, 'expanding').points;
    const lang = riskMetric(laenger, 'expanding').points;
    const langByT = new Map(lang.map((p) => [p.t, p.v]));

    for (const point of kurz) {
      expect(langByT.get(point.t), `t=${point.t}`).toBeCloseTo(point.v, 12);
    }
  });

  it('reskaliert in der full-Variante dagegen die Vergangenheit', () => {
    const basis = cyclicalSeries(1500);
    // Ein neues Extrem am Ende verschiebt Min-Max über die gesamte Reihe.
    const mitExtrem = [...basis];
    const last = mitExtrem[mitExtrem.length - 1]!;
    mitExtrem.push({ t: last.t + DAY, v: last.v * 12 });

    const ohne = riskMetric(basis, 'full').points;
    const mit = riskMetric(mitExtrem, 'full').points;
    const mitByT = new Map(mit.map((p) => [p.t, p.v]));

    const veraendert = ohne.filter((p) => {
      const neu = mitByT.get(p.t);
      return neu !== undefined && Math.abs(neu - p.v) > 1e-6;
    });

    // Das ist der dokumentierte Nachteil aus §6.1 — hier festgehalten,
    // damit niemand ihn für einen Fehler hält.
    expect(veraendert.length).toBeGreaterThan(0);
  });
});

describe('Methodik-Text', () => {
  it('nennt die Formel und warnt bei full vor der Instabilität', () => {
    const text = riskMetric(cyclicalSeries(1000), 'full').methodology;
    expect(text).toMatch(/nicht deren Formel/);
    expect(text).toMatch(/rückwirkend nicht stabil/);
  });

  it('hält bei expanding fest, dass kein Look-ahead enthalten ist', () => {
    const text = riskMetric(cyclicalSeries(1000), 'expanding').methodology;
    expect(text).toMatch(/kein.*Look-ahead|Look-ahead-Bias/);
  });
});
