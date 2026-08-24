'use client';

/**
 * Status-Dashboard (PROJECT_SPEC.md §10, §13 Phase 7).
 *
 * §11 verlangt definierte Fehlerzustände statt stiller Ersatzwerte. Damit das
 * hilft, muss man die Fehler sehen können — ein Provider, der seit Tagen
 * ausfällt, während der Cache noch trägt, fällt sonst niemandem auf.
 */

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { cn } from '@/lib/utils';

interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  generatedAt: number;
  error?: string;
  hinweis?: string;
  config: {
    cacheBackend: string;
    providerKeys: Record<string, { configured: boolean; required: boolean; provider: string }>;
  };
  providers: {
    provider: string;
    implemented: boolean;
    seriesCount: number;
    lastHour: {
      requests: number;
      failed: number;
      errorRatePct: number;
      avgDurationMs: number;
      lastSuccessAt: number | null;
    } | null;
    seriesWithErrors: number;
  }[];
  series: {
    id: string;
    label: string;
    provider: string;
    updateCadence: number;
    lastSuccessAt: number | null;
    ageSeconds: number | null;
    stale: boolean | null;
    lastError: string | null;
    consecutiveFailures: number;
    newestPointAt: number | null;
  }[];
  ingest: {
    totalLiquidations: number;
    recordingFrom: number | null;
    lastEventAt: number | null;
    hinweis: string;
  };
}

