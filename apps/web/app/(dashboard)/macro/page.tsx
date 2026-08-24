import type { Metadata } from 'next';

import { MacroDashboard } from '@/components/macro/macro-dashboard';

export const metadata: Metadata = {
  title: 'Makro & Fed — MacroDeck',
  description:
    'Fed Net Liquidity, Bilanzkomponenten, Zinskurve mit Rezessionen, Realzinsen ' +
    'und Financial Conditions.',
};

export default function Page() {
  return <MacroDashboard />;
}
