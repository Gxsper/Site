import { describe, expect, it } from 'vitest';

import { computeNetLiquiditySeries, netLiquidityBn } from '@/lib/metrics/net-liquidity';
import { parseFredCsv } from '@/lib/providers/fred';

const DAY = 86_400;
const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);

/**
 * §13 (Phase 1): „FRED-Netto-Liquidität für ein manuell geprüftes Datum stimmt
 * auf 1 Mrd. genau."
 *
 * Referenzdatum 2024-01-03. Rohwerte am 2026-08-24 von FRED abgerufen:
 *
 *   WALCL      7 681 024   Millions of U.S. Dollars   → 7 681,024 Mrd.
 *   WTREGEN      758 448   Millions of U.S. Dollars   →   758,448 Mrd.
 *   RRPONTSYD    719,897   Billions of US Dollars     →   719,897 Mrd.
 *
 * Von Hand:  7 681,024 − 758,448 − 719,897 = 6 202,679 Mrd.
 */
const REFERENCE = {
  date: '2024-01-03',
  walclMillions: 7_681_024,
  tgaMillions: 758_448,
  rrpBillions: 719.897,
  expectedBn: 6_202.679,
};

describe('netLiquidityBn — Einheiten', () => {
  it('trifft den von Hand gerechneten Referenzwert auf 1 Mrd. genau', () => {
    const result = netLiquidityBn(
      REFERENCE.walclMillions,
      REFERENCE.tgaMillions,
      REFERENCE.rrpBillions,
    );

    expect(Math.abs(result - REFERENCE.expectedBn)).toBeLessThan(1);
    expect(result).toBeCloseTo(REFERENCE.expectedBn, 3);
  });

  it('liegt in einer plausiblen Größenordnung — Regressionsschutz gegen Faktor 1000', () => {
    const result = netLiquidityBn(
      REFERENCE.walclMillions,
      REFERENCE.tgaMillions,
      REFERENCE.rrpBillions,
    );

    // Fed Net Liquidity lag Anfang 2024 bei gut 6 Billionen USD. Ein
    // Einheitenfehler bei WTREGEN produziert Werte um −751 000 Mrd.
    expect(result).toBeGreaterThan(4_000);
    expect(result).toBeLessThan(9_000);
  });

  it('behandelt WTREGEN als Millionen, nicht als Milliarden', () => {
    // Genau der Fehler aus PROJECT_SPEC.md §4.3. Die falsche Variante wäre
    // walcl/1000 - tga - rrp und ergäbe einen tief negativen Wert.
    const falsch = REFERENCE.walclMillions / 1000 - REFERENCE.tgaMillions - REFERENCE.rrpBillions;
    const richtig = netLiquidityBn(
      REFERENCE.walclMillions,
      REFERENCE.tgaMillions,
      REFERENCE.rrpBillions,
    );

    expect(falsch).toBeLessThan(0);
    expect(richtig).toBeGreaterThan(0);
  });

  it('reagiert richtungsrichtig auf jede Komponente', () => {
    const base = netLiquidityBn(1_000_000, 500_000, 100);

    // Mehr Bilanzsumme = mehr Liquidität; mehr TGA oder RRP = weniger.
    expect(netLiquidityBn(1_100_000, 500_000, 100)).toBeGreaterThan(base);
    expect(netLiquidityBn(1_000_000, 600_000, 100)).toBeLessThan(base);
    expect(netLiquidityBn(1_000_000, 500_000, 200)).toBeLessThan(base);
  });
});

describe('computeNetLiquiditySeries', () => {
  /**
   * Echte FRED-CSV-Ausschnitte, abgerufen am 2026-08-24. WALCL und WTREGEN sind
   * wöchentlich (Mittwoch), RRPONTSYD täglich mit Lücke am Feiertag 2024-01-01.
   */
  const WALCL_CSV = [
    'observation_date,WALCL',
    '2023-12-27,7712781',
    '2024-01-03,7681024',
    '2024-01-10,7686710',
  ].join('\n');

  const WTREGEN_CSV = [
    'observation_date,WTREGEN',
    '2023-12-27,731405',
    '2024-01-03,758448',
    '2024-01-10,747565',
  ].join('\n');

  const RRP_CSV = [
    'observation_date,RRPONTSYD',
    '2023-12-29,1018.483',
    '2024-01-01,',
    '2024-01-02,704.864',
    '2024-01-03,719.897',
    '2024-01-04,664.899',
  ].join('\n');

  const inputs = {
    walcl: parseFredCsv(WALCL_CSV, 'WALCL'),
    wtregen: parseFredCsv(WTREGEN_CSV, 'WTREGEN'),
    rrpontsyd: parseFredCsv(RRP_CSV, 'RRPONTSYD'),
  };

  it('trifft am Referenztag den Wert aus der Handrechnung', () => {
    const points = computeNetLiquiditySeries(inputs, {
      from: day('2023-12-29'),
      to: day('2024-01-04'),
    });

    const reference = points.find((p) => p.t === day(REFERENCE.date));
    expect(reference).toBeDefined();
    expect(Math.abs(reference!.v - REFERENCE.expectedBn)).toBeLessThan(1);
  });

  it('füllt die wöchentlichen Serien vorwärts auf Tage', () => {
    const points = computeNetLiquiditySeries(inputs, {
      from: day('2024-01-02'),
      to: day('2024-01-04'),
    });

    // 02., 03. und 04. Januar — WALCL/WTREGEN stammen vom Mittwoch, den 03.
    // bzw. für den 02. noch vom 27. Dezember.
    expect(points.map((p) => p.t)).toEqual([
      day('2024-01-02'),
      day('2024-01-03'),
      day('2024-01-04'),
    ]);
  });

  it('überspringt Tage, an denen eine Komponente fehlt — keine halbe Rechnung', () => {
    // Am 2024-01-01 hat RRPONTSYD ein leeres Feld. Der Vortagswert vom 29.12.
    // ist zwei Tage alt und damit noch gültig, also entsteht hier ein Wert.
    // Ohne jeden RRP-Wert darf dagegen kein Punkt erscheinen:
    const ohneRrp = computeNetLiquiditySeries(
      { ...inputs, rrpontsyd: [] },
      { from: day('2024-01-02'), to: day('2024-01-04') },
    );

    expect(ohneRrp).toEqual([]);
  });

  it('trägt einen wöchentlichen Wert nicht endlos weiter', () => {
    const points = computeNetLiquiditySeries(inputs, {
      from: day('2024-01-02'),
      to: day('2024-03-01'),
    });

    const last = points[points.length - 1]!;
    const lastWalcl = day('2024-01-10');

    // Höchstalter für wöchentliche Serien sind 10 Tage (§5.1).
    expect(last.t - lastWalcl).toBeLessThanOrEqual(10 * DAY);
  });

  it('liefert nichts vor dem ersten verfügbaren Wert — kein Rückwärtsfüllen', () => {
    const points = computeNetLiquiditySeries(inputs, {
      from: day('2023-12-01'),
      to: day('2023-12-20'),
    });

    expect(points).toEqual([]);
  });
});
