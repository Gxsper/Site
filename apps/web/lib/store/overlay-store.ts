'use client';

/**
 * Zustand des Overlay-Studios (PROJECT_SPEC.md §5.3, §9).
 *
 * Der Store hält die Arbeitskopie, die URL bleibt die teilbare Wahrheit. Die
 * Synchronisierung passiert in der Seite, nicht hier — so bleibt der Store
 * frei von Router-Abhängigkeiten und testbar.
 */

import { create } from 'zustand';

import {
  defaultState,
  rangeForPreset,
  type LayerState,
  type OverlayState,
  type RangePresetId,
} from '@/lib/url-state';
import type { AlignMode } from '@/lib/series/align';
import type { NormMode } from '@/lib/series/normalize';

interface OverlayActions {
  replaceAll: (state: OverlayState) => void;
  addLayer: (id: string) => void;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, patch: Partial<Omit<LayerState, 'id'>>) => void;
  setNorm: (norm: NormMode) => void;
  setAlign: (align: AlignMode) => void;
  setRange: (from: number, to: number) => void;
  applyPreset: (preset: RangePresetId) => void;
  toggleLog: () => void;
  setCorr: (window: number) => void;
}

export type OverlayStore = OverlayState & OverlayActions;

/** Höchstzahl gleichzeitiger Serien — dieselbe Grenze wie in /api/series. */
export const MAX_LAYERS = 12;

export const useOverlayStore = create<OverlayStore>((set) => ({
  ...defaultState(),

  replaceAll: (state) => set(state),

  addLayer: (id) =>
    set((current) => {
      if (current.layers.some((l) => l.id === id)) return current;
      if (current.layers.length >= MAX_LAYERS) return current;
      return {
        layers: [
          ...current.layers,
          { id, shift: 0, smooth: 0, invert: false, visible: true, axis: 'left' },
        ],
      };
    }),

  removeLayer: (id) => set((current) => ({ layers: current.layers.filter((l) => l.id !== id) })),

  updateLayer: (id, patch) =>
    set((current) => ({
      layers: current.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    })),

  setNorm: (norm) => set({ norm }),
  setAlign: (align) => set({ align }),
  setRange: (from, to) => set({ from, to }),
  applyPreset: (preset) => set(rangeForPreset(preset)),
  toggleLog: () => set((current) => ({ logScale: !current.logScale })),
  setCorr: (corr) => set({ corr: Math.max(0, corr) }),
}));
