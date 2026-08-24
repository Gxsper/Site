# PROJECT SPEC — "MacroDeck" (ITC-Style Crypto/Macro Charting Dashboard)

> **Anleitung:** Diese Datei als `PROJECT_SPEC.md` ins leere Repo legen und Claude Code sagen:
> *"Lies PROJECT_SPEC.md komplett. Arbeite Phase 0 bis Phase 7 ab. Nach jeder Phase: stoppen, Ergebnis zeigen, auf mein OK warten. Halte dich strikt an §11 (No-Mock-Data)."*
> Nicht alles auf einmal bauen lassen — die Phasen in §13 sind bewusst einzeln abarbeitbar.

---

## 0. Grundregeln für den Agenten (nicht verhandelbar)

1. **Keine Demo-, Fake-, Sample- oder Fallback-Daten.** Nie `Math.random()`, keine hardcodierten Arrays, keine "wenn API fehlschlägt, generiere plausible Werte". Details in §11.
2. **Keine API-Keys im Browser.** Jeder Provider wird ausschließlich über eigene Server-Route-Handler proxied.
3. **Kein Endpoint aus dem Gedächtnis.** Vor der Implementierung jedes Providers: offizielle Doku fetchen und die tatsächliche Response-Shape verifizieren. Response-Beispiel als Fixture in `docs/api-samples/<provider>.json` ablegen (nur zu Doku-Zwecken, **nie** als Datenquelle zur Laufzeit).
4. **Zeit ist immer UTC**, intern immer Unix-Sekunden. Keine lokalen Zeitzonen in der Datenschicht.
5. **Typen zuerst.** Jeder Provider bekommt ein Zod-Schema; Parse-Fehler = harter Fehler, kein stiller Fallback.

---

## 1. Produktziel & Reverse Engineering von IntoTheCryptoverse

Ziel ist ein persönliches Analyse-Dashboard, das die *Struktur* von ITC nachbildet: nicht "Preischart mit Indikatoren", sondern **Zyklus- und Bewertungsanalyse mit Makro-Kontext**. Coinglass liefert das Derivate-/Liquidations-Modul.

### 1.1 Was ITC funktional ausmacht (die Bausteine, die nachgebaut werden)

| ITC-Baustein | Was es tatsächlich ist | Nachbau in diesem Projekt |
|---|---|---|
| **Risk Metric** (0–1, farbcodiert) | Normalisierte Abweichung des Preises von seinem langfristigen Trend, über die gesamte Historie min-max-normalisiert | §6.1 — eigene, offengelegte Formel |
| **Logarithmic Regression Bands** | OLS-Fit von `log(price)` gegen `log(days since genesis)` + Quantilbänder der Residuen | §6.2 |
| **ROI / Cycle Comparison** | Preis normalisiert auf 100 ab Zyklus-Tief (Halving oder Bear-Bottom), Zyklen übereinandergelegt | §6.3 |
| **Dominance / Ratio Charts** | BTC.D, ETH/BTC, TOTAL2, TOTAL3, OTHERS | §6.4 |
| **Macro Overlays** | BTC vs. SPX/NDX/DXY/Gold/US10Y/M2/Net Liquidity, mit Korrelationsband | §5 + §8 |
| **On-Chain Valuation** | MVRV, MVRV-Z, Realized Price, SOPR, Puell, Thermocap | §6.5 |
| **Fear & Greed / Sentiment** | Alternative.me Index | §6.6 |
| **Risk-adjusted Returns** | Sharpe/Sortino rollierend, Drawdown-Chart | §6.7 |
| — (ITC hat das nicht) | **Liquidation Heatmap + OI + Funding** | §7 (Coinglass / eigener WS-Ingest) |

### 1.2 Was ITC *nicht* ist — und was wir deshalb weglassen
Kein Orderbuch-Trading, keine Signale/Alerts als "Kaufempfehlung", keine Backtesting-Engine in v1. Fokus: **Charts überlagern, normalisieren, korrelieren.**

---

## 2. Tech Stack (fix, nicht diskutieren)

```
Next.js 15 (App Router) + TypeScript strict
Tailwind CSS + shadcn/ui        → UI
lightweight-charts v5 (^5.2)    → alle Zeitreihen-Charts
Apache ECharts                  → Liquidation-Heatmap (2D-Matrix, kann LWC nicht nativ)
TanStack Query v5               → Client-Cache, Polling, Stale-Handling
Zustand                         → Chart-/Overlay-State (Selektion, Normalisierung, Zeitraum)
Zod                             → Runtime-Validierung aller externen Responses
Drizzle ORM + PostgreSQL 16     → historische Zeitreihen + Liquidations-Events
                                  (lokal via docker-compose; TimescaleDB-Extension optional)
ioredis + Redis                 → Response-Cache / Rate-Limit-Token-Bucket
Node Worker (tsx, separater Prozess) → WebSocket-Ingest (Live-Preise, Liquidations)
Vitest + Playwright             → Tests
```

