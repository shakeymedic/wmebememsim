// The scenario library: every built-in scenario runs cleanly, and specific clinical content rules
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, session, live, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

// The real Premade flow: category -> Load -> briefing -> Start Scenario
async function startPremade(page, category, title) {
  await page.getByRole('button', { name: /^premade$/i }).click();
  await page.getByRole('button', { name: category, exact: true }).click();
  const row = page.locator('div.justify-between', { hasText: title }).first();
  await row.getByRole('button', { name: 'Load' }).click();
  await page.getByRole('button', { name: 'Start Scenario' }).click();
}
const engine = (page, fn) => page.evaluate(f => new Function('sim', f)(window.__simEngine), fn);

test('every built-in scenario loads and runs for 2 simulated minutes with sane observations', async ({ page }) => {
  test.setTimeout(300000);
  const errors = trackErrors(page);
  await openController(page);
  await startQuickSim(page);        // any live controller view; each scenario is then loaded into it
  const n = await page.evaluate(() => window.ALL_SCENARIOS.length);
  expect(n).toBeGreaterThan(200);
  const problems = [];
  for (let i = 0; i < n; i++) {
    const r = await page.evaluate(async (i) => {
      const sleep = () => new Promise(res => setTimeout(res, 0));
      const RG = window.RHYTHMS, e = () => window.__simEngine;
      const base = window.ALL_SCENARIOS[i];
      const issues = [];
      const sc = window.generatePatientFromTemplate(base, { showWetflag: true });
      if (base.ecg && !RG.isKnown(base.ecg.type)) issues.push('ecg type not in the rhythm registry: ' + base.ecg.type);
      e().dispatch({ type: 'LOAD_SCENARIO', payload: sc });
      await sleep(); await sleep();
      const v0 = e().state.vitals;
      if (RG.isPulseless(e().state.rhythm) && (v0.rr > 0 || v0.bpSys > 0 || v0.spO2 > 0)) issues.push(`starts pulseless with RR ${v0.rr}, BP ${v0.bpSys}, SpO2 ${v0.spO2}`);
      e().start(); await sleep();
      const keys = Object.keys(window.INTERVENTIONS);
      const give = ['Obs', 'Oxygen', 'IV Access', 'Fluids', keys[(i * 7) % keys.length], keys[(i * 13 + 5) % keys.length]];
      for (let t = 0; t < 120; t++) {
        if (t % 30 === 0 && give.length) e().applyIntervention(give.shift());
        e().dispatch({ type: 'TICK_TIME' });
        if (t % 10 === 0) await sleep();
      }
      await sleep(); await sleep();
      const s = e().state, v = s.vitals;
      Object.keys(v).forEach(k => {
        if (typeof v[k] === 'number' && !Number.isFinite(v[k])) issues.push(`vital ${k} = ${v[k]}`);
        if (v[k] === undefined || v[k] === null) issues.push(`vital ${k} missing`);
      });
      if (v.spO2 < 0 || v.spO2 > 100) issues.push('SpO2 ' + v.spO2);
      if (v.hr < 0 || v.hr > 300) issues.push('HR ' + v.hr);
      if (v.bpSys < 0 || v.bpSys > 300 || v.bpDia > v.bpSys + 1) issues.push(`BP ${v.bpSys}/${v.bpDia}`);
      if (!RG.isKnown(s.rhythm)) issues.push('unknown rhythm ' + s.rhythm);
      if (RG.isPulseless(s.rhythm) && v.bpSys > 0) issues.push('BP in pulseless ' + s.rhythm);
      (s.log || []).forEach(l => { if (/content bug|Unknown intervention|not in the rhythm registry|\bNaN\b|\bundefined\b/.test(l.msg)) issues.push('log: ' + l.msg.slice(0, 140)); });
      e().pause();
      return issues.length ? `${base.id} ${base.title}: ${issues.join('; ')}` : null;
    }, i);
    if (r) problems.push(r);
  }
  expect(problems).toEqual([]);
  expect(errors).toEqual([]);
});

test('the Premade flow starts a scenario, and a cardiac arrest starts with arrest observations', async ({ page }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await startPremade(page, 'Cardiac Arrest', 'Adult - PEA Arrest');
  await expect.poll(() => live(page, code, '/rhythm')).toBe('PEA');
  const v = await live(page, code, '/vitals');
  expect(v).toMatchObject({ rr: 0, bpSys: 0, bpDia: 0, spO2: 0, gcs: 3, pupils: 'Dilated' });
  expect(errors).toEqual([]);
});

test('adenosine escalates 6, 12, then 18 mg (RCUK)', async ({ page }) => {
  await openController(page);
  await startPremade(page, 'Adult Medical', 'SVT (Adult)');
  for (let i = 0; i < 3; i++) {
    await engine(page, 'sim.applyIntervention("Adenosine")');
    await expect.poll(() => engine(page, 'return sim.state.interventionCounts.Adenosine || 0')).toBe(i + 1);
  }
  const doses = await engine(page, 'return sim.state.log.map(l => l.msg).filter(m => /^Adenosine \\d+ mg given/.test(m)).map(m => Number(m.match(/\\d+/)[0]))');
  expect(doses).toEqual([6, 12, 18]);
});

test('adrenaline improves anaphylaxis but not ACE-inhibitor (bradykinin) angio-oedema', async ({ page }) => {
  trackErrors(page);   // accepts the Finish confirmation
  await openController(page);
  await startPremade(page, 'Adult Medical', 'Anaphylaxis (Adult)');
  await engine(page, 'sim.applyIntervention("AdrenalineIM")');
  await expect.poll(() => engine(page, 'return !!(sim.state.trends && sim.state.trends.active)')).toBe(true);

  await page.getByRole('button', { name: 'Finish' }).click();
  await page.getByRole('button', { name: 'Exit to Menu' }).click();
  await startPremade(page, 'Adult Medical', 'ACE-Inhibitor Angio-oedema');
  await engine(page, 'sim.applyIntervention("AdrenalineIM")');
  await page.waitForTimeout(500);
  expect(await engine(page, 'return !!(sim.state.trends && sim.state.trends.active)')).toBe(false);
});
