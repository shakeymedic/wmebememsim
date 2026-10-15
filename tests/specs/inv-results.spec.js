// What the investigation buttons on the patient monitor give: the facilitator's choice of result for
// each investigation (data/screens/invresults.js, INVESTIGATIONS.setResult), in Quick Sim, a premade
// scenario, Defib Sim and the Builder, before START and during the run.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, pressStart, expandSection, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

async function openMonitor(context, code) {
  const monitor = await context.newPage();
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  { const snd = monitor.getByText('Tap to Enable Sound'); if (await snd.count()) await snd.click({ force: true }); }
  await expect(monitor.getByText('Tap to Enable Sound')).toHaveCount(0);
  return monitor;
}
async function loadScenario(page, id) {
  await page.evaluate((id) => {
    const base = window.ALL_SCENARIOS.find(s => s.id === id);
    window.__simEngine.dispatch({ type: 'LOAD_SCENARIO', payload: base });
  }, id);
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.scenario && window.__simEngine.state.scenario.id)).toBe(id);
}
// Press an investigation button on the room monitor and return the result card
async function press(monitor, name) {
  const close = monitor.getByTestId('inv-result-close');
  if (await close.isVisible()) await close.click();
  await monitor.getByRole('button', { name, exact: true }).click();
  return monitor.getByTestId('inv-result');
}

test('setResult changes a result and Undo restores the scenario exactly', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.INVESTIGATIONS && window.ALL_SCENARIOS && window.ALL_SCENARIOS.length > 0);
  const r = await page.evaluate(() => {
    const I = window.INVESTIGATIONS;
    const base = window.ALL_SCENARIOS.find(s => s.id === 'AM031');
    const quick = window.buildQuickSimScenario ? window.buildQuickSimScenario({ age: 40 }) : { ecg: { type: 'Sinus Rhythm' }, chestXray: null, investigations: null, vbg: window.generateVbg('normal') };
    const out = {};
    for (const [name, sc] of [['premade', base], ['quick', quick]]) {
      let s = sc;
      s = I.setResult(s, 'X-ray', { findingId: 'cxr-pneumonia' });
      s = I.setResult(s, 'CT', { text: 'My CT report' });
      s = I.setResult(s, 'VBG', { vbg: { pH: 7.05, pCO2: 8, pO2: 5, HCO3: 18, BE: -8, Lac: 4, K: 6.8, Glu: 9 } });
      s = I.setResult(s, 'Urine', { urine: 'uti' });
      s = I.setResult(s, 'POCUS', { pocus: 'tamponade' });
      s = I.setResult(s, 'ECG', { findingId: 'ecg-stemi-inferior' });
      const now = Object.fromEntries(I.RESULT_TYPES.map(t => [t, I.currentResult(s, t, 'Sinus Rhythm')]));
      let back = s;
      I.RESULT_TYPES.forEach(t => { back = I.setResult(back, t, null); });
      // Same keys and values (key order aside), apart from the bookkeeping
      const canon = (v) => Array.isArray(v) ? v.map(canon) : (v && typeof v === 'object') ? Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {}) : v;
      const strip = (x) => { const c = Object.assign({}, x); delete c.invDefaults; delete c.invChanged; return JSON.stringify(canon(c)); };
      const diff = Object.keys(Object.assign({}, sc, back)).filter(k => k !== 'invDefaults' && k !== 'invChanged' && JSON.stringify(canon(sc[k])) !== JSON.stringify(canon(back[k])));
      out[name] = { now, diff, restored: strip(back) === strip(sc), changed: Object.keys(back.invChanged || {}), before: Object.fromEntries(I.RESULT_TYPES.map(t => [t, I.currentResult(sc, t, 'Sinus Rhythm').text])) };
    }
    return out;
  });
  for (const name of ['premade', 'quick']) {
    const x = r[name];
    expect(x.now['X-ray'].image, name).toBe('cxr-pneumonia');
    expect(x.now['X-ray'].changed, name).toBe(true);
    expect(x.now.CT.text, name).toBe('My CT report');
    expect(x.now.VBG.text, name).toMatch(/pH 7\.05.*K\+ 6\.8/);
    expect(x.now.Urine.text, name).toMatch(/Nitrites: \+/);
    expect(x.now.POCUS.text, name).toMatch(/pericardial effusion/i);
    expect(x.now.ECG.image, name).toBe('ecg-stemi-inferior');
    expect(x.diff, `${name} restored exactly`).toEqual([]);
    expect(x.restored, `${name} restored exactly`).toBe(true);
    expect(x.changed, name).toEqual([]);
  }
  // Untouched, the premade scenario keeps its own tension pneumothorax
  expect(r.premade.before['X-ray']).toMatch(/large right pneumothorax/);
});

