'use client';

/**
 * Macro-Seite (PROJECT_SPEC.md §8).
 *
 * Net Liquidity als Hauptchart mit BTC darüber und prominentem Lead-Lag-Regler,
 * darunter die Bilanzkomponenten, die Zinskurve mit Rezessionsmarkierung, die
 * Realzinsen und die Financial Conditions.
 *
 * Alle Charts holen ihre Daten über /api/series — Alignment und Normalisierung
 * passieren serverseitig (§4.0), diese Seite rechnet nichts um.
 */

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';

import { OverlayChart, type ChartLayer } from '@/components/overlay/overlay-chart';
import { fetchSeries } from '@/lib/api-client';
import { colorForIndex } from '@/lib/url-state';
import { MIN_SAMPLE } from '@/lib/series/correlation';

const DAY = 86_400;

interface PanelProps {
  title: string;
  hint?: string;
  query: string;
  colors: string[];
  labels: string[];
  height?: number;
  logScale?: boolean;
  axes?: ('left' | 'right')[];
}

function useSeriesPanel(query: string) {
  return useQuery({
    queryKey: ['macro', query],
    queryFn: ({ signal }) => fetchSeries(query, signal),
    staleTime: 30 * 60_000,
  });
}

function Panel({ title, hint, query, colors, labels, height = 260, logScale = false, axes }: PanelProps) {
  const result = useSeriesPanel(query);

  const layers: ChartLayer[] = (result.data?.aligned.ids ?? []).map((id, index) => ({
    id,
    label: labels[index] ?? id,
    color: colors[index] ?? colorForIndex(index),
    axis: axes?.[index] ?? 'right',
    values: result.data?.aligned.values[index] ?? [],
  }));

  return (
    <section className="border-border bg-card/30 rounded-md border p-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-xs font-semibold">{title}</h2>
        {hint && <span className="text-muted-foreground text-[10px]">{hint}</span>}
        <div className="ml-auto flex flex-wrap items-center gap-x-3">
          {layers.map((layer) => (
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

      {result.isPending && (
        <p className="text-muted-foreground py-12 text-center text-xs">Daten werden geladen…</p>
      )}
      {result.isError && (
        <p className="text-destructive py-12 text-center text-xs">{result.error.message}</p>
      )}
      {result.data?.errors.map((error) => (
        <p key={error.id} className="text-destructive mb-2 text-[11px]">
          <span className="font-mono">{error.id}</span>: {error.message}
        </p>
      ))}
      {result.data && result.data.aligned.t.length > 0 && (
        <OverlayChart
          t={result.data.aligned.t}
          layers={layers}
          logScale={logScale}
          height={height}
        />
      )}
    </section>
  );
}

/** Zeitraum der Macro-Seite: fünf Jahre reichen für Liquiditätszyklen. */
function defaultRange() {
  const to = Math.floor(Date.now() / 1000);
  return { from: to - 5 * 365 * DAY, to };
}

export function MacroDashboard() {
  const [shiftDays, setShiftDays] = useState(0);
  const { from, to } = defaultRange();
  const base = `from=${from}&to=${to}&raw=0`;

  const liquidityQuery =
    `ids=macro.net_liquidity,btc.usd.close&${base}` +
    `&align=union_ffill&norm=rebase100&shift=${shiftDays},0&corr=90`;

  const liquidity = useSeriesPanel(liquidityQuery);

  const liquidityLayers: ChartLayer[] = (liquidity.data?.aligned.ids ?? []).map((id, index) => ({
    id,
    label: id,
    color: index === 0 ? '#4aa3df' : '#f7931a',
    axis: 'right',
    values: liquidity.data?.aligned.values[index] ?? [],
  }));

  const best = liquidity.data?.correlation?.best ?? null;

  // Groesste Stichprobe ueber alle Verschiebungen — sie sagt, wie weit es bis
  // zu einer rechenbaren Korrelation fehlt, wenn `best` null ist.
  const groessteStichprobe = (liquidity.data?.correlation?.leadLag ?? []).reduce(
    (max, punkt) => Math.max(max, punkt.n),
    0,
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-border flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5">
        <Link href="/" className="text-sm font-semibold tracking-tight hover:underline">
          MacroDeck
        </Link>
        <span className="text-muted-foreground text-[10px]">Makro &amp; Fed</span>
        <nav className="ml-auto flex gap-3 text-[11px]">
          <Link href="/" className="hover:underline">
            Overlay-Studio
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
        {/* Hauptchart: Net Liquidity gegen BTC mit prominentem Lead-Lag-Regler (§8). */}
        <section className="border-border bg-card/30 rounded-md border p-3">
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            <h2 className="text-xs font-semibold">Fed Net Liquidity gegen Bitcoin</h2>
            <span className="text-muted-foreground text-[10px]">
              beide auf 100 rebased, Zeitraum 5 Jahre
            </span>

            <label className="ml-auto flex items-center gap-2 text-[11px]">
              <span className="text-muted-foreground">Liquidität verschieben</span>
              <input
                type="range"
                min={-180}
                max={180}
                step={5}
                value={shiftDays}
                onChange={(event) => setShiftDays(Number.parseInt(event.target.value, 10))}
                className="w-40"
              />
              <span className="w-14 text-right tabular-nums">
                {shiftDays > 0 ? `+${shiftDays}` : shiftDays} Tage
              </span>
              {shiftDays !== 0 && (
                <button
                  type="button"
                  onClick={() => setShiftDays(0)}
                  className="hover:bg-accent rounded px-1"
                  title="Verschiebung zurücksetzen"
                >
                  ×
                </button>
              )}
            </label>
          </div>

          {liquidity.isPending && (
            <p className="text-muted-foreground py-16 text-center text-xs">Daten werden geladen…</p>
          )}
          {liquidity.isError && (
            <p className="text-destructive py-16 text-center text-xs">{liquidity.error.message}</p>
          )}
          {liquidity.data && (
            <>
              <div className="mb-1 flex flex-wrap gap-x-4">
                {liquidityLayers.map((layer) => (
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
              <OverlayChart t={liquidity.data.aligned.t} layers={liquidityLayers} logScale={false} height={340} />

              {best ? (
                <p className="text-muted-foreground mt-2 text-[10px]">
                  Bestes Lead/Lag auf Log-Returns:{' '}
                  <span className="text-foreground tabular-nums">
                    {best.shift > 0 ? '+' : ''}
                    {best.shift} Tage
                  </span>{' '}
                  mit r = <span className="text-foreground tabular-nums">{best.r?.toFixed(3) ?? '—'}</span>{' '}
                  (n = {best.n.toLocaleString('de-DE')}). Der Regler oben ändert nur die
                  Darstellung, nicht diese Rechnung.
                </p>
              ) : (
                // §11: eine Kennzahl, die nicht gerechnet werden kann, wird nicht
                // stillschweigend weggelassen — der Grund steht da, wo sonst die
                // Zahl stünde.
                <p className="text-muted-foreground mt-2 text-[10px]">
                  Kein Lead/Lag berechenbar: Eine Korrelation braucht mindestens{' '}
                  <span className="text-foreground tabular-nums">{MIN_SAMPLE}</span> gemeinsame
                  Log-Return-Paare, hier sind es höchstens{' '}
                  <span className="text-foreground tabular-nums">
                    {groessteStichprobe.toLocaleString('de-DE')}
                  </span>
                  . Geschätzt wird nichts.
                </p>
              )}
              {liquidity.data.correlation?.warning && (
                <p className="text-muted-foreground mt-1 text-[10px]">
                  ⚠ {liquidity.data.correlation.warning}
                </p>
              )}
            </>
          )}
        </section>

        <Panel
          title="Fed-Bilanz: Komponenten"
          hint="WALCL minus TGA minus RRP ergibt Net Liquidity"
          query={`ids=fred.WALCL,fred.WTREGEN,fred.RRPONTSYD&${base}&align=union_ffill&norm=raw`}
          labels={['Bilanzsumme', 'Treasury General Account', 'Reverse Repo']}
          colors={['#4aa3df', '#f6c85f', '#e15759']}
          axes={['right', 'left', 'left']}
        />

        <Panel
          title="Zinskurve 10J − 2J mit Rezessionen"
          hint="unter 0 = invertiert; USREC ist 1 während einer NBER-Rezession"
          query={`ids=fred.T10Y2Y,fred.USREC&${base}&align=union_ffill&norm=raw`}
          labels={['10J − 2J (%)', 'Rezession (0/1)']}
          colors={['#7ed321', 'rgba(225,87,89,0.6)']}
          axes={['right', 'left']}
        />

        <Panel
          title="Realzins, Dollar und Gold-Ersatz"
          hint="Realzins 10J (TIPS) gegen den breiten Dollar-Index"
          query={`ids=fred.DFII10,fred.DTWEXBGS&${base}&align=union_ffill&norm=raw`}
          labels={['Realzins 10J (%)', 'Dollar-Index']}
          colors={['#b07aa1', '#76b7b2']}
          axes={['right', 'left']}
        />

        <Panel
          title="Financial Conditions und Volatilität"
          hint="NFCI über 0 = straffere Bedingungen als im Schnitt"
          query={`ids=fred.NFCI,fred.VIXCLS&${base}&align=union_ffill&norm=raw`}
          labels={['NFCI', 'VIX']}
          colors={['#f6c85f', '#e15759']}
          axes={['right', 'left']}
        />

        <Panel
          title="US-Geldmenge M2"
          query={`ids=fred.WM2NS&${base}&align=union_ffill&norm=raw`}
          labels={['M2 (Mrd. USD)']}
          colors={['#4aa3df']}
          height={200}
        />
      </main>

      <footer className="border-border text-muted-foreground border-t px-4 py-2 text-[10px]">
        Makrodaten: Federal Reserve Bank of St. Louis (FRED) · Marktdaten: Binance ·
        Charts: TradingView Lightweight Charts · Keine Anlageberatung.
      </footer>
    </div>
  );
}
