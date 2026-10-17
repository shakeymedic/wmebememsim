// Jake's decisions of 17 Oct 2026: adult cardioversion starts at 75 J (the device's step), a
// patient is paediatric until 18, and raised ICP answers to treatment (osmotherapy, a tube with
// normocapnia) and is shown on the Patient now strip.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, pressStart, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const st = (page, f, a) => page.evaluate(f, a);
async function loadScenario(page, category, title) {
  await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
  await page.getByRole('button', { name: category, exact: true }).click();
  await page.locator('div.justify-between', { hasText: title }).first().getByRole('button', { name: 'Load' }).click();
  await page.getByRole('button', { name: 'Start Scenario' }).click();
  await expect(page.getByRole('button', { name: 'START', exact: true })).toBeVisible();
}

test('adult cardioversion: 75 J is the default and the minimum; a 70 J shock is flagged as too low', async ({ page }) => {
  await openController(page);
  const r = await st(page, () => {
    const RG = window.RHYTHMS;
    return {
      svt: RG.cardioversionEnergy(70, 40, 'SVT'), vt: RG.cardioversionEnergy(70, 40, 'VT'), af: RG.cardioversionEnergy(70, 40, 'AF'),
      at70: RG.energyDeviation(70, 70, 40, { kind: 'cardiovert', rhythm: 'SVT' }),
      at75: RG.energyDeviation(75, 70, 40, { kind: 'cardiovert', rhythm: 'SVT' }),
      ok70: RG.adequateShock(70, 70, 40, 'cardiovert'), ok75: RG.adequateShock(75, 70, 40, 'cardiovert')
    };
  });
  expect(r.svt).toBe(75);
  expect(r.vt).toBe(120);
  expect(r.af).toBe(200);
  expect(r.at70 && r.at70.reason).toMatch(/at least 75 J/);
  expect(r.at75).toBeNull();
  expect(r.ok70).toBe(false);
  expect(r.ok75).toBe(true);
});

test('a patient is paediatric until 18: weight estimate, Quick Sim age range, WETFLAG and the defib threshold', async ({ page }) => {
  await openController(page);
  const r = await st(page, () => {
    const RG = window.RHYTHMS;
    const q17 = window.buildQuickSimScenario({ age: 17 }), q18 = window.buildQuickSimScenario({ age: 18 });
    return {
      w17: window.estimateWeight(17), w18: window.estimateWeight(18),
      range17: q17.ageRange, range18: q18.ageRange, wf17: !!q17.wetflag, wf18: !!q18.wetflag,
      adult17: RG.isAdult(30, 17), adult18: RG.isAdult(30, 18), adultHeavy17: RG.isAdult(70, 17)
    };
  });
  expect(r.w17).toBe(50);
  expect(r.w18).toBeNull();
  expect(r.range17).toBe('Paediatric');
  expect(r.range18).toBe('Adult');
  expect(r.wf17).toBe(true);
  expect(r.wf18).toBe(false);
  expect(r.adult17).toBe(false);
  expect(r.adult18).toBe(true);
  expect(r.adultHeavy17).toBe(true);     // energies follow the 40 kg device threshold too (no weight at all also means adult)
});

test('raised ICP comes down with a tube and normocapnia, and faster with osmotherapy; the strip shows it', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await loadScenario(page, 'Trauma', 'Isolated Head Injury');   // starts at ICP 25
  await st(page, () => window.__simEngine.setDeteriorationMode('auto'));
  await pressStart(page);
  await expect(page.getByTestId('patient-flags')).toContainText('ICP ~25 mmHg (model)');
  // Untreated and hypoventilating: it climbs
  await st(page, () => { window.__simEngine.dispatch({ type: 'UPDATE_VITALS', payload: { etco2: 6.5 } }); });
  await page.waitForTimeout(11000);
  const climbed = await st(page, () => window.__simEngine.state.icp);
  expect(climbed).toBeGreaterThan(25);
  // Intubated with normocapnia: it stops climbing and eases down
  await st(page, () => { window.__simEngine.applyIntervention('RSI'); window.__simEngine.dispatch({ type: 'UPDATE_VITALS', payload: { etco2: 4.5 } }); });
  await page.waitForTimeout(21000);
  const vented = await st(page, () => window.__simEngine.state.icp);
  expect(vented).toBeLessThan(climbed);
  // Hypertonic saline at its peak effect: a clear fall within one tick
  await st(page, () => {
    const E = window.__simEngine, I = window.__pkInternals;
    const entry = I.buildDrugEntry('HypertonicSaline', window.INTERVENTIONS.HypertonicSaline, E.state.time - 600);
    E.dispatch({ type: 'ADD_ACTIVE_DRUG', payload: entry });
  });
  await page.waitForTimeout(11000);
  const treated = await st(page, () => window.__simEngine.state.icp);
  expect(treated).toBeLessThan(vented - 0.3);
  await expect(page.getByTestId('patient-flags')).toContainText(/ICP ~2[0-9] mmHg \(model\)/);
  expect(errors).toEqual([]);
});

test('Mannitol is a drug the controller offers, and the head injury objective accepts it', async ({ page }) => {
  await openController(page);
  const r = await st(page, () => ({
    key: !!window.INTERVENTIONS.Mannitol,
    objective: JSON.stringify(window.SCENARIO_OBJECTIVE_ACTIONS.AT003['Raised ICP management']),
    treats: window.__pkInternals.DETERIORATION_TREATMENTS.neuro.indexOf('Mannitol') !== -1
  }));
  expect(r.key).toBe(true);
  expect(r.objective).toContain('Mannitol');
  expect(r.treats).toBe(true);
});
