/**
 * Teilbarer Zustand des Overlay-Studios (PROJECT_SPEC.md §9).
 *
 * `?s=btc.usd.close,fred.WALCL&norm=rebase100&shift=0,90&from=…&to=…`
 *
 * Die URL ist die Wahrheit: wer den Link kopiert, sieht exakt dasselbe Chart.
 * Deshalb steckt das Kodieren und Dekodieren hier in reinen Funktionen und
 * nicht verstreut in Komponenten — so ist es testbar, und ein kaputter Link
 * führt zu einem definierten Zustand statt zu einer leeren Seite.
 */

import type { AlignMode } from '@/lib/series/align';
import type { NormMode } from '@/lib/series/normalize';

export interface LayerState {
  id: string;
  /** Verschiebung in Tagen (§5.3). */
  shift: number;
  /** Nachlaufender SMA über n Tage. 0 = aus. */
  smooth: number;
  invert: boolean;
  visible: boolean;
  /** Achse: links, rechts oder eigene. */
  axis: 'left' | 'right';
}

export interface OverlayState {
  layers: LayerState[];
  norm: NormMode;
  align: AlignMode;
  from: number;
  to: number;
  logScale: boolean;
  /** Fenster der rollierenden Korrelation in Tagen. 0 = Panel aus. */
  corr: number;
}

const NORM_MODES: NormMode[] = [
  'raw',
  'rebase100',
  'pct_change',
  'zscore',
  'minmax',
  'log_returns',
  'yoy',
];

const ALIGN_MODES: AlignMode[] = ['union_ffill', 'intersection', 'trading_days', 'native'];

const DAY = 86_400;

/** Zeitraum-Presets aus §9. */
export const RANGE_PRESETS = [
  { id: '1M', label: '1M', days: 30 },
  { id: '3M', label: '3M', days: 90 },
  { id: '6M', label: '6M', days: 182 },
  { id: 'YTD', label: 'YTD', days: 0 },
  { id: '1Y', label: '1J', days: 365 },
  { id: '2Y', label: '2J', days: 730 },
  { id: '4Y', label: '4J', days: 1461 },
  { id: 'MAX', label: 'MAX', days: 0 },
] as const;

export type RangePresetId = (typeof RANGE_PRESETS)[number]['id'];

/** Frühester Punkt im Katalog — Bitcoins Genesis-Jahr (§6.2). */
const MAX_RANGE_START = Math.floor(Date.parse('2009-01-03T00:00:00Z') / 1000);

export function rangeForPreset(preset: RangePresetId, now = Math.floor(Date.now() / 1000)) {
  if (preset === 'MAX') return { from: MAX_RANGE_START, to: now };

  if (preset === 'YTD') {
    const year = new Date(now * 1000).getUTCFullYear();
    return { from: Math.floor(Date.UTC(year, 0, 1) / 1000), to: now };
  }

  const days = RANGE_PRESETS.find((p) => p.id === preset)?.days ?? 365;
  return { from: now - days * DAY, to: now };
}

export function defaultState(now = Math.floor(Date.now() / 1000)): OverlayState {
  const { from, to } = rangeForPreset('2Y', now);
  return {
    layers: [],
    norm: 'rebase100',
    align: 'union_ffill',
    from,
    to,
    logScale: false,
    corr: 0,
  };
}

function parseIntList(raw: string | null, count: number, fallback: number): number[] {
  const parts = (raw ?? '').split(',');
  return Array.from({ length: count }, (_, i) => {
    const value = Number.parseInt((parts[i] ?? '').trim(), 10);
    return Number.isFinite(value) ? value : fallback;
  });
}

function oneOf<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

/**
 * Liest den Zustand aus Query-Parametern.
 *
 * Unbekannte oder kaputte Werte fallen still auf den Default zurück — ein
 * verstümmelter Link soll ein brauchbares Chart zeigen, keinen Fehlerbildschirm.
 * Das betrifft nur Darstellungsoptionen; an den Daten ändert es nichts.
 */
