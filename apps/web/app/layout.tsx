import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'MacroDeck',
  description: 'Zyklus-, Bewertungs- und Makroanalyse auf Basis echter Marktdaten.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  // Dark-first (§9). Ein Theme-Toggle kommt mit der UI in Phase 3.
  return (
    <html lang="de" className="dark">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
