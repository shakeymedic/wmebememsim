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