**Wichtige Version-Fallen:**
- lightweight-charts **v5** hat Breaking Changes vs. v4: `chart.addSeries(LineSeries, opts)` statt `chart.addLineSeries(opts)`; Marker via `createSeriesMarkers(series, markers)` — `series.setMarkers()` existiert **nicht** mehr. Vor dem ersten Chart: `node_modules/lightweight-charts/dist/typings.d.ts` lesen, lokale Typings schlagen jede Doku.
- Das Repo von TradingView liefert eine Agent Skill für Claude Code mit (`.github/skills/lightweight-charts/`). Wenn verfügbar: installieren und nutzen.
- Watermark/Attribution ist **Lizenzpflicht** bei lightweight-charts (siehe §15).

---

## 3. Architektur

```
apps/web (Next.js)
├─ app/
│  ├─ (dashboard)/
│  │   ├─ page.tsx                    → Overlay-Studio (Hauptseite)
│  │   ├─ risk/page.tsx               → Risk-Metric-Dashboard
│  │   ├─ macro/page.tsx              → Fed / Liquidity
│  │   ├─ derivatives/page.tsx        → Liquidation Heatmap, OI, Funding
│  │   └─ onchain/page.tsx
│  └─ api/
│      ├─ series/route.ts             → EINZIGER Chart-Datenendpunkt (siehe §4.0)
│      ├─ catalog/route.ts            → verfügbare Serien + Metadaten
│      ├─ liquidations/heatmap/route.ts
│      └─ health/route.ts             → Provider-Status je Quelle
├─ lib/
│  ├─ providers/                      → je Provider ein Modul, gleiches Interface
│  ├─ series/                         → Alignment, Normalisierung, Transformationen
│  ├─ metrics/                        → Risk, LogReg, MVRV-Z, Net Liquidity …
│  └─ db/
worker/
└─ ingest.ts                          → Binance/Bybit WS → Postgres
```

### 3.1 Das zentrale Abstraktion: `SeriesDescriptor`

Alles im Frontend spricht nur diese eine Sprache. Kein Chart kennt einen Provider.

```ts
// lib/series/types.ts
export type Frequency = 'tick' | '1m' | '5m' | '1h' | '4h' | '1d' | '1w' | '1mo' | 'irregular';

export interface SeriesDescriptor {
  id: string;                 // 'btc.usd.close', 'fred.WALCL', 'spx.close', 'onchain.mvrv'
  label: string;              // 'Bitcoin (USD)'
  group: 'crypto' | 'equities' | 'fx' | 'rates' | 'macro' | 'onchain' | 'derivatives' | 'sentiment';
  unit: 'usd' | 'pct' | 'ratio' | 'index' | 'bps' | 'usd_bn' | 'hashrate' | 'count';
  nativeFrequency: Frequency;
  provider: ProviderId;
  providerParams: Record<string, string | number>;
  earliest: string;           // ISO — echter Start der Historie, NICHT geraten
  supportsLog: boolean;       // false bei Serien die ≤0 werden können (z.B. Net Liquidity delta)
  updateCadence: number;      // Sekunden, bestimmt Cache-TTL und Polling
  attribution: string;        // Pflichttext für die UI
}

export interface SeriesPoint { t: number; v: number; }   // t = Unix seconds UTC
export interface SeriesResponse {
  descriptor: SeriesDescriptor;
  points: SeriesPoint[];
  lastUpdated: number;
  stale: boolean;             // true wenn aus Cache und älter als updateCadence*3
}
```

### 3.2 Provider-Interface

```ts
export interface Provider {
  id: ProviderId;
  catalog(): Promise<SeriesDescriptor[]>;
  fetch(d: SeriesDescriptor, range: {from: number; to: number}): Promise<SeriesPoint[]>;
  // Wirft ProviderError bei Fehler. Gibt NIEMALS ein leeres Array als "Fallback" zurück,
  // um einen Fehler zu verstecken. Leeres Array bedeutet: "in diesem Zeitraum existieren
  // nachweislich keine Daten".
}
```

---

## 4. Datenquellen — konkret

### 4.0 Ein einziger Chart-Endpoint

`GET /api/series?ids=btc.usd.close,fred.WALCL&from=…&to=…&freq=1d&norm=rebase100`

Der Server macht: Provider-Fetch (parallel) → Cache → **Alignment** (§5.1) → **Normalisierung** (§5.2) → Response. Das Frontend rechnet nichts um. Grund: Alignment-Bugs sind die häufigste Fehlerquelle bei Overlays, und serverseitig sind sie einmal testbar.

### 4.1 Crypto — Preise & Marktdaten

**CoinGecko (Demo-Plan, kostenlos)**
- Root: `https://api.coingecko.com/api/v3`, Key als Header `x-cg-demo-api-key` oder Query `x_cg_demo_api_key`
- Limits: 100 calls/min, **10.000 calls/Monat** — das ist das eigentliche Nadelöhr. Aggressiv cachen (§10).
- Endpoints: `/coins/{id}/market_chart/range`, `/global` (BTC-Dominance, Total Market Cap), `/coins/markets`
- ⚠️ **Kritisch:** Der Demo-Plan gibt nur ca. **1 Jahr Historie**. Für Zyklus-Charts über 10+ Jahre ist CoinGecko-Demo unbrauchbar → siehe Binance/Coin Metrics unten. CoinGecko benutzen wir für: Dominance, Total-Market-Caps, Coin-Metadaten, breite Altcoin-Abdeckung.

