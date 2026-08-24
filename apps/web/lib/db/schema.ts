/**
 * Drizzle-Schema (PROJECT_SPEC.md §2, §10 Layer 1).
 *
 * Layer 1 des Caches: alle historischen Tagesdaten dauerhaft. Einmal geholt =
 * nie wieder holen; ein Nachtjob holt nur das Delta seit dem letzten Punkt.
 *
 * Zeitkonvention: jede Zeitspalte, die zu einer Zeitreihe gehoert, ist
 * `bigint` mit Unix-Sekunden UTC (§0.4). `timestamptz` nur fuer Buchhaltung
 * (wann haben WIR etwas geschrieben), nie fuer Messwerte.
 */

import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const seriesGroupEnum = pgEnum('series_group', [
  'crypto',
  'equities',
  'fx',
  'rates',
  'macro',
  'onchain',
  'derivatives',
  'sentiment',
]);

export const seriesUnitEnum = pgEnum('series_unit', [
  'usd',
  'pct',
  'ratio',
  'index',
  'bps',
  'usd_bn',
  'hashrate',
  'count',
]);

export const frequencyEnum = pgEnum('frequency', [
  'tick',
  '1m',
  '5m',
  '1h',
  '4h',
  '1d',
  '1w',
  '1mo',
  'irregular',
]);

export const providerEnum = pgEnum('provider', [
  'fred',
  'binance',
  'bybit',
  'coinmetrics',
  'coingecko',
  'stooq',
  'coinglass',
  'yahoo',
  'alternativeme',
  'mempool',
  'derived',
]);

export const liquidationSideEnum = pgEnum('liquidation_side', ['long', 'short']);

/**
 * Katalog aller bekannten Serien — 1:1 der SeriesDescriptor aus §3.1.
 * `earliest` ist der nachgewiesene Start der Historie, nicht geraten.
 */
export const series = pgTable('series', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  group: seriesGroupEnum('group').notNull(),
  unit: seriesUnitEnum('unit').notNull(),
  nativeFrequency: frequencyEnum('native_frequency').notNull(),
  provider: providerEnum('provider').notNull(),
  providerParams: jsonb('provider_params').$type<Record<string, string | number>>().notNull(),
  earliest: text('earliest').notNull(),
  supportsLog: boolean('supports_log').notNull(),
  updateCadence: integer('update_cadence').notNull(),
  attribution: text('attribution').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Beobachtungen. Ein Punkt pro (Serie, Zeitstempel).
 * `v` ist bewusst NOT NULL: eine Luecke wird nicht als NULL-Zeile gespeichert,
 * sondern durch das Fehlen der Zeile ausgedrueckt (§11: keine 0-Auffuellung).
 */
export const seriesPoints = pgTable(
  'series_points',
  {
    seriesId: text('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    /** Unix-Sekunden UTC. */
    t: bigint('t', { mode: 'number' }).notNull(),
    v: doublePrecision('v').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.seriesId, table.t] }),
    index('series_points_t_idx').on(table.t),
  ],
);

/**
 * Sync-Zustand pro Serie — Grundlage fuer Delta-Backfill und /api/health (§10).
 * `lastError` wird bewusst persistiert: ein Fehler wird sichtbar gemacht,
 * nicht verschluckt.
 */
export const seriesSyncState = pgTable('series_sync_state', {
  seriesId: text('series_id')
    .primaryKey()
    .references(() => series.id, { onDelete: 'cascade' }),
  lastPointT: bigint('last_point_t', { mode: 'number' }),
  /**
   * Welchen Zeitraum wir bereits **abgefragt** haben — nicht, welchen wir
   * bekommen haben. Der Unterschied ist entscheidend: fragt man einen Tag ab,
   * an dem die Quelle nachweislich nichts hat (Feiertag, Wochenende, Zeit vor
   * dem ersten Handelstag), bliebe ohne diese Notiz eine Luecke bestehen, die
   * bei jeder Anfrage erneut geholt wird — dauerhaft und vergeblich.
   */
  coveredFromT: bigint('covered_from_t', { mode: 'number' }),
  coveredToT: bigint('covered_to_t', { mode: 'number' }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  lastError: text('last_error'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
});

/**
 * Roh-Liquidationen aus dem WS-Ingest (§4.4, Phase 6).
 * Ein Event pro Zeile, unveraendert wie von der Boerse gemeldet.
 */
export const liquidations = pgTable(
  'liquidations',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    exchange: text('exchange').notNull(),
    symbol: text('symbol').notNull(),
    side: liquidationSideEnum('side').notNull(),
    price: doublePrecision('price').notNull(),
    qty: doublePrecision('qty').notNull(),
    quoteQty: doublePrecision('quote_qty').notNull(),
    /** Unix-Sekunden UTC, wie von der Boerse gemeldet. */
    t: bigint('t', { mode: 'number' }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('liquidations_t_idx').on(table.t),
    index('liquidations_symbol_t_idx').on(table.symbol, table.t),
    uniqueIndex('liquidations_dedupe_idx').on(
      table.exchange,
      table.symbol,
      table.t,
      table.price,
      table.qty,
    ),
  ],
);

/**
 * Protokoll aller ausgehenden Provider-Requests.
 * Speist /api/health (§10): letzter Erfolg, Fehlerquote 1h, Monatsbudget.
 */
export const providerRequests = pgTable(
  'provider_requests',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    provider: providerEnum('provider').notNull(),
    endpoint: text('endpoint').notNull(),
    httpStatus: integer('http_status'),
    durationMs: integer('duration_ms').notNull(),
    ok: boolean('ok').notNull(),
    error: text('error'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('provider_requests_provider_time_idx').on(table.provider, table.requestedAt)],
);

/**
 * Cache-Layer 2 (§10). Liegt hier statt in Redis, solange keine REDIS_URL
 * gesetzt ist — siehe docs/adr/0001-cache-backend.md.
 *
 * `expiresAt` ist die harte Grenze. Abgelaufene Eintraege werden beim Lesen
 * ignoriert und beim Schreiben ueberschrieben; ein Aufraeumjob ist optional.
 */
export const cacheEntries = pgTable(
  'cache_entries',
  {
    key: text('key').primaryKey(),
    value: jsonb('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    storedAt: timestamp('stored_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('cache_entries_expires_at_idx').on(table.expiresAt)],
);

/**
 * Token-Bucket pro Provider (§10).
 *
 * `tokens` wird lazy nachgefuellt: beim Zugriff wird aus der verstrichenen Zeit
 * seit `updatedAt` berechnet, wie viele Token dazugekommen sind. Das spart
 * einen Hintergrundjob und ist in einer einzigen atomaren SQL-Anweisung
 * abbildbar — wichtig, damit zwei gleichzeitige Requests nicht dasselbe Token
 * verbrauchen.
 */
export const rateLimitBuckets = pgTable('rate_limit_buckets', {
  /** z.B. 'coingecko:minute' oder 'fred:minute'. */
  bucket: text('bucket').primaryKey(),
  tokens: doublePrecision('tokens').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SeriesRow = typeof series.$inferSelect;
export type NewSeriesRow = typeof series.$inferInsert;
export type SeriesPointRow = typeof seriesPoints.$inferSelect;
export type NewSeriesPointRow = typeof seriesPoints.$inferInsert;
export type LiquidationRow = typeof liquidations.$inferSelect;
export type NewLiquidationRow = typeof liquidations.$inferInsert;