test('Quick Sim: change the CXR before START; the monitor CXR button gives it; Undo goes back', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  const monitor = await context.newPage();
  const monErrors = trackErrors(monitor);
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  // Before START the patient screen waits, blank
  await expect(monitor.getByTestId('waiting-for-start')).toBeVisible({ timeout: 15000 });

  // Untouched, nothing changes: the default result
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  expect(await monitor.evaluate(() => (window.__monitorEngine.state.scenario.chestXray || {}).image || null)).toBe(null);

  await expandSection(page, 'quickInvResults');
  const row = page.getByTestId('inv-result-row-X-ray');
  await expect(row).toContainText('Lung fields clear.');
  await row.getByRole('button', { name: 'Change the X-ray result' }).click();
  const dlg = page.getByTestId('inv-result-editor');
  await dlg.getByTestId('inv-editor-library').getByRole('button', { name: /Tension pneumothorax/ }).click();
  await expect(dlg).toHaveCount(0);
  await expect(row.getByTestId('inv-result-changed')).toBeVisible();
  await expect(row).toContainText('Tension pneumothorax (right)');
  // Choosing sends nothing to the monitor (the room monitor only has the new result to hand)
  await expect.poll(() => monitor.evaluate(() => (window.__monitorEngine.state.scenario.chestXray || {}).image)).toBe('cxr-ptx-tension');
  await pressStart(page);
  await monitor.getByText('Tap to Enable Sound').click({ force: true });
  await expect(monitor.getByText('Tap to Enable Sound')).toHaveCount(0);
  await expect(monitor.getByTestId('inv-result')).not.toContainText('pneumothorax');

  let card = await press(monitor, 'CXR');
  await expect(card.getByTestId('inv-image')).toHaveAttribute('src', 'images/investigations/cxr-ptx-tension.jpg');
  await expect(card).toContainText('large right pneumothorax');

  // The log says what was chosen
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.log.map(l => l.msg).join('|'))).toContain('X-ray result set: Tension pneumothorax (right)');

  await row.getByRole('button', { name: 'Undo the X-ray change' }).click();
  await expect(row.getByTestId('inv-result-changed')).toHaveCount(0);
  await expect.poll(() => monitor.evaluate(() => (window.__monitorEngine.state.scenario.chestXray || {}).image || null)).toBe(null);
  card = await press(monitor, 'CXR');
  await expect(card).toContainText('Lung fields clear.');
  await expect(card.getByTestId('inv-image')).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(monErrors).toEqual([]);
});

test('premade scenario: typed VBG and own CT report reach the monitor buttons; Scenario Finding sends the change', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  await loadScenario(page, 'AM020');   // subarachnoid haemorrhage
  await pressStart(page);
  const monitor = await openMonitor(context, code);
  await page.getByRole('button', { name: 'Investigations', exact: true }).click();
  const panel = page.getByTestId('inv-results-panel');
  await expect(panel.getByTestId('inv-result-row-CT')).toContainText('subarachnoid');

  // VBG: typed values
  await panel.getByRole('button', { name: 'Change the VBG result' }).click();
  const dlg = page.getByTestId('inv-result-editor');
  await dlg.getByTestId('vbg-pH').fill('7.05');
  await dlg.getByTestId('vbg-K').fill('6.8');
  await dlg.getByRole('button', { name: 'Use these values' }).click();
  await expect(panel.getByTestId('inv-result-row-VBG')).toContainText('pH 7.05');
  // An impossible value is refused
  await panel.getByRole('button', { name: 'Change the VBG result' }).click();
  await dlg.getByTestId('vbg-pH').fill('9.5');
  await expect(dlg.getByRole('button', { name: 'Use these values' })).toBeDisabled();
  await dlg.getByRole('button', { name: 'Cancel' }).click();

  // CT: the facilitator's own report
  await panel.getByRole('button', { name: 'Change the CT result' }).click();
  await dlg.getByTestId('inv-editor-text').fill('CT head: no bleed seen.');
  await dlg.getByRole('button', { name: 'Use this report' }).click();

  await expect.poll(() => monitor.evaluate(() => (window.__monitorEngine.state.scenario.ct || {}).findings)).toBe('CT head: no bleed seen.');
  let card = await press(monitor, 'VBG');
  await expect(card.getByTestId('vbg-grid')).toContainText('pH: 7.05');
  await expect(card.getByTestId('vbg-grid')).toContainText('K+: 6.8');
  card = await press(monitor, 'CT Head');
  await expect(card).toContainText('CT head: no bleed seen.');
  await expect(card.getByTestId('inv-image')).toHaveCount(0);

  // The controller's own "Scenario Finding" send gives the changed result too
  await page.getByRole('button', { name: 'Send CT' }).click();
  await expect(page.getByRole('dialog').getByTestId('inv-scenario-preview')).toContainText('no bleed seen');
  await page.getByRole('dialog').getByRole('button', { name: 'Scenario Finding' }).click();
  await expect(monitor.getByTestId('inv-result')).toContainText('CT head: no bleed seen.');

  // A resumed run keeps the change (it lives on the scenario)
  const kept = await page.evaluate(() => window.rehydrateScenario(JSON.parse(JSON.stringify(window.__simEngine.state.scenario))));
  expect(kept.ct.findings).toBe('CT head: no bleed seen.');
  expect(Object.keys(kept.invChanged).sort()).toEqual(['CT', 'VBG']);
  expect(errors).toEqual([]);
});

