// The HAMILTON-T1 ventilator (vent/index.html): on its own tablet or on the room monitor, linked to
// the session like the defib tablet. Phase 1: it joins, reports to the log, mirrors to the
// controller and takes its lungs from the controller.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, expandSection, session, live, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const logHas = (page, re) => page.evaluate((src) => window.__simEngine.state.log.some(l => new RegExp(src).test(l.msg)), re.source);

async function openVent(context, code) {
  const vent = await context.newPage();
  const errors = trackErrors(vent);
  await vent.goto(`/vent/index.html?session=${code}`);
  await expect(vent.locator('#linkBanner')).toBeHidden({ timeout: 10000 });
  return { vent, errors };
}
// Power on, wait for the self-test, then start ventilation from Standby (the Power/Standby key).
async function startVentilating(dev) {
  await dev.locator('#kPower').click();
  // the self-test takes about 4 s and ends on the Standby window
  await expect(dev.getByRole('button', { name: 'Start ventilation' })).toBeVisible({ timeout: 10000 });
  await dev.locator('#kPower').click();
}

test('a ventilator tablet joins by session code, reports to the log and mirrors to the controller', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  const { vent, errors: ventErrors } = await openVent(context, code);
  await expect(vent.locator('#sessionTag')).toHaveText(`Session ${code}`);
  await expect.poll(async () => Object.values(await session(page, code, '/presence') || {}).map(p => p.role)).toContain('vent');

  await startVentilating(vent);
  await expect.poll(() => vent.evaluate(() => window.__vent.ventStateNow().state)).toBe('ventilating');
  await expect.poll(() => logHas(page, /^Ventilator: Self-test passed \(ventilator tablet\)/)).toBe(true);
  await expect.poll(() => logHas(page, /^Ventilator: Ventilation started \(NIV-ST\)/)).toBe(true);

  // The facilitator's Ventilator section shows what the tablet shows
  await expect.poll(() => page.evaluate(() => Object.values(window.__simEngine.state.ventMirror || {}).map(m => m.state))).toContain('ventilating');
  await expandSection(page, 'vent');
  await expect(page.getByTestId('vent-mirror')).toContainText('Ventilator tablet');
  await expect(page.getByTestId('vent-mirror')).toContainText('Ventilating');
  await expect(page.getByTestId('vent-mirror')).toContainText('PEEP/CPAP 5 cmH2O');
  expect(errors).toEqual([]);
  expect(ventErrors).toEqual([]);
});

test('the controller chooses the lungs: picked from the scenario, then changed by the facilitator', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  await expect.poll(() => live(page, code, '/vent')).toMatchObject({ profile: 'normal' });
  const { vent, errors } = await openVent(context, code);
  await expect.poll(() => vent.evaluate(() => window.__vent.P.id)).toBe('normal');

  await expandSection(page, 'vent');
  await page.getByLabel('Ventilator lungs').selectOption('ards');
  await expect.poll(() => live(page, code, '/vent/profile')).toBe('ards');
  await expect.poll(() => vent.evaluate(() => [window.__vent.P.id, window.__vent.P.pr.sedated])).toEqual(['ards', true]);
  await page.getByLabel("Patient's own breathing").selectOption('yes');
  await expect.poll(() => vent.evaluate(() => [window.__vent.P.pr.sedated, window.__vent.P.pr.effort > 0])).toEqual([false, true]);
  expect(await logHas(page, /^Ventilator lungs set to ARDS/)).toBe(true);
  expect(errors).toEqual([]);
});

