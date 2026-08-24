/**
 * Yahoo Finance — Aktienindizes, Edelmetalle, Rohstoffe (PROJECT_SPEC.md §4.2).
 *
 * ══ Warum diese Quelle ══
 *
 * §4.2 setzt Stooq als erste Wahl; Stooq ist durch eine Bot-Prüfung nicht mehr
 * nutzbar (FINDINGS.md §5). FRED liefert `SP500` und `DJIA` aus Lizenzgründen
 * nur zehn Jahre rollierend — zu kurz für Zyklusvergleiche über mehrere
 * Halvings.
 *
 * Yahoo liefert dieselben Reihen frei und tief:
 *
 *   ^GSPC     14 282 Tage ab 1970-01-02
 *   ^NDX      10 303 Tage ab 1985-10-01
 *   GC=F       6 603 Tage ab 2000-08-30
 *
 * Abwägung und Grenzen: docs/adr/0003-yahoo-transport.md.
 *
 * ══ Verifizierte Eigenheiten (FINDINGS.md §9) ══
 *
 *  - `range=max` liefert **Monatswerte**, auch mit `interval=1d`. Nur
 *    `period1`/`period2` erzwingen echte Tagesdaten.
 *  - Zeitstempel stehen auf der Handelseröffnung in Börsenzeit, nicht auf
 *    00:00 UTC. Sie werden hier auf den UTC-Tagesbeginn abgerundet, damit alle
 *    Tagesserien dieselbe Zeitbasis haben (§0.4).
 *  - `close` enthält `null` an Tagen ohne Schlusskurs. Diese Punkte entfallen
 *    und werden zur Lücke — nicht zu 0 (§11).
 */

import { z } from 'zod';

import { fetchJson } from '@/lib/providers/http';
import { assertStrictlyIncreasing, clampToRange } from '@/lib/providers/util';
import {
  ProviderError,
  type Provider,
  type SeriesDescriptor,
  type SeriesPoint,
  type SeriesRange,
} from '@/lib/series/types';

const PROVIDER = 'yahoo' as const;
const ROOT = 'https://query1.finance.yahoo.com/v8/finance/chart';

const DAY = 86_400;

const chartSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: z.object({ symbol: z.string(), currency: z.string().optional() }),
          timestamp: z.array(z.number()).optional(),
          indicators: z.object({
            quote: z.array(z.object({ close: z.array(z.number().nullable()).optional() })),
          }),
        }),
      )
      .nullable(),
    error: z
      .object({ code: z.string(), description: z.string() })
      .nullable()
      .optional(),
  }),
});

function readSymbol(descriptor: SeriesDescriptor): string {
  const symbol = descriptor.providerParams['symbol'];
  if (typeof symbol !== 'string' || symbol === '') {
    throw new ProviderError(PROVIDER, `${descriptor.id}: providerParams.symbol fehlt`);
  }
  return symbol;
}

type ChartResponse = z.infer<typeof chartSchema>;

/**
 * Reine Umformung. Öffentlich, damit die Feinheiten — Zeitbasis, `null`-Werte,
 * fehlende Felder — ohne Netzwerk testbar sind.
 */
export function mapChartToPoints(body: ChartResponse, seriesId: string): SeriesPoint[] {
  const error = body.chart.error;
  if (error) {
    throw new ProviderError(PROVIDER, `${seriesId}: ${error.code} — ${error.description}`);
  }

  const result = body.chart.result?.[0];
  if (!result) {
    // Kein Ergebnis und kein Fehler: die Antwort passt nicht zu unserer Annahme.
    throw new ProviderError(
      PROVIDER,
      `${seriesId}: Antwort enthält weder ein Ergebnis noch einen Fehler.`,
    );
  }

  const timestamps = result.timestamp ?? [];
  const closes = result.indicators.quote[0]?.close ?? [];

  if (timestamps.length === 0) return [];

  if (closes.length !== timestamps.length) {
    throw new ProviderError(
      PROVIDER,
      `${seriesId}: ${timestamps.length} Zeitstempel, aber ${closes.length} Schlusskurse — ` +
        `die Zuordnung wäre geraten.`,
    );
  }

  const points: SeriesPoint[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i] ?? null;
    // null heißt: an diesem Tag gab es keinen Schlusskurs. Das wird eine
    // Lücke, kein Ersatzwert (§11).
    if (close === null || !Number.isFinite(close)) continue;

    // Auf den UTC-Tagesbeginn abrunden — Yahoo liefert die Handelseröffnung
    // in Börsenzeit, alle anderen Tagesserien stehen auf 00:00 UTC.
    const t = Math.floor(timestamps[i]! / DAY) * DAY;

    // Nach dem Abrunden können zwei Meldungen auf denselben Tag fallen.
    const previous = points[points.length - 1];
    if (previous && previous.t === t) {
      previous.v = close;
      continue;
    }

    points.push({ t, v: close });
  }

  return points;
}

async function fetchChart(
  descriptor: SeriesDescriptor,
  range: SeriesRange,
): Promise<SeriesPoint[]> {
  const symbol = readSymbol(descriptor);

  // `range=max` liefert Monatswerte — nur period1/period2 erzwingen Tagesdaten.
  const url =
    `${ROOT}/${encodeURIComponent(symbol)}` +
    `?interval=1d&period1=${Math.max(0, range.from)}&period2=${range.to}`;

  const body = await fetchJson(chartSchema, {
    provider: PROVIDER,
    url,
    // Ohne erkennbaren Client antwortet Yahoo teils mit 429.
    headers: { accept: 'application/json', 'user-agent': 'macrodeck/1.0' },
  });

  const points = mapChartToPoints(body, descriptor.id);
  assertStrictlyIncreasing(points, PROVIDER, descriptor.id);
  return clampToRange(points, range);
}

export const yahooProvider: Provider = {
  id: PROVIDER,
  catalog: async () => {
    const { CATALOG } = await import('@/lib/series/catalog');
    return CATALOG.filter((d) => d.provider === PROVIDER);
  },
  fetch: fetchChart,
};

export const __testing = { chartSchema, readSymbol };
