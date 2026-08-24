import type { Metadata } from 'next';

import { DerivativesDashboard } from '@/components/derivatives/derivatives-dashboard';

export const metadata: Metadata = {
  title: 'Derivate — MacroDeck',
  description:
    'Liquidationen aus eigenem WebSocket-Ingest, Open Interest, Funding Rate und ' +
    'Long/Short-Verhältnis.',
};

export default function Page() {
  return <DerivativesDashboard />;
}
