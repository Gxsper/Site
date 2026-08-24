import { describe, expect, it } from 'vitest';

import {
  buildSeriesQuery,
  colorForIndex,
  decodeState,
  defaultState,
  encodeState,
  LAYER_COLORS,
  rangeForPreset,
  type OverlayState,
} from '@/lib/url-state';

const NOW = Math.floor(Date.parse('2024-06-15T00:00:00Z') / 1000);
const DAY = 86_400;

function stateWith(overrides: Partial<OverlayState> = {}): OverlayState {
  return {
    ...defaultState(NOW),
    layers: [
      { id: 'btc.usd.close', shift: 0, smooth: 0, invert: false, visible: true, axis: 'left' },
    ],
    ...overrides,
  };
}

describe('rangeForPreset', () => {
  it('rechnet Tages-Presets ab jetzt zurück', () => {
    expect(rangeForPreset('1M', NOW)).toEqual({ from: NOW - 30 * DAY, to: NOW });
    expect(rangeForPreset('1Y', NOW)).toEqual({ from: NOW - 365 * DAY, to: NOW });
  });

  it('startet YTD am 1. Januar des laufenden Jahres', () => {
    const { from } = rangeForPreset('YTD', NOW);
    expect(new Date(from * 1000).toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });

  it('geht bei MAX bis zum Genesis-Block zurück', () => {
    const { from } = rangeForPreset('MAX', NOW);
    expect(new Date(from * 1000).toISOString()).toBe('2009-01-03T00:00:00.000Z');
  });

  it('deckt mit 4J einen vollen Zyklus ab', () => {
    const { from, to } = rangeForPreset('4Y', NOW);
    expect((to - from) / DAY).toBe(1461);
  });
});

describe('encode → decode ist verlustfrei', () => {
  it('erhält alle Layer-Einstellungen', () => {
    const state = stateWith({
      layers: [
        { id: 'btc.usd.close', shift: 0, smooth: 0, invert: false, visible: true, axis: 'left' },
        { id: 'macro.net_liquidity', shift: 90, smooth: 7, invert: true, visible: true, axis: 'right' },
        { id: 'fred.SP500', shift: -30, smooth: 0, invert: false, visible: false, axis: 'left' },
      ],
      norm: 'zscore',
      align: 'intersection',
      logScale: true,
      corr: 90,
    });

    const decoded = decodeState(encodeState(state), NOW);
    expect(decoded).toEqual(state);
  });

  it('erhält einen einzelnen unveränderten Layer', () => {
    const state = stateWith();
    expect(decodeState(encodeState(state), NOW)).toEqual(state);
  });

  it('hält die URL kurz, wenn nichts vom Default abweicht', () => {
    const params = encodeState(stateWith());
    expect(params.has('shift')).toBe(false);
    expect(params.has('smooth')).toBe(false);
    expect(params.has('invert')).toBe(false);
    expect(params.has('hidden')).toBe(false);
    expect(params.has('log')).toBe(false);
  });

  it('erzeugt für einen leeren Zustand keine Parameter', () => {
    expect(encodeState(stateWith({ layers: [] })).toString()).toBe('');
  });
});

describe('decodeState — kaputte Links', () => {
  it('fällt bei unbekanntem norm auf den Default zurück', () => {
    const state = decodeState(new URLSearchParams('s=btc.usd.close&norm=quatsch'), NOW);
    expect(state.norm).toBe('rebase100');
  });

  it('fällt bei unbekanntem align auf den Default zurück', () => {
    const state = decodeState(new URLSearchParams('s=btc.usd.close&align=xyz'), NOW);
    expect(state.align).toBe('union_ffill');
  });

  it('ignoriert einen verdrehten Zeitraum vollständig', () => {
    const base = defaultState(NOW);
    const state = decodeState(new URLSearchParams('s=btc.usd.close&from=200&to=100'), NOW);
    expect(state.from).toBe(base.from);
    expect(state.to).toBe(base.to);
  });

  it('ignoriert einen Zeitraum ohne Ausdehnung', () => {
    const base = defaultState(NOW);
    const state = decodeState(new URLSearchParams('s=btc.usd.close&from=100&to=100'), NOW);
    expect(state.from).toBe(base.from);
    expect(state.to).toBe(base.to);
  });

  it('verkraftet zu wenige Regler-Werte für die Zahl der Serien', () => {
    const state = decodeState(new URLSearchParams('s=a,b,c&shift=90'), NOW);
    expect(state.layers.map((l) => l.shift)).toEqual([90, 0, 0]);
  });

  it('verkraftet unlesbare Regler-Werte', () => {
    const state = decodeState(new URLSearchParams('s=a,b&shift=abc,90'), NOW);
    expect(state.layers.map((l) => l.shift)).toEqual([0, 90]);
  });

  it('liefert für eine leere URL einen brauchbaren Startzustand', () => {
    const state = decodeState(new URLSearchParams(''), NOW);
    expect(state.layers).toEqual([]);
    expect(state.norm).toBe('rebase100');
    expect(state.to).toBeGreaterThan(state.from);
  });

  it('lässt keine negative Glättung zu', () => {
    const state = decodeState(new URLSearchParams('s=a&smooth=-5'), NOW);
    expect(state.layers[0]!.smooth).toBe(0);
  });
});

describe('buildSeriesQuery', () => {
  it('baut die Anfrage für die sichtbaren Serien', () => {
    const query = new URLSearchParams(
      buildSeriesQuery(
        stateWith({
          layers: [
            { id: 'btc.usd.close', shift: 0, smooth: 0, invert: false, visible: true, axis: 'left' },
            { id: 'fred.SP500', shift: 0, smooth: 0, invert: false, visible: true, axis: 'right' },
          ],
        }),
      ),
    );

    expect(query.get('ids')).toBe('btc.usd.close,fred.SP500');
    expect(query.get('norm')).toBe('rebase100');
    expect(query.get('raw')).toBe('0');
  });

  it('lässt ausgeblendete Serien weg — und deren Regler ebenso', () => {
    const query = new URLSearchParams(
      buildSeriesQuery(
        stateWith({
          layers: [
            { id: 'a', shift: 10, smooth: 0, invert: false, visible: false, axis: 'left' },
            { id: 'b', shift: 90, smooth: 0, invert: false, visible: true, axis: 'left' },
          ],
        }),
      ),
    );

    // Entscheidend: der Shift von b landet an Position 0, nicht an Position 1.
    expect(query.get('ids')).toBe('b');
    expect(query.get('shift')).toBe('90');
  });

  it('gibt für null sichtbare Serien eine leere Anfrage zurück', () => {
    expect(
      buildSeriesQuery(
        stateWith({
          layers: [{ id: 'a', shift: 0, smooth: 0, invert: false, visible: false, axis: 'left' }],
        }),
      ),
    ).toBe('');
  });

  it('fordert die Korrelation nur bei genau zwei Serien an', () => {
    const zwei = new URLSearchParams(
      buildSeriesQuery(
        stateWith({
          corr: 90,
          layers: [
            { id: 'a', shift: 0, smooth: 0, invert: false, visible: true, axis: 'left' },
            { id: 'b', shift: 0, smooth: 0, invert: false, visible: true, axis: 'left' },
          ],
        }),
      ),
    );
    const drei = new URLSearchParams(
      buildSeriesQuery(
        stateWith({
          corr: 90,
          layers: [
            { id: 'a', shift: 0, smooth: 0, invert: false, visible: true, axis: 'left' },
            { id: 'b', shift: 0, smooth: 0, invert: false, visible: true, axis: 'left' },
            { id: 'c', shift: 0, smooth: 0, invert: false, visible: true, axis: 'left' },
          ],
        }),
      ),
    );

    expect(zwei.get('corr')).toBe('90');
    expect(drei.get('corr')).toBeNull();
  });
});

describe('colorForIndex', () => {
  it('ist deterministisch — nie zufällig (§11)', () => {
    expect(colorForIndex(0)).toBe(colorForIndex(0));
    expect(colorForIndex(0)).toBe(LAYER_COLORS[0]);
  });

  it('beginnt für die erste Serie mit Bitcoin-Orange', () => {
    expect(colorForIndex(0)).toBe('#f7931a');
  });

  it('läuft über die Palette hinaus im Kreis', () => {
    expect(colorForIndex(LAYER_COLORS.length)).toBe(colorForIndex(0));
  });
});
