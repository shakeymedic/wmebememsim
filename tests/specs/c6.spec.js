// The HAMILTON-C6 ICU ventilator (vent/c6.html, generated from vent/index.html by
// scripts/make-c6.mjs): the Anaesthetics / ICU start card, the controller's ventilator choice
// (live.vent.model) and the C6's own volume-control modes.
const { test } = require('@playwright/test');
const { execFileSync } = require('child_process');
const path = require('path');
const { useFakeFirebase, trackErrors, openController, startQuickSim, expandSection, session, live, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const logHas = (page, re) => page.evaluate((src) => window.__simEngine.state.log.some(l => new RegExp(src).test(l.msg)), re.source);

async function startVentilating(dev) {
  await dev.locator('#kPower').click();
  await expect(dev.getByRole('button', { name: 'Start ventilation' })).toBeVisible({ timeout: 10000 });
  await dev.locator('#kPower').click();
}

test('vent/c6.html is up to date with the T1 page it is generated from', () => {
  execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'make-c6.mjs'), '--check']);
});

test('Anaesthetics / ICU: a C6 scenario sets the model, and a ventilator tablet opens the C6', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await page.getByRole('button', { name: 'Anaesthetics / ICU', exact: true }).click();
  await expect(page.getByTestId('vent-setup')).toContainText('HAMILTON-C6');
  await page.locator('[data-vent-scenario="icu-vc"]').click();
  await page.getByRole('button', { name: 'Start ICU ventilator scenario' }).click();
  await expect.poll(() => live(page, code, '/vent')).toMatchObject({ model: 'c6', airway: 'tube' });

  // The tablet is given the usual ventilator link, and moves itself to the C6 page
  const dev = await context.newPage();
  const devErrors = trackErrors(dev);
  await dev.goto(`/vent/index.html?session=${code}`);
  await expect(dev).toHaveURL(new RegExp(`/vent/c6\\.html\\?session=${code}$`), { timeout: 10000 });
  await expect(dev.locator('#linkBanner')).toBeHidden({ timeout: 10000 });
  await expect(dev.locator('.title')).toHaveText('HAMILTON-C6');
  await startVentilating(dev);
  await expect.poll(() => dev.evaluate(() => window.__vent.ventStateNow())).toMatchObject({ state: 'ventilating', model: 'c6' });

  // Volume control: (S)CMV delivers the set volume whatever the lungs, and shows a plateau
  // (the facilitator's remote control, as the controller sends it)
  await dev.evaluate(() => { window.__vent.remoteCommand({ type: 'mode', key: 'SCMV' }); window.__vent.remoteCommand({ type: 'set', key: 'vt', val: 450 }); });
  await expect(dev.locator('#rcol')).toContainText('Pause');
  await expect.poll(() => logHas(page, /^Ventilator \(facilitator\): Mode changed APVcmv \u2192 \(S\)CMV/)).toBe(true);
  await dev.waitForTimeout(12000);
  const mon = await dev.evaluate(() => window.__vent.ventStateNow().mon);
  expect(mon.vte).toBeGreaterThan(400);
  expect(mon.vte).toBeLessThan(500);
  expect(mon.ppeak).toBeGreaterThan(mon.pplat || 0);
  await expandSection(page, 'vent');
  await expect(page.getByTestId('vent-mirror')).toContainText('HAMILTON-C6');

  await dev.screenshot({ path: test.info().outputPath('c6.png') });
  expect(errors).toEqual([]);
  expect(devErrors).toEqual([]);
});

test('the facilitator switches a running session between the T1 and the C6', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  const dev = await context.newPage();
  const devErrors = trackErrors(dev);
  await dev.goto(`/vent/index.html?session=${code}`);
  await expect(dev.locator('#linkBanner')).toBeHidden({ timeout: 10000 });
  await expect(dev.locator('.title')).toHaveText('HAMILTON-T1');

  await expandSection(page, 'vent');
  await page.getByLabel('Ventilator model').selectOption('c6');
  await expect.poll(() => live(page, code, '/vent/model')).toBe('c6');
  await expect(dev).toHaveURL(/\/vent\/c6\.html\?session=/, { timeout: 10000 });
  await expect(dev.locator('.title')).toHaveText('HAMILTON-C6');
  await expect.poll(async () => Object.values(await session(page, code, '/presence') || {}).filter(p => p.role === 'vent').length).toBe(1);
  expect(await logHas(page, /^Ventilator changed to the HAMILTON-C6/)).toBe(true);

  await page.getByLabel('Ventilator model').selectOption('t1');
  await expect(dev).toHaveURL(/\/vent\/index\.html\?session=/, { timeout: 10000 });
  await expect(dev.locator('.title')).toHaveText('HAMILTON-T1');
  expect(devErrors).toEqual([]);
});

