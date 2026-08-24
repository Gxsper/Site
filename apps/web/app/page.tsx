/**
 * Platzhalterseite fuer Phase 0.
 *
 * PROJECT_SPEC.md §13 sagt fuer Phase 0 ausdruecklich "Kein UI". Diese Seite
 * existiert nur, damit `npm run dev` einen Routen-Baum hat. Sie zeigt bewusst
 * keine einzige Zahl: es gibt in Phase 0 noch keinen Provider, und eine Zahl
 * ohne `SeriesResponse` mit `lastUpdated` waere ein Verstoss gegen §11.
 *
 * Das Overlay-Studio aus §9 entsteht in Phase 3 unter (dashboard)/page.tsx.
 */
export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">MacroDeck</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Zyklus- und Bewertungsanalyse mit Makro-Kontext.
        </p>
      </div>

      <div className="border-border bg-card rounded-lg border p-4">
        <p className="text-sm">
          <span className="font-medium">Phase 0 — Fundament.</span> Toolchain, Datenbank-Schema,
          Environment-Validierung und die No-Mock-Pruefung stehen. Datenschicht, Overlay-Engine
          und Charts folgen in Phase 1 bis 3.
        </p>
        <p className="text-muted-foreground mt-3 text-xs">
          Diese Seite zeigt keine Marktdaten, weil noch kein Provider angebunden ist. Erfundene
          oder beispielhafte Werte sind laut PROJECT_SPEC.md §11 ausgeschlossen.
        </p>
      </div>
    </main>
  );
}
