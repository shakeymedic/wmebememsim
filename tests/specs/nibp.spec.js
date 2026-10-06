// NIBP: changing the patient's BP never reaches the team's screens by itself. The room monitor and
// the defib tablet show the last CUFF reading, which changes only when the cuff measures (the team's
// press, the facilitator's, or the auto timer) — in a full scenario, Quick Sim and Defib Sim alike.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const engine = (page, fn) => page.evaluate(fn);
// The database drops empty values, so "no reading yet" arrives on the monitor as undefined
const monitorNibp = (monitor) => monitor.evaluate(() => window.__monitorEngine.state.nibp.sys ?? null);

async function quickSimWithMonitor(page, context) {
  const code = await openController(page);
  await startQuickSim(page);
  await page.evaluate(() => window.__simEngine.attachStandardMonitoring());
  const monitor = await context.newPage();
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  return monitor;
}

async function openBp(page, sys, dia) {
  await page.getByRole('button', { name: 'Adjust BP' }).last().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Now', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByLabel('Diastolic').fill(String(dia));
  await dialog.getByLabel('Systolic').fill(String(sys));
  return dialog;
}

test('BP: "Change, don\'t send" changes the patient now; the monitor keeps its last cuff reading', async ({ page, context }) => {
  test.setTimeout(60000);
  const errors = trackErrors(page);
  const monitor = await quickSimWithMonitor(page, context);
  expect(await monitorNibp(monitor)).toBeNull();

  const dialog = await openBp(page, 88, 52);
  await dialog.getByRole('button', { name: "Change, don't send" }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => engine(page, () => window.__simEngine.state.vitals.bpSys)).toBe(88);
  await page.waitForTimeout(6500);                        // longer than a cuff cycle
  expect(await engine(page, () => window.__simEngine.state.nibp.sys)).toBeNull();
  expect(await engine(page, () => window.__simEngine.state.nibp.inflating)).toBe(false);
  expect(await monitorNibp(monitor)).toBeNull();

  // The team cycles the cuff on the monitor: now they see it
  await monitor.evaluate(() => window.__monitorEngine.triggerNIBP());
  await expect.poll(() => monitorNibp(monitor), { timeout: 10000 }).toBe(88);
  expect(errors).toEqual([]);
});

test('BP: "Change and cycle cuff now" measures straight away (about 5 s) and the monitor shows it', async ({ page, context }) => {
  test.setTimeout(60000);
  const errors = trackErrors(page);
  const monitor = await quickSimWithMonitor(page, context);
  const dialog = await openBp(page, 76, 40);
  await dialog.getByRole('button', { name: 'Change and cycle cuff now' }).click();
  await expect.poll(() => engine(page, () => window.__simEngine.state.nibp.inflating)).toBe(true);
  await expect.poll(() => monitorNibp(monitor), { timeout: 10000 }).toBe(76);
  expect(await engine(page, () => window.__simEngine.state.nibp.dia)).toBe(40);
  expect(errors).toEqual([]);
});

test('BP defaults to an immediate change; other obs still default to 30 s', async ({ page }) => {
  await openController(page);
  await startQuickSim(page);
  await page.getByRole('button', { name: 'Adjust BP' }).last().click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Now', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // With no cuff on there is nothing to cycle: one button, and a warning
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Change and cycle cuff now' })).toHaveCount(0);
  await expect(page.getByRole('dialog').getByText('No NIBP cuff or arterial line attached')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Adjust HR' }).last().click();
  await expect(page.getByRole('dialog').getByRole('button', { name: '30 s', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('a BP trend never pushes a reading: the cuff shows it only when it next measures', async ({ page }) => {
  await openController(page);
  await startQuickSim(page);
  await page.evaluate(() => window.__simEngine.attachStandardMonitoring());
  await page.evaluate(() => window.__simEngine.startTrend({ bpSys: 150, bpDia: 95 }, 2));
  await expect.poll(() => engine(page, () => Math.round(window.__simEngine.state.vitals.bpSys)), { timeout: 10000 }).toBe(150);
  expect(await engine(page, () => window.__simEngine.state.nibp.sys)).toBeNull();
});

test('auto NIBP cycles in Quick Sim without START, and can be switched from the controller', async ({ page }) => {
  await openController(page);
  await startQuickSim(page);
  await page.evaluate(() => window.__simEngine.attachStandardMonitoring());
  expect(await engine(page, () => window.__simEngine.state.isRunning)).toBe(false);
  await page.getByRole('button', { name: 'Auto NIBP: off' }).click();
  await expect(page.getByRole('button', { name: 'Auto NIBP: on' })).toBeVisible();
  const t0 = await engine(page, () => window.__simEngine.state.nibp.timer);
  expect(t0).toBe(180);
  await expect.poll(() => engine(page, () => window.__simEngine.state.nibp.timer), { timeout: 5000 }).toBeLessThanOrEqual(178);
  // Run the rest of the 3 minutes down: the cuff then measures by itself
  await page.evaluate(() => { for (let i = 0; i < 180; i++) window.__simEngine.dispatch({ type: 'TICK_RECORD' }); });
  await expect.poll(() => engine(page, () => window.__simEngine.state.nibp.sys), { timeout: 10000 }).toBeGreaterThan(0);
  expect(await engine(page, () => window.__simEngine.state.nibp.timer)).toBeGreaterThan(170);   // and the timer restarted
});

test('defib tablet: NIBP shows the last cuff reading, and its NIBP key measures', async ({ page, context }) => {
  test.setTimeout(60000);
  const errors = trackErrors(page);
  const code = await openController(page);
  await page.getByRole('button', { name: 'Defib Sim', exact: true }).click();
  await page.locator('[data-defib-scenario="unstable-svt"]').click();
  await page.getByRole('button', { name: 'Start Defib Sim' }).click();
  const defib = await context.newPage();
  const defibErrors = trackErrors(defib);
  await defib.goto(`/defib/index.html?session=${code}`);
  await expect(defib.locator('#linkBanner')).toBeHidden();
  await defib.click('.mode-label[data-mode="defib"]');
  const live = await engine(page, () => window.__simEngine.state.vitals.bpSys);
  expect(live).toBeGreaterThan(0);
  await expect(defib.locator('#bpDisplay')).toHaveText('--/--');      // not the live BP

  // The learner presses NIBP on the defib
  await defib.locator('#nibpBtn').click();
  await expect(defib.locator('#bpLabel')).toHaveText('NIBP · MEASURING');
  const sys = Math.round(live);
  await expect(defib.locator('#bpDisplay')).toHaveText(new RegExp(`^${sys}/\\d+$`), { timeout: 10000 });
  await expect(defib.locator('#bpLabel')).toHaveText('NIBP');

  // A change of BP does not move it until the facilitator cycles the cuff from the controller
  await page.evaluate(() => window.__simEngine.manualUpdateVital('bpSys', 70));
  await defib.waitForTimeout(1500);
  await expect(defib.locator('#bpDisplay')).toHaveText(new RegExp(`^${sys}/\\d+$`));
  await page.getByTestId('defib-nibp').click();
  await expect(defib.locator('#bpDisplay')).toHaveText(/^70\/\d+$/, { timeout: 10000 });
  await expect(page.getByTestId('defib-nibp')).toHaveText(/defib shows 70\//);
  expect(errors).toEqual([]);
  expect(defibErrors).toEqual([]);
});
