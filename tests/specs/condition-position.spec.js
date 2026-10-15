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

test('on a short laptop screen the one set of Auto / Better / Worse sits on the More obs row, with no second copy, and ARREST stays on screen', async ({ browser }) => {
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
  // One place only: no second Patient condition row and no second Better / Worse on screen.
  await expect(page.locator('[data-section="condition"]')).toBeHidden();
  await expect(page.locator('[data-testid="condition-quick"]:visible')).toHaveCount(1);
  await expect(page.locator('button[title="Trend the patient WORSE (logged)"]:visible')).toHaveCount(1);
  const mode = () => page.evaluate(() => window.__simEngine.state.deteriorationMode || 'manual');
  const before = await mode();
  await quick.getByRole('button', { name: /^(Auto|Manual)$/ }).click();
  await expect.poll(mode).not.toBe(before);
  await quick.getByRole('button', { name: 'Worse', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.log.some(l => /Deteriorating \(Trend\)/.test(l.msg)))).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});

test('on a tall screen Patient condition is one row under the obs, and More obs carries no copy of its buttons', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
  await page.getByRole('button', { name: 'Adult Medical', exact: true }).click();
  await page.locator('div.justify-between', { hasText: 'Tension Pneumothorax' }).first().getByRole('button', { name: 'Load' }).click();
  await page.getByRole('button', { name: 'Start Scenario' }).click();
  await expect(page.locator('[data-section="condition"]').getByTestId('condition-quick')).toBeVisible();
  await expect(page.locator('[data-section="moreObs"]').getByTestId('condition-quick')).toHaveCount(0);
  await expect(page.locator('button[title="Trend the patient BETTER (logged)"]:visible')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('on a phone Patient condition is one row, with one set of buttons', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await useFakeFirebase(context);
  const page = await context.newPage();
  const errors = trackErrors(page);
  await openController(page);
  await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
  await page.getByRole('button', { name: 'Adult Medical', exact: true }).click();
  await page.locator('div.justify-between', { hasText: 'Tension Pneumothorax' }).first().getByRole('button', { name: 'Load' }).click();
  await page.getByRole('button', { name: 'Start Scenario' }).click();
  await expect(page.locator('[data-section="condition"]').getByTestId('condition-quick')).toBeVisible();
  await expect(page.locator('[data-testid="condition-quick"]:visible')).toHaveCount(1);
  expect(errors).toEqual([]);
  await context.close();
});
