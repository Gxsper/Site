'use client';

/**
 * Liquidations-Cluster (PROJECT_SPEC.md §7).
 *
 * ══ Was das ist — und was es ausdrücklich nicht ist ══
 *
 * Gezeigt werden die **tatsächlich eingetretenen** Liquidationen als
 * Preis-Zeit-Matrix: wie viel USD an welchem Preisniveau zu welcher Zeit
 * wirklich liquidiert wurde. Jede Zelle ist eine Messung aus dem eigenen
 * WebSocket-Ingest.
 *
 * Das ist **keine** Heatmap erwarteter Liquidationslevel. Eine solche wäre ein
 * Modell aus Open Interest und angenommener Leverage-Verteilung — §4.4
 * verlangt, so etwas nicht als Messung auszugeben. Der Unterschied in einem
 * Satz: hier steht Vergangenheit, dort stünde eine Vermutung über die Zukunft.
 *
 * Umsetzung mit Apache ECharts, wie §7 es vorsieht: `heatmap` mit `visualMap`
 * auf logarithmischer Skala — ohne sie erdrückt ein einzelner Ausschlag alles
 * andere.
 */

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { HeatmapChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

import type { Cluster } from '@/lib/derivatives/cluster';

echarts.use([HeatmapChart, GridComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

interface LiquidationClusterProps {
  cluster: Cluster;
  /** Breite eines Zeitfensters — bestimmt die Beschriftung der X-Achse. */
  bucketSeconds: number;
  height?: number;
}

function formatUsd(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)} Mrd`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)} Mio`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)} Tsd`;
  return value.toFixed(0);
}

export function LiquidationCluster({
  cluster,
  bucketSeconds,
  height = 320,
}: LiquidationClusterProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = echarts.init(container, undefined, { renderer: 'canvas' });
    chartRef.current = chart;

    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const timeLabels = cluster.times.map((t) =>
      new Date(t * 1000).toISOString().slice(bucketSeconds >= 86_400 ? 5 : 11, 16).replace('T', ' '),
    );
    const priceLabels = cluster.prices.map((p) => p.toFixed(p >= 1000 ? 0 : 2));

    chart.setOption(
      {
        backgroundColor: 'transparent',
        animation: false,
        grid: { left: 62, right: 16, top: 10, bottom: 46 },
        tooltip: {
          position: 'top',
          backgroundColor: 'rgba(20,20,20,0.95)',
          borderColor: 'rgba(255,255,255,0.15)',
          textStyle: { color: '#e5e5e5', fontSize: 11 },
          formatter: (params: unknown) => {
            const point = params as { data: [number, number, number]; dataIndex: number };
            const cell = cluster.cells[point.dataIndex];
            if (!cell) return '';
            const time = timeLabels[cell.x] ?? '';
            const price = cluster.prices[cell.y];
            const seite =
              cell.side === 'long' ? 'Longs' : cell.side === 'short' ? 'Shorts' : 'gemischt';
            return (
              `${time} UTC<br/>Preisband ab ${price?.toFixed(2) ?? '—'} USD<br/>` +
              `<b>${formatUsd(cell.total)} USD</b> liquidiert · ${cell.count} Ereignis(se)<br/>` +
              `überwiegend ${seite}`
            );
          },
        },
        xAxis: {
          type: 'category',
          data: timeLabels,
          axisLabel: { color: '#8a8a8a', fontSize: 10, hideOverlap: true },
          axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
          splitArea: { show: false },
        },
        yAxis: {
          type: 'category',
          data: priceLabels,
          name: 'Preis (USD)',
          nameTextStyle: { color: '#8a8a8a', fontSize: 10, align: 'right' },
          axisLabel: { color: '#8a8a8a', fontSize: 10, hideOverlap: true },
          axisLine: { lineStyle: { color: 'rgba(255,255,255,0.15)' } },
          splitArea: { show: false },
        },
        visualMap: {
          /**
           * §7 verlangt eine logarithmische Farbskala — ohne sie erdrückt ein
           * einzelner Ausschlag alles andere.
           *
           * ECharts kennt für `visualMap` keinen Log-Modus, deshalb werden die
           * Werte selbst logarithmiert (siehe `series.data`). Die Beschriftung
           * nennt die tatsächlichen USD-Beträge, und im Tooltip steht ohnehin
           * die ungerundete Summe — die Stauchung betrifft nur die Farbe.
           */
          type: 'continuous',
          min: 0,
          max: Math.log10(Math.max(cluster.maxCell, 10)),
          calculable: false,
          orient: 'horizontal',
          left: 'center',
          bottom: 4,
          itemWidth: 10,
          itemHeight: 90,
          textStyle: { color: '#8a8a8a', fontSize: 10 },
          text: [`${formatUsd(cluster.maxCell)} USD`, '1 USD'],
          inRange: {
            color: ['#1b2a3a', '#2c5f8a', '#4aa3df', '#f6c85f', '#e15759'],
          },
        },
        series: [
          {
            type: 'heatmap',
            // Logarithmiert für die Farbskala; die Rohsumme steht im Tooltip.
            data: cluster.cells.map((cell) => [
              cell.x,
              cell.y,
              Math.log10(Math.max(1, cell.total)),
            ]),
            progressive: 2000,
            itemStyle: { borderWidth: 0 },
            emphasis: { itemStyle: { borderColor: '#fff', borderWidth: 1 } },
          },
        ],
      },
      { notMerge: true },
    );
  }, [cluster, bucketSeconds]);

  return <div ref={containerRef} style={{ height }} className="w-full" />;
}
