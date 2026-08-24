import { describe, expect, it } from 'vitest';

import { mapEntriesToPoints, __testing as fngTesting } from '@/lib/providers/alternativeme';
import { mapKlinesToPoints, __testing as binanceTesting } from '@/lib/providers/binance';
import { mapRowsToPoints, __testing as cmTesting } from '@/lib/providers/coinmetrics';
import { getProvider, isProviderImplemented, listProviders } from '@/lib/providers';
import {
  assertStrictlyIncreasing,
  clampToRange,
  parseFiniteNumber,
  parseUtcSeconds,
} from '@/lib/providers/util';
import { CATALOG, findDescriptor } from '@/lib/series/catalog';
import { ProviderError } from '@/lib/series/types';

/**
 * Die Fixtures unten sind wörtliche Ausschnitte echter Antworten, erhoben am
 * 2026-08-24 und abgelegt in docs/api-samples/. Konstruierte Daten sind in
 * Testdateien ausdrücklich erlaubt (§11); Laufzeitcode importiert diese
 * Fixtures nicht — das erzwingt check:no-mock.
 */

describe('Binance — Klines', () => {
  // Wörtlich aus docs/api-samples/binance-klines.json
  const REAL_ROWS = [
    [
      1704067200000, '42283.58000000', '44184.10000000', '42180.77000000', '44179.55000000',
      '27174.29903000', 1704153599999, '1169995682.02800140', 1114623, '14331.73180000',
      '617352094.56051940', '0',
    ],
    [
      1704153600000, '44179.55000000', '45879.63000000', '44148.34000000', '44946.91000000',
      '65146.40661000', 1704239999999, '2944331821.82307620', 2247532, '33817.14447000',
      '1527964124.23758480', '0',
    ],
  ];

  it('akzeptiert die echte Response-Shape', () => {
    expect(() => binanceTesting.klinesSchema.parse(REAL_ROWS)).not.toThrow();
  });

  it('nimmt den Close-Kurs und rechnet Millisekunden in Sekunden um', () => {
    const rows = binanceTesting.klinesSchema.parse(REAL_ROWS);
    const points = mapKlinesToPoints(rows, 'btc.usd.close');

    expect(points).toEqual([
      { t: 1_704_067_200, v: 44_179.55 },
      { t: 1_704_153_600, v: 44_946.91 },
    ]);
  });

  it('bildet auf 00:00 UTC ab', () => {
    const rows = binanceTesting.klinesSchema.parse(REAL_ROWS);
    const [first] = mapKlinesToPoints(rows, 'btc.usd.close');
    expect(new Date(first!.t * 1000).toISOString()).toBe('2024-01-01T00:00:00.000Z');
  });

  it('toleriert zusätzliche Felder am Ende, ohne die geprüften Positionen aufzuweichen', () => {
    const withExtra = [[...REAL_ROWS[0]!, 'neues-feld-von-binance']];
    expect(() => binanceTesting.klinesSchema.parse(withExtra)).not.toThrow();
  });

  it('lehnt eine Zeile ab, bei der openTime kein Number ist', () => {
    const broken = [['1704067200000', ...REAL_ROWS[0]!.slice(1)]];
    expect(() => binanceTesting.klinesSchema.parse(broken)).toThrow();
  });

  it('wirft bei nicht-numerischem Close statt still zu überspringen', () => {
    const rows = [[1_704_067_200_000, '1', '1', '1', 'n/a', '1', 1, '1', 1, '1', '1', '0']];
    const parsed = binanceTesting.klinesSchema.parse(rows);
    expect(() => mapKlinesToPoints(parsed, 'btc.usd.close')).toThrow(ProviderError);
  });

  it('verlangt symbol und interval im Descriptor', () => {
    const descriptor = findDescriptor('btc.usd.close')!;
    expect(binanceTesting.readParams(descriptor)).toEqual({
      symbol: 'BTCUSDT',
      interval: '1d',
    });
    expect(() =>
      binanceTesting.readParams({ ...descriptor, providerParams: {} }),
    ).toThrow(/symbol/);
  });
});

