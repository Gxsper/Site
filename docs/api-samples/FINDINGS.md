# §0.3-Recherche: verifizierte Response-Shapes

Stand: 2026-08-24. Alle Angaben stammen aus echten Abfragen, nicht aus der Dokumentation
und nicht aus dem Gedächtnis. Die zugehörigen Fixtures liegen als `<name>.json` daneben.

---

## 1. Binance Spot — Klines ✅ nutzbar

`GET https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=3&startTime=…`

Antwort ist ein **Array von Arrays**, kein Objekt. Positionen:

| Index | Bedeutung | Typ |
|---|---|---|
| 0 | openTime | number, **Millisekunden** |
| 1–4 | open, high, low, close | **String** |
| 5 | volume (Basis) | String |
| 6 | closeTime | number, ms |
| 7 | quoteAssetVolume | String |
| 8 | trades | number |
| 9–10 | takerBuyBase, takerBuyQuote | String |
| 11 | ignore | String |

Für `SeriesPoint` gilt: `t = openTime / 1000` (Tages-Cut 00:00 UTC), `v = Number(close)`.

## 2. Binance Futures — Funding Rate ✅ nutzbar

`GET https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=3`

```jsonc
{ "symbol": "BTCUSDT", "fundingTime": 1787500800006, "fundingRate": "0.00010000",
  "markPrice": "77128.59832084", "rateType": "Regular" }
```

- `fundingTime` in Millisekunden und **nicht exakt auf der 8h-Grenze** (…800006, …600001).
  Vor dem Speichern auf das Intervall runden, sonst sind die Zeitstempel nicht deduplizierbar.
- `fundingRate` ist ein String.
- `rateType` steht nicht in der öffentlichen Doku-Tabelle, kommt aber mit — Zod-Schema
  muss unbekannte Felder tolerieren, statt am Extrafeld zu scheitern.
- Ohne `startTime` liefert der Endpunkt die **jüngsten** Einträge.

## 3. Coin Metrics Community ✅ nutzbar, aber mit Einschränkungen

`GET https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=…&frequency=1d`

```jsonc
{ "data": [ { "asset": "btc", "time": "2026-08-23T00:00:00.000000000Z",
              "PriceUSD": "77593.0280291116", "CapMrktCurUSD": "1557618536265.254449053113497224" } ],
  "next_page_token": "…", "next_page_url": "…" }
```

**Drei Fallstricke, die still falsche Daten erzeugen würden:**

1. **`paging_from` steht default auf `end`.** Eine Abfrage mit `start_time=2024-01-01` und
   `page_size=3` liefert die *jüngsten* drei Tage, nicht die ältesten. Für den Backfill ist
   `paging_from=start` zwingend. `sort=time` ändert daran nichts, `reverse` gibt es nicht
   (HTTP 400, `unsupported_parameter`).
2. **Alle Zahlen sind Strings**, und `CapMrktCurUSD` hat bis zu 24 signifikante Stellen —
   mehr als ein float64 trägt. Für Marktkapitalisierungen ist der Präzisionsverlust
   unkritisch, muss aber bewusst dokumentiert sein.
3. `time` kommt mit **Nanosekunden-Präzision** (`.000000000Z`).

**Verfügbare BTC-Metriken im Community-Tier: genau 31**, alle `1d` (plus vier
`ReferenceRate`-Varianten mit `1s`, die aber nur ~7 Tage zurückreichen). Abgefragt über
`/v4/catalog-v2/asset-metrics?assets=btc`.

Für die Spec relevant:

