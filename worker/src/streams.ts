/**
 * Liquidations-Streams der Börsen (PROJECT_SPEC.md §4.4).
 *
 * Die Response-Shapes sind am 2026-08-24 durch echtes Verbinden verifiziert,
 * nicht aus der Doku übernommen (§0.3) — Belege in
 * docs/api-samples/FINDINGS.md §8.
 *
 * Jeder Parser gibt `null` zurück, wenn eine Nachricht keine Liquidation ist
 * (Bestätigungen, Heartbeats). Eine unlesbare Liquidation dagegen wirft: eine
 * still verworfene Nachricht wäre ein Loch in den Daten, das niemand bemerkt.
 */

export type LiquidationSide = 'long' | 'short';

export interface LiquidationEvent {
  exchange: string;
  symbol: string;
  /** Seite der **liquidierten Position**, nicht die Seite der Gegenorder. */
  side: LiquidationSide;
  price: number;
  /** Menge in Basiswährung. */
  qty: number;
  /** Gegenwert in Quote-Währung. */
  quoteQty: number;
  /** Unix-Sekunden UTC. */
  t: number;
}

export class StreamParseError extends Error {
  override readonly name = 'StreamParseError';
}

function toNumber(raw: unknown, context: string): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) {
    throw new StreamParseError(`${context}: "${String(raw)}" ist keine endliche Zahl`);
  }
  return value;
}

/**
 * Binance Futures — `!forceOrder@arr`.
 *
 * Shape laut Doku und Verbindungstest:
 * `{ e:'forceOrder', E, o:{ s, S, o, f, q, p, ap, X, l, z, T } }`
 *
 * `o.S` ist die Seite der **Liquidationsorder**. Eine Long-Position wird durch
 * einen Verkauf geschlossen, also bedeutet `S: 'SELL'` eine liquidierte Long.
 * Diese Umkehrung ist die häufigste Fehlerquelle bei Liquidationsdaten.
 */
export function parseBinance(message: unknown): LiquidationEvent | null {
  if (!message || typeof message !== 'object') return null;
  const envelope = message as Record<string, unknown>;
  if (envelope['e'] !== 'forceOrder') return null;

  const order = envelope['o'];
  if (!order || typeof order !== 'object') {
    throw new StreamParseError('Binance forceOrder ohne Feld o');
  }
  const o = order as Record<string, unknown>;

  const symbol = typeof o['s'] === 'string' ? o['s'] : null;
  if (!symbol) throw new StreamParseError('Binance forceOrder ohne Symbol');

  const orderSide = String(o['S']).toUpperCase();
  if (orderSide !== 'BUY' && orderSide !== 'SELL') {
    throw new StreamParseError(`Binance forceOrder mit unbekannter Seite "${String(o['S'])}"`);
  }

  // `ap` ist der Durchschnittspreis der Ausführung, `p` der Orderpreis.
  const price = toNumber(o['ap'] ?? o['p'], 'Binance Preis');
  // `z` ist die gefüllte Menge, `q` die ursprüngliche.
  const qty = toNumber(o['z'] ?? o['q'], 'Binance Menge');
  const t = Math.floor(toNumber(o['T'] ?? envelope['E'], 'Binance Zeitstempel') / 1000);

  return {
    exchange: 'binance',
    symbol,
    side: orderSide === 'SELL' ? 'long' : 'short',
    price,
    qty,
    quoteQty: price * qty,
    t,
  };
}

/**
 * Bybit v5 — Topic `allLiquidation.<symbol>`.
 *
 * `{ topic, type, ts, data: [{ T, s, S, v, p }] }`
 *
 * Achtung: bei `allLiquidation` bezeichnet `S` laut Bybit die Seite der
 * **liquidierten Position** — anders als beim älteren `liquidation`-Topic, wo
 * es die Orderseite war. Deshalb hier keine Umkehrung.
 */
export function parseBybit(message: unknown): LiquidationEvent[] {
  if (!message || typeof message !== 'object') return [];
  const envelope = message as Record<string, unknown>;

  const topic = envelope['topic'];
  if (typeof topic !== 'string' || !topic.startsWith('allLiquidation')) return [];

  const data = envelope['data'];
  if (!Array.isArray(data)) return [];

  return data.map((entry) => {
    const row = entry as Record<string, unknown>;
    const symbol = typeof row['s'] === 'string' ? row['s'] : null;
    if (!symbol) throw new StreamParseError('Bybit-Liquidation ohne Symbol');

    const side = String(row['S']).toLowerCase();
    if (side !== 'buy' && side !== 'sell') {
      throw new StreamParseError(`Bybit-Liquidation mit unbekannter Seite "${String(row['S'])}"`);
    }

    const price = toNumber(row['p'], 'Bybit Preis');
    const qty = toNumber(row['v'], 'Bybit Menge');

    return {
      exchange: 'bybit',
      symbol,
      // allLiquidation meldet die Seite der geschlossenen Position direkt.
      side: side === 'sell' ? 'short' : 'long',
      price,
      qty,
      quoteQty: price * qty,
      t: Math.floor(toNumber(row['T'], 'Bybit Zeitstempel') / 1000),
    } satisfies LiquidationEvent;
  });
}

