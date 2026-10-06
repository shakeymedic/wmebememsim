// WETFLAG on the room monitor: hidden until the facilitator shows it, and shown or hidden from the
// controller at any time.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, expandSection, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

test('the setup option to show WETFLAG from the start is off by default', async ({ page }) => {
  await openController(page);
  await expect(page.getByRole('checkbox', { name: 'Show WETFLAG on the monitor' })).not.toBeChecked();
});

test('a paediatric scenario starts with WETFLAG hidden; the controller shows and hides it on the monitor', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  await page.evaluate(() => {
    const base = window.ALL_SCENARIOS.find(s => s.ageRange === 'Paediatric');
    window.__simEngine.dispatch({ type: 'LOAD_SCENARIO', payload: window.generatePatientFromTemplate(base, {}) });
  });
  await expect.poll(() => page.evaluate(() => !!window.__simEngine.state.scenario.wetflag)).toBe(true);
  expect(await page.evaluate(() => window.__simEngine.state.showWetflag)).toBe(false);

  const monitor = await context.newPage();
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  const wetflag = monitor.getByRole('heading', { name: 'WETFLAG' });
  await expect(wetflag).toHaveCount(0);

  await expandSection(page, 'resus');
  await page.getByRole('button', { name: 'Show WETFLAG on Monitor' }).click();
  await expect(wetflag).toBeVisible();
  await page.getByRole('button', { name: 'Hide WETFLAG on Monitor' }).click();
  await expect(wetflag).toHaveCount(0);
  expect(errors).toEqual([]);
});
