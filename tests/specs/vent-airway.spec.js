// The ventilator and the patient's airway (16 Oct 2026): an awake patient with no airway is on a face mask,
// so only noninvasive modes suit them (in other modes they fight the ventilator and the mask leaks); an
// unconscious patient with no airway recorded is assumed to have a tube. data/engine-vent.js interfaceFor,
// vent/index.html (leakK, fightChance, physNow, updatePtNote).
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, expandSection, live, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const logHas = (page, re) => page.evaluate((src) => window.__simEngine.state.log.some(l => new RegExp(src).test(l.msg)), re.source);
const eng = (page, fn, arg) => page.evaluate(fn, arg);
const setGcs = (page, v) => eng(page, (g) => window.__simEngine.dispatch({ type: 'MANUAL_VITAL_UPDATE', payload: { key: 'gcs', value: g } }), v);

async function openVent(context, code, file = 'index.html') {
  const vent = await context.newPage();
  const errors = trackErrors(vent);
  await vent.goto(`/vent/${file}?session=${code}`);
  await expect(vent.locator('#linkBanner')).toBeHidden({ timeout: 10000 });
  return { vent, errors };
}
async function startVentilating(dev) {
  await dev.locator('#kPower').click();
  await expect(dev.getByRole('button', { name: 'Start ventilation' })).toBeVisible({ timeout: 10000 });
  await dev.locator('#kPower').click();
}
const phys = (vent) => vent.evaluate(() => window.__vent.ventStateNow().phys);

test('the controller works out the airway: awake and no airway is a mask; unconscious assumes a tube; recorded and facilitator choices win', async ({ page }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  // Quick Sim's patient: GCS 15, no airway
  await expect.poll(() => live(page, code, '/vent/airway')).toBe('maskA');
  await setGcs(page, 8);
  await expect.poll(() => live(page, code, '/vent/airway')).toBe('tube');
  await setGcs(page, 14);
  await expect.poll(() => live(page, code, '/vent/airway')).toBe('maskA');
  // An i-gel recorded on an awake patient: 'sgaA' (awake, they fight machine breaths)
  await eng(page, () => window.__simEngine.dispatch({ type: 'UPDATE_INTERVENTION_STATE', payload: { add: ['i-gel'] } }));
  await expect.poll(() => live(page, code, '/vent/airway')).toBe('sgaA');
  // Paralysed: not awake, not breathing
  const cfg = await eng(page, () => { const s = { ...window.__simEngine.state, isParalysed: true }; return [window.VENT_ENGINE.airwayCode(s), window.VENT_ENGINE.configFor(s).breathing]; });
  expect(cfg).toEqual(['sga', false]);
  // The facilitator's Airway choice wins
  await expandSection(page, 'vent');
  await page.getByLabel('Ventilator airway').selectOption('tube');
  await expect.poll(() => live(page, code, '/vent/airway')).toBe('tubeA');
  expect(await logHas(page, /^Ventilator airway: Tube \(facilitator\)/)).toBe(true);
  await page.getByLabel('Ventilator airway').selectOption('auto');
  await expect.poll(() => live(page, code, '/vent/airway')).toBe('sgaA');
  expect(errors).toEqual([]);
});

test('an awake patient with no airway: NIV works on the mask; an invasive mode is fought, leaks and is logged', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  // Even with lungs that are usually sedated (ARDS), an awake patient breathes for themselves
  await expandSection(page, 'vent');
  await page.getByLabel('Ventilator lungs').selectOption('ards');
  const { vent, errors: ventErrors } = await openVent(context, code);
  await expect.poll(() => vent.evaluate(() => [window.__vent.P.iface, window.__vent.P.awake, window.__vent.P.pr.sedated])).toEqual(['mask', true, false]);
  await startVentilating(vent);
  await expect.poll(() => vent.evaluate(() => window.__vent.ventStateNow().state)).toBe('ventilating');
  // NIV-ST on a mask: the mode a mask suits. Nothing fought, no note.
  await vent.waitForTimeout(8000);
  let p = await phys(vent);
  expect(p.mask).toBe(1);
  expect(p.mw).toBe(0);
  expect(p.fight).toBe(0);
  await expect(vent.locator('#ptNote')).toBeHidden();

  // (S)CMV+ on the same mask: the patient fights it and the mask leaks
  await vent.evaluate(() => { window.__vent.V.mode = 'APVcmv'; });
  await expect.poll(async () => (await phys(vent)).mw).toBe(1);
  await expect.poll(async () => (await phys(vent)).fight, { timeout: 40000 }).toBeGreaterThan(0);
  await expect.poll(() => vent.evaluate(() => window.__vent.M.vleak)).toBeGreaterThan(0);
  await expect(vent.locator('#ptNote')).toBeVisible();
  await expect(vent.locator('#ptNote')).toContainText('awake, no airway');
  await expect.poll(() => logHas(page, /^Awake patient with no airway, on a face mask/)).toBe(true);

  // Assessment mode: a real ventilator says nothing about the patient
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_VENT_CONFIG', payload: { assess: true } }));
  await expect(vent.locator('#ptNote')).toBeHidden({ timeout: 5000 });
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_VENT_CONFIG', payload: { assess: false } }));

  // The airway is secured (unconscious after induction): a tube, nothing fought, no leak
  await setGcs(page, 3);
  await expect.poll(() => vent.evaluate(() => [window.__vent.P.iface, window.__vent.P.awake])).toEqual(['tube', false]);
  await expect.poll(async () => (await phys(vent)).mw).toBe(0);
  await expect.poll(async () => (await phys(vent)).fight, { timeout: 40000 }).toBe(0);
  await expect(vent.locator('#ptNote')).toBeHidden();
  expect(errors).toEqual([]);
  expect(ventErrors).toEqual([]);
});

