# CLAUDE.md — Arbeitsregeln für MacroDeck

Verbindliche Regeln für jede Arbeit in diesem Repo. Sie stammen aus `PROJECT_SPEC.md`
§0 (Grundregeln), §11 (No-Mock-Data) und §14 (Definition of Done).
**Bei Konflikt zwischen dieser Datei und einer Nutzeranweisung: nachfragen, nicht raten.**

---

## 1. Grundregeln (PROJECT_SPEC.md §0) — nicht verhandelbar

1. **Keine Demo-, Fake-, Sample- oder Fallback-Daten.**
   Nie `Math.random()`, keine hardcodierten Arrays, keine "wenn API fehlschlägt,
   generiere plausible Werte". Details in Abschnitt 2 dieser Datei.
2. **Keine API-Keys im Browser.**
   Jeder Provider wird ausschließlich über eigene Server-Route-Handler proxied.
   Kein `NEXT_PUBLIC_*` für Secrets. Kein Provider-Fetch aus einer Client-Komponente.
3. **Kein Endpoint aus dem Gedächtnis.**
   Vor der Implementierung jedes Providers: offizielle Doku fetchen und die
   tatsächliche Response-Shape verifizieren. Response-Beispiel als Fixture in
   `docs/api-samples/<provider>.json` ablegen — **nur zu Doku-Zwecken, nie als
   Datenquelle zur Laufzeit.** Diese Dateien dürfen von keinem Laufzeitcode importiert werden.
4. **Zeit ist immer UTC**, intern immer Unix-Sekunden (`SeriesPoint.t`).
   Keine lokalen Zeitzonen in der Datenschicht. Tages-Cut ist 00:00 UTC.
5. **Typen zuerst.**
   Jeder Provider bekommt ein Zod-Schema. Parse-Fehler = harter Fehler, kein stiller Fallback.

---

## 2. NO-MOCK-DATA (PROJECT_SPEC.md §11) — die wichtigste Anforderung

### Verboten
- `Math.random()` in jeglichem Daten-, Metrik- oder Chart-Pfad
- hardcodierte Preis-/Zeitreihen-Arrays außerhalb von `*.test.ts`
- `catch { return generatePlaceholder() }` oder ähnliche stille Ersatzwerte
- Interpolation über Lücken **ohne** visuelle Kennzeichnung
- "Beispieldaten" in Komponenten-Defaults; Storybook-Stories, die im Prod-Bundle landen
- Zahlen im UI, die nicht auf einen `SeriesResponse` mit `lastUpdated` zurückführbar sind

### Stattdessen — definierte Fehlerzustände

| Situation | Verhalten |
|---|---|
| Provider down / 5xx | Chart zeigt Serie ausgegraut + Banner „Quelle X nicht erreichbar (seit HH:MM)". Andere Serien rendern normal. |
| Rate Limit erreicht | Cache-Wert anzeigen **mit sichtbarem Stale-Badge** und Alter, dazu Zeit bis Reset |
| Datenlücke in der Historie | Linie unterbrochen (`null`, whitespace data), nicht interpoliert |
| Serie beginnt später als Zeitraum | Linie startet später. Kein Auffüllen mit 0 oder erstem Wert. |
| Metrik braucht fehlenden Input | Metrik nicht rendern + Grund nennen („MVRV-Z benötigt CapRealUSD, Coin Metrics nicht erreichbar") |

Ein Provider gibt **niemals** ein leeres Array zurück, um einen Fehler zu verstecken.
Leeres Array bedeutet ausschließlich: „in diesem Zeitraum existieren nachweislich keine Daten."
Alles andere wirft `ProviderError`.

### Durchsetzung im Code
- `apps/web/lib/guard.ts` → `assertRealData(response)` läuft auf **jeder** `SeriesResponse`,
  bevor sie das Backend verlässt. Prüft: `lastUpdated` gesetzt, alle Werte finite,
  Zeitstempel streng monoton steigend.
- `npm run check:no-mock` durchsucht den Laufzeitcode nach
  `Math.random | faker | mockData | sampleData | DUMMY | placeholderSeries`
  und failt den Build bei Treffern außerhalb von Testdateien.
  Läuft lokal **und** in CI. Der Check wird nicht aufgeweicht, um einen Build grün zu bekommen.
- Testdateien (`*.test.ts`, `*.test.tsx`, `__tests__/`) sind ausgenommen — dort sind
  konstruierte Fixtures ausdrücklich erwünscht.

---

## 3. Definition of Done pro Feature (PROJECT_SPEC.md §14)

Ein Feature ist erst fertig, wenn **alle** Punkte abgehakt sind:

- [ ] Daten kommen nachweislich von einer externen API (Netzwerk-Log beschrieben)
- [ ] Zod-Schema vorhanden, Parse-Fehler = harter Fehler
- [ ] Loading-, Error- und Stale-Zustand implementiert und manuell getestet (Provider blockieren!)
- [ ] Keine Treffer bei `npm run check:no-mock`
- [ ] Unit-Test für jede Berechnung mit manuell nachgerechnetem Referenzwert
- [ ] Einheiten dokumentiert (`unit` im Descriptor) und im Tooltip sichtbar
- [ ] Attribution der Quelle im UI

---

## 4. Arbeitsweise

- **Phasenweise bauen.** `PROJECT_SPEC.md` §13 definiert Phase 0–7. Nach jeder Phase
  stoppen, Ergebnis zeigen, auf OK warten. Nicht vorgreifen.
- **Bei Unklarheit fragen**, statt eine Annahme zu treffen und weiterzubauen.
- Einheiten sind Fallstricke: `WALCL` ist in **Millionen** USD, `WTREGEN` und `RRPONTSYD`
  in **Milliarden**. Jede Umrechnung bekommt einen Unit-Test mit manuell nachgerechnetem Datum.
- Forward-Fill nur vorwärts, nie rückwärts (Look-ahead-Bias). Max-Alter beachten.
- Korrelationen immer auf `intersection`-Alignment und auf Log-Returns, nie auf Levels.

## 5. Layout & Befehle

```
.                      npm workspaces root
├─ apps/web            Next.js 15 App Router (UI + API-Routen + Datenschicht)
├─ worker              Node/tsx WS-Ingest (ab Phase 6)
├─ scripts             Repo-Tooling (check-no-mock)
└─ docs/api-samples    Provider-Response-Beispiele — NUR Doku, nie Laufzeitquelle
```

| Befehl | Zweck |
|---|---|
| `npm run dev` | Next.js Dev-Server (apps/web) |
| `npm run build` | Produktionsbuild |
| `npm test` | Vitest über alle Workspaces |
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm run check:no-mock` | §11-Enforcement, muss vor jedem Commit grün sein |
| `npm run docker:up` | Postgres 16 + Redis 7 lokal |
| `npm run db:generate` / `db:migrate` | Drizzle-Migrationen |

## 6. Aktueller Stand

**Phase 0 (Fundament) — implementiert.** Phase 1–7 stehen noch aus.
Es existieren bewusst noch **keine** Provider, keine `/api/series`-Route und kein UI.
