#!/usr/bin/env node
/**
 * check-no-mock — Durchsetzung von PROJECT_SPEC.md §11 (NO-MOCK-DATA).
 *
 * Durchsucht den Laufzeitcode nach Mustern, die auf erfundene Daten hindeuten,
 * und beendet sich mit Exit-Code 1, sobald ein Treffer ausserhalb von
 * Testdateien liegt. Laeuft lokal (`npm run check:no-mock`) und in CI.
 *
 * Bewusst ohne Dependencies: der Check muss auch dann laufen, wenn die
 * Workspaces noch nicht installiert sind.
 *
 * Testdateien (*.test.*, *.spec.*, __tests__/) sind ausgenommen — dort sind
 * konstruierte Fixtures ausdruecklich erwuenscht.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/** Verzeichnisse, die Laufzeitcode enthalten. Nicht gelistet = nicht geprueft. */
export const DEFAULT_ROOTS = [
  'apps/web/app',
  'apps/web/lib',
  'apps/web/components',
  'apps/web/hooks',
  'worker/src',
];

const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const IGNORED_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  '.turbo',
  'dist',
  'build',
  'out',
  'coverage',
  '__tests__',
]);

/**
 * Die Musterliste aus PROJECT_SPEC.md §11, plus zwei Ergaenzungen, die
 * dieselbe Regel absichern: stille Platzhalter-Generatoren und der Import
 * von Doku-Fixtures als Laufzeitquelle (§0.3).
 */
export const FORBIDDEN_PATTERNS = [
  { id: 'math-random', re: /Math\s*\.\s*random/gi, why: 'Zufallszahlen im Datenpfad — §11' },
  { id: 'faker', re: /faker/gi, why: 'Fake-Data-Bibliothek — §11' },
  { id: 'mock-data', re: /mock[_-]?data/gi, why: 'Mock-Daten im Laufzeitcode — §11' },
  { id: 'sample-data', re: /sample[_-]?data/gi, why: 'Sample-Daten im Laufzeitcode — §11' },
  { id: 'dummy', re: /dummy/gi, why: 'Platzhalterwerte — §11' },
  { id: 'placeholder-series', re: /placeholder[_-]?series/gi, why: 'Platzhalter-Zeitreihe — §11' },
  { id: 'generate-placeholder', re: /generate[_-]?placeholder/gi, why: 'Stiller Ersatzwert-Generator — §11' },
  { id: 'api-samples-import', re: /docs\/api-samples/gi, why: 'Doku-Fixture als Laufzeitquelle — §0.3' },
];

/** Testdateien duerfen konstruierte Daten enthalten. */
export function isTestFile(relPath) {
  const p = relPath.replace(/\\/g, '/');
  return /(^|\/)__tests__\//.test(p) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(p);
}

function* walk(absDir, cwd) {
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      yield* walk(abs, cwd);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SCANNED_EXTENSIONS.has(path.extname(entry.name))) continue;
    const rel = path.relative(cwd, abs).replace(/\\/g, '/');
    if (isTestFile(rel)) continue;
    yield { abs, rel };
  }
}

/** Prueft eine einzelne Datei und liefert alle Treffer. */
export function scanFile(absPath, relPath) {
  const findings = [];
  const source = readFileSync(absPath, 'utf8');
  const lines = source.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    for (const pattern of FORBIDDEN_PATTERNS) {
      pattern.re.lastIndex = 0;
      let match;
      while ((match = pattern.re.exec(line)) !== null) {
        findings.push({
          file: relPath,
          line: index + 1,
          column: match.index + 1,
          match: match[0],
          patternId: pattern.id,
          why: pattern.why,
          source: line.trim(),
        });
        if (match.index === pattern.re.lastIndex) pattern.re.lastIndex++;
      }
    }
  }
  return findings;
}

/**
 * Scannt die angegebenen Wurzelverzeichnisse.
 * @returns {{ findings: object[], scannedFiles: number, missingRoots: string[] }}
 */
export function scanRoots({ cwd = process.cwd(), roots = DEFAULT_ROOTS } = {}) {
  const findings = [];
  const missingRoots = [];
  let scannedFiles = 0;

  for (const root of roots) {
    const absRoot = path.resolve(cwd, root);
    try {
      if (!statSync(absRoot).isDirectory()) {
        missingRoots.push(root);
        continue;
      }
    } catch {
      missingRoots.push(root);
      continue;
    }
    for (const file of walk(absRoot, cwd)) {
      scannedFiles++;
      findings.push(...scanFile(file.abs, file.rel));
    }
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
  return { findings, scannedFiles, missingRoots };
}

function main() {
  const cwd = process.cwd();
  const { findings, scannedFiles, missingRoots } = scanRoots({ cwd });

  if (findings.length === 0) {
    console.log(`check:no-mock — OK. ${scannedFiles} Datei(en) geprueft, keine Treffer.`);
    if (missingRoots.length > 0) {
      console.log(`  (noch nicht angelegt, uebersprungen: ${missingRoots.join(', ')})`);
    }
    return 0;
  }

  console.error('');
  console.error('check:no-mock — FEHLGESCHLAGEN (PROJECT_SPEC.md §11: NO-MOCK-DATA)');
  console.error('');
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}:${f.column}  "${f.match}"  — ${f.why}`);
    console.error(`      ${f.source}`);
  }
  console.error('');
  console.error(`${findings.length} Treffer in ${new Set(findings.map((f) => f.file)).size} Datei(en).`);
  console.error('Echte Daten aus einem Provider verwenden oder einen definierten');
  console.error('Fehlerzustand rendern (§11-Tabelle). Den Check nicht aufweichen.');
  console.error('');
  return 1;
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  process.exit(main());
}

export { main };
