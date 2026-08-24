import { defineConfig } from 'drizzle-kit';
import dotenv from 'dotenv';

// .env.local hat Vorrang (Next-Konvention), .env als Fallback; zusaetzlich der
// Repo-Root, damit ein zentrales .env.local fuer Web + Worker reicht.
dotenv.config({ path: ['.env.local', '.env', '../../.env.local', '../../.env'] });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL fehlt. .env.example nach .env.local kopieren und ausfuellen, ' +
      'danach `npm run docker:up` fuer die lokale Datenbank.',
  );
}

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
