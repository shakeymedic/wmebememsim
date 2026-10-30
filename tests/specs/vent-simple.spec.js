// Simple mode on the ventilator: the facilitator's Full / Simple switch (Ventilator section) makes the
// ventilator screens show big buttons for the common modes, with large − and + for the main settings,
// on the same breath engine. It rides in live.defib (ventSimple), so no database-rules change.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, expandSection, live, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const logHas = (page, re) => page.evaluate((src) => window.__simEngine.state.log.some(l => new RegExp(src).test(l.msg)), re.source);
const ventNow = (vent) => vent.evaluate(() => ({ mode: window.__vent.V.mode, ps: window.__vent.V.set.ps, peep: window.__vent.V.set.peep, state: window.__vent.ventStateNow().state }));

async function openVent(context, code, viewport) {
  const vent = await context.newPage();
  if (viewport) await vent.setViewportSize(viewport);
  const errors = trackErrors(vent);
  await vent.goto(`/vent/index.html?session=${code}`);
  await expect(vent.locator('#linkBanner')).toBeHidden({ timeout: 10000 });
  return { vent, errors };
}

test('the facilitator turns simple mode on; the big buttons pick and start the modes and change the settings', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  const { vent, errors: ventErrors } = await openVent(context, code);
  await expect(vent.locator('#simpleVent')).toBeHidden();

  await expandSection(page, 'vent');
  const sw = page.getByRole('group', { name: 'Ventilator screen: full or simple' });
  await sw.getByRole('button', { name: 'Simple' }).click();
  await expect.poll(() => live(page, code, '/defib/ventSimple')).toBe(true);
  await expect(vent.locator('#simpleVent')).toBeVisible();
  // drawn on the ventilator's own screen: the housing stays
  await expect(vent.locator('#screen #simpleVent')).toBeVisible();
  await expect(vent.locator('#kPower')).toBeVisible();
  expect(await logHas(page, /^Ventilator: simple mode/)).toBe(true);

  // Quick Sim's patient is awake on a mask: CPAP is NIV with no pressure support; from Off it powers on and starts
  await vent.getByRole('button', { name: /^CPAP/ }).click();
  await expect.poll(() => ventNow(vent), { timeout: 15000 }).toMatchObject({ mode: 'NIV', ps: 0, state: 'ventilating' });
  await expect(vent.locator('#svMode')).toHaveText('CPAP');
  await expect(vent.getByRole('button', { name: /^CPAP/ })).toHaveAttribute('aria-pressed', 'true');
  // no pressure-support control in CPAP; PEEP up by one with the big +
  await expect(vent.getByRole('button', { name: 'ΔPsupport up' })).toHaveCount(0);
  const peep = (await ventNow(vent)).peep;
  await vent.getByRole('button', { name: 'PEEP/CPAP up' }).click();
  await expect.poll(async () => (await ventNow(vent)).peep).toBe(peep + 1);
  await expect.poll(() => logHas(page, /^Ventilator: Setting changed: PEEP\/CPAP/)).toBe(true);

  // NIV gets its pressure support back, and the screen says what IPAP comes to
  await vent.getByRole('button', { name: /^NIV BiPAP/ }).click();
  await expect.poll(() => ventNow(vent)).toMatchObject({ mode: 'NIV', state: 'ventilating' });
  expect((await ventNow(vent)).ps).toBeGreaterThan(0);
  await expect(vent.locator('#svNote')).toContainText('Inspiratory pressure (IPAP)');

  await vent.getByRole('button', { name: /^PSIMV/ }).click();
  await expect.poll(() => ventNow(vent)).toMatchObject({ mode: 'PSIMV+', state: 'ventilating' });
  await expect(vent.getByRole('button', { name: 'Rate up' })).toBeVisible();

  // High-flow goes through Standby (as on the device) and starts again
  await vent.getByRole('button', { name: /^High-flow O2/ }).click();
  await expect.poll(() => ventNow(vent)).toMatchObject({ mode: 'HiFlowO2', state: 'ventilating' });

  await vent.getByRole('button', { name: 'Standby', exact: true }).click();
  await expect.poll(() => ventNow(vent)).toMatchObject({ state: 'standby' });
  await expect.poll(() => page.evaluate(() => Object.values(window.__simEngine.state.ventMirror || {}).map(m => m.state))).toContain('standby');

  // back to the full ventilator
  await sw.getByRole('button', { name: 'Full' }).click();
  await expect(vent.locator('#simpleVent')).toBeHidden();
  await expect(vent.locator('#device')).toBeVisible();
  expect(errors).toEqual([]);
  expect(ventErrors).toEqual([]);
});

