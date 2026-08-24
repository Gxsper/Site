/**
 * GET /api/health — Zustand je Datenquelle (PROJECT_SPEC.md §10).
 *
 * Zeigt pro Provider: letzter Erfolg, Fehlerquote der letzten Stunde,
 * mittlere Antwortzeit, und je Serie den Sync-Zustand samt letztem Fehler.
 *
 * ══ Warum das hier steht ══
 *
 * §11 verlangt definierte Fehlerzustände statt stiller Ersatzwerte. Damit das
 * hilft, muss man die Fehler auch sehen können. Ein Provider, der seit Tagen
 * ausfällt, während der Cache noch trägt, fällt sonst niemandem auf.
 */

import { NextResponse } from 'next/server';
import { desc, sql } from 'drizzle-orm';

import { getDb } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { installTelemetrySink } from '@/lib/db/telemetry-sink';
import { getCacheBackend, getEnv, PROVIDER_KEYS, optionalProviderKey } from '@/lib/env';
import { isProviderImplemented } from '@/lib/providers';
import { CATALOG } from '@/lib/series/catalog';
import type { ProviderId } from '@/lib/series/types';

export const dynamic = 'force-dynamic';

/**
 * Wandelt einen Zeitwert aus der Datenbank in Unix-Sekunden.
 *
 * `sql<Date>` ist nur eine Typ-Behauptung gegenüber TypeScript. Für eine
 * **berechnete** Spalte wie `max(...) filter (...)` weiß der Treiber nicht,
 * dass ein Zeitstempel gemeint ist, und liefert einen String. Der Unterschied
 * fällt erst auf, sobald überhaupt Zeilen existieren — hier hat er genau das
 * getan.
 */
function toUnixSeconds(value: unknown): number | null {
  if (value == null) return null;
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

export async function GET() {
  installTelemetrySink();

  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  try {
    const [requestStats, syncRows, liquidationStats] = await Promise.all([
      // Fehlerquote und Antwortzeit der letzten Stunde je Provider.
      db
        .select({
          provider: schema.providerRequests.provider,
          total: sql<number>`count(*)::int`,
          failed: sql<number>`count(*) filter (where not ${schema.providerRequests.ok})::int`,
          avgMs: sql<number>`round(avg(${schema.providerRequests.durationMs}))::int`,
          // Bewusst `unknown`: der Treiber liefert hier je nach Spaltentyp
          // einen String oder ein Date. toUnixSeconds() fängt beides ab.
          lastOkAt: sql<unknown>`max(${schema.providerRequests.requestedAt}) filter (where ${schema.providerRequests.ok})`,
        })
        .from(schema.providerRequests)
        .where(sql`${schema.providerRequests.requestedAt} > now() - interval '1 hour'`)
        .groupBy(schema.providerRequests.provider),

      db
        .select({
          seriesId: schema.seriesSyncState.seriesId,
          lastSuccessAt: schema.seriesSyncState.lastSuccessAt,
          lastAttemptAt: schema.seriesSyncState.lastAttemptAt,
          lastError: schema.seriesSyncState.lastError,
          failures: schema.seriesSyncState.consecutiveFailures,
          lastPointT: schema.seriesSyncState.lastPointT,
        })
        .from(schema.seriesSyncState)
        .orderBy(desc(schema.seriesSyncState.lastAttemptAt))
        .limit(100),

      db
        .select({
          total: sql<number>`count(*)::int`,
          firstT: sql<number | null>`min(${schema.liquidations.t})`,
          lastT: sql<number | null>`max(${schema.liquidations.t})`,
        })
        .from(schema.liquidations),
    ]);

    const statsByProvider = new Map(requestStats.map((row) => [row.provider, row]));
    const syncById = new Map(syncRows.map((row) => [row.seriesId, row]));

    const providers = [...new Set(CATALOG.map((d) => d.provider))].sort().map((provider) => {
      const stats = statsByProvider.get(provider);
      const series = CATALOG.filter((d) => d.provider === provider);

      const withErrors = series
        .map((d) => syncById.get(d.id))
        .filter((s) => s?.lastError != null);

      return {
        provider,
        implemented: isProviderImplemented(provider as ProviderId),
        seriesCount: series.length,
        lastHour: stats
          ? {
              requests: stats.total,
              failed: stats.failed,
              errorRatePct: stats.total > 0 ? Math.round((stats.failed / stats.total) * 1000) / 10 : 0,
              avgDurationMs: stats.avgMs,
              lastSuccessAt: toUnixSeconds(stats.lastOkAt),
            }
          : // Keine Anfrage in der letzten Stunde ist kein Fehler — nur keine Aussage.
            null,
        seriesWithErrors: withErrors.length,
      };
    });

    const series = CATALOG.map((descriptor) => {
      const sync = syncById.get(descriptor.id);
      const lastSuccess = toUnixSeconds(sync?.lastSuccessAt);
      const ageSeconds = lastSuccess === null ? null : now - lastSuccess;

      return {
        id: descriptor.id,
        label: descriptor.label,
        provider: descriptor.provider,
        updateCadence: descriptor.updateCadence,
        lastSuccessAt: lastSuccess,
        ageSeconds,
        // Dieselbe Regel wie in §3.1: älter als updateCadence * 3 gilt als stale.
        stale: ageSeconds === null ? null : ageSeconds > descriptor.updateCadence * 3,
        lastError: sync?.lastError ?? null,
        consecutiveFailures: sync?.failures ?? 0,
        newestPointAt: sync?.lastPointT ?? null,
      };
    });

    const liquidations = liquidationStats[0];

    return NextResponse.json({
      status: series.some((s) => s.consecutiveFailures > 0) ? 'degraded' : 'ok',
      generatedAt: now,
      config: {
        cacheBackend: getCacheBackend(getEnv()),
        providerKeys: Object.fromEntries(
          Object.entries(PROVIDER_KEYS).map(([name, meta]) => [
            name,
            {
              // Nur ob gesetzt — niemals der Wert selbst (§0.2).
              configured: optionalProviderKey(name as keyof typeof PROVIDER_KEYS) !== null,
              required: meta.required,
              provider: meta.provider,
            },
          ]),
        ),
      },
      providers,
      series,
      ingest: {
        totalLiquidations: liquidations?.total ?? 0,
        recordingFrom: liquidations?.firstT == null ? null : Number(liquidations.firstT),
        lastEventAt: liquidations?.lastT == null ? null : Number(liquidations.lastT),
        hinweis:
          'Liquidationen stammen aus dem eigenen WebSocket-Ingest (npm run worker). ' +
          'Aufzeichnung beginnt mit dem ersten Start; frühere Ereignisse existieren nicht.',
      },
    });
  } catch (error) {
    // Auch ein Ausfall der Statusseite wird ehrlich gemeldet.
    return NextResponse.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        hinweis:
          'Statusabfrage fehlgeschlagen — meist läuft die Datenbank nicht. ' +
          'Prüfen: läuft PostgreSQL, stimmt DATABASE_URL?',
      },
      { status: 503 },
    );
  }
}
