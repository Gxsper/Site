'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

/**
 * TanStack Query (PROJECT_SPEC.md §2, §10 Layer 3).
 *
 * `staleTime` orientiert sich an der kürzesten `updateCadence` im Katalog
 * (eine Stunde). Der Server cached ohnehin (§10 Layer 1 und 2) — der Client
 * soll nur vermeiden, bei jedem Reglerdruck neu zu laden.
 *
 * Bewusst kein `retry` bei 4xx: eine unbekannte Serien-ID wird durch Wiederholen
 * nicht bekannter.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 10 * 60_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              const message = error instanceof Error ? error.message : '';
              if (/Unbekannte Serien-ID|Ungültige Anfrage/.test(message)) return false;
              return failureCount < 2;
            },
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
