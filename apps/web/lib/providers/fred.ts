/**
 * FRED — Federal Reserve Economic Data (PROJECT_SPEC.md §4.3).
 *
 * Transport ist der CSV-Endpunkt, der ohne API-Key auskommt. Begründung und
 * Abwägung: docs/adr/0002-fred-transport.md.
 *
 * Verifizierte Eigenheiten (docs/api-samples/FINDINGS.md §6):
 *  - Fehlende Werte sind ein **leeres Feld**, nicht `"."` wie in der JSON-API.
 *    Ein leeres Feld wird zur Lücke, nie zu 0 (§11).
 *  - Mehrere IDs in einem Aufruf liefern ein ZIP-Archiv, kein CSV. Deshalb
 *    genau eine Serie pro Anfrage.
 *  - Einheiten unterscheiden sich zwischen Serien und sind die häufigste
 *    Fehlerquelle. Sie stehen im Katalog, nicht hier.
 */

import { fetchText } from '@/lib/providers/http';
import { assertStrictlyIncreasing, clampToRange } from '@/lib/providers/util';
import {
  ProviderError,
  type Provider,
  type SeriesDescriptor,
  type SeriesPoint,
  type SeriesRange,
} from '@/lib/series/types';

const PROVIDER = 'fred' as const;
const CSV_ROOT = 'https://fred.stlouisfed.org/graph/fredgraph.csv';

function readSeriesId(descriptor: SeriesDescriptor): string {
  const id = descriptor.providerParams['series_id'];
  if (typeof id !== 'string' || id === '') {
    throw new ProviderError(PROVIDER, `${descriptor.id}: providerParams.series_id fehlt`);
  }
  return id;
}

/**
 * Faktor, der den Rohwert auf die im Descriptor deklarierte `unit` bringt.
 *
 * FRED liefert je Serie eine andere Einheit: WALCL und WTREGEN in Millionen,
 * RRPONTSYD und WM2NS bereits in Milliarden. Ohne diesen Faktor stünde im
 * Descriptor `usd_bn`, gespeichert wären aber Millionen — eine Lüge über die
 * eigenen Daten, die im Chart erst um den Faktor 1000 auffällt.
 *
 * Pflichtangabe: ein fehlender Faktor ist ein Fehler, kein stiller Default 1.
 */
function readScale(descriptor: SeriesDescriptor): number {
  const raw = descriptor.providerParams['scale'];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw === 0) {
    throw new ProviderError(
      PROVIDER,
      `${descriptor.id}: providerParams.scale fehlt oder ist ungültig. ` +
        `FRED-Einheiten unterscheiden sich je Serie — der Faktor muss explizit ` +
        `angegeben werden (1 für unveränderte Übernahme, 0.001 für Millionen → Milliarden).`,
    );
  }
  return raw;
}

/** FRED erwartet Datumsgrenzen als YYYY-MM-DD. */
function toFredDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/**
 * Reine Umformung des CSV. Öffentlich, damit die Feinheiten — leere Felder,
 * Kopfzeile, Zeilenenden — ohne Netzwerk testbar sind.
 */
export function parseFredCsv(csv: string, seriesId: string): SeriesPoint[] {
  const trimmed = csv.trim();

  // FRED antwortet für ein Fenster ohne Beobachtungen mit HTTP 200 und einem
  // leeren Body (verifiziert: cosd=coed=2019-01-01 bei SP500 liefert "\n").
  // Das ist die Aussage "hier existieren nachweislich keine Daten" und damit
  // ein legitimes leeres Ergebnis (§3.2) — kein Fehler.
  if (trimmed === '') return [];

  const lines = trimmed.split(/\r?\n/);
  const header = lines[0]!.split(',').map((h) => h.trim());
  if (header[0]?.toLowerCase() !== 'observation_date') {
    throw new ProviderError(
      PROVIDER,
      `${seriesId}: unerwartete Kopfzeile "${lines[0]}". ` +
        `Erwartet wurde "observation_date,<id>". Antwortformat vermutlich geändert.`,
    );
  }

  const points: SeriesPoint[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '') continue;

    const separator = line.indexOf(',');
    if (separator <= 0) {
      throw new ProviderError(PROVIDER, `${seriesId}: unlesbare Zeile ${i + 1}: "${line}"`);
    }

    const dateText = line.slice(0, separator).trim();
    const valueText = line.slice(separator + 1).trim();

    // Leeres Feld = Feiertag oder noch nicht veröffentlicht. Das ist eine
    // Lücke: Zeile überspringen, keine 0 einsetzen (§11).
    // Die JSON-API schreibt hier "." — beides wird gleich behandelt.
    if (valueText === '' || valueText === '.') continue;

    const ms = Date.parse(`${dateText}T00:00:00Z`);
    if (!Number.isFinite(ms)) {
      throw new ProviderError(PROVIDER, `${seriesId}: unlesbares Datum "${dateText}"`);
    }

    const value = Number(valueText);
    if (!Number.isFinite(value)) {
      throw new ProviderError(
        PROVIDER,
        `${seriesId}: "${valueText}" am ${dateText} ist keine endliche Zahl`,
      );
    }

    points.push({ t: Math.floor(ms / 1000), v: value });
  }

  return points;
}

async function fetchSeries(
  descriptor: SeriesDescriptor,
  range: SeriesRange,
): Promise<SeriesPoint[]> {
  const seriesId = readSeriesId(descriptor);
  const scale = readScale(descriptor);

  const url =
    `${CSV_ROOT}?id=${encodeURIComponent(seriesId)}` +
    `&cosd=${toFredDate(range.from)}&coed=${toFredDate(range.to)}`;

  const csv = await fetchText({
    provider: PROVIDER,
    url,
    headers: { accept: 'text/csv,*/*' },
  });

  const raw = parseFredCsv(csv, seriesId);
  const points = scale === 1 ? raw : raw.map((p) => ({ t: p.t, v: p.v * scale }));

  assertStrictlyIncreasing(points, PROVIDER, descriptor.id);
  return clampToRange(points, range);
}

export const fredProvider: Provider = {
  id: PROVIDER,
  catalog: async () => {
    const { CATALOG } = await import('@/lib/series/catalog');
    return CATALOG.filter((d) => d.provider === PROVIDER);
  },
  fetch: fetchSeries,
};

export const __testing = { readSeriesId, toFredDate };