test('a chosen pneumothorax is re-expanded by needle decompression like the scenario one', async ({ page }) => {
  await openController(page);
  await startQuickSim(page);
  await page.evaluate(() => {
    const I = window.INVESTIGATIONS;
    window.__simEngine.dispatch({ type: 'UPDATE_SCENARIO', payload: I.setResult(window.__simEngine.state.scenario, 'X-ray', { findingId: 'cxr-ptx-simple' }) });
  });
  await page.evaluate(() => window.__simEngine.start());
  await page.evaluate(() => window.__simEngine.applyIntervention('Needle'));
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.scenario.chestXray.findings)).toBe('Lung re-expanded after decompression.');
  expect(await page.evaluate(() => Object.keys(window.__simEngine.state.scenario.invChanged || {}))).toEqual([]);
});

test('Defib Sim: the investigation results section changes what the monitor gives', async ({ page, context }) => {
  const code = await openController(page);
  await page.getByRole('button', { name: 'Defib Sim', exact: true }).click();
  await page.locator('[data-defib-scenario="vf-arrest"]').click();
  await page.getByRole('button', { name: 'Start Defib Sim' }).click();
  await expandSection(page, 'defibInvResults');
  await page.getByRole('button', { name: 'Change the Urine result' }).click();
  await page.getByTestId('inv-result-editor').getByRole('button', { name: 'UTI (leucocytes, nitrites)' }).click();
  await pressStart(page);
  const monitor = await openMonitor(context, code);
  await expect.poll(() => monitor.evaluate(() => (window.__monitorEngine.state.scenario.urine || {}).nitrites)).toBe('+');
  const card = await press(monitor, 'Urine');
  await expect(card).toContainText('Nitrites: +');
});

test('Builder: chosen results are saved with the scenario and given by the monitor when it runs', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await page.getByTestId('mode-custom').click();
  await page.getByRole('button', { name: 'Builder', exact: true }).click();
  await page.getByPlaceholder('Scenario Title').fill('Thunderclap headache');
  const box = page.getByTestId('builder-inv-results');
  await expect(box.getByTestId('inv-result-row-CT')).toContainText('Default for this scenario.');
  await box.getByRole('button', { name: 'Change the CT result' }).click();
  await page.getByTestId('inv-result-editor').getByTestId('inv-editor-library').getByRole('button', { name: 'Subarachnoid haemorrhage' }).click();
  await expect(box.getByTestId('inv-result-row-CT')).toContainText('Subarachnoid haemorrhage');
  await page.getByRole('button', { name: 'Run without saving' }).click();
  await page.getByRole('button', { name: 'Start Scenario' }).click();

  await expect.poll(() => page.evaluate(() => window.__simEngine && window.__simEngine.state.scenario && window.__simEngine.state.scenario.ct && window.__simEngine.state.scenario.ct.image)).toBe('ct-sah');
  await page.getByRole('button', { name: 'Investigations', exact: true }).click();
  await expect(page.getByTestId('inv-result-row-CT').getByTestId('inv-result-changed')).toBeVisible();
  await pressStart(page);
  const monitor = await openMonitor(context, code);
  await expect.poll(() => monitor.evaluate(() => (window.__monitorEngine.state.scenario.ct || {}).image)).toBe('ct-sah');
  const card = await press(monitor, 'CT Head');
  await expect(card.getByTestId('inv-image')).toHaveAttribute('src', 'images/investigations/ct-sah.jpg');
  expect(errors).toEqual([]);
});

test('briefing: a premade scenario\'s result can be changed before the run starts', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
  await page.getByRole('button', { name: 'Adult Medical', exact: true }).click();
  await page.locator('div.justify-between', { hasText: 'Subarachnoid Haemorrhage' }).first().getByRole('button', { name: 'Load' }).click();
  await expandSection(page, 'briefingInvResults');
  const row = page.getByTestId('inv-result-row-CT');
  await expect(row).toContainText('subarachnoid');
  await row.getByRole('button', { name: 'Change the CT result' }).click();
  await page.getByTestId('inv-result-editor').getByTestId('inv-editor-library').getByRole('button', { name: 'Normal CT head' }).click();
  await expect(row).toContainText('Normal CT head');
  await page.getByRole('button', { name: 'Start Scenario' }).click();
  // On the controller it shows as changed, and the monitor's CT Head button gives it
  await page.getByRole('button', { name: 'Investigations', exact: true }).click();
  await expect(page.getByTestId('inv-result-row-CT').getByTestId('inv-result-changed')).toBeVisible();
  await pressStart(page);
  const monitor = await openMonitor(context, code);
  await expect.poll(() => monitor.evaluate(() => (window.__monitorEngine.state.scenario.ct || {}).image)).toBe('ct-normal-head');
  const card = await press(monitor, 'CT Head');
  await expect(card).toContainText('no acute intracranial abnormality');
  expect(errors).toEqual([]);
});
