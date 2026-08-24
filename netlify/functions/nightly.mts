import type { Config } from '@netlify/functions';

/**
 * Geplanter Anstoß des Nachtjobs (PROJECT_SPEC.md §10, §13 Phase 7).
 *
 * Netlify kann keine tsx-Skripte planen, deshalb dieser Umweg: die Funktion
 * ruft die eigene API-Route auf, die die eigentliche Arbeit macht. So gibt es
 * nur eine Stelle mit der Logik (lib/series/nightly.ts), egal ob der Job lokal
 * über `npm run nightly` oder hier gestartet wird.
 *
 * Uhrzeit mit Bedacht: FRED veröffentlicht die Fed-Bilanz mittwochs nach
 * 16:30 US-Ostküstenzeit. 04:15 UTC liegt sicher danach.
 */
export default async function handler(): Promise<Response> {
  // process.env statt des Netlify-Globals: gleiche Werte, aber typisiert und
  // damit vom Typecheck erfasst.
  const secret = process.env['CRON_SECRET'];
  const base = process.env['URL'];

  if (!secret) {
    // Ohne Geheimnis bleibt die Route ohnehin geschlossen — hier gleich
    // deutlich machen, woran es liegt, statt ein 401 im Log zu hinterlassen.
    console.error('CRON_SECRET fehlt in den Umgebungsvariablen. Nachtjob übersprungen.');
    return new Response('CRON_SECRET fehlt', { status: 503 });
  }
  if (!base) {
    console.error('URL fehlt — Netlify setzt sie normalerweise selbst.');
    return new Response('URL fehlt', { status: 503 });
  }

  const started = Date.now();
  const response = await fetch(`${base}/api/cron/nightly`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  });

  const body = await response.text();
  const seconds = Math.round((Date.now() - started) / 1000);

  // Im Netlify-Log landet nur die Zusammenfassung; Einzelheiten stehen unter
  // /health und in series_sync_state.
  console.log(`Nachtjob: HTTP ${response.status} nach ${seconds}s — ${body.slice(0, 500)}`);

  return new Response(body, { status: response.status });
}

export const config: Config = {
  // Täglich 04:15 UTC.
  schedule: '15 4 * * *',
};
