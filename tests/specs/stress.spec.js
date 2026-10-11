// Stress and regression tests from the full review (Oct 2026): long chaotic runs that must keep the
// patient sane, and one check for each of the serious bugs that review found and fixed.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, live, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const engine = (page, fn, arg) => page.evaluate(([f, a]) => new Function('sim', 'arg', f)(window.__simEngine, a), [fn, arg]);
const settle = (page) => page.evaluate(() => new Promise(r => setTimeout(r, 30)));

// Throws inside the page if any observation is out of range; returns the problems found.
const SANITY = `
  const RG = window.RHYTHMS, s = sim.state, v = s.vitals, out = [];
  Object.keys(v).forEach(k => {
    if (typeof v[k] === 'number' && !Number.isFinite(v[k])) out.push('vital ' + k + ' = ' + v[k]);
    if (v[k] === undefined || v[k] === null) out.push('vital ' + k + ' missing');
  });
  if (v.spO2 < 0 || v.spO2 > 100) out.push('SpO2 ' + v.spO2);
  if (v.hr < 0 || v.hr > 300) out.push('HR ' + v.hr);
  if (v.rr < 0 || v.rr > 80) out.push('RR ' + v.rr);
  if (v.bpSys < 0 || v.bpSys > 300 || v.bpDia < 0 || v.bpDia > v.bpSys + 1) out.push('BP ' + v.bpSys + '/' + v.bpDia);
  if (!RG.isKnown(s.rhythm)) out.push('unknown rhythm ' + s.rhythm);
  if (RG.isPulseless(s.rhythm) && (v.bpSys > 0 || v.spO2 > 0)) out.push('output in pulseless ' + s.rhythm + ': BP ' + v.bpSys + ', SpO2 ' + v.spO2);
  const b = s.baseVitals || {};
  ['hr', 'bpSys', 'bpDia', 'rr', 'spO2'].forEach(k => { if (typeof b[k] === 'number' && !Number.isFinite(b[k])) out.push('base ' + k + ' = ' + b[k]); });
  if (Number.isFinite(b.bpDia) && (b.bpDia < 0 || b.bpDia > 200)) out.push('base diastolic ' + b.bpDia);
  (s.log || []).forEach(l => { if (/\\bNaN\\b|\\bundefined\\b|content bug/.test(l.msg)) out.push('log: ' + l.msg.slice(0, 120)); });
  return out;
`;

test('chaos: 40 scenarios, random interventions, arrests, shocks and ROSC for 10 simulated minutes each', async ({ page }) => {
  test.setTimeout(420000);
  const errors = trackErrors(page);
  await openController(page);
  await startQuickSim(page);
  const n = await page.evaluate(() => window.ALL_SCENARIOS.length);
  const problems = [];
  for (let run = 0; run < 40; run++) {
    const idx = (run * 37 + 11) % n;
    const r = await page.evaluate(async ([idx, seed, SANITY]) => {
      let x = seed;
      const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
      const sleep = () => new Promise(res => setTimeout(res, 0));
      const e = () => window.__simEngine, RG = window.RHYTHMS;
      const base = window.ALL_SCENARIOS[idx];
      e().dispatch({ type: 'LOAD_SCENARIO', payload: window.generatePatientFromTemplate(base, { showWetflag: true }) });
      await sleep(); await sleep();
      e().start(); await sleep();
      const keys = Object.keys(window.INTERVENTIONS);
      for (let t = 0; t < 600; t++) {
        const roll = rnd();
        if (roll < 0.06) e().applyIntervention(keys[Math.floor(rnd() * keys.length)]);
        else if (roll < 0.065) e().triggerArrest(rnd() < 0.5 ? 'VF' : 'Asystole');
        else if (roll < 0.07 && RG.isPulseless(e().state.rhythm)) e().triggerROSC('Sinus Rhythm');
        else if (roll < 0.075) e().deliverShock(150);
        else if (roll < 0.08) e().dispatch({ type: 'TRIGGER_' + (rnd() < 0.5 ? 'IMPROVE' : 'DETERIORATE') });
        else if (roll < 0.083) { e().pause(); await sleep(); e().start(); }
        e().dispatch({ type: 'TICK_TIME' });
        if (t % 20 === 0) await sleep();
      }
      await sleep(); await sleep();
      const out = new Function('sim', SANITY)(e());
      e().pause();
      return out.length ? `${base.id} ${base.title}: ${out.join('; ')}` : null;
    }, [idx, run + 1, SANITY]).catch(err => `${idx}: threw ${err.message}`);
    if (r) problems.push(r);
  }
  expect(problems).toEqual([]);
  expect(errors).toEqual([]);
});

