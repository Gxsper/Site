'use client';

/**
 * Derivate-Seite (PROJECT_SPEC.md §7).
 *
 * Kein Coinglass-Abo vorhanden — also Eigen-Ingest (§4.4). Das hat Folgen, die
 * hier sichtbar gemacht statt kaschiert werden:
 *
 *  - Das Liquidations-Tape ist **echt**, beginnt aber mit dem ersten Start des
 *    Workers. Ein leerer Zeitraum davor heißt „nicht aufgezeichnet", nicht
 *    „ruhiger Markt" — deshalb steht der Aufzeichnungsbeginn immer dabei.
 *  - Open Interest und Long/Short liefert Binance nur 31 Tage zurück.
 *  - Das Liquidations-Cluster zeigt **eingetretene** Liquidationen als
 *    Preis-Zeit-Matrix. Es ist ausdrücklich keine Heatmap erwarteter
 *    Liquidationslevel: die wäre ein Modell aus Open Interest und angenommener
 *    Leverage-Verteilung, und §4.4 verlangt, so etwas nicht als Messung
 *    auszugeben. Hier steht Vergangenheit, dort stünde eine Vermutung.
 */

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { LiquidationCluster } from '@/components/derivatives/liquidation-cluster';
import { OverlayChart, type ChartLayer } from '@/components/overlay/overlay-chart';
import { fetchSeries } from '@/lib/api-client';
import type { Cluster } from '@/lib/derivatives/cluster';

const DAY = 86_400;

interface LiquidationEvent {
  exchange: string;
  symbol: string;
  side: 'long' | 'short';
  price: number;
  qty: number;
  quoteQty: number;
  t: number;
}

interface LiquidationsResponse {
  symbol: string;
  tape: LiquidationEvent[];
  buckets: { t: number; side: 'long' | 'short'; total: number; count: number }[];
  cluster: Cluster;
  coverage: {
    recordingFrom: number | null;
    lastEventAt: number | null;
    totalEvents: number;
    hinweis: string;
  };
  meta: { since: number; bucket: number; hours: number; priceBuckets: number };
}

async function getLiquidations(signal: AbortSignal): Promise<LiquidationsResponse> {
  const response = await fetch('/api/liquidations?symbol=BTCUSDT&hours=24&bucket=300', { signal });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      body && typeof body === 'object' && typeof (body as Record<string, unknown>)['error'] === 'string'
        ? String((body as Record<string, unknown>)['error'])
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return response.json() as Promise<LiquidationsResponse>;
}

