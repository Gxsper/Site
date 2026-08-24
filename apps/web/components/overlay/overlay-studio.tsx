'use client';

/**
 * Overlay-Studio — die Startseite (PROJECT_SPEC.md §9).
 *
 * Links Serien-Browser, Mitte Chart, rechts Layer-Panel. Der Zustand steht in
 * der URL und ist damit teilbar (§9); der Store hält die Arbeitskopie.
 *
 * Die Fehlerzustände aus §11 sind hier verdrahtet:
 *  - Quelle nicht erreichbar → Banner mit Serien-ID und Grund, die übrigen
 *    Serien rendern normal
 *  - Cache-Wert → sichtbares Stale-Badge im Layer-Panel mit Alter
 *  - Datenlücke → unterbrochene Linie (Whitespace-Punkte im Chart)
 *  - Serie beginnt später → Linie startet später, kein Auffüllen
 */

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef } from 'react';

import { CorrelationPanel } from '@/components/overlay/correlation-panel';
import { LayerPanel } from '@/components/overlay/layer-panel';
import { OverlayChart, type ChartLayer } from '@/components/overlay/overlay-chart';
import { SeriesBrowser } from '@/components/overlay/series-browser';
import { fetchCatalog, fetchSeries, type CatalogEntry } from '@/lib/api-client';
import { MAX_LAYERS, useOverlayStore } from '@/lib/store/overlay-store';
import { allowsLogScale, type NormMode } from '@/lib/series/normalize';
import type { AlignMode } from '@/lib/series/align';
import {
  buildSeriesQuery,
  colorForIndex,
  decodeState,
  encodeState,
  RANGE_PRESETS,
  type RangePresetId,
} from '@/lib/url-state';
import { cn } from '@/lib/utils';

const NORM_LABELS: Record<NormMode, string> = {
  raw: 'Original',
  rebase100: 'Rebase 100',
  pct_change: '% seit Start',
  zscore: 'z-Score',
  minmax: 'Min-Max',
  log_returns: 'Log-Returns',
  yoy: 'ggü. Vorjahr',
};

const ALIGN_LABELS: Record<AlignMode, string> = {
  union_ffill: 'Vereinigung + Fill',
  intersection: 'Schnittmenge',
  trading_days: 'Handelstage',
  native: 'nativ',
};

