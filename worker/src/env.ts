import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Lädt die zentrale .env-Datei aus dem Repo-Root.
 *
 * Gleiche Aufgabe wie apps/web/lib/root-env.ts, bewusst dupliziert: der Worker
 * ist ein eigener Workspace mit eigenen Abhängigkeiten und soll nicht in die
 * Web-App hineingreifen. Die Datei ist klein und hat keine Abhängigkeiten.
 *
 * Der Repo-Root wird über den npm-workspaces-Marker gesucht, nicht über eine
 * feste Anzahl `..` — dieser Zähler war in der Web-App schon einmal falsch,
 * nachdem die Funktion in ein anderes Verzeichnis gewandert war.
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
        // Unlesbare package.json — weiter aufwärts.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

export function loadRootEnv(files: readonly string[] = ['.env.local', '.env']): void {
  const root = findRepoRoot(import.meta.dirname);
  if (!root) return;

  for (const file of files) {
    let contents: string;
    try {
      contents = readFileSync(path.resolve(root, file), 'utf8');
    } catch {
      continue;
    }

    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;

      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;

      const key = trimmed.slice(0, eq).trim();
      // Echte Umgebungsvariablen haben Vorrang.
      if (process.env[key] !== undefined) continue;

      let value = trimmed.slice(eq + 1).trim();
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}