test('simple mode on a tube: CPAP is SPONT with no support, and volume control is offered', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'MANUAL_VITAL_UPDATE', payload: { key: 'gcs', value: 3 } }));
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_VENT_CONFIG', payload: { simple: true } }));
  const { vent, errors } = await openVent(context, code);
  await expect(vent.locator('#simpleVent')).toBeVisible();
  await expect.poll(() => vent.evaluate(() => window.__vent.P.iface)).toBe('tube');
  await vent.getByRole('button', { name: /^CPAP/ }).click();
  await expect.poll(() => ventNow(vent), { timeout: 15000 }).toMatchObject({ mode: 'SPONT', ps: 0, state: 'ventilating' });
  await vent.getByRole('button', { name: /^Volume control/ }).click();
  await expect.poll(() => ventNow(vent)).toMatchObject({ mode: 'APVcmv', state: 'ventilating' });
  await expect(vent.getByRole('button', { name: 'Vt up' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('simple mode on a phone: the page zooms in on the ventilator screen, no sideways scroll', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_VENT_CONFIG', payload: { simple: true } }));
  const { vent, errors } = await openVent(context, code, { width: 390, height: 844 });
  await expect(vent.locator('#simpleVent')).toBeVisible();
  await vent.getByRole('button', { name: /^NIV BiPAP/ }).click();
  await expect.poll(() => ventNow(vent), { timeout: 15000 }).toMatchObject({ mode: 'NIV', state: 'ventilating' });
  expect(await vent.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const box = await vent.getByRole('button', { name: /^CPAP/ }).boundingBox();
  // the screen fills the width, so the buttons stay big enough to touch
  await expect(vent.locator('body')).toHaveClass(/simple-zoom/);
  const scr = await vent.locator('#screenbox').boundingBox();
  expect(scr.width).toBeGreaterThan(360);
  expect(box.width).toBeGreaterThan(60);
  expect(box.height).toBeGreaterThanOrEqual(34);
  await vent.screenshot({ path: test.info().outputPath('simple-phone.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('the ICU ventilator has simple mode too; the anaesthetic machine does not', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'MANUAL_VITAL_UPDATE', payload: { key: 'gcs', value: 3 } }));
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_VENT_CONFIG', payload: { simple: true, model: 'c6' } }));
  const vent = await context.newPage();
  const errors = trackErrors(vent);
  await vent.goto(`/vent/index.html?session=${code}`);
  await expect(vent).toHaveURL(/c6\.html/, { timeout: 10000 });
  await expect(vent.locator('#simpleVent')).toBeVisible();
  await vent.getByRole('button', { name: /^Volume control/ }).click();
  await expect.poll(() => ventNow(vent), { timeout: 15000 }).toMatchObject({ mode: 'SCMV', state: 'ventilating' });

  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_VENT_CONFIG', payload: { model: 'a350' } }));
  await expect(vent).toHaveURL(/a350\.html/, { timeout: 10000 });
  await expect(vent.locator('#simpleVent')).toBeHidden();
  await expandSection(page, 'vent');
  await expect(page.getByTestId('vent-simple')).toContainText('not the anaesthetic machine');
  expect(errors).toEqual([]);
});
