/**
 * Nachtjob (PROJECT_SPEC.md §10, §13 Phase 7).
 *
 *   npm run nightly
 *
 * Holt für jede Katalogserie nur das Delta seit dem letzten Punkt — die
 * Planung dafür steckt in `planFetches`, hier wird sie nur angestoßen. Einmal
 * geholte Historie wird nie erneut angefragt.
 *
 * Exit-Code 0 nur, wenn alle Serien durchliefen. Ein Cron-Job, der immer 0
 * zurückgibt, meldet auch nie ein Problem.
 *
 * Einrichtung siehe docs/DEPLOYMENT.md.
 */

import { loadRootEnv } from '../lib/root-env';
import { flushTelemetry, installTelemetrySink } from '../lib/db/telemetry-sink';
import { CATALOG } from '../lib/series/catalog';
import { loadSeries } from '../lib/series/service';

loadRootEnv();

// Ohne den Sink taucht der Lauf spaeter nicht in /api/health auf — und
// ausgerechnet die Skripte machen die meisten Provider-Anfragen.
installTelemetrySink();

/** Wie weit zurück der Nachtjob prüft. Ältere Lücken schließt der Backfill. */
const LOOKBACK_DAYS = 30;
const DAY = 86_400;

/** Kurze Pause zwischen Serien, damit der Token-Bucket nicht ständig greift. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<number> {
  const to = Math.floor(Date.now() / 1000);
  const from = to - LOOKBACK_DAYS * DAY;

  console.log(
    `Nachtjob ${new Date(from * 1000).toISOString().slice(0, 10)} .. ` +
      `${new Date(to * 1000).toISOString().slice(0, 10)} für ${CATALOG.length} Serien\n`,
  );

  let failures = 0;
  let unchanged = 0;

  for (const descriptor of CATALOG) {
    const started = Date.now();
    try {
      const { response, warning } = await loadSeries(descriptor, { from, to });
      const newest = response.points[response.points.length - 1];

      if (warning) {
        console.warn(`WARN   ${descriptor.id.padEnd(24)} ${warning}`);
        failures++;
        continue;
      }

      const label = newest
        ? new Date(newest.t * 1000).toISOString().slice(0, 10)
        : '(keine Punkte im Fenster)';
      console.log(
        `OK     ${descriptor.id.padEnd(24)} ${String(response.points.length).padStart(5)} Punkte  ` +
          `${String(Date.now() - started).padStart(6)}ms  neuester ${label}`,
      );
      if (response.points.length === 0) unchanged++;
    } catch (error) {
      console.error(
        `FEHLER ${descriptor.id.padEnd(24)} ${error instanceof Error ? error.message : String(error)}`,
      );
      failures++;
    }

    await pause(250);
  }

  console.log(
    `\n${CATALOG.length - failures} von ${CATALOG.length} Serien aktualisiert` +
      (unchanged > 0 ? `, ${unchanged} ohne Punkte im Fenster` : ''),
  );

  // Telemetriepuffer leeren, sonst fehlen die letzten Eintraege in /api/health.
  await flushTelemetry();

  if (failures > 0) {
    console.error(`${failures} Serie(n) mit Problemen — siehe /api/health.`);
    return 1;
  }
  return 0;
}

void main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