describe('Coin Metrics — asset-metrics', () => {
  // Wörtlich aus docs/api-samples/coinmetrics-asset-metrics.json
  const REAL_PAGE = {
    data: [
      {
        asset: 'btc',
        time: '2026-08-21T00:00:00.000000000Z',
        CapMVRVCur: '1.483722221375724402',
        CapMrktCurUSD: '1572928699609.4886537206383584',
        PriceUSD: '78359.170712256',
        SplyCur: '20073319.88473265',
      },
      {
        asset: 'btc',
        time: '2026-08-22T00:00:00.000000000Z',
        CapMVRVCur: '1.457789242610116096',
        CapMrktCurUSD: '1546085345087.560678114102604964',
        PriceUSD: '77020.1308082058',
        SplyCur: '20073782.38473258',
      },
    ],
    next_page_token: '0.MjAyNi0wOC0yMVQwMDowMDowMFo',
    next_page_url: 'https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?next_page_token=x',
  };

  it('akzeptiert die echte Response-Shape mit dynamischen Metriknamen', () => {
    expect(() => cmTesting.pageSchema.parse(REAL_PAGE)).not.toThrow();
  });

  it('akzeptiert eine Seite ohne Folgeseite', () => {
    expect(() => cmTesting.pageSchema.parse({ data: REAL_PAGE.data })).not.toThrow();
  });

  it('parst Nanosekunden-Zeitstempel korrekt zu Unix-Sekunden', () => {
    const points = mapRowsToPoints(REAL_PAGE.data, 'PriceUSD', 'btc.usd.cm');
    expect(new Date(points[0]!.t * 1000).toISOString()).toBe('2026-08-21T00:00:00.000Z');
  });

  it('wählt die angefragte Metrik aus, nicht irgendeine', () => {
    const price = mapRowsToPoints(REAL_PAGE.data, 'PriceUSD', 'btc.usd.cm');
    const mvrv = mapRowsToPoints(REAL_PAGE.data, 'CapMVRVCur', 'onchain.btc.mvrv');

    expect(price[0]!.v).toBeCloseTo(78_359.170_712_256, 6);
    expect(mvrv[0]!.v).toBeCloseTo(1.483_722_221_375_724, 12);
  });

  it('behandelt null als Lücke, nicht als 0', () => {
    const rows = [
      { asset: 'btc', time: '2024-01-01T00:00:00.000000000Z', PriceUSD: '100' },
      { asset: 'btc', time: '2024-01-02T00:00:00.000000000Z', PriceUSD: null },
      { asset: 'btc', time: '2024-01-03T00:00:00.000000000Z', PriceUSD: '102' },
    ];
    const points = mapRowsToPoints(rows, 'PriceUSD', 'btc.usd.cm');

    expect(points).toHaveLength(2);
    expect(points.map((p) => p.v)).toEqual([100, 102]);
    expect(points.some((p) => p.v === 0)).toBe(false);
  });

  it('wirft, wenn die Metrik im Ergebnis gar nicht vorkommt', () => {
    const rows = [{ asset: 'btc', time: '2024-01-01T00:00:00.000000000Z', PriceUSD: '100' }];
    expect(() => mapRowsToPoints(rows, 'CapRealUSD', 'onchain.btc.realized')).toThrow(
      /CapRealUSD/,
    );
  });

  it('setzt paging_from=start — sonst lädt der Backfill die falschen Zeiträume', async () => {
    // Regressionstest zu FINDINGS.md §3. Der Default der API ist `end`.
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('./coinmetrics.ts', import.meta.url), 'utf8'),
    );
    expect(source).toContain("paging_from: 'start'");
  });

  it('formatiert Zeitgrenzen als ISO in UTC', () => {
    expect(cmTesting.toIsoDate(1_704_067_200)).toBe('2024-01-01T00:00:00.000Z');
  });
});

