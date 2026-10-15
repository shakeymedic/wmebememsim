// "Patient screens show: Monitor | Defib | Ventilator" at the top of the live controller
// (PatientScreenSwitch in data/screens/screenspanel.js): one press puts that view in front on every
// patient screen that has it, bringing the device in first if needed. A device already in the room
// stays loaded behind the monitor, and the small x takes it away.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, session, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const shot = async (page, name) => { if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` }); };
const displays = async (page, code) => Object.values(await session(page, code, '/presence') || {}).filter(p => /^screen:/.test(String(p.role))).map(p => p.display);

test('the switch at the top puts the monitor, the defib or the ventilator in front on the patient screen', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  const monitor = await context.newPage();
  const monitorErrors = trackErrors(monitor);
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  { const snd = monitor.getByText('Tap to Enable Sound'); if (await snd.count()) await snd.click({ force: true }); }

  const bar = page.getByTestId('screen-show-switch');
  await expect(bar).toBeVisible();
  const btn = (v) => bar.locator(`[data-show="${v}"]`);
  await expect(btn('monitor')).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.locator('[data-take-away]')).toHaveCount(0);              // nothing in the room yet
  await expect(page.getByTestId('screen-show-now')).toContainText('Monitor');

  // Defib: brought in and in front
  await btn('defib').click();
  await expect(monitor.getByTestId('monitor-defib')).toBeVisible();
  await expect(btn('defib')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => displays(page, code)).toEqual(['defib']);
  await expect(page.getByTestId('screen-show-now')).toContainText('Defib');

  // Ventilator: brought in and in front; the defib stays loaded behind it
  await btn('vent').click();
  await expect(monitor.getByTestId('monitor-vent')).toBeVisible();
  await expect(monitor.getByTestId('monitor-defib')).toBeHidden();
  await expect(monitor.locator('iframe[title="Defibrillator"]')).toHaveCount(1);
  await expect(btn('vent')).toHaveAttribute('aria-pressed', 'true');
  await shot(page, 'controller-switch-vent');

  // Back to the defib, which was already in the room (the old Defib button could not do this)
  await btn('defib').click();
  await expect(monitor.getByTestId('monitor-defib')).toBeVisible();
  await expect(monitor.getByTestId('monitor-vent')).toBeHidden();

  // Monitor: in front, with both devices still loaded behind it
  await btn('monitor').click();
  await expect(monitor.getByTestId('monitor-defib')).toBeHidden();
  await expect(monitor.getByTestId('monitor-vent')).toBeHidden();
  await expect(monitor.locator('iframe[title="Ventilator"]')).toHaveCount(1);
  await expect(monitor.locator('iframe[title="Defibrillator"]')).toHaveCount(1);
  await expect.poll(() => displays(page, code)).toEqual(['patient monitor']);
  await expect(btn('monitor')).toHaveAttribute('aria-pressed', 'true');
  await shot(page, 'controller-switch-monitor');

  // The candidate can still switch on the screen itself
  await monitor.getByTestId('screen-switcher').getByRole('button', { name: 'Ventilator' }).click();
  await expect(monitor.getByTestId('monitor-vent')).toBeVisible();

  // The x takes the defib away on every screen
  await bar.locator('[data-take-away="defib"]').click();
  await expect(monitor.locator('iframe[title="Defibrillator"]')).toHaveCount(0);
  await expect(bar.locator('[data-take-away="defib"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__simEngine.state.defibPanelOpen)).toBe(false);

  // Every press is in the log
  const log = await page.evaluate(() => JSON.stringify(window.__simEngine.state.log || []));
  expect(log).toContain('Patient screens switched to the monitor (facilitator)');
  expect(log).toContain('Defib taken off the patient screens (facilitator)');
  expect(errors).toEqual([]);
  expect(monitorErrors).toEqual([]);
});

test('a screen without the monitor ignores Monitor, and a monitor-only screen is flagged when the ventilator is chosen', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  const screen = await context.newPage();
  await screen.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(async () => Object.values(await session(page, code, '/screens') || {}).length).toBe(1);
  const id = Object.keys(await session(page, code, '/screens'))[0];
  // Make it monitor only, as the Screens panel would
  await page.evaluate(([c, i]) => window.db.ref(`sessions/${c}/screens/${i}`).update({ role: 'monitor' }), [code, id]);
  await expect.poll(() => displays(page, code)).toEqual(['patient monitor']);
  const bar = page.getByTestId('screen-show-switch');
  await bar.locator('[data-show="vent"]').click();
  await expect(page.getByTestId('screen-show-unseen')).toContainText('No screen is set to show the ventilator');
  await expect(screen.getByTestId('monitor-vent')).toHaveCount(0);
  await bar.locator('[data-show="monitor"]').click();
  await expect(page.getByTestId('screen-show-unseen')).toHaveCount(0);
});
