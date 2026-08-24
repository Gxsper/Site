import { describe, expect, it } from 'vitest';

import { alignSeries, maxFillAgeFor, snapToGrid } from '@/lib/series/align';
import type { Frequency, SeriesDescriptor, SeriesPoint, SeriesResponse } from '@/lib/series/types';

const DAY = 86_400;
const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);

function makeSeries(
  id: string,
  points: SeriesPoint[],
  overrides: Partial<SeriesDescriptor> = {},
): SeriesResponse {
  const descriptor: SeriesDescriptor = {
    id,
    label: id,
    group: 'macro',
    unit: 'index',
    nativeFrequency: '1d',
    provider: 'derived',
    providerParams: {},
    earliest: '2000-01-01T00:00:00Z',
    supportsLog: true,
    updateCadence: 3600,
    attribution: 'Test',
    ...overrides,
  };
  return { descriptor, points, lastUpdated: 1, stale: false };
}

const range = { from: day('2024-01-01'), to: day('2024-01-10') };

describe('snapToGrid', () => {
  it('schneidet auf 00:00 UTC bei Tagesraster', () => {
    expect(snapToGrid(day('2024-01-03') + 13 * 3600, '1d')).toBe(day('2024-01-03'));
  });

  it('lässt unregelmäßige Frequenzen unangetastet', () => {
    const t = day('2024-01-03') + 12_345;
    expect(snapToGrid(t, 'irregular')).toBe(t);
  });
});

describe('maxFillAgeFor', () => {
  it('gibt wöchentlichen Serien 10 Tage', () => {
    expect(maxFillAgeFor('1w')).toBe(10 * DAY);
  });
  it('gibt monatlichen Serien 45 Tage', () => {
    expect(maxFillAgeFor('1mo')).toBe(45 * DAY);
  });
  it('gibt täglichen Serien 5 Tage', () => {
    expect(maxFillAgeFor('1d')).toBe(5 * DAY);
  });
});

describe('alignSeries — Look-ahead', () => {
  /**
   * Der Test, an dem laut §13 die Phase hängt: eine monatliche Serie darf nie
   * vor ihrem Veröffentlichungsdatum erscheinen.
   */
  it('lässt eine monatliche Serie nie vor ihrem Veröffentlichungstag erscheinen', () => {
    const btc = makeSeries('btc', [
      { t: day('2024-01-01'), v: 100 },
      { t: day('2024-02-01'), v: 110 },
      { t: day('2024-03-01'), v: 120 },
    ]);
    const cpi = makeSeries('cpi', [{ t: day('2024-03-01'), v: 3.2 }], {
      nativeFrequency: '1mo',
    });

    const aligned = alignSeries([btc, cpi], {
      mode: 'union_ffill',
      grid: '1d',
      from: day('2024-01-01'),
      to: day('2024-03-01'),
    });

    const cpiRow = aligned.values[1]!;

    // Der CPI-Wert vom 1. März darf am 1. Januar und 1. Februar nicht stehen.
    expect(cpiRow[aligned.t.indexOf(day('2024-01-01'))]).toBeNull();
    expect(cpiRow[aligned.t.indexOf(day('2024-02-01'))]).toBeNull();
    expect(cpiRow[aligned.t.indexOf(day('2024-03-01'))]).toBe(3.2);
  });

  it('füllt niemals rückwärts, auch nicht über einen einzigen Schritt', () => {
    const a = makeSeries('a', [
      { t: day('2024-01-01'), v: 1 },
      { t: day('2024-01-02'), v: 2 },
    ]);
    const b = makeSeries('b', [{ t: day('2024-01-02'), v: 9 }]);

    const aligned = alignSeries([a, b], { mode: 'union_ffill', grid: '1d', ...range });

    expect(aligned.values[1]![0]).toBeNull();
    expect(aligned.values[1]![1]).toBe(9);
  });
});

describe('alignSeries — Serie beginnt später', () => {
  it('lässt die Linie später starten, statt mit 0 aufzufüllen', () => {
    const alt = makeSeries('spaet', [{ t: day('2024-01-05'), v: 50 }], {
      earliest: '2024-01-05T00:00:00Z',
    });
    const btc = makeSeries('btc', [
      { t: day('2024-01-01'), v: 1 },
      { t: day('2024-01-05'), v: 5 },
    ]);

    const aligned = alignSeries([btc, alt], { mode: 'union_ffill', grid: '1d', ...range });
    const row = aligned.values[1]!;

    expect(row[aligned.t.indexOf(day('2024-01-01'))]).toBeNull();
    expect(row.some((v) => v === 0)).toBe(false);
    expect(row[aligned.t.indexOf(day('2024-01-05'))]).toBe(50);
  });

  it('unterdrückt Werte vor dem dokumentierten earliest, selbst wenn Punkte da wären', () => {
    // Ein Provider liefert versehentlich einen Punkt vor dem earliest.
    const s = makeSeries('s', [
      { t: day('2024-01-01'), v: 1 },
      { t: day('2024-01-06'), v: 6 },
    ], { earliest: '2024-01-05T00:00:00Z' });

    const aligned = alignSeries([s], { mode: 'union_ffill', grid: '1d', ...range });

    expect(aligned.values[0]![aligned.t.indexOf(day('2024-01-01'))]).toBeNull();
  });
});

