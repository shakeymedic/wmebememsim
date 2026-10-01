// Paediatric content against RCUK Guidelines 2025: the Paediatric emergency drug chart (Feb 2026),
// the Paediatric advanced life support algorithm (Nov 2025 V2) and the Paediatric cardiac
// arrhythmias algorithm.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const run = (page, fn, arg) => page.evaluate(([f, a]) => new Function('arg', f)(a), [fn, arg]);

test('estimated weight, tube size and WETFLAG follow the RCUK drug chart', async ({ page }) => {
  await openController(page);
  const weights = await run(page, 'return [0, 1, 2, 5, 7, 8, 10, 12, 14, 15, 16].map(a => window.estimateWeight(a))');
  expect(weights).toEqual([3.5, 10, 12, 18, 23, 26, 30, 38, 50, 50, null]);

  const wf = await run(page, 'return arg.map(([a, w]) => window.calculateWetflag(a, w))', [[0, 3.5], [1, 10], [8, 26], [14, 50]]);
  // < 1 month: 3.0 uncuffed; 1 year: 3.5 cuffed (4.0 uncuffed); 8 years: 6.0-6.5 cuffed
  expect(wf.map(x => x.tube)).toEqual(['3.0 uncuffed', '3.5 cuffed', '6.0–6.5 cuffed', '7.0–8.0 cuffed']);
  expect(wf[1]).toMatchObject({ adrenaline: 100, fluids: 100, glucose: 20, lorazepam: '1.0', tubeUncuffed: '4.0' });
  // Adolescent row: adrenaline 500 mcg, fluid 500 ml, glucose 50 ml, 150 J
  expect(wf[3]).toMatchObject({ adrenaline: 500, fluids: 500, glucose: 50, lorazepam: '4.0', energy: 150 });
  // Caps from the chart's adult row
  const big = await run(page, 'return window.calculateWetflag(15, 120)');
  expect(big).toMatchObject({ adrenaline: 1000, fluids: 500, glucose: 50, lorazepam: '4.0' });
});

test('paediatric doses: atropine, adenosine, IM adrenaline, amiodarone, buccal midazolam', async ({ page }) => {
  await openController(page);
  const r = await run(page, `
    const M = window.__EngineModel;
    const child = (age, weight, extra) => Object.assign({ ageRange: 'Paediatric', patientAge: age, wetflag: { weight } }, extra || {});
    const n = (key, sc, ctx) => M.paediatricDoseNotes(key, sc, ctx);
    return {
      atropine1: n('Atropine', child(1, 10)).log,
      atropine5: n('Atropine', child(9, 30)).log,
      atropine13: n('Atropine', child(13, 44)).log,
      ad1: M.paediatricAdenosineDose(child(5, 20), 1),
      ad2: M.paediatricAdenosineDose(child(5, 20), 2),
      adBig: M.paediatricAdenosineDose(child(14, 70), 2),
      adNeo: [1, 2, 3].map(i => M.paediatricAdenosineDose(child(0, 3.5, { title: 'Early Onset Neonatal Sepsis' }), i)),
      adAdult: M.paediatricAdenosineDose({ ageRange: 'Adult', patientAge: 40 }, 1),
      im: [0, 4, 6, 7, 12, 13].map(a => n('AdrenalineIM', child(a, 20)).log),
      amio1: n('Amiodarone', child(6, 20), { count: 1, inArrest: true }).log,
      amio2: n('Amiodarone', child(13, 44), { count: 2, inArrest: true }).log,
      amioTachy: n('Amiodarone', child(6, 20), { count: 1, inArrest: false }).log,
      midaz: n('MidazolamBuccal', child(3, 14)).log,
      midazBig: n('MidazolamBuccal', child(14, 50)).log,
      glucose: n('Dextrose', child(10, 30)).log,
      calcium: n('Calcium', child(14, 70)).log
    };`);
  expect(r.atropine1).toBe('IV Atropine 200 mcg administered (20 mcg/kg).');
  expect(r.atropine5).toBe('IV Atropine 500 mcg administered (20 mcg/kg).');      // max 0.5 mg up to 11 years
  expect(r.atropine13).toBe('IV Atropine 600 mcg administered (20 mcg/kg).');     // 300-600 mcg at 12-17 years
  expect(r.ad1).toBe('0.1-0.2 mg/kg (2-4 mg)');
  expect(r.ad2).toBe('0.3 mg/kg (6 mg)');
  expect(r.adBig).toBe('0.3 mg/kg (18 mg)');                                       // max 12-18 mg
  expect(r.adNeo).toEqual(['150 mcg/kg (525 mcg)', '250 mcg/kg (875 mcg)', '300 mcg/kg (1050 mcg)']);
  expect(r.adAdult).toBeNull();
  expect(r.im.map(l => l.match(/Adrenaline ([\d-]+) micrograms/)[1])).toEqual(['100-150', '150', '150', '300', '300', '500']);
  expect(r.amio1).toBe('IV/IO Amiodarone 100 mg administered (5 mg/kg).');
  expect(r.amio2).toBe('IV/IO Amiodarone 150 mg administered (5 mg/kg).');        // 2nd dose max 150 mg
  expect(r.amioTachy).toMatch(/100 mg \(5 mg\/kg\) started by SLOW infusion/);
  expect(r.midaz).toBe('Buccal Midazolam 4.2 mg administered (0.3 mg/kg).');
  expect(r.midazBig).toBe('Buccal Midazolam 10 mg administered (0.3 mg/kg).');
  expect(r.glucose).toBe('IV 10% Glucose 50 ml administered (2 ml/kg).');
  expect(r.calcium).toBe('IV 10% Calcium Gluconate 30 ml administered (0.5 ml/kg) over 5-10 min.');
});

