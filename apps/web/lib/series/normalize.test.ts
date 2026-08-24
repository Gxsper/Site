import { describe, expect, it } from 'vitest';

import {
  allowsLogScale,
  logReturns,
  normalize,
  NormalizationError,
} from '@/lib/series/normalize';

const DAY = 86_400;
const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);

describe('rebase100', () => {
  it('setzt den ersten Wert auf 100', () => {
    expect(normalize([50, 75, 100], 'rebase100')).toEqual([100, 150, 200]);
  });

  it('rebased auf den ersten *gültigen* Wert, nicht auf die erste Position', () => {
    expect(normalize([null, 50, 100], 'rebase100')).toEqual([null, 100, 200]);
  });

  it('bezieht sich auf den übergebenen Zeitraum — enger Ausschnitt, neue Basis', () => {
    const voll = normalize([50, 75, 100], 'rebase100');
    const ausschnitt = normalize([75, 100], 'rebase100');

    expect(voll).toEqual([100, 150, 200]);
    // §5.2: Rebasing bezieht sich auf den sichtbaren Zeitraum.
    expect(ausschnitt).toEqual([100, expect.closeTo(133.333, 3)]);
  });

  it('wirft, wenn die Basis 0 ist, statt Unendlich zu liefern', () => {
    expect(() => normalize([0, 5], 'rebase100', { seriesId: 'x' })).toThrow(NormalizationError);
  });

  it('liefert lauter null, wenn es im Zeitraum keine Werte gibt', () => {
    expect(normalize([null, null], 'rebase100')).toEqual([null, null]);
  });
});

describe('pct_change', () => {
  it('gibt die Veränderung seit t0 in Prozent', () => {
    expect(normalize([50, 75, 100], 'pct_change')).toEqual([0, 50, 100]);
  });

  it('wird bei fallenden Kursen negativ', () => {
    expect(normalize([100, 50], 'pct_change')).toEqual([0, -50]);
  });
});

describe('zscore', () => {
  it('bleibt null, solange das Fenster nicht genug Beobachtungen hat', () => {
    const result = normalize([1, 2, 3], 'zscore', { window: 365 });
    expect(result).toEqual([null, null, null]);
  });

  it('benutzt nur vergangene Werte — kein Look-ahead', () => {
    // Ein extremer Ausreißer ganz am Ende darf frühere z-Scores nicht verändern.
    const basis = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 1 : 2));
    const ohne = normalize([...basis], 'zscore', { window: 30 });
    const mit = normalize([...basis, 1_000_000], 'zscore', { window: 30 });

    expect(mit.slice(0, basis.length)).toEqual(ohne);
  });

  it('liefert für eine konstante Reihe null statt 0', () => {
    const konstant = new Array<number>(60).fill(5);
    expect(normalize(konstant, 'zscore', { window: 30 }).every((v) => v === null)).toBe(true);
  });

  it('setzt einen Wert über dem Mittel positiv an', () => {
    const values = [...Array.from({ length: 40 }, () => 10), 20];
    const result = normalize(values, 'zscore', { window: 40 });
    expect(result[result.length - 1]!).toBeGreaterThan(0);
  });
});

describe('minmax', () => {
  it('skaliert auf 0..1 über den sichtbaren Zeitraum', () => {
    expect(normalize([10, 20, 30], 'minmax')).toEqual([0, 0.5, 1]);
  });

  it('liefert für eine flache Reihe null statt eines erfundenen Mittelwerts', () => {
    expect(normalize([7, 7, 7], 'minmax')).toEqual([null, null, null]);
  });

  it('lässt Lücken Lücken', () => {
    expect(normalize([10, null, 30], 'minmax')).toEqual([0, null, 1]);
  });
});

describe('log_returns', () => {
  it('lässt den ersten Punkt leer — er hat keinen Vorgänger', () => {
    expect(logReturns([100, 110])[0]).toBeNull();
  });

  it('rechnet ln(x_t / x_{t-1})', () => {
    const result = logReturns([100, 110]);
    expect(result[1]!).toBeCloseTo(Math.log(1.1), 12);
  });

  it('ist bei nicht-positiven Werten nicht definiert und liefert null', () => {
    expect(logReturns([100, 0, 50])).toEqual([null, null, null]);
    expect(logReturns([100, -5])).toEqual([null, null]);
  });

  it('überspringt Lücken, statt über sie hinweg zu rechnen', () => {
    expect(logReturns([100, null, 121])).toEqual([null, null, null]);
  });
});

describe('yoy', () => {
  const t = Array.from({ length: 400 }, (_, i) => day('2023-01-01') + i * DAY);

  it('vergleicht mit dem Wert vor einem Jahr', () => {
    const values = t.map((_, i) => (i < 365 ? 100 : 120));
    const result = normalize(values, 'yoy', { t });

    // Tag 365 ist ein Jahr nach Tag 0: 120 gegen 100 = +20 %.
    expect(result[365]!).toBeCloseTo(20, 6);
  });

  it('bleibt im ersten Jahr leer — es gibt keinen Vorjahreswert', () => {
    const values = t.map(() => 100);
    const result = normalize(values, 'yoy', { t });
    expect(result.slice(0, 360).every((v) => v === null)).toBe(true);
  });

  it('braucht die Zeitachse und sagt das deutlich', () => {
    expect(() => normalize([1, 2], 'yoy', { seriesId: 'x' })).toThrow(/Zeitachse/);
  });

  it('meldet eine Längenabweichung, statt still falsch zu rechnen', () => {
    expect(() => normalize([1, 2, 3], 'yoy', { t: [1, 2], seriesId: 'x' })).toThrow(
      NormalizationError,
    );
  });
});

describe('raw', () => {
  it('gibt die Werte unverändert zurück', () => {
    expect(normalize([1, null, 3], 'raw')).toEqual([1, null, 3]);
  });

  it('liefert eine Kopie, keine Referenz', () => {
    const input = [1, 2];
    expect(normalize(input, 'raw')).not.toBe(input);
  });
});

describe('allowsLogScale', () => {
  it('erlaubt Log bei raw, rebase100 und minmax', () => {
    expect(allowsLogScale('raw')).toBe(true);
    expect(allowsLogScale('rebase100')).toBe(true);
    expect(allowsLogScale('minmax')).toBe(true);
  });

  it('verbietet Log, wo Werte <= 0 auftreten können (§5.2)', () => {
    expect(allowsLogScale('pct_change')).toBe(false);
    expect(allowsLogScale('zscore')).toBe(false);
    expect(allowsLogScale('log_returns')).toBe(false);
    expect(allowsLogScale('yoy')).toBe(false);
  });
});

describe('Lücken bleiben Lücken', () => {
  it('macht aus null in keiner Normalisierung eine 0', () => {
    const modes = ['raw', 'rebase100', 'pct_change', 'zscore', 'minmax', 'log_returns'] as const;
    for (const mode of modes) {
      const result = normalize([100, null, 120], mode, { window: 2 });
      expect(result[1], mode).toBeNull();
    }
  });
});
