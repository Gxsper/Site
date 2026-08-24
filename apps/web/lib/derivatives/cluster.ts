/**
 * Liquidations-Cluster als Preis-Zeit-Matrix (PROJECT_SPEC.md §7).
 *
 * ══ Messung, nicht Modell ══
 *
 * Hier steht ausschließlich, was der eigene Ingest tatsächlich beobachtet hat:
 * wie viel USD an welchem Preisniveau in welchem Zeitfenster wirklich
 * liquidiert wurde.
 *
 * Das ist bewusst **keine** Heatmap erwarteter Liquidationslevel. Die wäre ein
 * Modell aus Open Interest und angenommener Leverage-Verteilung — §4.4
 * verlangt, so etwas nicht als Messung auszugeben.
 *
 * Reine Funktion: die Datenbank liefert nur die Zeilen, gerechnet wird hier,
 * und damit ist es ohne Datenbank testbar.
 */

export interface ClusterEvent {
  /** Unix-Sekunden UTC. */
  t: number;
  price: number;
  /** Gegenwert in USD. */
  quoteQty: number;
  side: 'long' | 'short';
}

export interface ClusterCell {
  /** Index auf der Zeitachse. */
  x: number;
  /** Index auf der Preisachse. */
  y: number;
  total: number;
  count: number;
  /** Welche Seite überwiegt — ab 80 % Anteil wird sie benannt. */
  side: 'long' | 'short' | 'gemischt';
}

export interface Cluster {
  /** Beginn jedes Zeitfensters, Unix-Sekunden. */
  times: number[];
  /** Untere Kante jedes Preisbandes. */
  prices: number[];
  cells: ClusterCell[];
  priceRange: { min: number; max: number } | null;
  maxCell: number;
}

const EMPTY: Cluster = { times: [], prices: [], cells: [], priceRange: null, maxCell: 0 };

/** Ab diesem Anteil gilt eine Seite als überwiegend. */
const DOMINANCE_THRESHOLD = 0.8;

export function buildCluster(
  events: readonly ClusterEvent[],
  since: number,
  bucketSeconds: number,
  priceBucketCount: number,
): Cluster {
  const usable = events.filter(
    (event) => Number.isFinite(event.price) && event.price > 0 && Number.isFinite(event.quoteQty),
  );
  if (usable.length === 0) return { ...EMPTY };

  const minPrice = Math.min(...usable.map((e) => e.price));
  const maxPrice = Math.max(...usable.map((e) => e.price));
  const span = maxPrice - minPrice;

  // Alle Ereignisse auf demselben Preis: eine einzige Zeile, kein Raster.
  const rows = span === 0 ? 1 : priceBucketCount;
  const rowHeight = span === 0 ? 1 : span / rows;

  const firstBucket = Math.floor(since / bucketSeconds) * bucketSeconds;
  const lastBucket = Math.floor(Math.max(...usable.map((e) => e.t)) / bucketSeconds) * bucketSeconds;
  const columns = Math.max(1, Math.round((lastBucket - firstBucket) / bucketSeconds) + 1);

  const times = Array.from({ length: columns }, (_, i) => firstBucket + i * bucketSeconds);
  const prices = Array.from({ length: rows }, (_, i) => minPrice + i * rowHeight);

  const grid = new Map<string, { total: number; count: number; longs: number; shorts: number }>();

  for (const event of usable) {
    const bucketStart = Math.floor(event.t / bucketSeconds) * bucketSeconds;
    const x = Math.round((bucketStart - firstBucket) / bucketSeconds);
    if (x < 0 || x >= columns) continue;

    // Der höchste Preis fiele sonst in ein Band jenseits des Rasters.
    const y = span === 0 ? 0 : Math.min(rows - 1, Math.floor((event.price - minPrice) / rowHeight));

    const key = `${x}:${y}`;
    const cell = grid.get(key) ?? { total: 0, count: 0, longs: 0, shorts: 0 };
    cell.total += event.quoteQty;
    cell.count += 1;
    if (event.side === 'long') cell.longs += event.quoteQty;
    else cell.shorts += event.quoteQty;
    grid.set(key, cell);
  }

  const cells: ClusterCell[] = [];
  let maxCell = 0;

  for (const [key, value] of grid) {
    const [x, y] = key.split(':').map(Number) as [number, number];
    const sum = value.longs + value.shorts;
    const dominance = sum === 0 ? 0.5 : value.longs / sum;

    cells.push({
      x,
      y,
      total: value.total,
      count: value.count,
      side:
        dominance >= DOMINANCE_THRESHOLD
          ? 'long'
          : dominance <= 1 - DOMINANCE_THRESHOLD
            ? 'short'
            : 'gemischt',
    });
    maxCell = Math.max(maxCell, value.total);
  }

  // Leere Zellen erscheinen **nicht** im Ergebnis. Eine Zelle mit 0 sähe im
  // Chart aus wie „hier wurde geprüft und nichts gefunden" — tatsächlich heißt
  // es „hier ist nichts eingetreten". Dieselbe Regel wie bei Zeitreihen (§11).
  cells.sort((a, b) => a.x - b.x || a.y - b.y);

  return { times, prices, cells, priceRange: { min: minPrice, max: maxPrice }, maxCell };
}
