// The VBG on the room monitor looks like the analyser's printout on white paper (Jake, 15 Oct 2026):
// sections, flags for values outside the reference range (two arrows outside the critical range),
// [low - high] limits, the sample type and the inspired oxygen.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, pressStart, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

async function openMonitor(context, code) {
  const monitor = await context.newPage();
  await monitor.setViewportSize({ width: 1366, height: 768 });
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  { const snd = monitor.getByText('Tap to Enable Sound'); if (await snd.count()) await snd.click({ force: true }); }
  return monitor;
}

test('the VBG prints on white paper with flags, limits, sample type and FiO2', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'LOAD_SCENARIO', payload: window.ALL_SCENARIOS.find(s => s.id === 'AM004') }));
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.scenario && window.__simEngine.state.scenario.id)).toBe('AM004');
  await pressStart(page);
  const monitor = await openMonitor(context, code);
  const monErrors = trackErrors(monitor);
  await monitor.getByRole('button', { name: 'VBG', exact: true }).click();
  const paper = monitor.getByTestId('inv-result').getByTestId('vbg-grid');
  await expect(paper).toBeVisible();

  // White paper, dark print
  const bg = await paper.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(251, 251, 248)');
  // Sections and the header
  await expect(paper).toContainText('Blood gas values');
  await expect(paper).toContainText('Electrolyte values');
  await expect(paper).toContainText('Metabolite values');
  await expect(paper.getByTestId('gas-sample')).toContainText('Venous');
  await expect(paper.getByTestId('gas-fio2')).toHaveText('0.21');     // no oxygen on: room air
  // Hyperkalaemia: K+ 7.5 is outside the critical range (two arrows) with its limits
  await expect(paper.getByTestId('gas-val-K')).toHaveText('↑↑7.5');
  await expect(paper.getByTestId('gas-row-K')).toContainText('[ 3.5 – 5.3 ]');
  await expect(paper.getByTestId('gas-row-K')).toContainText('mmol/L');
  // Venous pO2: printed without limits or a flag
  await expect(paper.getByTestId('gas-val-pO2')).not.toContainText('↓');
  await expect(paper.getByTestId('gas-row-pO2')).not.toContainText('[');
  await expect(paper).toContainText('Outside critical range');

  // On oxygen the FiO2 is not entered
  await page.evaluate(() => window.__simEngine.applyIntervention && window.__simEngine.applyIntervention('Oxygen'));
  const onO2 = await page.evaluate(() => window.__simEngine.state.activeInterventions.has('Oxygen'));
  if (onO2) {
    await monitor.getByTestId('inv-result-close').click();
    await monitor.getByRole('button', { name: 'VBG', exact: true }).click();
    await expect(monitor.getByTestId('inv-result').getByTestId('gas-fio2')).toHaveText('–');
  }
  if (process.env.GAS_SHOT) await monitor.waitForTimeout(800), await monitor.screenshot({ path: process.env.GAS_SHOT });
  expect(errors).toEqual([]);
  expect(monErrors).toEqual([]);
});
