# ADR 0003 — Aktien, Edelmetalle und Rohstoffe über Yahoo Finance

Datum: 2026-08-24 · Status: angenommen

## Kontext

§4.2 der Spezifikation sieht für SPX, NDX, DXY und Gold eine Kette vor:
Stooq zuerst, FRED als Cross-Check, bezahlte Anbieter falls nötig. Zwei der drei
Optionen fallen aus:

- **Stooq ist nicht mehr nutzbar.** Der CSV-Endpunkt liefert eine
  JavaScript-Proof-of-Work-Bot-Prüfung statt Daten
  ([FINDINGS.md §5](../api-samples/FINDINGS.md)). Die Prüfung wird nicht umgangen.
- **FRED deckelt die Index-Reihen.** `SP500` und `DJIA` liefern nur zehn Jahre
  rollierend — das sind Lizenzbeschränkungen der Index-Anbieter, keine
  technische Grenze. Für Zyklusvergleiche über mehrere Halvings zu kurz.
- **Bezahlte Anbieter** (Twelve Data, Polygon, Nasdaq Data Link) scheiden aus:
  der Betreiber will kein Abo.

Bemerkenswert: die Deckelung trifft **nicht alle** FRED-Reihen. Am 2026-08-24
geprüft:

| FRED-Serie | Punkte | ab |
|---|---|---|
| `SP500` | 2 610 | 2016-08-22 (gedeckelt) |
| `DJIA` | 2 610 | 2016-08-22 (gedeckelt) |
| **`NASDAQCOM`** | **14 491** | **1971-02-05** |
| **`NASDAQ100`** | **10 602** | **1986-01-02** |
| **`DCOILWTICO`** | 10 599 | 1986-01-02 |
| **`DGS3MO`** | 11 733 | 1981-09-01 |

Die Nasdaq-Reihen sind also frei und tief verfügbar — sie stehen jetzt im
Katalog. Für S&P, Dow, Gold und Silber fehlte weiterhin eine Quelle.

## Entscheidung

Diese vier kommen über **Yahoo Finance**
(`query1.finance.yahoo.com/v8/finance/chart`). §15 der Spezifikation nennt Yahoo
ausdrücklich: „inoffizielle bzw. an Nutzungsbedingungen gebundene Endpunkte.
Für private Nutzung praktikabel, für ein öffentliches Produkt durch eine
lizenzierte Quelle ersetzen." Genau dieser Fall liegt vor.

Verifizierte Tiefe:

| Serie | Symbol | Punkte | ab | Lücken |
|---|---|---|---|---|
| S&P 500 | `^GSPC` | 14 282 | 1970-01-02 | 0 |
| Nasdaq 100 | `^NDX` | 10 303 | 1985-10-01 | 0 |
| Dow Jones | `^DJI` | 8 722 | 1992-01-02 | 0 |
| Gold | `GC=F` | 6 603 | 2000-08-30 | 84 |
| Silber | `SI=F` | 6 603 | 2000-08-30 | 82 |
| Dollar-Index | `DX-Y.NYB` | 17 243 | 1971-01-04 | **3 115** |

## Verhältnis zu §11

Das ist kein Daten-Fallback, sondern eine Quellenwahl. Es gibt keinen Zweig,
der bei einem Fehlschlag still auf eine andere Quelle wechselt — schlägt Yahoo
fehl, ist das ein Fehler und wird als solcher gemeldet.

Die 84 Lückentage bei Gold werden zu Lücken, nicht zu Nullwerten. Die Reihe
liefert 6 519 statt 6 603 Punkte, und die Linie bricht dort ab.

## Konsequenzen

**Positiv:** S&P 500 über 56 Jahre statt 10. Damit sind Zyklusvergleiche über
mehrere Halvings möglich — der Zweck, für den §4.2 überhaupt eine Aktienquelle
verlangt. Gold und Silber überhaupt erst verfügbar. Kein Abo, kein Key.

**Negativ und ehrlich benannt:**

- Kein dokumentierter API-Vertrag. Der Endpunkt kann sich ohne Ankündigung
  ändern; das Zod-Schema bricht dann hart ab, statt Unsinn zu liefern.
- An Yahoos Nutzungsbedingungen gebunden. Für ein öffentliches Produkt durch
  eine lizenzierte Quelle zu ersetzen.
- `DX-Y.NYB` hat auf 18 % der Tage keinen Schlusskurs. Für die Zeit ab 2006 ist
  `fred.DTWEXBGS` die sauberere Reihe; die Yahoo-Variante ist die einzige mit
  Historie bis 1971. Beide stehen im Katalog, die Grenze steht im Label.
- Kein dokumentiertes Rate-Limit. Der Token-Bucket ist entsprechend defensiv.

## Zwei Fallen, die Geld gekostet hätten

1. **`range=max` liefert Monatswerte**, auch zusammen mit `interval=1d`. Nur
   `period1`/`period2` erzwingen Tagesdaten. Wer das übersieht, hält 267 Punkte
   für die volle Gold-Historie statt 6 603.
2. **Zeitstempel stehen auf der Handelseröffnung in Börsenzeit**, nicht auf
   00:00 UTC. Sie werden auf den UTC-Tagesbeginn abgerundet, sonst passt keine
   dieser Reihen zu einer anderen Tagesserie.

## Rückweg

Sobald ein Budget besteht: Twelve Data, Polygon oder Nasdaq Data Link
anbinden. Nur `lib/providers/yahoo.ts` und die `providerParams` im Katalog
ändern sich — Descriptor, Persistenz und UI bleiben unberührt.
