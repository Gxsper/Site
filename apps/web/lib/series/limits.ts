/**
 * Token-Bucket-Konfiguration pro Provider (PROJECT_SPEC.md §10).
 *
 * Alle Werte liegen bewusst **unter** dem offiziellen Limit. Ein Rate-Limit zu
 * treffen kostet mehr als ein paar Sekunden Wartezeit, und bei CoinGecko zählt
 * jeder Aufruf gegen ein Monatsbudget.
 *
 * Die dokumentierten Limits stehen jeweils als Kommentar daneben — Zahlen ohne
 * Begründung sind in diesem Repo nichts wert.
 */

import type { TokenBucketConfig } from '@/lib/cache/types';
import type { ProviderId } from '@/lib/series/types';

const DEFAULT_LIMIT: TokenBucketConfig = { capacity: 5, refillPerSecond: 1 };

const LIMITS: Partial<Record<ProviderId, TokenBucketConfig>> = {
  // Offiziell 1200 Gewichtseinheiten/Minute; Klines wiegen 1–2.
  // 10/s mit Puffer 20 ist weit darunter.
  binance: { capacity: 20, refillPerSecond: 10 },

  // Community-Tier ohne dokumentiertes Limit. Bewusst sehr defensiv:
  // die Historie kommt in wenigen großen Seiten, nicht in vielen kleinen.
  coinmetrics: { capacity: 4, refillPerSecond: 1 },

  // Kein dokumentiertes Limit, ein Aufruf liefert die gesamte Historie.
  alternativeme: { capacity: 2, refillPerSecond: 0.5 },

  // Mit Key 120/min erlaubt — §10 fordert konservativ darunter zu bleiben.
  fred: { capacity: 30, refillPerSecond: 1 },

  // Erlaubt 100/min, §10 gibt 60/min vor. Zusätzlich gilt ein Monatsbudget
  // von 10.000 Aufrufen, das getrennt gezählt werden muss.
  coingecko: { capacity: 10, refillPerSecond: 1 },
};

export function getRateLimit(provider: ProviderId): TokenBucketConfig {
  return LIMITS[provider] ?? DEFAULT_LIMIT;
}

export function rateLimitBucketKey(provider: ProviderId): string {
  return `ratelimit:${provider}`;
}
