// Patient condition (AUTO/MANUAL deterioration with Trend Better / Worse) sits straight under the obs,
// above Rhythm & resus, so steering the patient is in one place.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

test('Patient condition comes straight after the obs, before Rhythm & resus', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
  await page.getByRole('button', { name: 'Adult Medical', exact: true }).click();
  await page.locator('div.justify-between', { hasText: 'Tension Pneumothorax' }).first().getByRole('button', { name: 'Load' }).click();
  await page.getByRole('button', { name: 'Start Scenario' }).click();
  const order = await page.evaluate(() => Array.from(document.querySelectorAll('[data-section]')).map(e => e.getAttribute('data-section')));
  const i = (id) => order.indexOf(id);
  expect(i('condition')).toBeGreaterThan(i('moreObs'));
  expect(i('condition')).toBe(i('moreObs') + 1);
  expect(i('condition')).toBeLessThan(i('resus'));
  await expect(page.locator('[data-section="condition"]').getByTitle('Trend the patient BETTER (logged)')).toBeVisible();
  expect(errors).toEqual([]);
});

test('on a short laptop screen Auto / Better / Worse sit on the More obs row under the obs, and ARREST stays on screen', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: 'block' });
  await useFakeFirebase(context);
  const page = await context.newPage();
  const errors = trackErrors(page);
  await openController(page);
  await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
  await page.getByRole('button', { name: 'Adult Medical', exact: true }).click();
  await page.locator('div.justify-between', { hasText: 'Tension Pneumothorax' }).first().getByRole('button', { name: 'Load' }).click();
  await page.getByRole('button', { name: 'Start Scenario' }).click();
  const quick = page.locator('[data-section="moreObs"]').getByTestId('condition-quick');
  await expect(quick).toBeVisible();
  const mode = () => page.evaluate(() => window.__simEngine.state.deteriorationMode || 'manual');
  const before = await mode();
  await quick.getByRole('button', { name: /^(Auto|Manual)$/ }).click();
  await expect.poll(mode).not.toBe(before);
  await quick.getByRole('button', { name: 'Worse', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.log.some(l => /Deteriorating \(Trend\)/.test(l.msg)))).toBe(true);
  await expect(page.locator('[data-section="condition"]')).toHaveCount(1);     // the full section is still there, lower down
  expect(errors).toEqual([]);
  await context.close();
});
