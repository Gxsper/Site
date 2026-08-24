'use client';

/**
 * Chart auf Basis von lightweight-charts v5 (PROJECT_SPEC.md §5.5).
 *
 * Die v5-API weicht von v4 ab; verifiziert gegen die lokalen Typings in
 * node_modules/lightweight-charts/dist/typings.d.ts:
 *   - `chart.addSeries(LineSeries, opts)` statt `chart.addLineSeries(opts)`
 *   - Marker nur über `createSeriesMarkers`; `series.setMarkers()` existiert nicht
 *   - Log-Achse über `priceScale().applyOptions({ mode: PriceScaleMode.Logarithmic })`
 *
 * Für §11 entscheidend: eine Lücke wird als **Whitespace-Punkt** übergeben —
 * ein Objekt mit `time`, aber ohne `value`. lightweight-charts unterbricht die
 * Linie dort. Interpoliert wird nichts, und 0 wird nie eingesetzt.
 *
 * Attribution: `attributionLogo` bleibt an. Das ist Lizenzpflicht (§15).
 */

import { useEffect, useRef } from 'react';
import {
  createChart,
  LineSeries,
  PriceScaleMode,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type UTCTimestamp,
  type WhitespaceData,
} from 'lightweight-charts';

export interface ChartLayer {
  id: string;
  label: string;
  color: string;
  axis: 'left' | 'right';
  values: (number | null)[];
}

interface OverlayChartProps {
  t: number[];
  layers: ChartLayer[];
  logScale: boolean;
  height?: number;
}

/** Wandelt eine Wertereihe in Chart-Daten. `null` wird zu einem Whitespace-Punkt. */
function toChartData(t: number[], values: (number | null)[]): (LineData | WhitespaceData)[] {
  const out: (LineData | WhitespaceData)[] = [];

  for (let i = 0; i < t.length; i++) {
    const time = t[i]! as UTCTimestamp;
    const value = values[i] ?? null;
    out.push(value === null ? { time } : { time, value });
  }

  return out;
}

export function OverlayChart({ t, layers, logScale, height = 460 }: OverlayChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());

  // Chart einmal aufbauen und bei Unmount wieder abräumen.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { color: 'transparent' },
        textColor: '#a1a1a1',
        // Lizenzpflicht — nicht abschalten (§15).
        attributionLogo: true,
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.05)' },
        horzLines: { color: 'rgba(255,255,255,0.05)' },
      },
      rightPriceScale: { visible: true, borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.15 } },
      leftPriceScale: { visible: true, borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.15 } },
      timeScale: { timeVisible: false, secondsVisible: false, borderVisible: false },
      crosshair: { mode: 1 },
    });

    chartRef.current = chart;

    // Referenz in eine lokale Variable kopieren: beim Aufräumen zeigt
    // seriesRef.current möglicherweise schon woanders hin.
    const series = seriesRef.current;

    return () => {
      chart.remove();
      chartRef.current = null;
      series.clear();
    };
  }, []);

  // Serien abgleichen: neue anlegen, verschwundene entfernen, Daten neu setzen.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const wanted = new Set(layers.map((l) => l.id));

    for (const [id, series] of seriesRef.current.entries()) {
      if (!wanted.has(id)) {
        chart.removeSeries(series);
        seriesRef.current.delete(id);
      }
    }

    for (const layer of layers) {
      let series = seriesRef.current.get(layer.id);

      // Die Achse steckt in den Serien-Optionen und lässt sich nicht nachträglich
      // umhängen — bei Wechsel wird die Serie neu angelegt.
      if (series && series.options().priceScaleId !== layer.axis) {
        chart.removeSeries(series);
        seriesRef.current.delete(layer.id);
        series = undefined;
      }

      if (!series) {
        series = chart.addSeries(LineSeries, {
          priceScaleId: layer.axis,
          color: layer.color,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          // Kein `title`: die Beschriftung übernimmt die Legende der Seite,
          // sonst steht jeder Name doppelt im Chart.
        });
        seriesRef.current.set(layer.id, series);
      } else {
        series.applyOptions({ color: layer.color });
      }

      // setData bei jedem Wechsel neu — update() ist nur für den letzten
      // Live-Punkt gedacht (§5.5).
      series.setData(toChartData(t, layer.values));
    }

    if (layers.length > 0) chart.timeScale().fitContent();
  }, [t, layers]);

  // Log-Skala getrennt schalten, damit ein Toggle keine Daten neu setzt.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const mode = logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal;
    chart.priceScale('left').applyOptions({ mode });
    chart.priceScale('right').applyOptions({ mode });
  }, [logScale, layers]);

  return <div ref={containerRef} style={{ height }} className="w-full" />;
}