test('extreme patients: newborn, infant, 110 kg adult and 99-year-old stay sane on every drug', async ({ page }) => {
  test.setTimeout(180000);
  const errors = trackErrors(page);
  await openController(page);
  await startQuickSim(page);
  const out = await page.evaluate(async (SANITY) => {
    const sleep = () => new Promise(res => setTimeout(res, 0));
    const e = () => window.__simEngine;
    const problems = [];
    for (const opts of [{ age: 0 }, { age: 0.25 }, { age: 40, weight: 110 }, { age: 99 }]) {
      e().dispatch({ type: 'LOAD_SCENARIO', payload: window.buildQuickSimScenario(opts) });
      await sleep(); await sleep();
      e().start();
      for (const k of Object.keys(window.INTERVENTIONS)) { e().applyIntervention(k); e().dispatch({ type: 'TICK_TIME' }); }
      for (let t = 0; t < 300; t++) { e().dispatch({ type: 'TICK_TIME' }); if (t % 30 === 0) await sleep(); }
      await sleep(); await sleep();
      const p = new Function('sim', SANITY)(e());
      if (p.length) problems.push(JSON.stringify(opts) + ': ' + p.join('; '));
      e().pause();
    }
    return problems;
  }, SANITY);
  expect(out).toEqual([]);
  expect(errors).toEqual([]);
});

test('1 mg IV adrenaline in cardiac arrest is not treated as an overdose', async ({ page }) => {
  await openController(page);
  await startQuickSim(page);
  await engine(page, 'sim.start(); sim.triggerArrest("VF");');
  await settle(page);
  await engine(page, 'sim.applyIntervention("AdrenalineIV");');
  await settle(page);
  const log = await engine(page, 'return sim.state.log.map(l => l.msg).join("\\n");');
  expect(log).not.toMatch(/PATIENT WITH A PULSE/);
  expect(await engine(page, 'return (sim.state.activeDrugs || []).some(d => /Overdose/.test(d.key || d.id || ""));')).toBe(false);
});

test('SpO2 does not climb in cardiac arrest while bagging on oxygen', async ({ page }) => {
  await openController(page);
  await startQuickSim(page);
  await engine(page, 'sim.start(); sim.triggerArrest("Asystole");');
  await settle(page);
  await engine(page, 'sim.applyIntervention("Oxygen"); sim.applyIntervention("Bagging"); for (let i = 0; i < 180; i++) sim.dispatch({ type: "TICK_TIME" });');
  await settle(page);
  expect(await engine(page, 'return sim.state.vitals.spO2;')).toBe(0);
});

test('a new session code gets the whole patient, not just what changed', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await startQuickSim(page);
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Back/ }).first().click();
  await page.getByRole('button', { name: 'New code' }).click();
  const code = await page.evaluate(() => localStorage.getItem('wmebem_session_id'));
  await startQuickSim(page);
  await expect.poll(async () => { const l = await live(page, code); return !!(l && l.vitals && l.rhythm && l.scenarioTitle !== undefined); }, { timeout: 5000 }).toBe(true);
  expect(errors).toEqual([]);
});

test('Back pauses the scenario and the menu returns to it with nothing lost', async ({ page }) => {
  await openController(page);
  await startQuickSim(page);
  await page.getByRole('button', { name: 'START', exact: true }).click();
  await engine(page, 'sim.addLogEntry("marker before back", "manual");');
  await page.getByRole('button', { name: /Back/ }).first().click();
  await expect(page.getByText('Scenario paused')).toBeVisible();
  expect(await engine(page, 'return sim.state.isRunning;')).toBe(false);
  await page.getByRole('button', { name: 'Return to scenario' }).click();
  expect(await engine(page, 'return sim.state.log.some(l => l.msg === "marker before back");')).toBe(true);
});

test('keyboard shortcuts still work after clicking a button', async ({ page }) => {
  await openController(page);
  await startQuickSim(page);
  await page.getByRole('button', { name: 'START', exact: true }).click();
  await page.keyboard.press('d');
  await expect(page.getByRole('button', { name: 'Close drug calculator' })).toBeVisible();
  await page.keyboard.press('d');
  await expect(page.getByRole('button', { name: 'Close drug calculator' })).toHaveCount(0);
});

test('editing an arrest scenario in Builder keeps HR 0 and BP 0', async ({ page }) => {
  await openController(page);
  await page.getByRole('button', { name: /^premade$/i }).click();
  await page.getByRole('button', { name: 'Cardiac Arrest', exact: true }).click();
  const row = page.locator('div.justify-between', { hasText: 'VF Arrest' }).first();
  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel(/heart rate/i).first()).toHaveValue('0');
});
