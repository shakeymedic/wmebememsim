// pH and K+ are not obs: they are what the VBG reports. The controller's obs tiles and the room
// monitor's point-of-care strip no longer show them; the patient's modelled pH and K+ (which
// bicarbonate, insulin-dextrose and the rest steer) are the gas the team gets when they press VBG,
// and choosing a VBG result on the controller sets them (window.liveVbg, data/screens/invresults.js).
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

async function openMonitor(context, code) {
  const monitor = await context.newPage();
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  await monitor.getByText('Tap to Enable Sound').click({ force: true });
  await expect(monitor.getByText('Tap to Enable Sound')).toHaveCount(0);
  return monitor;
}
async function loadScenario(page, id) {
  await page.evaluate((id) => {
    const base = window.ALL_SCENARIOS.find(s => s.id === id);
    window.__simEngine.dispatch({ type: 'LOAD_SCENARIO', payload: base });
  }, id);
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.scenario && window.__simEngine.state.scenario.id)).toBe(id);
}
async function pressVbg(monitor) {
  const close = monitor.getByTestId('inv-result-close');
  if (await close.isVisible()) await close.click();
  await monitor.getByRole('button', { name: 'VBG', exact: true }).click();
  return monitor.getByTestId('inv-result').getByTestId('vbg-grid');
}

test('the patient starts with its own gas pH and K+, and an untold scenario keeps the inferred K+', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.ALL_SCENARIOS && window.ALL_SCENARIOS.length > 0 && window.__simEngine);
  const load = (id) => page.evaluate((id) => {
    window.__simEngine.dispatch({ type: 'LOAD_SCENARIO', payload: window.ALL_SCENARIOS.find(s => s.id === id) });
    return new Promise(r => setTimeout(() => { const s = window.__simEngine.state; const g = s.scenario.vbg || s.scenario.investigations.vbg; r({ ph: s.vitals.ph, k: s.vitals.k, gph: g.pH, gk: g.K }); }, 50));
  }, id);
  const hyperK = await load('AM004');            // Hyperkalaemia (Renal): gas pH 7.35, K+ 7.5
  expect(hyperK.ph).toBeCloseTo(hyperK.gph, 2);
  expect(hyperK.k).toBeCloseTo(hyperK.gk, 1);
  const addison = await page.evaluate(() => window.ALL_SCENARIOS.find(s => /Addisonian/.test(s.title)).id);
  const a = await load(addison);                 // gas K+ normal, K+ inferred from the scenario (5.8)
  expect(a.k).toBeCloseTo(5.8, 1);
});

test('pH and K+ are off the obs and the monitor strip, and the VBG gives the patient\'s own pH and K+', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  await loadScenario(page, 'AM004');
  const monitor = await openMonitor(context, code);
  const monErrors = trackErrors(monitor);

  // Controller: no pH or K+ tile in either view
  await expect(page.getByRole('button', { name: 'Adjust pH' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Adjust K+' })).toHaveCount(0);
  // Monitor: the strip keeps Temp and Glucose only
  await expect(monitor.getByText('no gas', { exact: true })).toHaveCount(0);
  await expect(monitor.getByText('no sample', { exact: true })).toBeVisible();

  // The gas carries the patient's modelled K+: treatment that lowered it shows in the next VBG
  let grid = await pressVbg(monitor);
  await expect(grid).toContainText('K+: 7.5');
  await page.evaluate(() => window.__simEngine.manualUpdateVitals({ k: 5.9, ph: 7.28 }));
  await expect.poll(() => monitor.evaluate(() => window.__monitorEngine.state.vitals.k)).toBe(5.9);
  grid = await pressVbg(monitor);
  await expect(grid).toContainText('K+: 5.9');
  await expect(grid).toContainText('pH: 7.28');

  // The controller's VBG row shows the same live gas and says pH/K+ live there
  await page.getByRole('button', { name: 'Investigations', exact: true }).click();
  const row = page.getByTestId('inv-results-panel').getByTestId('inv-result-row-VBG');
  await expect(row).toContainText('pH 7.28');
  await expect(row).toContainText('K+ 5.9');
  await expect(row.getByTestId('inv-result-note-VBG')).toBeVisible();

  // Choosing a gas sets the patient's pH and K+
  await row.getByRole('button', { name: 'Change the VBG result' }).click();
  const dlg = page.getByTestId('inv-result-editor');
  await expect(dlg.getByTestId('vbg-K')).toHaveValue('5.9');
  await dlg.getByTestId('vbg-pH').fill('7.12');
  await dlg.getByTestId('vbg-K').fill('6.4');
  await dlg.getByRole('button', { name: 'Use these values' }).click();
  await expect.poll(() => page.evaluate(() => [window.__simEngine.state.vitals.ph, window.__simEngine.state.vitals.k])).toEqual([7.12, 6.4]);
  await expect.poll(() => monitor.evaluate(() => window.__monitorEngine.state.vitals.k)).toBe(6.4);
  grid = await pressVbg(monitor);
  await expect(grid).toContainText('pH: 7.12');
  await expect(grid).toContainText('K+: 6.4');
  expect(errors).toEqual([]);
  expect(monErrors).toEqual([]);
});
