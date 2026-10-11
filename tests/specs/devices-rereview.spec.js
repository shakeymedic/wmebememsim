// Fixes from the second full review of the devices (11 Oct 2026): a power press before the session's
// data arrives is kept, the ventilator goes quiet when the session ends, the room monitor says when it
// has no controller.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

test('a ventilator switched on before the session data arrives stays on', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  await expect.poll(() => page.evaluate(c => !!window.__fakeRtdb.get(`sessions/${c}/live`), code)).toBe(true);
  // A tablet on a code with no data yet (as on a slow network): the power key is pressed first.
  const vent = await context.newPage();
  const errors = trackErrors(vent);
  await vent.goto('/vent/index.html?session=LATE42');
  await vent.locator('#kPower').click();
  await expect.poll(() => vent.evaluate(() => window.__vent.ventStateNow().state)).not.toBe('off');
  // Then the session's data arrives.
  await page.evaluate(c => window.__fakeRtdb.set('sessions/LATE42/live', window.__fakeRtdb.get(`sessions/${c}/live`)), code);
  await vent.waitForTimeout(3000);
  expect(await vent.evaluate(() => window.__vent.ventStateNow().state)).not.toBe('off');
  expect(errors).toEqual([]);
});

test('the ventilator is silenced and dimmed when the controller finishes the session', async ({ page, context }) => {
  trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  const vent = await context.newPage();
  await vent.goto(`/vent/index.html?session=${code}`);
  await expect(vent.locator('#endedBanner')).toBeHidden();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(vent.locator('#endedBanner')).toBeVisible({ timeout: 10000 });
  const box = await vent.locator('#endedBanner').boundingBox();
  expect(box.width).toBeGreaterThan(600);   // the whole machine, not a small pill
});

test('a room monitor with a code no controller is using says so; with one it shows the obs', async ({ page, context }) => {
  const mon = await context.newPage();
  await mon.goto('/index.html?mode=monitor&session=NOBODY');
  await expect(mon.getByTestId('screen-waiting')).toBeVisible({ timeout: 10000 });

  const code = await openController(page);
  await startQuickSim(page);
  await page.evaluate(() => window.__simEngine.attachStandardMonitoring && window.__simEngine.attachStandardMonitoring());
  const m2 = await context.newPage();
  await m2.goto(`/index.html?mode=monitor&session=${code}`);
  await expect(m2.getByTestId('screen-waiting')).toHaveCount(0, { timeout: 15000 });
  await expect(m2.getByText('Resp Rate', { exact: false }).first()).toBeVisible({ timeout: 15000 });
  // The sound prompt is a button at the top, not a card over the obs.
  await expect(m2.getByTestId('enable-sound')).toBeVisible();
  const btn = await m2.getByTestId('enable-sound').boundingBox();
  expect(btn.height).toBeLessThan(80);
});
