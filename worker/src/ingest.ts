/**
 * WebSocket-Ingest (PROJECT_SPEC.md §3, §4.4) — Implementierung ab Phase 6.
 *
 * Der Workspace existiert bereits, weil die Architektur in §3 den Worker als
 * eigenen Prozess vorsieht und seine Abhaengigkeiten nicht im Web-Bundle
 * landen sollen.
 *
 * Bewusst ohne Platzhalter-Logik: dieser Prozess erzeugt keine Ereignisse und
 * schreibt nichts in die Datenbank, solange er nicht wirklich an Binance-,
 * Bybit- und OKX-Streams haengt. Ein Worker, der "irgendetwas" schreibt, waere
 * genau der Fall, den §11 ausschliesst.
 */

const NOT_IMPLEMENTED = [
  'worker: WS-Ingest ist noch nicht implementiert (PROJECT_SPEC.md §13, Phase 6).',
  'Geplante Quellen:',
  '  - Binance Futures  wss://fstream.binance.com/ws/!forceOrder@arr',
  '  - Bybit v5         wss://stream.bybit.com/v5/public/linear  (allLiquidation.<symbol>)',
  '  - OKX              liquidation-orders',
  'Ziel: Tabelle `liquidations` in apps/web/lib/db/schema.ts.',
].join('\n');

function main(): never {
  console.error(NOT_IMPLEMENTED);
  process.exit(1);
}

main();
