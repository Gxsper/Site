import { describe, expect, it } from 'vitest';

import {
  parseBinance,
  parseBybit,
  parseOkx,
  StreamParseError,
  streamConfigs,
} from './streams.js';

/**
 * Die OKX-Nachricht unten ist wörtlich das, was am 2026-08-24 über den
 * Live-Stream kam. Binance und Bybit lieferten im Beobachtungsfenster keine
 * Liquidation (sie sind sporadisch); deren Fixtures folgen der dokumentierten
 * Shape und sind als solche gekennzeichnet.
 */

describe('parseOkx — echte Nachricht vom Live-Stream', () => {
  const REAL_MESSAGE = {
    arg: { channel: 'liquidation-orders', instType: 'SWAP' },
    data: [
      {
        details: [
          { bkLoss: '0', bkPx: '137', ccy: '', posSide: 'short', side: 'buy', sz: '1.1', ts: '1787587871263' },
        ],
        instFamily: 'AAVE-USDT',
        instId: 'AAVE-USDT-SWAP',
        instType: 'SWAP',
        uly: 'AAVE-USDT',
      },
    ],
  };

  it('liest die Nachricht vollständig', () => {
    const events = parseOkx(REAL_MESSAGE);

    expect(events).toEqual([
      {
        exchange: 'okx',
        symbol: 'AAVE-USDT-SWAP',
        side: 'short',
        price: 137,
        qty: 1.1,
        quoteQty: expect.closeTo(150.7, 6),
        t: 1_787_587_871,
      },
    ]);
  });

  it('nimmt posSide, nicht side — die Order ist die Gegenseite', () => {
    // posSide 'short' bei side 'buy': eine Short-Position wird durch Kauf geschlossen.
    expect(parseOkx(REAL_MESSAGE)[0]!.side).toBe('short');
  });

  it('rechnet Millisekunden in Sekunden um', () => {
    expect(parseOkx(REAL_MESSAGE)[0]!.t).toBe(Math.floor(1_787_587_871_263 / 1000));
  });

  it('ignoriert die Abo-Bestätigung', () => {
    expect(parseOkx({ event: 'subscribe', arg: { channel: 'liquidation-orders' } })).toEqual([]);
  });

  it('ignoriert einen fremden Channel', () => {
    expect(parseOkx({ arg: { channel: 'tickers' }, data: [{}] })).toEqual([]);
  });

  it('liest mehrere Details in einer Nachricht', () => {
    const events = parseOkx({
      arg: { channel: 'liquidation-orders', instType: 'SWAP' },
      data: [
        {
          instId: 'BTC-USDT-SWAP',
          details: [
            { bkPx: '60000', posSide: 'long', side: 'sell', sz: '2', ts: '1700000000000' },
            { bkPx: '59900', posSide: 'long', side: 'sell', sz: '1', ts: '1700000001000' },
          ],
        },
      ],
    });

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.qty)).toEqual([2, 1]);
  });

  it('wirft bei unbekannter posSide, statt sie zu erraten', () => {
    expect(() =>
      parseOkx({
        arg: { channel: 'liquidation-orders' },
        data: [{ instId: 'X', details: [{ bkPx: '1', posSide: 'seitwärts', sz: '1', ts: '1' }] }],
      }),
    ).toThrow(StreamParseError);
  });
});