**Binance Spot/Futures REST (kein Key nötig, volle Historie ab 2017)**
- Klines: `GET https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1000&startTime=…`
  → Paginierung über `startTime` bis `to` erreicht ist. `limit` max 1000.
- Open Interest Historie: `GET https://fapi.binance.com/futures/data/openInterestHist` (⚠️ nur ~30 Tage)
- Funding: `GET https://fapi.binance.com/fapi/v1/fundingRate` (volle Historie, paginiert)
- Long/Short Ratio: `/futures/data/globalLongShortAccountRatio` (30d)
- Für BTC-Historie **vor** 2017: Coin Metrics (unten) verwenden und an Binance ansplicen — Splice-Punkt dokumentieren.

**Bybit v5** als zweite Börse für Aggregation: `https://api.bybit.com/v5/market/kline`, `/v5/market/open-interest`.

**Coin Metrics Community API (kostenlos, lange Historie, on-chain + Preis)**
- `https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=PriceUSD,CapMrktCurUSD,CapRealUSD,SplyCur&frequency=1d&page_size=10000`
- Das ist die **Backbone-Quelle für alles Historische ab 2010**. Community-Tier: 1d-Frequenz, ~10 Metriken pro Call, kein Key.
- Verfügbare Metriken vorher über `/v4/catalog-v2/asset-metrics` abfragen — nicht raten.

### 4.2 Aktien / Indizes / FX

Keine offizielle Gratis-API mit Intraday-SPX. Fallback-Kette, in dieser Reihenfolge:

1. **Stooq CSV** (kostenlos, keine Registrierung, EOD-Daten, tiefe Historie):
   `https://stooq.com/q/d/l/?s=^spx&i=d` → CSV `Date,Open,High,Low,Close,Volume`
   Symbole: `^spx`, `^ndx`, `^dji`, `^vix`, `dx.f` (Dollar-Index-Future), `xauusd`, `xagusd`, `cl.f` (WTI)
2. **FRED** für `SP500`, `NASDAQ100`, `DTWEXBGS` (Dollar-Index, breit) — ⚠️ FRED-Aktienserien haben nur **10 Jahre Historie und 1 Tag Verzögerung**. Als Cross-Check gut, als Primärquelle für Zyklen schlecht.
3. **Bezahlt, falls Intraday nötig:** Twelve Data / Polygon.io / Alpha Vantage (Free-Tier: 25 req/Tag, zu wenig).

Regel: Für Overlays auf Tagesbasis reicht Stooq vollkommen. Intraday-SPX nur bauen, wenn ich es explizit anfordere.

### 4.3 Makro / Fed — FRED

- Root: `https://api.stlouisfed.org/fred/series/observations?series_id=…&api_key=…&file_type=json&observation_start=…`
- Key kostenlos auf `fredaccount.stlouisfed.org`, sofort aktiv. Ohne Key 30 req/min, mit Key 120 req/min.
- Es gibt eine API v2 mit Bearer-Header-Auth (`Authorization: Bearer <key>`) für Bulk-Release-Abfragen. v1 mit `api_key`-Query reicht uns.
- Missing values kommen als `"."` — muss zu `null` geparst und **nicht** zu 0 werden.

**Serien-Katalog (in `lib/providers/fred/series.ts` hart hinterlegen, mit Einheit!):**

| ID | Bedeutung | Frequenz | Einheit ⚠️ |
|---|---|---|---|
| `WALCL` | Fed Total Assets | wöchentl. (Mi) | **Millionen USD** |
| `RRPONTSYD` | Overnight Reverse Repo | täglich | **Milliarden USD** |
| `WTREGEN` | Treasury General Account | wöchentl. | **Milliarden USD** |
| `WRESBAL` | Reserve Balances | wöchentl. | Milliarden USD |
| `M2SL` / `WM2NS` | US M2 (monatl./wöchentl.) | m / w | Milliarden USD |
| `EFFR`, `DFF` | Effective Fed Funds Rate | täglich | Prozent |
| `DGS2`, `DGS10`, `DGS30` | Treasury Yields | täglich | Prozent |
| `T10Y2Y`, `T10Y3M` | Yield-Kurven-Spread | täglich | Prozentpunkte |
| `T10YIE`, `T5YIFR` | Inflation Breakevens | täglich | Prozent |
| `DFII10` | Real Yield 10Y (TIPS) | täglich | Prozent |
| `CPIAUCSL`, `CPILFESL` | CPI / Core CPI | monatl. | Index |
| `UNRATE`, `PAYEMS` | Arbeitsmarkt | monatl. | % / Tsd. |
| `NFCI`, `ANFCI` | Chicago Fed Financial Conditions | wöchentl. | Index (0 = neutral) |
| `VIXCLS` | VIX | täglich | Index |
| `BAMLH0A0HYM2` | High-Yield OAS (Credit Spread) | täglich | Prozentpunkte |
| `DTWEXBGS` | Broad Dollar Index | täglich | Index |
| `SOFR` | SOFR | täglich | Prozent |

