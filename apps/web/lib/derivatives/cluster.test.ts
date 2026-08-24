import { describe, expect, it } from 'vitest';

import { buildCluster, type ClusterEvent } from '@/lib/derivatives/cluster';

const HOUR = 3600;
const T0 = Math.floor(Date.parse('2026-08-24T12:00:00Z') / 1000);

function event(offsetSeconds: number, price: number, quoteQty: number, side: 'long' | 'short' = 'long'): ClusterEvent {
  return { t: T0 + offsetSeconds, price, quoteQty, side };
}

describe('buildCluster', () => {
  it('liefert für keine Ereignisse ein leeres Cluster', () => {
    const cluster = buildCluster([], T0, HOUR, 10);

    expect(cluster.cells).toEqual([]);
    expect(cluster.priceRange).toBeNull();
    expect(cluster.maxCell).toBe(0);
  });

  it('spannt die Preisachse über die beobachteten Preise', () => {
    const cluster = buildCluster([event(0, 100, 1000), event(60, 200, 500)], T0, HOUR, 10);

    expect(cluster.priceRange).toEqual({ min: 100, max: 200 });
    expect(cluster.prices).toHaveLength(10);
    expect(cluster.prices[0]).toBe(100);
  });

  it('summiert Ereignisse in derselben Zelle', () => {
    // Beide im selben Zeitfenster und Preisband.
    const cluster = buildCluster([event(0, 100, 1000), event(600, 101, 500)], T0, HOUR, 4);

    const total = cluster.cells.reduce((sum, cell) => sum + cell.total, 0);
    expect(total).toBe(1500);
  });

  it('trennt Ereignisse in unterschiedlichen Zeitfenstern', () => {
    const cluster = buildCluster([event(0, 100, 1000), event(2 * HOUR, 100, 500)], T0, HOUR, 4);

    expect(cluster.cells).toHaveLength(2);
    expect(cluster.cells.map((c) => c.x)).toEqual([0, 2]);
  });

  it('ordnet den höchsten Preis noch dem letzten Band zu', () => {
    // Ohne Deckelung fiele der Maximalwert in ein Band jenseits des Rasters.
    const cluster = buildCluster([event(0, 100, 10), event(60, 200, 10)], T0, HOUR, 4);

    for (const cell of cluster.cells) {
      expect(cell.y).toBeGreaterThanOrEqual(0);
      expect(cell.y).toBeLessThan(cluster.prices.length);
    }
  });

  it('verkraftet Ereignisse auf exakt demselben Preis', () => {
    const cluster = buildCluster([event(0, 100, 10), event(60, 100, 20)], T0, HOUR, 40);

    expect(cluster.prices).toHaveLength(1);
    expect(cluster.cells).toHaveLength(1);
    expect(cluster.cells[0]!.total).toBe(30);
  });

  it('gibt keine leeren Zellen aus — 0 wäre eine andere Aussage', () => {
    const cluster = buildCluster([event(0, 100, 1000)], T0, HOUR, 20);

    // Ein Raster aus 1 × 20 Feldern, aber nur eine Zelle mit Inhalt.
    expect(cluster.cells).toHaveLength(1);
    expect(cluster.cells.every((cell) => cell.total > 0)).toBe(true);
  });

  it('benennt die überwiegende Seite ab 80 Prozent', () => {
    const nurLongs = buildCluster([event(0, 100, 900), event(60, 100, 100, 'short')], T0, HOUR, 4);
    expect(nurLongs.cells[0]!.side).toBe('long');

    const nurShorts = buildCluster(
      [event(0, 100, 100), event(60, 100, 900, 'short')],
      T0,
      HOUR,
      4,
    );
    expect(nurShorts.cells[0]!.side).toBe('short');
  });

  it('nennt eine ausgewogene Zelle „gemischt"', () => {
    const cluster = buildCluster([event(0, 100, 500), event(60, 100, 500, 'short')], T0, HOUR, 4);
    expect(cluster.cells[0]!.side).toBe('gemischt');
  });

  it('meldet die größte Zelle für die Farbskala', () => {
    const cluster = buildCluster(
      [event(0, 100, 1000), event(2 * HOUR, 100, 5000)],
      T0,
      HOUR,
      4,
    );
    expect(cluster.maxCell).toBe(5000);
  });

  it('überspringt Ereignisse mit unbrauchbarem Preis, statt sie zu raten', () => {
    const kaputt: ClusterEvent[] = [
      { t: T0, price: 0, quoteQty: 100, side: 'long' },
      { t: T0, price: Number.NaN, quoteQty: 100, side: 'long' },
      { t: T0 + 60, price: 100, quoteQty: 50, side: 'long' },
    ];
    const cluster = buildCluster(kaputt, T0, HOUR, 4);

    expect(cluster.cells).toHaveLength(1);
    expect(cluster.cells[0]!.total).toBe(50);
  });

  it('ignoriert Ereignisse vor dem Beobachtungsfenster', () => {
    const cluster = buildCluster([event(-5 * HOUR, 100, 1000), event(0, 100, 50)], T0, HOUR, 4);

    // Nur das Ereignis im Fenster zählt.
    expect(cluster.cells.reduce((sum, c) => sum + c.total, 0)).toBe(50);
  });

  it('liefert für jede Zelle gültige Achsenindizes', () => {
    const events = Array.from({ length: 50 }, (_, i) =>
      event(i * 900, 100 + (i % 17) * 3, 100 + i, i % 3 === 0 ? 'short' : 'long'),
    );
    const cluster = buildCluster(events, T0, HOUR, 12);

    for (const cell of cluster.cells) {
      expect(cell.x).toBeGreaterThanOrEqual(0);
      expect(cell.x).toBeLessThan(cluster.times.length);
      expect(cell.y).toBeGreaterThanOrEqual(0);
      expect(cell.y).toBeLessThan(cluster.prices.length);
      expect(cell.count).toBeGreaterThan(0);
    }
  });
});
