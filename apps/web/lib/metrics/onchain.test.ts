import { describe, expect, it } from 'vitest';

import {
  approximateMinerRevenueUsd,
  mvrvZScore,
  nupl,
  puellMultiple,
  realizedCap,
  realizedPrice,
  thermocapIsTruncated,
  thermocapMultiple,
} from '@/lib/metrics/onchain';
import type { SeriesPoint } from '@/lib/series/types';

const DAY = 86_400;
const T0 = Math.floor(Date.parse('2024-01-01T00:00:00Z') / 1000);
const at = (i: number) => T0 + i * DAY;

function series(values: number[]): SeriesPoint[] {
  return values.map((v, i) => ({ t: at(i), v }));
}

describe('realizedCap — die Rekonstruktion aus §6.5', () => {
  /**
   * Echte Werte von Coin Metrics für BTC am 2024-01-01, abgerufen über
   * /api/series (docs/api-samples/FINDINGS.md §3):
   *
   *   CapMrktCurUSD = 862 798 932 438,5515
   *   CapMVRVCur    =           2,005011405976
   *   → Realized Cap = 430 321 209 079,8845
   *
   * Nachgerechnet: 430 321 209 079,8845 × 2,005011405976 ergibt wieder die
   * Market Cap. Die Gegenprobe steht als eigener Test darunter.
   */
  it('rechnet Realized Cap aus Market Cap und MVRV zurück', () => {
    const result = realizedCap(series([862_798_932_438.5515]), series([2.005011405976]));

    expect(result).toHaveLength(1);
    // Relative Genauigkeit: bei einer Größe im Bereich 4·10¹¹ ist eine
    // absolute Toleranz von wenigen Einheiten sinnlos.
    expect(result[0]!.v / 430_321_209_079.8845).toBeCloseTo(1, 12);
  });

  it('trifft den Realized Price für dasselbe Datum', () => {
    // 430 321 209 079,8845 / 19 587 042,99589609 BTC = 21 969,69 USD
    const realized = realizedCap(series([862_798_932_438.5515]), series([2.005011405976]));
    const price = realizedPrice(realized, series([19_587_042.99589609]));

    expect(price[0]!.v).toBeCloseTo(21_969.687_265_7, 6);
  });

  it('ist die exakte Umkehrung — Market Cap / Realized Cap ergibt wieder MVRV', () => {
    const cap = series([862_798_932_438.5515]);
    const mvrv = series([2.005011405976]);
    const realized = realizedCap(cap, mvrv);

    expect(cap[0]!.v / realized[0]!.v).toBeCloseTo(mvrv[0]!.v, 9);
  });

  it('überspringt Zeitpunkte, an denen MVRV fehlt — keine halbe Rechnung', () => {
    const cap = series([100, 200, 300]);
    const mvrv = [
      { t: at(0), v: 2 },
      { t: at(2), v: 3 },
    ];

    expect(realizedCap(cap, mvrv)).toEqual([
      { t: at(0), v: 50 },
      { t: at(2), v: 100 },
    ]);
  });

  it('überspringt ein MVRV von 0, statt Unendlich zu liefern', () => {
    expect(realizedCap(series([100]), series([0]))).toEqual([]);
  });
});

describe('realizedPrice', () => {
  it('teilt Realized Cap durch die Umlaufmenge', () => {
    // 430 321 209 079,8845 / 19 587 042,99589609 BTC = 21 969,687 USD
    const result = realizedPrice(series([430_321_209_079.8845]), series([19_587_042.99589609]));
    expect(result[0]!.v).toBeCloseTo(21_969.687_265_7, 6);
  });

  it('überspringt eine Umlaufmenge von 0', () => {
    expect(realizedPrice(series([100]), series([0]))).toEqual([]);
  });
});

describe('nupl', () => {
  it('rechnet (Market − Realized) / Market', () => {
    // (1000 − 400) / 1000 = 0,6
    expect(nupl(series([1000]), series([400]))[0]!.v).toBeCloseTo(0.6, 12);
  });

  it('wird negativ, wenn der Markt unter dem Einstand liegt', () => {
    expect(nupl(series([400]), series([1000]))[0]!.v).toBeCloseTo(-1.5, 12);
  });

  it('liegt bei MVRV = 1 genau bei 0', () => {
    expect(nupl(series([500]), series([500]))[0]!.v).toBe(0);
  });
});

