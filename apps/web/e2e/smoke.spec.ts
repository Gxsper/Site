import { expect, test, type Page } from '@playwright/test';

/**
 * Smoke-Tests über alle Seiten (PROJECT_SPEC.md §13 Phase 7).
 *
 * Der Schwerpunkt liegt nicht darauf, dass etwas gerendert wird, sondern
 * darauf, dass **nichts erfunden** wird. Ein Unit-Test kann nicht sehen, ob im
 * Browser am Ende eine 0 statt einer Lücke steht.
 */

/** Sammelt Konsolenfehler, damit ein stiller React-Fehler nicht durchrutscht. */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test.describe('Overlay-Studio', () => {
  test('lädt und zeigt den Serien-Browser', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'MacroDeck' })).toBeVisible();
    await expect(page.getByPlaceholder('Serie suchen…')).toBeVisible();
    // Der Katalog muss aus /api/catalog kommen, nicht aus einer Konstante.
    await expect(page.getByRole('button', { name: /Bitcoin \(USD, Binance\)/ })).toBeVisible();

    expect(errors, `Konsolenfehler: ${errors.join(' | ')}`).toEqual([]);
  });

  test('stellt den Zustand aus der URL wieder her', async ({ page }) => {
    await page.goto(
      '/?s=btc.usd.close,macro.net_liquidity&shift=0,90&norm=rebase100&align=union_ffill',
    );

    // Die Verschiebung muss in der Legende sichtbar sein (§5.3).
    await expect(page.getByText('macro.net_liquidity (+90d)')).toBeVisible();
    await expect(page.locator('canvas').first()).toBeVisible();

    // Und der Link muss den Zustand behalten — sonst ist er nicht teilbar (§9).
    expect(page.url()).toContain('shift=0%2C90');
    expect(page.url()).toContain('norm=rebase100');
  });

  test('zeigt die Attribution — Lizenzpflicht nach §15', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/TradingView Lightweight Charts/)).toBeVisible();
    await expect(page.getByText(/Keine Anlageberatung/)).toBeVisible();
  });
});

test.describe('Risk-Dashboard', () => {
  test('rechnet die Regression über die echte Historie', async ({ page }) => {
    await page.goto('/risk');

    // R² und Stichprobengröße gehören sichtbar dazu (§6.2).
    const stats = page.getByText(/R² = 0\.\d+ · n = /);
    await expect(stats).toBeVisible();

    const text = (await stats.textContent()) ?? '';
    const match = /n = ([\d.]+)/.exec(text);
    const n = Number((match?.[1] ?? '0').replace(/\./g, ''));
    // Über 5000 Tage Historie — kein Kurzzeitfenster.
    expect(n).toBeGreaterThan(5000);
  });

  test('nennt die Methodik jeder Kennzahl', async ({ page }) => {
    await page.goto('/risk');

    // Erst warten, bis die letzte Kennzahl gerechnet ist — `count()` wartet
    // nicht von selbst und liefert sonst eine Momentaufnahme vor dem Laden.
    await expect(page.getByText('tiefster Stand')).toBeVisible();

    // §14 verlangt den Methodik-Text im UI, nicht nur im Repo:
    // Regressionsbänder, Risk Metric und Drawdown.
    await expect(page.getByText('Methodik', { exact: true })).toHaveCount(3);
  });

  test('weist bei der full-Variante auf die Instabilität hin', async ({ page }) => {
    await page.goto('/risk');
    await page.getByRole('button', { name: 'full', exact: true }).click();
    await page.getByText('Methodik', { exact: true }).nth(1).click();
    await expect(page.getByText(/rückwirkend nicht stabil/)).toBeVisible();
  });
});

test.describe('Makro-Seite', () => {
  test('zeigt Net Liquidity gegen Bitcoin mit Lead-Lag', async ({ page }) => {
    await page.goto('/macro');

    await expect(page.getByRole('heading', { name: /Net Liquidity gegen Bitcoin/ })).toBeVisible();
    await expect(page.getByText(/Bestes Lead\/Lag auf Log-Returns/)).toBeVisible();
    // Auf gefüllten Daten muss die Warnung aus §5.4 erscheinen.
    await expect(page.getByText(/Korrelation auf gefüllten Daten/)).toBeVisible();
  });

  test('lädt alle Panels ohne Fehlermeldung', async ({ page }) => {
    await page.goto('/macro');
    await expect(page.getByRole('heading', { name: 'US-Geldmenge M2' })).toBeVisible();
    // Keine Serie darf einen Fehler melden.
    await expect(page.locator('main').getByText(/^fred\.\w+:/)).toHaveCount(0);
  });
});

