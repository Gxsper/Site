# ADR 0002 — FRED über den CSV-Endpunkt statt über die API

Datum: 2026-08-24 · Status: angenommen

## Kontext

PROJECT_SPEC.md §4.3 sieht die FRED-API v1 mit `api_key`-Query vor und behauptet:
„Ohne Key 30 req/min, mit Key 120 req/min."

**Die erste Hälfte stimmt nicht.** Am 2026-08-24 geprüft:

```
GET https://api.stlouisfed.org/fred/series/observations?series_id=WALCL&file_type=json
→ HTTP 400
  {"error_code":400,"error_message":"Bad Request.  Variable api_key is not set. …"}
```

Der Key ist Pflicht, es gibt kein schlüsselloses Kontingent. Ein Key ist kostenlos,
erfordert aber die Anlage eines Kontos bei der St. Louis Fed — eine Handlung, die
nur der Betreiber selbst vornehmen kann.

Gleichzeitig liefert der CSV-Endpunkt hinter den FRED-Graphen dieselben Daten ohne Key:

```
GET https://fred.stlouisfed.org/graph/fredgraph.csv?id=WALCL&cosd=2024-01-01&coed=2024-01-31
→ HTTP 200, content-type: application/csv

observation_date,WALCL
2024-01-03,7681024
2024-01-10,7686710
…
```

## Entscheidung

Der FRED-Provider benutzt den CSV-Endpunkt. Dieselbe Institution, dieselbe
Datenbasis, anderer Transport.

Bewusst **keine** Verzweigung auf `FRED_API_KEY`: ein zweiter, nie ausgeführter
Codepfad ist schlechter als gar keiner. Sobald ein Key vorliegt, wird der
Transport ausgetauscht — die Umformung in `parseFredCsv` bleibt, nur der Abruf
ändert sich, und der neue Pfad wird dann auch wirklich getestet.

## Verhältnis zu §11

Das ist kein Daten-Fallback, sondern eine Transportwahl. Beide Wege liefern
dieselben Zahlen aus derselben Quelle. Es gibt keinen Zweig, der bei einem
Fehlschlag des einen Transports still auf den anderen wechselt — der CSV-Abruf
ist der einzige Weg, und ein Fehler dort ist ein Fehler.

## Konsequenzen

**Positiv:** Die gesamte Makro-Schicht funktioniert ohne Kontoanlage und ohne
Wartezeit. Net Liquidity, Zinskurve, M2, VIX und Dollar-Index sind sofort verfügbar.

**Negativ und ehrlich benannt:**

- Der CSV-Endpunkt ist der Download-Link der FRED-Weboberfläche, nicht die
  dokumentierte API. Er kann sich ohne Ankündigung ändern. Das Zod-äquivalente
  Gegenstück ist hier die strenge Prüfung der Kopfzeile in `parseFredCsv`: ändert
  sich das Format, bricht der Abruf hart ab, statt Unsinn zu liefern.
- Kein dokumentiertes Rate-Limit. Der Token-Bucket ist entsprechend defensiv
  eingestellt (`lib/series/limits.ts`).
- Es gibt keine Metadaten mit dem Abruf. Einheiten mussten separat von den
  Serien-Seiten geholt und im Katalog hinterlegt werden — siehe FINDINGS.md §6.
- Nur eine Serie pro Anfrage: mehrere IDs liefern ein ZIP-Archiv statt CSV.

## Rückweg

`FRED_API_KEY` besorgen (fredaccount.stlouisfed.org/apikeys), dann in
`lib/providers/fred.ts` den Abruf auf `api.stlouisfed.org/fred/series/observations`
umstellen. `parseFredCsv` wird durch ein Zod-Schema für die JSON-Antwort ersetzt;
in dieser Antwort sind fehlende Werte `"."` statt eines leeren Feldes.
