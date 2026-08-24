import type { Metadata } from 'next';

import { RiskDashboard } from '@/components/metrics/risk-dashboard';

export const metadata: Metadata = {
  title: 'Risk Metric — MacroDeck',
  description:
    'Risk Metric, logarithmische Regressionsbänder und Drawdown auf Basis der ' +
    'vollständigen Bitcoin-Historie.',
};

export default function Page() {
  return <RiskDashboard />;
}
