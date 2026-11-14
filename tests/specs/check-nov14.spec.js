// Full check of 14 Nov 2026.
// 1. The Benzylpenicillin tile said "1.2 g" (the adult dose) for every patient, including the 2-day-old
//    in PA029 (Early Onset Neonatal Sepsis). A baby now gets 25 mg/kg (NICE NG195), a child the dose
//    for their age, and neonatal gentamicin is logged at 5 mg/kg.
// 2. data/investigations.js listed AT001, PT003 and AM054 twice in SCENARIO_RESULTS, so the second
//    entry silently replaced the first: the FAST scan for the two trauma patients and the LVH ECG for
//    severe aortic stenosis were lost.
// 3. AM003 (Acute Severe Asthma) named a stabiliser, 'Magnesium', that is not an intervention, so
//    magnesium sulphate never counted as one.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, expect } = require('./helpers');

test.beforeEach(async ({ context, page }) => { await useFakeFirebase(context); page.on('dialog', d => d.accept()); });

const E = (page, fn, arg) => page.evaluate(fn, arg);

async function loadScenario(page, id) {
  await page.waitForFunction(() => !!window.__simEngine && Array.isArray(window.ALL_SCENARIOS));
  await E(page, (id) => {
    const s = window.ALL_SCENARIOS.find(x => x.id === id);
    window.__simEngine.dispatch({ type: 'LOAD_SCENARIO', payload: window.generatePatientFromTemplate(window.enrichScenario(s), {}) });
  }, id);
  await page.waitForFunction((id) => (window.__simEngine.state.scenario || {}).id === id, id);
}
const logText = (page) => E(page, () => window.__simEngine.state.log.map(l => l.msg).join('\n'));

test('a newborn gets benzylpenicillin and gentamicin by weight, not the adult 1.2 g', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await startQuickSim(page);
  await loadScenario(page, 'PA029');
  const weight = await E(page, () => Number(window.__simEngine.state.scenario.wetflag.weight));
  expect(weight).toBeGreaterThan(1);
  expect(weight).toBeLessThan(6);
  await E(page, () => { window.__simEngine.applyIntervention('Benzylpenicillin'); window.__simEngine.applyIntervention('Gentamicin'); });
  await expect.poll(() => logText(page)).toContain(`IV Benzylpenicillin ${Math.round(25 * weight)} mg administered (25 mg/kg).`);
  const log = await logText(page);
  expect(log).toContain('(5 mg/kg)');
  expect(log).toContain('NICE NG195');
  expect(log).not.toContain('Benzylpenicillin 1.2 g administered');
  expect(errors).toEqual([]);
});

test('a young child with meningococcal sepsis gets IV benzylpenicillin by weight and the IM dose for their age', async ({ page }) => {
  await openController(page);
  await startQuickSim(page);
  await loadScenario(page, 'PA001');      // 1 to 5 years old
  const weight = await E(page, () => Number(window.__simEngine.state.scenario.wetflag.weight));
  await E(page, () => { window.__simEngine.applyIntervention('Benzylpenicillin'); window.__simEngine.applyIntervention('BenzylpenicillinIM'); });
  // IV in hospital is by weight; the IM tile is the pre-hospital dose for the child's age.
  await expect.poll(() => logText(page)).toContain(`IV Benzylpenicillin ${Math.min(2400, Math.round(50 * weight))} mg administered (50 mg/kg).`);
  await expect.poll(() => logText(page)).toContain('IM Benzylpenicillin 600 mg administered (pre-hospital dose');
  expect(await logText(page)).not.toContain('1.2 g administered');
});

test('Wellens syndrome recommends ticagrelor, not clopidogrel', async ({ page }) => {
  await openController(page);
  await page.waitForFunction(() => Array.isArray(window.RAW_SCENARIOS));
  const rec = await E(page, () => window.RAW_SCENARIOS.find(s => s.id === 'AM040').recommendedActions);
  expect(rec).toEqual(['Obs', 'IV Access', 'Aspirin', 'Ticagrelor']);
});

