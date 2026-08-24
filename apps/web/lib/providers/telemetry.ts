/**
 * Telemetrie ausgehender Provider-Anfragen (PROJECT_SPEC.md §10).
 *
 * Speist `/api/health`: letzter Erfolg je Quelle, Fehlerquote der letzten
 * Stunde, verbrauchtes Budget.
 *
 * ══ Warum ein austauschbarer Sink ══
 *
 * `http.ts` darf die Datenbank nicht direkt importieren — sonst zieht jeder
 * Provider die gesamte Persistenzschicht mit, und die reinen Parser wären ohne
 * laufende Datenbank nicht mehr testbar. Deshalb meldet die HTTP-Schicht nur
 * an diese Stelle, und wer will, hängt einen Sink ein.
 *
 * Das Aufzeichnen darf den eigentlichen Abruf nie stören: schlägt es fehl,
 * wird das protokolliert und ignoriert. Eine Messung ist nie wichtiger als die
 * Sache, die sie misst.
 */

import type { ProviderId } from '@/lib/series/types';

export interface ProviderRequestRecord {
  provider: ProviderId;
  endpoint: string;
  httpStatus: number | null;
  durationMs: number;
  ok: boolean;
  error: string | null;
}

export type TelemetrySink = (record: ProviderRequestRecord) => void | Promise<void>;

let sink: TelemetrySink | null = null;

export function setTelemetrySink(next: TelemetrySink | null): void {
  sink = next;
}

/** Meldet eine abgeschlossene Anfrage. Wirft nie. */
export function recordProviderRequest(record: ProviderRequestRecord): void {
  if (!sink) return;
  try {
    const result = sink(record);
    if (result instanceof Promise) {
      result.catch((error: unknown) => {
        console.error('Telemetrie konnte nicht geschrieben werden:', error);
      });
    }
  } catch (error) {
    console.error('Telemetrie konnte nicht geschrieben werden:', error);
  }
}

/** Kürzt eine URL auf den Pfad — Query-Parameter enthalten teils Keys (§0.2). */
export function endpointOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url.slice(0, 120);
  }
}