| Metrik | verfügbar | Historie ab |
|---|---|---|
| `PriceUSD` | ✅ | 2010-07-18 (0,08584 USD) |
| `CapMrktCurUSD` | ✅ | 2010-07-18 |
| `SplyCur` | ✅ | 2009-01-03 |
| `CapMVRVCur` | ✅ | 2010-07-18 |
| `HashRate`, `AdrActCnt`, `TxCnt` | ✅ | 2009 |
| `IssTotUSD`, `FeeTotNtv` | ✅ | 2009/2010 |
| **`CapRealUSD`** | ❌ | HTTP 403 `forbidden` |
| **`RevUSD`**, **`FeeTotUSD`** | ❌ | nicht im Katalog |

**Folge für §6.5 — und der Ausweg:** Realized Price, MVRV-Z und NUPL brauchen laut Spec
`CapRealUSD`. Das ist gesperrt. Aber `CapMVRVCur` ist frei, und da
`MVRV = CapMrktCurUSD / CapRealUSD` gilt, lässt sich

```
CapRealUSD = CapMrktCurUSD / CapMVRVCur
```

exakt rekonstruieren. Damit sind Realized Price, MVRV-Z und NUPL doch berechenbar — aus
echten Daten, mit offengelegter Herleitung. Das ist keine Schätzung, sondern eine
algebraische Umformung; sie gehört trotzdem in den `methodology`-Tooltip.

**Puell Multiple** braucht `RevUSD` (Miner-Revenue in USD). Rekonstruierbar als
`IssTotUSD + FeeTotNtv × PriceUSD`. Das ist eine *Annäherung* — Coin Metrics' `RevUSD`
kann anders aggregieren. Muss im UI als solche gekennzeichnet werden, sonst §11-Verstoß.

## 4. alternative.me Fear & Greed ✅ nutzbar

`GET https://api.alternative.me/fng/?limit=0&format=json`

```jsonc
{ "name": "Fear and Greed Index",
  "data": [ { "value": "73", "value_classification": "Greed",
              "timestamp": "1787529600", "time_until_update": "47878" } ],
  "metadata": { "error": null } }
```

- `value` und `timestamp` sind **Strings**; `timestamp` ist bereits in **Sekunden**.
- `time_until_update` gibt es **nur beim ersten (aktuellsten) Eintrag** — im Zod-Schema optional.
- Reihenfolge ist absteigend (neuester zuerst) und muss vor `assertRealData` umgedreht werden.
- `metadata.error` ist der Fehlerkanal und im Erfolgsfall `null`.

## 5. Stooq ❌ nicht nutzbar

`GET https://stooq.com/q/d/l/?s=^spx&i=d`

