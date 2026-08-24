import { describe, expect, it } from 'vitest';

import { mapChartToPoints, __testing } from '@/lib/providers/yahoo';
import { findDescriptor } from '@/lib/series/catalog';
import { ProviderError } from '@/lib/series/types';

const DAY = 86_400;

/**
 * Ausschnitt der echten Yahoo-Antwort, abgerufen am 2026-08-24.
 * Die Zeitstempel stehen auf der Handelseröffnung in Börsenzeit — im Beispiel
 * 14:30 UTC, also 09:30 New York.
 */
function chart(timestamps: number[], closes: (number | null)[]) {
  return {
    chart: {
      result: [
        {
          meta: { symbol: '^GSPC', currency: 'USD' },
          timestamp: timestamps,
          indicators: { quote: [{ close: closes }] },
        },
      ],
      error: null,
    },
  };
}

const JAN02_1970 = Math.floor(Date.parse('1970-01-02T14:30:00Z') / 1000);

describe('mapChartToPoints', () => {
  it('liest die echte Antwortform', () => {
    const points = mapChartToPoints(chart([JAN02_1970], [93]), 'spx.close');

    expect(points).toHaveLength(1);
    expect(points[0]!.v).toBe(93);
  });

  it('rundet den Zeitstempel auf den UTC-Tagesbeginn', () => {
    // Yahoo liefert die Handelseröffnung, alle anderen Tagesserien stehen
    // auf 00:00 UTC — sonst schlägt jedes Alignment fehl.
    const [point] = mapChartToPoints(chart([JAN02_1970], [93]), 'spx.close');

    expect(new Date(point!.t * 1000).toISOString()).toBe('1970-01-02T00:00:00.000Z');
    expect(point!.t % DAY).toBe(0);
  });

  it('macht aus null eine Lücke, nicht aus 0 einen Wert', () => {
    // Gold hat 84 solcher Tage (verifiziert).
    const points = mapChartToPoints(
      chart([JAN02_1970, JAN02_1970 + DAY, JAN02_1970 + 2 * DAY], [93, null, 95]),
      'gold.usd',
    );

    expect(points).toHaveLength(2);
    expect(points.map((p) => p.v)).toEqual([93, 95]);
    expect(points.some((p) => p.v === 0)).toBe(false);
  });

  it('überspringt nicht-endliche Werte', () => {
    const points = mapChartToPoints(chart([JAN02_1970], [Number.NaN]), 'spx.close');
    expect(points).toEqual([]);
  });

  it('behält bei zwei Meldungen am selben Tag die spätere', () => {
    const points = mapChartToPoints(
      chart([JAN02_1970, JAN02_1970 + 3600], [93, 94]),
      'spx.close',
    );

    expect(points).toHaveLength(1);
    expect(points[0]!.v).toBe(94);
  });

  it('liefert für eine leere Antwort ein leeres Ergebnis, keinen Fehler', () => {
    // Kein Handelstag im angefragten Zeitraum ist eine Aussage, kein Problem (§3.2).
    expect(mapChartToPoints(chart([], []), 'spx.close')).toEqual([]);
  });

  it('reicht einen Yahoo-Fehler durch, statt ihn zu verschlucken', () => {
    const body = {
      chart: {
        result: null,
        error: { code: 'Not Found', description: 'No data found, symbol may be delisted' },
      },
    };

    expect(() => mapChartToPoints(body, 'quatsch')).toThrow(ProviderError);
    expect(() => mapChartToPoints(body, 'quatsch')).toThrow(/symbol may be delisted/);
  });

  it('wirft, wenn Zeitstempel und Kurse nicht zusammenpassen', () => {
    // Eine geratene Zuordnung wäre schlimmer als ein Fehler.
    expect(() => mapChartToPoints(chart([1, 2, 3], [1, 2]), 'spx.close')).toThrow(
      /Zuordnung wäre geraten/,
    );
  });

  it('wirft, wenn weder Ergebnis noch Fehler kommen', () => {
    expect(() => mapChartToPoints({ chart: { result: [], error: null } }, 'x')).toThrow(
      /weder ein Ergebnis noch einen Fehler/,
    );
  });
});

describe('Yahoo-Descriptoren', () => {
  it('verlangt ein Symbol', () => {
    const spx = findDescriptor('spx.close')!;
    expect(__testing.readSymbol(spx)).toBe('^GSPC');
    expect(() => __testing.readSymbol({ ...spx, providerParams: {} })).toThrow(/symbol/);
  });

  it('hält den verifizierten Historienbeginn fest', () => {
    // 14 282 Tage ab 1970-01-02, am 2026-08-24 geprüft.
    expect(findDescriptor('spx.close')!.earliest).toBe('1970-01-02T00:00:00Z');
    expect(findDescriptor('ndx.close')!.earliest).toBe('1985-10-01T00:00:00Z');
    expect(findDescriptor('gold.usd')!.earliest).toBe('2000-08-30T00:00:00Z');
  });

  it('schema akzeptiert die echte Antwortform', () => {
    expect(() => __testing.chartSchema.parse(chart([JAN02_1970], [93]))).not.toThrow();
  });
});

describe('Katalog — Ersatz für die kostenpflichtigen Quellen', () => {
  it('hat für Aktien eine Reihe mit mehr als 40 Jahren Historie', () => {
    const spx = findDescriptor('spx.close')!;
    const jahre = (Date.now() - Date.parse(spx.earliest)) / (365.25 * DAY * 1000);

    // FRED liefert SP500 nur zehn Jahre rollierend — deshalb Yahoo.
    expect(jahre).toBeGreaterThan(40);
  });

  it('markiert die selbst aufgezeichnete Dominance als solche', () => {
    const dominance = findDescriptor('crypto.btc_dominance')!;

    expect(dominance.label).toMatch(/eigener Aufzeichnung/);
    // Kein rückwirkend erfundener Historienbeginn.
    expect(Date.parse(dominance.earliest)).toBeGreaterThan(Date.parse('2026-01-01'));
  });
});
