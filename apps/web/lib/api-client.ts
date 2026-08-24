/**
 * Typisierter Zugriff auf die eigenen API-Routen.
 *
 * Bewusst keine Provider-Aufrufe im Client: jeder externe Zugriff läuft über
 * einen Server-Route-Handler, damit kein Key je in den Browser gelangt (§0.2).
 *
 * Fehler werden geworfen, nicht geschluckt. TanStack Query macht daraus einen
 * Fehlerzustand, den das UI nach §11 anzeigt.
 */

import type { SeriesDescriptor, SeriesResponse } from '@/lib/series/types';

export interface CatalogEntry extends SeriesDescriptor {
  available: boolean;
}

export interface CatalogResponse {
  series: CatalogEntry[];
  groups: string[];
  attributions: string[];
  count: number;
}

export interface AlignedPayload {
  t: number[];
  ids: string[];
  values: (number | null)[][];
  filled: boolean[][];
}

export interface LeadLagPoint {
  shift: number;
  r: number | null;
  n: number;
}

export interface CorrelationPayload {
  window: number;
  basis: string;
  rolling: (number | null)[];
  leadLag: LeadLagPoint[];
  best: LeadLagPoint | null;
  warning: string | null;
}

export interface SeriesApiResponse {
  series: (Omit<SeriesResponse, 'points'> & { points: []; pointCount?: number })[];
  aligned: AlignedPayload;
  correlation?: CorrelationPayload;
  errors: { id: string; message: string }[];
  meta: {
    from: number;
    to: number;
    generatedAt: number;
    requested: number;
    delivered: number;
    align: string;
    norm: string;
    gridPoints: number;
    allowsLogScale: boolean;
  };
}

async function readError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>;
      if (typeof record['error'] === 'string') {
        const issues = Array.isArray(record['issues']) ? ` (${record['issues'].join('; ')})` : '';
        return record['error'] + issues;
      }
    }
  } catch {
    // Kein JSON — der Status ist dann die beste verfügbare Auskunft.
  }
  return `HTTP ${response.status}`;
}

export async function fetchCatalog(signal?: AbortSignal): Promise<CatalogResponse> {
  const response = await fetch('/api/catalog', signal ? { signal } : {});
  if (!response.ok) throw new Error(`Katalog nicht abrufbar: ${await readError(response)}`);
  return response.json() as Promise<CatalogResponse>;
}

export async function fetchSeries(
  query: string,
  signal?: AbortSignal,
): Promise<SeriesApiResponse> {
  const response = await fetch(`/api/series?${query}`, signal ? { signal } : {});
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<SeriesApiResponse>;
}