export function decodeState(
  params: URLSearchParams,
  now = Math.floor(Date.now() / 1000),
): OverlayState {
  const base = defaultState(now);

  const ids = (params.get('s') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const shifts = parseIntList(params.get('shift'), ids.length, 0);
  const smooths = parseIntList(params.get('smooth'), ids.length, 0);
  const inverts = parseIntList(params.get('invert'), ids.length, 0);
  const hidden = new Set(
    (params.get('hidden') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  );
  const rightAxis = new Set(
    (params.get('axis2') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  );

  const layers: LayerState[] = ids.map((id, i) => ({
    id,
    shift: shifts[i] ?? 0,
    smooth: Math.max(0, smooths[i] ?? 0),
    invert: (inverts[i] ?? 0) !== 0,
    visible: !hidden.has(id),
    axis: rightAxis.has(id) ? 'right' : 'left',
  }));

  const fromRaw = Number.parseInt(params.get('from') ?? '', 10);
  const toRaw = Number.parseInt(params.get('to') ?? '', 10);
  // Nur ein vollständig plausibler Zeitraum wird übernommen. Halb kaputte
  // Angaben zu „reparieren" führt zu Zuständen, die niemand erwartet hat.
  const validRange = Number.isFinite(fromRaw) && Number.isFinite(toRaw) && fromRaw < toRaw;

  return {
    layers,
    norm: oneOf(params.get('norm'), NORM_MODES, base.norm),
    align: oneOf(params.get('align'), ALIGN_MODES, base.align),
    from: validRange ? fromRaw : base.from,
    to: validRange ? toRaw : base.to,
    logScale: params.get('log') === '1',
    corr: Math.max(0, Number.parseInt(params.get('corr') ?? '0', 10) || 0),
  };
}

/**
 * Schreibt den Zustand in Query-Parameter. Nur, was vom Default abweicht —
 * das hält geteilte Links lesbar.
 */
export function encodeState(state: OverlayState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.layers.length === 0) return params;

  params.set('s', state.layers.map((l) => l.id).join(','));

  if (state.layers.some((l) => l.shift !== 0)) {
    params.set('shift', state.layers.map((l) => l.shift).join(','));
  }
  if (state.layers.some((l) => l.smooth > 0)) {
    params.set('smooth', state.layers.map((l) => l.smooth).join(','));
  }
  if (state.layers.some((l) => l.invert)) {
    params.set('invert', state.layers.map((l) => (l.invert ? 1 : 0)).join(','));
  }

  const hidden = state.layers.filter((l) => !l.visible).map((l) => l.id);
  if (hidden.length > 0) params.set('hidden', hidden.join(','));

  const right = state.layers.filter((l) => l.axis === 'right').map((l) => l.id);
  if (right.length > 0) params.set('axis2', right.join(','));

  params.set('norm', state.norm);
  params.set('align', state.align);
  params.set('from', String(state.from));
  params.set('to', String(state.to));
  if (state.logScale) params.set('log', '1');
  if (state.corr > 0) params.set('corr', String(state.corr));

  return params;
}

/**
 * Baut die Anfrage an /api/series. Reihenfolge und Anzahl der Regler müssen zur
 * Reihenfolge der IDs passen — deshalb an einer Stelle und nicht in der Komponente.
 */
export function buildSeriesQuery(state: OverlayState): string {
  const visible = state.layers.filter((l) => l.visible);
  if (visible.length === 0) return '';

  const params = new URLSearchParams({
    ids: visible.map((l) => l.id).join(','),
    from: String(state.from),
    to: String(state.to),
    align: state.align,
    norm: state.norm,
    raw: '0',
  });

  if (visible.some((l) => l.shift !== 0)) {
    params.set('shift', visible.map((l) => l.shift).join(','));
  }
  if (visible.some((l) => l.smooth > 0)) {
    params.set('smooth', visible.map((l) => l.smooth).join(','));
  }
  if (visible.some((l) => l.invert)) {
    params.set('invert', visible.map((l) => (l.invert ? 1 : 0)).join(','));
  }
  if (state.corr > 0 && visible.length === 2) {
    params.set('corr', String(state.corr));
  }

  return params.toString();
}

/** Farbpalette für Layer. Deterministisch nach Position — nie zufällig (§11). */
export const LAYER_COLORS = [
  '#f7931a', // Bitcoin-Orange
  '#4aa3df',
  '#7ed321',
  '#e15759',
  '#b07aa1',
  '#f6c85f',
  '#76b7b2',
  '#ff9da7',
] as const;

export function colorForIndex(index: number): string {
  return LAYER_COLORS[index % LAYER_COLORS.length]!;
}
