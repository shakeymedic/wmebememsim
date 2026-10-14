// The controller on a phone (390 x 844): the same controls as on a laptop, with the rarely used parts
// folded away. The trace strip and the Quick Sim rhythm list start folded (the obs and the rhythm are at
// the top of the page), the toolbar is two rows, flags the headline already says are not repeated, and
// nothing runs off the side of the screen. Desktop layouts are unchanged (every other spec).
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, pressStart, expect } = require('./helpers');

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test('Quick Sim on a phone: trace and rhythm list fold away and open on demand, toolbar in two rows', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await startQuickSim(page);
  await pressStart(page);

  // One "none on monitor" line instead of "not on monitor" on every tile.
  await expect(page.getByTestId('phone-none-on-monitor')).toBeVisible();
  await expect(page.locator('[data-off-monitor]:visible')).toHaveCount(0);

  // Toolbar: Back, Finish, Screens and Tools all on screen, in no more than two rows.
  const tops = [];
  for (const name of ['Back', 'Finish']) tops.push((await page.getByRole('button', { name, exact: true }).boundingBox()).y);
  tops.push((await page.getByRole('button', { name: /^Screens:/ }).boundingBox()).y);
  tops.push((await page.getByRole('button', { name: /^Tools:/ }).boundingBox()).y);
  expect(new Set(tops.map(Math.round)).size).toBeLessThanOrEqual(2);

  // The trace strip is folded; Trace opens it.
  const toggle = page.getByTestId('phone-trace-toggle');
  const blank = page.getByText('No monitoring attached', { exact: true });
  await expect(blank).toBeHidden();
  await toggle.click();
  await expect(blank).toBeVisible();
  await toggle.click();
  await expect(blank).toBeHidden();

  // The rhythm list is folded; Show all opens it and a rhythm can be picked.
  const sinusBrady = page.getByRole('button', { name: 'Sinus Bradycardia', exact: true });
  await expect(sinusBrady).toBeHidden();
  await page.getByTestId('phone-rhythms-toggle').click();
  await sinusBrady.click();
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.rhythm)).toBe('Sinus Bradycardia');

  // The screen switch is on its own row and fits.
  await expect(page.getByTestId('screen-show-switch').locator('[data-show="vent"]')).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  expect(errors).toEqual([]);
});

test('a flag the headline already names is not repeated as a chip on a phone', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await startQuickSim(page);
  await page.evaluate(() => window.__simEngine.manualUpdateVitals({ spO2: 82, rr: 38, bpSys: 75, bpDia: 48, hr: 135 }));
  const headline = page.getByTestId('patient-headline');
  await expect(headline).toContainText('Hypoxic');
  const chips = page.getByTestId('patient-compact').locator('span.rounded:visible');
  await expect(chips.first()).toBeVisible();                // the flags it does not name are still there
  const head = await headline.textContent();
  for (const t of await chips.allTextContents()) expect(head.includes(t)).toBe(false);
  expect(await noSideScroll(page)).toBe(true);
  expect(errors).toEqual([]);
});
