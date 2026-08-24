import type { Metadata } from 'next';

import { HealthDashboard } from '@/components/health/health-dashboard';

export const metadata: Metadata = {
  title: 'Status — MacroDeck',
  description: 'Zustand aller Datenquellen, Serien und des Liquidations-Ingests.',
};

export default function Page() {
  return <HealthDashboard />;
}