**⚠️ Der Net-Liquidity-Fallstrick (häufigster Fehler im Netz):**
`WALCL` ist in **Millionen**, `WTREGEN` und `RRPONTSYD` sind in **Milliarden**. Formel korrekt:

```ts
// alle Werte zuerst auf USD-Milliarden normieren
const netLiquidityBn = (WALCL / 1000) - WTREGEN - RRPONTSYD;
```
Die Serien haben unterschiedliche Frequenzen (wöchentlich vs. täglich) → auf ein tägliches Grid mit **forward-fill** bringen, bevor gerechnet wird (§5.1). Jeder Berechnungsschritt bekommt einen Unit-Test mit einem manuell nachgerechneten Datum.

**Globale Liquidität (ITC-Style "Global M2"):**
FRED-Serien `WM2NS` (US), `MYAGM2EZM196N` (Eurozone), `MYAGM2JPM189S` (Japan), `MYAGM2CNM189N` (China) — **Existenz und exakte IDs vor Nutzung über `fred/series/search` verifizieren**, IDs ändern sich. In USD umrechnen über FRED-FX-Serien (`DEXUSEU`, `DEXJPUS`, `DEXCHUS`). Ergebnis als eigene abgeleitete Serie `macro.global_m2_usd` mit klarer Methodendoku im UI-Tooltip.

**FOMC-Termine:** `https://www.federalreserve.gov/json/ne-fomc.json` (Kalender-JSON) oder `/monetarypolicy/fomccalendars.htm` parsen. Als vertikale Marker im Chart über `createSeriesMarkers`.

### 4.4 Derivate & Liquidationen

**Coinglass API v4** (kostenpflichtig — Hobbyist ~29 $/Monat, Standard ~299 $/Monat; Heatmap-Endpoints sind an Plan-Tiers gebunden, vor dem Kauf prüfen welcher Tier `liquidation/heatmap` enthält):
- Doku-Index für Agenten: `https://docs.coinglass.com/llms.txt` — **das zuerst fetchen**, dann die konkreten Endpoint-Seiten.
- Heatmap: `/api/futures/liquidation/heatmap/model2` (Params: `exchange`, `symbol`, `range` ∈ `12h,24h,3d,7d,30d,90d,180d,1y`)
- Response-Shape: `{ y_axis: number[], liquidation_leverage_data: [xIdx, yIdx, value][], price_candlesticks: [ts, o,h,l,c,vol][] }`
- Auth-Header: `CG-API-KEY`. Base-URL aus der Doku übernehmen, nicht raten.
- Weiter relevant: `/futures/openInterest/ohlc-aggregated-history`, `/futures/fundingRate/…`, `/futures/liquidation/aggregated-history`, ETF-Flows.

**Kostenloser Eigenbau als Alternative/Ergänzung** (wenn kein Coinglass-Abo):
- Live-Liquidationsstrom: Binance Futures WS `wss://fstream.binance.com/ws/!forceOrder@arr`, Bybit v5 WS `wss://stream.bybit.com/v5/public/linear` Topic `allLiquidation.BTCUSDT`, OKX `liquidation-orders`.
- Worker schreibt jedes Event nach Postgres (`liquidations`-Tabelle). Daraus baubar: Liquidations-Balken pro Interval, Long/Short-Split, Cascade-Detection.
- ⚠️ Ehrlich sein im UI: Eine echte **Heatmap** (erwartete zukünftige Liquidationslevel) ist ein *Modell* aus Open Interest × angenommener Leverage-Verteilung, keine Messung. Wenn wir sie selbst modellieren, muss im Chart stehen: "Modelliert aus OI + Leverage-Annahme, keine Broker-Daten." Kein Vortäuschen von Coinglass-Qualität.

### 4.5 On-Chain

- **Coin Metrics Community** (siehe 4.1): `CapMrktCurUSD`, `CapRealUSD`, `SplyCur`, `AdrActCnt`, `TxCnt`, `FeeTotUSD`, `HashRate`, `RevUSD` → daraus MVRV, Realized Price, Puell, Thermocap selbst berechnen (§6.5). **Selbst rechnen ist besser als fertige Metriken zu kaufen**, weil die Formel dann im Repo dokumentiert und testbar ist.
- **mempool.space**: `https://mempool.space/api/v1/mining/hashrate/3y`, Difficulty-Adjustments, Fees.
- **blockchain.info/charts**: `https://api.blockchain.info/charts/{chart}?timespan=all&format=json`

### 4.6 Sentiment

- Fear & Greed: `https://api.alternative.me/fng/?limit=0&format=json` (volle Historie ab 2018, kein Key).

---

## 5. Kernstück: Die Overlay-Engine

Das ist der eigentliche Wert der App. Hier bitte am sorgfältigsten arbeiten.

### 5.1 Alignment (`lib/series/align.ts`)

Problem: BTC handelt 24/7, SPX nur werktags, WALCL wöchentlich mittwochs, CPI monatlich. Naives Zusammenwerfen erzeugt falsche Korrelationen und verschobene Charts.

