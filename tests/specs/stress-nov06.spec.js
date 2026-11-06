// Stress test (6 Nov 2026). Multi-device load: one controller driving four patient screens, the defib and
// both ventilators while the facilitator hammers the controls. Every screen must keep up, agree with
// the controller once things settle, throw no errors, and the controller must not flood the database.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, pressStart, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

async function openScreen(context, code, extra = '') {
  const p = await context.newPage();
  const errors = trackErrors(p);
  await p.goto(`/index.html?mode=monitor&session=${code}${extra}`);
  await expect.poll(() => p.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate)), { timeout: 20000 }).toBe(true);
  return { p, errors };
}
async function openDevice(context, url) {
  const p = await context.newPage();
  const errors = trackErrors(p);
  await p.goto(url);
  await expect(p.locator('#linkBanner')).toBeHidden({ timeout: 15000 });
  return { p, errors };
}
const screenState = (p) => p.evaluate(() => { const s = window.__monitorEngine.state; return { rhythm: s.rhythm, hr: s.vitals.hr, spO2: s.vitals.spO2, bpSys: s.vitals.bpSys }; });

test('load: controller + 4 screens + defib + two ventilators under 60 s of rapid facilitator input', async ({ page, context }) => {
  test.setTimeout(300000);
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  await page.evaluate(() => window.__simEngine.attachStandardMonitoring());
  await pressStart(page);

  const screens = [];
  for (let i = 0; i < 4; i++) screens.push(await openScreen(context, code));
  const defib = await openDevice(context, `/defib/index.html?session=${code}`);
  const t1 = await openDevice(context, `/vent/index.html?session=${code}`);
  const c6 = await openDevice(context, `/vent/c6.html?session=${code}`);

  const before = await page.evaluate(() => window.__fakeRtdb.writes().length);
  const t0 = Date.now();
  // 60 s of input: an intervention every ~150 ms, plus arrests, shocks, ROSC and obs changes
  await page.evaluate(async () => {
    const e = () => window.__simEngine, RG = window.RHYTHMS;
    const keys = Object.keys(window.INTERVENTIONS);
    let x = 12345; const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
    const end = Date.now() + 60000;
    while (Date.now() < end) {
      const r = rnd();
      if (r < 0.6) e().applyIntervention(keys[Math.floor(rnd() * keys.length)]);
      else if (r < 0.68) e().triggerArrest(rnd() < 0.5 ? 'VF' : 'Asystole');
      else if (r < 0.76 && RG.isPulseless(e().state.rhythm)) e().triggerROSC('Sinus Rhythm');
      else if (r < 0.82) e().deliverShock(150);
      else if (r < 0.9) e().dispatch({ type: 'TRIGGER_' + (rnd() < 0.5 ? 'IMPROVE' : 'DETERIORATE') });
      await new Promise(res => setTimeout(res, 150));
    }
    // End in a known state
    if (RG.isPulseless(e().state.rhythm)) e().triggerROSC('Sinus Rhythm');
  });
  const secs = (Date.now() - t0) / 1000;
  const writes = await page.evaluate(() => window.__fakeRtdb.writes());
  const mine = writes.slice(before);
  const bytes = mine.reduce((n, w) => n + JSON.stringify(w.value || '').length, 0);
  console.log(`controller writes in ${secs.toFixed(0)} s: ${mine.length} (${(mine.length / secs).toFixed(1)}/s), ~${Math.round(bytes / 1024)} KB`);

  // Settle, then every screen agrees with the controller
  await page.waitForTimeout(6000);
  const ctl = await page.evaluate(() => { const s = window.__simEngine.state; return { rhythm: s.rhythm, hr: s.vitals.hr, spO2: s.vitals.spO2, bpSys: s.vitals.bpSys }; });
  for (const s of screens) {
    await expect.poll(async () => (await screenState(s.p)).rhythm, { timeout: 15000 }).toBe(ctl.rhythm);
    const st = await screenState(s.p);
    expect(Math.abs(st.hr - ctl.hr), `screen HR ${st.hr} vs controller ${ctl.hr}`).toBeLessThanOrEqual(15);
  }
  // Rates: the patient keeps reaching the screens during rapid input (a debounce sent nothing at
  // all while presses came faster than every 500 ms), but the controller does not flood the database
  const liveWrites = mine.filter(w => /\/live/.test(w.path)).length;
  expect(liveWrites / secs, `${liveWrites} live writes in ${secs} s`).toBeGreaterThan(1);
  expect(mine.length / secs).toBeLessThan(10);
  for (const s of [...screens, defib, t1, c6]) expect(s.errors).toEqual([]);
  expect(errors).toEqual([]);
});

test('load: a screen that joins mid-arrest, and one that reloads, both catch up', async ({ page, context }) => {
  test.setTimeout(150000);
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  await page.evaluate(() => window.__simEngine.attachStandardMonitoring());
  await pressStart(page);
  const a = await openScreen(context, code);
  await page.evaluate(() => window.__simEngine.triggerArrest('VF'));
  await expect.poll(async () => (await screenState(a.p)).rhythm, { timeout: 15000 }).toBe('VF');
  const late = await openScreen(context, code);
  await expect.poll(async () => (await screenState(late.p)).rhythm, { timeout: 15000 }).toBe('VF');
  await page.evaluate(() => window.__simEngine.triggerROSC('Sinus Rhythm'));
  await a.p.reload();
  await expect.poll(() => a.p.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate)), { timeout: 20000 }).toBe(true);
  await expect.poll(async () => (await screenState(a.p)).rhythm, { timeout: 15000 }).toBe('Sinus Rhythm');
  await expect.poll(async () => (await screenState(late.p)).rhythm, { timeout: 15000 }).toBe('Sinus Rhythm');
  expect(a.errors.concat(late.errors, errors)).toEqual([]);
});

// NICE NG253 (adults with suspected sepsis): 250 ml boluses. Pregnancy keeps 500 ml (NG255), and
// other adult shock keeps the 500 ml crystalloid bolus.
test('fluid bolus volume follows the patient: 250 ml adult sepsis, 500 ml maternal sepsis and other adults', async ({ page }) => {
  await openController(page);
  await startQuickSim(page);
  const bolusLog = (id) => page.evaluate(async (id) => {
    const e = () => window.__simEngine;
    const base = window.ALL_SCENARIOS.find(s => s.id === id);
    e().dispatch({ type: 'LOAD_SCENARIO', payload: window.generatePatientFromTemplate(base, { showWetflag: true }) });
    await new Promise(r => setTimeout(r, 50));
    e().start(); await new Promise(r => setTimeout(r, 50));
    e().applyIntervention('IV Access'); e().applyIntervention('Fluids');
    await new Promise(r => setTimeout(r, 50));
    return (e().state.log.find(l => /Fluid Bolus \(/.test(l.msg)) || {}).msg;
  }, id);
  expect(await bolusLog('AM002')).toMatch(/250ml/);
  expect(await bolusLog('EL002')).toMatch(/250ml/);
  expect(await bolusLog('OB016')).toMatch(/500ml/);
  expect(await bolusLog('AM070')).toMatch(/500ml/);
});