describe('alternative.me — Fear & Greed', () => {
  // Wörtlich aus docs/api-samples/alternativeme-fng.json
  const REAL_RESPONSE = {
    name: 'Fear and Greed Index',
    data: [
      { value: '73', value_classification: 'Greed', timestamp: '1787529600', time_until_update: '47878' },
      { value: '66', value_classification: 'Greed', timestamp: '1787443200' },
      { value: '71', value_classification: 'Greed', timestamp: '1787356800' },
    ],
    metadata: { error: null },
  };

  it('akzeptiert die echte Response-Shape', () => {
    expect(() => fngTesting.fngSchema.parse(REAL_RESPONSE)).not.toThrow();
  });

  it('behandelt time_until_update als optional — es kommt nur beim jüngsten Eintrag', () => {
    expect(() => fngTesting.entrySchema.parse(REAL_RESPONSE.data[1])).not.toThrow();
  });

  it('dreht die absteigende Reihenfolge auf aufsteigend', () => {
    const points = mapEntriesToPoints(REAL_RESPONSE.data, 'sentiment.fng');

    expect(points.map((p) => p.t)).toEqual([1_787_356_800, 1_787_443_200, 1_787_529_600]);
    expect(points.map((p) => p.v)).toEqual([71, 66, 73]);
  });

  it('erkennt einen Fehler im metadata-Kanal', () => {
    const parsed = fngTesting.fngSchema.parse({
      ...REAL_RESPONSE,
      metadata: { error: 'rate limit' },
    });
    expect(parsed.metadata.error).toBe('rate limit');
  });
});

describe('util', () => {
  it('parst Zahlen aus Strings', () => {
    expect(parseFiniteNumber('42.5', 'binance', 'test')).toBe(42.5);
    expect(parseFiniteNumber(' 42.5 ', 'binance', 'test')).toBe(42.5);
    expect(parseFiniteNumber(42.5, 'binance', 'test')).toBe(42.5);
  });

  it('wirft statt NaN oder 0 zurückzugeben', () => {
    expect(() => parseFiniteNumber('', 'binance', 'test')).toThrow(ProviderError);
    expect(() => parseFiniteNumber('abc', 'binance', 'test')).toThrow(ProviderError);
    expect(() => parseFiniteNumber(null, 'binance', 'test')).toThrow(ProviderError);
    expect(() => parseFiniteNumber(Number.NaN, 'binance', 'test')).toThrow(ProviderError);
  });

  it('wirft bei einem unlesbaren Zeitstempel', () => {
    expect(() => parseUtcSeconds('gestern', 'coinmetrics', 'test')).toThrow(ProviderError);
  });

  it('erkennt überlappende Paginierung', () => {
    expect(() =>
      assertStrictlyIncreasing(
        [
          { t: 2, v: 1 },
          { t: 2, v: 1 },
        ],
        'binance',
        'x',
      ),
    ).toThrow(/monoton/);
  });

  it('schneidet auf das Fenster zu, Grenzen inklusiv', () => {
    const points = [
      { t: 10, v: 1 },
      { t: 20, v: 2 },
      { t: 30, v: 3 },
    ];
    expect(clampToRange(points, { from: 20, to: 30 })).toEqual([
      { t: 20, v: 2 },
      { t: 30, v: 3 },
    ]);
  });
});

describe('Katalog', () => {
  it('hat eindeutige IDs', () => {
    const ids = CATALOG.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gibt für jede Serie ein parsbares earliest an', () => {
    for (const d of CATALOG) {
      expect(Number.isFinite(Date.parse(d.earliest)), `${d.id}: ${d.earliest}`).toBe(true);
    }
  });

  it('nennt für jede Serie eine Attribution — Lizenzpflicht nach §15', () => {
    for (const d of CATALOG) {
      expect(d.attribution.length, d.id).toBeGreaterThan(0);
    }
  });

  it('verweist nur auf implementierte Provider', () => {
    for (const d of CATALOG) {
      expect(isProviderImplemented(d.provider), `${d.id} -> ${d.provider}`).toBe(true);
    }
  });

  it('setzt supportsLog=false für den Fear & Greed Index', () => {
    expect(findDescriptor('sentiment.fng')!.supportsLog).toBe(false);
  });
});

describe('Registry', () => {
  it('liefert die implementierten Provider', () => {
    expect(listProviders().map((p) => p.id).sort()).toEqual([
      'alternativeme',
      'binance',
      'coingecko',
      'coinmetrics',
      'derived',
      'fred',
      'yahoo',
    ]);
  });

  it('wirft für einen noch nicht implementierten Provider', () => {
    // Bybit steht in der ProviderId-Union, ist aber noch nicht gebaut.
    expect(() => getProvider('bybit')).toThrow(/noch nicht implementiert/);
  });
});
