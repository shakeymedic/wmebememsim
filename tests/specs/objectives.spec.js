// Learning-objective scoring uses each built-in scenario's AUTHORED components
// (window.SCENARIO_OBJECTIVE_ACTIONS in data/scenarios.js), not keyword matching on the objective's
// wording. Keyword matching credited the wrong care: hydrocortisone and chlorphenamine "met"
// "Distinguish bradykinin angio-oedema from anaphylaxis", while the correct airway care scored 0.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

// The debrief's view of one scenario after the given interventions (counts) were given.
const progress = (page, id, counts) => page.evaluate(([sid, c]) => {
  const scen = window.ALL_SCENARIOS.find(s => s.id === sid);
  const p = window.computeObjectiveProgress(scen, { interventionCounts: c });
  return { fullyMet: p.fullyMet, total: p.total, rows: Object.fromEntries(p.objectives.map(r => [r.objective, { status: r.status, source: r.source, judged: r.facilitatorJudged, missing: r.missingComponents }])) };
}, [id, counts]);

test('every built-in objective has authored components that name real interventions', async ({ page }) => {
  await openController(page);
  const problems = await page.evaluate(() => {
    const out = [];
    const table = window.SCENARIO_OBJECTIVE_ACTIONS || {};
    const known = window.INTERVENTIONS || {};
    const scenarios = window.ALL_SCENARIOS || [];
    if (scenarios.length < 200) out.push(`only ${scenarios.length} built-in scenarios loaded`);
    scenarios.forEach(s => {
      const objs = s.learningObjectives || [];
      const entry = table[s.id];
      objs.forEach(o => {
        if (!entry || !Object.prototype.hasOwnProperty.call(entry, o)) { out.push(`${s.id}: no entry for "${o}"`); return; }
        (entry[o] || []).forEach(g => g.forEach(k => { if (!known[k]) out.push(`${s.id}: unknown key ${k} in "${o}"`); }));
      });
      // Scoring really uses them: no built-in objective falls back to inference.
      window.computeObjectiveProgress(s, {}).objectives.forEach(r => { if (r.source !== 'authored') out.push(`${s.id}: "${r.objective}" scored by inference`); });
      Object.keys(entry || {}).forEach(o => { if (objs.indexOf(o) === -1) out.push(`${s.id}: entry for unknown objective "${o}"`); });
    });
    return out;
  });
  expect(problems).toEqual([]);
});

test('ACE-inhibitor angio-oedema: securing the airway meets the airway objective, antihistamine and steroid meet nothing', async ({ page }) => {
  await openController(page);
  const wrong = await progress(page, 'AM078', { Hydrocortisone: 1, Chlorphenamine: 1 });
  expect(wrong.fullyMet).toBe(0);
  expect(wrong.rows['Distinguish bradykinin angio-oedema from anaphylaxis'].status).toBe('none');
  expect(wrong.rows['Plan a difficult airway with a surgical backup'].status).toBe('none');

  const right = await progress(page, 'AM078', { Oxygen: 1, RSI: 1 });
  expect(right.rows['Plan a difficult airway with a surgical backup'].status).toBe('met');
  // Recognition and judgement objectives are the facilitator's call, never scored from drugs.
  expect(right.rows['Distinguish bradykinin angio-oedema from anaphylaxis']).toMatchObject({ status: 'none', judged: true, source: 'authored' });
  expect(right.rows['Recognise limits of adrenaline in this condition']).toMatchObject({ status: 'none', judged: true });
});

test('anaphylaxis: two IM adrenaline doses and a fluid bolus meet the algorithm; antihistamine and steroid do not', async ({ page }) => {
  await openController(page);
  expect((await progress(page, 'AM026', { AdrenalineIM: 2, Fluids: 1 })).rows['Anaphylaxis algorithm'].status).toBe('met');
  const noFluid = (await progress(page, 'AM026', { AdrenalineIM: 2 })).rows['Anaphylaxis algorithm'];
  expect(noFluid.status).toBe('partial');
  expect(noFluid.missing).toEqual(['Fluid Bolus']);
  expect((await progress(page, 'AM026', { Hydrocortisone: 1, Chlorphenamine: 1 })).rows['Anaphylaxis algorithm'].status).toBe('none');
  // The paediatric antibiotic anaphylaxis: the IM dose by age band.
  expect((await progress(page, 'PA037', { AdrenalineIM: 1 })).rows['Use correct paediatric adrenaline doses'].status).toBe('met');
});

