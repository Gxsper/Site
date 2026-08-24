import 'server-only';

import { getDb } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { setTelemetrySink, type ProviderRequestRecord } from '@/lib/providers/telemetry';

/**
 * Hängt die Datenbank als Ziel der Provider-Telemetrie ein (§10).
 *
 * Wird von den Route-Handlern aufgerufen, nicht beim Import — so bleibt die
 * Provider-Schicht ohne Datenbank testbar.
 *
 * Geschrieben wird gebündelt: ein Backfill über zehn Jahre erzeugt Dutzende
 * Anfragen, und für jede einzeln in die Datenbank zu schreiben würde den Abruf
 * spürbar bremsen.
 */

const FLUSH_AFTER = 25;
const FLUSH_INTERVAL_MS = 5000;

let buffer: ProviderRequestRecord[] = [];
let timer: NodeJS.Timeout | null = null;
let installed = false;

async function flush(): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];

  try {
    await getDb()
      .insert(schema.providerRequests)
      .values(
        batch.map((record) => ({
          provider: record.provider,
          endpoint: record.endpoint,
          httpStatus: record.httpStatus,
          durationMs: Math.round(record.durationMs),
          ok: record.ok,
          error: record.error,
        })),
      );
  } catch (error) {
    // Telemetrie darf den Betrieb nie gefährden. Die Zahlen sind dann
    // unvollständig — das ist besser, als deswegen einen Abruf scheitern zu lassen.
    console.error('Provider-Telemetrie nicht geschrieben:', error);
  }
}

export function installTelemetrySink(): void {
  if (installed) return;
  installed = true;

  setTelemetrySink((record) => {
    buffer.push(record);

    if (buffer.length >= FLUSH_AFTER) {
      void flush();
      return;
    }
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        void flush();
      }, FLUSH_INTERVAL_MS);
      // Der Timer darf den Prozess nicht am Beenden hindern.
      timer.unref?.();
    }
  });
}

/** Nur für Tests und den geordneten Abschluss. */
export async function flushTelemetry(): Promise<void> {
  await flush();
}
