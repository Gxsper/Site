import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Providers } from '@/app/providers';

import './globals.css';

export const metadata: Metadata = {
  title: 'MacroDeck',
  description: 'Zyklus- und Bewertungsanalyse mit Makro-Kontext auf Basis echter Marktdaten.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  // Dark-first (§9).
  return (
    <html lang="de" className="dark">
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