function formatUsd(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)} Mrd`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)} Mio`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)} Tsd`;
  return value.toFixed(0);
}

function formatTime(t: number): string {
  return new Date(t * 1000).toISOString().slice(11, 19);
}

export function DerivativesDashboard() {
  const to = Math.floor(Date.now() / 1000);
  const from = to - 60 * DAY;

  const liquidations = useQuery({
    queryKey: ['liquidations'],
    queryFn: ({ signal }) => getLiquidations(signal),
    // Der Worker schreibt laufend — häufiger nachfragen als sonst.
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const derivatives = useQuery({
    queryKey: ['derivatives', from, to],
    queryFn: ({ signal }) =>
      fetchSeries(
        `ids=deriv.btc.oi_usd,deriv.btc.funding,deriv.btc.long_short&from=${from}&to=${to}` +
          `&align=union_ffill&norm=raw&raw=0`,
        signal,
      ),
    staleTime: 30 * 60_000,
  });

  const oiLayers: ChartLayer[] = derivatives.data
    ? derivatives.data.aligned.ids.map((id, index) => ({
        id,
        label: ['Open Interest (USD)', 'Funding Rate', 'Long/Short'][index] ?? id,
        color: ['#4aa3df', '#f6c85f', '#7ed321'][index] ?? '#999',
        axis: index === 0 ? ('right' as const) : ('left' as const),
        values: derivatives.data?.aligned.values[index] ?? [],
      }))
    : [];

  // Balken je Intervall, Long und Short getrennt.
  const bucketMap = new Map<number, { long: number; short: number }>();
  for (const bucket of liquidations.data?.buckets ?? []) {
    const entry = bucketMap.get(bucket.t) ?? { long: 0, short: 0 };
    entry[bucket.side] = bucket.total;
    bucketMap.set(bucket.t, entry);
  }
  const bars = [...bucketMap.entries()].sort((a, b) => a[0] - b[0]);
  const maxBar = bars.reduce((max, [, v]) => Math.max(max, v.long, v.short), 0);

  const totals = (liquidations.data?.buckets ?? []).reduce(
    (acc, b) => {
      acc[b.side] += b.total;
      acc.count += b.count;
      return acc;
    },
    { long: 0, short: 0, count: 0 },
  );

  const coverage = liquidations.data?.coverage;
  const cluster = liquidations.data?.cluster;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-border flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5">
        <Link href="/" className="text-sm font-semibold tracking-tight hover:underline">
          MacroDeck
        </Link>
        <span className="text-muted-foreground text-[10px]">Derivate</span>
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
        </nav>
      </header>

      <main className="flex flex-col gap-3 p-3">
        {/* §11: der Aufzeichnungsbeginn gehört sichtbar dazu. */}
        <section className="border-border bg-card/30 rounded-md border p-3">
          <div className="mb-2 flex flex-wrap items-baseline gap-x-4">
            <h2 className="text-xs font-semibold">Liquidationen BTCUSDT · letzte 24 Stunden</h2>
            {coverage && (
              <span className="text-muted-foreground text-[10px]">
                {coverage.recordingFrom
                  ? `Aufzeichnung seit ${new Date(coverage.recordingFrom * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC · ${coverage.totalEvents.toLocaleString('de-DE')} Ereignisse`
                  : 'noch keine Aufzeichnung'}
              </span>
            )}
          </div>

          {liquidations.isError && (
            <p className="text-destructive text-xs">{liquidations.error.message}</p>
          )}

          {coverage && coverage.totalEvents === 0 && (
            <div className="border-border rounded-md border border-dashed p-4">
              <p className="text-muted-foreground text-xs">{coverage.hinweis}</p>
              <p className="text-muted-foreground mt-2 text-[10px]">
                Start mit <code className="bg-accent rounded px-1">npm run worker</code>. Es
                werden keine früheren Ereignisse rekonstruiert — die Reihe beginnt bei null.
              </p>
            </div>
          )}

          {liquidations.data && totals.count > 0 && (
            <>
              <dl className="mb-3 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-muted-foreground text-[10px]">Longs liquidiert</dt>
                  <dd className="tabular-nums" style={{ color: '#e15759' }}>
                    {formatUsd(totals.long)} USD
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-[10px]">Shorts liquidiert</dt>
                  <dd className="tabular-nums" style={{ color: '#7ed321' }}>
                    {formatUsd(totals.short)} USD
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-[10px]">Ereignisse</dt>
                  <dd className="tabular-nums">{totals.count.toLocaleString('de-DE')}</dd>
                </div>
              </dl>

              {/* Balken je 5 Minuten, Longs nach oben, Shorts nach unten. */}
              <div className="flex h-24 items-center gap-px">
                {bars.map(([t, value]) => (
                  <div key={t} className="flex h-full flex-1 flex-col justify-center">
                    <div className="flex h-1/2 items-end">
                      <div
                        className="w-full"
                        style={{
                          height: maxBar > 0 ? `${(value.long / maxBar) * 100}%` : '0%',
                          backgroundColor: '#e15759',
                        }}
                        title={`${formatTime(t)} — Longs: ${formatUsd(value.long)} USD`}
                      />
                    </div>
                    <div className="flex h-1/2 items-start">
                      <div
                        className="w-full"
                        style={{
                          height: maxBar > 0 ? `${(value.short / maxBar) * 100}%` : '0%',
                          backgroundColor: '#7ed321',
                        }}
                        title={`${formatTime(t)} — Shorts: ${formatUsd(value.short)} USD`}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground mt-1 text-[10px]">
                oben Longs, unten Shorts · ein Balken je 5 Minuten
              </p>
            </>
          )}
        </section>

        {/* Live-Tape */}
        {liquidations.data && liquidations.data.tape.length > 0 && (
          <section className="border-border bg-card/30 rounded-md border p-3">
            <h2 className="mb-2 text-xs font-semibold">Tape · jüngste Ereignisse</h2>
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-[11px] tabular-nums">
                <thead className="text-muted-foreground sticky top-0 bg-[var(--color-card)] text-left text-[10px]">
                  <tr>
                    <th className="py-1 pr-2 font-medium">Zeit (UTC)</th>
                    <th className="py-1 pr-2 font-medium">Börse</th>
                    <th className="py-1 pr-2 font-medium">Seite</th>
                    <th className="py-1 pr-2 text-right font-medium">Preis</th>
                    <th className="py-1 pr-2 text-right font-medium">Menge</th>
                    <th className="py-1 text-right font-medium">Wert USD</th>
                  </tr>
                </thead>
                <tbody>
                  {liquidations.data.tape.map((event, index) => (
                    <tr key={`${event.t}-${event.exchange}-${index}`} className="border-border/50 border-t">
                      <td className="py-0.5 pr-2">{formatTime(event.t)}</td>
                      <td className="py-0.5 pr-2">{event.exchange}</td>
                      <td
                        className="py-0.5 pr-2"
                        style={{ color: event.side === 'long' ? '#e15759' : '#7ed321' }}
                      >
                        {event.side === 'long' ? 'Long' : 'Short'}
                      </td>
                      <td className="py-0.5 pr-2 text-right">{event.price.toLocaleString('de-DE')}</td>
                      <td className="py-0.5 pr-2 text-right">{event.qty}</td>
                      <td className="py-0.5 text-right">{formatUsd(event.quoteQty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Open Interest, Funding, Long/Short */}
        <section className="border-border bg-card/30 rounded-md border p-3">
          <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
            <h2 className="text-xs font-semibold">Open Interest, Funding und Long/Short</h2>
            <span className="text-muted-foreground text-[10px]">
              Binance liefert OI und Long/Short nur 31 Tage zurück
            </span>
            <div className="ml-auto flex flex-wrap gap-x-3">
              {oiLayers.map((layer) => (
                <span key={layer.id} className="flex items-center gap-1 text-[10px]">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: layer.color }}
                    aria-hidden
                  />
                  {layer.label}
                </span>
              ))}
            </div>
          </div>

          {derivatives.isPending && (
            <p className="text-muted-foreground py-12 text-center text-xs">Daten werden geladen…</p>
          )}
          {derivatives.isError && (
            <p className="text-destructive py-12 text-center text-xs">
              {derivatives.error.message}
            </p>
          )}
          {derivatives.data?.errors.map((error) => (
            <p key={error.id} className="text-destructive mb-2 text-[11px]">
              <span className="font-mono">{error.id}</span>: {error.message}
            </p>
          ))}
          {derivatives.data && derivatives.data.aligned.t.length > 0 && (
            <OverlayChart t={derivatives.data.aligned.t} layers={oiLayers} logScale={false} height={280} />
          )}
        </section>

        {/* §7: Cluster der eingetretenen Liquidationen — Messung, keine Prognose. */}
        <section className="border-border bg-card/30 rounded-md border p-3">
          <div className="mb-2 flex flex-wrap items-baseline gap-x-4">
            <h2 className="text-xs font-semibold">Liquidations-Cluster</h2>
            <span className="text-muted-foreground text-[10px]">
              tatsächlich eingetretene Liquidationen nach Preisniveau und Zeit
            </span>
            {cluster?.priceRange && (
              <span className="text-muted-foreground text-[10px] tabular-nums">
                Preisspanne {cluster.priceRange.min.toFixed(2)} – {cluster.priceRange.max.toFixed(2)} USD
              </span>
            )}
          </div>

          {cluster && cluster.cells.length > 0 ? (
            <>
              <LiquidationCluster
                cluster={cluster}
                bucketSeconds={liquidations.data?.meta.bucket ?? 300}
              />
              <p className="text-muted-foreground mt-1 text-[10px] leading-relaxed">
                Jede Zelle ist eine Messung aus dem eigenen Ingest: wie viel USD an diesem
                Preisniveau in diesem Zeitfenster wirklich liquidiert wurde. Leere Flächen
                heißen &bdquo;hier ist nichts eingetreten&ldquo; — sie werden nicht mit 0 gefüllt.
                Farbskala logarithmisch, sonst erdrückt ein einzelner Ausschlag alles andere.
              </p>
            </>
          ) : (
            <div className="border-border rounded-md border border-dashed p-4">
              <p className="text-muted-foreground text-xs">
                Noch zu wenige Ereignisse für ein Cluster. Der Ingest zeichnet ab seinem
                ersten Start auf; aussagekräftig wird die Darstellung nach einigen Tagen.
              </p>
            </div>
          )}

          <p className="text-muted-foreground border-border mt-2 border-t pt-2 text-[10px] leading-relaxed">
            <span className="text-foreground font-medium">Nicht zu verwechseln</span> mit einer
            Heatmap erwarteter Liquidationslevel, wie Coinglass sie zeigt. Die wäre ein Modell
            aus Open Interest und angenommener Leverage-Verteilung — eine Vermutung über die
            Zukunft, die wie eine Beobachtung aussieht. §4.4 verlangt, so etwas nicht als
            Messung auszugeben. Hier steht ausschließlich, was gemessen wurde.
          </p>
        </section>
      </main>

      <footer className="border-border text-muted-foreground border-t px-4 py-2 text-[10px]">
        Liquidationen: eigener WebSocket-Ingest von Binance, Bybit und OKX · Derivatedaten:
        Binance Futures · Charts: TradingView Lightweight Charts · Keine Anlageberatung.
      </footer>
    </div>
  );
}
