# Betrieb und Deployment

Stand: 2026-08-24. Ergänzt [README.md](../README.md) um alles, was über
`npm run dev` hinausgeht.

---

## 1. Was läuft wo

| Teil | Befehl | Zweck |
|---|---|---|
| Web-App | `npm run dev` / `npm run build && npm start` | UI und alle API-Routen |
| Ingest-Worker | `npm run worker` | Liquidationen per WebSocket → Postgres |
| Nachtjob | `npm run nightly` | Delta je Serie nachladen |
| Backfill | `npm run backfill -- --series … --from …` | einmalig Historie holen |

Die Web-App braucht **Postgres**. Redis ist optional
([ADR 0001](adr/0001-cache-backend.md)); ohne `REDIS_URL` läuft der Cache über
Postgres.

## 2. Erstinbetriebnahme

```bash
cp .env.example .env.local
npm ci
npm run db:migrate
npm run backfill -- --all --from 2010-01-01
```

Der Backfill über alle Serien dauert einige Minuten und ist rate-limitiert. Er
ist **einmalig** — was einmal in der Datenbank steht, wird nie erneut geholt
(§10 Layer 1).

Danach prüfen: `/health` im Browser. Dort steht je Serie, wann sie zuletzt
erfolgreich geladen wurde und welcher Fehler zuletzt auftrat.

## 3. Nachtjob einrichten

Der Nachtjob holt für jede Katalogserie nur das Delta der letzten 30 Tage.
Exit-Code 1, wenn eine Serie Probleme machte — ein Cron-Job, der immer 0
zurückgibt, meldet auch nie einen Ausfall.

**Linux / macOS** — `crontab -e`:

```
15 4 * * * cd /pfad/zu/seite && /usr/bin/npm run nightly >> /var/log/macrodeck-nightly.log 2>&1
```

**Windows** — Aufgabenplanung:

```powershell
$action  = New-ScheduledTaskAction -Execute 'npm.cmd' -Argument 'run nightly' -WorkingDirectory 'C:\Users\marti\Desktop\seite'
$trigger = New-ScheduledTaskTrigger -Daily -At 4:15am
Register-ScheduledTask -TaskName 'MacroDeck Nachtjob' -Action $action -Trigger $trigger
```

Uhrzeit mit Bedacht wählen: FRED veröffentlicht die Fed-Bilanz mittwochs nach
16:30 US-Ostküstenzeit. Ein Lauf um 04:15 UTC liegt danach.

## 4. Ingest-Worker als Dienst

Der Worker muss dauerhaft laufen — er zeichnet nur auf, während er läuft, und
rekonstruiert nichts. Jede Ausfallzeit ist eine dauerhafte Lücke.

**systemd** (`/etc/systemd/system/macrodeck-ingest.service`):

```ini
[Unit]
Description=MacroDeck Liquidations-Ingest
After=network-online.target postgresql.service

[Service]
Type=simple
WorkingDirectory=/pfad/zu/seite
ExecStart=/usr/bin/npm run worker
Restart=always
RestartSec=10
User=macrodeck

[Install]
WantedBy=multi-user.target
```

**Windows** — als Aufgabe beim Systemstart:

```powershell
$action  = New-ScheduledTaskAction -Execute 'npm.cmd' -Argument 'run worker' -WorkingDirectory 'C:\Users\marti\Desktop\seite'
$trigger = New-ScheduledTaskTrigger -AtStartup
Register-ScheduledTask -TaskName 'MacroDeck Ingest' -Action $action -Trigger $trigger -RunLevel Highest
```

Der Worker verbindet sich mit Binance, Bybit und OKX. Bybit und OKX brauchen
einen anwendungsseitigen Heartbeat, sonst trennen sie nach wenigen Minuten
(Close-Code 1006 bzw. 4004) — eingebaut, siehe
[FINDINGS.md §8](api-samples/FINDINGS.md).

## 5. Prüfen, ob alles läuft

```bash
npm run verify        # check:no-mock, typecheck, Unit-Tests
npm run test:e2e      # Playwright-Smoke-Tests über alle Seiten
curl localhost:3000/api/health
```

`/api/health` liefert je Provider die Fehlerquote der letzten Stunde und je
Serie den letzten Erfolg. `status` ist `degraded`, sobald eine Serie
aufeinanderfolgende Fehlschläge hat.

### Gemessene Performance

§13 verlangt unter 100 ms Interaktionslatenz bei 10 Serien × 5000 Punkten.
Gemessen am 2026-08-24 im Dev-Modus auf einem i7-8700:

```
5.714 Rasterpunkte × 10 Serien
Median 37,3 ms · schlechtester Wert 44,1 ms
```

Der Test steht in `apps/web/e2e/performance.spec.ts` und läuft mit
`npm run test:e2e`. Im Produktionsbuild ist es schneller — der Dev-Modus
rendert doppelt und ohne Optimierung.

## 6. Sicherung

Alles, was nicht erneut geholt werden kann, liegt in Postgres:

- `series_points` — ließe sich neu holen, dauert aber Stunden
- `liquidations` — **nicht wiederherstellbar.** Der eigene Ingest ist die
  einzige Quelle; was hier fehlt, ist dauerhaft weg.

```bash
pg_dump -U macro -d macrodeck -Fc -f macrodeck-$(date +%F).dump
```

## 7. Vor einer Veröffentlichung

Die Anwendung ist als **persönliches Werkzeug** gebaut. Vor einem öffentlichen
Betrieb sind die Punkte aus §15 der Spezifikation zu klären:

- **lightweight-charts**: Apache-2.0, aber die TradingView-Attribution
  (`attributionLogo: true`) darf nicht abgeschaltet werden. Sie ist gesetzt.
- **CoinGecko**: Demo-Zugang ist nicht-kommerziell. Kommerzielle Nutzung
  erfordert einen bezahlten Plan.
- **FRED, Coin Metrics Community, alternative.me**: frei nutzbar mit
  Attribution. Alle drei stehen in der Fußzeile.
- **FRED über CSV**: kein dokumentierter API-Vertrag
  ([ADR 0002](adr/0002-fred-transport.md)). Für einen öffentlichen Betrieb
  einen API-Key besorgen und auf die dokumentierte Schnittstelle wechseln.
- **Binance**: öffentliche Marktdaten-Endpunkte, an die Nutzungsbedingungen
  gebunden.
- Zusätzlich nötig: Disclaimer „keine Anlageberatung" (steht in jeder Fußzeile),
  Impressum und Datenschutzerklärung nach deutschem Recht.

## 8. Bekannte Grenzen

Diese Punkte sind keine Fehler, sondern Eigenschaften der freien Datenquellen.
Sie stehen alle auch im UI, damit niemand sie für Messungen hält:

| Thema | Grenze |
|---|---|
| Aktienhistorie | FRED `SP500` reicht nur ~10 Jahre zurück; Stooq ist durch eine Bot-Prüfung nicht mehr nutzbar |
| Dominance | Historische BTC.D nur mit bezahltem CoinGecko-Zugang |
| Open Interest | Binance liefert 31 Tage; längere Historie entsteht nur durch eigenes Mitschreiben |
| Liquidationen | Beginnen mit dem ersten Worker-Start, keine Rekonstruktion |
| Liquidations-Heatmap | Bewusst nicht gebaut — wäre ein Modell, keine Messung (§4.4) |
| Puell Multiple | Miner-Revenue ist angenähert, weil Coin Metrics `RevUSD` sperrt |
