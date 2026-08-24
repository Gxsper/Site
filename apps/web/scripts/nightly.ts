/**
 * Nachtjob für den lokalen Betrieb (PROJECT_SPEC.md §10, §13 Phase 7).
 *
 *   npm run nightly
 *
 * Die eigentliche Arbeit steckt in `lib/series/nightly.ts` — dieselbe Logik
 * benutzt die Route `/api/cron/nightly`, die im gehosteten Betrieb von einer
 * geplanten Netlify-Funktion angestoßen wird. So können beide Wege nicht
 * auseinanderlaufen.
 *
 * Exit-Code 0 nur, wenn alle Serien durchliefen. Ein Cron-Job, der immer 0
 * zurückgibt, meldet auch nie ein Problem.
 *
 * Einrichtung siehe docs/DEPLOYMENT.md.
 */

import { loadRootEnv } from '../lib/root-env';
import { flushTelemetry, installTelemetrySink } from '../lib/db/telemetry-sink';
import { runNightly } from '../lib/series/nightly';

loadRootEnv();

// Ohne den Sink taucht der Lauf später nicht in /api/health auf — und
// ausgerechnet die Skripte machen die meisten Provider-Anfragen.
installTelemetrySink();

function isoDay(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

async function main(): Promise<number> {
  const report = await runNightly({
    onResult: (result) => {
      if (result.ok) {
        const label = result.newestAt ? isoDay(result.newestAt) : '(keine Punkte im Fenster)';
        console.log(
          `OK     ${result.id.padEnd(24)} ${String(result.points).padStart(5)} Punkte  ` +
            `${String(result.durationMs).padStart(6)}ms  neuester ${label}`,
        );
      } else {
        console.error(`FEHLER ${result.id.padEnd(24)} ${result.message ?? ''}`);
      }
    },
  });

  console.log(
    `\nZeitraum ${isoDay(report.from)} .. ${isoDay(report.to)}\n` +
      `${report.succeeded} von ${report.total} Serien aktualisiert` +
      (report.empty > 0 ? `, ${report.empty} ohne Punkte im Fenster` : '') +
      ` — ${Math.round(report.durationMs / 1000)}s`,
  );

  // Telemetriepuffer leeren, sonst fehlen die letzten Einträge in /api/health.
  await flushTelemetry();

  if (report.failed > 0) {
    console.error(`${report.failed} Serie(n) mit Problemen — siehe /api/health.`);
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