describe('alignSeries — Feiertagslücke und Höchstalter', () => {
  it('überbrückt eine Feiertagslücke im Aktienkalender', () => {
    // SPX handelt am 01.01. nicht, BTC schon.
    const btc = makeSeries('btc', [
      { t: day('2024-01-01'), v: 100 },
      { t: day('2024-01-02'), v: 101 },
    ]);
    const spx = makeSeries('spx', [
      { t: day('2023-12-29'), v: 4770 },
      { t: day('2024-01-02'), v: 4742 },
    ]);

    const aligned = alignSeries([btc, spx], {
      mode: 'union_ffill',
      grid: '1d',
      from: day('2023-12-29'),
      to: day('2024-01-02'),
    });

    // Am 01.01. trägt SPX den Schlusskurs vom 29.12. — und ist als gefüllt markiert.
    const index = aligned.t.indexOf(day('2024-01-01'));
    expect(aligned.values[1]![index]).toBe(4770);
    expect(aligned.filled[1]![index]).toBe(true);
  });

  it('markiert echte Messwerte nicht als gefüllt', () => {
    const s = makeSeries('s', [
      { t: day('2024-01-01'), v: 1 },
      { t: day('2024-01-02'), v: 2 },
    ]);
    const aligned = alignSeries([s], { mode: 'union_ffill', grid: '1d', ...range });

    expect(aligned.filled[0]![0]).toBe(false);
    expect(aligned.filled[0]![1]).toBe(false);
  });

  it('bricht die Linie ab, wenn die Lücke das Höchstalter überschreitet', () => {
    const btc = makeSeries('btc', [
      { t: day('2024-01-01'), v: 1 },
      { t: day('2024-01-10'), v: 10 },
    ]);
    // Tagesserie, die neun Tage nichts liefert — Höchstalter sind fünf Tage.
    const tot = makeSeries('tot', [{ t: day('2024-01-01'), v: 42 }]);

    const aligned = alignSeries([btc, tot], { mode: 'union_ffill', grid: '1d', ...range });
    const row = aligned.values[1]!;

    expect(row[aligned.t.indexOf(day('2024-01-01'))]).toBe(42);
    expect(row[aligned.t.indexOf(day('2024-01-10'))]).toBeNull();
  });

  it('gibt einer wöchentlichen Serie die längere Frist', () => {
    const btc = makeSeries('btc', [
      { t: day('2024-01-01'), v: 1 },
      { t: day('2024-01-08'), v: 8 },
    ]);
    const walcl = makeSeries('walcl', [{ t: day('2024-01-01'), v: 7681 }], {
      nativeFrequency: '1w',
    });

    const aligned = alignSeries([btc, walcl], { mode: 'union_ffill', grid: '1d', ...range });

    // Sieben Tage alt: bei einer Tagesserie eine Lücke, bei einer wöchentlichen gültig.
    expect(aligned.values[1]![aligned.t.indexOf(day('2024-01-08'))]).toBe(7681);
  });
});

describe('alignSeries — Frequenzmix', () => {
  it('bringt wöchentliche und tägliche Serien auf ein gemeinsames Raster', () => {
    const daily = makeSeries('daily', [
      { t: day('2024-01-01'), v: 1 },
      { t: day('2024-01-02'), v: 2 },
      { t: day('2024-01-03'), v: 3 },
    ]);
    const weekly = makeSeries('weekly', [{ t: day('2024-01-03'), v: 700 }], {
      nativeFrequency: '1w',
    });

    const aligned = alignSeries([daily, weekly], {
      mode: 'union_ffill',
      grid: '1d',
      from: day('2024-01-01'),
      to: day('2024-01-03'),
    });

    expect(aligned.t).toHaveLength(3);
    expect(aligned.values[0]).toEqual([1, 2, 3]);
    expect(aligned.values[1]).toEqual([null, null, 700]);
  });

  it('fasst mehrere Intraday-Punkte pro Tag zusammen', () => {
    const s = makeSeries('s', [
      { t: day('2024-01-01') + 3600, v: 1 },
      { t: day('2024-01-01') + 7200, v: 2 },
      { t: day('2024-01-02') + 3600, v: 3 },
    ], { nativeFrequency: '1h' });

    const aligned = alignSeries([s], {
      mode: 'union_ffill',
      grid: '1d',
      from: day('2024-01-01'),
      to: day('2024-01-02'),
    });

    // Bei Kollision auf demselben Rastertag gewinnt der spätere Wert.
    expect(aligned.t).toEqual([day('2024-01-01'), day('2024-01-02')]);
    expect(aligned.values[0]).toEqual([2, 3]);
  });
});

