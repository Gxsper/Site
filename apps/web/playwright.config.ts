import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke-Tests (PROJECT_SPEC.md §13 Phase 7).
 *
 * Sie prüfen, dass jede Seite lädt, echte Daten zeigt und **keine erfundenen
 * Zahlen**. Der letzte Punkt ist der eigentliche Zweck: ein Unit-Test kann
 * nicht sehen, ob im Browser am Ende eine 0 statt einer Lücke steht.
 *
 * Der Dev-Server wird automatisch gestartet, wenn keiner läuft. Die Tests
 * brauchen eine erreichbare Datenbank — ohne sie melden die Seiten
 * Fehlerzustände, und genau das prüft einer der Tests.
 */
export default defineConfig({
  testDir: './e2e',
  // Netzwerkabrufe gegen echte Provider brauchen Luft.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['github']] : [['list']],

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/api/catalog',
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