describe('mvrvZScore', () => {
  it('braucht mindestens 30 Beobachtungen', () => {
    const cap = series(Array.from({ length: 20 }, (_, i) => 100 + i));
    const realized = series(Array.from({ length: 20 }, () => 50));

    expect(mvrvZScore(cap, realized)).toEqual([]);
  });

  it('benutzt ein mitwachsendes Fenster — spätere Daten ändern frühere Werte nicht', () => {
    const werte = Array.from({ length: 200 }, (_, i) => 1000 + i * 10 + 100 * Math.sin(i / 7));
    const realizedWerte = werte.map((v) => v * 0.6);

    const kurz = mvrvZScore(series(werte.slice(0, 150)), series(realizedWerte.slice(0, 150)));
    const lang = mvrvZScore(series(werte), series(realizedWerte));
    const langByT = new Map(lang.map((p) => [p.t, p.v]));

    for (const point of kurz) {
      expect(langByT.get(point.t), `t=${point.t}`).toBeCloseTo(point.v, 12);
    }
  });

  it('ist positiv, wenn die Market Cap über der Realized Cap liegt', () => {
    const werte = Array.from({ length: 100 }, (_, i) => 1000 + i);
    const result = mvrvZScore(series(werte), series(werte.map((v) => v * 0.5)));

    expect(result.every((p) => p.v > 0)).toBe(true);
  });
});

describe('puellMultiple', () => {
  it('liegt bei konstanten Einnahmen genau bei 1', () => {
    const result = puellMultiple(series(new Array<number>(400).fill(1000)));
    const letzter = result[result.length - 1]!;
    expect(letzter.v).toBeCloseTo(1, 9);
  });

  it('steigt über 1, wenn die Einnahmen über ihrem Jahresschnitt liegen', () => {
    const werte = new Array<number>(400).fill(1000);
    werte[399] = 3000;

    const result = puellMultiple(series(werte));
    expect(result[result.length - 1]!.v).toBeGreaterThan(2);
  });

  it('wirft bei weniger als 365 Tagen, statt einen kürzeren Schnitt zu nehmen', () => {
    expect(() => puellMultiple(series(new Array<number>(100).fill(1000)))).toThrow(/365/);
  });
});

describe('thermocapMultiple', () => {
  it('teilt die Market Cap durch die kumulierten Einnahmen', () => {
    // Einnahmen 100, 100, 100 → kumuliert 100, 200, 300
    // Market Cap 1000 → 10, 5, 3,333…
    const result = thermocapMultiple(series([1000, 1000, 1000]), series([100, 100, 100]));

    expect(result.points.map((p) => p.v)).toEqual([10, 5, expect.closeTo(3.3333, 4)]);
  });

  it('fällt bei gleichbleibender Market Cap monoton', () => {
    const result = thermocapMultiple(
      series(new Array<number>(50).fill(1000)),
      series(new Array<number>(50).fill(10)),
    );

    for (let i = 1; i < result.points.length; i++) {
      expect(result.points[i]!.v).toBeLessThan(result.points[i - 1]!.v);
    }
  });

  it('meldet, ab wann die Kumulation reicht', () => {
    const result = thermocapMultiple(series([1000, 1000]), series([100, 100]));
    expect(result.coverageFrom).toBe(at(0));
    expect(result.methodology).toMatch(/Kumulation beginnt am/);
  });

  it('erkennt eine abgeschnittene Einnahmereihe', () => {
    const cap = series([1000, 1000]);
    // Einnahmen beginnen erst ein Jahr nach der Market Cap.
    const spaet = at(0) + 365 * DAY;

    expect(thermocapIsTruncated(cap, spaet)).toBe(true);
    expect(thermocapIsTruncated(cap, at(0))).toBe(false);
    expect(thermocapIsTruncated(cap, null)).toBe(true);
  });

  it('überspringt Tage ohne kumulierte Einnahmen', () => {
    const result = thermocapMultiple(series([1000, 1000, 1000]), [{ t: at(1), v: 100 }]);
    expect(result.points).toHaveLength(1);
    expect(result.points[0]!.t).toBe(at(1));
  });
});

describe('approximateMinerRevenueUsd', () => {
  it('addiert Ausgabe in USD und Gebühren in BTC mal Preis', () => {
    // 900 000 USD Ausgabe + 12 BTC Gebühren × 45 000 USD = 1 440 000 USD
    const result = approximateMinerRevenueUsd(series([900_000]), series([12]), series([45_000]));
    expect(result[0]!.v).toBeCloseTo(1_440_000, 6);
  });

  it('überspringt Zeitpunkte, an denen der Preis fehlt', () => {
    const result = approximateMinerRevenueUsd(series([900_000, 900_000]), series([12, 12]), [
      { t: at(0), v: 45_000 },
    ]);
    expect(result).toHaveLength(1);
  });
});