```ts
export type AlignMode =
  | 'union_ffill'      // Default: Vereinigung aller Timestamps, Lücken forward-fill
  | 'intersection'     // nur Zeitpunkte, an denen ALLE Serien echte Werte haben
  | 'trading_days'     // Grid = Handelstage der Referenzserie (für Aktien-Vergleiche)
  | 'native';          // keine Angleichung, jede Serie eigene Punkte (nur bei 1 Achse sinnvoll)

export function alignSeries(
  series: SeriesResponse[],
  opts: { mode: AlignMode; grid: Frequency; from: number; to: number }
): { t: number[]; values: (number | null)[][] }
```

Regeln:
- **Forward-fill nur vorwärts, nie rückwärts.** Ein CPI-Wert vom 1. März darf nicht am 20. Februar erscheinen (Look-ahead-Bias).
- Forward-fill hat ein **Max-Alter** pro Frequenz (täglich: 5 Tage, wöchentlich: 10, monatlich: 45). Danach `null`, nicht endlos verlängern.
- Vor dem `earliest` einer Serie: immer `null`, nie 0.
- **Für Korrelationen ist `intersection` Pflicht** — ffill erzeugt künstliche Autokorrelation und schönt r.
- Bei `grid: '1d'` ist der Tages-Cut **00:00 UTC**.

### 5.2 Normalisierung (`lib/series/normalize.ts`)

```ts
export type NormMode =
  | 'raw'          // Originalwerte, zweite Preisachse rechts
  | 'rebase100'    // alle Serien = 100 am ersten gemeinsamen Datum  ← Default für Overlays
  | 'pct_change'   // % seit t0
  | 'zscore'       // (x - rollMean) / rollStd, Fenster konfigurierbar (Default 365)
  | 'minmax'       // 0..1 über sichtbaren Zeitraum
  | 'log_returns'  // ln(x_t / x_{t-1})
  | 'yoy';         // Veränderung ggü. Vorjahr in %
```
- **Rebasing bezieht sich immer auf den sichtbaren Zeitraum**, nicht auf den geladenen. Ändert der User den Zeitraum, wird neu rebased. (Das ist das Verhalten, das man von ITC/TradingView erwartet.)
- Log-Skala-Toggle ist unabhängig von der Normalisierung, aber bei `pct_change` und `zscore` deaktiviert (Werte ≤ 0 möglich).

### 5.3 Transformationen pro Serie (Overlay-Regler)

Jede Serie im Overlay hat eigene Regler, weil genau das der ITC-Workflow ist:
- **Lead/Lag Shift** in Tagen (z. B. "Global M2 um 90 Tage nach vorn verschoben") — mit deutlicher Beschriftung im Legend-Eintrag: `Global M2 (+90d)`.
- **Glättung**: SMA/EMA n Tage.
- **Invertieren** (`× -1` bzw. bei rebase: Kehrwert) — für DXY vs. BTC.
- **Achse**: links / rechts / eigene.
- **Sichtbarkeit, Farbe, Linienstärke.**

### 5.4 Korrelations-Panel

Unter jedem Overlay-Chart:
- Rollierende Pearson-Korrelation der **log returns** (nicht der Levels!) über 30/90/365 Tage, umschaltbar.
- Lead-Lag-Kreuzkorrelation: r für Shifts −180…+180 Tage als kleines Balkendiagramm, Maximum markiert.
- Anzeige der Stichprobengröße n und Hinweis, wenn `union_ffill` aktiv ist ("Korrelation auf gefüllten Daten — nutze Intersection-Modus für saubere Werte").

### 5.5 Chart-Implementierung (lightweight-charts v5)

```ts
import { createChart, LineSeries, AreaSeries, CandlestickSeries, createSeriesMarkers } from 'lightweight-charts';

const chart = createChart(el, {
  layout: { background: { color: 'transparent' }, textColor: '#d1d5db', attributionLogo: true },
  rightPriceScale: { visible: true, scaleMargins: { top: 0.1, bottom: 0.15 } },
  leftPriceScale:  { visible: true },
  timeScale: { timeVisible: true, secondsVisible: false },
  crosshair: { mode: 1 },
});

const btc = chart.addSeries(LineSeries, { priceScaleId: 'right', color: '#f7931a' });
btc.setData(points.map(p => ({ time: p.t as UTCTimestamp, value: p.v })));
```
Fallen: `time` muss aufsteigend und **duplikatfrei** sein, sonst wirft LWC. `setData` bei jedem Overlay-Wechsel neu, `update()` nur für den letzten Live-Punkt. Bei Log-Skala: `priceScale.applyOptions({ mode: PriceScaleMode.Logarithmic })`.

---

## 6. Metriken-Katalog (Formeln offenlegen)

Jede Metrik lebt in `lib/metrics/<name>.ts`, hat einen Unit-Test mit mindestens 3 manuell nachgerechneten Datenpunkten, und einen `methodology`-String, der im UI als Info-Tooltip erscheint.

### 6.1 Risk Metric (ITC-Nachbau, eigene Definition)

ITCs exakte Formel ist proprietär. Wir bauen eine transparente Annäherung:

