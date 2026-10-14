// The room monitor, the defib and the ventilator are one patient: what the ventilator does shows on
// the monitor and the defib, an RR the facilitator types reaches the ventilator, and the Monitor /
// Ventilator switch on a patient screen never hides a button.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, expandSection, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const logHas = (page, re) => page.evaluate((src) => window.__simEngine.state.log.some(l => new RegExp(src).test(l.msg)), re.source);
async function startVentilating(dev) {
  await dev.locator('#kPower').click();
  await expect(dev.getByRole('button', { name: 'Start ventilation' })).toBeVisible({ timeout: 10000 });
  await dev.locator('#kPower').click();
}
async function openVent(context, code) {
  const vent = await context.newPage();
  const errors = trackErrors(vent);
  await vent.goto(`/vent/index.html?session=${code}`);
  await expect(vent.locator('#linkBanner')).toBeHidden({ timeout: 10000 });
  return { vent, errors };
}
const eng = (page, fn) => page.evaluate(fn);

test('Monitor/Ventilator switch sits in the investigations bar and does not cover the 12-Lead button', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  const monitor = await context.newPage();
  const errors = trackErrors(monitor);
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  await expandSection(page, 'vent');
  await page.getByRole('button', { name: 'Show the ventilator on the patient screens' }).click();
  await expect(monitor.getByTestId('monitor-vent')).toBeVisible();
  // Floating over the ventilator, then flipped to the obs
  await monitor.getByTestId('screen-switcher').getByRole('button', { name: 'Monitor' }).click();
  await expect(monitor.getByTestId('monitor-vent')).toBeHidden();
  const sw = monitor.getByTestId('screen-switcher');
  await expect(sw).toHaveCount(1);
  const twelve = monitor.getByRole('button', { name: '12-Lead' });
  const [a, b] = [await sw.boundingBox(), await twelve.boundingBox()];
  const overlap = !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
  expect(overlap).toBe(false);
  await twelve.click();   // nothing on top of it
  await expect(monitor.getByText('12-LEAD ANALYSIS (Tap to Close)')).toBeVisible();
  // and back to the ventilator from the bar
  await monitor.keyboard.press('Escape');
  await expect(monitor.getByText('12-LEAD ANALYSIS (Tap to Close)')).toHaveCount(0);
  await sw.getByRole('button', { name: 'Ventilator' }).click();
  await expect(monitor.getByTestId('monitor-vent')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a rate change on the ventilator shows on the monitor and on the defib (capnography only)', async ({ page, context }) => {
  test.setTimeout(150000);
  const code = await openController(page);
  await startQuickSim(page);
  await eng(page, () => window.__simEngine.dispatch({ type: 'TOGGLE_ETCO2' }));
  const monitor = await context.newPage();
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  const defib = await context.newPage();
  await defib.goto(`/defib/index.html?session=${code}`);
  await expect(defib.locator('#linkBanner')).toBeHidden();
  await defib.click('.mode-label[data-mode="monitor"]');
  const { vent, errors } = await openVent(context, code);
  await startVentilating(vent);
  await expect.poll(() => eng(page, () => !!window.VENT_ENGINE.driverFor(window.__simEngine.state)), { timeout: 30000 }).toBe(true);
  // Capnography counts the breaths: the monitor shows RR without ECG leads
  await expect(monitor.getByText('Resp Rate Off', { exact: true })).toHaveCount(0);
  // The candidate raises the backup rate well above the patient's own
  await vent.evaluate(() => { window.__vent.V.set.rate = 28; });
  await expect.poll(() => monitor.evaluate(() => window.__monitorEngine.state.vitals.rr), { timeout: 60000 }).toBeGreaterThanOrEqual(26);
  const rr = await monitor.evaluate(() => window.__monitorEngine.state.vitals.rr);
  await expect.poll(() => defib.locator('#etco2Unit').textContent(), { timeout: 10000 }).toMatch(/RR (2[6-9]|3\d)/);
  expect(rr).toBeLessThanOrEqual(40);
  expect(errors).toEqual([]);
});

test('an RR the facilitator types reaches the ventilator, and the monitor follows the ventilator again', async ({ page, context }) => {
  test.setTimeout(150000);
  const code = await openController(page);
  await startQuickSim(page);
  await eng(page, () => window.__simEngine.dispatch({ type: 'ATTACH_SENSORS', payload: ['Obs'] }));
  const { vent, errors } = await openVent(context, code);
  await startVentilating(vent);
  await expect.poll(() => eng(page, () => !!window.VENT_ENGINE.driverFor(window.__simEngine.state)), { timeout: 30000 }).toBe(true);
  await eng(page, () => window.__simEngine.manualUpdateVitals({ rr: 30 }));
  await expect.poll(() => eng(page, () => window.__simEngine.state.vitals.rr)).toBe(30);   // the next render, which can lag on a busy machine
  await expect.poll(() => eng(page, () => window.__simEngine.state.vent.lung.e)).toBe(30);
  await expect.poll(() => vent.evaluate(() => Math.round(window.__vent.P.rr))).toBe(30);
  await expect.poll(() => logHas(page, /^Ventilator: the patient now breathes at 30\/min/)).toBe(true);
  // The ventilator measures it and the hold is handed back
  await expect.poll(() => eng(page, () => !!(window.__simEngine.state.manualHold || {}).rr), { timeout: 45000 }).toBe(false);
  await page.waitForTimeout(3000);
  const now = await eng(page, () => window.__simEngine.state.vitals.rr);
  expect(now).toBeGreaterThanOrEqual(27);
  expect(now).toBeLessThanOrEqual(33);
  expect(errors).toEqual([]);
});

test('a sedated patient has no own rate: a typed RR holds on the monitor and leaves the ventilator alone', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  await expandSection(page, 'vent');
  await page.getByLabel('Ventilator lungs').selectOption('ards');
  const { vent } = await openVent(context, code);
  await expect.poll(() => vent.evaluate(() => window.__vent.P.id)).toBe('ards');
  await startVentilating(vent);
  await expect.poll(() => eng(page, () => !!window.VENT_ENGINE.driverFor(window.__simEngine.state)), { timeout: 30000 }).toBe(true);
  await eng(page, () => window.__simEngine.manualUpdateVitals({ rr: 30 }));
  await page.waitForTimeout(3000);
  expect(await eng(page, () => (window.__simEngine.state.vent.lung || {}).e)).toBeUndefined();
  expect(await eng(page, () => window.__simEngine.state.vitals.rr)).toBe(30);
  expect(await eng(page, () => !!window.__simEngine.state.manualHold.rr)).toBe(true);
});