test('temporal arteritis: one steroid meets "Steroid urgency"', async ({ page }) => {
  await openController(page);
  expect((await progress(page, 'EL007', { Dexamethasone: 1 })).rows['Steroid urgency'].status).toBe('met');
  expect((await progress(page, 'EL007', { Hydrocortisone: 1 })).rows['Steroid urgency'].status).toBe('met');
  expect((await progress(page, 'EL007', { Analgesia: 1 })).rows['Steroid urgency'].status).toBe('none');
});

test('COPD: steroid and NIV do not meet "Oxygen targets"; NIV meets "NIV indications"', async ({ page }) => {
  await openController(page);
  const p = await progress(page, 'AM012', { Dexamethasone: 1, NIV: 1, Oxygen: 1 });
  expect(p.rows['Oxygen targets in COPD']).toMatchObject({ status: 'none', judged: true });
  expect(p.rows['NIV indications'].status).toBe('met');
});

test('a scenario\'s own objectiveActions win over inference; an unauthored objective still falls back to it', async ({ page }) => {
  await openController(page);
  const r = await page.evaluate(() => {
    const scen = {
      id: 'CUST_test', learningObjectives: ['Anaphylaxis treatment', 'Recognise anaphylaxis', 'Give fluids'],
      recommendedActions: ['AdrenalineIM', 'Fluids', 'Hydrocortisone'],
      objectiveActions: { 'Anaphylaxis treatment': [['AdrenalineIM']], 'Recognise anaphylaxis': [] }
    };
    const p = window.computeObjectiveProgress(scen, { interventionCounts: { Hydrocortisone: 1, Fluids: 1 }, completedObjectives: ['Recognise anaphylaxis'] });
    return p.objectives.map(x => [x.objective, x.source, x.status]);
  });
  expect(r).toEqual([
    ['Anaphylaxis treatment', 'authored', 'none'],      // hydrocortisone is not adrenaline
    ['Recognise anaphylaxis', 'authored', 'met'],       // the facilitator's tick
    ['Give fluids', 'inferred', 'met']                  // no entry: keyword inference as before
  ]);
});

test('in a live run the wrong drugs no longer tick a judgement objective, and the facilitator can tick it in the debrief', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
  await page.getByRole('button', { name: 'Adult Medical', exact: true }).click();
  await page.locator('div.justify-between', { hasText: 'ACE-Inhibitor Angio-oedema' }).first().getByRole('button', { name: 'Load' }).click();
  await page.getByRole('button', { name: 'Start Scenario' }).click();
  await page.evaluate(() => { const E = window.__simEngine; E.applyIntervention('IV Access'); E.applyIntervention('Hydrocortisone'); E.applyIntervention('Chlorphenamine'); });
  await expect.poll(() => page.evaluate(() => (window.__simEngine.state.interventionCounts || {}).Chlorphenamine || 0)).toBe(1);
  expect(await page.evaluate(() => Array.from(window.__simEngine.state.completedObjectives))).toEqual([]);

  await page.getByRole('button', { name: 'Finish' }).first().click();
  await expect(page.getByText('Simulation Complete')).toBeVisible();
  await expect(page.getByText('Objectives Met: 0/3')).toBeVisible();
  const tick = page.getByRole('button', { name: 'Tick: Distinguish bradykinin angio-oedema from anaphylaxis' });
  await tick.click();
  await expect(page.getByText('Objectives Met: 1/3')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Untick: Distinguish bradykinin angio-oedema from anaphylaxis' })).toHaveAttribute('aria-pressed', 'true');
  // An objective scored from actions has no tick box.
  await expect(page.getByRole('button', { name: /Tick: Plan a difficult airway/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});