```
1. logreg_dev   = log10(price) − logRegFit(t)                    [§6.2]
2. ma_ratio     = log10(price / SMA(price, 365))
3. mayer        = log10(price / SMA(price, 200))
4. raw          = 0.5·z(logreg_dev) + 0.3·z(ma_ratio) + 0.2·z(mayer)
   (z = Standardisierung über die GESAMTE verfügbare Historie, nicht rollierend)
5. risk         = minmax(raw) über gesamte Historie → [0,1]
6. Darstellung: Preis (log) mit Farbskala nach risk (blau 0 → rot 1)
```
⚠️ Diese Metrik ist **rückwirkend nicht stabil**: neue Extremwerte reskalieren die Vergangenheit. Das muss im UI stehen. Optional zusätzlich eine "expanding window"-Variante berechnen, die nur Daten bis t nutzt (kein Look-ahead) — die ist ehrlicher für Backtests.

### 6.2 Logarithmic Regression Bands

```
x = ln(days_since_genesis)      genesis = 2009-01-03
y = ln(price)
OLS: y = a·x + b
Residuen r = y − ŷ
Bänder bei den Quantilen r_q für q ∈ {0.01,0.05,0.25,0.5,0.75,0.95,0.99}
Ausgabe: exp(ŷ + r_q)
```
Fit-Zeitraum als Parameter (Default: gesamte Historie). Anzeigen: R², Fit-Zeitraum, letzter Update-Zeitpunkt.

### 6.3 Cycle Comparison

Anker wählbar: Halving-Daten (2012-11-28, 2016-07-09, 2020-05-11, 2024-04-20 — künftige aus Blockhöhe berechnen), oder Zyklus-Tiefs (2011-11-18, 2015-01-14, 2018-12-15, 2022-11-21). X-Achse = Tage seit Anker, Y = Preis rebased auf 100, log. Aktueller Zyklus hervorgehoben.

### 6.4 Dominance & Ratios
`BTC.D = btc_mcap / total_mcap` aus CoinGecko `/global`; `TOTAL2 = total − btc`; `TOTAL3 = total − btc − eth`; `OTHERS = total − top10`. ETH/BTC direkt aus Klines.

### 6.5 On-Chain-Bewertung
```
Realized Price = CapRealUSD / SplyCur
MVRV           = CapMrktCurUSD / CapRealUSD
MVRV-Z         = (CapMrktCurUSD − CapRealUSD) / stdev(CapMrktCurUSD)   [expanding window]
Puell Multiple = RevUSD / SMA(RevUSD, 365)
Thermocap Mult = CapMrktCurUSD / kumulierte Miner-Revenue
NUPL           = (CapMrktCurUSD − CapRealUSD) / CapMrktCurUSD
```

### 6.6 Sentiment
Fear & Greed als Histogramm-Overlay unter dem Preis-Chart.

### 6.7 Risk-adjusted
Rollierender Sharpe (365d, rf = `DGS3MO`/365), Sortino, Max Drawdown, Underwater-Chart, Volatilität (30d/90d annualisiert).

---

## 7. Derivate-Seite

- **Liquidation Heatmap**: ECharts `heatmap` mit `visualMap` (logarithmische Farbskala, sonst dominiert ein Cluster alles). X = Zeit, Y = Preislevel, dazu Preis-Linie als zweite Serie im selben Grid. Wenn Coinglass verfügbar: `liquidation_leverage_data` direkt in `[xIdx, yIdx, value]` mappen (Shape passt bereits).
- **Live-Liquidations-Tape**: WS-Stream, Tabelle + Balken pro Minute, Long/Short gefärbt, Aggregation über Börsen.
- **Open Interest** (aggregiert + pro Börse), **Funding Rates** (aktuell + Historie + kumuliert), **Long/Short Ratio**, **Basis / Annualized Premium**.
- **Kontext-Panel**: OI-Änderung vs. Preisänderung → klassifizieren als Long-Aufbau / Short-Squeeze / Deleveraging.

---

## 8. Macro-Seite

- Net Liquidity (§4.3) als Hauptchart, BTC überlagert, Lead-Lag-Regler prominent.
- Fed Balance Sheet Komponenten (WALCL, TGA, RRP) als Stacked Area.
- Zinskurve: aktuelle Kurve (1M–30Y) + historische Kurven als Vergleich, plus `T10Y2Y`-Zeitreihe mit Rezessionsschattierung (`USREC`).
- Real Yields vs. Gold vs. BTC.
- Financial Conditions (NFCI) + Credit Spreads (HY OAS) als Risk-On/Off-Indikator.
- FOMC-Marker + nächster Termin als Countdown.
- **Release-Kalender**: kommende FRED-Releases via `fred/releases/dates`.

---

## 9. UI/UX