test('an adult still gets benzylpenicillin 1.2 g', async ({ page }) => {
  await openController(page);
  await startQuickSim(page);
  await loadScenario(page, 'AM017');
  await E(page, () => window.__simEngine.applyIntervention('Benzylpenicillin'));
  await expect.poll(() => logText(page)).toContain('Benzylpenicillin 1.2 g administered');
});

test('scenario results: no scenario loses a result to a repeated entry', async ({ page }) => {
  await openController(page);
  await page.waitForFunction(() => !!window.INVESTIGATIONS && Array.isArray(window.ALL_SCENARIOS));
  const r = await E(page, () => {
    const R = window.INVESTIGATIONS.SCENARIO_RESULTS;
    return { AT001: R.AT001, PT003: R.PT003, AM054: R.AM054 };
  });
  expect(r.AT001).toEqual({ POCUS: 'us-fast-positive', 'X-ray': 'cxr-haemothorax' });
  expect(r.PT003).toEqual({ POCUS: 'us-fast-positive', 'X-ray': 'cxr-contusion-child' });
  expect(r.AM054).toEqual({ ECG: 'ecg-lvh', POCUS: 'us-aortic-stenosis' });
  // Every result named for a scenario is a real finding for a real scenario.
  const bad = await E(page, () => {
    const INV = window.INVESTIGATIONS, out = [];
    const ids = new Set(window.ALL_SCENARIOS.map(s => s.id));
    Object.keys(INV.SCENARIO_RESULTS).forEach(id => {
      if (!ids.has(id)) out.push('no scenario ' + id);
      Object.values(INV.SCENARIO_RESULTS[id]).forEach(f => { if (!INV.byId[f]) out.push(id + ': no finding ' + f); });
    });
    return out;
  });
  expect(bad).toEqual([]);
});

test('every stabiliser and recommended action in every scenario is a real intervention', async ({ page }) => {
  await openController(page);
  await page.waitForFunction(() => !!window.INTERVENTIONS && Array.isArray(window.RAW_SCENARIOS));
  const bad = await E(page, () => {
    const out = [];
    window.RAW_SCENARIOS.forEach(s => (s.stabilisers || []).concat(s.recommendedActions || []).forEach(k => { if (!window.INTERVENTIONS[k]) out.push(s.id + ': ' + k); }));
    return out;
  });
  expect(bad).toEqual([]);
  expect(await E(page, () => window.RAW_SCENARIOS.find(s => s.id === 'AM003').stabilisers)).toEqual(['Nebs', 'MagSulph']);
});

// Jake's answers, 14 Nov 2026: follow NICE for the antiplatelet, the TIA and the steroid tiles; the
// BNF pre-hospital IM benzylpenicillin dose is 300 mg for a neonate or child up to 1 year.
test('recommended actions follow NICE: ticagrelor for STEMI, no heparin for TIA, hydrocortisone for adult asthma and COPD', async ({ page }) => {
  await openController(page);
  await page.waitForFunction(() => Array.isArray(window.RAW_SCENARIOS));
  const rec = await E(page, () => {
    const out = {};
    ['AM001', 'AM082', 'AM003', 'AM012'].forEach(id => { const s = window.RAW_SCENARIOS.find(x => x.id === id); out[id] = { rec: s.recommendedActions, stab: s.stabilisers || [] }; });
    return out;
  });
  expect(rec.AM001.rec).toContain('Ticagrelor');
  expect(rec.AM001.rec).not.toContain('Clopidogrel');
  expect(rec.AM082.rec).toEqual(['Obs', 'IV Access', 'Aspirin']);
  for (const id of ['AM003', 'AM012']) {
    expect(rec[id].rec).toContain('Hydrocortisone');
    expect(rec[id].rec.concat(rec[id].stab)).not.toContain('Dexamethasone');
  }
  expect(rec.AM012.stab).toContain('Hydrocortisone');
});

test('the IM benzylpenicillin tile gives a newborn the pre-hospital 300 mg', async ({ page }) => {
  await openController(page);
  await startQuickSim(page);
  await loadScenario(page, 'PA029');
  await E(page, () => window.__simEngine.applyIntervention('BenzylpenicillinIM'));
  await expect.poll(() => logText(page)).toContain('IM Benzylpenicillin 300 mg administered (pre-hospital dose');
});
