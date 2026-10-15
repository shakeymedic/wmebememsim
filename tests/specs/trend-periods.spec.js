// Several obs changed over different periods each change over their OWN period (Jake: "if I change
// multiple obs over different time periods they all change over the appropriate time"). A later change
// no longer cancels or re-times a ramp already running.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, pressStart, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const v = (page, k) => page.evaluate((key) => Math.round(window.__simEngine.state.vitals[key]), k);
const base = (page, k) => page.evaluate((key) => window.__simEngine.state.baseVitals[key], k);

test('HR over 20 s, then SpO2 over 4 s, then BP now: each arrives on its own time', async ({ page }) => {
  test.setTimeout(90000);
  const errors = trackErrors(page);
  await openController(page);
  await startQuickSim(page);
  await page.evaluate(() => window.__simEngine.manualUpdateVitals({ hr: 80, spO2: 98, bpSys: 120, bpDia: 80 }));
  await pressStart(page);

  await page.evaluate(() => window.__simEngine.startTrend({ hr: 140 }, 20));
  await expect.poll(() => base(page, 'hr'), { timeout: 10000 }).toBeGreaterThan(82);
  await page.evaluate(() => window.__simEngine.startTrend({ spO2: 86 }, 4));
  await page.evaluate(() => window.__simEngine.manualUpdateVitals({ bpSys: 90, bpDia: 55 }));

  // BP is there at once; SpO2 arrives in about 4 s while HR is still on its way.
  expect(await v(page, 'bpSys')).toBe(90);
  await expect.poll(() => v(page, 'spO2'), { timeout: 10000 }).toBe(86);
  const hrWhenSpo2Arrived = await base(page, 'hr');
  expect(hrWhenSpo2Arrived).toBeGreaterThan(82);
  expect(hrWhenSpo2Arrived).toBeLessThan(138);          // not snapped, not cancelled
  // HR carries on and arrives at its own 20 s.
  await expect.poll(() => v(page, 'hr'), { timeout: 30000 }).toBe(140);
  expect(await v(page, 'spO2')).toBe(86);
  expect(await v(page, 'bpSys')).toBe(90);
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.trends.active)).toBe(false);
  expect(errors).toEqual([]);
});

test('naming an obs again re-times only that obs', async ({ page }) => {
  test.setTimeout(60000);
  const errors = trackErrors(page);
  await openController(page);
  await startQuickSim(page);
  await page.evaluate(() => window.__simEngine.manualUpdateVitals({ hr: 80, rr: 16 }));
  await pressStart(page);
  await page.evaluate(() => window.__simEngine.startTrend({ hr: 120, rr: 30 }, 30));
  await page.evaluate(() => window.__simEngine.startTrend({ rr: 10 }, 3));
  const t = await page.evaluate(() => window.__simEngine.state.trends);
  expect(t.durations).toEqual({ hr: 30, rr: 3 });
  await expect.poll(() => v(page, 'rr'), { timeout: 10000 }).toBe(10);
  const stillHr = await page.evaluate(() => window.__simEngine.state.trends);
  expect(stillHr.active).toBe(true);
  expect(Object.keys(stillHr.targets)).toEqual(['hr']);
  expect(errors).toEqual([]);
});
