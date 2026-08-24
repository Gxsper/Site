import { expect, test } from '@playwright/test';

/**
 * Performance-Nachweis (PROJECT_SPEC.md §13, Phase 7):
 * „Chart mit 10 Serien × 5000 Punkten muss < 100 ms Interaktionslatenz haben."
 *
 * Gemessen wird, was der Nutzer spürt: die Zeit von einem Klick bis zu dem
 * Frame, in dem das Ergebnis auf dem Bildschirm steht. Nicht die Rechenzeit
 * einer Funktion — die sagt nichts darüber, ob sich die Oberfläche zäh anfühlt.
 *
 * Der erste Ladevorgang zählt bewusst **nicht** zur Interaktionslatenz: dort
 * werden Provider abgefragt und Jahre an Historie übertragen. Gemessen wird
 * die Interaktion auf bereits geladenen Daten.
 */

/** Zehn Serien mit möglichst langer Historie. */
const SERIES = [
  'btc.usd.cm',
  'onchain.btc.marketcap',
  'onchain.btc.supply',
  'onchain.btc.mvrv',
  'onchain.btc.hashrate',
  'fred.DGS10',
  'fred.T10Y2Y',
  'fred.VIXCLS',
  'fred.WM2NS',
  'fred.NFCI',
].join(',');

const FROM = Math.floor(Date.parse('2011-01-01T00:00:00Z') / 1000);
const TO = Math.floor(Date.now() / 1000);

test.describe('Performance', () => {
  // Zehn Serien über 15 Jahre zu laden dauert beim ersten Mal.
  test.setTimeout(240_000);

  test('10 Serien reagieren unter 100 ms auf eine Interaktion', async ({ page }) => {
    await page.goto(
      `/?s=${SERIES}&from=${FROM}&to=${TO}&align=union_ffill&norm=rebase100`,
    );

    // Warten, bis alle zehn Serien im Layer-Panel stehen und das Chart gezeichnet ist.
    await expect(page.locator('aside').last().locator('li')).toHaveCount(10, { timeout: 180_000 });
    await expect(page.locator('canvas').first()).toBeVisible();
    await expect(page.getByText(/Rasterpunkte/)).toBeVisible();

    const gridInfo = (await page.getByText(/Rasterpunkte/).textContent()) ?? '';
    const gridPoints = Number((/([\d.]+)\s+Rasterpunkte/.exec(gridInfo)?.[1] ?? '0').replace(/\./g, ''));

    // Die Vorgabe verlangt 5000 Punkte je Serie — sonst misst der Test zu wenig.
    expect(gridPoints, `Raster hat nur ${gridPoints} Punkte`).toBeGreaterThan(5000);

    // Ein paar Durchläufe, damit ein einzelner Ausreißer nicht das Bild bestimmt.
    const latencies: number[] = [];
    for (let run = 0; run < 5; run++) {
      const latency = await page.evaluate(async () => {
        const button = [...document.querySelectorAll('header button')].find(
          (element) => element.textContent?.trim() === 'log',
        );
        if (!button) throw new Error('Log-Umschalter nicht gefunden');

        const started = performance.now();
        (button as HTMLButtonElement).click();

        // Bis zu dem Frame warten, in dem das Ergebnis sichtbar ist.
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        return performance.now() - started;
      });

      latencies.push(latency);
    }

    const median = [...latencies].sort((a, b) => a - b)[Math.floor(latencies.length / 2)]!;
    const worst = Math.max(...latencies);

    console.log(
      `Interaktionslatenz bei ${gridPoints.toLocaleString('de-DE')} Rasterpunkten × 10 Serien: ` +
        `Median ${median.toFixed(1)} ms, schlechtester Wert ${worst.toFixed(1)} ms ` +
        `(alle: ${latencies.map((l) => l.toFixed(1)).join(', ')} ms)`,
    );

    // §13: unter 100 ms. Gemessen am Median, damit ein einzelner
    // Garbage-Collection-Lauf das Ergebnis nicht kippt.
    expect(median).toBeLessThan(100);
  });
});