- Dark-first, dichte Informationsdarstellung (Bloomberg-Anmutung, nicht Consumer-App). Schriftgröße klein, Zahlen tabellarisch (`font-variant-numeric: tabular-nums`).
- **Overlay-Studio** (Startseite): links Serien-Browser (Suchfeld, Gruppen aus §3.1), Mitte Chart, rechts Layer-Panel mit den Reglern aus §5.3.
- Zeitraum-Presets: 1M / 3M / 6M / YTD / 1Y / 2Y / 4Y (Zyklus) / MAX.
- **Layouts speicherbar** (URL-State + localStorage): `?s=btc.usd.close,fred.WALCL&norm=rebase100&shift=0,90&from=…`. Damit sind Charts teilbar.
- Jede Serie zeigt im Tooltip: Quelle, letzte Aktualisierung, native Frequenz, ob gerade forward-gefillt.
- Attribution-Leiste unten: CoinGecko, TradingView Lightweight Charts, FRED, Coin Metrics, Coinglass.

---

## 10. Caching & Rate-Limits

```
Layer 1: Postgres  → alle historischen Tagesdaten dauerhaft. Einmal geholt = nie wieder holen.
                     Nachtjob (cron) holt nur das Delta seit letztem Punkt.
Layer 2: Redis     → TTL nach updateCadence:
                     Live-Preise 15s | Intraday 60s | Tagesdaten 1h | FRED wöchentl. 6h | statisch 24h
Layer 3: TanStack Query im Client (staleTime = updateCadence)
```
- **Token-Bucket pro Provider** in Redis, konservativ unter dem offiziellen Limit (CoinGecko: 60/min bei erlaubten 100, und ein Monats-Zähler bei 10.000 Calls mit Warnung ab 80 %).
- Exponentielles Backoff bei 429, Jitter, max 3 Retries. Bei Aufgabe: Fehler durchreichen (§11), nicht raten.
- `/api/health` zeigt pro Provider: letzter Erfolg, Fehlerquote 1h, verbrauchtes Monats-Budget.

---

## 11. NO-MOCK-DATA — harte Regeln

Das ist die wichtigste Anforderung des Projekts.

**Verboten:**
- `Math.random()` in jeglichem Daten-, Metrik- oder Chart-Pfad
- hardcodierte Preis-/Zeitreihen-Arrays außerhalb von `*.test.ts`
- `catch { return generatePlaceholder() }` oder ähnliche stille Ersatzwerte
- Interpolation über Lücken **ohne** visuelle Kennzeichnung
- "Beispieldaten" in Komponenten-Defaults, Storybook-Stories die im Prod-Bundle landen
- Zahlen im UI, die nicht auf einen `SeriesResponse` mit `lastUpdated` zurückführbar sind