export function OverlayStudio() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const state = useOverlayStore();
  const hydrated = useRef(false);

  // Einmalig aus der URL hydrieren — danach ist der Store führend.
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const params = new URLSearchParams(searchParams.toString());
    if (params.has('s')) state.replaceAll(decodeState(params));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Store → URL spiegeln, damit der Link jederzeit teilbar ist.
  const encoded = useMemo(
    () =>
      encodeState({
        layers: state.layers,
        norm: state.norm,
        align: state.align,
        from: state.from,
        to: state.to,
        logScale: state.logScale,
        corr: state.corr,
      }).toString(),
    [state.layers, state.norm, state.align, state.from, state.to, state.logScale, state.corr],
  );

  useEffect(() => {
    if (!hydrated.current) return;
    router.replace(encoded ? `/?${encoded}` : '/', { scroll: false });
  }, [encoded, router]);

  const catalogQuery = useQuery({
    queryKey: ['catalog'],
    queryFn: ({ signal }) => fetchCatalog(signal),
    staleTime: 60 * 60_000,
  });

  const seriesQueryString = useMemo(
    () =>
      buildSeriesQuery({
        layers: state.layers,
        norm: state.norm,
        align: state.align,
        from: state.from,
        to: state.to,
        logScale: state.logScale,
        corr: state.corr,
      }),
    [state.layers, state.norm, state.align, state.from, state.to, state.corr, state.logScale],
  );

  const seriesQuery = useQuery({
    queryKey: ['series', seriesQueryString],
    queryFn: ({ signal }) => fetchSeries(seriesQueryString, signal),
    enabled: seriesQueryString !== '',
  });

  const descriptorsById = useMemo(() => {
    const map = new Map<string, CatalogEntry>();
    for (const entry of catalogQuery.data?.series ?? []) map.set(entry.id, entry);
    return map;
  }, [catalogQuery.data]);

  const visibleLayers = state.layers.filter((l) => l.visible);

  const chartLayers: ChartLayer[] = useMemo(() => {
    const aligned = seriesQuery.data?.aligned;
    if (!aligned) return [];

    return visibleLayers.flatMap((layer) => {
      const position = aligned.ids.findIndex((id) => id.startsWith(layer.id));
      if (position < 0) return [];
      return [
        {
          id: layer.id,
          label: aligned.ids[position]!,
          color: colorForIndex(state.layers.findIndex((l) => l.id === layer.id)),
          axis: layer.axis,
          values: aligned.values[position] ?? [],
        },
      ];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesQuery.data, state.layers]);

  const layerRows = state.layers.map((layer, index) => {
    const response = seriesQuery.data?.series.find((s) => s.descriptor.id === layer.id);
    return {
      layer,
      descriptor: descriptorsById.get(layer.id),
      color: colorForIndex(index),
      stale: response?.stale ?? false,
      lastUpdated: response?.lastUpdated,
      pointCount: response?.pointCount,
    };
  });

  const logDisabled = !allowsLogScale(state.norm);
  const errors = seriesQuery.data?.errors ?? [];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-border flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5">
        <h1 className="text-sm font-semibold tracking-tight">MacroDeck</h1>
        <span className="text-muted-foreground text-[10px]">Overlay-Studio</span>

        <nav className="ml-6 flex gap-3 text-[11px]">
          <Link href="/macro" className="hover:underline">
            Makro
          </Link>
          <Link href="/risk" className="hover:underline">
            Risk
          </Link>
        </nav>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-0.5">
            {RANGE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => state.applyPreset(preset.id as RangePresetId)}
                className="hover:bg-accent rounded px-1.5 py-0.5 text-[11px]"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-1 text-[11px]">
            <span className="text-muted-foreground">Norm</span>
            <select
              value={state.norm}
              onChange={(event) => state.setNorm(event.target.value as NormMode)}
              className="border-border bg-background rounded border px-1 py-0.5 text-[11px]"
            >
              {Object.entries(NORM_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1 text-[11px]">
            <span className="text-muted-foreground">Align</span>
            <select
              value={state.align}
              onChange={(event) => state.setAlign(event.target.value as AlignMode)}
              className="border-border bg-background rounded border px-1 py-0.5 text-[11px]"
            >
              {Object.entries(ALIGN_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={state.toggleLog}
            disabled={logDisabled}
            title={
              logDisabled
                ? `Log-Skala bei „${NORM_LABELS[state.norm]}" nicht möglich — Werte ≤ 0 sind erlaubt (§5.2)`
                : 'Logarithmische Preisachse'
            }
            className={cn(
              'rounded px-1.5 py-0.5 text-[11px] disabled:opacity-40',
              state.logScale && !logDisabled ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
            )}
          >
            log
          </button>

          <label className="flex items-center gap-1 text-[11px]">
            <span className="text-muted-foreground">Korr.</span>
            <select
              value={state.corr}
              onChange={(event) => state.setCorr(Number.parseInt(event.target.value, 10))}
              disabled={visibleLayers.length !== 2}
              title={
                visibleLayers.length !== 2
                  ? 'Korrelation braucht genau zwei sichtbare Serien'
                  : 'Fenster der rollierenden Korrelation'
              }
              className="border-border bg-background rounded border px-1 py-0.5 text-[11px] disabled:opacity-40"
            >
              <option value={0}>aus</option>
              <option value={30}>30d</option>
              <option value={90}>90d</option>
              <option value={365}>365d</option>
            </select>
          </label>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_280px]">
        <aside className="border-border overflow-hidden border-r p-3 lg:h-[calc(100vh-49px)]">
          {catalogQuery.isPending && (
            <p className="text-muted-foreground text-xs">Katalog wird geladen…</p>
          )}
          {catalogQuery.isError && (
            <p className="text-destructive text-xs">
              Katalog nicht abrufbar: {catalogQuery.error.message}
            </p>
          )}
          {catalogQuery.data && (
            <SeriesBrowser
              catalog={catalogQuery.data.series}
              activeIds={state.layers.map((l) => l.id)}
              onAdd={state.addLayer}
              onRemove={state.removeLayer}
              disabled={state.layers.length >= MAX_LAYERS}
            />
          )}
        </aside>

        <main className="flex min-w-0 flex-col gap-3 p-3">
          {/* §11: Quelle nicht erreichbar → Banner, andere Serien rendern normal. */}
          {errors.length > 0 && (
            <div className="border-destructive/40 bg-destructive/10 rounded-md border px-3 py-2">
              <p className="text-destructive text-xs font-medium">
                {errors.length === 1 ? 'Eine Quelle meldet ein Problem' : `${errors.length} Quellen melden Probleme`}
              </p>
              <ul className="mt-1 space-y-0.5">
                {errors.map((error) => (
                  <li key={error.id} className="text-destructive/90 text-[11px]">
                    <span className="font-mono">{error.id}</span>: {error.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {seriesQuery.isError && (
            <div className="border-destructive/40 bg-destructive/10 rounded-md border px-3 py-2">
              <p className="text-destructive text-xs">{seriesQuery.error.message}</p>
            </div>
          )}

          <div className="border-border bg-card/30 relative rounded-md border">
            {state.layers.length === 0 ? (
              <div className="flex h-[460px] items-center justify-center">
                <p className="text-muted-foreground text-xs">
                  Links eine Serie auswählen, um zu beginnen.
                </p>
              </div>
            ) : seriesQuery.isPending ? (
              <div className="flex h-[460px] items-center justify-center">
                <p className="text-muted-foreground text-xs">Daten werden geladen…</p>
              </div>
            ) : (
              <>
                <div className="pointer-events-none absolute top-2 left-3 z-10 space-y-0.5">
                  {chartLayers.map((layer) => (
                    <div key={layer.id} className="flex items-center gap-1.5 text-[11px]">
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: layer.color }}
                        aria-hidden
                      />
                      <span>{layer.label}</span>
                    </div>
                  ))}
                </div>
                <OverlayChart t={seriesQuery.data?.aligned.t ?? []} layers={chartLayers} logScale={state.logScale && !logDisabled} />
              </>
            )}
          </div>

          {seriesQuery.data?.correlation && chartLayers.length === 2 && (
            <CorrelationPanel
              correlation={seriesQuery.data.correlation}
              labels={[chartLayers[0]!.label, chartLayers[1]!.label]}
            />
          )}

          {seriesQuery.data && (
            <p className="text-muted-foreground text-[10px]">
              {seriesQuery.data.meta.gridPoints.toLocaleString('de-DE')} Rasterpunkte ·{' '}
              {ALIGN_LABELS[seriesQuery.data.meta.align as AlignMode]} ·{' '}
              {NORM_LABELS[seriesQuery.data.meta.norm as NormMode]}
            </p>
          )}
        </main>

        <aside className="border-border overflow-y-auto border-l p-3 lg:h-[calc(100vh-49px)]">
          <h2 className="text-muted-foreground mb-2 text-[10px] font-semibold tracking-wider uppercase">
            Ebenen
          </h2>
          <LayerPanel rows={layerRows} onUpdate={state.updateLayer} onRemove={state.removeLayer} />
        </aside>
      </div>

      {/* Attribution-Leiste — Lizenzpflicht nach §15. */}
      <footer className="border-border text-muted-foreground border-t px-4 py-2 text-[10px]">
        {catalogQuery.data?.attributions.join(' · ')}
        {catalogQuery.data && ' · '}
        Charts: TradingView Lightweight Charts · Keine Anlageberatung.
      </footer>
    </div>
  );
}
