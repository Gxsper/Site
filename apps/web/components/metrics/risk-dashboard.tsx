'use client';

/**
 * Risk-Metric-Dashboard (PROJECT_SPEC.md §6.1, §6.2, §13 Phase 4).
 *
 * Oben Preis mit den logarithmischen Regressionsbändern, darunter die Risk
 * Metric von 0 bis 1. Jede Kennzahl trägt ihren Methodik-Text — §14 verlangt
 * ihn sichtbar, nicht nur im Repo.
 */

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { FearGreedStrip } from '@/components/metrics/fear-greed-strip';
import { OverlayChart, type ChartLayer } from '@/components/overlay/overlay-chart';
import type { SeriesPoint } from '@/lib/series/types';
import { cn } from '@/lib/utils';

interface RiskResponse {
  points: SeriesPoint[];
  variant: 'full' | 'expanding';
  methodology: string;
}

interface LogRegResponse {
  price: SeriesPoint[];
  bands: { quantile: number; points: SeriesPoint[] }[];
  fit: { a: number; b: number; r2: number; n: number };
  methodology: string;
}

interface DrawdownResponse {
  underwater: SeriesPoint[];
  maxDrawdownPct: number;
  maxDrawdownAt: number | null;
  peakAt: number | null;
  methodology: string;
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      body && typeof body === 'object' && typeof (body as Record<string, unknown>)['error'] === 'string'
        ? String((body as Record<string, unknown>)['error'])
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

/** Farbverlauf blau → rot über den Risikobereich (§6.1). */
function riskColor(value: number): string {
  const clamped = Math.min(1, Math.max(0, value));
  const hue = 220 - clamped * 220; // 220° blau → 0° rot
  return `hsl(${hue} 75% 55%)`;
}

const BAND_COLORS: Record<string, string> = {
  '0.01': 'rgba(74,163,223,0.55)',
  '0.05': 'rgba(74,163,223,0.75)',
  '0.25': 'rgba(126,211,33,0.6)',
  '0.5': 'rgba(200,200,200,0.9)',
  '0.75': 'rgba(246,200,95,0.7)',
  '0.95': 'rgba(225,87,89,0.75)',
  '0.99': 'rgba(225,87,89,0.55)',
};

function Methodology({ text }: { text: string }) {
  return (
    <details className="border-border mt-2 border-t pt-2">
      <summary className="text-muted-foreground cursor-pointer text-[10px] select-none">
        Methodik
      </summary>
      <p className="text-muted-foreground mt-1.5 text-[10px] leading-relaxed">{text}</p>
    </details>
  );
}

export function RiskDashboard() {
  const [variant, setVariant] = useState<'full' | 'expanding'>('expanding');

  const logregQuery = useQuery({
    queryKey: ['metrics', 'logreg'],
    queryFn: ({ signal }) => getJson<LogRegResponse>('/api/metrics?metric=logreg', signal),
    staleTime: 60 * 60_000,
  });

  const riskQuery = useQuery({
    queryKey: ['metrics', 'risk', variant],
    queryFn: ({ signal }) => getJson<RiskResponse>(`/api/metrics?metric=risk&variant=${variant}`, signal),
    staleTime: 60 * 60_000,
  });

  const drawdownQuery = useQuery({
    queryKey: ['metrics', 'drawdown'],
    queryFn: ({ signal }) => getJson<DrawdownResponse>('/api/metrics?metric=drawdown', signal),
    staleTime: 60 * 60_000,
  });

  const priceLayers: ChartLayer[] = logregQuery.data
    ? [
        ...logregQuery.data.bands.map((band) => ({
          id: `band-${band.quantile}`,
          label: `q${band.quantile}`,
          color: BAND_COLORS[String(band.quantile)] ?? 'rgba(150,150,150,0.5)',
          axis: 'right' as const,
          values: band.points.map((p) => p.v),
        })),
        {
          id: 'price',
          label: 'BTC (USD)',
          color: '#f7931a',
          axis: 'right' as const,
          values: logregQuery.data.price.map((p) => p.v),
        },
      ]
    : [];

  const riskLayers: ChartLayer[] = riskQuery.data
    ? [
        {
          id: 'risk',
          label: `Risk Metric (${riskQuery.data.variant})`,
          color: '#7ed321',
          axis: 'right',
          values: riskQuery.data.points.map((p) => p.v),
        },
      ]
    : [];

  const latestRisk = riskQuery.data?.points.at(-1) ?? null;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-border flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5">
        <Link href="/" className="text-sm font-semibold tracking-tight hover:underline">
          MacroDeck
        </Link>
        <span className="text-muted-foreground text-[10px]">Risk-Dashboard</span>

        <nav className="ml-6 flex gap-3 text-[11px]">
          <Link href="/" className="hover:underline">
            Overlay-Studio
          </Link>
          <Link href="/macro" className="hover:underline">
            Makro
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-1 text-[11px]">
          <span className="text-muted-foreground">Variante</span>
          {(['expanding', 'full'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setVariant(option)}
              title={
                option === 'expanding'
                  ? 'Nur Daten bis zum jeweiligen Punkt — kein Look-ahead'
                  : 'Skalierung über die gesamte Historie — rückwirkend nicht stabil'
              }
              className={cn(
                'border-border rounded border px-1.5 py-0.5',
                variant === option ? 'bg-primary text-primary-foreground border-transparent' : 'hover:bg-accent',
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </header>

      <main className="flex flex-col gap-3 p-3">
        <section className="border-border bg-card/30 rounded-md border p-3">
          <div className="mb-2 flex flex-wrap items-baseline gap-x-4">
            <h2 className="text-xs font-semibold">
              Bitcoin mit logarithmischen Regressionsbändern
            </h2>
            {logregQuery.data && (
              <span className="text-muted-foreground text-[10px] tabular-nums">
                R² = {logregQuery.data.fit.r2.toFixed(4)} · n ={' '}
                {logregQuery.data.fit.n.toLocaleString('de-DE')}
              </span>
            )}
          </div>

          {logregQuery.isPending && (
            <p className="text-muted-foreground py-16 text-center text-xs">
              Regression wird gerechnet…
            </p>
          )}
          {logregQuery.isError && (
            <p className="text-destructive py-16 text-center text-xs">
              Bänder nicht berechenbar: {logregQuery.error.message}
            </p>
          )}
          {logregQuery.data && (
            <>
              <OverlayChart
                t={logregQuery.data.price.map((p) => p.t)}
                layers={priceLayers}
                logScale
                height={380}
              />
              <Methodology text={logregQuery.data.methodology} />
            </>
          )}
        </section>

        <section className="border-border bg-card/30 rounded-md border p-3">
          <div className="mb-2 flex flex-wrap items-baseline gap-x-4">
            <h2 className="text-xs font-semibold">Risk Metric</h2>
            {latestRisk && (
              <span
                className="rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-black"
                style={{ backgroundColor: riskColor(latestRisk.v) }}
              >
                aktuell {latestRisk.v.toFixed(3)}
              </span>
            )}
            {latestRisk && (
              <span className="text-muted-foreground text-[10px]">
                Stand {new Date(latestRisk.t * 1000).toISOString().slice(0, 10)}
              </span>
            )}
          </div>

          {riskQuery.isPending && (
            <p className="text-muted-foreground py-12 text-center text-xs">
              Risk Metric wird gerechnet…
            </p>
          )}
          {riskQuery.isError && (
            <p className="text-destructive py-12 text-center text-xs">
              Nicht berechenbar: {riskQuery.error.message}
            </p>
          )}
          {riskQuery.data && (
            <>
              <OverlayChart
                t={riskQuery.data.points.map((p) => p.t)}
                layers={riskLayers}
                logScale={false}
                height={200}
              />
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-muted-foreground text-[10px]">0 niedrig</span>
                <div
                  className="h-1.5 flex-1 rounded"
                  style={{
                    background: `linear-gradient(to right, ${riskColor(0)}, ${riskColor(0.5)}, ${riskColor(1)})`,
                  }}
                  aria-hidden
                />
                <span className="text-muted-foreground text-[10px]">1 hoch</span>
              </div>
              <Methodology text={riskQuery.data.methodology} />
            </>
          )}
        </section>

        <FearGreedStrip />

        <section className="border-border bg-card/30 rounded-md border p-3">
          <h2 className="mb-2 text-xs font-semibold">Maximum Drawdown</h2>
          {drawdownQuery.isError && (
            <p className="text-destructive text-xs">
              Nicht berechenbar: {drawdownQuery.error.message}
            </p>
          )}
          {drawdownQuery.data && (
            <>
              <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground text-[10px]">tiefster Stand</dt>
                  <dd className="tabular-nums">
                    {drawdownQuery.data.maxDrawdownPct.toFixed(1)} %
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-[10px]">erreicht am</dt>
                  <dd className="tabular-nums">
                    {drawdownQuery.data.maxDrawdownAt
                      ? new Date(drawdownQuery.data.maxDrawdownAt * 1000).toISOString().slice(0, 10)
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-[10px]">vorheriges Hoch</dt>
                  <dd className="tabular-nums">
                    {drawdownQuery.data.peakAt
                      ? new Date(drawdownQuery.data.peakAt * 1000).toISOString().slice(0, 10)
                      : '—'}
                  </dd>
                </div>
              </dl>
              <div className="mt-2">
                <OverlayChart
                  t={drawdownQuery.data.underwater.map((p) => p.t)}
                  layers={[
                    {
                      id: 'underwater',
                      label: 'Underwater (%)',
                      color: '#e15759',
                      axis: 'right',
                      values: drawdownQuery.data.underwater.map((p) => p.v),
                    },
                  ]}
                  logScale={false}
                  height={160}
                />
              </div>
              <Methodology text={drawdownQuery.data.methodology} />
            </>
          )}
        </section>
      </main>

      <footer className="border-border text-muted-foreground border-t px-4 py-2 text-[10px]">
        Daten: Coin Metrics Community API · Charts: TradingView Lightweight Charts ·
        Keine Anlageberatung.
      </footer>
    </div>
  );
}
