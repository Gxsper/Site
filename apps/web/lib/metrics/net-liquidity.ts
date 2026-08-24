/**
 * Fed Net Liquidity (PROJECT_SPEC.md §4.3).
 *
 * ══ Einheiten — hier liegt der Fehler, den fast alle machen ══
 *
 * §4.3 der Spec warnt vor dieser Falle und tappt selbst hinein: dort steht
 * `WALCL/1000 − WTREGEN − RRPONTSYD` mit der Annahme, WTREGEN sei in
 * Milliarden. Am 2026-08-24 direkt bei FRED nachgeschlagen:
 *
 *   WALCL      Millions of U.S. Dollars     (wöchentlich, Mittwoch)
 *   WTREGEN    Millions of U.S. Dollars     (wöchentlich)   ← nicht Milliarden
 *   RRPONTSYD  Billions of US Dollars       (täglich)
 *
 * Mit der Formel aus der Spec käme für Januar 2024 ein Wert um −751.000 Mrd.
 * heraus statt der tatsächlichen ~6.203 Mrd.
 *
 * Belege und Screenshot-Ersatz: docs/api-samples/FINDINGS.md §6.
 */

import { dailyGrid, forwardFill, MAX_FILL_AGE } from '@/lib/series/ffill';
import type { SeriesPoint } from '@/lib/series/types';

/**
 * Net Liquidity in Milliarden USD.
 *
 * @param walclMillions   Fed Total Assets, Millionen USD
 * @param tgaMillions     Treasury General Account, Millionen USD
 * @param rrpBillions     Overnight Reverse Repo, Milliarden USD
 */
export function netLiquidityBn(
  walclMillions: number,
  tgaMillions: number,
  rrpBillions: number,
): number {
  return walclMillions / 1000 - tgaMillions / 1000 - rrpBillions;
}

export const NET_LIQUIDITY_METHODOLOGY =
  'Net Liquidity = Fed-Bilanzsumme (WALCL) − Treasury General Account (WTREGEN) ' +
  '− Overnight Reverse Repo (RRPONTSYD), alles in Mrd. USD. WALCL und WTREGEN ' +
  'liefert FRED in Millionen und werden durch 1000 geteilt, RRPONTSYD kommt ' +
  'bereits in Milliarden. WALCL und WTREGEN sind wöchentlich (Mittwoch) und ' +
  'werden auf ein Tagesraster vorwärts gefüllt (max. 10 Tage), RRPONTSYD ist ' +
  'täglich (max. 5 Tage). Wird eine Komponente zu alt, entsteht eine Lücke — ' +
  'die Linie bricht ab, statt eingefroren weiterzulaufen.';

export interface NetLiquidityInputs {
  walcl: readonly SeriesPoint[];
  wtregen: readonly SeriesPoint[];
  rrpontsyd: readonly SeriesPoint[];
}

/**
 * Setzt die Tagesreihe zusammen. Ein Tag erscheint nur, wenn **alle drei**
 * Komponenten einen gültigen, nicht zu alten Wert haben — eine unvollständige
 * Summe wäre schlimmer als eine Lücke.
 */
export function computeNetLiquiditySeries(
  inputs: NetLiquidityInputs,
  range: { from: number; to: number },
): SeriesPoint[] {
  const grid = dailyGrid(range.from, range.to);

  const walcl = forwardFill(inputs.walcl, grid, MAX_FILL_AGE.weekly);
  const tga = forwardFill(inputs.wtregen, grid, MAX_FILL_AGE.weekly);
  const rrp = forwardFill(inputs.rrpontsyd, grid, MAX_FILL_AGE.daily);

  const points: SeriesPoint[] = [];

  for (let i = 0; i < grid.length; i++) {
    const a = walcl[i];
    const b = tga[i];
    const c = rrp[i];
    if (a === null || a === undefined) continue;
    if (b === null || b === undefined) continue;
    if (c === null || c === undefined) continue;

    points.push({ t: grid[i]!, v: netLiquidityBn(a, b, c) });
  }

  return points;
}