test('shock energies: 4 J/kg, up to 8 J/kg only from the 5th shock, cardioversion 1 J/kg doubling to 4 J/kg', async ({ page }) => {
  await openController(page);
  const r = await run(page, `
    const RG = window.RHYTHMS, d = (j, w, a, o) => RG.energyDeviation(j, w, a, o);
    return {
      rec20: RG.recommendedEnergy(20, 5),
      high2: d(150, 20, 5, { shockNumber: 2 }),
      high5: d(150, 20, 5, { shockNumber: 5 }),
      tooHigh5: d(200, 20, 5, { shockNumber: 5 }),
      cv1: d(20, 20, 5, { kind: 'cardiovert', rhythm: 'SVT' }),
      cv4: d(75, 20, 5, { kind: 'cardiovert', rhythm: 'SVT' }),
      cvHigh: d(150, 20, 5, { kind: 'cardiovert', rhythm: 'SVT' }),
      cvLow: d(5, 20, 5, { kind: 'cardiovert', rhythm: 'SVT' }),
      adultCv70: d(70, null, 40, { kind: 'cardiovert', rhythm: 'SVT' }),
      adultCv50: d(50, null, 40, { kind: 'cardiovert', rhythm: 'SVT' }),
      adultArrest: d(150, null, 40, { shockNumber: 1 }),
      cvStart: [RG.cardioversionEnergy(20, 5, 'SVT'), RG.cardioversionEnergy(null, 40, 'AF'), RG.cardioversionEnergy(null, 40, 'VT'), RG.cardioversionEnergy(null, 40, 'SVT')]
    };`);
  expect(r.rec20).toBe(75);                       // 4 J/kg = 80 J, nearest selection on this device
  expect(r.high2).not.toBeNull();                 // 150 J (7.5 J/kg) is too high for a 2nd shock
  expect(r.high5).toBeNull();                     // but allowed for refractory VF from the 5th
  expect(r.tooHigh5).not.toBeNull();              // 10 J/kg is above 8 J/kg
  expect(r.cv1).toBeNull();
  expect(r.cv4).toBeNull();
  expect(r.cvHigh).not.toBeNull();
  expect(r.cvLow).not.toBeNull();
  expect(r.adultCv70).toBeNull();                 // adult flutter/SVT 70-120 J is not "too low"
  expect(r.adultCv50).not.toBeNull();
  expect(r.adultArrest).toBeNull();
  expect(r.cvStart).toEqual([20, 200, 120, 70]);
});

