const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, session, live, expect } = require('./helpers');

// Engine rules, driven through the controller's engine and the device-event queue

const eng = (page, fn, arg) => page.evaluate(([f, a]) => new Function('E', 'arg', f)(window.__simEngine, a), [fn, arg]);
const st = (page, expr) => page.evaluate(e => new Function('S', 'return ' + e)(window.__simEngine.state), expr);

// A shock from the device, as the defib page sends it (via sessions/<CODE>/deviceEvents)
async function deviceEvent(page, code, type, payload) {
  await page.evaluate(([c, t, p]) => window.firebase.database().ref(`sessions/${c}/deviceEvents`).push({ type: t, payload: p, ts: Date.now(), from: 'test', device: 'standalone-defib' }), [code, type, payload]);
}
// The engine ignores a shock stacked within 5 s of the last one; tests clear that window
const unstack = page => eng(page, "E.dispatch({ type: 'SET_DEFIB_STATE', payload: { lastShockAt: null } })");

test.describe('Defibrillation and drug rules', () => {
  let errors, code;
  test.beforeEach(async ({ page, context }) => {
    await useFakeFirebase(context);
    errors = trackErrors(page);
    code = await openController(page);
    await startQuickSim(page);
    await page.getByRole('button', { name: /^START$/ }).click();
    await page.waitForFunction(() => window.__simEngine && window.__simEngine.state.isRunning);
  });
  test.afterEach(() => expect(errors).toEqual([]));

  test('the device offers the ZOLL R Series energies, 150 J recommended for an adult', async ({ page }) => {
    expect(await eng(page, 'return E.defibEnergySteps()')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30, 50, 75, 100, 120, 150, 200]);
    expect(await eng(page, 'return E.recommendedShockEnergy()')).toBe(150);
  });

  test('existing modes keep the probabilistic model by default', async ({ page }) => {
    expect(await st(page, 'S.defibSettings')).toEqual({ shockResponse: 'model', rOnT: 'never', refib: 'model' });
  });

  test('"auto": VF converts on the third adequate shock; under-powered shocks do not count', async ({ page }) => {
    await eng(page, "E.setDefibSettings({ shockResponse: 'auto', refib: 'off' }); E.triggerArrest('VF')");
    await expect.poll(() => st(page, 'S.rhythm')).toBe('VF');
    for (const j of [150, 120, 200]) {
      await unstack(page);
      await deviceEvent(page, code, 'SHOCK_DELIVERED', { energy: j, sync: false });
      await expect.poll(() => st(page, 'S.defib.shockCount')).toBeGreaterThan(0);
      await page.waitForTimeout(300);
    }
    expect(await st(page, 'S.defib.shockCount')).toBe(3);
    expect(await st(page, 'S.defib.episodeShocks')).toBe(2);
    expect(await st(page, 'S.rhythm')).toBe('VF');
    await unstack(page);
    await deviceEvent(page, code, 'SHOCK_DELIVERED', { energy: 150, sync: false });
    await expect.poll(() => st(page, 'RHYTHMS.isPulseless(S.rhythm)')).toBe(false);
    await expect.poll(() => live(page, code, '/defib/shockCount')).toBe(4);
  });

  test('"never": VF is refractory however many shocks are given', async ({ page }) => {
    await eng(page, "E.setDefibSettings({ shockResponse: 'never' }); E.triggerArrest('VF')");
    for (let i = 0; i < 5; i++) {
      await unstack(page);
      await eng(page, "E.deliverShock(200, 'test')");
      await page.waitForTimeout(100);
    }
    expect(await st(page, 'S.rhythm')).toBe('VF');
    expect(await st(page, 'S.defib.shockCount')).toBe(5);
  });

  test('an unsynchronised shock into a rhythm with a pulse causes VF when R-on-T is "always"', async ({ page }) => {
    await eng(page, "E.setDefibSettings({ rOnT: 'always' }); E.changeRhythm('SVT', 'test')");
    await eng(page, "E.deliverShock(100, 'test', { sync: false })");
    await expect.poll(() => st(page, 'S.rhythm')).toBe('VF');
    await eng(page, "E.setDefibSettings({ rOnT: 'never' }); E.changeRhythm('SVT', 'test')");
    await unstack(page);
    await eng(page, "E.deliverShock(100, 'test', { sync: false })");
    await page.waitForTimeout(300);
    expect(await st(page, 'S.rhythm')).toBe('SVT');
  });

  test('"auto": synchronised cardioversion needs at least 70 J', async ({ page }) => {
    await eng(page, "E.setDefibSettings({ shockResponse: 'auto' }); E.changeRhythm('SVT', 'test')");
    await eng(page, "E.deliverShock(50, 'test', { sync: true })");
    await page.waitForTimeout(300);
    expect(await st(page, 'S.rhythm')).toBe('SVT');
    await unstack(page);
    await eng(page, "E.deliverShock(75, 'test', { sync: true })");
    await expect.poll(() => st(page, 'S.rhythm')).toBe('Sinus Rhythm');
  });

  test('pacing: electrical capture at threshold, mechanical capture 10 mA above, and loss restores the patient', async ({ page }) => {
    await eng(page, "E.changeRhythm('Complete Heart Block', 'test')");
    await page.waitForTimeout(200);
    await eng(page, "E.dispatch({ type: 'UPDATE_VITALS', payload: { hr: 34, bpSys: 72, bpDia: 40 } })");
    await expect.poll(() => st(page, 'S.vitals.bpSys')).toBe(72);
    await deviceEvent(page, code, 'DEVICE_MODE', { mode: 'pacer' });
    await deviceEvent(page, code, 'PACER_UPDATE', { rate: 70, output: 50, demand: true });
    await page.waitForTimeout(400);
    expect(await st(page, 'S.rhythm')).toBe('Complete Heart Block');
    await deviceEvent(page, code, 'PACER_UPDATE', { rate: 70, output: 70, demand: true });
    await expect.poll(() => st(page, 'S.rhythm')).toBe('Paced');
    expect(await st(page, 'S.vitals.hr')).toBe(70);
    expect(await st(page, 'S.vitals.bpSys')).toBe(72);           // electrical only: no better yet
    await deviceEvent(page, code, 'PACER_UPDATE', { rate: 70, output: 80, demand: true });
    await expect.poll(() => st(page, 'S.pacing.mechanical')).toBe(true);
    expect(await st(page, 'S.vitals.bpSys')).toBeGreaterThanOrEqual(95);
    await deviceEvent(page, code, 'PACER_UPDATE', { rate: 70, output: 40, demand: true });
    await expect.poll(() => st(page, 'S.rhythm')).toBe('Complete Heart Block');
    expect(await st(page, 'S.vitals.hr')).toBe(34);
    expect(await st(page, 'S.vitals.bpSys')).toBe(72);
  });

  test('demand pacing is inhibited while the patient\'s own rate is faster', async ({ page }) => {
    await eng(page, "E.changeRhythm('Sinus Bradycardia', 'test')");
    await page.waitForTimeout(200);
    await eng(page, "E.dispatch({ type: 'UPDATE_VITALS', payload: { hr: 80 } })");
    await expect.poll(() => st(page, 'S.vitals.hr')).toBe(80);
    await deviceEvent(page, code, 'DEVICE_MODE', { mode: 'pacer' });
    await deviceEvent(page, code, 'PACER_UPDATE', { rate: 60, output: 100, demand: true });
    await page.waitForTimeout(400);
    expect(await st(page, 'S.rhythm')).toBe('Sinus Bradycardia');
  });

  test('atropine barely moves complete heart block; isoprenaline speeds the escape', async ({ page }) => {
    await eng(page, "E.changeRhythm('Complete Heart Block', 'test')");
    await page.waitForTimeout(200);
    await eng(page, "E.applyIntervention('IV Access')");
    await page.waitForTimeout(100);
    await eng(page, "E.applyIntervention('Atropine')");
    await page.waitForTimeout(100);
    await eng(page, "E.applyIntervention('Isoprenaline')");
    await expect.poll(() => st(page, 'S.activeDrugs.length')).toBeGreaterThanOrEqual(2);
    const hr = await st(page, "Object.fromEntries(S.activeDrugs.map(d => [d.key, d.effect.HR]))");
    expect(hr.Atropine).toBeLessThan(3);
    expect(hr.Isoprenaline).toBeGreaterThanOrEqual(20);
    // In sinus bradycardia atropine works fully
    await eng(page, "E.changeRhythm('Sinus Bradycardia', 'test')");
    await page.waitForTimeout(200);
    await eng(page, "E.applyIntervention('Atropine')");
    await expect.poll(() => st(page, "S.activeDrugs.filter(d => d.key === 'Atropine').length")).toBe(2);
    const doses = await st(page, "S.activeDrugs.filter(d => d.key === 'Atropine').map(d => d.effect.HR)");
    expect(doses[doses.length - 1]).toBe(12);
  });

  test('"auto" PEA: ROSC at the second rhythm check after adrenaline with CPR, never without adrenaline', async ({ page }) => {
    await eng(page, "E.setDefibSettings({ shockResponse: 'auto' }); E.triggerArrest('PEA'); E.toggleCPR(true)");
    await eng(page, 'E.nextCycle()'); await page.waitForTimeout(200);
    await eng(page, 'E.nextCycle()'); await page.waitForTimeout(200);
    expect(await st(page, 'S.rhythm')).toBe('PEA');
    await eng(page, "E.applyIntervention('IV Access')");
    await page.waitForTimeout(100);
    await eng(page, "E.applyIntervention('AdrenalineIV')");
    await page.waitForTimeout(200);
    await eng(page, 'E.nextCycle()'); await page.waitForTimeout(200);
    expect(await st(page, 'S.rhythm')).toBe('PEA');
    await eng(page, 'E.nextCycle()');
    await expect.poll(() => st(page, 'RHYTHMS.isPulseless(S.rhythm)')).toBe(false);
  });

  test('a converted tachycardia is shown at a sinus rate, not the old tachycardic rate', async ({ page }) => {
    await eng(page, "E.changeRhythm('SVT', 'test')");
    await expect.poll(() => st(page, 'S.vitals.hr')).toBeGreaterThan(150);
    for (let i = 0; i < 12 && (await st(page, 'S.rhythm')) === 'SVT'; i++) {
      await unstack(page);
      await eng(page, "E.deliverShock(150, 'test', { sync: true })");
      await page.waitForTimeout(250);
    }
    expect(await st(page, 'S.rhythm')).toBe('Sinus Rhythm');
    expect(await st(page, 'S.vitals.hr')).toBeLessThanOrEqual(100);
  });
});

test('the controller\'s defib panel changes the shock-response settings', async ({ page, context }) => {
  await useFakeFirebase(context);
  const errors = trackErrors(page);
  await openController(page);
  await startQuickSim(page);
  await page.getByRole('button', { name: /^Defib$/ }).click();
  const panel = page.locator('label', { hasText: 'Converts' }).locator('select');
  await panel.selectOption('3');
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.defibSettings.shockResponse)).toBe('3');
  await page.locator('label', { hasText: 'Unsync shock with a pulse' }).locator('select').selectOption('always');
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.defibSettings.rOnT)).toBe('always');
  expect(errors).toEqual([]);
});
