// Jake's requests of 15 Oct 2026: no sound prompt when sound already works, investigation results sent
// whenever the facilitator wants, the Quick Sim ventilator closed to start, the facilitator's typed obs
// winning over drugs already given, the full scenario on the controller, back to the scenario after
// Finish, and the injuries and kit on the patient picture (data/screens/injuries.js).
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, pressStart, expandSection, live, expect } = require('./helpers');

test.beforeEach(async ({ context, page }) => { await useFakeFirebase(context); page.on('dialog', d => d.accept()); });

const parts = (page) => page.getByTestId('patient-figure').evaluate(svg => Array.from(svg.querySelectorAll('[data-part]')).map(e => e.getAttribute('data-part')));

// A premade scenario on the controller, with its text changed so the picture has something to show
async function loadPremade(page, id, change) {
  await page.evaluate(([id, change]) => {
    const base = window.ALL_SCENARIOS.find(s => s.id === id);
    window.__simEngine.dispatch({ type: 'LOAD_SCENARIO', payload: Object.assign({}, base, change || {}) });
  }, [id, change || null]);
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.scenario && window.__simEngine.state.scenario.id)).toBe(id);
}

test('the sound prompt only shows while the patient screen cannot play sound', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  const monitor = await context.newPage();
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  const running = await monitor.evaluate(() => window.__monitorEngine.audioContextState);
  // Headless Chromium may or may not start audio without a tap; either way the prompt matches it.
  if (running === 'running') await expect(monitor.getByText('Tap to Enable Sound')).toHaveCount(0);
  else {
    await monitor.getByText('Tap to Enable Sound').click({ force: true });
    await expect(monitor.getByText('Tap to Enable Sound')).toHaveCount(0);
  }
  await expect.poll(() => monitor.evaluate(() => window.__monitorEngine.audioContextState)).toBe('running');
  // The next scenario remounts the monitor (it waits in between): sound is still allowed, so no prompt.
  await page.getByRole('button', { name: 'Finish' }).first().click();
  await expect(page.getByText('Simulation Complete')).toBeVisible();
  await page.getByRole('button', { name: 'Exit to Menu' }).click();
  await expect.poll(() => monitor.evaluate(() => !!window.__monitorEngine.state.liveSeen)).toBe(false);
  await startQuickSim(page);
  await expect.poll(() => monitor.evaluate(() => !!window.__monitorEngine.state.liveSeen)).toBe(true);
  await monitor.waitForTimeout(800);
  await expect(monitor.getByText('Tap to Enable Sound')).toHaveCount(0);
});

test('Quick Sim: the ventilator section starts closed, and each investigation has a Send button', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.setItem('emsim_sections_v1', JSON.stringify({ vent: true })));
  await openController(page);
  await startQuickSim(page);
  await expect(page.locator('[data-section="vent"] > div > button[aria-expanded]')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('Investigations: send or change')).toBeVisible();
  await expandSection(page, await page.locator('[data-section]').filter({ hasText: 'Investigations: send or change' }).first().getAttribute('data-section'));
  const send = page.getByTestId('inv-send-ECG');
  await expect(send).toBeVisible();
  await send.click();
  await expect(send).toContainText('Sent');
  await expect.poll(() => page.evaluate(() => JSON.stringify(window.__simEngine.state.investigationsRevealed || {}))).toMatch(/ECG/);
  expect(errors).toEqual([]);
});

test('Defib Sim also has the Send buttons', async ({ page }) => {
  await openController(page);
  await page.getByRole('button', { name: 'Defib Sim', exact: true }).click();
  await page.locator('[data-defib-scenario="vf-arrest"]').click();
  await page.getByRole('button', { name: 'Start Defib Sim' }).click();
  const head = page.locator('[data-section]').filter({ hasText: 'Investigations: send or change' }).first();
  await expandSection(page, await head.getAttribute('data-section'));
  await expect(page.getByTestId('inv-send-VBG')).toBeVisible();
});

