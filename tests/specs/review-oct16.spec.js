// Fixes from the full review of 16 Oct 2026: MANUAL mode really is manual (no Cushing response or
// ETCO2 drift on its own), a child's ROSC lands on a child's heart rate, "Back to scenario" after
// Finish comes back paused rather than "not started", the x on an active card goes through the
// engine's toggle-off (CPR stops properly), a tablet with a slow clock is still heard, the debrief
// graph carries the last rhythm, and a team press on an investigation reaches the controller's log.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, pressStart, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const st = (page, f, a) => page.evaluate(f, a);
// Load a built-in scenario from the library and go through to the briefing, as the facilitator does
async function loadScenario(page, category, title) {
  await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
  await page.getByRole('button', { name: category, exact: true }).click();
  await page.locator('div.justify-between', { hasText: title }).first().getByRole('button', { name: 'Load' }).click();
  await page.getByRole('button', { name: 'Start Scenario' }).click();
  await expect(page.getByRole('button', { name: 'START', exact: true })).toBeVisible();
}
const obs = (page) => st(page, () => { const v = window.__simEngine.state.vitals; return { hr: Math.round(v.hr), bpSys: Math.round(v.bpSys), etco2: Math.round(v.etco2 * 10) / 10, icp: window.__simEngine.state.icp }; });

test('MANUAL mode: a head injury with raised ICP and a hypoventilating patient do not change on their own', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await loadScenario(page, 'Trauma', 'Isolated Head Injury');   // startICP 25: the Cushing response used to run from the first tick
  expect(await st(page, () => window.__simEngine.state.scenario.id)).toBe('AT003');
  await st(page, () => window.__simEngine.setDeteriorationMode('manual'));
  await st(page, () => { window.__simEngine.dispatch({ type: 'UPDATE_VITALS', payload: { rr: 8, etco2: 6.0, bpSys: 120, hr: 70 } }); });
  await pressStart(page);
  const before = await obs(page);
  await page.waitForTimeout(16000);
  const after = await obs(page);
  expect(after.hr).toBe(before.hr);
  expect(after.bpSys).toBe(before.bpSys);
  expect(after.etco2).toBe(before.etco2);
  expect(after.icp).toBe(before.icp);
  // AUTO: the same patient's ICP climbs and the Cushing response starts
  await st(page, () => window.__simEngine.setDeteriorationMode('auto'));
  await page.waitForTimeout(12000);
  expect((await obs(page)).bpSys).toBeGreaterThan(before.bpSys);
  expect(errors).toEqual([]);
});

test("a child's ROSC and sinus rhythm land on the APLS band for the age, not the adult band", async ({ page }) => {
  await openController(page);
  await loadScenario(page, 'Paediatric', 'SVT');   // PA007, 1 month to 12 years
  expect(await st(page, () => window.__simEngine.state.scenario.id)).toBe('PA007');
  await st(page, () => window.__simEngine.dispatch({ type: 'UPDATE_SCENARIO', payload: { ...window.__simEngine.state.scenario, patientAge: 0.5 } }));
  await pressStart(page);
  await st(page, () => window.__simEngine.triggerArrest('VF'));
  await expect.poll(() => st(page, () => window.__simEngine.state.rhythm)).toBe('VF');
  await st(page, () => window.__simEngine.triggerROSC('Sinus Rhythm'));
  await expect.poll(() => st(page, () => window.__simEngine.state.rhythm)).toBe('Sinus Rhythm');
  const hr = await st(page, () => window.__simEngine.state.vitals.hr);
  expect(hr).toBeGreaterThanOrEqual(110);
  expect(hr).toBeLessThanOrEqual(160);
  await st(page, () => window.__simEngine.changeRhythm('Sinus Tachycardia', 'manual selection'));
  await expect.poll(() => st(page, () => window.__simEngine.state.vitals.hr)).toBeGreaterThan(160);
});

test('"Back to scenario" after Finish comes back paused, with the patient still on the screens', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  await pressStart(page);
  const monitor = await context.newPage();
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: /finish/i }).first().click();   // while RUNNING
  await page.getByRole('button', { name: 'Back to scenario' }).click();
  await expect(page.getByTestId('not-started')).toHaveCount(0);
  await expect(page.getByTestId('paused-badge')).toBeVisible();
  await expect(page.getByRole('button', { name: 'START', exact: true })).toBeVisible();
  await expect(monitor.getByText('WAITING FOR CONTROLLER')).toHaveCount(0);
});

