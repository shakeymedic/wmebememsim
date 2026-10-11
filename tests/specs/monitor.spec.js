const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, expect } = require('./helpers');

// Regression: when the sweep wrapped part-way through a frame, every later sub-sample drew a
// line from the left edge straight across to the right edge.
test('the monitor sweep never draws a line across the screen', async ({ page, context }) => {
  test.setTimeout(120000);
  await useFakeFirebase(context);
  const code = await openController(page);
  await startQuickSim(page);
  await page.getByRole('button', { name: 'ATTACH STANDARD', exact: false }).first().click();
  await page.getByRole('button', { name: /^START$/ }).click();
  const mon = await context.newPage();
  const errors = trackErrors(mon);
  await mon.addInitScript(() => {
    window.__long = [];
    const P = CanvasRenderingContext2D.prototype;
    const mt = P.moveTo, lt = P.lineTo;
    P.moveTo = function (x, y) { this.__lx = x; this.__ly = y; return mt.call(this, x, y); };
    P.lineTo = function (x, y) {
      if (this.__lx !== undefined && Math.abs(x - this.__lx) > 200 && window.__long.length < 5) window.__long.push({ from: [this.__lx, this.__ly], to: [x, y], stack: new Error().stack.split('\n').slice(1, 4).join(' | ') });
      this.__lx = x; this.__ly = y; return lt.call(this, x, y);
    };
  });
  await mon.goto('/index.html?mode=monitor&session=' + code);
  await mon.waitForTimeout(3000);
  for (const name of [/^Complete Heart Block/, /^Atrial Fibrillation/, /^VT \(with pulse\)/]) {
    await page.getByRole('button', { name }).first().click();
    await mon.waitForTimeout(4000);
  }
  expect(await mon.evaluate(() => window.__long)).toEqual([]);
  expect(errors).toEqual([]);
});

// The room monitor on a big screen: the obs numbers grow with their tiles and still fit a tablet;
// results are readable from across the room; the result card closes with a 44 px target; and a
// rhythm with no QRS to count reads '---' in red on the HR tile, as the defib shows it.
async function openMonitorOn(context, code, width, height) {
  const mon = await context.newPage();
  await mon.setViewportSize({ width, height });
  await mon.goto('/index.html?mode=monitor&session=' + code);
  await expect(mon.getByTestId('obs-heart-rate')).toBeVisible({ timeout: 10000 });
  return mon;
}
const tileFit = (mon) => mon.evaluate(() => [...document.querySelectorAll('.obs-tile')].map(t => {
  const tr = t.getBoundingClientRect();
  const nums = [...t.querySelectorAll('.obs-num')];
  return { size: nums.length ? parseFloat(getComputedStyle(nums[0]).fontSize) : 0,
    fits: nums.every(n => { const r = n.getBoundingClientRect(); return r.left >= tr.left && r.right <= tr.right && r.top >= tr.top && r.bottom <= tr.bottom; }) };
}));

test('big-screen monitor: the obs numbers scale with the screen and still fit 1024 x 768', async ({ page, context }) => {
  await useFakeFirebase(context);
  const code = await openController(page);
  await startQuickSim(page);
  await page.evaluate(() => { const e = window.__simEngine; e.attachStandardMonitoring(); e.attachInvasiveMonitoring(); });
  await page.evaluate(() => { const e = window.__simEngine; if (!e.state.etco2Enabled) e.applyIntervention('ToggleETCO2'); });
  await page.evaluate(() => window.__simEngine.triggerNIBP());
  await expect.poll(() => page.evaluate(() => (window.__simEngine.state.nibp || {}).sys || 0), { timeout: 30000 }).toBeGreaterThan(0);
  const tv = await openMonitorOn(context, code, 1920, 1080);
  const errors = trackErrors(tv);
  await expect.poll(async () => (await tileFit(tv)).length).toBe(6);   // HR, NIBP, SpO2, ABP, RR, ETCO2
  const big = await tileFit(tv);
  expect(big.every(t => t.fits)).toBe(true);
  const hrBig = big[0].size;
  expect(hrBig).toBeGreaterThan(110);            // was capped at text-8xl (96 px)
  const tab = await openMonitorOn(context, code, 1024, 768);
  await expect.poll(async () => (await tileFit(tab)).length).toBe(6);
  const small = await tileFit(tab);
  expect(small.every(t => t.fits)).toBe(true);
  expect(small[0].size).toBeLessThan(hrBig);
  expect(small[0].size).toBeGreaterThan(40);
  expect(errors).toEqual([]);
});

test('big-screen monitor: the VBG is larger than text-xs and the result card closes with a 44 px target', async ({ page, context }) => {
  await useFakeFirebase(context);
  const code = await openController(page);
  await startQuickSim(page);
  await page.evaluate(() => window.__simEngine.attachStandardMonitoring());
  const mon = await openMonitorOn(context, code, 1366, 768);
  await page.evaluate(() => window.__simEngine.revealInvestigation('VBG'));
  const grid = mon.getByTestId('vbg-grid');
  await expect(grid).toBeVisible({ timeout: 10000 });
  expect(await grid.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  const x = await mon.getByTestId('inv-result-close').boundingBox();
  expect(x.width).toBeGreaterThanOrEqual(44);
  expect(x.height).toBeGreaterThanOrEqual(44);
  await mon.getByTestId('inv-result-close').click();
  await expect(grid).toBeHidden();
});

test('a pulseless rhythm with no QRS to count shows HR --- in red, as the defib does; PEA still shows the drawn rate', async ({ page, context }) => {
  await useFakeFirebase(context);
  const code = await openController(page);
  await startQuickSim(page);
  await page.evaluate(() => window.__simEngine.attachStandardMonitoring());
  const mon = await openMonitorOn(context, code, 1366, 768);
  const errors = trackErrors(mon);
  const hr = mon.getByTestId('obs-heart-rate');
  await expect(hr).toHaveText(/^\d+$/);
  await expect(hr).toHaveClass(/text-green-500/);
  for (const r of ['VF', 'Asystole']) {
    await page.evaluate((r) => window.__simEngine.changeRhythm(r, 'test'), r);
    await expect(hr).toHaveText('---');
    await expect(hr).toHaveClass(/text-red-500/);
    await expect(hr).not.toHaveClass(/text-green-500/);
  }
  await page.evaluate(() => window.__simEngine.changeRhythm('PEA', 'test'));
  await expect(hr).toHaveText(String(await mon.evaluate(() => window.RHYTHMS.displayRate('PEA', 0))));
  expect(errors).toEqual([]);
});