describe('alignSeries — Modi', () => {
  const a = makeSeries('a', [
    { t: day('2024-01-01'), v: 1 },
    { t: day('2024-01-02'), v: 2 },
    { t: day('2024-01-03'), v: 3 },
  ]);
  const b = makeSeries('b', [
    { t: day('2024-01-02'), v: 20 },
    { t: day('2024-01-04'), v: 40 },
  ]);

  it('intersection nimmt nur Zeitpunkte mit echten Werten in allen Serien', () => {
    const aligned = alignSeries([a, b], { mode: 'intersection', grid: '1d', ...range });

    expect(aligned.t).toEqual([day('2024-01-02')]);
    expect(aligned.values[0]).toEqual([2]);
    expect(aligned.values[1]).toEqual([20]);
  });

  it('intersection füllt nichts — nichts ist als gefüllt markiert', () => {
    const aligned = alignSeries([a, b], { mode: 'intersection', grid: '1d', ...range });
    expect(aligned.filled.flat().every((f) => f === false)).toBe(true);
  });

  it('native lässt jede Serie ihre eigenen Punkte behalten', () => {
    const aligned = alignSeries([a, b], { mode: 'native', grid: '1d', ...range });

    expect(aligned.t).toEqual([
      day('2024-01-01'),
      day('2024-01-02'),
      day('2024-01-03'),
      day('2024-01-04'),
    ]);
    expect(aligned.values[1]).toEqual([null, 20, null, 40]);
  });

  it('trading_days nimmt das Raster der Referenzserie', () => {
    const aligned = alignSeries([a, b], {
      mode: 'trading_days',
      grid: '1d',
      referenceId: 'b',
      ...range,
    });

    expect(aligned.t).toEqual([day('2024-01-02'), day('2024-01-04')]);
    // a wird auf dieses Raster vorwärts gefüllt.
    expect(aligned.values[0]).toEqual([2, 3]);
  });

  it('wirft, wenn die Referenzserie gar nicht angefragt wurde', () => {
    expect(() =>
      alignSeries([a, b], { mode: 'trading_days', grid: '1d', referenceId: 'gibtsnicht', ...range }),
    ).toThrow(/Referenzserie/);
  });
});

describe('alignSeries — Randfälle', () => {
  it('verkraftet eine leere Eingabe', () => {
    const aligned = alignSeries([], { mode: 'union_ffill', grid: '1d', ...range });
    expect(aligned.t).toEqual([]);
    expect(aligned.values).toEqual([]);
  });

  it('verkraftet eine Serie ohne Punkte im Zeitraum', () => {
    const leer = makeSeries('leer', []);
    const aligned = alignSeries([leer], { mode: 'union_ffill', grid: '1d', ...range });
    expect(aligned.t).toEqual([]);
  });

  it('ignoriert Punkte außerhalb des angefragten Zeitraums', () => {
    const s = makeSeries('s', [
      { t: day('2023-06-01'), v: 1 },
      { t: day('2024-01-02'), v: 2 },
      { t: day('2025-06-01'), v: 3 },
    ]);
    const aligned = alignSeries([s], { mode: 'union_ffill', grid: '1d', ...range });
    expect(aligned.t).toEqual([day('2024-01-02')]);
  });

  it('liefert für jede Serie eine Zeile in der Länge des Rasters', () => {
    const aligned = alignSeries([
      makeSeries('a', [{ t: day('2024-01-01'), v: 1 }]),
      makeSeries('b', [{ t: day('2024-01-03'), v: 3 }]),
    ], { mode: 'union_ffill', grid: '1d', ...range });

    for (const row of aligned.values) expect(row).toHaveLength(aligned.t.length);
    for (const row of aligned.filled) expect(row).toHaveLength(aligned.t.length);
  });

  it('liefert ein streng monoton steigendes Raster', () => {
    const frequencies: Frequency[] = ['1d', '1w'];
    for (const frequency of frequencies) {
      const aligned = alignSeries([
        makeSeries('a', [
          { t: day('2024-01-03'), v: 3 },
          { t: day('2024-01-01'), v: 1 },
        ], { nativeFrequency: frequency }),
      ], { mode: 'union_ffill', grid: '1d', ...range });

      for (let i = 1; i < aligned.t.length; i++) {
        expect(aligned.t[i]!).toBeGreaterThan(aligned.t[i - 1]!);
      }
    }
  });
});
