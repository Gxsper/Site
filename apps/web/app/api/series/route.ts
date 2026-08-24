/**
 * GET /api/series — der einzige Chart-Datenendpunkt (PROJECT_SPEC.md §4.0).
 *
 * `?ids=btc.usd.close,macro.net_liquidity&from=…&to=…&align=union_ffill&norm=rebase100&shift=0,90`
 *
 * Der Server macht: Provider-Fetch (parallel) → Cache → Alignment (§5.1) →
 * Transformationen (§5.3) → Normalisierung (§5.2) → Response. Das Frontend
 * rechnet nichts um. Grund laut Spec: Alignment-Bugs sind die häufigste
 * Fehlerquelle bei Overlays, und serverseitig sind sie einmal testbar.
 *
 * Fehlerverhalten nach §11: eine nicht erreichbare Quelle nimmt die anderen
 * nicht mit. Sie taucht in `errors` auf, die übrigen Serien rendern normal.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { alignSeries, type AlignMode } from '@/lib/series/align';
import { installTelemetrySink } from '@/lib/db/telemetry-sink';
import { findDescriptor } from '@/lib/series/catalog';
import {
  correlationWarning,
  leadLagProfile,
  rollingCorrelation,
} from '@/lib/series/correlation';
import { allowsLogScale, logReturns, normalize, type NormMode } from '@/lib/series/normalize';
import { loadSeries } from '@/lib/series/service';
import { applyValueTransforms, shiftLabel, shiftPoints } from '@/lib/series/transform';
import type { SeriesResponse } from '@/lib/series/types';

export const dynamic = 'force-dynamic';

/** Obergrenze, damit ein Tippfehler nicht 50 Provider-Abrufe auslöst. */
const MAX_SERIES = 12;
/** Kreuzkorrelation über ±180 Tage (§5.4). */
const MAX_LEAD_LAG = 180;

const ALIGN_MODES = ['union_ffill', 'intersection', 'trading_days', 'native'] as const;
const NORM_MODES = [
  'raw',
  'rebase100',
  'pct_change',
  'zscore',
  'minmax',
  'log_returns',
  'yoy',
] as const;

/** Kommaliste von Zahlen, ein Eintrag je Serie. Fehlende Einträge sind 0. */
function numberList(raw: string | null, count: number, fallback = 0): number[] {
  if (!raw) return new Array<number>(count).fill(fallback);
  const parts = raw.split(',').map((s) => s.trim());
  return Array.from({ length: count }, (_, i) => {
    const value = Number(parts[i] ?? fallback);
    return Number.isFinite(value) ? value : fallback;
  });
}

