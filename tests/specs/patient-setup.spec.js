// Setting the patient up before START (injuries and kit already on), and showing the patient picture
// on the room monitor (data/screens/patientstatus.js PatientSetup, MonitorPicture).
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, pressStart, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

test('Quick Sim: set up injuries and kit before START, then show the picture on the monitor', async ({ page, context }) => {
  test.setTimeout(60000);
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  const monitor = await context.newPage();
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect(monitor.getByTestId('waiting-for-start')).toBeVisible();

  const spo2Before = await page.evaluate(() => window.__simEngine.state.vitals.spO2);
  await page.getByRole('button', { name: 'Set up the patient' }).first().click();
  const dlg = page.getByTestId('patient-setup');
  await expect(dlg).toBeVisible();
  // Bilateral above-knee amputations
  await dlg.getByLabel('Injury to add').selectOption({ label: 'Amputation through the thigh' });
  await dlg.getByLabel('Side').selectOption('both');
  await dlg.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dlg.getByTestId('injury-list')).toContainText(/right.*amputation through the thigh|amputation through the right thigh/i);
  await expect(dlg.getByTestId('injury-list')).toContainText(/left.*amputation through the thigh|amputation through the left thigh/i);
  // Tourniquets, IV access and oxygen already on
  for (const k of ['Tourniquet', 'IV Access', 'Oxygen']) await dlg.locator(`[data-kit="${k}"]`).click();
  for (const k of ['Tourniquet', 'IV Access', 'Oxygen']) await expect(dlg.locator(`[data-kit="${k}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(dlg.locator('[data-part="tourniquet"]')).toHaveCount(2);
  // Set-up kit is not the team's: it is logged as set-up and does not change the obs
  const log = await page.evaluate(() => window.__simEngine.state.log.map(l => l.msg));
  expect(log).toContain('Set-up: Tourniquet already in place when the team arrives.');
  expect(log.some(m => /High flow oxygen applied/.test(m))).toBe(false);
  expect(await page.evaluate(() => window.__simEngine.state.scenario.setupKit)).toEqual(['Tourniquet', 'IV Access', 'Oxygen']);

  // Show it on the monitor, before START
  await dlg.getByTestId('picture-on-monitor').click();
  const pic = monitor.getByTestId('monitor-picture');
  await expect(pic).toBeVisible();
  await expect(pic.locator('[data-part="tourniquet"]')).toHaveCount(2);
  await expect.poll(async () => (await pic.locator('image').evaluateAll(els => els.map(e => e.getAttribute('href')))).join(' ')).toMatch(/kit\/oxygen-mask|mask/);
  // A change on the controller follows on to the monitor
  await dlg.locator('[data-kit="Collar"]').click();
  await expect(pic.locator('[data-part="collar"]')).toHaveCount(1);
  await dlg.getByRole('button', { name: 'Done' }).click();

  await pressStart(page);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__simEngine.state.vitals.spO2)).toBe(spo2Before);
  // Hide it again
  await page.getByTestId('patient-status').getByTestId('picture-on-monitor').click();
  await expect(monitor.getByTestId('monitor-picture')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Set up the patient' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Defib Sim: the patient can be set up before START too', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await page.getByRole('button', { name: 'Defib Sim', exact: true }).click();
  await page.locator('[data-defib-scenario="unstable-svt"]').click();
  await page.getByRole('button', { name: 'Start Defib Sim' }).click();
  await page.getByRole('button', { name: 'Set up the patient' }).click();
  const dlg = page.getByTestId('patient-setup');
  await dlg.locator('[data-kit="Collar"]').click();
  await expect(dlg.locator('[data-kit="Collar"]')).toHaveAttribute('aria-pressed', 'true');
  await dlg.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('patient-status')).toContainText('Collar');
  expect(errors).toEqual([]);
});
