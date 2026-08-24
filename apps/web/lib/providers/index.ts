/**
 * Provider-Registry (PROJECT_SPEC.md §3.2).
 *
 * Der einzige Ort, an dem eine SeriesDescriptor-`provider`-ID zu einer
 * Implementierung wird. Ein Descriptor, dessen Provider hier nicht registriert
 * ist, führt zu einem Fehler — nicht zu einer stillen Leerantwort (§11).
 */

import { alternativeMeProvider } from '@/lib/providers/alternativeme';
import { binanceProvider } from '@/lib/providers/binance';
import { coinMetricsProvider } from '@/lib/providers/coinmetrics';
import { ProviderError, type Provider, type ProviderId } from '@/lib/series/types';

const REGISTRY: Partial<Record<ProviderId, Provider>> = {
  binance: binanceProvider,
  coinmetrics: coinMetricsProvider,
  alternativeme: alternativeMeProvider,
};

/** Alle Provider, die bereits implementiert sind. */
export function listProviders(): readonly Provider[] {
  return Object.values(REGISTRY).filter((p): p is Provider => p !== undefined);
}

export function getProvider(id: ProviderId): Provider {
  const provider = REGISTRY[id];
  if (!provider) {
    const known = Object.keys(REGISTRY).join(', ');
    throw new ProviderError(
      id,
      `Provider "${id}" ist noch nicht implementiert. Verfügbar: ${known}.`,
    );
  }
  return provider;
}

export function isProviderImplemented(id: ProviderId): boolean {
  return REGISTRY[id] !== undefined;
}
