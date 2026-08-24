'use client';

/**
 * Korrelations-Panel unter dem Chart (PROJECT_SPEC.md §5.4).
 *
 * Zeigt drei Dinge, die zusammengehören: das aktuelle rollierende r, die
 * Kreuzkorrelation über ±180 Tage mit markiertem Maximum, und die
 * Stichprobengröße n. Ohne n ist ein r wertlos.
 *
 * Läuft das Alignment auf `union_ffill`, steht die Warnung aus §5.4 dabei.
 */

import type { CorrelationPayload } from '@/lib/api-client';

interface CorrelationPanelProps {
  correlation: CorrelationPayload;
  labels: [string, string];
}

function formatR(r: number | null): string {
  return r === null ? '—' : r.toFixed(3);
}

export function CorrelationPanel({ correlation, labels }: CorrelationPanelProps) {
  const rolling = correlation.rolling;
  const latest = [...rolling].reverse().find((v) => v !== null) ?? null;

  const withValues = correlation.leadLag.filter((p) => p.r !== null);
  const maxAbs = withValues.reduce((max, p) => Math.max(max, Math.abs(p.r!)), 0);

  return (
    <section className="border-border bg-card/40 rounded-md border p-3">
      <header className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-xs font-semibold">
          Korrelation · {labels[0]} gegen {labels[1]}
        </h2>
        <span className="text-muted-foreground text-[10px]">
          Log-Returns, {correlation.window}-Tage-Fenster
        </span>
      </header>

      <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
        <dl className="space-y-1.5 text-xs">
          <div className="flex gap-2">
            <dt className="text-muted-foreground w-28">aktuelles r</dt>
            <dd className="font-medium tabular-nums">{formatR(latest)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground w-28">bestes Lead/Lag</dt>
            <dd className="tabular-nums">
              {correlation.best
                ? `${correlation.best.shift > 0 ? '+' : ''}${correlation.best.shift} Tage`
                : '—'}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground w-28">r dort</dt>
            <dd className="tabular-nums">{formatR(correlation.best?.r ?? null)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground w-28">Stichprobe n</dt>
            <dd className="tabular-nums">
              {correlation.best?.n.toLocaleString('de-DE') ?? '—'}
            </dd>
          </div>
        </dl>

        <div>
          <p className="text-muted-foreground mb-1 text-[10px]">
            Kreuzkorrelation über ±180 Tage — Balken nach oben heißt positiver Zusammenhang
          </p>
          <div
            className="flex h-16 items-center gap-px"
            role="img"
            aria-label={`Kreuzkorrelation, Maximum bei ${correlation.best?.shift ?? 0} Tagen`}
          >
            {correlation.leadLag.map((point) => {
              const height = point.r === null || maxAbs === 0 ? 0 : (Math.abs(point.r) / maxAbs) * 50;
              const isBest = correlation.best?.shift === point.shift;
              return (
                <div
                  key={point.shift}
                  className="flex h-full flex-1 flex-col justify-center"
                  title={`${point.shift > 0 ? '+' : ''}${point.shift}d: r = ${formatR(point.r)}, n = ${point.n}`}
                >
                  <div className="flex h-1/2 items-end">
                    {(point.r ?? 0) >= 0 && (
                      <div
                        className="w-full"
                        style={{
                          height: `${height}%`,
                          backgroundColor: isBest ? '#f7931a' : 'rgba(122,184,180,0.7)',
                        }}
                      />
                    )}
                  </div>
                  <div className="flex h-1/2 items-start">
                    {(point.r ?? 0) < 0 && (
                      <div
                        className="w-full"
                        style={{
                          height: `${height}%`,
                          backgroundColor: isBest ? '#f7931a' : 'rgba(225,87,89,0.7)',
                        }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-muted-foreground mt-0.5 flex justify-between text-[10px] tabular-nums">
            <span>−180d</span>
            <span>0</span>
            <span>+180d</span>
          </div>
        </div>
      </div>

      {correlation.warning && (
        <p className="border-border text-muted-foreground mt-3 border-t pt-2 text-[10px]">
          ⚠ {correlation.warning}
        </p>
      )}
    </section>
  );
}
