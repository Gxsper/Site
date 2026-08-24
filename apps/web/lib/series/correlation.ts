/**
 * Korrelations-Panel (PROJECT_SPEC.md §5.4).
 *
 * ══ Warum auf Log-Returns und nicht auf Levels ══
 *
 * Zwei steigende Zeitreihen korrelieren fast immer mit r > 0,9 — auch wenn sie
 * nichts miteinander zu tun haben. Das ist Scheinkorrelation durch gemeinsamen
 * Trend. Erst die Renditen sagen etwas über einen Zusammenhang aus.
 *
 * ══ Warum `intersection` Pflicht ist ══
 *
 * Forward-Fill wiederholt Werte. Wiederholte Werte erzeugen künstliche
 * Autokorrelation und schönen r nach oben. Deshalb meldet `correlate` mit,
 * auf welchem Alignment gerechnet wurde, damit das UI warnen kann.
 */

export interface CorrelationResult {
  /** Pearson-Korrelationskoeffizient, oder null bei zu wenigen Beobachtungen. */
  r: number | null;
  /** Anzahl der Paare, die tatsächlich in die Rechnung eingegangen sind. */
  n: number;
}

/** Weniger Paare als das ergeben keine belastbare Aussage. */
export const MIN_SAMPLE = 20;

/**
 * Pearson über alle Positionen, an denen **beide** Reihen einen Wert haben.
 * Paare mit `null` fallen heraus — sie werden nicht mit 0 aufgefüllt.
 */
export function pearson(
  a: readonly (number | null)[],
  b: readonly (number | null)[],
): CorrelationResult {
  const length = Math.min(a.length, b.length);
  const xs: number[] = [];
  const ys: number[] = [];

  for (let i = 0; i < length; i++) {
    const x = a[i] ?? null;
    const y = b[i] ?? null;
    if (x === null || y === null) continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    xs.push(x);
    ys.push(y);
  }

  const n = xs.length;
  if (n < MIN_SAMPLE) return { r: null, n };

  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;

  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;

  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }

  // Eine konstante Reihe hat keine Streuung; r ist dann nicht definiert.
  if (varianceX === 0 || varianceY === 0) return { r: null, n };

  return { r: covariance / Math.sqrt(varianceX * varianceY), n };
}

/**
 * Rollierende Korrelation über ein nachlaufendes Fenster.
 * Jeder Punkt benutzt ausschließlich Werte bis einschließlich seiner Position.
 */
export function rollingCorrelation(
  a: readonly (number | null)[],
  b: readonly (number | null)[],
  window: number,
): (number | null)[] {
  const length = Math.min(a.length, b.length);
  const out: (number | null)[] = new Array<number | null>(length).fill(null);

  for (let i = 0; i < length; i++) {
    const start = Math.max(0, i - window + 1);
    if (i - start + 1 < window) continue; // Fenster noch nicht voll
    out[i] = pearson(a.slice(start, i + 1), b.slice(start, i + 1)).r;
  }

  return out;
}

export interface LeadLagPoint {
  /** Verschiebung von `b` in Rasterpunkten. Negativ = b läuft voraus. */
  shift: number;
  r: number | null;
  n: number;
}

export interface LeadLagProfile {
  points: LeadLagPoint[];
  /** Die Verschiebung mit dem betragsmäßig größten r, oder null. */
  best: LeadLagPoint | null;
}

/**
 * Kreuzkorrelation für Verschiebungen von −maxShift bis +maxShift (§5.4).
 *
 * `shift > 0` bedeutet: `b` wird nach hinten geschoben, geprüft wird also, ob
 * die **Vergangenheit** von `b` mit der Gegenwart von `a` zusammenhängt — ob
 * b vorausläuft.
 */
export function leadLagProfile(
  a: readonly (number | null)[],
  b: readonly (number | null)[],
  maxShift: number,
): LeadLagProfile {
  const points: LeadLagPoint[] = [];

  for (let shift = -maxShift; shift <= maxShift; shift++) {
    const shifted: (number | null)[] = new Array<number | null>(b.length).fill(null);
    for (let i = 0; i < b.length; i++) {
      const source = i - shift;
      if (source < 0 || source >= b.length) continue;
      shifted[i] = b[source]!;
    }

    const { r, n } = pearson(a, shifted);
    points.push({ shift, r, n });
  }

  let best: LeadLagPoint | null = null;
  for (const point of points) {
    if (point.r === null) continue;
    if (best === null || Math.abs(point.r) > Math.abs(best.r!)) best = point;
  }

  return { points, best };
}

/**
 * Hinweistext für das UI, wenn auf gefüllten Daten gerechnet wurde (§5.4).
 * Gibt null zurück, wenn die Rechnung sauber ist.
 */
export function correlationWarning(alignMode: string): string | null {
  if (alignMode === 'intersection') return null;
  return (
    'Korrelation auf gefüllten Daten — Forward-Fill wiederholt Werte und erhöht r ' +
    'künstlich. Für belastbare Werte den Intersection-Modus wählen.'
  );
}
