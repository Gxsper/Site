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

## Offene Punkte

1. **Aktien-/Index-Quelle ersetzen (§4.2).** Stooq ist tot. Kandidaten: FRED (`SP500`,
   `NASDAQ100`, `VIXCLS`, `DTWEXBGS`) — kostenlos und bereits im Stack, aber Aktienserien
   nur ~10 Jahre und 1 Tag verzögert; oder ein bezahlter Anbieter für tiefe Historie.
2. **`FRED_API_KEY`** fehlt weiterhin — die gesamte Makro-Schicht ist blockiert.
3. **Docker-Engine** nicht gestartet — Postgres/Redis und damit Cache-Layer 1 und 2
   sind nicht testbar.
