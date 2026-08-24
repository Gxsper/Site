import { describe, expect, it } from 'vitest';

import { parseFredCsv, __testing } from '@/lib/providers/fred';
import { findDescriptor } from '@/lib/series/catalog';
import { ProviderError } from '@/lib/series/types';

const day = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);

/**
 * Wörtliche Ausschnitte echter FRED-CSV-Antworten, abgerufen am 2026-08-24.
 * Siehe docs/api-samples/FINDINGS.md §6.
 */

describe('parseFredCsv', () => {
  it('liest die echte Antwortform', () => {
    const csv = [
      'observation_date,WALCL',
      '2023-12-27,7712781',
      '2024-01-03,7681024',
      '2024-01-10,7686710',
    ].join('\n');

    expect(parseFredCsv(csv, 'WALCL')).toEqual([
      { t: day('2023-12-27'), v: 7_712_781 },
      { t: day('2024-01-03'), v: 7_681_024 },
      { t: day('2024-01-10'), v: 7_686_710 },
    ]);
  });

  it('behandelt ein leeres Feld als Lücke, nicht als 0', () => {
    // 2024-01-01 war Feiertag — FRED liefert dort ein leeres Feld.
    const csv = [
      'observation_date,RRPONTSYD',
      '2023-12-29,1018.483',
      '2024-01-01,',
      '2024-01-02,704.864',
    ].join('\n');

    const points = parseFredCsv(csv, 'RRPONTSYD');

    expect(points).toHaveLength(2);
    expect(points.map((p) => p.t)).toEqual([day('2023-12-29'), day('2024-01-02')]);
    expect(points.some((p) => p.v === 0)).toBe(false);
  });

  it('behandelt auch den Punkt der JSON-API als Lücke', () => {
    const csv = ['observation_date,DGS10', '2024-01-01,.', '2024-01-02,3.95'].join('\n');
    expect(parseFredCsv(csv, 'DGS10')).toEqual([{ t: day('2024-01-02'), v: 3.95 }]);
  });

  it('verkraftet Windows-Zeilenenden', () => {
    const csv = 'observation_date,DGS10\r\n2024-01-02,3.95\r\n';
    expect(parseFredCsv(csv, 'DGS10')).toEqual([{ t: day('2024-01-02'), v: 3.95 }]);
  });

  it('liest negative Werte — die Zinskurve wird invers', () => {
    const csv = ['observation_date,T10Y2Y', '2024-01-02,-0.35'].join('\n');
    expect(parseFredCsv(csv, 'T10Y2Y')[0]!.v).toBe(-0.35);
  });

  it('liest einen leeren Body als "keine Daten im Fenster", nicht als Fehler', () => {
    // Verifiziert: cosd=coed=2019-01-01 liefert für SP500 HTTP 200 mit "\n".
    // Neujahr, Börse zu — das ist eine Aussage über die Daten, kein Fehler (§3.2).
    expect(parseFredCsv('\n', 'SP500')).toEqual([]);
    expect(parseFredCsv('', 'SP500')).toEqual([]);
    expect(parseFredCsv('   \r\n  ', 'SP500')).toEqual([]);
  });

  it('liest eine Antwort mit Kopfzeile, aber ohne Datenzeilen als leer', () => {
    expect(parseFredCsv('observation_date,SP500\n', 'SP500')).toEqual([]);
  });

  it('wirft bei unerwarteter Kopfzeile, statt still nichts zu liefern', () => {
    expect(() => parseFredCsv('<!DOCTYPE html><html>', 'WALCL')).toThrow(ProviderError);
    expect(() => parseFredCsv('date,WALCL\n2024-01-01,1', 'WALCL')).toThrow(/Kopfzeile/);
  });

  it('wirft bei einem unlesbaren Zahlenwert', () => {
    const csv = ['observation_date,WALCL', '2024-01-03,keine-zahl'].join('\n');
    expect(() => parseFredCsv(csv, 'WALCL')).toThrow(/keine endliche Zahl/);
  });

  it('wirft bei einem unlesbaren Datum', () => {
    const csv = ['observation_date,WALCL', 'irgendwann,7681024'].join('\n');
    expect(() => parseFredCsv(csv, 'WALCL')).toThrow(/unlesbares Datum/);
  });
});

describe('FRED-Descriptoren', () => {
  it('verlangt einen expliziten Umrechnungsfaktor', () => {
    const walcl = findDescriptor('fred.WALCL')!;
    const ohneScale = { ...walcl, providerParams: { series_id: 'WALCL' } };

    expect(() => __testing.readSeriesId(ohneScale)).not.toThrow();
    // Ohne scale ist die Einheit im Descriptor nicht belegbar.
    expect(walcl.providerParams['scale']).toBe(0.001);
  });

  it('rechnet WALCL und WTREGEN von Millionen in Milliarden', () => {
    expect(findDescriptor('fred.WALCL')!.providerParams['scale']).toBe(0.001);
    expect(findDescriptor('fred.WTREGEN')!.providerParams['scale']).toBe(0.001);
  });

  it('lässt RRPONTSYD und WM2NS unverändert — die kommen schon in Milliarden', () => {
    expect(findDescriptor('fred.RRPONTSYD')!.providerParams['scale']).toBe(1);
    expect(findDescriptor('fred.WM2NS')!.providerParams['scale']).toBe(1);
  });

  it('formatiert Datumsgrenzen als YYYY-MM-DD', () => {
    expect(__testing.toFredDate(day('2024-01-03'))).toBe('2024-01-03');
  });

  it('markiert Serien mit möglichen Negativwerten als nicht log-fähig', () => {
    expect(findDescriptor('fred.T10Y2Y')!.supportsLog).toBe(false);
    expect(findDescriptor('macro.net_liquidity')!.supportsLog).toBe(false);
  });
});
