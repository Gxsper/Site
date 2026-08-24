/**
 * Normalisierung (PROJECT_SPEC.md §5.2).
 *
 * Zwei Regeln aus der Spec, die das Verhalten prägen:
 *
 *  - **Rebasing bezieht sich immer auf den sichtbaren Zeitraum**, nicht auf den
 *    geladenen. Ändert der Nutzer den Zeitraum, wird neu rebased. Das ist das
 *    Verhalten, das man von ITC und TradingView erwartet.
 *  - Rollierende Kennzahlen benutzen ausschließlich **vergangene** Werte.
 *    Ein z-Score, der den Mittelwert der gesamten Reihe kennt, sieht in einem
 *    Backtest großartig aus und ist wertlos.
 *
 * Alle Funktionen arbeiten auf `(number | null)[]`. `null` heißt „hier gibt es
 * keinen Wert" und bleibt `null` — es wird nie zu 0 (§11).
 */

export type NormMode =
  | 'raw'
  | 'rebase100'
  | 'pct_change'
  | 'zscore'
  | 'minmax'
  | 'log_returns'
  | 'yoy';

export class NormalizationError extends Error {
  override readonly name = 'NormalizationError';
}

export interface NormalizeOptions {
  /** Fenster für `zscore`, in Rasterpunkten. Default 365 (§5.2). */
  window?: number;
  /** Zeitachse — nötig für `yoy`, das zeitbasiert zurückblickt. */
  t?: readonly number[];
  /** Serien-ID für verständliche Fehlermeldungen. */
  seriesId?: string;
}

const DEFAULT_WINDOW = 365;
const YEAR_SECONDS = 365 * 86_400;
/** Toleranz bei der Suche nach dem Vorjahreswert: Wochenenden und Feiertage. */
const YOY_TOLERANCE_SECONDS = 5 * 86_400;

