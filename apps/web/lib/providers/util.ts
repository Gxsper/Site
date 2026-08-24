/**
 * Konvertierungen, die alle Provider brauchen.
 *
 * Jede dieser Funktionen wirft, statt einen Ersatzwert zu liefern. Ein nicht
 * parsbarer Wert ist ein echter Fehler in der Datenquelle und muss sichtbar
 * werden, nicht als 0 oder NaN in einem Chart landen (§11).
 */

import { ProviderError, type ProviderId, type SeriesPoint } from '@/lib/series/types';

/**
 * Zahl aus einem String. Alle drei angebundenen Provider liefern ihre Werte als
 * String (Binance, Coin Metrics und alternative.me — verifiziert in
 * docs/api-samples/FINDINGS.md).
 */
export function parseFiniteNumber(raw: unknown, provider: ProviderId, context: string): number {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      throw new ProviderError(provider, `${context}: nicht-finite Zahl ${raw}`);
    }
    return raw;
  }
  if (typeof raw !== 'string') {
    throw new ProviderError(provider, `${context}: erwartet Zahl oder String, bekam ${typeof raw}`);
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    throw new ProviderError(provider, `${context}: leerer Wert`);
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    throw new ProviderError(provider, `${context}: "${raw}" ist keine endliche Zahl`);
  }
  return value;
}

/**
 * ISO-Zeitstempel zu Unix-Sekunden UTC (§0.4).
 *
 * Coin Metrics liefert Nanosekunden-Praezision (`2026-08-23T00:00:00.000000000Z`).
 * Das parst `Date.parse` korrekt und schneidet unterhalb der Millisekunde ab —
 * fuer Tagesdaten ohne Belang, hier aber bewusst getestet statt angenommen.
 */
export function parseUtcSeconds(iso: string, provider: ProviderId, context: string): number {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    throw new ProviderError(provider, `${context}: "${iso}" ist kein gueltiger Zeitstempel`);
  }
  return Math.floor(ms / 1000);
}

/** Millisekunden-Zeitstempel zu Unix-Sekunden. Binance rechnet durchgehend in ms. */
export function msToUtcSeconds(ms: number, provider: ProviderId, context: string): number {
  if (!Number.isFinite(ms)) {
    throw new ProviderError(provider, `${context}: nicht-finiter Zeitstempel ${ms}`);
  }
  return Math.floor(ms / 1000);
}

/**
 * Stellt sicher, dass eine Punktfolge streng monoton steigt.
 *
 * Duplikate werden nicht stillschweigend entfernt: ein doppelter Zeitstempel
 * bedeutet fast immer einen Paginierungsfehler, und lightweight-charts wirft
 * darauf ohnehin (§5.5). Lieber hier laut scheitern als spaeter im Chart.
 */
export function assertStrictlyIncreasing(
  points: readonly SeriesPoint[],
  provider: ProviderId,
  seriesId: string,
): void {
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    if (cur.t <= prev.t) {
      throw new ProviderError(
        provider,
        `${seriesId}: Zeitstempel nicht streng monoton an Index ${i} (${cur.t} <= ${prev.t}). ` +
          `Vermutlich ueberlappende Paginierung.`,
      );
    }
  }
}

/** Punkte auf das angefragte Fenster begrenzen. Grenzen sind inklusiv. */
export function clampToRange(
  points: readonly SeriesPoint[],
  range: { from: number; to: number },
): SeriesPoint[] {
  return points.filter((p) => p.t >= range.from && p.t <= range.to);
}
