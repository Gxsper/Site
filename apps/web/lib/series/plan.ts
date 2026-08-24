/**
 * Welche Zeiträume müssen tatsächlich beim Provider geholt werden?
 *
 * Bewusst eine reine Funktion ohne Datenbank und ohne Netzwerk. Das ist die
 * Stelle, an der ein Denkfehler teuer wird: zu wenig holen heißt Lücken im
 * Chart, zu viel holen heißt Rate-Limit. Beides ist hier direkt testbar.
 *
 * Grundregel aus §10: einmal geholt = nie wieder holen. Nur der Rand wird
 * nachgeladen — vorne die fehlende Historie, hinten die neuen Tage.
 */

import type { SeriesRange } from '@/lib/series/types';

export interface StoredExtent {
  minT: number;
  maxT: number;
  count: number;
}

export interface PlanOptions {
  /**
   * Wurde der aktuelle Rand innerhalb der updateCadence schon geprüft?
   * Dann wird nicht erneut nachgeladen (Cache-Layer 2, §10).
   */
  headIsFresh: boolean;
  /** Unix-Sekunden des dokumentierten Historienbeginns der Serie. */
  earliestSeconds: number;
  /**
   * Bereits **abgefragter** Zeitraum, unabhängig davon, ob dabei Punkte
   * herauskamen.
   *
   * Ohne diese Angabe entsteht eine Endlosschleife: `fred.SP500` hat seinen
   * ersten Wert am 02.01.2019. Wer ab dem 01.01.2019 anfragt, sieht eine
   * Ein-Tages-Lücke, holt sie, bekommt nichts — und holt sie beim nächsten Mal
   * wieder. Ein Feiertag, an dem die Börse zu hat, wird so bei jedem
   * Seitenaufruf erneut beim Provider angefragt.
   */
  covered?: { from: number; to: number } | undefined;
}

export interface PlannedFetch extends SeriesRange {
  reason: 'initial' | 'backfill' | 'head';
}

/**
 * @returns Zeiträume, die geholt werden müssen. Leer heißt: die Datenbank
 *          deckt die Anfrage vollständig ab.
 */
export function planFetches(
  range: SeriesRange,
  extent: StoredExtent | null,
  opts: PlanOptions,
): PlannedFetch[] {
  // Vor dem dokumentierten Historienbeginn existiert nichts. Dort zu fragen
  // kostet nur Rate-Limit-Budget.
  const from = Math.max(range.from, opts.earliestSeconds);
  const to = range.to;

  if (from > to) return [];

  if (!extent && !opts.covered) {
    return [{ from, to, reason: 'initial' }];
  }

  // Bereits erledigt ist alles, was entweder Daten geliefert hat **oder**
  // schon einmal abgefragt wurde.
  const doneFrom = Math.min(
    extent?.minT ?? Number.POSITIVE_INFINITY,
    opts.covered?.from ?? Number.POSITIVE_INFINITY,
  );
  const doneTo = Math.max(
    extent?.maxT ?? Number.NEGATIVE_INFINITY,
    opts.covered?.to ?? Number.NEGATIVE_INFINITY,
  );

  const planned: PlannedFetch[] = [];

  // Fehlende Historie vor dem erledigten Bereich.
  if (from < doneFrom) {
    const backfillTo = Math.min(doneFrom - 1, to);
    if (from <= backfillTo) {
      planned.push({ from, to: backfillTo, reason: 'backfill' });
    }
  }

  // Neue Punkte nach dem erledigten Bereich. Wenn der Rand innerhalb der
  // updateCadence bereits geprüft wurde, ist ein erneuter Abruf verschwendet.
  if (to > doneTo && !opts.headIsFresh) {
    const headFrom = Math.max(doneTo + 1, from);
    if (headFrom <= to) {
      planned.push({ from: headFrom, to, reason: 'head' });
    }
  }

  return planned;
}
