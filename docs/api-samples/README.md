# Provider-Response-Beispiele

PROJECT_SPEC.md §0.3: vor der Implementierung jedes Providers wird die offizielle
Doku gefetcht und die tatsächliche Response-Shape verifiziert. Ein echtes
Response-Beispiel landet hier als `<provider>.json`.

**Diese Dateien sind ausschließlich Dokumentation.** Sie werden von keinem
Laufzeitcode importiert — `npm run check:no-mock` bricht den Build ab, wenn ein
Pfad unterhalb von `docs/api-samples` in `apps/web` oder `worker` auftaucht.

Konvention pro Datei:

```jsonc
{
  "_meta": {
    "fetchedAt": "2026-01-01T00:00:00Z",
    "url": "https://api.stlouisfed.org/fred/series/observations?...",
    "docs": "https://fred.stlouisfed.org/docs/api/fred/series_observations.html",
    "note": "Key aus der URL entfernt."
  },
  "response": {}
}
```

Ab Phase 1 gefüllt.
