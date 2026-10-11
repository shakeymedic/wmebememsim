// The patient at a glance (data/screens/patientstatus.js): the status strip at the top of the
// controller, its stick figure, the ventilator chooser in it, and which scenarios start with the
// patient already on the monitor.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, live, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const engine = (page, fn) => page.evaluate(f => new Function('sim', f)(window.__simEngine), fn);
const active = (page) => page.evaluate(() => Array.from(window.__simEngine.state.activeInterventions));
const parts = (page) => page.getByTestId('patient-figure').evaluate(svg => Array.from(svg.querySelectorAll('[data-part]')).map(e => e.getAttribute('data-part')).sort());

test('an anaesthetic emergency starts on the monitor, and the vent can be switched between all three machines from the status strip', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await page.getByRole('button', { name: 'Anaesthetics / ICU', exact: true }).click();
  await page.locator('[data-vent-scenario="an-paw"]').click();
  await page.getByRole('button', { name: 'Start anaesthetic machine scenario' }).click();

  // Already monitored, with capnography, IV access and the tube.
  const strip = page.getByTestId('patient-status');
  await expect(strip).toBeVisible();
  await expect(strip).toContainText('ECG · SpO2 · NIBP · Temp · ETCO2');
  await expect(strip).toContainText('Tracheal tube');
  expect(await active(page)).toEqual(expect.arrayContaining(['Obs', 'IV Access', 'RSI']));
  expect(await page.evaluate(() => window.__simEngine.state.etco2Enabled)).toBe(true);
  await expect.poll(() => live(page, code, '/etco2Enabled')).toBe(true);
  expect(await parts(page)).toEqual(expect.arrayContaining(['ecg', 'spo2', 'nibp', 'temp', 'etco2', 'iv', 'tube']));
  await expect(page.getByTestId('patient-headline')).toContainText('Intubated: ventilation assumed (no ventilator linked)');

  // A ventilator tablet joins: the A350 is in standby or off, and the patient (paralysed) is not ventilated.
  const dev = await context.newPage();
  const devErrors = trackErrors(dev);
  await dev.goto(`/vent/index.html?session=${code}`);
  await expect(dev).toHaveURL(/\/vent\/a350\.html/, { timeout: 10000 });
  await expect(page.getByTestId('patient-headline')).toContainText('Intubated but NOT being ventilated', { timeout: 15000 });
  await expect(page.getByTestId('patient-status')).toHaveClass(/border-red-500/);
  expect(await parts(page)).toContain('vent');

  // Switch the machine from the strip: the tablet follows each time.
  const vent = page.getByTestId('status-vent');
  await expect(vent.getByRole('button', { name: 'Atlan A350' })).toHaveAttribute('aria-pressed', 'true');
  await vent.getByRole('button', { name: 'T1', exact: true }).click();
  await expect.poll(() => live(page, code, '/vent/model')).toBeFalsy();
  await expect(dev).toHaveURL(/\/vent\/index\.html/, { timeout: 10000 });
  await vent.getByRole('button', { name: 'C6', exact: true }).click();
  await expect.poll(() => live(page, code, '/vent/model')).toBe('c6');
  await expect(dev).toHaveURL(/\/vent\/c6\.html/, { timeout: 10000 });
  await vent.getByRole('button', { name: 'Atlan A350' }).click();
  await expect(dev).toHaveURL(/\/vent\/a350\.html/, { timeout: 10000 });
  await expect(page.getByTestId('patient-headline')).toContainText('the Atlan A350', { timeout: 15000 });
  expect(await page.evaluate(() => window.__simEngine.state.log.filter(l => /^Ventilator changed to the /.test(l.msg)).length)).toBe(3);
  expect(errors).toEqual([]);
  expect(devErrors).toEqual([]);
});

