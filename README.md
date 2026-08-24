# MacroDeck

Persönliches Analyse-Dashboard für Zyklus- und Bewertungsanalyse mit Makro-Kontext.
Spezifikation: [PROJECT_SPEC.md](PROJECT_SPEC.md). Arbeitsregeln für Agenten: [CLAUDE.md](CLAUDE.md).

**Stand: Phase 0 (Fundament).** Es gibt noch keine Provider, keine `/api/series`-Route
und kein UI — das ist so vorgesehen (§13).

## Voraussetzungen

- Node.js ≥ 20.11 (empfohlen: 22, siehe `.nvmrc`)
- Docker Desktop (für Postgres 16 + Redis 7)

## Setup

```bash
cp .env.example .env.local
npm install
npm run docker:up
npm run db:push
npm run dev
```

`.env.local` wird nie committet. In Phase 0 reichen `DATABASE_URL` und `REDIS_URL`;
`FRED_API_KEY` wird ab Phase 1 erzwungen, sobald der erste Provider konstruiert wird.

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
| `npm run docker:up` / `docker:down` / `docker:reset` | lokale Infrastruktur |
| `npm run db:generate` / `db:migrate` / `db:push` / `db:studio` | Drizzle |

## Struktur

```
.
├─ apps/web              Next.js 15 App Router — UI, API-Routen, Datenschicht
│  ├─ app/               Routen (Phase 0: nur eine Platzhalterseite)
│  ├─ components/ui/     shadcn/ui
│  └─ lib/
│     ├─ db/             Drizzle-Schema + Verbindung
│     ├─ series/         SeriesDescriptor & Provider-Interface (§3.1, §3.2)
│     ├─ env.ts          Zod-Validierung der Umgebung (§12)
│     └─ guard.ts        Laufzeit-Durchsetzung von §11
├─ worker/               WS-Ingest, ab Phase 6
├─ scripts/              Repo-Tooling (check-no-mock)
└─ docs/api-samples/     Provider-Response-Beispiele — nur Doku, nie Laufzeitquelle
```

## Die wichtigste Regel

Keine Demo-, Fake-, Sample- oder Fallback-Daten. Nirgends. Fehlt eine Quelle, zeigt die
App einen definierten Fehlerzustand — nie eine plausible Zahl. Details in
[CLAUDE.md](CLAUDE.md) Abschnitt 2 und PROJECT_SPEC.md §11.

## Attribution

Die Datenquellen und ihre Lizenzpflichten stehen in PROJECT_SPEC.md §15. Die
Attribution-Leiste im UI entsteht mit Phase 3.
