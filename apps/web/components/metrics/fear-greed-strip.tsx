'use client';

/**
 * Fear & Greed Index als Histogramm-Streifen (PROJECT_SPEC.md §6.6).
 *
 * Bewusst kein Liniendiagramm: der Index ist eine tägliche Einstufung von 0 bis
 * 100, keine stetige Größe. Ein Balken je Tag, eingefärbt nach der Stufe, zeigt
 * die Stimmungsphasen deutlicher als eine Kurve.
 *
 * Der Index existiert erst ab 2018-02-01 (verifiziert). Davor gibt es keinen
 * Balken — es wird nichts aufgefüllt (§11).
 */

import { useQuery } from '@tanstack/react-query';

import { fetchSeries } from '@/lib/api-client';

const DAY = 86_400;

/** Einstufungen nach der Skala von alternative.me. */
const LEVELS = [
  { max: 24, label: 'Extreme Angst', color: '#e15759' },
  { max: 44, label: 'Angst', color: '#f2915f' },
  { max: 54, label: 'Neutral', color: '#c9c9c9' },
  { max: 74, label: 'Gier', color: '#9ccb6a' },
  { max: 100, label: 'Extreme Gier', color: '#3f9e4d' },
] as const;

function levelFor(value: number) {
  return LEVELS.find((level) => value <= level.max) ?? LEVELS[LEVELS.length - 1]!;
}

export function FearGreedStrip({ years = 3 }: { years?: number }) {
  const to = Math.floor(Date.now() / 1000);
  const from = to - years * 365 * DAY;
  const query = `ids=sentiment.fng&from=${from}&to=${to}&align=native&norm=raw&raw=0`;

  const result = useQuery({
    queryKey: ['fng', query],
    queryFn: ({ signal }) => fetchSeries(query, signal),
    staleTime: 30 * 60_000,
  });

  const t = result.data?.aligned.t ?? [];
  const values = result.data?.aligned.values[0] ?? [];

  // Letzter Tag mit echtem Wert. reduce mit einem number-Startwert, damit der
  // Typ nicht auf (number | null) aufweicht.
  let latestIndex = -1;
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== null && values[i] !== undefined) latestIndex = i;
  }
  const latest = latestIndex >= 0 ? (values[latestIndex] ?? null) : null;

  return (
    <section className="border-border bg-card/30 rounded-md border p-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-4">
        <h2 className="text-xs font-semibold">Fear &amp; Greed Index</h2>
        {latest !== null && (
          <span
            className="rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-black"
            style={{ backgroundColor: levelFor(latest).color }}
          >
            {latest.toFixed(0)} · {levelFor(latest).label}
          </span>
        )}
        <span className="text-muted-foreground text-[10px]">
          letzte {years} Jahre · ein Balken je Tag
        </span>
      </div>

      {result.isPending && (
        <p className="text-muted-foreground py-8 text-center text-xs">Index wird geladen…</p>
      )}
      {result.isError && (
        <p className="text-destructive py-8 text-center text-xs">{result.error.message}</p>
      )}

      {result.data && (
        <>
          <div className="flex h-14 items-end gap-px" role="img" aria-label="Fear and Greed Verlauf">
            {t.map((time, index) => {
              const value = values[index] ?? null;
              if (value === null) {
                // Kein Wert an diesem Tag — Lücke, kein Nullbalken (§11).
                return <div key={time} className="flex-1" />;
              }
              const level = levelFor(value);
              return (
                <div
                  key={time}
                  className="flex-1"
                  style={{ height: `${Math.max(4, value)}%`, backgroundColor: level.color }}
                  title={`${new Date(time * 1000).toISOString().slice(0, 10)}: ${value.toFixed(0)} — ${level.label}`}
                />
              );
            })}
          </div>

          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {LEVELS.map((level) => (
              <span key={level.label} className="flex items-center gap-1 text-[10px]">
                <span
                  className="size-2 rounded-[2px]"
                  style={{ backgroundColor: level.color }}
                  aria-hidden
                />
                {level.label}
              </span>
            ))}
            <span className="text-muted-foreground ml-auto text-[10px]">
              Quelle: alternative.me · ab 2018-02-01 verfügbar
            </span>
          </div>
        </>
      )}
    </section>
  );
}
