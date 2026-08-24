/**
 * Cache-Layer 1 (PROJECT_SPEC.md §10): historische Punkte dauerhaft in Postgres.
 * Einmal geholt = nie wieder holen.
 *
 * Die Regel aus §11 gilt auch hier: eine Lücke ist eine fehlende Zeile, nie
 * eine Zeile mit 0 oder NULL. Deshalb ist `series_points.v` NOT NULL.
 */

import 'server-only';

import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';

import { getDb } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import type { SeriesDescriptor, SeriesPoint, SeriesRange } from '@/lib/series/types';

/** Größe der Insert-Stapel. Postgres deckelt Parameter pro Statement. */
const INSERT_CHUNK = 1000;

/** Legt den Descriptor ab bzw. aktualisiert ihn — der Katalog ist die Wahrheit. */
export async function upsertDescriptor(descriptor: SeriesDescriptor): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.series)
    .values({
      id: descriptor.id,
      label: descriptor.label,
      group: descriptor.group,
      unit: descriptor.unit,
      nativeFrequency: descriptor.nativeFrequency,
      provider: descriptor.provider,
      providerParams: descriptor.providerParams,
      earliest: descriptor.earliest,
      supportsLog: descriptor.supportsLog,
      updateCadence: descriptor.updateCadence,
      attribution: descriptor.attribution,
    })
    .onConflictDoUpdate({
      target: schema.series.id,
      set: {
        label: descriptor.label,
        group: descriptor.group,
        unit: descriptor.unit,
        nativeFrequency: descriptor.nativeFrequency,
        provider: descriptor.provider,
        providerParams: descriptor.providerParams,
        earliest: descriptor.earliest,
        supportsLog: descriptor.supportsLog,
        updateCadence: descriptor.updateCadence,
        attribution: descriptor.attribution,
        updatedAt: sql`now()`,
      },
    });
}

export async function readPoints(
  seriesId: string,
  range: SeriesRange,
): Promise<SeriesPoint[]> {
  const db = getDb();
  const rows = await db
    .select({ t: schema.seriesPoints.t, v: schema.seriesPoints.v })
    .from(schema.seriesPoints)
    .where(
      and(
        eq(schema.seriesPoints.seriesId, seriesId),
        gte(schema.seriesPoints.t, range.from),
        lte(schema.seriesPoints.t, range.to),
      ),
    )
    .orderBy(asc(schema.seriesPoints.t));

  return rows.map((r) => ({ t: r.t, v: r.v }));
}

export interface StoredExtent {
  minT: number;
  maxT: number;
  count: number;
}

/** Welchen Zeitraum die Datenbank für diese Serie bereits abdeckt. */
export async function readExtent(seriesId: string): Promise<StoredExtent | null> {
  const db = getDb();
  const rows = await db
    .select({
      minT: sql<number | null>`min(${schema.seriesPoints.t})`,
      maxT: sql<number | null>`max(${schema.seriesPoints.t})`,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.seriesPoints)
    .where(eq(schema.seriesPoints.seriesId, seriesId));

  const row = rows[0];
  if (!row || row.minT === null || row.maxT === null || row.count === 0) return null;
  return { minT: Number(row.minT), maxT: Number(row.maxT), count: row.count };
}

/**
 * Schreibt Punkte. Ein bereits bekannter Zeitstempel wird überschrieben —
 * Provider korrigieren ihre Werte gelegentlich nachträglich, und der neuere
 * Abruf ist die bessere Quelle.
 */
export async function writePoints(seriesId: string, points: readonly SeriesPoint[]): Promise<number> {
  if (points.length === 0) return 0;
  const db = getDb();

  for (let i = 0; i < points.length; i += INSERT_CHUNK) {
    const chunk = points.slice(i, i + INSERT_CHUNK);
    await db
      .insert(schema.seriesPoints)
      .values(chunk.map((p) => ({ seriesId, t: p.t, v: p.v })))
      .onConflictDoUpdate({
        target: [schema.seriesPoints.seriesId, schema.seriesPoints.t],
        set: { v: sql`excluded.v`, ingestedAt: sql`now()` },
      });
  }

  return points.length;
}

export interface SyncState {
  lastPointT: number | null;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
}

export async function readSyncState(seriesId: string): Promise<SyncState | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.seriesSyncState)
    .where(eq(schema.seriesSyncState.seriesId, seriesId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    lastPointT: row.lastPointT,
    lastSuccessAt: row.lastSuccessAt,
    lastAttemptAt: row.lastAttemptAt,
    lastError: row.lastError,
    consecutiveFailures: row.consecutiveFailures,
  };
}

export async function recordSuccess(seriesId: string, lastPointT: number | null): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.seriesSyncState)
    .values({
      seriesId,
      lastPointT,
      lastSuccessAt: sql`now()` as unknown as Date,
      lastAttemptAt: sql`now()` as unknown as Date,
      lastError: null,
      consecutiveFailures: 0,
    })
    .onConflictDoUpdate({
      target: schema.seriesSyncState.seriesId,
      set: {
        lastPointT,
        lastSuccessAt: sql`now()`,
        lastAttemptAt: sql`now()`,
        lastError: null,
        consecutiveFailures: 0,
      },
    });
}

/**
 * Hält einen Fehlschlag fest. Fehler werden persistiert statt verschluckt —
 * /api/health und die Stale-Badges im UI leben davon (§10, §11).
 */
export async function recordFailure(seriesId: string, message: string): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.seriesSyncState)
    .values({
      seriesId,
      lastAttemptAt: sql`now()` as unknown as Date,
      lastError: message,
      consecutiveFailures: 1,
    })
    .onConflictDoUpdate({
      target: schema.seriesSyncState.seriesId,
      set: {
        lastAttemptAt: sql`now()`,
        lastError: message,
        consecutiveFailures: sql`${schema.seriesSyncState.consecutiveFailures} + 1`,
      },
    });
}
