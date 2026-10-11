// Fixes from the second full review (11 Oct 2026): resuming keeps the room monitor's devices, a typed
// obs beats a running trend, objective scoring accepts interchangeable treatments, decompression updates
// the chest X-ray, and a second controller tab does not take over the first one's session.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const st = (page, f) => page.evaluate(f);

test('resuming after a reload keeps the defib on the room monitor and the capnography shape', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await page.getByRole('button', { name: 'Defib Sim', exact: true }).click();
  await page.locator('[data-defib-scenario="complete-hb"]').click();
  await page.getByRole('button', { name: 'Start Defib Sim' }).click();
  await page.getByRole('button', { name: 'START', exact: true }).click();
  await st(page, () => { const E = window.__simEngine; E.dispatch({ type: 'SET_DEFIB_PANEL', payload: true }); E.dispatch({ type: 'SET_ETCO2_PATHOLOGY', payload: 'obstructive' }); });
  await expect.poll(() => st(page, () => { try { const s = JSON.parse(localStorage.getItem('wmebem_sim_state')); return s.defibPanelOpen && s.etco2Pathology; } catch (e) { return null; } }), { timeout: 15000 }).toBe('obstructive');
  await page.reload();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByTestId('defib-controller')).toBeVisible();
  expect(await st(page, () => [window.__simEngine.state.defibPanelOpen, window.__simEngine.state.etco2Pathology])).toEqual([true, 'obstructive']);
  expect(errors).toEqual([]);
});

test('a value typed during a trend stays put; the trend carries on for the other obs', async ({ page }) => {
  await openController(page);
  await startQuickSim(page);
  await page.getByRole('button', { name: 'START', exact: true }).click();
  await st(page, () => window.__simEngine.startTrend({ spO2: 99, hr: 60 }, 20));
  await page.waitForTimeout(3000);
  await st(page, () => window.__simEngine.dispatch({ type: 'MANUAL_VITAL_UPDATE', payload: { key: 'spO2', value: 82 } }));
  await page.waitForTimeout(4000);
  const s = await st(page, () => ({ spO2: window.__simEngine.state.vitals.spO2, targets: Object.keys(window.__simEngine.state.trends.targets || {}), active: window.__simEngine.state.trends.active }));
  expect(Math.round(s.spO2)).toBe(82);
  expect(s.targets).toEqual(['hr']);
  expect(s.active).toBe(true);
});

test('objective scoring counts interchangeable treatments as one component', async ({ page }) => {
  await openController(page);
  const r = await st(page, () => {
    const scen = { learningObjectives: ['Prioritise IM adrenaline and fluids'], recommendedActions: ['AdrenalineIM', 'AdrenalineInfusion', 'Fluids'] };
    return window.computeObjectiveProgress(scen, { interventionCounts: { AdrenalineIM: 2, Fluids: 1 } }).objectives[0];
  });
  expect(r.status).toBe('met');
  expect(r.components.length).toBe(2);
});

test('needle decompression re-expands the lung on the chest X-ray, and the next run starts with the pneumothorax again', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
  await page.getByRole('button', { name: 'Adult Medical', exact: true }).click();
  await page.locator('div.justify-between', { hasText: 'Tension Pneumothorax' }).first().getByRole('button', { name: 'Load' }).click();
  await page.getByRole('button', { name: 'Start Scenario' }).click();
  const cxr = () => st(page, () => { const s = window.__simEngine.state.scenario; const c = s.chestXray || {}, g = (s.investigations || {}).chestXray || {}; return [c.findings || '', c.image || null, g.findings || '', g.image || null]; });
  expect((await cxr()).join(' ')).toMatch(/pneumothorax/i);
  await st(page, () => { window.__simEngine.applyIntervention('IV Access'); window.__simEngine.applyIntervention('Needle'); });
  await expect.poll(async () => (await cxr())[0]).toMatch(/re-expanded/);
  const after = await cxr();
  expect(after[1]).toBeNull();
  expect(after[3]).toBeNull();
  // The library copy is untouched.
  expect(await st(page, () => { const s = (window.ALL_SCENARIOS || []).find(x => x.id === 'AM031'); return JSON.stringify((s && (s.chestXray || (s.investigations || {}).chestXray)) || {}); })).not.toMatch(/re-expanded/);
  expect(errors).toEqual([]);
});

test('a second controller tab gets its own session code; reloading keeps it', async ({ page, context }) => {
  await openController(page);
  const codeA = await st(page, () => localStorage.getItem('wmebem_session_id'));
  const b = await context.newPage();
  await openController(b);
  const codeB = await b.evaluate(() => new URLSearchParams(location.search).get('session'));
  expect(codeB).not.toBe(codeA);
  // The first tab reloads onto its own code.
  await page.reload();
  await page.getByText('Session Code', { exact: true }).waitFor().catch(() => {});
  expect(await st(page, () => new URLSearchParams(location.search).get('session'))).toBe(codeA);
});

test('an ED quick sim does not offer the ventilator chooser in the status strip; leaving the debrief asks first', async ({ page }) => {
  trackErrors(page);   // accepts dialogs
  await openController(page);
  await startQuickSim(page);
  await expect(page.getByTestId('patient-status')).toBeVisible();
  await expect(page.getByTestId('status-vent')).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish' }).click();
  let asked = '';
  page.once('dialog', d => { asked = d.message(); });
  await page.getByRole('button', { name: 'Exit to Menu' }).click();
  await expect.poll(() => asked).toMatch(/Leave the debrief/);
});

test('on a short laptop screen the strip starts compact and the briefing Start button is in view', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openController(page);
  await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
  await page.getByRole('button', { name: 'Adult Medical', exact: true }).click();
  await page.locator('div.justify-between', { hasText: 'SVT (Adult)' }).first().getByRole('button', { name: 'Load' }).click();
  await expect(page.getByRole('button', { name: 'Start Scenario' })).toBeInViewport();
  await page.getByRole('button', { name: 'Start Scenario' }).click();
  await expect(page.getByTestId('patient-compact')).toBeVisible();
  await expect(page.getByTestId('patient-figure')).toHaveCount(0);
});