function firstFinite(values: readonly (number | null)[]): number | null {
  for (const v of values) {
    if (v !== null && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * Skaliert auf 100 am ersten gültigen Wert des sichtbaren Zeitraums.
 * Wirft, wenn die Basis 0 ist — dann ist ein Verhältnis nicht definiert, und
 * eine erfundene Ersatzbasis wäre ein §11-Verstoß.
 */
function rebase(values: readonly (number | null)[], factor: number, seriesId: string) {
  const base = firstFinite(values);
  if (base === null) {
    // Keine Daten im Zeitraum — das ist kein Fehler, nur nichts zu zeigen.
    return values.map(() => null);
  }
  if (base === 0) {
    throw new NormalizationError(
      `${seriesId}: Rebasing nicht möglich, der erste Wert im Zeitraum ist 0. ` +
        `Andere Normalisierung wählen (z. B. zscore) oder Zeitraum verschieben.`,
    );
  }
  return values.map((v) => (v === null ? null : (v / base) * factor));
}

function pctChange(values: readonly (number | null)[], seriesId: string) {
  return rebase(values, 100, seriesId).map((v) => (v === null ? null : v - 100));
}

/** Rollierender z-Score über ein nachlaufendes Fenster — kein Look-ahead. */
function zscore(values: readonly (number | null)[], window: number) {
  const out: (number | null)[] = new Array<number | null>(values.length).fill(null);

  for (let i = 0; i < values.length; i++) {
    const current = values[i] ?? null;
    if (current === null) continue;

    // Fenster endet bei i einschließlich — nur Vergangenheit und Gegenwart.
    const start = Math.max(0, i - window + 1);
    const sample: number[] = [];
    for (let k = start; k <= i; k++) {
      const v = values[k] ?? null;
      if (v !== null) sample.push(v);
    }

    // Ohne genügend Beobachtungen ist ein z-Score bedeutungslos.
    if (sample.length < Math.min(window, 30)) continue;

    const mean = sample.reduce((a, b) => a + b, 0) / sample.length;
    const variance = sample.reduce((a, b) => a + (b - mean) ** 2, 0) / sample.length;
    const sd = Math.sqrt(variance);

    // Konstante Reihe: Streuung 0, z-Score nicht definiert. Lücke statt 0.
    if (sd === 0) continue;

    out[i] = (current - mean) / sd;
  }

  return out;
}

/** Min-Max über den sichtbaren Zeitraum auf [0, 1]. */
function minmax(values: readonly (number | null)[]) {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (finite.length === 0) return values.map(() => null);

  const min = Math.min(...finite);
  const max = Math.max(...finite);

  // Flache Reihe: die Skalierung ist nicht definiert. Bewusst Lücke statt 0.5 —
  // ein erfundener Mittelwert wäre eine Aussage, die die Daten nicht hergeben.
  if (max === min) return values.map(() => null);

  return values.map((v) => (v === null ? null : (v - min) / (max - min)));
}

/** ln(x_t / x_{t-1}). Der erste Punkt hat keinen Vorgänger und bleibt null. */
export function logReturns(values: readonly (number | null)[]) {
  const out: (number | null)[] = new Array<number | null>(values.length).fill(null);

  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1] ?? null;
    const cur = values[i] ?? null;
    // Log-Returns sind nur für positive Werte definiert.
    if (prev === null || cur === null || prev <= 0 || cur <= 0) continue;
    out[i] = Math.log(cur / prev);
  }

  return out;
}

/**
 * Veränderung gegenüber dem Vorjahr in Prozent.
 *
 * Bewusst zeitbasiert statt über einen Index-Versatz: bei unregelmäßigen
 * Rastern — Handelstage, wöchentliche Serien — liegt „vor einem Jahr" nicht
 * 365 Positionen zurück.
 */
function yoy(values: readonly (number | null)[], t: readonly number[], seriesId: string) {
  if (t.length !== values.length) {
    throw new NormalizationError(
      `${seriesId}: yoy braucht eine Zeitachse gleicher Länge (${t.length} vs. ${values.length}).`,
    );
  }

  const out: (number | null)[] = new Array<number | null>(values.length).fill(null);
  let candidate = 0;

  for (let i = 0; i < values.length; i++) {
    const cur = values[i] ?? null;
    if (cur === null) continue;

    const target = t[i]! - YEAR_SECONDS;

    // Zeiger nachziehen, solange der nächste Punkt noch nicht zu weit ist.
    while (candidate + 1 < t.length && t[candidate + 1]! <= target) candidate++;

    if (Math.abs(t[candidate]! - target) > YOY_TOLERANCE_SECONDS) continue;

    const past = values[candidate] ?? null;
    if (past === null || past === 0) continue;

    out[i] = (cur / past - 1) * 100;
  }

  return out;
}

export function normalize(
  values: readonly (number | null)[],
  mode: NormMode,
  options: NormalizeOptions = {},
): (number | null)[] {
  const seriesId = options.seriesId ?? '(unbenannt)';

  switch (mode) {
    case 'raw':
      return [...values];
    case 'rebase100':
      return rebase(values, 100, seriesId);
    case 'pct_change':
      return pctChange(values, seriesId);
    case 'zscore':
      return zscore(values, options.window ?? DEFAULT_WINDOW);
    case 'minmax':
      return minmax(values);
    case 'log_returns':
      return logReturns(values);
    case 'yoy':
      if (!options.t) {
        throw new NormalizationError(`${seriesId}: yoy braucht die Zeitachse.`);
      }
      return yoy(values, options.t, seriesId);
  }
}

/**
 * Ob eine logarithmische Achse zu dieser Normalisierung passt.
 * Bei `pct_change` und `zscore` sind Werte ≤ 0 möglich (§5.2).
 */
export function allowsLogScale(mode: NormMode): boolean {
  return mode === 'raw' || mode === 'rebase100' || mode === 'minmax';
}
