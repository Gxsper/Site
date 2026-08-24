'use client';

/**
 * Layer-Panel mit den Reglern aus PROJECT_SPEC.md §5.3.
 *
 * Jede Serie bekommt Lead/Lag-Shift, Glättung, Invertierung, Achsenwahl und
 * Sichtbarkeit. Der Tooltip zeigt Quelle, letzte Aktualisierung und native
 * Frequenz (§9).
 */

import type { CatalogEntry } from '@/lib/api-client';
import type { LayerState } from '@/lib/url-state';
import { cn } from '@/lib/utils';

interface LayerRow {
  layer: LayerState;
  descriptor: CatalogEntry | undefined;
  color: string;
  stale: boolean;
  lastUpdated: number | undefined;
  pointCount: number | undefined;
}

interface LayerPanelProps {
  rows: LayerRow[];
  onUpdate: (id: string, patch: Partial<Omit<LayerState, 'id'>>) => void;
  onRemove: (id: string) => void;
}

function formatAge(lastUpdated: number | undefined): string {
  if (!lastUpdated) return 'unbekannt';
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - lastUpdated);
  if (seconds < 90) return 'gerade eben';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 90) return `vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `vor ${hours} Std.`;
  return `vor ${Math.floor(hours / 24)} Tagen`;
}

export function LayerPanel({ rows, onUpdate, onRemove }: LayerPanelProps) {
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        Noch keine Serie gewählt. Links im Browser eine auswählen.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map(({ layer, descriptor, color, stale, lastUpdated, pointCount }) => (
        <li key={layer.id} className="border-border bg-card/50 rounded-md border p-2.5">
          <div className="flex items-start gap-2">
            <span
              className="mt-1 size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
              aria-hidden
            />

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-xs font-medium">
                  {descriptor?.label ?? layer.id}
                </span>
                {layer.shift !== 0 && (
                  <span className="bg-accent text-accent-foreground shrink-0 rounded px-1 text-[10px] tabular-nums">
                    {layer.shift > 0 ? `+${layer.shift}d` : `${layer.shift}d`}
                  </span>
                )}
                {stale && (
                  <span
                    className="bg-destructive/20 text-destructive shrink-0 rounded px-1 text-[10px]"
                    title={`Letzte erfolgreiche Aktualisierung: ${formatAge(lastUpdated)}`}
                  >
                    stale
                  </span>
                )}
              </div>

              <p className="text-muted-foreground mt-0.5 text-[10px]">
                {descriptor?.attribution ?? 'Quelle unbekannt'} · {descriptor?.nativeFrequency} ·{' '}
                {formatAge(lastUpdated)}
                {pointCount !== undefined && ` · ${pointCount.toLocaleString('de-DE')} Punkte`}
              </p>
            </div>

            <button
              type="button"
              onClick={() => onRemove(layer.id)}
              className="text-muted-foreground hover:text-foreground shrink-0 px-1 text-xs"
              title="Serie entfernen"
              aria-label={`${descriptor?.label ?? layer.id} entfernen`}
            >
              ×
            </button>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
            <label className="flex items-center gap-1.5 text-[10px]">
              <span className="text-muted-foreground w-10 shrink-0">Shift</span>
              <input
                type="number"
                step={1}
                value={layer.shift}
                onChange={(event) =>
                  onUpdate(layer.id, { shift: Number.parseInt(event.target.value, 10) || 0 })
                }
                className="border-border bg-background w-full rounded border px-1 py-0.5 text-[11px] tabular-nums"
                title="Verschiebung in Tagen. Positiv = später."
              />
            </label>

            <label className="flex items-center gap-1.5 text-[10px]">
              <span className="text-muted-foreground w-10 shrink-0">SMA</span>
              <input
                type="number"
                min={0}
                step={1}
                value={layer.smooth}
                onChange={(event) =>
                  onUpdate(layer.id, {
                    smooth: Math.max(0, Number.parseInt(event.target.value, 10) || 0),
                  })
                }
                className="border-border bg-background w-full rounded border px-1 py-0.5 text-[11px] tabular-nums"
                title="Nachlaufender gleitender Durchschnitt über n Tage. 0 = aus."
              />
            </label>

            <label className="flex cursor-pointer items-center gap-1.5 text-[10px]">
              <input
                type="checkbox"
                checked={layer.invert}
                onChange={(event) => onUpdate(layer.id, { invert: event.target.checked })}
                className="size-3"
              />
              <span className="text-muted-foreground">invertieren</span>
            </label>

            <label className="flex cursor-pointer items-center gap-1.5 text-[10px]">
              <input
                type="checkbox"
                checked={layer.visible}
                onChange={(event) => onUpdate(layer.id, { visible: event.target.checked })}
                className="size-3"
              />
              <span className="text-muted-foreground">sichtbar</span>
            </label>

            <div className="col-span-2 flex items-center gap-1.5 text-[10px]">
              <span className="text-muted-foreground w-10 shrink-0">Achse</span>
              {(['left', 'right'] as const).map((axis) => (
                <button
                  key={axis}
                  type="button"
                  onClick={() => onUpdate(layer.id, { axis })}
                  className={cn(
                    'border-border rounded border px-1.5 py-0.5',
                    layer.axis === axis
                      ? 'bg-primary text-primary-foreground border-transparent'
                      : 'hover:bg-accent',
                  )}
                >
                  {axis === 'left' ? 'links' : 'rechts'}
                </button>
              ))}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
