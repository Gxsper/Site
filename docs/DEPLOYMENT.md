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

## 6. Gehosteter Betrieb auf Netlify

### 6.1 Was vorher klar sein muss

**Drag & Drop funktioniert nicht.** Zieht man den Ordner ins Netlify-Fenster,
werden die Dateien roh ausgeliefert — kein `npm install`, kein Build, kein
Node. Da es keine `index.html` gibt, antwortet Netlify mit „Page not found".
Das ist kein Konfigurationsfehler: eine Next.js-App *ist* keine fertige
Website, sondern Quellcode, aus dem erst ein Server gebaut wird.

Der Weg führt deshalb zwingend über ein **Git-Repository**.

**Eine erreichbare Datenbank ist Pflicht.** Eine lokale Postgres-Instanz ist
von Netlify aus nicht erreichbar. Ohne externe Datenbank meldet jede Seite
„Datenbank nicht erreichbar" — technisch korrekt, aber nutzlos.
Kostenlose Anbieter mit ausreichender Stufe: Neon, Supabase.

### 6.2 Einrichtung

1. Repository zu GitHub hochladen (`.env.local` ist von `.gitignore` erfasst
   und landet nicht dort).
2. Bei Neon ein Projekt anlegen, Region Europa. Die Verbindungszeichenkette
   sieht so aus:
   `postgresql://user:passwort@ep-….eu-central-1.aws.neon.tech/neondb?sslmode=require`
3. Diese Zeichenkette lokal in `.env.local` als `DATABASE_URL` eintragen, dann
   einmalig:

   ```bash
   npm run db:migrate
   npm run backfill -- --all --from 2010-01-01
   ```

   Das legt das Schema an und füllt alle Serien. Ein Datenbank-Dump ist nicht
   nötig — die Historie kommt ohnehin frisch von den Quellen.

   Zum `sslmode` in der Zeichenkette: `pg` behandelt `require` derzeit wie
   `verify-full`, warnt aber, dass das in `pg` 9 auf die schwächere
   libpq-Bedeutung wechselt. Deshalb gleich **`sslmode=verify-full`** eintragen —
   Neons Zertifikat ist öffentlich vertrauenswürdig, es funktioniert unverändert
   und überlebt den Versionswechsel.

   Die kostenlose Neon-Stufe pausiert eine ungenutzte Datenbank nach wenigen
   Minuten. Der erste Aufruf danach dauert etwa eine halbe Sekunde länger; der
   Verbindungs-Timeout steht auf 10 s und fängt das ab.

4. In Netlify das Repository verbinden. `netlify.toml` im Wurzelverzeichnis
   liefert Build-Befehl, Ausgabeverzeichnis und den Next.js-Runtime bereits mit.
5. Unter *Site configuration → Environment variables* setzen:

   | Variable | Wert |
   |---|---|
   | `DATABASE_URL` | die Neon-Zeichenkette aus Schritt 2 |
   | `CRON_SECRET` | mindestens 16 Zeichen, siehe unten |
   | `REDIS_URL` | leer lassen — der Cache läuft dann über Postgres |

   `CRON_SECRET` erzeugen:

   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```

### 6.3 Der Nachtjob im gehosteten Betrieb

`netlify/functions/nightly.mts` läuft täglich um 04:15 UTC und ruft
`/api/cron/nightly` auf. Die Logik ist dieselbe wie bei `npm run nightly` —
beide benutzen `lib/series/nightly.ts`, damit sie nicht auseinanderlaufen.

Die Route ist durch `CRON_SECRET` geschützt. Ohne diesen Wert verweigert sie
den Dienst, statt ungeschützt offen zu stehen: sie stößt Dutzende
Provider-Anfragen an, und bei CoinGecko zählt jede gegen ein Monatsbudget.

Lokal prüfen:

```bash
curl -X POST -H "authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/nightly
```

Gemessen am 2026-08-24: 38 Serien in 10 Sekunden.

### 6.4 Was gehostet **nicht** läuft

Der **Liquidations-Worker** ist ein Dauerprozess und hat auf Netlify keinen
Platz. Zwei Möglichkeiten:

- Worker lokal laufen lassen, aber gegen die Neon-Datenbank (`DATABASE_URL` in
  der lokalen `.env.local` zeigt dorthin). Dann erscheinen die Liquidationen
  auch auf der gehosteten Seite — allerdings nur, solange der Rechner läuft.
- Auf die Liquidationen verzichten. Alle übrigen Seiten sind davon unberührt;
  die Derivate-Seite zeigt dann den Hinweis, dass noch nichts aufgezeichnet ist.

### 6.5 Öffentlich erreichbar

Eine Netlify-Seite ohne Passwortschutz kann jeder mit der Adresse öffnen.
Für den Eigengebrauch und zum Herzeigen ist das gewollt — die Punkte aus
Abschnitt 8 (Impressum, Datenschutz, lizenzierte Quellen) gelten dann aber.

## 7. Sicherung

Alles, was nicht erneut geholt werden kann, liegt in Postgres:

- `series_points` — ließe sich neu holen, dauert aber Stunden
- `liquidations` — **nicht wiederherstellbar.** Der eigene Ingest ist die
  einzige Quelle; was hier fehlt, ist dauerhaft weg.

```bash
pg_dump -U macro -d macrodeck -Fc -f macrodeck-$(date +%F).dump
```

## 8. Vor einer Veröffentlichung

Die Anwendung ist als **persönliches Werkzeug** gebaut. Vor einem öffentlichen
Betrieb sind die Punkte aus §15 der Spezifikation zu klären:

- **Yahoo Finance**: inoffizieller Endpunkt ohne zugesicherten Vertrag
  ([ADR 0003](adr/0003-yahoo-transport.md)). Für ein öffentliches Produkt durch
  eine lizenzierte Quelle ersetzen.
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

## 9. Bekannte Grenzen

Diese Punkte sind keine Fehler, sondern Eigenschaften der freien Datenquellen.
Sie stehen alle auch im UI, damit niemand sie für Messungen hält:

| Thema | Grenze |
|---|---|
| Aktienhistorie | Gelöst ohne Abo: S&P 500 ab 1970 über Yahoo (ADR 0003), Nasdaq ab 1971 über FRED. Yahoo ist ein inoffizieller Endpunkt — für ein öffentliches Produkt zu ersetzen |
| Dominance | Historisch nicht frei erhältlich; wird ab 2026-08-24 selbst aufgezeichnet und wächst von da an |
| Dollar-Index | `dxy.close` ab 1971 hat auf 18 % der Tage keinen Kurs; `fred.DTWEXBGS` ab 2006 ist sauberer |
| Open Interest | Binance liefert 31 Tage; längere Historie entsteht nur durch eigenes Mitschreiben |
| Liquidationen | Beginnen mit dem ersten Worker-Start, keine Rekonstruktion |
| Liquidations-Cluster | Zeigt eingetretene Liquidationen, keine erwarteten Level. Aussagekräftig erst nach einigen Tagen Ingest |
| Sharpe / Sortino | Rechnen mit `fred.DGS3MO` als risikofreiem Zins; fällt der aus, steht rf = 0 im Methodik-Hinweis |
| Puell Multiple | Miner-Revenue ist angenähert, weil Coin Metrics `RevUSD` sperrt |
