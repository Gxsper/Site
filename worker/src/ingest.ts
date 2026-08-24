/**
 * WebSocket-Ingest für Liquidationen (PROJECT_SPEC.md §3, §4.4, Phase 6).
 *
 * Verbindet sich mit Binance, Bybit und OKX, schreibt jedes Ereignis nach
 * Postgres und hält die Verbindungen mit exponentiellem Backoff offen.
 *
 * ══ Was dieser Prozess bewusst nicht tut ══
 *
 * Er erfindet nichts. Bricht eine Verbindung ab, entsteht eine Lücke in den
 * Daten — die wird protokolliert und ist im UI am fehlenden Balken sichtbar.
 * Es wird nicht interpoliert und kein Ereignis geschätzt (§11).
 *
 * Start:  npm run worker
 * Stopp:  Strg-C — offene Verbindungen werden sauber geschlossen.
 */

import { Pool } from 'pg';

import { loadRootEnv } from './env.js';
import { normalizeSymbol, streamConfigs, type LiquidationEvent } from './streams.js';

loadRootEnv();

/** Symbole, die verfolgt werden. Binance liefert alle, hier wird gefiltert. */
const SYMBOLS = ['BTCUSDT', 'ETHUSDT'] as const;

/** Ereignisse werden gebündelt geschrieben, nicht einzeln. */
const FLUSH_INTERVAL_MS = 2000;
const MAX_BATCH = 500;

const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60_000;

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error(
    'DATABASE_URL fehlt. .env.example nach .env.local kopieren und ausfuellen.\n' +
      'Der Worker schreibt Liquidationen direkt in Postgres und kann ohne Datenbank nichts tun.',
  );
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl, max: 4, options: '-c timezone=UTC' });

const queue: LiquidationEvent[] = [];
const stats = { received: 0, written: 0, dropped: 0, parseErrors: 0 };
let shuttingDown = false;

/** Jitter ohne Math.random — dieselbe Regel wie im Web-Code (§11). */
function jitter(maxMs: number): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return (buffer[0]! / 0xff_ff_ff_ff) * maxMs;
}

function backoff(attempt: number): number {
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  return exponential + jitter(exponential / 2);
}

/**
 * Bringt ein Ereignis auf die einheitliche Symbolschreibweise oder verwirft es.
 * Verworfen wird nur, was wir nicht einordnen können — nie geraten.
 */
function canonicalise(event: LiquidationEvent): LiquidationEvent | null {
  const symbol = normalizeSymbol(event.symbol, SYMBOLS);
  return symbol === null ? null : { ...event, symbol };
}

/**
 * Schreibt den Puffer. Der Unique-Index auf
 * (exchange, symbol, t, price, qty) fängt Duplikate ab, die beim
 * Wiederverbinden entstehen können.
 */
async function flush(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue.splice(0, MAX_BATCH);

  const values: unknown[] = [];
  const rows: string[] = [];

  for (const [index, event] of batch.entries()) {
    const base = index * 7;
    rows.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`);
    values.push(event.exchange, event.symbol, event.side, event.price, event.qty, event.quoteQty, event.t);
  }

  const sql =
    'INSERT INTO liquidations (exchange, symbol, side, price, qty, quote_qty, t) VALUES ' +
    rows.join(',') +
    ' ON CONFLICT DO NOTHING';

  try {
    const result = await pool.query(sql, values);
    stats.written += result.rowCount ?? 0;
  } catch (error) {
    // Zurück in die Warteschlange: lieber später schreiben als verlieren.
    queue.unshift(...batch);
    console.error('Schreiben fehlgeschlagen, Ereignisse bleiben in der Warteschlange:', error);
  }
}

function connect(config: ReturnType<typeof streamConfigs>[number], attempt = 0): void {
  if (shuttingDown) return;

  const socket = new WebSocket(config.url);
  let alive = false;
  let heartbeatTimer: NodeJS.Timeout | null = null;

  socket.addEventListener('open', () => {
    alive = true;
    console.log(`[${config.name}] verbunden`);
    if (config.subscribe) socket.send(JSON.stringify(config.subscribe));

    // Ohne Heartbeat trennen Bybit (Code 1006) und OKX (4004) nach wenigen
    // Minuten — gemessen, siehe streams.ts.
    if (config.heartbeat) {
      const { intervalMs, payload } = config.heartbeat;
      heartbeatTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(payload);
      }, intervalMs);
    }
  });

  socket.addEventListener('message', (event) => {
    let payload: unknown;
    try {
      payload = JSON.parse(typeof event.data === 'string' ? event.data : '');
    } catch {
      return; // Kein JSON — Heartbeat oder Binärrahmen.
    }

    let parsed: LiquidationEvent | LiquidationEvent[] | null;
    try {
      parsed = config.parse(payload);
    } catch (error) {
      // Eine unlesbare Liquidation wird gemeldet, nicht stillschweigend verworfen.
      stats.parseErrors++;
      console.error(`[${config.name}] Nachricht nicht lesbar:`, error);
      return;
    }

    if (parsed === null) return;
    const events = Array.isArray(parsed) ? parsed : [parsed];

    for (const liquidation of events) {
      stats.received++;
      const canonical = canonicalise(liquidation);
      if (canonical === null) {
        stats.dropped++;
        continue;
      }
      queue.push(canonical);
    }
  });

  socket.addEventListener('error', () => {
    console.error(`[${config.name}] Verbindungsfehler`);
  });

  socket.addEventListener('close', (event) => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (shuttingDown) return;
    const nextAttempt = alive ? 0 : attempt + 1;
    const wait = backoff(nextAttempt);
    console.error(
      `[${config.name}] getrennt (Code ${event.code}). Neuer Versuch in ${Math.round(wait / 1000)}s. ` +
        `Die Lücke bleibt eine Lücke — es wird nichts nachgereicht.`,
    );
    setTimeout(() => connect(config, nextAttempt), wait);
  });
}

async function main(): Promise<void> {
  console.log('MacroDeck Liquidations-Ingest');
  console.log('Symbole:', SYMBOLS.join(', '));
  console.log('Quellen: Binance Futures, Bybit v5, OKX — kein Coinglass-Abo nötig.\n');

  for (const config of streamConfigs(SYMBOLS)) connect(config);

  const flushTimer = setInterval(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);

  const statsTimer = setInterval(() => {
    console.log(
      `empfangen ${stats.received} · geschrieben ${stats.written} · ` +
        `andere Symbole ${stats.dropped} · Parse-Fehler ${stats.parseErrors} · ` +
        `Warteschlange ${queue.length}`,
    );
  }, 60_000);

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\nBeende, schreibe Warteschlange…');
    clearInterval(flushTimer);
    clearInterval(statsTimer);
    while (queue.length > 0) await flush();
    await pool.end();
    console.log(`Fertig. ${stats.written} Ereignisse geschrieben.`);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
