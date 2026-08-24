/**
 * Tests für die Abschnittsbildung des Nachtjobs.
 *
 * Hintergrund: Netlify schneidet Funktionen nach 30 s ab (gemessen am
 * 2026-08-24 mit einem HTTP 504), der volle Katalog braucht länger. `runNightly`
 * läuft deshalb bis zum Zeitbudget und meldet mit `nextOffset`, wo fortzusetzen
 * ist. Rechnet das falsch, werden Serien stillschweigend übersprungen oder der
 * Job dreht sich im Kreis — beides fällt im Betrieb kaum auf, deshalb hier.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const KATALOG = [
  { id: 's0' },
  { id: 's1' },
  { id: 's2' },
  { id: 's3' },
  { id: 's4' },
] as const;

/** Wie lange ein einzelner Serienabruf im Test „dauert". */
let dauerProSerie = 0;

vi.mock('@/lib/series/catalog', () => ({ CATALOG: KATALOG }));

vi.mock('@/lib/series/service', () => ({
  loadSeries: vi.fn(async () => {
    if (dauerProSerie > 0) vi.advanceTimersByTime(dauerProSerie);
    return { response: { points: [{ t: 1_700_000_000, v: 1 }] }, warning: undefined };
  }),
}));

const { runNightly } = await import('@/lib/series/nightly');

describe('runNightly — Abschnitte', () => {
  beforeEach(() => {
    dauerProSerie = 0;
    vi.useFakeTimers();
  });

  it('läuft ohne Zeitbudget durch und meldet nichts Offenes', async () => {
    const lauf = runNightly();
    await vi.runAllTimersAsync();
    const bericht = await lauf;

    expect(bericht.total).toBe(5);
    expect(bericht.succeeded).toBe(5);
    expect(bericht.nextOffset).toBeNull();
    expect(bericht.results.map((r) => r.id)).toEqual(['s0', 's1', 's2', 's3', 's4']);
  });

  it('beginnt beim offset und lässt das Davorliegende aus', async () => {
    const lauf = runNightly({ offset: 3 });
    await vi.runAllTimersAsync();
    const bericht = await lauf;

    expect(bericht.results.map((r) => r.id)).toEqual(['s3', 's4']);
    expect(bericht.nextOffset).toBeNull();
  });

  it('bricht am Zeitbudget ab und nennt die Position zum Fortsetzen', async () => {
    // Jede Serie kostet 8 s, Budget 20 s: nach s0, s1 und s2 sind 24 s
    // verbraucht, vor s3 greift die Prüfung.
    dauerProSerie = 8_000;
    const lauf = runNightly({ deadlineMs: 20_000 });
    await vi.runAllTimersAsync();
    const bericht = await lauf;

    expect(bericht.results.map((r) => r.id)).toEqual(['s0', 's1', 's2']);
    expect(bericht.nextOffset).toBe(3);
    // Offen ist nicht kaputt: die Übersprungenen zählen nicht als Fehlschlag.
    expect(bericht.failed).toBe(0);
  });

  it('setzt an der gemeldeten Position lückenlos fort', async () => {
    dauerProSerie = 8_000;
    const ersterLauf = runNightly({ deadlineMs: 20_000 });
    await vi.runAllTimersAsync();
    const erster = await ersterLauf;

    dauerProSerie = 0;
    const zweiterLauf = runNightly({ offset: erster.nextOffset!, deadlineMs: 20_000 });
    await vi.runAllTimersAsync();
    const zweiter = await zweiterLauf;

    const gesehen = [...erster.results, ...zweiter.results].map((r) => r.id);
    expect(gesehen).toEqual(['s0', 's1', 's2', 's3', 's4']);
    expect(zweiter.nextOffset).toBeNull();
  });

  it('meldet nichts Offenes, wenn der offset hinter dem Katalog liegt', async () => {
    const lauf = runNightly({ offset: 99 });
    await vi.runAllTimersAsync();
    const bericht = await lauf;

    expect(bericht.total).toBe(0);
    expect(bericht.nextOffset).toBeNull();
  });
});
