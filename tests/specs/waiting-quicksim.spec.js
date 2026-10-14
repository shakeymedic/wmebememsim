// Two reported bugs (14 Oct 2026):
//  - Quick Sim started in Sinus Tachycardia at the adult resting rate of 75/min.
//  - A patient screen connected to a controller with no scenario chosen showed a default patient
//    instead of staying blank and waiting.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, pressStart, live, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const startQuickSimIn = async (page, rhythm) => {
  await page.getByRole('button', { name: 'Quick Sim', exact: true }).click();
  await page.getByLabel('Starting rhythm').selectOption(rhythm);
  await page.getByRole('button', { name: 'Start Quick Sim' }).click();
};
const hr = (page) => page.evaluate(() => window.__simEngine.state.vitals.hr);

test('Quick Sim starts at a heart rate that fits the chosen rhythm', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await startQuickSimIn(page, 'Sinus Tachycardia');
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.rhythm)).toBe('Sinus Tachycardia');
  let rate = await hr(page);
  expect(rate).toBeGreaterThanOrEqual(110);
  expect(rate).toBeLessThanOrEqual(130);
  await pressStart(page);
  await page.waitForTimeout(1500);
  expect(await hr(page)).toBeGreaterThanOrEqual(105);
  expect(errors).toEqual([]);
});

test('Quick Sim rhythm rates: sinus rhythm keeps the normal rate; brady, SVT and a child\'s tachycardia fit', async ({ page }) => {
  await openController(page);
  const rates = await page.evaluate(() => {
    const b = (rhythm, age) => window.buildQuickSimScenario({ rhythm, age }).vitals.hr;
    return { sinus: b('Sinus Rhythm', 40), brady: b('Sinus Bradycardia', 40), svt: b('SVT', 40),
             infantTachy: b('Sinus Tachycardia', 0.5), infantSinus: b('Sinus Rhythm', 0.5), vf: b('VF', 40) };
  });
  expect(rates.sinus).toBe(75);
  expect(rates.brady).toBeLessThan(60);
  expect(rates.svt).toBeGreaterThanOrEqual(150);
  expect(rates.infantTachy).toBeGreaterThan(160);       // above the under-1 normal band (110-160)
  expect(rates.infantSinus).toBe(145);
  expect(rates.vf).toBe(75);                            // pulseless: the arrest obs take over
});

test('a patient screen stays blank and waiting while the controller has no scenario, even once numbered', async ({ page, context }) => {
  const code = await openController(page);
  const screen = await context.newPage();
  const screenErrors = trackErrors(screen);
  await screen.goto(`/index.html?mode=monitor&session=${code}`);
  await expect(screen.getByTestId('waiting-screen-number')).toBeVisible({ timeout: 10000 });
  await expect(screen.getByTestId('screen-waiting')).toContainText('WAITING FOR CONTROLLER');
  await expect(screen.getByTestId('waiting-for-scenario')).toBeVisible();
  await screen.waitForTimeout(1500);
  await expect(screen.getByTestId('screen-waiting')).toBeVisible();
  await expect(screen.getByText('NO SENSOR DETECTED')).toHaveCount(0);

  // A scenario starts: the patient appears
  await page.getByRole('button', { name: 'Quick Sim', exact: true }).click();
  await page.getByRole('button', { name: 'Start Quick Sim' }).click();
  await expect(screen.getByTestId('screen-waiting')).toHaveCount(0, { timeout: 15000 });
  expect(screenErrors).toEqual([]);
});

test('a reloaded controller with no scenario takes a left-over patient off the screens', async ({ page, context }) => {
  const code = await openController(page);
  await page.getByRole('button', { name: 'Quick Sim', exact: true }).click();
  await page.getByRole('button', { name: 'Start Quick Sim' }).click();
  const screen = await context.newPage();
  await screen.goto(`/index.html?mode=monitor&session=${code}`);
  await expect(screen.getByTestId('screen-waiting')).toHaveCount(0, { timeout: 15000 });

  await page.reload();                                   // same code, nothing loaded until Resume
  await expect.poll(() => live(page, code)).toBeNull();
  await expect(screen.getByTestId('screen-waiting')).toBeVisible({ timeout: 10000 });
  await expect(screen.getByTestId('screen-waiting')).toContainText('WAITING FOR CONTROLLER');
});

test('the finished card on a patient screen restarts the screen or goes back to the start screen', async ({ page, context }) => {
  trackErrors(page);                                     // accepts Finish's confirm
  const code = await openController(page);
  await page.getByRole('button', { name: 'Quick Sim', exact: true }).click();
  await page.getByRole('button', { name: 'Start Quick Sim' }).click();
  const screen = await context.newPage();
  const screenErrors = trackErrors(screen);
  await screen.goto(`/index.html?mode=monitor&session=${code}`);
  await expect(screen.getByTestId('screen-waiting')).toHaveCount(0, { timeout: 15000 });

  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(screen.getByText('Simulation complete')).toBeVisible({ timeout: 10000 });
  await screen.getByTestId('finished-restart').click();
  await expect(screen.getByTestId('screen-waiting')).toContainText('WAITING FOR CONTROLLER');

  // The controller starts again: the screen shows the new patient
  await page.evaluate(() => { window.__simEngine.reset(); });
  await page.goto('/index.html');
  await page.getByRole('button', { name: 'Quick Sim', exact: true }).click();
  await page.getByRole('button', { name: 'Start Quick Sim' }).click();
  await expect(screen.getByTestId('screen-waiting')).toHaveCount(0, { timeout: 15000 });
  await expect(screen.getByText('Simulation complete')).toHaveCount(0);

  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(screen.getByText('Simulation complete')).toBeVisible({ timeout: 10000 });
  await screen.getByTestId('finished-home').click();
  await expect(screen.getByTestId('welcome-screen')).toBeVisible({ timeout: 10000 });
  expect(screenErrors).toEqual([]);
});