describe('parseBinance', () => {
  /** Shape laut Binance-Doku für !forceOrder@arr. */
  const MESSAGE = {
    e: 'forceOrder',
    E: 1_700_000_000_500,
    o: {
      s: 'BTCUSDT',
      S: 'SELL',
      o: 'LIMIT',
      f: 'IOC',
      q: '0.014',
      p: '9910',
      ap: '9910.5',
      X: 'FILLED',
      l: '0.014',
      z: '0.014',
      T: 1_700_000_000_000,
    },
  };

  it('liest die dokumentierte Shape', () => {
    expect(parseBinance(MESSAGE)).toEqual({
      exchange: 'binance',
      symbol: 'BTCUSDT',
      side: 'long',
      price: 9910.5,
      qty: 0.014,
      quoteQty: expect.closeTo(138.747, 3),
      t: 1_700_000_000,
    });
  });

  it('kehrt die Orderseite um — SELL schließt eine Long-Position', () => {
    expect(parseBinance(MESSAGE)!.side).toBe('long');
    expect(parseBinance({ ...MESSAGE, o: { ...MESSAGE.o, S: 'BUY' } })!.side).toBe('short');
  });

  it('bevorzugt den Durchschnittspreis ap vor dem Orderpreis p', () => {
    expect(parseBinance(MESSAGE)!.price).toBe(9910.5);
    const ohneAp = { ...MESSAGE, o: { ...MESSAGE.o, ap: undefined } };
    expect(parseBinance(ohneAp)!.price).toBe(9910);
  });

  it('ignoriert fremde Ereignistypen', () => {
    expect(parseBinance({ e: 'aggTrade' })).toBeNull();
    expect(parseBinance(null)).toBeNull();
  });

  it('wirft bei unbekannter Seite', () => {
    expect(() => parseBinance({ ...MESSAGE, o: { ...MESSAGE.o, S: 'MAYBE' } })).toThrow(
      StreamParseError,
    );
  });

  it('wirft, wenn der Preis keine Zahl ist', () => {
    expect(() => parseBinance({ ...MESSAGE, o: { ...MESSAGE.o, ap: 'teuer' } })).toThrow(
      /keine endliche Zahl/,
    );
  });
});

describe('parseBybit', () => {
  const MESSAGE = {
    topic: 'allLiquidation.BTCUSDT',
    type: 'snapshot',
    ts: 1_700_000_000_100,
    data: [{ T: 1_700_000_000_000, s: 'BTCUSDT', S: 'Sell', v: '0.5', p: '30000' }],
  };

  it('liest die dokumentierte Shape', () => {
    expect(parseBybit(MESSAGE)).toEqual([
      {
        exchange: 'bybit',
        symbol: 'BTCUSDT',
        side: 'short',
        price: 30_000,
        qty: 0.5,
        quoteQty: 15_000,
        t: 1_700_000_000,
      },
    ]);
  });

  it('kehrt bei allLiquidation nicht um — S ist bereits die Positionsseite', () => {
    expect(parseBybit(MESSAGE)[0]!.side).toBe('short');
    expect(parseBybit({ ...MESSAGE, data: [{ ...MESSAGE.data[0], S: 'Buy' }] })[0]!.side).toBe(
      'long',
    );
  });

  it('ignoriert die Abo-Bestätigung', () => {
    expect(parseBybit({ success: true, op: 'subscribe' })).toEqual([]);
  });

  it('ignoriert ein fremdes Topic', () => {
    expect(parseBybit({ topic: 'tickers.BTCUSDT', data: [{}] })).toEqual([]);
  });
});

describe('streamConfigs', () => {
  const configs = streamConfigs(['BTCUSDT', 'ETHUSDT']);

  it('liefert alle drei Börsen', () => {
    expect(configs.map((c) => c.name)).toEqual(['binance', 'bybit', 'okx']);
  });

  it('abonniert bei Bybit alle angefragten Symbole', () => {
    const bybit = configs.find((c) => c.name === 'bybit')!;
    expect(bybit.subscribe).toEqual({
      op: 'subscribe',
      args: ['allLiquidation.BTCUSDT', 'allLiquidation.ETHUSDT'],
    });
  });

  /**
   * Regression: ohne Heartbeat trennt Bybit mit Code 1006 und OKX mit 4004 —
   * am 2026-08-24 gemessen. Der Worker läuft dann in einer Reconnect-Schleife.
   */
  it('setzt für Bybit und OKX einen Heartbeat unter deren Zeitlimit', () => {
    const bybit = configs.find((c) => c.name === 'bybit')!;
    const okx = configs.find((c) => c.name === 'okx')!;

    expect(bybit.heartbeat).toBeDefined();
    expect(bybit.heartbeat!.intervalMs).toBeLessThan(20_000);

    expect(okx.heartbeat).toBeDefined();
    expect(okx.heartbeat!.intervalMs).toBeLessThan(30_000);
    // OKX erwartet den reinen Text, kein JSON.
    expect(okx.heartbeat!.payload).toBe('ping');
  });

  it('braucht für Binance keinen Heartbeat — der Server pingt selbst', () => {
    expect(configs.find((c) => c.name === 'binance')!.heartbeat).toBeUndefined();
  });
});
