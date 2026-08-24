/**
 * POST /api/cron/nightly — der Nachtjob für den gehosteten Betrieb.
 *
 * Angestoßen von der geplanten Netlify-Funktion in `netlify/functions/nightly.mts`.
 * Lokal geht derselbe Job einfacher über `npm run nightly`.
 *
 * ══ Warum das geschützt ist ══
 *
 * Die Route stößt Dutzende Provider-Anfragen an. Ohne Schutz könnte sie jeder
 * beliebig oft aufrufen und damit die Rate-Limits verbrennen — CoinGecko zählt
 * gegen ein Monatsbudget. Deshalb ein gemeinsames Geheimnis in `CRON_SECRET`.
 *
 * Ist `CRON_SECRET` nicht gesetzt, verweigert die Route den Dienst, statt
 * ungeschützt offen zu stehen.
 */

import { NextResponse } from 'next/server';

import { installTelemetrySink, flushTelemetry } from '@/lib/db/telemetry-sink';
import { runNightly } from '@/lib/series/nightly';

export const dynamic = 'force-dynamic';

/**
 * Zeitbudget. Netlify-Funktionen laufen im Hintergrund bis zu 15 Minuten;
 * hier bleibt bewusst Luft, damit der Bericht noch geschrieben wird.
 */
const DEADLINE_MS = 12 * 60_000;

/** Vergleich ohne frühen Abbruch — sonst verrät die Laufzeit das Geheimnis. */
function secretMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(request: Request) {
  const expected = process.env['CRON_SECRET'];

  if (!expected || expected.length < 16) {
    return NextResponse.json(
      {
        error: 'CRON_SECRET ist nicht gesetzt oder zu kurz (mindestens 16 Zeichen).',
        hinweis:
          'Die Route bleibt geschlossen, statt ungeschützt Provider-Anfragen auszulösen. ' +
          'CRON_SECRET in den Umgebungsvariablen setzen — siehe docs/DEPLOYMENT.md.',
      },
      { status: 503 },
    );
  }

  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!secretMatches(token, expected)) {
    return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
  }

  installTelemetrySink();

  const report = await runNightly({ deadlineMs: DEADLINE_MS });
  await flushTelemetry();

  return NextResponse.json(
    {
      ...report,
      // Nur die Problemfälle im Klartext — der Rest ist Rauschen im Log.
      results: report.results.filter((r) => !r.ok || r.points === 0),
    },
    // 207, wenn etwas schieflief: ein Cron-Job, der immer 200 liefert, meldet
    // auch nie einen Ausfall.
    { status: report.failed > 0 ? 207 : 200 },
  );
}
