import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findRepoRoot, loadRootEnv, parseEnvFile } from '@/lib/root-env';

let sandbox = '';

beforeEach(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), 'macrodeck-env-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('parseEnvFile', () => {
  it('liest einfache Zuweisungen', () => {
    expect(parseEnvFile('A=1\nB=zwei\n')).toEqual([
      ['A', '1'],
      ['B', 'zwei'],
    ]);
  });

  it('überspringt Kommentare und Leerzeilen', () => {
    expect(parseEnvFile('# Kommentar\n\nA=1\n')).toEqual([['A', '1']]);
  });

  it('behält Werte mit Gleichheitszeichen vollständig', () => {
    expect(parseEnvFile('DATABASE_URL=postgres://u:p@h:5432/db?x=1')).toEqual([
      ['DATABASE_URL', 'postgres://u:p@h:5432/db?x=1'],
    ]);
  });

  it('entfernt umschließende Anführungszeichen', () => {
    expect(parseEnvFile('A="1"\nB=\'2\'\n')).toEqual([
      ['A', '1'],
      ['B', '2'],
    ]);
  });

  it('liefert einen leeren Wert für eine leere Zuweisung', () => {
    // `REDIS_URL=` heißt "nicht konfiguriert", siehe env.ts.
    expect(parseEnvFile('REDIS_URL=\n')).toEqual([['REDIS_URL', '']]);
  });

  it('ignoriert Zeilen ohne Gleichheitszeichen', () => {
    expect(parseEnvFile('kaputt\nA=1\n')).toEqual([['A', '1']]);
  });
});

describe('findRepoRoot', () => {
  it('findet die package.json mit workspaces von einem Unterverzeichnis aus', () => {
    writeFileSync(
      path.join(sandbox, 'package.json'),
      JSON.stringify({ name: 'root', workspaces: ['apps/*'] }),
    );
    const nested = path.join(sandbox, 'apps', 'web', 'lib');
    mkdirSync(nested, { recursive: true });
    // Eine package.json ohne workspaces darf die Suche nicht stoppen.
    writeFileSync(
      path.join(sandbox, 'apps', 'web', 'package.json'),
      JSON.stringify({ name: 'web' }),
    );

    expect(findRepoRoot(nested)).toBe(sandbox);
  });

  it('liefert null, wenn es keinen Workspace-Root gibt', () => {
    const nested = path.join(sandbox, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    expect(findRepoRoot(nested)).toBeNull();
  });
});

describe('loadRootEnv', () => {
  const KEY = 'MACRODECK_TEST_KEY';

  afterEach(() => {
    delete process.env[KEY];
  });

  it('setzt Werte aus der Datei', () => {
    writeFileSync(path.join(sandbox, '.env.local'), `${KEY}=aus-datei\n`);
    loadRootEnv(['.env.local'], sandbox);
    expect(process.env[KEY]).toBe('aus-datei');
  });

  it('überschreibt keine bereits gesetzte Umgebungsvariable', () => {
    process.env[KEY] = 'aus-umgebung';
    writeFileSync(path.join(sandbox, '.env.local'), `${KEY}=aus-datei\n`);
    loadRootEnv(['.env.local'], sandbox);
    expect(process.env[KEY]).toBe('aus-umgebung');
  });

  it('gibt .env.local Vorrang vor .env', () => {
    writeFileSync(path.join(sandbox, '.env.local'), `${KEY}=lokal\n`);
    writeFileSync(path.join(sandbox, '.env'), `${KEY}=basis\n`);
    loadRootEnv(['.env.local', '.env'], sandbox);
    expect(process.env[KEY]).toBe('lokal');
  });

  it('wirft nicht, wenn keine Datei existiert', () => {
    expect(() => loadRootEnv(['.env.local'], sandbox)).not.toThrow();
  });

  it('tut nichts, wenn kein Repo-Root gefunden wurde', () => {
    expect(() => loadRootEnv(['.env.local'], null)).not.toThrow();
  });
});