const querySchema = z
  .object({
    ids: z
      .string()
      .min(1, 'ids fehlt')
      .transform((raw) => raw.split(',').map((s) => s.trim()).filter(Boolean)),
    from: z.coerce.number().int(),
    to: z.coerce.number().int().optional(),
    align: z.enum(ALIGN_MODES).default('union_ffill'),
    norm: z.enum(NORM_MODES).default('raw'),
    window: z.coerce.number().int().positive().max(3650).optional(),
    reference: z.string().optional(),
    corr: z.coerce.number().int().positive().max(3650).optional(),
    raw: z.enum(['0', '1']).default('1'),
  })
  .transform((q) => ({
    ...q,
    to: q.to ?? Math.floor(Date.now() / 1000),
    includeRaw: q.raw === '1',
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
  installTelemetrySink();

  const url = new URL(request.url);
  const params = url.searchParams;

  const parsed = querySchema.safeParse({
    ids: params.get('ids') ?? '',
    from: params.get('from'),
    to: params.get('to') ?? undefined,
    align: params.get('align') ?? undefined,
    norm: params.get('norm') ?? undefined,
    window: params.get('window') ?? undefined,
    reference: params.get('reference') ?? undefined,
    corr: params.get('corr') ?? undefined,
    raw: params.get('raw') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Ungültige Anfrage',
        issues: parsed.error.issues.map((i) => i.message),
        hinweis:
          'Beispiel: /api/series?ids=btc.usd.close&from=1704067200 — Zeiten sind Unix-Sekunden UTC. ' +
          `align ∈ {${ALIGN_MODES.join('|')}}, norm ∈ {${NORM_MODES.join('|')}}.`,
      },
      { status: 400 },
    );
  }

  const query = parsed.data;
  const { ids, from, to } = query;
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

  // Regler je Serie, in der Reihenfolge der ids (§5.3, §9 URL-State).
  const shifts = numberList(params.get('shift'), ids.length);
  const smooths = numberList(params.get('smooth'), ids.length);
  const inverts = numberList(params.get('invert'), ids.length);

  // Parallel holen — eine langsame Quelle soll die anderen nicht aufhalten.
  const settled = await Promise.allSettled(
    ids.map(async (id) => {
      const descriptor = findDescriptor(id)!;
      return { id, ...(await loadSeries(descriptor, range)) };
    }),
  );

  const series: SeriesResponse[] = [];
  const errors: SeriesError[] = [];
  const positions: number[] = [];

  for (const [index, result] of settled.entries()) {
    const id = ids[index]!;
    if (result.status === 'fulfilled') {
      series.push(result.value.response);
      positions.push(index);
      if (result.value.warning) errors.push({ id, message: result.value.warning });
    } else {
      const reason: unknown = result.reason;
      errors.push({ id, message: reason instanceof Error ? reason.message : String(reason) });
    }
  }

  if (series.length === 0) {
    return NextResponse.json(
      { series: [], errors, meta: { from, to, requested: ids.length, delivered: 0 } },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    );
  }

  // ── Verschieben vor dem Alignment: der Shift ändert Zeitstempel. ──────────
  const shifted = series.map((response, i) => {
    const days = shifts[positions[i]!] ?? 0;
    if (!days) return response;
    return { ...response, points: shiftPoints(response.points, days) };
  });

  // ── Alignment (§5.1) ──────────────────────────────────────────────────────
  let aligned;
  try {
    aligned = alignSeries(shifted, {
      mode: query.align as AlignMode,
      grid: '1d',
      from,
      to,
      ...(query.reference ? { referenceId: query.reference } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }

  // ── Transformationen (§5.3) und Normalisierung (§5.2) ─────────────────────
  const rows: (number | null)[][] = [];
  for (let i = 0; i < aligned.values.length; i++) {
    const position = positions[i]!;
    const transformed = applyValueTransforms(aligned.values[i]!, {
      sma: smooths[position] ?? 0,
      invert: (inverts[position] ?? 0) !== 0,
    });

    try {
      rows.push(
        normalize(transformed, query.norm as NormMode, {
          t: aligned.t,
          seriesId: aligned.ids[i]!,
          ...(query.window ? { window: query.window } : {}),
        }),
      );
    } catch (error) {
      // Eine nicht anwendbare Normalisierung ist ein Fehler dieser einen Serie,
      // nicht der ganzen Anfrage.
      errors.push({
        id: aligned.ids[i]!,
        message: error instanceof Error ? error.message : String(error),
      });
      rows.push(aligned.values[i]!.map(() => null));
    }
  }

  // ── Korrelation (§5.4), nur auf ausdrückliche Anfrage und für genau zwei Serien
  let correlation: unknown;
  if (query.corr && rows.length === 2) {
    const a = logReturns(aligned.values[0]!);
    const b = logReturns(aligned.values[1]!);
    const profile = leadLagProfile(a, b, MAX_LEAD_LAG);

    correlation = {
      window: query.corr,
      basis: 'log_returns',
      rolling: rollingCorrelation(a, b, query.corr),
      leadLag: profile.points,
      best: profile.best,
      warning: correlationWarning(query.align),
    };
  }

  return NextResponse.json(
    {
      series: query.includeRaw
        ? series
        : series.map((s) => ({ ...s, points: [], pointCount: s.points.length })),
      aligned: {
        t: aligned.t,
        ids: aligned.ids.map((id, i) => id + shiftLabel(shifts[positions[i]!] ?? 0)),
        values: rows,
        filled: aligned.filled,
      },
      correlation,
      errors,
      meta: {
        from,
        to,
        generatedAt: Math.floor(Date.now() / 1000),
        requested: ids.length,
        delivered: series.length,
        align: query.align,
        norm: query.norm,
        gridPoints: aligned.t.length,
        allowsLogScale: allowsLogScale(query.norm as NormMode),
      },
    },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  );
}
