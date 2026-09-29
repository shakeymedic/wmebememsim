// Anaphylaxis against the RCUK Emergency treatment of anaphylaxis guideline (May 2021), and newborn
// resuscitation against the RCUK Newborn life support algorithm (Guidelines 2025, March 2026).
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

// Load a built-in scenario (by id) into the live controller and start it
async function load(page, id) {
  await page.evaluate((id) => {
    const base = window.ALL_SCENARIOS.find(s => s.id === id);
    window.__simEngine.dispatch({ type: 'LOAD_SCENARIO', payload: window.generatePatientFromTemplate(base, { showWetflag: true }) });
  }, id);
  await page.waitForFunction((id) => (window.__simEngine.state.scenario.id || '').indexOf(id) === 0 || window.__simEngine.state.scenario.title === window.ALL_SCENARIOS.find(s => s.id === id).title, id);
  await page.evaluate(() => window.__simEngine.start());
}
const give = (page, ...keys) => page.evaluate((keys) => keys.forEach(k => window.__simEngine.applyIntervention(k)), keys);
const log = (page) => page.evaluate(() => window.__simEngine.state.log.map(l => l.msg));

test('no anaphylaxis scenario recommends steroids or antihistamines', async ({ page }) => {
  await openController(page);
  const bad = await page.evaluate(() => {
    const M = window.__EngineModel;
    return window.ALL_SCENARIOS.filter(s => M.isAnaphylaxisScenario(s))
      .map(s => ({ id: s.id, rec: (s.recommendedActions || []).filter(k => ['Hydrocortisone', 'Dexamethasone', 'Chlorphenamine'].indexOf(k) !== -1) }))
      .filter(x => x.rec.length);
  });
  const count = await page.evaluate(() => window.ALL_SCENARIOS.filter(s => window.__EngineModel.isAnaphylaxisScenario(s)).length);
  expect(count).toBeGreaterThanOrEqual(4);
  expect(bad).toEqual([]);
});

test('in anaphylaxis, steroids and antihistamines do not slow the decline; in asthma a steroid still counts', async ({ page }) => {
  await openController(page);
  const r = await page.evaluate(() => {
    const f = window.__EngineModel.deteriorationTreatmentFactor;
    const cs = (title, key) => ({ scenario: { title }, activeInterventions: new Set(), interventionCounts: { [key]: 1 } });
    return {
      anaHydro: f('shock', cs('Anaphylaxis (Adult)', 'Hydrocortisone')),
      anaChlor: f('airway', cs('Anaphylaxis (Adult)', 'Chlorphenamine')),
      anaAdr: f('shock', cs('Anaphylaxis (Adult)', 'AdrenalineIM')),
      asthmaHydro: f('resp', cs('Acute Severe Asthma', 'Hydrocortisone')),
      addisonHydro: f('shock', cs('Addisonian Crisis', 'Hydrocortisone'))
    };
  });
  expect(r.anaHydro).toBe(1);
  expect(r.anaChlor).toBe(1);
  expect(r.anaAdr).toBeLessThan(1);
  expect(r.asthmaHydro).toBeLessThan(1);
  expect(r.addisonHydro).toBeLessThan(1);
});

test('anaphylaxis: an antihistamine before adrenaline is flagged; the RCUK follow-up advice appears', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await startQuickSim(page);
  await page.waitForFunction(() => !!window.__simEngine);
  await load(page, 'AM026');
  await give(page, 'IV Access', 'Chlorphenamine', 'AdrenalineIM', 'Hydrocortisone', 'AdrenalineInfusion');
  // The log lands on the next render: wait for the last line before reading it
  await expect.poll(async () => (await log(page)).some(m => /^RCUK peripheral low-dose adrenaline infusion/.test(m))).toBe(true);
  const msgs = await log(page);
  expect(msgs.some(m => /^Chlorphenamine given before any adrenaline in anaphylaxis/.test(m))).toBe(true);
  expect(msgs.some(m => /^Antihistamines are third-line in anaphylaxis/.test(m))).toBe(true);
  expect(msgs.some(m => /^Corticosteroids are no longer advised/.test(m))).toBe(true);
  expect(msgs.some(m => /^Hydrocortisone given before any adrenaline/.test(m))).toBe(false);   // adrenaline came first
  expect(msgs.some(m => /mast cell tryptase.*1-2 h \(no later than 4 h\)/.test(m))).toBe(true);
  expect(msgs.some(m => /1 mg in 100 ml.*0\.5-1 ml\/kg\/h/.test(m))).toBe(true);
  expect(errors).toEqual([]);
});

test('newborn: NLS 2025 inflation breaths, 3:1 compressions and SpO2 targets', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await startQuickSim(page);
  await page.waitForFunction(() => !!window.__simEngine);
  await load(page, 'PA036');
  expect(await page.evaluate(() => window.__EngineModel.isNeonate(window.__simEngine.state.scenario))).toBe(true);
  await give(page, 'Bagging', 'CPR');
  await expect.poll(async () => (await log(page)).some(m => /3 chest compressions to 1 ventilation/.test(m))).toBe(true);
  const msgs = await log(page);
  expect(msgs.some(m => /^NLS 2025: .*5 inflation breaths at 30 cm H2O in air.*80-85% at 5 min/.test(m))).toBe(true);
  expect(msgs.some(m => /^NLS 2025: .*3 chest compressions to 1 ventilation/.test(m))).toBe(true);
  const rec = await page.evaluate(() => window.__simEngine.state.scenario.recommendedActions);
  expect(rec).not.toContain('Suction');                  // suction is only for a chest that does not move
  expect(errors).toEqual([]);
});
