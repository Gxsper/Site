/**
 * GET /api/liquidations — Liquidationen aus dem eigenen Ingest (§4.4, §7).
 *
 * `?symbol=BTCUSDT&hours=24&bucket=300`
 *
 * Liefert das Live-Tape (jüngste Ereignisse) und Balken pro Intervall, getrennt
 * nach Long und Short.
 *
 * ══ Wichtig für §11 ══
 *
 * Diese Daten entstehen aus dem eigenen WebSocket-Ingest. Sie beginnen mit dem
 * ersten Start des Workers — davor gibt es nichts, und es wird nichts
 * rekonstruiert. `coverage` in der Antwort sagt, ab wann tatsächlich
 * mitgeschrieben wurde; ohne diese Angabe sähe ein leerer Zeitraum wie ein
 * ruhiger Markt aus statt wie fehlende Aufzeichnung.
 */

import { NextResponse } from 'next/server';
import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';

import { getDb } from '@/lib/db';
import * as schema from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  symbol: z.string().min(1).default('BTCUSDT'),
  hours: z.coerce.number().int().positive().max(24 * 30).default(24),
  /** Balkenbreite in Sekunden. */
  bucket: z.coerce.number().int().positive().max(86_400).default(300),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    symbol: params.get('symbol') ?? undefined,
    hours: params.get('hours') ?? undefined,
    bucket: params.get('bucket') ?? undefined,
    limit: params.get('limit') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Ungültige Anfrage', issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }

  const { symbol, hours, bucket, limit } = parsed.data;
  const since = Math.floor(Date.now() / 1000) - hours * 3600;

  const db = getDb();

  try {
    const [tape, buckets, coverage] = await Promise.all([
      db
        .select({
          exchange: schema.liquidations.exchange,
          symbol: schema.liquidations.symbol,
          side: schema.liquidations.side,
          price: schema.liquidations.price,
          qty: schema.liquidations.qty,
          quoteQty: schema.liquidations.quoteQty,
          t: schema.liquidations.t,
        })
        .from(schema.liquidations)
        .where(and(eq(schema.liquidations.symbol, symbol), gte(schema.liquidations.t, since)))
        .orderBy(desc(schema.liquidations.t))
        .limit(limit),

      db
        .select({
          t: sql<number>`(${schema.liquidations.t} / ${bucket})::bigint * ${bucket}`,
          side: schema.liquidations.side,
          total: sql<number>`sum(${schema.liquidations.quoteQty})`,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.liquidations)
        .where(and(eq(schema.liquidations.symbol, symbol), gte(schema.liquidations.t, since)))
        .groupBy(sql`1`, schema.liquidations.side)
        .orderBy(asc(sql`1`)),

      db
        .select({
          firstT: sql<number | null>`min(${schema.liquidations.t})`,
          lastT: sql<number | null>`max(${schema.liquidations.t})`,
          total: sql<number>`count(*)::int`,
        })
        .from(schema.liquidations)
        .where(eq(schema.liquidations.symbol, symbol)),
    ]);

    const summary = coverage[0];
    const recordingFrom = summary?.firstT === null ? null : Number(summary?.firstT ?? 0) || null;

    return NextResponse.json({
      symbol,
      tape,
      buckets: buckets.map((b) => ({
        t: Number(b.t),
        side: b.side,
        total: Number(b.total),
        count: b.count,
      })),
      coverage: {
        // Ab wann wirklich mitgeschrieben wurde — nicht ab wann der Markt existiert.
        recordingFrom,
        lastEventAt: summary?.lastT === null ? null : Number(summary?.lastT ?? 0) || null,
        totalEvents: summary?.total ?? 0,
        hinweis:
          recordingFrom === null
            ? 'Noch keine Liquidation aufgezeichnet. Der Ingest-Worker läuft entweder ' +
              'noch nicht (npm run worker) oder es gab seit dem Start keine für dieses Symbol.'
            : 'Eigener WebSocket-Ingest von Binance, Bybit und OKX. Aufzeichnung ' +
              'beginnt mit dem ersten Worker-Start; frühere Ereignisse existieren nicht ' +
              'und werden nicht rekonstruiert.',
      },
      meta: { since, bucket, hours, generatedAt: Math.floor(Date.now() / 1000) },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