**Stattdessen — definierte Fehlerzustände:**
| Situation | Verhalten |
|---|---|
| Provider down / 5xx | Chart zeigt Serie ausgegraut + Banner „Quelle X nicht erreichbar (seit HH:MM)". Andere Serien rendern normal. |
| Rate Limit erreicht | Cache-Wert anzeigen **mit sichtbarem Stale-Badge** und Alter, dazu Zeit bis Reset |
| Datenlücke in der Historie | Linie unterbrochen (`null`, `whitespace data`), nicht interpoliert |
| Serie beginnt später als Zeitraum | Linie startet später. Kein Auffüllen mit 0 oder erstem Wert. |
| Metrik braucht fehlenden Input | Metrik nicht rendern + Grund nennen („MVRV-Z benötigt CapRealUSD, Coin Metrics nicht erreichbar") |

**Durchsetzung im Code:**
```ts
// lib/guard.ts
export function assertRealData(r: SeriesResponse) {
  if (!r.lastUpdated) throw new Error(`Series ${r.descriptor.id}: kein lastUpdated — Herkunft unklar`);
  if (r.points.some(p => !Number.isFinite(p.v))) throw new Error(`Series ${r.descriptor.id}: non-finite value`);
  const ts = r.points.map(p => p.t);
  if (ts.some((t, i) => i > 0 && t <= ts[i-1])) throw new Error(`Series ${r.descriptor.id}: Zeitstempel nicht streng monoton`);
}
```
Plus ein CI-Check (`npm run check:no-mock`), der `src/` und `app/` nach `Math.random|faker|mockData|sampleData|DUMMY|placeholderSeries` durchsucht und bei Treffern außerhalb von `**/*.test.ts` den Build failt. **Diesen Check in Phase 0 anlegen, nicht am Ende.**

---

## 12. Environment

```bash
# .env.example  (echte Werte in .env.local, nie committen)
COINGECKO_API_KEY=            # optional (Demo-Plan), erhöht Stabilität
FRED_API_KEY=                 # Pflicht — fredaccount.stlouisfed.org
COINGLASS_API_KEY=            # optional, nur wenn Abo vorhanden
DATABASE_URL=postgres://macro:macro@localhost:5432/macrodeck
REDIS_URL=redis://localhost:6379
ENABLE_WS_INGEST=true
LOG_LEVEL=info
```
Beim Start: alle als Pflicht markierten Keys validieren (Zod), sonst harter Abbruch mit klarer Meldung, welcher Key wo zu holen ist. Fehlt `COINGLASS_API_KEY`, wird die Derivate-Seite mit Hinweis „Coinglass nicht konfiguriert — Eigen-Ingest aktiv (modelliert)" gerendert, **nicht** mit Fantasiedaten.

---

## 13. Build-Phasen (nach jeder Phase stoppen)

**Phase 0 — Fundament**
Repo, Next.js 15 + TS strict, Tailwind, shadcn, docker-compose (Postgres + Redis), Drizzle-Schema, `.env`-Validierung, `check:no-mock`-Script, Vitest, `CLAUDE.md` mit den Regeln aus §0 und §11. Kein UI.
*Akzeptanz:* `npm run dev`, `npm run check:no-mock`, `npm test` laufen grün.

**Phase 1 — Datenschicht**
Provider-Interface, FRED- + Binance- + Coin-Metrics- + Stooq-Provider. Zod-Schemas. Redis-Cache + Token-Bucket. `/api/series` und `/api/catalog`. Backfill-Script (`npm run backfill -- --series btc.usd.close --from 2013-01-01`).
*Akzeptanz:* `curl '/api/series?ids=btc.usd.close&from=…'` liefert echte Punkte ab 2013; DB enthält sie; zweiter Call kommt aus Cache. FRED-Netto-Liquidität für ein manuell geprüftes Datum stimmt auf 1 Mrd. genau.

**Phase 2 — Overlay-Engine**
`align.ts`, `normalize.ts`, Transformationen, Korrelation. Vitest-Suite mit konstruierten Fällen (Feiertagslücke, Frequenzmix, Serie beginnt später, Lücke > max-ffill).
*Akzeptanz:* Tests grün, insb. der Look-ahead-Test (monatliche Serie darf nie vor ihrem Release-Datum erscheinen).

**Phase 3 — Chart-UI**
Overlay-Studio: Serien-Browser, lightweight-charts v5, Multi-Achsen, Legend, Layer-Panel, Zeitraum-Presets, URL-State, Stale-Badges, Fehlerzustände aus §11.
*Akzeptanz:* BTC + SPX + Net Liquidity in einem Chart, rebase100, Shift von Net Liquidity um 90 Tage sichtbar korrekt; Link teilbar und reproduzierbar.

**Phase 4 — Metriken**
§6 komplett, jeweils mit Test + Methodik-Tooltip. Eigene Seite `/risk`.

**Phase 5 — Macro-Seite**
§8 komplett inkl. FOMC-Marker und Release-Kalender.

**Phase 6 — Derivate**
WS-Ingest-Worker, Postgres-Tabelle, Live-Tape, OI/Funding, ECharts-Heatmap (Coinglass falls Key vorhanden, sonst eigenes Modell mit Kennzeichnung).

**Phase 7 — Politur**
Playwright-Smoke-Tests, `/api/health`-Dashboard, Cron-Backfill, Performance (Chart mit 10 Serien × 5000 Punkten muss < 100 ms Interaktionslatenz haben), Deployment-Doku.

---

## 14. Definition of Done (pro Feature)

- [ ] Daten kommen nachweislich von einer externen API (Netzwerk-Log im PR beschrieben)
- [ ] Zod-Schema vorhanden, Parse-Fehler = harter Fehler
- [ ] Loading-, Error- und Stale-Zustand implementiert und manuell getestet (Provider blockieren!)
- [ ] Keine Treffer bei `npm run check:no-mock`
- [ ] Unit-Test für jede Berechnung mit manuell nachgerechnetem Referenzwert
- [ ] Einheiten dokumentiert (`unit` im Descriptor) und im Tooltip sichtbar
- [ ] Attribution der Quelle im UI

---

## 15. Rechtliches / Lizenzen (vor Veröffentlichung klären)

- **lightweight-charts**: Apache-2.0, aber die Lizenz verlangt sichtbare TradingView-Attribution (`attributionLogo: true` nicht abschalten).
- **CoinGecko**: Demo-Plan ist für nicht-kommerzielle Nutzung; kommerzielle Nutzung erfordert bezahlten Plan. Attribution Pflicht.
- **Coinglass**: kommerzielle Weiterverbreitung der Daten gemäß Tarif eingeschränkt — nur eigene Anzeige, kein Re-Serving.
- **Stooq / Yahoo**: inoffizielle bzw. an Nutzungsbedingungen gebundene Endpunkte. Für private Nutzung praktikabel, für ein öffentliches Produkt durch eine lizenzierte Quelle (Polygon, Twelve Data, Nasdaq Data Link) ersetzen.
- **FRED / Coin Metrics Community / mempool.space / alternative.me**: frei nutzbar, Attribution.
- Wenn die Seite öffentlich gehen soll: Disclaimer „keine Anlageberatung", Impressum/Datenschutz (DE/DSGVO), und die Datenquellen-Lizenzen einzeln durchgehen.

---

## 16. Erster Prompt an Claude Code

```
Lies PROJECT_SPEC.md vollständig.
Erstelle zuerst CLAUDE.md mit den Regeln aus §0, §11 und §14.
Dann baue ausschließlich Phase 0. Danach stoppen und mir zeigen:
- Ordnerstruktur
- docker-compose up + npm run dev funktionieren
- npm run check:no-mock schlägt bei einem absichtlich eingefügten Math.random() fehl
Frag mich bei jeder Unklarheit, statt etwas anzunehmen.
```
