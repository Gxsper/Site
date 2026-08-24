/**
 * GET /api/catalog — verfügbare Serien und ihre Metadaten (PROJECT_SPEC.md §3).
 *
 * Reine Katalogauskunft, kein Provider-Zugriff. Der Serien-Browser im
 * Overlay-Studio (§9) speist sich hieraus.
 */

import { NextResponse } from 'next/server';

import { isProviderImplemented } from '@/lib/providers';
import { CATALOG } from '@/lib/series/catalog';

export const dynamic = 'force-static';

export function GET() {
  const series = CATALOG.map((d) => ({
    ...d,
    // Ehrlich benennen, was tatsächlich abrufbar ist: ein Descriptor kann im
    // Katalog stehen, bevor sein Provider implementiert ist.
    available: isProviderImplemented(d.provider),
  }));

  const groups = [...new Set(CATALOG.map((d) => d.group))].sort();
  const attributions = [...new Set(CATALOG.map((d) => d.attribution))].sort();

  return NextResponse.json({
    series,
    groups,
    attributions,
    count: series.length,
  });
}
