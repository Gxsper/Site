import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Sucht den Repo-Root aufwärts über den npm-workspaces-Marker.
 *
 * Bewusst nicht über eine feste Anzahl `..`: dieser Zähler war schon einmal
 * falsch, nachdem die Funktion in ein anderes Verzeichnis gewandert ist, und
 * der Fehler äußert sich erst zur Laufzeit als „DATABASE_URL: Required".
 */
export function findRepoRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);

  for (let depth = 0; depth < 10; depth++) {
    const candidate = path.join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const pkg: unknown = JSON.parse(readFileSync(candidate, 'utf8'));
        if (pkg && typeof pkg === 'object' && 'workspaces' in pkg) return dir;
      } catch {
        // Unlesbare package.json — weiter aufwärts suchen.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

/**
 * Lädt die zentrale .env-Datei aus dem Repo-Root.
 *
 * Next, tsx und drizzle-kit suchen jeweils in ihrem eigenen Arbeitsverzeichnis.
 * In diesem Monorepo liegt die Konfiguration bewusst an einer Stelle, damit
 * Web-App, Worker und Migrationen dieselben Werte sehen und nichts
 * auseinanderläuft.
 *
 * Bewusst ohne Abhängigkeit: das hier läuft auch im Produktionsstart, wo
 * devDependencies fehlen können.
 *
 * Echte Umgebungsvariablen haben Vorrang — eine Datei überschreibt nie, was
 * die Umgebung (CI, Container, Hosting) bereits gesetzt hat.
 */
export function loadRootEnv(
  files: readonly string[] = ['.env.local', '.env'],
  rootDir: string | null = findRepoRoot(import.meta.dirname),
): void {
  if (!rootDir) return;

  for (const file of files) {
    let contents: string;
    try {
      contents = readFileSync(path.resolve(rootDir, file), 'utf8');
    } catch {
      continue;
    }
    for (const [key, value] of parseEnvFile(contents)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

/** Minimaler .env-Parser: KEY=VALUE, `#`-Kommentare, optionale Anführungszeichen. */
export function parseEnvFile(contents: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    entries.push([key, value]);
  }

  return entries;
}
