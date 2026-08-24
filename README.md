# MacroDeck

Persönliches Analyse-Dashboard für Zyklus- und Bewertungsanalyse mit Makro-Kontext.
Spezifikation: [PROJECT_SPEC.md](PROJECT_SPEC.md). Arbeitsregeln für Agenten: [CLAUDE.md](CLAUDE.md).

**Stand: Phase 0 bis 7 umgesetzt.** Datenschicht, Overlay-Engine, Charts, Metriken,
Makro- und Derivate-Seiten laufen gegen echte Quellen. Bekannte Grenzen der
freien Datenquellen stehen in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) §8.

## Voraussetzungen

- Node.js ≥ 20.11 (siehe `.nvmrc`)
- PostgreSQL 16 — entweder per Docker (`npm run docker:up`) oder nativ installiert
- Redis 7 ist **optional**, siehe [ADR 0001](docs/adr/0001-cache-backend.md)

## Setup

```bash
cp .env.example .env.local
npm install
npm run db:migrate
npm run dev
```

Für die Datenbank gibt es zwei Wege:

- **Mit Docker:** `npm run docker:up` startet Postgres 16 und Redis 7.
- **Ohne Docker** (z. B. wenn keine Virtualisierung verfügbar ist): PostgreSQL 16
  nativ installieren, dann Rolle und Datenbank passend zur `DATABASE_URL` anlegen:

  ```bash
  psql -U postgres -c "CREATE ROLE macro LOGIN PASSWORD 'macro'; CREATE DATABASE macrodeck OWNER macro;"
  ```

`.env.local` wird nie committet. In Phase 0 reicht `DATABASE_URL`. `REDIS_URL` ist
optional — ohne Redis läuft der Cache aus §10 Layer 2 gegen Postgres. `FRED_API_KEY`
wird ab Phase 1 erzwungen, sobald der erste Provider konstruiert wird.

## Befehle

| Befehl | Zweck |
|---|---|
| `npm run dev` | Next.js Dev-Server auf http://localhost:3000 |
| `npm run build` | Produktionsbuild |
| `npm test` | Vitest: Repo-Tooling + alle Workspaces |
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm run lint` | ESLint (next/core-web-vitals) |
| `npm run check:no-mock` | Durchsetzung von §11 — muss immer grün sein |
| `npm run verify` | check:no-mock + typecheck + test |
| `npm run test:e2e` | Playwright-Smoke-Tests über alle Seiten |
| `npm run worker` | Liquidations-Ingest (Binance, Bybit, OKX) |
| `npm run nightly` | Nachtjob: Delta je Serie nachladen |
| `npm run backfill -- --all --from 2010-01-01` | einmalige Historie |
| `npm run docker:up` / `docker:down` / `docker:reset` | lokale Infrastruktur |
| `npm run db:generate` / `db:migrate` / `db:push` / `db:studio` | Drizzle |

## Seiten

| Pfad | Inhalt |
|---|---|
| `/` | Overlay-Studio — Serien überlagern, normalisieren, korrelieren |
| `/risk` | Risk Metric, Log-Regressionsbänder, Fear & Greed, Drawdown |
| `/macro` | Net Liquidity, Fed-Bilanz, Zinskurve, Financial Conditions |
| `/derivatives` | Liquidationen, Open Interest, Funding, Long/Short |
| `/health` | Zustand aller Quellen und Serien |

Betrieb, Cron-Einrichtung und bekannte Grenzen: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Struktur

```
.
├─ apps/web              Next.js 15 App Router — UI, API-Routen, Datenschicht
│  ├─ app/               Routen und API-Handler
│  ├─ components/ui/     shadcn/ui
│  └─ lib/
│     ├─ db/             Drizzle-Schema + Verbindung
│     ├─ series/         SeriesDescriptor & Provider-Interface (§3.1, §3.2)
│     ├─ env.ts          Zod-Validierung der Umgebung (§12)
│     └─ guard.ts        Laufzeit-Durchsetzung von §11
├─ worker/               WebSocket-Ingest für Liquidationen
├─ scripts/              Repo-Tooling (check-no-mock)
└─ docs/
   ├─ adr/               Architekturentscheidungen mit Begründung
   └─ api-samples/       Verifizierte Provider-Responses — nur Doku, nie Laufzeitquelle
```

## Die wichtigste Regel

Keine Demo-, Fake-, Sample- oder Fallback-Daten. Nirgends. Fehlt eine Quelle, zeigt die
App einen definierten Fehlerzustand — nie eine plausible Zahl. Details in
[CLAUDE.md](CLAUDE.md) Abschnitt 2 und PROJECT_SPEC.md §11.

## Attribution

Die Datenquellen und ihre Lizenzpflichten stehen in PROJECT_SPEC.md §15. Die
Attribution-Leiste im UI entsteht mit Phase 3.
