// Patient condition (AUTO/MANUAL deterioration with Trend Better / Worse) sits straight under the obs,
// above Rhythm & resus, so steering the patient is in one place.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

test('Patient condition comes straight after the obs, before Rhythm & resus', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
  await page.getByRole('button', { name: 'Adult Medical', exact: true }).click();
  await page.locator('div.justify-between', { hasText: 'Tension Pneumothorax' }).first().getByRole('button', { name: 'Load' }).click();
  await page.getByRole('button', { name: 'Start Scenario' }).click();
  const order = await page.evaluate(() => Array.from(document.querySelectorAll('[data-section]')).map(e => e.getAttribute('data-section')));
  const i = (id) => order.indexOf(id);
  expect(i('condition')).toBeGreaterThan(i('moreObs'));
  expect(i('condition')).toBe(i('moreObs') + 1);
  expect(i('condition')).toBeLessThan(i('resus'));
  await expect(page.locator('[data-section="condition"]').getByTitle('Trend the patient BETTER (logged)')).toBeVisible();
  expect(errors).toEqual([]);
});

test('on a short laptop screen the one set of Auto / Better / Worse sits on the More obs row, with no second copy, and ARREST stays on screen', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: 'block' });
  await useFakeFirebase(context);
  const page = await context.newPage();
  const errors = trackErrors(page);
  await openController(page);
  await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
  await page.getByRole('button', { name: 'Adult Medical', exact: true }).click();
  await page.locator('div.justify-between', { hasText: 'Tension Pneumothorax' }).first().getByRole('button', { name: 'Load' }).click();
  await page.getByRole('button', { name: 'Start Scenario' }).click();
  const quick = page.locator('[data-section="moreObs"]').getByTestId('condition-quick');
  await expect(quick).toBeVisible();
  // One place only: no second Patient condition row and no second Better / Worse on screen.
  await expect(page.locator('[data-section="condition"]')).toBeHidden();
  await expect(page.locator('[data-testid="condition-quick"]:visible')).toHaveCount(1);
  await expect(page.locator('button[title="Trend the patient WORSE (logged)"]:visible')).toHaveCount(1);
  const mode = () => page.evaluate(() => window.__simEngine.state.deteriorationMode || 'manual');
  const before = await mode();
  await quick.getByRole('button', { name: /^(Auto|Manual)$/ }).click();
  await expect.poll(mode).not.toBe(before);
  await quick.getByRole('button', { name: 'Worse', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.log.some(l => /Deteriorating \(Trend\)/.test(l.msg)))).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});

test('on a tall screen Patient condition is one row under the obs, and More obs carries no copy of its buttons', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
  await page.getByRole('button', { name: 'Adult Medical', exact: true }).click();
  await page.locator('div.justify-between', { hasText: 'Tension Pneumothorax' }).first().getByRole('button', { name: 'Load' }).click();
  await page.getByRole('button', { name: 'Start Scenario' }).click();
  await expect(page.locator('[data-section="condition"]').getByTestId('condition-quick')).toBeVisible();
  await expect(page.locator('[data-section="moreObs"]').getByTestId('condition-quick')).toHaveCount(0);
  await expect(page.locator('button[title="Trend the patient BETTER (logged)"]:visible')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('on a phone Patient condition is one row, with one set of buttons', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await useFakeFirebase(context);
  const page = await context.newPage();
  const errors = trackErrors(page);
  await openController(page);
  await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
  await page.getByRole('button', { name: 'Adult Medical', exact: true }).click();
  await page.locator('div.justify-between', { hasText: 'Tension Pneumothorax' }).first().getByRole('button', { name: 'Load' }).click();
  await page.getByRole('button', { name: 'Start Scenario' }).click();
  await expect(page.locator('[data-section="condition"]').getByTestId('condition-quick')).toBeVisible();
  await expect(page.locator('[data-testid="condition-quick"]:visible')).toHaveCount(1);
  expect(errors).toEqual([]);
  await context.close();
});

test('desktop: the obs tiles are the first thing in the left column, above the patient card and the monitor strip', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
  await page.getByRole('button', { name: 'Adult Medical', exact: true }).click();
  await page.locator('div.justify-between', { hasText: 'Tension Pneumothorax' }).first().getByRole('button', { name: 'Load' }).click();
  await page.getByRole('button', { name: 'Start Scenario' }).click();
  const top = page.getByTestId('obs-top');
  await expect(top).toBeVisible();
  const first = await top.evaluate(el => el.parentElement.firstElementChild === el);
  expect(first).toBe(true);
  const y = async (loc) => (await loc.boundingBox()).y;
  expect(await y(top)).toBeLessThan(await y(page.locator('[data-section="monitoring"]')));
  expect(await y(top)).toBeLessThan(await y(page.getByRole('button', { name: /Show Timer/i })));
  expect(errors).toEqual([]);
});