test('on the room monitor: the Ventilator toggle shows it, the Defib replaces it, and it carries on where it left off', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  const monitor = await context.newPage();
  const monitorErrors = trackErrors(monitor);
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);

  await expandSection(page, 'vent');
  await page.getByRole('button', { name: 'Show the ventilator on the room monitor' }).click();
  await expect(monitor.getByTestId('monitor-vent')).toBeVisible();
  await expect.poll(async () => Object.values(await session(page, code, '/presence') || {}).map(p => p.display)).toEqual(expect.arrayContaining(['ventilator']));
  const dev = monitor.frameLocator('iframe[title="Ventilator"]');
  await expect(dev.locator('#linkBanner')).toBeHidden({ timeout: 10000 });
  await expect(dev.locator('#btnFull')).toBeHidden();                       // embedded layout
  await startVentilating(dev);
  await expect.poll(() => logHas(page, /^Ventilator: Ventilation started .*\(ventilator on the monitor\)/)).toBe(true);

  // The learner can look at the obs without stopping the ventilator
  await monitor.getByTestId('monitor-vent-flip').click();
  await expect(monitor.getByTestId('monitor-vent')).toBeHidden();
  await monitor.getByTestId('monitor-vent-flip').click();
  await expect(monitor.getByTestId('monitor-vent')).toBeVisible();

  // One screen: the defib takes over, and the ventilator comes back as it was
  await page.waitForTimeout(3500);                                          // its settings are saved every 3 s
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_DEFIB_PANEL', payload: true }));
  await expect(monitor.getByTestId('monitor-defib')).toBeVisible();
  await expect(monitor.getByTestId('monitor-vent')).toHaveCount(0);
  expect(await page.evaluate(() => window.__simEngine.state.ventPanelOpen)).toBe(false);
  await page.getByRole('button', { name: 'Show the ventilator on the room monitor' }).click();
  await expect(monitor.getByTestId('monitor-defib')).toHaveCount(0);
  const dev2 = monitor.frameLocator('iframe[title="Ventilator"]');
  await expect(dev2.locator('#linkBanner')).toBeHidden({ timeout: 10000 });
  await expect.poll(() => monitor.frames().find(f => /vent\/index\.html/.test(f.url())).evaluate(() => window.__vent.ventStateNow().state)).toBe('ventilating');
  expect(monitorErrors).toEqual([]);
});

test('three tablets at once: room monitor, defib tablet and ventilator tablet, all on one patient', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  await page.getByRole('button', { name: /^Coarse VF/ }).click();
  const monitor = await context.newPage();
  const monitorErrors = trackErrors(monitor);
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  const defib = await context.newPage();
  const defibErrors = trackErrors(defib);
  await defib.goto(`/defib/index.html?session=${code}`);
  await expect(defib.locator('#linkBanner')).toBeHidden();
  const { vent, errors: ventErrors } = await openVent(context, code);

  await expect.poll(async () => Object.values(await session(page, code, '/presence') || {}).map(p => p.role).sort()).toEqual(['defib', 'monitor', 'vent']);
  await defib.click('.mode-label[data-mode="defib"]');
  await defib.click('#chargeBtn');
  await expect(defib.locator('#shockBtn')).toBeEnabled({ timeout: 5000 });
  await defib.click('#shockBtn');
  await startVentilating(vent);
  await expect.poll(() => live(page, code, '/defib/shockCount')).toBe(1);
  await expect.poll(() => logHas(page, /^Ventilator: Ventilation started/)).toBe(true);
  // Neither device took over the room monitor's screen
  await expect(monitor.getByTestId('monitor-defib')).toHaveCount(0);
  await expect(monitor.getByTestId('monitor-vent')).toHaveCount(0);
  for (const e of [errors, monitorErrors, defibErrors, ventErrors]) expect(e).toEqual([]);
});

test('a new scenario gives a fresh ventilator', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  const { vent } = await openVent(context, code);
  await startVentilating(vent);
  await expect.poll(() => vent.evaluate(() => window.__vent.ventStateNow().state)).toBe('ventilating');
  await page.evaluate(() => window.firebase.database().ref(`sessions/${localStorage.getItem('wmebem_session_id')}/live`).update({ scenarioTitle: 'Another patient' }));
  await expect.poll(() => vent.evaluate(() => window.__vent.ventStateNow().state)).toBe('off');
});
