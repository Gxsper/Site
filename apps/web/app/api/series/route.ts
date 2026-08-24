/**
 * GET /api/series — der einzige Chart-Datenendpunkt (PROJECT_SPEC.md §4.0).
 *
 * `?ids=btc.usd.close,onchain.btc.mvrv&from=…&to=…`
 *
 * Der Server holt parallel, cached und liefert je Serie eine `SeriesResponse`.
 * Alignment (§5.1) und Normalisierung (§5.2) kommen in Phase 2 dazu und werden
 * ebenfalls hier passieren — das Frontend rechnet nichts um.
 *
 * Fehlerverhalten nach §11: eine nicht erreichbare Quelle nimmt die anderen
 * nicht mit. Sie taucht in `errors` auf, die übrigen Serien rendern normal.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { findDescriptor } from '@/lib/series/catalog';
import { loadSeries } from '@/lib/series/service';
import type { SeriesResponse } from '@/lib/series/types';

export const dynamic = 'force-dynamic';

/** Obergrenze, damit ein Tippfehler nicht 50 Provider-Abrufe auslöst. */
const MAX_SERIES = 12;

const querySchema = z
  .object({
    ids: z
      .string()
      .min(1, 'ids fehlt')
      .transform((raw) => raw.split(',').map((s) => s.trim()).filter(Boolean)),
    from: z.coerce.number().int(),
    to: z.coerce.number().int().optional(),
  })
  .transform((q) => ({
    ids: q.ids,
    from: q.from,
    to: q.to ?? Math.floor(Date.now() / 1000),
  }))
  .refine((q) => q.ids.length > 0, { message: 'ids enthält keine gültige Serien-ID' })
  .refine((q) => q.ids.length <= MAX_SERIES, {
    message: `höchstens ${MAX_SERIES} Serien pro Anfrage`,
  })
  .refine((q) => q.from < q.to, { message: 'from muss vor to liegen' });

interface SeriesError {
  id: string;
  message: string;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    ids: url.searchParams.get('ids') ?? '',
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Ungültige Anfrage',
        issues: parsed.error.issues.map((i) => i.message),
        hinweis:
          'Beispiel: /api/series?ids=btc.usd.close&from=1704067200 — Zeiten sind Unix-Sekunden UTC.',
      },
      { status: 400 },
    );
  }

  const { ids, from, to } = parsed.data;
  const range = { from, to };

  const unknown = ids.filter((id) => !findDescriptor(id));
  if (unknown.length > 0) {
    return NextResponse.json(
      {
        error: `Unbekannte Serien-ID(s): ${unknown.join(', ')}`,
        hinweis: 'Verfügbare IDs liefert /api/catalog',
      },
      { status: 404 },
    );
  }

  // Parallel holen — eine langsame Quelle soll die anderen nicht aufhalten.
  const settled = await Promise.allSettled(
    ids.map(async (id) => {
      const descriptor = findDescriptor(id)!;
      return { id, ...(await loadSeries(descriptor, range)) };
    }),
  );

  const series: SeriesResponse[] = [];
  const errors: SeriesError[] = [];

  for (const [index, result] of settled.entries()) {
    const id = ids[index]!;
    if (result.status === 'fulfilled') {
      series.push(result.value.response);
      if (result.value.warning) {
        errors.push({ id, message: result.value.warning });
      }
    } else {
      const reason: unknown = result.reason;
      errors.push({
        id,
        message: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }

  return NextResponse.json(
    {
      series,
      errors,
      meta: {
        from,
        to,
        generatedAt: Math.floor(Date.now() / 1000),
        requested: ids.length,
        delivered: series.length,
      },
    },
    {
      // Alle Serien gescheitert und keine Bestandsdaten: das ist ein echter
      // Fehlschlag, kein leeres Ergebnis (§11).
      status: series.length === 0 ? 502 : 200,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