test('Quick Sim: no separate Capnography on/off button under Rhythm; the Capnography chip still attaches it', async ({ page }) => {
  const errors = trackErrors(page);
  const { startQuickSim } = require('./helpers');
  await openController(page);
  await startQuickSim(page);
  await expect(page.getByRole('button', { name: /^Capnography (on|off)$/i })).toHaveCount(0);
  await expect(page.getByTestId('obs-top')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Quick Sim: Monitoring & access and Ventilator always start closed, and there is no Auto deterioration', async ({ page }) => {
  const errors = trackErrors(page);
  const { startQuickSim } = require('./helpers');
  await openController(page);
  await startQuickSim(page);
  const mon = page.locator('[data-section="monitoring"] > div > button[aria-expanded]');
  await expect(mon).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('[data-section="vent"] > div > button[aria-expanded]')).toHaveAttribute('aria-expanded', 'false');
  await mon.click();
  await expect(mon).toHaveAttribute('aria-expanded', 'true');
  // A new Quick Sim starts closed again, even though it was opened last time.
  await page.reload();
  await openController(page);
  await startQuickSim(page);
  await expect(page.locator('[data-section="monitoring"] > div > button[aria-expanded]')).toHaveAttribute('aria-expanded', 'false');
  // Manual only: no Auto switch and no Patient condition row, but Trend Better / Worse are there.
  expect(await page.evaluate(() => window.__simEngine.state.deteriorationMode || 'manual')).toBe('manual');
  await expect(page.locator('[data-testid="condition-quick"]')).toHaveCount(0);
  await expect(page.locator('[data-section="condition"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Trend\s*Better/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Trend\s*Worse/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Quick Sim starts with the rhythms column folded: the obs column fills the screen, with Better / Worse on the More obs row', async ({ page }) => {
  const errors = trackErrors(page);
  const { startQuickSim } = require('./helpers');
  await openController(page);
  await startQuickSim(page, { folded: true });
  const fold = page.locator('[data-testid="right-fold-bar"] button');
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Sinus Bradycardia', exact: true })).toBeHidden();
  const obsW = (await page.getByTestId('obs-top').boundingBox()).width;
  expect(obsW).toBeGreaterThan(1000);                      // 1440 wide: the obs column takes the screen
  // One set of Better / Worse, on the More obs row, and it works.
  await expect(page.locator('button[title="Trend the patient WORSE (logged)"]:visible')).toHaveCount(1);
  await page.getByTestId('trend-quick').getByRole('button', { name: 'Better', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.log.some(l => /Improving \(Trend\)/.test(l.msg)))).toBe(true);
  // Open it: the rhythms are back, and Better / Worse move back to that column (still one set).
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Sinus Bradycardia', exact: true })).toBeVisible();
  await expect(page.getByTestId('trend-quick')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a library scenario starts with the interventions column folded, like Quick Sim; it opens, stays open across Back, and the next run starts folded again', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  const startLibrary = async () => {
    await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
    // (the "Scenario paused" card also names the scenario, so pick the row with a Load button)
    const load = page.locator('div.justify-between', { hasText: 'Anaphylaxis (Adult)' }).filter({ has: page.getByRole('button', { name: 'Load' }) }).last().getByRole('button', { name: 'Load' });
    // The library remembers the open category between visits
    if (!(await load.isVisible())) await page.getByRole('button', { name: 'Adult Medical', exact: true }).click();
    await load.click();
    await page.getByRole('button', { name: 'Start Scenario' }).click();
  };
  await startLibrary();
  const fold = page.locator('[data-testid="right-fold-bar"] button');
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await expect(fold).toHaveAccessibleName('Open the interventions and log column');
  await expect(page.getByLabel('Search interventions')).toBeHidden();
  expect((await page.getByTestId('obs-top').boundingBox()).width).toBeGreaterThan(1000);
  // The facilitator opens it as before
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel('Search interventions')).toBeVisible();
  await expect(page.getByTestId('event-log')).toBeVisible();
  // Back and Return to scenario: still open (it is the same run)
  await page.getByRole('button', { name: /Back/ }).first().click();
  await page.getByRole('button', { name: 'Return to scenario' }).click();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  // A new run starts folded again
  await page.getByRole('button', { name: /Back/ }).first().click();
  await startLibrary();
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  expect(errors).toEqual([]);
});
