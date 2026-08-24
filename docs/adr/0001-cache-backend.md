# ADR 0001 — Cache-Backend: Redis optional, Postgres als Rückfallebene

Datum: 2026-08-24 · Status: angenommen

## Kontext

PROJECT_SPEC.md §10 sieht drei Cache-Ebenen vor:

```
Layer 1: Postgres  → historische Tagesdaten dauerhaft
Layer 2: Redis     → TTL-Cache nach updateCadence + Token-Bucket pro Provider
Layer 3: TanStack Query im Client
```

Layer 2 war als Redis im Docker-Container geplant. Auf der Entwicklungsmaschine
ist das nicht herstellbar:

- **Docker scheidet aus.** Die Virtualisierung ist im BIOS des Rechners
  deaktiviert (`Virtualisierung in Firmware aktiviert: Nein`), zusätzlich fehlt
  WSL vollständig. Beides sind Firmware- bzw. Neustart-Eingriffe, die der
  Betreiber nicht vornehmen will.
- **Memurai Developer 4.1.2**, die naheliegende native Redis-Alternative für
  Windows, bricht reproduzierbar mit MSI-Fehler 1603 ab
  (`SFXCA: Failed to create temp directory. Error code 5`) — auch mit erhöhten
  Rechten und mit bereinigtem Temp-Verzeichnis.
- **`Redis.Redis` aus winget** ist die Microsoft-Portierung 3.0.504 von 2016 und
  damit zu alt.

Postgres 16.15 läuft dagegen nativ und ohne Virtualisierung.

## Entscheidung

Das Cache-Backend wird austauschbar. `REDIS_URL` ist optional:

| `REDIS_URL` | Backend |
|---|---|
| gesetzt | Redis — bevorzugt, wie in §10 vorgesehen |
| nicht gesetzt | Postgres |

`getCacheBackend()` in `apps/web/lib/env.ts` trifft die Wahl. Eine gesetzte,
aber ungültige `REDIS_URL` ist weiterhin ein harter Fehler — es wird **nicht**
still auf Postgres ausgewichen, sonst würde ein Tippfehler in der Konfiguration
unbemerkt die Performance halbieren.

Beide Backends implementieren dieselbe Schnittstelle mit derselben Semantik:
TTL-basierte Ablage und ein Token-Bucket pro Provider.

## Verhältnis zu §11

Das ist ausdrücklich **keine** Aufweichung der No-Mock-Regel. Es geht um den
Speicherort eines Caches, nicht um die Herkunft von Daten:

- Es werden dadurch nie andere Werte ausgeliefert als mit Redis.
- Ein Cache-Fehlschlag führt weiterhin zum Provider-Fetch oder zu einem
  definierten Fehlerzustand, nie zu Ersatzwerten.
- Stale-Badges, `lastUpdated` und `assertRealData` bleiben unverändert.

## Konsequenzen

**Positiv:** Die Entwicklung läuft ohne Docker, ohne BIOS-Eingriff und ohne
Neustart. Eine Abhängigkeit weniger im lokalen Setup. `docker-compose.yml`
bleibt als dokumentierter Weg für ein späteres Deployment im Repo.

**Negativ:** Postgres ist als Cache langsamer als Redis, besonders bei den
Token-Bucket-Updates unter Last. Für ein persönliches Dashboard mit einem
Nutzer ist das ohne Belang; bei einem öffentlichen Deployment sollte `REDIS_URL`
gesetzt werden.

Zusätzlicher Aufwand: die Cache-Schnittstelle braucht zwei Implementierungen und
beide brauchen dieselbe Testsuite.

## Rückweg

`REDIS_URL` in `.env.local` eintragen. Kein Codewechsel nötig.
