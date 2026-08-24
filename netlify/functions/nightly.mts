import type { Config } from '@netlify/functions';

/**
 * Zeitplan des Nachtjobs (PROJECT_SPEC.md §10, §13 Phase 7).
 *
 * Diese Funktion hält nur den Termin. Die Arbeit macht
 * `nightly-run-background.mts`, weil planbare Funktionen bei Netlify nach
 * 30 s abgeschnitten werden und der volle Katalog länger braucht — gemessen
 * am 2026-08-24 mit einem HTTP 504. Hintergrundfunktionen dürfen 15 Minuten
 * laufen und antworten sofort mit 202, also bleibt dieser Aufruf hier weit
 * unter der Grenze.
 *
 * Uhrzeit mit Bedacht: FRED veröffentlicht die Fed-Bilanz mittwochs nach
 * 16:30 US-Ostküstenzeit. 04:15 UTC liegt sicher danach.
 */
export default async function handler(): Promise<Response> {
  const base = process.env['URL'];

  if (!base) {
    console.error('URL fehlt — Netlify setzt sie normalerweise selbst.');
    return new Response('URL fehlt', { status: 503 });
  }

  // Kein CRON_SECRET nötig: der Aufruf geht an eine Netlify-Funktion, nicht an
  // die öffentliche Route. Das Geheimnis liest die Hintergrundfunktion selbst.
  const response = await fetch(`${base}/.netlify/functions/nightly-run-background`, {
    method: 'POST',
  });

  // Hintergrundfunktionen antworten mit 202, sobald sie angenommen sind — das
  // Ergebnis steht später im Log der anderen Funktion, nicht hier.
  console.log(`Nachtjob angestoßen: HTTP ${response.status}`);

  return new Response('angestoßen', { status: response.ok ? 202 : 502 });
}

export const config: Config = {
  // Täglich 04:15 UTC.
  schedule: '15 4 * * *',
};