test('the breath engine: a mask leaks more off NIV, a tube does not leak, an i-gel leaks above its seal, and only a breathing patient fights', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  const { vent } = await openVent(context, code);
  await expect.poll(() => vent.evaluate(() => window.__vent.P.iface)).toBe('mask');
  const r = await vent.evaluate(() => {
    const { V, P } = window.__vent;
    const out = {};
    V.mode = 'NIV-ST'; out.maskNiv = [window.__vent.leakK(), window.__vent.fightChance('mand')];
    V.mode = 'APVcmv'; out.maskInv = [window.__vent.leakK(), window.__vent.fightChance('mand'), window.__vent.fightChance('amand')];
    P.iface = 'tube'; P.awake = false; out.tube = [window.__vent.leakK(), window.__vent.fightChance('mand')];
    P.awake = true; out.tubeAwake = [window.__vent.fightChance('mand'), window.__vent.fightChance('amand')];
    P.iface = 'sga'; out.sga = [window.__vent.leakK(), window.__vent.sgaOver(20), window.__vent.sgaOver(32)];
    P.apnoea = true; out.apnoeic = window.__vent.fightChance('mand'); P.apnoea = false;
    P.iface = 'mask'; P.awake = false; V.mode = 'APVcmv'; out.maskAsleep = [window.__vent.leakK(), window.__vent.fightChance('mand')];
    P.awake = true;
    return out;
  });
  expect(r.maskNiv[0]).toBeGreaterThan(0);
  expect(r.maskNiv[1]).toBe(0);
  expect(r.maskInv[0]).toBeGreaterThan(r.maskNiv[0]);
  expect(r.maskInv[1]).toBeGreaterThan(r.maskInv[2]);
  expect(r.maskInv[2]).toBeGreaterThan(0);
  expect(r.tube).toEqual([0, 0]);
  expect(r.tubeAwake[0]).toBeGreaterThan(0);
  expect(r.tubeAwake[1]).toBe(0);
  expect(r.sga).toEqual([0, 0, 7]);
  expect(r.apnoeic).toBe(0);
  // a mask the facilitator put on an unconscious patient: it leaks, but nobody fights
  expect(r.maskAsleep[0]).toBeGreaterThan(0);
  expect(r.maskAsleep[1]).toBe(0);
});

test('the controller turns fighting into distress: HR and BP rise with the share of breaths fought', async ({ page }) => {
  await openController(page);
  await startQuickSim(page);
  const r = await page.evaluate(() => {
    const VE = window.VENT_ENGINE, cur = window.__simEngine.state;
    const drv = (fight) => ({ phys: { on: 1, conn: 1, fio2: 0.5, peep: 5, r: 1, rr: 16, autopeep: 0, inv: 1, fight } });
    const calm = VE.step(null, drv(0), cur, cur.vitals).offsets;
    const fought = VE.step(null, drv(1), cur, cur.vitals).offsets;
    return { hr: fought.hr - calm.hr, sys: fought.bpSys - calm.bpSys, dia: fought.bpDia - calm.bpDia };
  });
  expect(r).toEqual({ hr: 20, sys: 15, dia: 8 });
});

test('the anaesthetic machine: Man/Spon and CPAP/PSV suit a mask, volume control does not', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_VENT_CONFIG', payload: { model: 'a350' } }));
  const { vent, errors } = await openVent(context, code, 'a350.html');
  await expect.poll(() => vent.evaluate(() => window.__vent.P.iface)).toBe('mask');
  const r = await vent.evaluate(() => {
    const { V } = window.__vent;
    const out = {};
    ['MAN', 'SPONT', 'SCMV', 'PCV+'].forEach(m => { V.mode = m; out[m] = window.__vent.maskWrong(); });
    V.mode = 'MAN';
    return out;
  });
  expect(r).toEqual({ MAN: false, SPONT: false, SCMV: true, 'PCV+': true });
  expect(await page.evaluate(() => window.VENT_ENGINE.maskModes('a350'))).toEqual(['MAN', 'SPONT']);
  expect(errors).toEqual([]);
});