test('a child in the simulator: the log gives weight-based doses and RCUK coaching', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await startQuickSim(page);        // any live controller view; the child is then loaded into it
  await page.waitForFunction(() => !!window.__simEngine);
  await page.evaluate(() => {
    const e = window.__simEngine;
    e.dispatch({ type: 'LOAD_SCENARIO', payload: window.buildQuickSimScenario({ age: 5, rhythm: 'SVT' }) });
  });
  await page.waitForFunction(() => window.__simEngine.state.scenario.patientAge === 5);
  await page.evaluate(() => { const e = window.__simEngine; e.start(); e.applyIntervention('IV Access'); e.applyIntervention('Adenosine'); e.applyIntervention('AdrenalineIM'); e.applyIntervention('AdrenalineIM'); });
  const msgs = () => page.evaluate(() => window.__simEngine.state.log.map(l => l.msg));
  await expect.poll(async () => (await msgs()).some(m => /^Adenosine 0\.1-0\.2 mg\/kg \(1\.8-3\.6 mg\) given/.test(m))).toBe(true);
  await expect.poll(async () => (await msgs()).some(m => /REFRACTORY anaphylaxis/.test(m))).toBe(true);   // the last line
  const log = await msgs();
  expect(log.some(m => /^Paediatric adenosine \(RCUK 2025\)/.test(m))).toBe(true);
  expect(log.some(m => /max 6 mg|MINIMUM 100 mcg/.test(m))).toBe(false);
  expect(log.filter(m => /^IM Adrenaline 150 micrograms/.test(m)).length).toBe(2);
  expect(log.some(m => /REFRACTORY anaphylaxis/.test(m))).toBe(true);
  expect(errors).toEqual([]);
});

test('Defib Sim with a child: the tablet shows the paediatric RCUK cards, the controller weight-based doses', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await page.getByRole('button', { name: 'Defib Sim', exact: true }).click();
  await page.locator('#defibAge').fill('6');
  await page.locator('[data-defib-scenario="vf-arrest"]').click();
  await page.getByRole('button', { name: 'Start Defib Sim' }).click();
  await page.waitForFunction(() => window.__simEngine && window.__simEngine.state.scenario && window.__simEngine.state.scenario.patientAge === 6);

  const defib = await context.newPage();
  const defibErrors = trackErrors(defib);
  await defib.goto(`/defib/index.html?session=${code}`);
  await expect(defib.locator('#linkBanner')).toBeHidden();
  await defib.locator('[data-hint="shockable"]').click();
  await expect(defib.locator('#hintTitle')).toHaveText('Paediatric Shockable Arrest (VF / pVT)');
  await expect(defib.locator('#hintBody')).toContainText('CPR 15:2');
  await expect(defib.locator('#hintBody')).toContainText('4 J/kg');
  await defib.locator('#hintClose').click();
  await defib.locator('[data-hint="brady"]').click();
  await expect(defib.locator('#hintBody')).toContainText('Pacing is very rarely required');
  await defib.locator('#hintClose').click();

  // The controller's prompts after three shocks are per kg for a 20 kg six-year-old
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_DEFIB_STATE', payload: { shockCount: 1 } }));
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_DEFIB_STATE', payload: { shockCount: 2 } }));
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_DEFIB_STATE', payload: { shockCount: 3 } }));
  await expect(page.getByText(/Adrenaline 10 micrograms\/kg IV\/IO = 200 mcg \(max 1 mg\) due/)).toBeVisible();
  await expect(page.getByText(/Amiodarone 5 mg\/kg IV\/IO = 100 mg due \(after the 3rd shock, max 300 mg\)/)).toBeVisible();
  expect(errors).toEqual([]);
  expect(defibErrors).toEqual([]);
});

test('the drug calculator gives RCUK paediatric doses (IM adrenaline by age, atropine, glucose)', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await page.getByRole('button', { name: 'Quick Sim', exact: true }).click();
  await page.getByLabel('Age (years)').fill('4');
  await page.getByRole('button', { name: 'Start Quick Sim' }).click();
  await page.getByRole('button', { name: /^Tools/ }).click();
  await page.getByRole('menuitem', { name: /Drug calculator/ }).click();
  await expect(page.getByLabel('Patient Weight (kg)')).toHaveValue('16');      // RCUK chart, 4 years
  const row = (name) => page.locator('div.justify-between', { has: page.getByText(name, { exact: true }) });
  await expect(row('Adrenaline IM (Anaphylaxis)')).toContainText('0.15 mg');   // by age, not weight
  await expect(row('Atropine (Bradycardia)')).toContainText('0.32 mg');         // 20 mcg/kg
  await expect(row('Glucose 10% (child)')).toContainText('32.0 ml');            // 2 ml/kg
  await expect(row('Midazolam Buccal (Seizure)')).toContainText('4.8 mg');      // 0.3 mg/kg
  await page.getByLabel('Patient Weight (kg)').fill('40');
  await expect(row('Atropine (Bradycardia)')).toContainText('0.5 mg');          // max 0.5 mg up to 11 years
  await expect(row('Glucose 10% (child)')).toContainText('50.0 ml');            // chart maximum
  expect(errors).toEqual([]);
});
