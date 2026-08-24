/**
 * Backfill-Script (PROJECT_SPEC.md §13, Phase 1).
 *
 *   npm run backfill -- --series btc.usd.close --from 2013-01-01
 *   npm run backfill -- --all --from 2010-01-01
 *
 * Holt fehlende Zeiträume und legt sie dauerhaft in Postgres ab (Layer 1).
 * Bereits vorhandene Punkte werden nicht erneut geholt — das übernimmt
 * planFetches(). Ein Fehlschlag bei einer Serie bricht den Lauf nicht ab, wird
 * aber am Ende gemeldet und schlägt sich im Exit-Code nieder.
 */

import { loadRootEnv } from '../lib/root-env';
import { CATALOG, findDescriptor } from '../lib/series/catalog';
import { loadSeries } from '../lib/series/service';

// Vor jedem Datenbankzugriff. getEnv() wird erst beim ersten Query ausgewertet,
// deshalb genügt es, das hier vor dem Aufruf von main() zu erledigen.
loadRootEnv();

interface Args {
  series: string[];
  from: number;
  to: number;
}

function parseDate(value: string, flag: string): number {
  const ms = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(ms)) {
    throw new Error(`${flag}: "${value}" ist kein gültiges Datum (erwartet: YYYY-MM-DD)`);
  }
  return Math.floor(ms / 1000);
}

function parseArgs(argv: readonly string[]): Args {
  const ids: string[] = [];
  let all = false;
  let from: number | null = null;
  let to = Math.floor(Date.now() / 1000);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '--all':
        all = true;
        break;
      case '--series': {
        const value = argv[++i];
        if (!value) throw new Error('--series erwartet eine Serien-ID');
        ids.push(...value.split(',').map((s) => s.trim()).filter(Boolean));
        break;
      }
      case '--from': {
        const value = argv[++i];
        if (!value) throw new Error('--from erwartet ein Datum');
        from = parseDate(value, '--from');
        break;
      }
      case '--to': {
        const value = argv[++i];
        if (!value) throw new Error('--to erwartet ein Datum');
        to = parseDate(value, '--to');
        break;
      }
      default:
        throw new Error(`Unbekanntes Argument: ${arg}`);
    }
  }

  const series = all ? CATALOG.map((d) => d.id) : ids;

  if (series.length === 0) {
    throw new Error(
      'Keine Serie angegeben.\n' +
        '  npm run backfill -- --series btc.usd.close --from 2013-01-01\n' +
        '  npm run backfill -- --all --from 2010-01-01\n' +
        `Verfügbar: ${CATALOG.map((d) => d.id).join(', ')}`,
    );
  }
  if (from === null) {
    throw new Error('--from fehlt (z. B. --from 2013-01-01)');
  }
  if (from >= to) {
    throw new Error('--from muss vor --to liegen');
  }

  return { series, from, to };
}

function isoDay(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  console.log(
    `Backfill ${isoDay(args.from)} .. ${isoDay(args.to)} für ${args.series.length} Serie(n)\n`,
  );

  let failures = 0;

  for (const id of args.series) {
    const descriptor = findDescriptor(id);
    if (!descriptor) {
      console.error(`FEHLER ${id}: unbekannte Serien-ID`);
      failures++;
      continue;
    }

    const started = Date.now();
    try {
      const { response, warning } = await loadSeries(descriptor, {
        from: args.from,
        to: args.to,
      });

      const first = response.points[0];
      const last = response.points[response.points.length - 1];
      const span = first && last ? `${isoDay(first.t)} .. ${isoDay(last.t)}` : '(leer)';

      console.log(
        `OK     ${id.padEnd(24)} ${String(response.points.length).padStart(6)} Punkte  ` +
          `${String(Date.now() - started).padStart(6)}ms  ${span}`,
      );
      if (warning) {
        console.warn(`       Hinweis: ${warning}`);
        failures++;
      }
    } catch (error) {
      console.error(`FEHLER ${id.padEnd(24)} ${error instanceof Error ? error.message : error}`);
      failures++;
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} Serie(n) mit Problemen.`);
    return 1;
  }
  console.log('\nAlle Serien vollständig.');
  return 0;
}

void main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