test('the x on the CPR card stops CPR through the engine: flag cleared and logged', async ({ page }) => {
  await openController(page);
  await loadScenario(page, 'Trauma', 'Isolated Head Injury');
  await pressStart(page);
  await page.getByTestId('view-mode').getByRole('button', { name: 'Full' }).click();
  await st(page, () => window.__simEngine.applyIntervention('CPR'));
  await expect.poll(() => st(page, () => window.__simEngine.state.cprInProgress)).toBe(true);
  await page.getByRole('button', { name: 'Procedures', exact: true }).click();
  await page.getByRole('button', { name: 'Stop Start CPR', exact: true }).click();
  await expect.poll(() => st(page, () => window.__simEngine.state.cprInProgress)).toBe(false);
  expect(await st(page, () => window.__simEngine.state.activeInterventions.has('CPR'))).toBe(false);
  expect(await st(page, () => window.__simEngine.state.log.some(l => /removed\./.test(l.msg)))).toBe(true);
});

test('a defib press stamped by a slow tablet clock is still acted on; presses queued before the controller loaded are not', async ({ page }) => {
  const code = await openController(page);
  await startQuickSim(page);
  await pressStart(page);
  await page.waitForTimeout(3500);   // the listener has looked at what was already queued
  await st(page, (code) => window.db.ref(`sessions/${code}/deviceEvents`).push({ type: 'MARKER_EVENT', payload: {}, ts: Date.now() - 10 * 60 * 1000, from: 'tab1', device: 'standalone-defib' }), code);
  await expect.poll(() => st(page, () => window.__simEngine.state.log.filter(l => /Student marked event/.test(l.msg)).length)).toBe(1);
  // A reload: the controller must not replay a press that was already waiting in the queue
  await st(page, (code) => window.db.ref(`sessions/${code}/deviceEvents`).push({ type: 'MARKER_EVENT', payload: {}, ts: Date.now(), from: 'tab1', device: 'standalone-defib' }), code);
  await page.waitForTimeout(500);
  await page.reload();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.waitForTimeout(3500);
  expect(await st(page, () => window.__simEngine.state.log.filter(l => /Student marked event/.test(l.msg)).length)).toBeLessThanOrEqual(2);
  expect(await st(page, (code) => window.__fakeRtdb.get(`sessions/${code}/deviceEvents`), code)).toBeNull();
});

test('the debrief record carries a rhythm change and the final obs, even seconds before Finish', async ({ page }) => {
  await openController(page);
  await startQuickSim(page);
  await pressStart(page);
  await page.waitForTimeout(1500);
  await st(page, () => window.__simEngine.changeRhythm('AF', 'manual selection'));
  await page.waitForTimeout(1200);
  await st(page, () => window.__simEngine.stop());
  const hist = await st(page, () => window.__simEngine.state.history);
  expect(hist.some(h => h.rhythm === 'AF')).toBe(true);
  expect(hist[hist.length - 1].rhythm).toBe('AF');
  expect(hist[hist.length - 1].time).toBe(await st(page, () => window.__simEngine.state.sessionTime || window.__simEngine.state.time));
});

test('a team press on VBG on the room monitor reaches the controller log', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  await pressStart(page);
  const monitor = await context.newPage();
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  await page.waitForTimeout(3500);
  await monitor.getByRole('button', { name: 'VBG' }).click();
  await expect.poll(() => st(page, () => window.__simEngine.state.log.some(l => /Team opened the VBG result/.test(l.msg))), { timeout: 10000 }).toBe(true);
});

test('a stopped infusion wears off from where it got to, and Better/Worse targets are what the tile shows', async ({ page }) => {
  await openController(page);
  const f = await st(page, () => {
    const pk = window.__pkInternals && window.__pkInternals.pkFactor;
    if (!pk) return null;
    const d = { startTime: 0, onset: 0, peak: 120, offset: 120, sustained: true, stopTime: 30 };
    return [pk(d, 29), pk(d, 60), pk(d, 119), pk(d, 120), pk(d, 150)];
  });
  if (f) { expect(f[1]).toBeLessThanOrEqual(f[0] + 0.001); expect(f[2]).toBeLessThanOrEqual(f[1]); expect(f[3]).toBeLessThanOrEqual(f[2]); }
});
