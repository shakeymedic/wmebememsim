// GCS is set by picking E, V and M separately (Jake's request); the total is calculated, the
// breakdown goes in the log and shows on the GCS tile while the total still matches.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

test('GCS: pick E, V and M; the total is calculated, logged and shown on the tile', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
  await page.getByRole('button', { name: 'Adult Medical', exact: true }).click();
  await page.locator('div.justify-between', { hasText: 'Tension Pneumothorax' }).first().getByRole('button', { name: 'Load' }).click();
  await page.getByRole('button', { name: 'Start Scenario' }).click();
  await page.evaluate(() => window.__simEngine.manualUpdateVitals({ gcs: 15 }));

  const tile = page.locator('[data-section="moreObs"]').getByText('GCS', { exact: true }).first();
  await tile.click();
  const parts = page.getByTestId('gcs-parts');
  await expect(parts).toBeVisible();
  // Starts from the current total, split E4 V5 M6.
  await expect(page.getByTestId('gcs-parts-total')).toHaveText('E4 V5 M6 = 15');
  await parts.getByRole('button', { name: 'E2 To pain' }).click();
  await parts.getByRole('button', { name: 'V3 Words' }).click();
  await parts.getByRole('button', { name: 'M5 Localises' }).click();
  await expect(page.getByTestId('gcs-parts-total')).toHaveText('E2 V3 M5 = 10');
  await expect(page.getByRole('spinbutton', { name: 'GCS' })).toHaveValue('10');
  await page.getByRole('button', { name: 'Now', exact: true }).click();
  await page.getByRole('button', { name: 'CONFIRM', exact: true }).click();

  await expect.poll(() => page.evaluate(() => window.__simEngine.state.vitals.gcs)).toBe(10);
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.log.some(l => l.msg === 'GCS set to 10 (E2 V3 M5)'))).toBe(true);
  await expect(page.locator('[data-section="moreObs"]').getByText('E2 V3 M5')).toBeVisible();

  // Reopening starts from the breakdown just set; typing a total gives a fresh split.
  await tile.click();
  await expect(page.getByTestId('gcs-parts-total')).toHaveText('E2 V3 M5 = 10');
  await page.getByRole('spinbutton', { name: 'GCS' }).fill('8');
  await expect(page.getByTestId('gcs-parts-total')).toHaveText('E2 V2 M4 = 8');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  // When the engine moves the total on, the stale breakdown disappears from the tile.
  await page.evaluate(() => window.__simEngine.manualUpdateVitals({ gcs: 6 }));
  await expect(page.locator('[data-section="moreObs"]').getByText('E2 V3 M5')).toHaveCount(0);
  expect(errors).toEqual([]);
});
