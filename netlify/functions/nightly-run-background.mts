/**
 * Der eigentliche Nachtjob im gehosteten Betrieb (PROJECT_SPEC.md §10).
 *
 * ══ Warum es diese zweite Funktion gibt ══
 *
 * Gemessen am 2026-08-24: ein Aufruf von `/api/cron/nightly` über den vollen
 * Katalog endete nach 30 s mit HTTP 504. Netlify schneidet sowohl planbare als
 * auch normal aufgerufene Funktionen bei 30 s ab — auf allen Tarifen. Nur
 * **Hintergrundfunktionen** dürfen bis zu 15 Minuten laufen; erkennbar allein
 * am Dateinamen auf `-background`.
 *
 * Diese Funktion ruft die Route deshalb mehrfach auf, je Abschnitt unter 30 s,
 * und reicht `nextOffset` weiter, bis der Katalog durch ist. Die Arbeit selbst
 * bleibt in der Route, damit `npm run nightly` und der gehostete Lauf
 * weiterhin dieselbe Logik benutzen (lib/series/nightly.ts).
 *
 * Angestoßen wird sie von `nightly.mts`, das nur den Zeitplan hält.
 */

/** Notbremse gegen eine Schleife, die sich nicht vom Fleck bewegt. */
const MAX_ABSCHNITTE = 20;

interface Abschnittsbericht {
  total: number;
  succeeded: number;
  failed: number;
  nextOffset: number | null;
  results?: { id: string; message?: string }[];
}

export default async function handler(): Promise<Response> {
  const secret = process.env['CRON_SECRET'];
  const base = process.env['URL'];

  if (!secret) {
    console.error('CRON_SECRET fehlt in den Umgebungsvariablen. Nachtjob übersprungen.');
    return new Response('CRON_SECRET fehlt', { status: 503 });
  }
  if (!base) {
    console.error('URL fehlt — Netlify setzt sie normalerweise selbst.');
    return new Response('URL fehlt', { status: 503 });
  }

  const started = Date.now();
  let offset: number | null = 0;
  let abschnitte = 0;
  let erledigt = 0;
  let fehlgeschlagen = 0;

  while (offset !== null && abschnitte < MAX_ABSCHNITTE) {
    abschnitte += 1;

    const response = await fetch(`${base}/api/cron/nightly?offset=${offset}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    });

    if (!response.ok && response.status !== 207) {
      const text = await response.text();
      console.error(
        `Nachtjob: Abschnitt ${abschnitte} ab Position ${offset} scheiterte mit ` +
          `HTTP ${response.status} — ${text.slice(0, 300)}`,
      );
      return new Response(text, { status: response.status });
    }

    const bericht = (await response.json()) as Abschnittsbericht;
    erledigt += bericht.succeeded;
    fehlgeschlagen += bericht.failed;

    for (const eintrag of bericht.results ?? []) {
      if (eintrag.message) console.warn(`  ${eintrag.id}: ${eintrag.message}`);
    }

    // Kommt derselbe Wert zurück, ging in diesem Abschnitt nichts voran.
    // Weiterlaufen hieße, dieselbe Serie endlos erneut zu versuchen.
    if (bericht.nextOffset !== null && bericht.nextOffset === offset) {
      console.error(
        `Nachtjob: Position ${offset} kommt nicht voran — abgebrochen nach ` +
          `${abschnitte} Abschnitten.`,
      );
      break;
    }

    offset = bericht.nextOffset;
  }

  const sekunden = Math.round((Date.now() - started) / 1000);
  const offen = offset !== null ? ` — offen ab Position ${offset}` : '';
  const zusammenfassung =
    `Nachtjob: ${erledigt} Serien aktualisiert, ${fehlgeschlagen} mit Problemen, ` +
    `${abschnitte} Abschnitte in ${sekunden}s${offen}`;

  // Im Netlify-Log steht nur die Zusammenfassung; Einzelheiten unter /health
  // und in series_sync_state.
  console.log(zusammenfassung);

  return new Response(zusammenfassung, { status: fehlgeschlagen > 0 ? 207 : 200 });
}