test('obs the facilitator types win over high-flow oxygen already given', async ({ page }) => {
  await openController(page);
  await startQuickSim(page);
  await pressStart(page);
  await page.evaluate(() => window.__simEngine.applyIntervention('Oxygen'));
  await expect.poll(() => page.evaluate(() => (window.__simEngine.state.activeDrugs || []).length)).toBeGreaterThan(0);
  await page.evaluate(() => window.__simEngine.manualUpdateVital('spO2', 85));
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.activeDrugs.map(d => !!(d.muted && d.muted.spO2)))).not.toContain(false);
  await page.waitForTimeout(8000);
  expect(await page.evaluate(() => window.__simEngine.state.vitals.spO2)).toBeLessThanOrEqual(86);
});

test('a premade scenario shows its summary, the full scenario, and the leg fracture with a traction splint', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await startQuickSim(page);
  await loadPremade(page, 'AM002', { quickSim: false, profile: 'A 30-year-old motorcyclist with a closed fracture of the left femur.' });
  const summary = page.getByTestId('scenario-summary');
  await expect(summary).toContainText('Severe Sepsis');
  expect(await parts(page)).toEqual(expect.arrayContaining(['limbs', 'injury-thigh-fracture']));
  expect(await page.evaluate(() => window.Injuries.forScenario(window.__simEngine.state.scenario).map(i => `${i.region}:${i.kind}:${i.side}`))).toContain('thigh:fracture:L');
  expect(await parts(page)).not.toContain('traction');
  await page.evaluate(() => window.__simEngine.applyIntervention('TractionSplint'));
  await expect.poll(() => parts(page)).toContain('traction');

  await page.getByTestId('open-full-scenario').click();
  const full = page.getByTestId('full-scenario');
  await expect(full).toContainText('Clinical progression');
  await expect(full).toContainText('Septic shock');
  await expect(full).toContainText(/femur/i);
  await full.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(full).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Finish pressed by mistake: Back to scenario returns to the same run, paused', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  await pressStart(page);
  const runId = await page.evaluate(() => window.__simEngine.state.runId);
  await page.getByRole('button', { name: 'Finish' }).first().click();
  await expect(page.getByText('Simulation Complete')).toBeVisible();
  await page.getByRole('button', { name: 'Back to scenario' }).click();
  await expect(page.getByRole('button', { name: 'START', exact: true })).toBeVisible();
  const s = await page.evaluate(() => ({ fin: window.__simEngine.state.isFinished, run: window.__simEngine.state.isRunning, runId: window.__simEngine.state.runId, log: window.__simEngine.state.log.map(l => l.msg || l.message || l.text || '').join('|') }));
  expect(s.fin).toBe(false);
  expect(s.run).toBe(false);
  expect(s.runId).toBe(runId);
  expect(s.log).toContain('Back to the scenario after Finish');
  await expect.poll(() => live(page, code, '/isFinished')).toBeFalsy();
  await pressStart(page);
});

test('injury detection reads the common phrasings', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.Injuries);
  const r = await page.evaluate(() => {
    const d = (t) => window.Injuries.detect({ profile: t }).map(i => `${i.region}:${i.kind}:${i.side}`).sort();
    return {
      femur: d('Fractured right femur after a fall.'),
      chestPain: d('Crushing central chest pain.'),
      tension: d('Stab wound to the left chest.'),
      none: d('No injuries. Fever and cough.'),
      openClosed: window.Injuries.detect({ profile: 'Closed fracture of the left femur, open fracture of the right forearm.' }).map(i => `${i.region}:${i.side}:${i.open}`).sort(),
    };
  });
  expect(r.femur).toContain('thigh:fracture:R');
  expect(r.chestPain).toEqual([]);
  expect(r.tension).toContain('chest:wound:L');
  expect(r.none).toEqual([]);
  expect(r.openClosed).toEqual(['forearm:R:true', 'thigh:L:false']);
});