test('the C6 lists its own modes for the facilitator, and its scenarios build', async ({ page }) => {
  await openController(page);
  const r = await page.evaluate(() => ({
    c6: window.VENT_PROFILES.MODES_C6.map(m => m[0]),
    t1: window.VENT_PROFILES.MODES.map(m => m[0]),
    built: window.VentSim.forDevice('c6').map(s => { const b = window.VentSim.buildScenario({ scenario: s.id, device: 'c6', mode: 'education' }); return [b.title, b.ventSim.device]; })
  }));
  expect(r.c6).toEqual(expect.arrayContaining(['SCMV', 'SIMV', 'APVcmv', 'ASV', 'HiFlowO2']));
  expect(r.t1).not.toContain('SCMV');
  for (const [title, device] of r.built) { expect(title).toMatch(/^(ICU ventilator|Anaesthetic emergency): /); expect(device).toBe('c6'); }
  expect(r.built.length).toBeGreaterThanOrEqual(8);
  await expect(page.evaluate(() => window.VentSim.buildScenario({ scenario: 'icu-vc', device: 't1' }))).rejects.toThrow(/not written for this ventilator/);
});

// ---- Anaesthetic emergencies (the Association of Anaesthetists' QRH) ----
test('every anaesthetic emergency builds with its interventions, and the setup lists them first', async ({ page }) => {
  await openController(page);
  const r = await page.evaluate(() => window.VentSim.forDevice('c6').filter(s => s.group === 'Anaesthetic emergencies').map(s => {
    const b = window.VentSim.buildScenario({ scenario: s.id, device: 'c6' });
    const missing = (s.recommended || []).concat(s.stabilisers || []).filter(k => !window.INTERVENTIONS[k]);
    return { id: s.id, title: b.title, missing, probsOk: s.problems.every(p => window.VENT_PROFILES.PROBLEMS.some(x => x.id === p)) };
  }));
  expect(r.map(x => x.id)).toEqual(['an-arrest', 'an-hypoxia', 'an-paw', 'an-bronch', 'an-anaph', 'an-hypo', 'an-mh', 'an-equip']);
  for (const x of r) { expect(x.missing, x.id).toEqual([]); expect(x.probsOk, x.id).toBe(true); expect(x.title).toMatch(/^Anaesthetic emergency: .+\(QRH /); }
  await page.getByRole('button', { name: 'Anaesthetics / ICU', exact: true }).click();
  await expect(page.locator('[data-vent-scenario]').first()).toHaveAttribute('data-vent-scenario', 'an-arrest');
});

test('desaturation after intubation: an endobronchial tube on the C6, fixed by pulling the tube back', async ({ page, context }) => {
  const code = await openController(page);
  await page.getByRole('button', { name: 'Anaesthetics / ICU', exact: true }).click();
  await page.locator('[data-vent-scenario="an-hypoxia"]').click();
  await page.getByRole('button', { name: 'Start ICU ventilator scenario' }).click();
  await expect.poll(() => live(page, code, '/vent')).toMatchObject({ model: 'c6', probs: 'endo' });
  const dev = await context.newPage();
  const devErrors = trackErrors(dev);
  await dev.goto(`/vent/index.html?session=${code}`);
  await expect(dev).toHaveURL(/c6\.html/, { timeout: 10000 });
  await expect(dev.locator('#linkBanner')).toBeHidden({ timeout: 10000 });
  // half the compliance on one lung
  await expect.poll(() => dev.evaluate(() => window.__vent.P.pr.C)).toBeLessThan(0.03);
  await expandSection(page, 'vent');
  await expect(page.getByTestId('vent-problem-signs')).toContainText('Pulling the tube back fixes it');
  await page.getByRole('button', { name: 'Tube pulled back: fix the endobronchial tube' }).click();
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.vent.probs)).toEqual([]);
  expect(await logHas(page, /^Ventilator problem fixed: endobronchial tube pulled back/)).toBe(true);
  await expect.poll(() => dev.evaluate(() => window.__vent.P.pr.C)).toBeGreaterThan(0.04);
  expect(devErrors).toEqual([]);
});

test('malignant hyperthermia: CO2 production starts raised and dantrolene brings it back', async ({ page }) => {
  const code = await openController(page);
  await page.getByRole('button', { name: 'Anaesthetics / ICU', exact: true }).click();
  await page.locator('[data-vent-scenario="an-mh"]').click();
  await page.getByRole('button', { name: 'Start ICU ventilator scenario' }).click();
  await expect.poll(() => live(page, code, '/vent/lung')).toEqual({ m: 200 });
  expect(await page.evaluate(() => window.__simEngine.state.scenario.stabilisers)).toEqual(['Dantrolene']);
  await page.evaluate(() => window.__simEngine.applyIntervention('Dantrolene'));
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.vent.lung)).toEqual({});
  expect(await logHas(page, /^Ventilator lungs: CO2 production back to normal after dantrolene/)).toBe(true);
});