function formatAge(seconds: number | null): string {
  if (seconds === null) return 'nie';
  if (seconds < 90) return 'gerade eben';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 90) return `vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `vor ${hours} Std.`;
  return `vor ${Math.floor(hours / 24)} Tagen`;
}

function formatDate(t: number | null): string {
  return t === null ? '—' : new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

export function HealthDashboard() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/health', { signal });
      const body = (await response.json()) as HealthResponse;
      // Auch ein 503 trägt einen verwertbaren Body — nicht als Fehler wegwerfen.
      return body;
    },
    refetchInterval: 30_000,
  });

  const data = health.data;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-border flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5">
        <Link href="/" className="text-sm font-semibold tracking-tight hover:underline">
          MacroDeck
        </Link>
        <span className="text-muted-foreground text-[10px]">Status</span>
        {data && (
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] font-medium',
              data.status === 'ok' && 'bg-[#7ed321] text-black',
              data.status === 'degraded' && 'bg-[#f6c85f] text-black',
              data.status === 'error' && 'bg-destructive text-destructive-foreground',
            )}
          >
            {data.status}
          </span>
        )}
        <nav className="ml-auto flex gap-3 text-[11px]">
          <Link href="/" className="hover:underline">
            Overlay-Studio
          </Link>
          <Link href="/macro" className="hover:underline">
            Makro
          </Link>
          <Link href="/risk" className="hover:underline">
            Risk
          </Link>
          <Link href="/derivatives" className="hover:underline">
            Derivate
          </Link>
        </nav>
      </header>

      <main className="flex flex-col gap-3 p-3">
        {health.isPending && (
          <p className="text-muted-foreground text-xs">Status wird abgefragt…</p>
        )}

        {data?.status === 'error' && (
          <div className="border-destructive/40 bg-destructive/10 rounded-md border p-3">
            <p className="text-destructive text-xs font-medium">{data.error}</p>
            <p className="text-muted-foreground mt-1 text-[11px]">{data.hinweis}</p>
          </div>
        )}

        {data && data.status !== 'error' && (
          <>
            <section className="border-border bg-card/30 rounded-md border p-3">
              <h2 className="mb-2 text-xs font-semibold">Konfiguration</h2>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground text-[10px]">Cache-Backend</dt>
                  <dd>{data.config.cacheBackend}</dd>
                </div>
                {Object.entries(data.config.providerKeys).map(([name, key]) => (
                  <div key={name}>
                    <dt className="text-muted-foreground text-[10px]">{key.provider}</dt>
                    <dd className={key.configured ? '' : 'text-muted-foreground'}>
                      {key.configured ? 'Key gesetzt' : key.required ? 'Key fehlt' : 'ohne Key'}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="border-border bg-card/30 rounded-md border p-3">
              <h2 className="mb-2 text-xs font-semibold">Quellen · letzte Stunde</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] tabular-nums">
                  <thead className="text-muted-foreground text-left text-[10px]">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Provider</th>
                      <th className="py-1 pr-3 font-medium">Serien</th>
                      <th className="py-1 pr-3 text-right font-medium">Anfragen</th>
                      <th className="py-1 pr-3 text-right font-medium">Fehlerquote</th>
                      <th className="py-1 pr-3 text-right font-medium">⌀ Dauer</th>
                      <th className="py-1 font-medium">letzter Erfolg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.providers.map((provider) => (
                      <tr key={provider.provider} className="border-border/50 border-t">
                        <td className="py-1 pr-3">
                          {provider.provider}
                          {!provider.implemented && (
                            <span className="text-muted-foreground ml-1 text-[10px]">
                              (nicht implementiert)
                            </span>
                          )}
                        </td>
                        <td className="py-1 pr-3">{provider.seriesCount}</td>
                        <td className="py-1 pr-3 text-right">
                          {provider.lastHour?.requests ?? '—'}
                        </td>
                        <td
                          className="py-1 pr-3 text-right"
                          style={{
                            color:
                              (provider.lastHour?.errorRatePct ?? 0) > 0 ? '#e15759' : undefined,
                          }}
                        >
                          {provider.lastHour ? `${provider.lastHour.errorRatePct} %` : '—'}
                        </td>
                        <td className="py-1 pr-3 text-right">
                          {provider.lastHour ? `${provider.lastHour.avgDurationMs} ms` : '—'}
                        </td>
                        <td className="py-1">
                          {provider.lastHour?.lastSuccessAt
                            ? formatDate(provider.lastHour.lastSuccessAt)
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-muted-foreground mt-1.5 text-[10px]">
                &bdquo;—&ldquo; heißt: in der letzten Stunde nicht angefragt. Das ist kein
                Fehler, sondern schlicht keine Aussage.
              </p>
            </section>

            <section className="border-border bg-card/30 rounded-md border p-3">
              <h2 className="mb-2 text-xs font-semibold">Serien</h2>
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-[11px] tabular-nums">
                  <thead className="text-muted-foreground sticky top-0 bg-[var(--color-card)] text-left text-[10px]">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Serie</th>
                      <th className="py-1 pr-3 font-medium">Quelle</th>
                      <th className="py-1 pr-3 font-medium">letzter Erfolg</th>
                      <th className="py-1 pr-3 font-medium">neuester Punkt</th>
                      <th className="py-1 font-medium">Zustand</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.series.map((series) => (
                      <tr key={series.id} className="border-border/50 border-t align-top">
                        <td className="py-1 pr-3">
                          <span className="font-mono text-[10px]">{series.id}</span>
                        </td>
                        <td className="py-1 pr-3">{series.provider}</td>
                        <td className="py-1 pr-3">{formatAge(series.ageSeconds)}</td>
                        <td className="py-1 pr-3">
                          {series.newestPointAt
                            ? new Date(series.newestPointAt * 1000).toISOString().slice(0, 10)
                            : '—'}
                        </td>
                        <td className="py-1">
                          {series.consecutiveFailures > 0 ? (
                            <span style={{ color: '#e15759' }}>
                              {series.consecutiveFailures}× fehlgeschlagen
                              {series.lastError && (
                                <span className="text-muted-foreground block max-w-md text-[10px]">
                                  {series.lastError.slice(0, 160)}
                                </span>
                              )}
                            </span>
                          ) : series.lastSuccessAt === null ? (
                            <span className="text-muted-foreground">noch nie geladen</span>
                          ) : series.stale ? (
                            <span style={{ color: '#f6c85f' }}>abgestanden</span>
                          ) : (
                            <span style={{ color: '#7ed321' }}>aktuell</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="border-border bg-card/30 rounded-md border p-3">
              <h2 className="mb-2 text-xs font-semibold">Liquidations-Ingest</h2>
              <dl className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-muted-foreground text-[10px]">Ereignisse</dt>
                  <dd>{data.ingest.totalLiquidations.toLocaleString('de-DE')}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-[10px]">Aufzeichnung seit</dt>
                  <dd>{formatDate(data.ingest.recordingFrom)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-[10px]">letztes Ereignis</dt>
                  <dd>{formatDate(data.ingest.lastEventAt)}</dd>
                </div>
              </dl>
              <p className="text-muted-foreground mt-2 text-[10px]">{data.ingest.hinweis}</p>
            </section>

            <p className="text-muted-foreground text-[10px]">
              Stand {formatDate(data.generatedAt)} UTC · aktualisiert sich alle 30 Sekunden
            </p>
          </>
        )}
      </main>
    </div>
  );
}
