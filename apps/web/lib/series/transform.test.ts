import { describe, expect, it } from 'vitest';

import {
  applyValueTransforms,
  ema,
  invert,
  shiftLabel,
  shiftPoints,
  sma,
} from '@/lib/series/transform';

const DAY = 86_400;
const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);

describe('shiftPoints', () => {
  it('verschiebt um die angegebene Zahl Tage nach hinten', () => {
    const points = [{ t: day('2024-01-01'), v: 1 }];
    expect(shiftPoints(points, 90)).toEqual([{ t: day('2024-01-01') + 90 * DAY, v: 1 }]);
  });

  it('verschiebt bei negativem Wert nach vorn', () => {
    const points = [{ t: day('2024-04-01'), v: 1 }];
    expect(shiftPoints(points, -90)[0]!.t).toBe(day('2024-04-01') - 90 * DAY);
  });

  it('lässt die Werte unangetastet — verschoben wird nur die Zeit', () => {
    const points = [
      { t: day('2024-01-01'), v: 10 },
      { t: day('2024-01-02'), v: 20 },
    ];
    expect(shiftPoints(points, 5).map((p) => p.v)).toEqual([10, 20]);
  });

  it('gibt bei 0 eine unveränderte Kopie zurück', () => {
    const points = [{ t: day('2024-01-01'), v: 1 }];
    const result = shiftPoints(points, 0);
    expect(result).toEqual(points);
    expect(result).not.toBe(points);
  });

  it('erhält die Reihenfolge', () => {
    const points = [
      { t: day('2024-01-01'), v: 1 },
      { t: day('2024-01-02'), v: 2 },
    ];
    const shifted = shiftPoints(points, 30);
    expect(shifted[1]!.t).toBeGreaterThan(shifted[0]!.t);
  });
});

describe('shiftLabel', () => {
  it('macht die Verschiebung in der Legende sichtbar (§5.3)', () => {
    expect(shiftLabel(90)).toBe(' (+90d)');
    expect(shiftLabel(-30)).toBe(' (-30d)');
    expect(shiftLabel(0)).toBe('');
  });
});

describe('sma', () => {
  it('mittelt nachlaufend über das Fenster', () => {
    // Letzter Punkt: (2+3+4)/3 = 3
    expect(sma([1, 2, 3, 4], 3)![3]).toBe(3);
  });

  it('benutzt keine Zukunftswerte', () => {
    const basis = [1, 2, 3, 4];
    const ohne = sma(basis, 3);
    const mit = sma([...basis, 1000], 3);
    expect(mit.slice(0, basis.length)).toEqual(ohne);
  });

  it('lässt Lücken Lücken', () => {
    expect(sma([1, null, 3], 2)[1]).toBeNull();
  });

  it('gibt bei Fenstergröße 1 die Werte unverändert zurück', () => {
    expect(sma([1, 2, 3], 1)).toEqual([1, 2, 3]);
  });

  it('liefert immer genauso viele Werte wie die Eingabe', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toHaveLength(5);
  });
});

describe('ema', () => {
  it('startet beim ersten gültigen Wert', () => {
    expect(ema([10, 10, 10], 3)![0]).toBe(10);
  });

  it('nähert sich einem Sprung an, ohne ihn sofort zu erreichen', () => {
    const result = ema([10, 10, 20], 3);
    expect(result[2]!).toBeGreaterThan(10);
    expect(result[2]!).toBeLessThan(20);
  });

  it('benutzt keine Zukunftswerte', () => {
    const basis = [1, 2, 3, 4];
    const ohne = ema(basis, 3);
    const mit = ema([...basis, 1000], 3);
    expect(mit.slice(0, basis.length)).toEqual(ohne);
  });

  it('überspringt Lücken, ohne den Zustand zu verlieren', () => {
    const result = ema([10, null, 10], 3);
    expect(result[1]).toBeNull();
    expect(result[2]).not.toBeNull();
  });
});

describe('invert', () => {
  it('kehrt das Vorzeichen um', () => {
    expect(invert([1, -2, 0])).toEqual([-1, 2, -0]);
  });

  it('lässt null unangetastet', () => {
    expect(invert([1, null])).toEqual([-1, null]);
  });
});

describe('applyValueTransforms', () => {
  it('wendet Glättung vor Invertierung an', () => {
    const values = [1, 2, 3, 4];
    const result = applyValueTransforms(values, { sma: 2, invert: true });
    const erwartet = sma(values, 2).map((v) => (v === null ? null : -v));
    expect(result).toEqual(erwartet);
  });

  it('lässt die Werte in Ruhe, wenn nichts konfiguriert ist', () => {
    expect(applyValueTransforms([1, 2, 3], {})).toEqual([1, 2, 3]);
  });

  it('ignoriert ein Fenster von 1 oder 0', () => {
    expect(applyValueTransforms([1, 2, 3], { sma: 1 })).toEqual([1, 2, 3]);
    expect(applyValueTransforms([1, 2, 3], { ema: 0 })).toEqual([1, 2, 3]);
  });
});
