/**
 * Abgeleitete Serien (PROJECT_SPEC.md §4.3, §6).
 *
 * Serien, die aus anderen Serien gerechnet werden. Sie holen ihre Eingaben
 * direkt beim jeweiligen Quell-Provider, damit die Registry keinen Zyklus
 * bekommt.
 *
 * Wichtig für §11: eine abgeleitete Serie liefert nur Punkte, für die **alle**
 * Eingaben vorliegen. Fehlt eine Komponente, entsteht eine Lücke — nie eine
 * halbe Rechnung.
 */

import { computeNetLiquiditySeries } from '@/lib/metrics/net-liquidity';
import { fredProvider } from '@/lib/providers/fred';
import { assertStrictlyIncreasing } from '@/lib/providers/util';
import {
  ProviderError,
  type Provider,
  type SeriesDescriptor,
  type SeriesPoint,
  type SeriesRange,
} from '@/lib/series/types';

const PROVIDER = 'derived' as const;

/**
 * Beschreibt eine FRED-Eingabe ohne Umweg über den Katalog — die abgeleitete
 * Serie soll unabhängig davon funktionieren, ob die Rohserie im Katalog steht.
 */
function fredInput(seriesId: string, earliest: string): SeriesDescriptor {
  return {
    id: `fred.${seriesId}`,
    label: seriesId,
    group: 'macro',
    unit: 'usd_bn',
    nativeFrequency: seriesId === 'RRPONTSYD' ? '1d' : '1w',
    provider: 'fred',
    // scale: 1 — netLiquidityBn() erwartet die Rohwerte in FRED-Einheiten und
    // rechnet die Umrechnung selbst, damit die Einheiten-Logik an einer Stelle
    // dokumentiert und testbar bleibt.
    providerParams: { series_id: seriesId, scale: 1 },
    earliest,
    supportsLog: false,
    updateCadence: 21_600,
    attribution: 'Federal Reserve Bank of St. Louis (FRED)',
  };
}

/**
 * Vorlauf, damit der Forward-Fill am linken Rand einen Wert hat. Ohne diesen
 * Puffer begänne die Reihe erst beim ersten Mittwoch im angefragten Zeitraum.
 */
const LEAD_IN_SECONDS = 30 * 86_400;

async function fetchNetLiquidity(
  descriptor: SeriesDescriptor,
  range: SeriesRange,
): Promise<SeriesPoint[]> {
  const sourceRange = { from: range.from - LEAD_IN_SECONDS, to: range.to };

  const [walcl, wtregen, rrpontsyd] = await Promise.all([
    fredProvider.fetch(fredInput('WALCL', '2002-12-18T00:00:00Z'), sourceRange),
    fredProvider.fetch(fredInput('WTREGEN', '2002-12-18T00:00:00Z'), sourceRange),
    fredProvider.fetch(fredInput('RRPONTSYD', '2003-02-07T00:00:00Z'), sourceRange),
  ]);

  const points = computeNetLiquiditySeries({ walcl, wtregen, rrpontsyd }, range);
  assertStrictlyIncreasing(points, PROVIDER, descriptor.id);
  return points;
}

const BUILDERS: Record<string, (d: SeriesDescriptor, r: SeriesRange) => Promise<SeriesPoint[]>> = {
  'macro.net_liquidity': fetchNetLiquidity,
};

export const derivedProvider: Provider = {
  id: PROVIDER,
  catalog: async () => {
    const { CATALOG } = await import('@/lib/series/catalog');
    return CATALOG.filter((d) => d.provider === PROVIDER);
  },
  fetch: async (descriptor, range) => {
    const builder = BUILDERS[descriptor.id];
    if (!builder) {
      throw new ProviderError(
        PROVIDER,
        `Für "${descriptor.id}" ist keine Berechnung hinterlegt. ` +
          `Bekannt: ${Object.keys(BUILDERS).join(', ')}`,
      );
    }
    return builder(descriptor, range);
  },
};