test.describe('Derivate-Seite', () => {
  test('nennt den Aufzeichnungsbeginn statt Leere zu verschweigen', async ({ page }) => {
    await page.goto('/derivatives');
    await expect(page.getByRole('heading', { name: /Liquidationen BTCUSDT/ })).toBeVisible();

    // Entweder „Aufzeichnung seit …" oder der Hinweis, dass noch keine läuft.
    // Was nie vorkommen darf: eine leere Fläche ohne Erklärung (§11).
    const coverage = page.getByText(/Aufzeichnung seit/);
    const hint = page.getByText(/Noch keine Liquidation aufgezeichnet/);
    await expect(coverage.or(hint).first()).toBeVisible();
  });

  test('zeigt das Cluster als Messung und grenzt es von einer Prognose ab', async ({ page }) => {
    await page.goto('/derivatives');
    await expect(page.getByRole('heading', { name: 'Liquidations-Cluster' })).toBeVisible();

    // Der Unterschied zu einer Coinglass-Heatmap muss dabeistehen (§4.4):
    // hier Vergangenheit, dort eine Vermutung über die Zukunft.
    await expect(page.getByText(/Nicht zu verwechseln/)).toBeVisible();
    await expect(page.getByText(/eine Vermutung über die\s+Zukunft/)).toBeVisible();
  });

  test('nennt bei zu wenigen Ereignissen den Grund statt eine leere Fläche zu zeigen', async ({
    page,
  }) => {
    await page.goto('/derivatives');

    // Entweder ist ein Cluster gezeichnet, oder es steht dort, warum nicht.
    const chart = page.locator('section', { hasText: 'Liquidations-Cluster' }).locator('canvas');
    const hint = page.getByText(/Noch zu wenige Ereignisse für ein Cluster/);
    await expect(chart.or(hint).first()).toBeVisible();
  });
});

test.describe('Status-Seite', () => {
  test('zeigt den Zustand aller Quellen', async ({ page }) => {
    await page.goto('/health');
    await expect(page.getByRole('heading', { name: 'Quellen · letzte Stunde' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Serien' })).toBeVisible();

    // Keys dürfen nie im Klartext auftauchen (§0.2). Geprüft wird der
    // **sichtbare** Text: `textContent()` auf body würde auch Next.js' eigene
    // RSC-Payload in <script> erfassen und immer anschlagen.
    const visible = await page.locator('main').innerText();
    expect(visible).not.toMatch(/[A-Za-z0-9]{32,}/);
    // Statt des Wertes steht dort nur, ob ein Key gesetzt ist.
    expect(visible).toMatch(/Key (gesetzt|fehlt)|ohne Key/);
  });
});

test.describe('API', () => {
  test('/api/series liefert echte Punkte und lehnt Unsinn ab', async ({ request }) => {
    const from = Math.floor(Date.parse('2024-01-01T00:00:00Z') / 1000);
    const to = Math.floor(Date.parse('2024-01-31T00:00:00Z') / 1000);

    const ok = await request.get(
      `/api/series?ids=btc.usd.cm&from=${from}&to=${to}&norm=raw&raw=0`,
    );
    expect(ok.ok()).toBe(true);

    const body = (await ok.json()) as {
      aligned: { t: number[]; values: (number | null)[][] };
      errors: unknown[];
    };
    expect(body.errors).toEqual([]);
    expect(body.aligned.t.length).toBeGreaterThan(25);

    // Bitcoin lag im Januar 2024 nie bei 0 — ein 0-Wert wäre ein aufgefüllter Platzhalter.
    const values = body.aligned.values[0] ?? [];
    expect(values.some((v) => v === 0)).toBe(false);
    expect(values.every((v) => v === null || v > 1000)).toBe(true);

    const bad = await request.get('/api/series?ids=gibt.es.nicht&from=1704067200');
    expect(bad.status()).toBe(404);
  });

  test('/api/catalog nennt für jede Serie Quelle und Historienbeginn', async ({ request }) => {
    const response = await request.get('/api/catalog');
    const body = (await response.json()) as {
      series: { id: string; earliest: string; attribution: string }[];
    };

    expect(body.series.length).toBeGreaterThan(20);
    for (const entry of body.series) {
      expect(Number.isFinite(Date.parse(entry.earliest)), entry.id).toBe(true);
      expect(entry.attribution.length, entry.id).toBeGreaterThan(0);
    }
  });

  test('/api/health meldet keinen Key im Klartext', async ({ request }) => {
    const response = await request.get('/api/health');
    const text = await response.text();

    expect(text).toContain('providerKeys');
    // Nur die Information "gesetzt oder nicht", nie der Wert (§0.2).
    expect(text).toMatch(/"configured":(true|false)/);
  });
});
