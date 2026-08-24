import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isTestFile, scanRoots } from './check-no-mock.mjs';

/**
 * Der Check aus PROJECT_SPEC.md §11 sichert das gesamte Projekt ab. Wenn er
 * stillschweigend nichts mehr findet, faellt das sonst niemandem auf — deshalb
 * wird er selbst getestet.
 *
 * Diese Datei enthaelt absichtlich verbotene Muster. Das ist zulaessig: sie ist
 * eine Testdatei und liegt ausserdem nicht in einem der geprueften
 * Wurzelverzeichnisse.
 */

let sandbox = '';

function write(relPath, contents) {
  const abs = path.join(sandbox, relPath);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, contents, 'utf8');
  return abs;
}

beforeEach(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), 'macrodeck-no-mock-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('scanRoots', () => {
  it('meldet sauberen Laufzeitcode als OK', () => {
    write('lib/series.ts', 'export const parse = (raw: string) => JSON.parse(raw);\n');

    const { findings, scannedFiles } = scanRoots({ cwd: sandbox, roots: ['lib'] });

    expect(findings).toHaveLength(0);
    expect(scannedFiles).toBe(1);
  });

  it('findet ein absichtlich eingefuegtes Math.random() im Laufzeitcode', () => {
    write('lib/prices.ts', 'export function latest() {\n  return Math.random() * 100;\n}\n');

    const { findings } = scanRoots({ cwd: sandbox, roots: ['lib'] });

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('lib/prices.ts');
    expect(findings[0].line).toBe(2);
    expect(findings[0].patternId).toBe('math-random');
  });

  it('findet die uebrigen Muster aus §11', () => {
    write('lib/a.ts', 'export const x = mockData;\n');
    write('lib/b.ts', 'export const y = sampleData;\n');
    write('lib/c.ts', 'export const z = DUMMY_PRICE;\n');
    write('lib/d.ts', 'export const w = placeholderSeries;\n');
    write('lib/e.ts', "import { faker } from '@faker-js/faker';\n");

    const { findings } = scanRoots({ cwd: sandbox, roots: ['lib'] });
    const ids = new Set(findings.map((f) => f.patternId));

    expect(ids).toContain('mock-data');
    expect(ids).toContain('sample-data');
    expect(ids).toContain('dummy');
    expect(ids).toContain('placeholder-series');
    expect(ids).toContain('faker');
  });

  it('verbietet den Import von Doku-Fixtures als Laufzeitquelle (§0.3)', () => {
    write('lib/f.ts', "import fred from '../../docs/api-samples/fred.json';\n");

    const { findings } = scanRoots({ cwd: sandbox, roots: ['lib'] });

    expect(findings.map((f) => f.patternId)).toContain('api-samples-import');
  });

  it('ignoriert Testdateien — dort sind Fixtures erlaubt', () => {
    write('lib/prices.test.ts', 'const v = Math.random();\n');
    write('lib/prices.spec.tsx', 'const v = Math.random();\n');
    write('lib/__tests__/helper.ts', 'const v = Math.random();\n');

    const { findings } = scanRoots({ cwd: sandbox, roots: ['lib'] });

    expect(findings).toHaveLength(0);
  });

  it('ignoriert node_modules und Build-Ordner', () => {
    write('lib/node_modules/dep/index.js', 'Math.random();\n');
    write('lib/.next/server/chunk.js', 'Math.random();\n');

    const { findings, scannedFiles } = scanRoots({ cwd: sandbox, roots: ['lib'] });

    expect(findings).toHaveLength(0);
    expect(scannedFiles).toBe(0);
  });

  it('prueft nur Code-Dateiendungen', () => {
    write('lib/README.md', 'Nie Math.random() benutzen.\n');

    const { findings } = scanRoots({ cwd: sandbox, roots: ['lib'] });

    expect(findings).toHaveLength(0);
  });

  it('meldet fehlende Wurzelverzeichnisse, statt zu werfen', () => {
    const { findings, missingRoots } = scanRoots({ cwd: sandbox, roots: ['gibt-es-nicht'] });

    expect(findings).toHaveLength(0);
    expect(missingRoots).toEqual(['gibt-es-nicht']);
  });

  it('findet mehrere Treffer in derselben Zeile', () => {
    write('lib/g.ts', 'const a = Math.random(), b = Math.random();\n');

    const { findings } = scanRoots({ cwd: sandbox, roots: ['lib'] });

    expect(findings).toHaveLength(2);
    expect(findings[0].column).toBeLessThan(findings[1].column);
  });
});

describe('isTestFile', () => {
  it.each([
    ['lib/a.test.ts', true],
    ['lib/a.test.tsx', true],
    ['lib/a.spec.ts', true],
    ['scripts/a.test.mjs', true],
    ['lib/__tests__/a.ts', true],
    ['lib/a.ts', false],
    ['lib/latest.ts', false],
  ])('%s -> %s', (input, expected) => {
    expect(isTestFile(input)).toBe(expected);
  });
});