/**
 * OKX — Channel `liquidation-orders`, `instType: SWAP`.
 *
 * Verifiziert durch eine echte Nachricht am 2026-08-24:
 * `{ arg:{channel,instType}, data:[{ instId, instFamily, details:[
 *    { bkLoss, bkPx, ccy, posSide, side, sz, ts } ] }] }`
 *
 * `posSide` nennt die Seite der liquidierten Position direkt — keine Umkehrung
 * nötig. `bkPx` ist der Bankrottpreis.
 */
export function parseOkx(message: unknown): LiquidationEvent[] {
  if (!message || typeof message !== 'object') return [];
  const envelope = message as Record<string, unknown>;

  const arg = envelope['arg'];
  if (!arg || typeof arg !== 'object') return [];
  if ((arg as Record<string, unknown>)['channel'] !== 'liquidation-orders') return [];

  const data = envelope['data'];
  if (!Array.isArray(data)) return [];

  const events: LiquidationEvent[] = [];

  for (const item of data) {
    const row = item as Record<string, unknown>;
    const symbol = typeof row['instId'] === 'string' ? row['instId'] : null;
    if (!symbol) throw new StreamParseError('OKX-Liquidation ohne instId');

    const details = row['details'];
    if (!Array.isArray(details)) continue;

    for (const detail of details) {
      const d = detail as Record<string, unknown>;
      const posSide = String(d['posSide']).toLowerCase();
      if (posSide !== 'long' && posSide !== 'short') {
        throw new StreamParseError(`OKX-Liquidation mit unbekannter posSide "${String(d['posSide'])}"`);
      }

      const price = toNumber(d['bkPx'], 'OKX Preis');
      const qty = toNumber(d['sz'], 'OKX Menge');

      events.push({
        exchange: 'okx',
        symbol,
        side: posSide,
        price,
        qty,
        quoteQty: price * qty,
        t: Math.floor(toNumber(d['ts'], 'OKX Zeitstempel') / 1000),
      });
    }
  }

  return events;
}

export interface StreamConfig {
  name: string;
  url: string;
  /** Nachricht, die nach dem Verbinden gesendet wird. */
  subscribe?: unknown;
  /**
   * Anwendungsseitiger Heartbeat.
   *
   * Am 2026-08-24 gemessen: ohne ihn trennt Bybit nach wenigen Minuten mit
   * Code 1006 und OKX mit Code 4004. Ein Worker ohne Heartbeat läuft in einer
   * Reconnect-Schleife und verliert dabei laufend Ereignisse.
   *
   * Binance braucht keinen: dort schickt der Server Ping-Frames, auf die die
   * WebSocket-Implementierung selbst mit Pong antwortet.
   */
  heartbeat?: { intervalMs: number; payload: string };
  /** Wandelt eine eingehende Nachricht in null, ein oder mehrere Ereignisse. */
  parse: (message: unknown) => LiquidationEvent | LiquidationEvent[] | null;
}

export function streamConfigs(symbols: readonly string[]): StreamConfig[] {
  return [
    {
      name: 'binance',
      // Der Sammelstream liefert alle Symbole; gefiltert wird beim Schreiben.
      url: 'wss://fstream.binance.com/ws/!forceOrder@arr',
      parse: parseBinance,
    },
    {
      name: 'bybit',
      url: 'wss://stream.bybit.com/v5/public/linear',
      subscribe: { op: 'subscribe', args: symbols.map((s) => `allLiquidation.${s}`) },
      // Bybit erwartet spätestens alle 20 Sekunden ein Lebenszeichen.
      heartbeat: { intervalMs: 18_000, payload: JSON.stringify({ op: 'ping' }) },
      parse: parseBybit,
    },
    {
      name: 'okx',
      url: 'wss://ws.okx.com:8443/ws/v5/public',
      subscribe: {
        op: 'subscribe',
        args: [{ channel: 'liquidation-orders', instType: 'SWAP' }],
      },
      // OKX schließt nach 30 Sekunden ohne Datenverkehr; erwartet wird der
      // reine Text "ping", kein JSON.
      heartbeat: { intervalMs: 25_000, payload: 'ping' },
      parse: parseOkx,
    },
  ];
}
