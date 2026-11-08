// Stress test of 8 Nov 2026 (live site + this suite).
// 1. CPR started from the patient strip and shocks from the defib went through toggleCPR /
//    deliverShock, which log them but never added the 'CPR' / 'Defib' intervention, so the debrief
//    said "ALS Algorithm: not met" after a team had done CPR and shocked twice from the defib tablet.
// 2. Random patient histories listed atorvastatin twice (hyperlipidaemia + previous MI), bisoprolol
//    twice (AF + previous MI) and could give an "NSAIDs" allergy to a patient taking aspirin.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, expect } = require('./helpers');

test.beforeEach(async ({ context, page }) => { await useFakeFirebase(context); page.on('dialog', d => d.accept()); });

const E = (page, fn, arg) => page.evaluate(fn, arg);

test('CPR from the strip and shocks from the defib meet the ALS objective in the debrief', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await startQuickSim(page);        // any live controller view; CA001 is then loaded into it
  await page.waitForFunction(() => !!window.__simEngine && Array.isArray(window.ALL_SCENARIOS));
  await E(page, () => {
    const s = window.ALL_SCENARIOS.find(x => x.id === 'CA001');
    window.__simEngine.dispatch({ type: 'LOAD_SCENARIO', payload: window.generatePatientFromTemplate(window.enrichScenario(s), {}) });
  });
  await page.waitForFunction(() => (window.__simEngine.state.scenario || {}).id === 'CA001');
  await E(page, () => window.__simEngine.start());
  await E(page, () => window.__simEngine.toggleCPR(true, 'facilitator'));
  await E(page, () => window.__simEngine.deliverShock(150, 'student (standalone defib)'));
  await expect.poll(() => E(page, () => window.__simEngine.state.log.some(l => /^Shock delivered 150J/.test(l.msg)))).toBe(true);
  // Neither path adds the intervention itself (that is what the debrief now reads from the log).
  expect(await E(page, () => ({ cpr: window.__simEngine.state.interventionCounts.CPR || 0, defib: window.__simEngine.state.interventionCounts.Defib || 0 }))).toEqual({ cpr: 0, defib: 0 });
  await page.getByRole('button', { name: 'Finish' }).first().click();
  await expect(page.getByText('Simulation Complete')).toBeVisible();
  await expect(page.getByText('Objectives Met: 1/1')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a shock alone is only part of the ALS objective', async ({ page }) => {
  await openController(page);
  await startQuickSim(page);        // any live controller view; CA001 is then loaded into it
  await page.waitForFunction(() => !!window.__simEngine && Array.isArray(window.ALL_SCENARIOS));
  await E(page, () => {
    const s = window.ALL_SCENARIOS.find(x => x.id === 'CA001');
    window.__simEngine.dispatch({ type: 'LOAD_SCENARIO', payload: window.generatePatientFromTemplate(window.enrichScenario(s), {}) });
  });
  await page.waitForFunction(() => (window.__simEngine.state.scenario || {}).id === 'CA001');
  await E(page, () => window.__simEngine.start());
  await E(page, () => window.__simEngine.deliverShock(150, 'facilitator'));
  await page.getByRole('button', { name: 'Finish' }).first().click();
  await expect(page.getByText('Simulation Complete')).toBeVisible();
  await expect(page.getByText('Objectives Met: 0/1')).toBeVisible();
});

test('random histories: each drug once, one statin, no NSAID allergy with aspirin', async ({ page }) => {
  await openController(page);
  await page.waitForFunction(() => typeof window.generateHistory === 'function');
  const problems = await E(page, () => {
    const out = [];
    for (let i = 0; i < 4000; i++) {
      const h = window.generateHistory(30 + (i % 60), i % 2 ? 'Male' : 'Female');
      const names = h.dhx.map(d => d.split(' ')[0]);
      if (new Set(names).size !== names.length) out.push('duplicate: ' + h.dhx.join(', '));
      if (h.dhx.some(d => /^Aspirin/.test(d)) && h.allergies.includes('NSAIDs')) out.push('aspirin + NSAID allergy');
    }
    return [...new Set(out)].slice(0, 5);
  });
  expect(problems).toEqual([]);
});
