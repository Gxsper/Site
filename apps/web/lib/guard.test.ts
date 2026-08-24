import { describe, expect, it } from 'vitest';

import { assertNoSilentEmpty, assertRealData, DataProvenanceError } from '@/lib/guard';
import type { SeriesDescriptor, SeriesResponse } from '@/lib/series/types';

// Konstruierte Fixtures sind in Testdateien ausdruecklich erlaubt (§11).
const descriptor: SeriesDescriptor = {
  id: 'test.series',
  label: 'Testreihe',
  group: 'macro',
  unit: 'usd_bn',
  nativeFrequency: '1d',
  provider: 'fred',
  providerParams: { series_id: 'TEST' },
  earliest: '2020-01-01T00:00:00Z',
  supportsLog: true,
  updateCadence: 3600,
  attribution: 'Testquelle',
};

function response(overrides: Partial<SeriesResponse> = {}): SeriesResponse {
  return {
    descriptor,
    points: [
      { t: 1_577_836_800, v: 1 },
      { t: 1_577_923_200, v: 2 },
    ],
    lastUpdated: 1_600_000_000,
    stale: false,
    ...overrides,
  };
}

describe('assertRealData', () => {
  it('laesst eine saubere Antwort durch', () => {
    expect(() => assertRealData(response())).not.toThrow();
  });

  it('akzeptiert ein leeres points-Array', () => {
    expect(() => assertRealData(response({ points: [] }))).not.toThrow();
  });

  it('wirft ohne lastUpdated — Herkunft unklar', () => {
    expect(() => assertRealData(response({ lastUpdated: 0 }))).toThrow(DataProvenanceError);
  });

  it('wirft bei NaN als Wert', () => {
    expect(() =>
      assertRealData(response({ points: [{ t: 1_577_836_800, v: Number.NaN }] })),
    ).toThrow(/non-finite/);
  });

  it('wirft bei Infinity als Wert', () => {
    expect(() =>
      assertRealData(response({ points: [{ t: 1_577_836_800, v: Number.POSITIVE_INFINITY }] })),
    ).toThrow(/non-finite/);
  });

  it('wirft bei nicht streng monotonen Zeitstempeln', () => {
    expect(() =>
      assertRealData(
        response({
          points: [
            { t: 1_577_923_200, v: 1 },
            { t: 1_577_836_800, v: 2 },
          ],
        }),
      ),
    ).toThrow(/monoton/);
  });

  it('wirft bei doppeltem Zeitstempel — lightweight-charts vertraegt das nicht', () => {
    expect(() =>
      assertRealData(
        response({
          points: [
            { t: 1_577_836_800, v: 1 },
            { t: 1_577_836_800, v: 2 },
          ],
        }),
      ),
    ).toThrow(/monoton/);
  });

  it('wirft bei Millisekunden statt Sekunden nicht, aber bei gebrochenen Zeitstempeln schon', () => {
    expect(() => assertRealData(response({ points: [{ t: 1_577_836_800.5, v: 1 }] }))).toThrow(
      /Unix-Sekunde/,
    );
  });
});

describe('assertNoSilentEmpty', () => {
  it('akzeptiert leer, wenn der Zeitraum vor dem Start der Historie liegt', () => {
    const range = { from: 1_262_304_000, to: 1_293_840_000 }; // 2010 — vor earliest 2020
    expect(() => assertNoSilentEmpty(response({ points: [] }), range)).not.toThrow();
  });

  it('wirft, wenn im Zeitraum laut Descriptor Daten existieren muessten', () => {
    const range = { from: 1_609_459_200, to: 1_640_995_200 }; // 2021 — nach earliest
    expect(() => assertNoSilentEmpty(response({ points: [] }), range)).toThrow(DataProvenanceError);
  });

  it('wirft nicht, wenn Punkte vorhanden sind', () => {
    const range = { from: 1_577_836_800, to: 1_640_995_200 };
    expect(() => assertNoSilentEmpty(response(), range)).not.toThrow();
  });
});
