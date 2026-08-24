/**
 * GET /api/metrics — abgeleitete Kennzahlen aus PROJECT_SPEC.md §6.
 *
 * `?metric=risk&variant=expanding&series=btc.usd.cm`
 *
 * Metriken brauchen die **gesamte** Historie, nicht nur den sichtbaren
 * Zeitraum: Risk Metric, Log-Regression und MVRV-Z sind über die volle Reihe
 * definiert (§6.1, §6.2, §6.5). Deshalb lädt diese Route unabhängig vom
 * Anzeigefenster ab dem dokumentierten `earliest` der Serie.
 *
 * Jede Antwort trägt ihren `methodology`-Text mit — §14 verlangt ihn im
 * Tooltip, und er soll nicht in der UI dupliziert werden.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { compareCycles } from '@/lib/metrics/cycles';
import { logRegressionBands, MetricError } from '@/lib/metrics/logreg';
import {
  METHODOLOGY as ONCHAIN_METHODOLOGY,
  mvrvZScore,
  nupl,
  realizedCap,
  realizedPrice,
} from '@/lib/metrics/onchain';
import {
  dailyLogReturns,
  drawdown,
  METHODOLOGY as RISK_METHODOLOGY,
  rollingSharpe,
  rollingSortino,
  rollingVolatility,
} from '@/lib/metrics/risk-adjusted';
import { riskMetric } from '@/lib/metrics/risk-metric';
import { installTelemetrySink } from '@/lib/db/telemetry-sink';
import { findDescriptor } from '@/lib/series/catalog';
import { loadSeries } from '@/lib/series/service';
import type { SeriesDescriptor, SeriesPoint } from '@/lib/series/types';

export const dynamic = 'force-dynamic';

const METRICS = ['risk', 'logreg', 'drawdown', 'riskadjusted', 'onchain', 'cycles'] as const;

const querySchema = z.object({
  metric: z.enum(METRICS),
  variant: z.enum(['full', 'expanding']).default('expanding'),
  series: z.string().default('btc.usd.cm'),
  anchor: z.enum(['halving', 'bottom']).default('halving'),
  window: z.coerce.number().int().positive().max(3650).default(365),
});

/** Lädt eine Serie über ihre gesamte dokumentierte Historie. */
async function loadFullHistory(descriptor: SeriesDescriptor): Promise<SeriesPoint[]> {
  const from = Math.floor(Date.parse(descriptor.earliest) / 1000);
  const to = Math.floor(Date.now() / 1000);
  const { response } = await loadSeries(descriptor, { from, to });
  return response.points;
}

async function loadById(id: string): Promise<SeriesPoint[]> {
  const descriptor = findDescriptor(id);
  if (!descriptor) throw new MetricError(`Unbekannte Serien-ID: ${id}`);
  return loadFullHistory(descriptor);
}

export async function GET(request: Request) {
  installTelemetrySink();

  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    metric: params.get('metric') ?? undefined,
    variant: params.get('variant') ?? undefined,
    series: params.get('series') ?? undefined,
    anchor: params.get('anchor') ?? undefined,
    window: params.get('window') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Ungültige Anfrage',
        issues: parsed.error.issues.map((i) => i.message),
        hinweis: `metric ∈ {${METRICS.join('|')}}`,
      },
      { status: 400 },
    );
  }

  const query = parsed.data;

  try {
    switch (query.metric) {
      case 'risk': {
        const price = await loadById(query.series);
        const result = riskMetric(price, query.variant);
        return NextResponse.json({
          metric: 'risk',
          variant: result.variant,
          series: query.series,
          points: result.points,
          methodology: result.methodology,
        });
      }

      case 'logreg': {
        const price = await loadById(query.series);
        const result = logRegressionBands(price, price.map((p) => p.t));
        return NextResponse.json({
          metric: 'logreg',
          series: query.series,
          price,
          bands: result.bands,
          fit: { a: result.fit.a, b: result.fit.b, r2: result.fit.r2, n: result.fit.n },
          methodology: result.methodology,
        });
      }

      case 'drawdown': {
        const price = await loadById(query.series);
        const result = drawdown(price);
        return NextResponse.json({
          metric: 'drawdown',
          series: query.series,
          underwater: result.underwater,
          maxDrawdownPct: result.maxDrawdownPct,
          maxDrawdownAt: result.maxDrawdownAt,
          peakAt: result.peakAt,
          methodology: RISK_METHODOLOGY.drawdown,
        });
      }

      case 'riskadjusted': {
        const price = await loadById(query.series);
        const returns = dailyLogReturns(price);
        return NextResponse.json({
          metric: 'riskadjusted',
          series: query.series,
          window: query.window,
          sharpe: rollingSharpe(returns, query.window),
          sortino: rollingSortino(returns, query.window),
          volatility: rollingVolatility(returns, query.window),
          methodology: {
            sharpe: RISK_METHODOLOGY.sharpe,
            sortino: RISK_METHODOLOGY.sortino,
            volatility: RISK_METHODOLOGY.volatility,
            hinweis:
              'Ohne risikofreien Zins gerechnet (rf = 0). Sobald DGS3MO im ' +
              'Katalog steht, fließt er ein.',
          },
        });
      }

      case 'onchain': {
        const [marketCap, mvrv, supply] = await Promise.all([
          loadById('onchain.btc.marketcap'),
          loadById('onchain.btc.mvrv'),
          loadById('onchain.btc.supply'),
        ]);

        const realized = realizedCap(marketCap, mvrv);

        return NextResponse.json({
          metric: 'onchain',
          realizedCap: realized,
          realizedPrice: realizedPrice(realized, supply),
          mvrvZ: mvrvZScore(marketCap, realized),
          nupl: nupl(marketCap, realized),
          methodology: ONCHAIN_METHODOLOGY,
        });
      }

      case 'cycles': {
        const price = await loadById(query.series);
        const result = compareCycles(price, query.anchor);
        return NextResponse.json({
          metric: 'cycles',
          series: query.series,
          anchor: query.anchor,
          cycles: result.cycles,
          methodology: result.methodology,
        });
      }
    }
  } catch (error) {
    // Eine Metrik, deren Eingaben fehlen, wird nicht gerendert und nennt den
    // Grund (§11) — sie wird nicht mit Ersatzwerten gefüllt.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error), metric: query.metric },
      { status: 502 },
    );
  }
}