Liefert **kein CSV mehr**, sondern HTTP 200 mit `content-type: text/html` und einer
JavaScript-Proof-of-Work-Bot-Prüfung („This site requires JavaScript to verify your
browser"). Getestet mit eigenem User-Agent, mit Node-Default und mit `Accept: text/csv` —
identisches Ergebnis in allen drei Fällen.

Die Prüfung wird **nicht umgangen**. Damit fällt die in §4.2 als erste Wahl gesetzte Quelle
für SPX, NDX, DXY, Gold und VIX aus. Ersatz ist eine offene Produktentscheidung, siehe
offene Punkte unten.

---

## 6. FRED ✅ nutzbar — aber die Spec irrt gleich dreifach

### 6.1 Kein schlüsselloses Kontingent

§4.3 behauptet „Ohne Key 30 req/min". Tatsächlich:

```
GET https://api.stlouisfed.org/fred/series/observations?series_id=WALCL&file_type=json
→ HTTP 400  "Bad Request.  Variable api_key is not set."
```

Der Key ist Pflicht. Ausweg ist der CSV-Endpunkt, siehe
[ADR 0002](../adr/0002-fred-transport.md):

```
GET https://fred.stlouisfed.org/graph/fredgraph.csv?id=WALCL&cosd=…&coed=…
observation_date,WALCL
2024-01-03,7681024
```

- Fehlende Werte sind ein **leeres Feld**, nicht `"."` wie in der JSON-API.
- Mehrere IDs in einem Aufruf liefern ein **ZIP-Archiv**, kein CSV → eine Serie pro Anfrage.

### 6.2 ⚠️ Die Einheiten-Tabelle in §4.3 ist falsch

§4.3 warnt vor dem „häufigsten Fehler im Netz" und macht ihn selbst. Am
2026-08-24 direkt von den FRED-Serienseiten abgelesen:

| Serie | §4.3 sagt | **Tatsächlich** | |
|---|---|---|---|
| `WALCL` | Millionen | Millions of U.S. Dollars | ✅ korrekt |
| `WTREGEN` | **Milliarden** | **Millions of U.S. Dollars** | ❌ falsch |
| `WRESBAL` | **Milliarden** | **Millions of U.S. Dollars** | ❌ falsch |
| `RRPONTSYD` | Milliarden | Billions of US Dollars | ✅ korrekt |
| `WM2NS` | Milliarden | Billions of Dollars | ✅ korrekt |
| `M2SL` | Milliarden | Billions of Dollars | ✅ korrekt |

Die Formel aus §4.3 lautet:

```ts
const netLiquidityBn = (WALCL / 1000) - WTREGEN - RRPONTSYD;   // FALSCH
```

Richtig ist:

```ts
const netLiquidityBn = (WALCL / 1000) - (WTREGEN / 1000) - RRPONTSYD;
```

Nachgerechnet für **2024-01-03**:

| | Rohwert | in Mrd. |
|---|---|---|
| WALCL | 7 681 024 | 7 681,024 |
| WTREGEN | 758 448 | 758,448 |
| RRPONTSYD | 719,897 | 719,897 |
| **Net Liquidity** | | **6 202,679** |

Mit der Spec-Formel käme **−751 485** heraus — ein Faktor-1000-Fehler, der im
Chart sofort auffiele, in einer Korrelationsrechnung aber nicht unbedingt.
Der Wert 6 202,679 ist als Referenz in `lib/metrics/net-liquidity.test.ts`
hinterlegt und wird end-to-end gegen die laufende API geprüft.

### 6.3 Verifizierte Historienbeginne

| Serie | ab | n | Einheit |
|---|---|---|---|
| `WALCL`, `WTREGEN` | 2002-12-18 | 1236 | Mio. USD, wöchentlich (Mi) |
| `RRPONTSYD` | 2003-02-07 | 6141 | Mrd. USD, täglich |
| `WM2NS` | 1981-01-05 | 2375 | Mrd. USD, wöchentlich |
| `DGS10` | 1962-01-02 | 16863 | Prozent, täglich |
| `T10Y2Y` | 1976-06-01 | 13104 | Prozentpunkte, täglich |
| `VIXCLS` | 1990-01-02 | 9558 | Index, täglich |
| `NFCI` | 1971-01-08 | 2902 | Index, wöchentlich |
| `DTWEXBGS` | 2006-01-02 | 5380 | Index Jan 2006=100 |
| **`SP500`** | **2016-08-22** | 2610 | Index — nur ~10 Jahre, wie §4.2 warnt |

`BAMLH0A0HYM2` (High-Yield OAS) liefert über CSV nur 795 Punkte ab 2023-08-22.
Die Ursache ist ungeklärt, deshalb steht die Serie noch nicht im Katalog.

## 7. CoinGecko ⚠️ nur Momentaufnahme — historische Dominance nicht erhältlich

Am 2026-08-24 ohne API-Key geprüft:

| Endpunkt | Ergebnis |
|---|---|
| `/global` | ✅ HTTP 200 — aber nur der **aktuelle** Stand |
| `/global/market_cap_chart` | ❌ HTTP 401 — `error_code: 10005`, PRO-Abo erforderlich |
| `/coins/{id}/market_chart/range` | ❌ HTTP 401 — `error_code: 10012`, nur **365 Tage** zurück |

§4.1 warnt, der Demo-Plan gebe „nur ca. 1 Jahr Historie". Das gilt auch für den
schlüssellosen Zugang, und der Endpunkt für historische Gesamtmarktkapitalisierung
ist gar nicht verfügbar.

**Folge für §6.4:** BTC.D, TOTAL2 und TOTAL3 lassen sich als Zeitreihe über
mehrere Zyklen **nicht** aus freien Quellen bauen.

### 7.1 Warum kein Ersatz aus Coin Metrics gebaut wurde

Naheliegend wäre, die Dominance aus den Marktkapitalisierungen zu summieren, die
Coin Metrics frei anbietet — 135 Assets mit `CapMrktCurUSD`. Geprüft und
verworfen, weil die Summe nachweislich falsch ist:

```
btc        1557,6 Mrd   58,31 %
eth         299,8 Mrd   11,22 %
usdt        189,2 Mrd    7,08 %   ← Aggregat
usdt_trx     94,3 Mrd    3,53 %   ← dieselben Tether nochmal
usdt_eth     88,3 Mrd    3,31 %   ← und nochmal
usdc         65,6 Mrd    2,46 %
usdc_eth     49,8 Mrd    1,86 %   ← dieselben USDC nochmal
…
wbtc          9,0 Mrd    0,34 %   ← BTC ein zweites Mal
weth          5,1 Mrd    0,19 %   ← ETH ein zweites Mal
```

Drei Fehlerquellen zugleich:

1. **Doppelzählung.** Stablecoins erscheinen als Aggregat **und** je Chain.
2. **Wrapped Tokens.** `wbtc` und `weth` zählen BTC und ETH erneut.
3. **Fehlende Schwergewichte.** `sol` und `bnb` sind im Community-Tier gesperrt
   (HTTP 403), obwohl `sol` im Katalog auftaucht — ein weiterer Beleg dafür,
   dass Verfügbarkeit abgefragt und nicht angenommen werden darf.

Der so entstehende BTC-Anteil von 58,31 % liegt zwar zufällig nahe an der
veröffentlichten Dominance (CoinGecko meldete zeitgleich 59,11 %), weil sich
doppelt gezählte Stablecoins und fehlende Schwergewichte teilweise aufheben.
Eine Zahl, deren Richtigkeit auf einer Fehlerkompensation beruht, ist keine
Messung. Sie wurde deshalb **nicht** gebaut (§11).

### 7.2 Was stattdessen umgesetzt ist

- **ETH/BTC** direkt aus dem Binance-Handelspaar `ETHBTC`, ab **2017-07-14**
  (verifiziert, erster Close 0,090993). Exakt, ohne Alignment-Frage.
- **Aktuelle Dominance** aus `/global` als Momentaufnahme mit Zeitstempel,
  ausdrücklich ohne Verlauf.

Für BTC.D über mehrere Halvings wäre ein bezahlter Zugang nötig — dieselbe
Entscheidung, die schon beim Stooq-Ersatz aussteht.

## Offene Punkte

1. **Aktien-/Index-Quelle ersetzen (§4.2).** Stooq ist tot. Kandidaten: FRED (`SP500`,
   `NASDAQ100`, `VIXCLS`, `DTWEXBGS`) — kostenlos und bereits im Stack, aber Aktienserien
   nur ~10 Jahre und 1 Tag verzögert; oder ein bezahlter Anbieter für tiefe Historie.

2. **Historische Dominance (§6.4).** Nur mit bezahltem CoinGecko-Zugang oder
   einer anderen lizenzierten Quelle. Siehe Abschnitt 7.
3. ~~`FRED_API_KEY` fehlt~~ — gelöst über den CSV-Transport, siehe ADR 0002. Ein
   Key bleibt wünschenswert, weil die dokumentierte API stabiler zugesichert ist.
4. ~~Docker-Engine nicht gestartet~~ — gelöst: Postgres nativ, Cache über Postgres
   statt Redis, siehe ADR 0001.
