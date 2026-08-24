'use client';

/**
 * Serien-Browser (PROJECT_SPEC.md §9): Suchfeld und Gruppen aus §3.1.
 *
 * Zeigt ehrlich an, was nicht abrufbar ist: eine Serie, deren Provider noch
 * nicht implementiert ist, lässt sich nicht hinzufügen und sagt auch warum.
 */

import { useMemo, useState } from 'react';

import type { CatalogEntry } from '@/lib/api-client';
import type { SeriesGroup } from '@/lib/series/types';
import { cn } from '@/lib/utils';

const GROUP_LABELS: Record<SeriesGroup, string> = {
  crypto: 'Krypto',
  equities: 'Aktien',
  fx: 'Devisen',
  rates: 'Zinsen',
  macro: 'Makro',
  onchain: 'On-Chain',
  derivatives: 'Derivate',
  sentiment: 'Sentiment',
};

const UNIT_LABELS: Record<string, string> = {
  usd: 'USD',
  usd_bn: 'Mrd. USD',
  pct: '%',
  ratio: 'Verhältnis',
  index: 'Index',
  bps: 'bp',
  hashrate: 'Hashrate',
  count: 'Anzahl',
};

interface SeriesBrowserProps {
  catalog: CatalogEntry[];
  activeIds: string[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  disabled: boolean;
}

export function SeriesBrowser({
  catalog,
  activeIds,
  onAdd,
  onRemove,
  disabled,
}: SeriesBrowserProps) {
  const [query, setQuery] = useState('');
  const active = useMemo(() => new Set(activeIds), [activeIds]);

  const grouped = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = catalog.filter(
      (entry) =>
        needle === '' ||
        entry.label.toLowerCase().includes(needle) ||
        entry.id.toLowerCase().includes(needle),
    );

    const map = new Map<SeriesGroup, CatalogEntry[]>();
    for (const entry of matching) {
      const list = map.get(entry.group) ?? [];
      list.push(entry);
      map.set(entry.group, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [catalog, query]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <label htmlFor="series-search" className="sr-only">
          Serie suchen
        </label>
        <input
          id="series-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Serie suchen…"
          className="border-border bg-background focus:ring-ring w-full rounded-md border px-2.5 py-1.5 text-xs outline-none focus:ring-2"
        />
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {grouped.length === 0 && (
          <p className="text-muted-foreground px-1 text-xs">
            Keine Serie passt zu &bdquo;{query}&ldquo;.
          </p>
        )}

        {grouped.map(([group, entries]) => (
          <div key={group}>
            <h3 className="text-muted-foreground mb-1.5 px-1 text-[10px] font-semibold tracking-wider uppercase">
              {GROUP_LABELS[group]}
            </h3>
            <ul className="space-y-0.5">
              {entries.map((entry) => {
                const isActive = active.has(entry.id);
                const blocked = !entry.available;

                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      disabled={blocked || (disabled && !isActive)}
                      onClick={() => (isActive ? onRemove(entry.id) : onAdd(entry.id))}
                      title={
                        blocked
                          ? `${entry.label}: Provider "${entry.provider}" ist noch nicht implementiert`
                          : `${entry.label} — ${entry.attribution}, ab ${entry.earliest.slice(0, 10)}`
                      }
                      className={cn(
                        'flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors',
                        'disabled:cursor-not-allowed disabled:opacity-40',
                        isActive
                          ? 'bg-accent text-accent-foreground'
                          : 'hover:bg-accent/50 text-foreground',
                      )}
                    >
                      <span
                        className={cn(
                          'border-border flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border text-[9px]',
                          isActive && 'bg-primary text-primary-foreground border-transparent',
                        )}
                        aria-hidden
                      >
                        {isActive ? '✓' : ''}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                      <span className="text-muted-foreground shrink-0 text-[10px]">
                        {UNIT_LABELS[entry.unit] ?? entry.unit}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {disabled && (
        <p className="text-muted-foreground border-border border-t pt-2 text-[10px]">
          Höchstzahl gleichzeitiger Serien erreicht.
        </p>
      )}
    </div>
  );
}
