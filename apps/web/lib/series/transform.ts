/**
 * Transformationen pro Serie — die Overlay-Regler aus PROJECT_SPEC.md §5.3.
 *
 * Diese vier Regler sind der eigentliche ITC-Workflow: eine Makroserie um
 * n Tage nach vorn schieben, glätten, invertieren und schauen, ob sich ein
 * Zusammenhang zeigt.
 *
 * Glättungen laufen ausschließlich nachlaufend. Ein zentrierter gleitender
 * Durchschnitt würde Zukunftsinformation in die Vergangenheit tragen und jede
 * darauf gerechnete Korrelation wertlos machen.
 */

import type { SeriesPoint } from '@/lib/series/types';

const DAY = 86_400;

export interface SeriesTransform {
  /** Verschiebung in Tagen. Positiv = später, negativ = früher. */
  shiftDays?: number;
  /** Nachlaufender gleitender Durchschnitt über n Rasterpunkte. */
  sma?: number;
  /** Exponentiell gewichteter Durchschnitt über n Rasterpunkte. */
  ema?: number;
  /** Vorzeichen umkehren — für DXY gegen BTC. */
  invert?: boolean;
}

/**
 * Verschiebt eine Serie entlang der Zeitachse.
 *
 * `shiftDays: 90` heißt: der Wert von heute erscheint in 90 Tagen. So prüft man
 * die These „Global M2 läuft BTC um 90 Tage voraus". Der Legendeneintrag muss
 * das sichtbar machen (`Global M2 (+90d)`), sonst liest jemand eine Verschiebung
 * als Messung.
 */
export function shiftPoints(points: readonly SeriesPoint[], shiftDays: number): SeriesPoint[] {
  if (shiftDays === 0) return [...points];
  const offset = Math.round(shiftDays) * DAY;
  return points.map((p) => ({ t: p.t + offset, v: p.v }));
}

/** Beschriftungszusatz für die Legende. Leer, wenn nichts verschoben wurde. */
export function shiftLabel(shiftDays: number): string {
  if (!shiftDays) return '';
  return shiftDays > 0 ? ` (+${shiftDays}d)` : ` (${shiftDays}d)`;
}

/**
 * Nachlaufender einfacher gleitender Durchschnitt.
 *
 * Lücken werden übersprungen, aber nicht überbrückt: ein Fenster mit zu wenigen
 * gültigen Werten liefert `null`, statt aus zwei Punkten einen „Durchschnitt"
 * zu bilden.
 */
export function sma(values: readonly (number | null)[], window: number): (number | null)[] {
  if (window <= 1) return [...values];
  const out: (number | null)[] = new Array<number | null>(values.length).fill(null);

  // Mindestens die Hälfte des Fensters muss belegt sein, damit der Wert trägt.
  const required = Math.max(2, Math.ceil(window / 2));

  for (let i = 0; i < values.length; i++) {
    if (values[i] === null) continue;

    const start = Math.max(0, i - window + 1);
    let sum = 0;
    let count = 0;
    for (let k = start; k <= i; k++) {
      const v = values[k] ?? null;
      if (v !== null) {
        sum += v;
        count++;
      }
    }

    if (count < Math.min(required, i - start + 1)) continue;
    out[i] = sum / count;
  }

  return out;
}

/**
 * Exponentiell gewichteter Durchschnitt, nachlaufend.
 * Startet beim ersten gültigen Wert; Lücken lassen den Zustand unverändert.
 */
export function ema(values: readonly (number | null)[], window: number): (number | null)[] {
  if (window <= 1) return [...values];
  const alpha = 2 / (window + 1);
  const out: (number | null)[] = new Array<number | null>(values.length).fill(null);

  let state: number | null = null;

  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? null;
    if (v === null) continue;
    state = state === null ? v : alpha * v + (1 - alpha) * state;
    out[i] = state;
  }

  return out;
}

/** Vorzeichen umkehren. `null` bleibt `null`. */
export function invert(values: readonly (number | null)[]): (number | null)[] {
  return values.map((v) => (v === null ? null : -v));
}

/**
 * Wendet die Reihenfolge an, die inhaltlich stimmt: erst schieben (das ist eine
 * Aussage über den Zeitpunkt), dann glätten, dann invertieren.
 *
 * Umgekehrt geglättet und dann geschoben käme dasselbe heraus; invertieren vor
 * dem Glätten dagegen nicht, sobald das Fenster Lücken enthält.
 */
export function applyValueTransforms(
  values: readonly (number | null)[],
  transform: SeriesTransform,
): (number | null)[] {
  let out = [...values];

  if (transform.sma && transform.sma > 1) out = sma(out, transform.sma);
  if (transform.ema && transform.ema > 1) out = ema(out, transform.ema);
  if (transform.invert) out = invert(out);

  return out;
}
