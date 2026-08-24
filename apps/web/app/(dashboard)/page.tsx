import { Suspense } from 'react';

import { OverlayStudio } from '@/components/overlay/overlay-studio';

/**
 * Overlay-Studio — die Startseite (PROJECT_SPEC.md §9).
 *
 * Die Suspense-Grenze ist nötig, weil das Studio `useSearchParams` benutzt:
 * ohne sie müsste Next die gesamte Seite dynamisch rendern.
 */
export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-muted-foreground text-xs">Overlay-Studio wird geladen…</p>
        </div>
      }
    >
      <OverlayStudio />
    </Suspense>
  );
}
