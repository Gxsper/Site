import { describe, expect, it } from 'vitest';

import { dailyGrid, forwardFill, MAX_FILL_AGE } from '@/lib/series/ffill';

const DAY = 86_400;
const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);

describe('dailyGrid', () => {
  it('erzeugt ein Tagesraster mit Cut um 00:00 UTC', () => {
    const grid = dailyGrid(day('2024-01-01'), day('2024-01-04'));
    expect(grid).toEqual([
      day('2024-01-01'),
      day('2024-01-02'),
      day('2024-01-03'),
      day('2024-01-04'),
    ]);
  });

  it('rundet einen Startzeitpunkt mitten am Tag auf den nächsten Tagesbeginn auf', () => {
    const grid = dailyGrid(day('2024-01-01') + 3600, day('2024-01-03'));
    expect(grid[0]).toBe(day('2024-01-02'));
  });
});

describe('forwardFill', () => {
  const grid = dailyGrid(day('2024-01-01'), day('2024-01-07'));

  it('trägt einen Wert vorwärts bis zum nächsten', () => {
    const points = [
      { t: day('2024-01-01'), v: 10 },
      { t: day('2024-01-04'), v: 20 },
    ];

    expect(forwardFill(points, grid, MAX_FILL_AGE.weekly)).toEqual([
      10, 10, 10, 20, 20, 20, 20,
    ]);
  });

  it('füllt nie rückwärts — Look-ahead-Bias', () => {
    // Der einzige Wert stammt vom 04. Januar. Die Tage davor müssen leer
    // bleiben: ein am 4. veröffentlichter Wert existierte am 1. noch nicht.
    const points = [{ t: day('2024-01-04'), v: 42 }];

    expect(forwardFill(points, grid, MAX_FILL_AGE.weekly)).toEqual([
      null, null, null, 42, 42, 42, 42,
    ]);
  });

  it('erzeugt eine Lücke, statt einen Wert über sein Höchstalter zu tragen', () => {
    const points = [{ t: day('2024-01-01'), v: 7 }];
    const result = forwardFill(points, grid, 2 * DAY);

    // 01., 02. und 03. sind höchstens zwei Tage alt, danach Lücke.
    expect(result).toEqual([7, 7, 7, null, null, null, null]);
  });

  it('liefert lauter null, wenn es gar keine Punkte gibt', () => {
    expect(forwardFill([], grid, MAX_FILL_AGE.daily)).toEqual([
      null, null, null, null, null, null, null,
    ]);
  });

  it('lässt einen Punkt von später am Tag nicht in den früheren Rasterpunkt zurückwirken', () => {
    const points = [
      { t: day('2024-01-01'), v: 1 },
      { t: day('2024-01-01') + 3600, v: 2 }, // 01:00 UTC, also nach dem Rasterpunkt
    ];
    const result = forwardFill(points, grid, MAX_FILL_AGE.daily);

    // Der Rasterpunkt ist 00:00 UTC. Der Wert von 01:00 existierte da noch
    // nicht und darf erst am Folgetag erscheinen — sonst Look-ahead-Bias.
    expect(result[0]).toBe(1);
    expect(result[1]).toBe(2);
  });

  it('gibt für ein leeres Raster ein leeres Ergebnis zurück', () => {
    expect(forwardFill([{ t: day('2024-01-01'), v: 1 }], [], MAX_FILL_AGE.daily)).toEqual([]);
  });

  it('liefert immer genau so viele Werte wie das Raster lang ist', () => {
    const points = [{ t: day('2024-01-03'), v: 5 }];
    expect(forwardFill(points, grid, MAX_FILL_AGE.daily)).toHaveLength(grid.length);
  });

  it('setzt nie 0 für eine Lücke', () => {
    const points = [{ t: day('2024-01-05'), v: 99 }];
    const result = forwardFill(points, grid, MAX_FILL_AGE.daily);

    expect(result.slice(0, 4)).toEqual([null, null, null, null]);
    expect(result.some((v) => v === 0)).toBe(false);
  });
});
