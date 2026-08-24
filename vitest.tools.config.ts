import { defineConfig } from 'vitest/config';

/**
 * Tests fuer das Repo-Tooling (scripts/). Die App-Tests liegen in den
 * Workspaces und laufen ueber `npm run test:workspaces`.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['scripts/**/*.test.mjs'],
  },
});