test('a premade scenario starts with nothing attached unless the briefing box is ticked', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  const startPremade = async (tick) => {
    await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
    await page.getByRole('button', { name: 'Adult Medical', exact: true }).click();
    await page.locator('div.justify-between', { hasText: 'SVT (Adult)' }).first().getByRole('button', { name: 'Load' }).click();
    if (tick) await page.getByTestId('start-monitored').check();
    await page.getByRole('button', { name: 'Start Scenario' }).click();
  };
  await startPremade(false);
  await expect(page.getByTestId('patient-status')).toContainText('Nothing attached');
  expect(await active(page)).not.toContain('Obs');
  await page.goto('/index.html');
  await page.getByText('Session Code', { exact: true }).waitFor();
  await startPremade(true);
  await expect(page.getByTestId('patient-status')).toContainText('ECG · SpO2 · NIBP · Temp');
  expect(await active(page)).toContain('Obs');
  expect(await engine(page, `return sim.state.log.some(l => /starts on standard monitoring/.test(l.msg));`)).toBe(true);
  expect(errors).toEqual([]);
});

test('Defib Sim: a patient with a pulse starts monitored, a cardiac arrest does not', async ({ page }) => {
  await openController(page);
  const start = async (id) => {
    await page.getByRole('button', { name: 'Defib Sim', exact: true }).click();
    await page.locator(`[data-defib-scenario="${id}"]`).click();
    await page.getByRole('button', { name: 'Start Defib Sim' }).click();
    await expect(page.getByTestId('patient-status')).toBeVisible();
  };
  await start('complete-hb');
  expect(await active(page)).toContain('Obs');
  await expect(page.getByTestId('patient-flags')).toContainText('Bradycardic');
  await page.goto('/index.html');
  await page.getByText('Session Code', { exact: true }).waitFor();
  await start('vf-arrest');
  expect(await active(page)).not.toContain('Obs');
  await expect(page.getByTestId('patient-headline')).toContainText('In cardiac arrest');
});

test('the headline and the figure follow the patient: stable, distressed, apnoeic, arrest with CPR', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await startQuickSim(page);
  const headline = page.getByTestId('patient-headline');
  await engine(page, `sim.manualUpdateVitals({ hr: 80, bpSys: 120, bpDia: 75, rr: 16, spO2: 98, gcs: 15, temp: 37, bm: 6 });`);
  await expect(headline).toHaveText('Stable: obs within normal limits');
  await expect(page.getByTestId('patient-status')).toContainText('Nothing attached');

  await engine(page, `sim.manualUpdateVitals({ rr: 34, spO2: 85 });`);
  await expect(page.getByTestId('patient-flags')).toContainText('Distressed: RR 34');
  await expect(page.getByTestId('patient-flags')).toContainText('Hypoxic: SpO2 85%');
  await expect(headline).toHaveText('Distressed: RR 34 \u00b7 Hypoxic: SpO2 85%');

  await engine(page, `sim.manualUpdateVitals({ rr: 0 });`);
  await expect(headline).toHaveText('Apnoeic: NOT being ventilated');
  await engine(page, `sim.applyIntervention('Bagging');`);
  await expect(headline).toContainText('Being ventilated by bag and mask');
  expect(await parts(page)).toEqual(expect.arrayContaining(['bag', 'mask']));

  await engine(page, `sim.triggerArrest('VF');`);
  await expect(headline).toContainText('In cardiac arrest');
  await expect(page.getByTestId('patient-flags')).toContainText('No CPR running');
  await engine(page, `sim.applyIntervention('PacingPads'); sim.applyIntervention('IV Access');`);
  await expect.poll(() => parts(page)).toEqual(expect.arrayContaining(['pads', 'iv']));

  // Hide and show keeps the headline in view.
  await page.getByTestId('patient-status').getByRole('button', { name: 'Hide' }).click();
  await expect(page.getByTestId('patient-figure')).toBeHidden();
  await expect(headline).toContainText('In cardiac arrest');
  await page.getByTestId('patient-status').getByRole('button', { name: 'Show' }).click();
  await expect(page.getByTestId('patient-figure')).toBeVisible();
  expect(errors).toEqual([]);
});
