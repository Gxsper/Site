import { describe, expect, it } from 'vitest';

import { planFetches, type StoredExtent } from '@/lib/series/plan';

/**
 * §10: einmal geholt = nie wieder holen. Zu wenig zu holen bedeutet Lücken im
 * Chart, zu viel zu holen bedeutet Rate-Limit — beides teuer, beides hier
 * abgesichert.
 */

const DAY = 86_400;
const JAN01 = Math.floor(Date.parse('2024-01-01T00:00:00Z') / 1000);
const JAN10 = JAN01 + 9 * DAY;
const JAN20 = JAN01 + 19 * DAY;

const earliestSeconds = Math.floor(Date.parse('2017-08-17T00:00:00Z') / 1000);
const fresh = { headIsFresh: true, earliestSeconds };
const notFresh = { headIsFresh: false, earliestSeconds };

function extent(minT: number, maxT: number): StoredExtent {
  return { minT, maxT, count: Math.round((maxT - minT) / DAY) + 1 };
}

describe('planFetches', () => {
  it('holt bei leerer Datenbank den ganzen Zeitraum', () => {
    expect(planFetches({ from: JAN01, to: JAN10 }, null, notFresh)).toEqual([
      { from: JAN01, to: JAN10, reason: 'initial' },
    ]);
  });

  it('holt nichts, wenn der Bestand den Zeitraum abdeckt und der Rand frisch ist', () => {
    expect(planFetches({ from: JAN01, to: JAN10 }, extent(JAN01, JAN20), fresh)).toEqual([]);
  });

  it('holt nichts, wenn der Bestand über den Zeitraum hinausreicht', () => {
    expect(planFetches({ from: JAN01, to: JAN10 }, extent(JAN01, JAN20), notFresh)).toEqual([]);
  });

  it('lädt nur die fehlende Historie nach, nicht den ganzen Zeitraum', () => {
    const result = planFetches({ from: JAN01, to: JAN20 }, extent(JAN10, JAN20), notFresh);

    expect(result).toEqual([{ from: JAN01, to: JAN10 - 1, reason: 'backfill' }]);
  });

  it('lädt nur die neuen Tage nach, nicht den ganzen Zeitraum', () => {
    const result = planFetches({ from: JAN01, to: JAN20 }, extent(JAN01, JAN10), notFresh);

    expect(result).toEqual([{ from: JAN10 + 1, to: JAN20, reason: 'head' }]);
  });

  it('lädt beide Ränder, wenn vorne und hinten etwas fehlt', () => {
    const result = planFetches({ from: JAN01, to: JAN20 }, extent(JAN10, JAN10), notFresh);

    expect(result).toEqual([
      { from: JAN01, to: JAN10 - 1, reason: 'backfill' },
      { from: JAN10 + 1, to: JAN20, reason: 'head' },
    ]);
  });

  it('überspringt den Rand, wenn er innerhalb der updateCadence schon geprüft wurde', () => {
    const result = planFetches({ from: JAN01, to: JAN20 }, extent(JAN10, JAN10), fresh);

    // Der Backfill bleibt — der ist unabhängig davon, wie frisch der Rand ist.
    expect(result).toEqual([{ from: JAN01, to: JAN10 - 1, reason: 'backfill' }]);
  });

  it('fragt nie vor dem dokumentierten Historienbeginn', () => {
    const vor2017 = Math.floor(Date.parse('2010-01-01T00:00:00Z') / 1000);
    const result = planFetches({ from: vor2017, to: JAN10 }, null, notFresh);

    expect(result).toHaveLength(1);
    expect(result[0]!.from).toBe(earliestSeconds);
  });

  it('holt gar nichts, wenn der Zeitraum komplett vor dem Historienbeginn liegt', () => {
    const from = Math.floor(Date.parse('2010-01-01T00:00:00Z') / 1000);
    const to = Math.floor(Date.parse('2011-01-01T00:00:00Z') / 1000);

    expect(planFetches({ from, to }, null, notFresh)).toEqual([]);
  });

  /**
   * Regression: fred.SP500 hat seinen ersten Wert am 02.01.2019. Wer ab dem
   * 01.01.2019 anfragt, sah eine Ein-Tages-Lücke, holte sie, bekam nichts
   * (Neujahr, Börse zu) — und holte sie beim nächsten Seitenaufruf wieder.
   * Der abgefragte Bereich muss deshalb getrennt vom Datenbestand zählen.
   */
  it('fragt einen bereits erfolglos geprüften Randtag nicht erneut an', () => {
    const result = planFetches({ from: JAN01, to: JAN20 }, extent(JAN01 + DAY, JAN20), {
      headIsFresh: true,
      earliestSeconds,
      covered: { from: JAN01, to: JAN20 },
    });

    expect(result).toEqual([]);
  });

  it('holt trotzdem, was ausserhalb des bereits abgefragten Bereichs liegt', () => {
    const result = planFetches({ from: JAN01, to: JAN20 }, null, {
      headIsFresh: true,
      earliestSeconds,
      covered: { from: JAN10, to: JAN20 },
    });

    expect(result).toEqual([{ from: JAN01, to: JAN10 - 1, reason: 'backfill' }]);
  });

  it('behandelt einen leeren Abruf als erledigt, auch ganz ohne Datenbestand', () => {
    // Kein einziger Punkt vorhanden, aber der Zeitraum wurde bereits geprüft.
    const result = planFetches({ from: JAN01, to: JAN10 }, null, {
      headIsFresh: true,
      earliestSeconds,
      covered: { from: JAN01, to: JAN10 },
    });

    expect(result).toEqual([]);
  });

  it('erzeugt keine überlappenden Zeiträume', () => {
    const result = planFetches({ from: JAN01, to: JAN20 }, extent(JAN10, JAN10), notFresh);

    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.from).toBeGreaterThan(result[i - 1]!.to);
    }
  });

  it('erzeugt nie einen Zeitraum, dessen from hinter to liegt', () => {
    const cases: Array<[StoredExtent | null, boolean]> = [
      [null, true],
      [null, false],
      [extent(JAN01, JAN01), true],
      [extent(JAN01, JAN20), false],
      [extent(JAN10, JAN10), false],
    ];

    for (const [ext, headFresh] of cases) {
      const result = planFetches({ from: JAN01, to: JAN20 }, ext, {
        headIsFresh: headFresh,
        earliestSeconds,
      });
      for (const plan of result) {
        expect(plan.from, JSON.stringify(plan)).toBeLessThanOrEqual(plan.to);
      }
    }
  });
});
