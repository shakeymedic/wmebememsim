// Defib Sim: the start tab, and the learner's defibrillator tablet linked to the session
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, session, live, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

async function startDefibSim(page, scenarioId, mode = 'education') {
  await page.getByRole('button', { name: 'Defib Sim', exact: true }).click();
  await expect(page.getByTestId('defib-setup')).toBeVisible();
  await page.getByRole('button', { name: mode === 'assessment' ? /^Assessment/ : /^Education/ }).click();
  await page.locator(`[data-defib-scenario="${scenarioId}"]`).click();
  await page.getByRole('button', { name: 'Start Defib Sim' }).click();
}

async function openDevice(context, code) {
  const defib = await context.newPage();
  const errors = trackErrors(defib);
  await defib.goto(`/defib/index.html?session=${code}`);
  await expect(defib.locator('#linkBanner')).toBeHidden();
  return { defib, errors };
}

test.describe('Defib Sim', () => {
  test('the start tab builds a Defib Sim scenario and publishes the learner view', async ({ page }) => {
    const errors = trackErrors(page);
    const code = await openController(page);
    await startDefibSim(page, 'vf-arrest');
    await expect.poll(() => live(page, code, '/rhythm')).toBe('VF');
    const view = await live(page, code, '/defibView');
    expect(view).toMatchObject({ defibSim: true, pulseFeedback: true, hints: true });
    const scenario = await page.evaluate(() => window.__simEngine.state.scenario.defibSim);
    expect(scenario).toMatchObject({ scenario: 'vf-arrest', mode: 'education', category: 'defibrillation' });
    expect(errors).toEqual([]);
  });

  test('Education: hints shown, and a pulse check reports what the team would feel', async ({ page, context }) => {
    const code = await openController(page);
    await startDefibSim(page, 'vf-arrest');
    const { defib, errors } = await openDevice(context, code);
    await expect(defib.locator('#hintsRow')).toBeVisible();
    await defib.click('.mode-label[data-mode="defib"]');
    await defib.click('#checkPulseBtn');
    await expect(defib.locator('#messageBar')).toHaveText(/NO PULSE DETECTED/, { timeout: 5000 });
    // VF has no QRS complexes to count
    await expect(defib.locator('#hrDisplay')).toHaveText('---');
    expect(errors).toEqual([]);
  });

  test('Assessment: no hints and no pulse-check result on the device', async ({ page, context }) => {
    const code = await openController(page);
    await startDefibSim(page, 'vf-arrest', 'assessment');
    await expect.poll(() => live(page, code, '/defibView/pulseFeedback')).toBe(false);
    const { defib, errors } = await openDevice(context, code);
    await expect(defib.locator('#hintsRow')).toBeHidden();
    await defib.click('.mode-label[data-mode="defib"]');
    await defib.click('#checkPulseBtn');
    await expect(defib.locator('#messageBar')).toHaveText(/CHECKING FOR PULSE/);
    await expect(defib.locator('#messageBar')).toHaveText('', { timeout: 5000 });
    expect(errors).toEqual([]);
  });

  test('a synchronised shock in VF is not delivered (no R wave)', async ({ page, context }) => {
    const code = await openController(page);
    await startDefibSim(page, 'vf-arrest');
    const { defib, errors } = await openDevice(context, code);
    await defib.click('.mode-label[data-mode="defib"]');
    await defib.click('#syncBtn');
    await defib.click('#chargeBtn');
    await expect(defib.locator('#shockBtn')).toBeEnabled({ timeout: 5000 });
    await defib.click('#shockBtn');
    await expect(defib.locator('#messageBar')).toHaveText(/NO R-WAVE DETECTED/);
    expect(await live(page, code, '/defib/shockCount') || 0).toBe(0);
    expect(errors).toEqual([]);
  });

  test('synchronised cardioversion of unstable SVT fires on an R wave and converts', async ({ page, context }) => {
    const code = await openController(page);
    await startDefibSim(page, 'unstable-svt');
    await expect.poll(() => live(page, code, '/rhythm')).toBe('SVT');
    const { defib, errors } = await openDevice(context, code);
    await defib.click('.mode-label[data-mode="defib"]');
    await defib.click('#syncBtn');
    await expect(defib.locator('#syncIndicator')).toHaveText('SYNC');
    await defib.click('#chargeBtn');
    await expect(defib.locator('#shockBtn')).toBeEnabled({ timeout: 5000 });
    await defib.click('#shockBtn');
    await expect(defib.locator('#messageBar')).toHaveText(/SHOCK DELIVERED/, { timeout: 5000 });
    await expect.poll(() => live(page, code, '/defib/shockCount')).toBe(1);
    await expect.poll(() => live(page, code, '/rhythm'), { timeout: 15000 }).toBe('Sinus Rhythm');
    expect(errors).toEqual([]);
  });

  test('pacing complete heart block: capture, then a palpable pulse at the paced rate', async ({ page, context }) => {
    const code = await openController(page);
    await startDefibSim(page, 'complete-hb');
    const threshold = await page.evaluate(() => window.__simEngine.state.pacingThreshold);
    expect(threshold).toBeGreaterThanOrEqual(45);
    expect(threshold).toBeLessThanOrEqual(75);
    const { defib, errors } = await openDevice(context, code);
    await defib.click('.mode-label[data-mode="pacer"]');
    await defib.click('[data-pacer-param="rate"][data-pacer-dir="5"]');   // 65/min
    // Output to 90 mA: above any threshold plus the mechanical margin
    for (let i = 0; i < 18; i++) await defib.click('[data-pacer-param="output"][data-pacer-dir="5"]');
    await expect(defib.locator('#outputDisplay')).toHaveText('90');
    await expect.poll(() => live(page, code, '/pacing'), { timeout: 10000 }).toEqual({ electrical: true, mechanical: true });
    await expect.poll(() => live(page, code, '/rhythm')).toBe('Paced');
    await expect(defib.locator('#hrDisplay')).toHaveText('65');
    await defib.click('#checkPulseBtn');
    await expect(defib.locator('#messageBar')).toHaveText(/PULSE PRESENT - MATCHES PACED RATE/, { timeout: 5000 });
    // The facilitator can see what the tablet shows
    await expect.poll(async () => Object.values(await session(page, code, '/deviceState') || {}).map(d => d.mode)).toContain('pacer');
    await expect.poll(() => page.evaluate(() => Object.values(window.__simEngine.state.deviceMirror || {}).map(d => d.pacerOutput))).toContain(90);
    // Switching the pacer off restores the underlying rhythm
    await defib.click('.mode-label[data-mode="monitor"]');
    await expect.poll(() => live(page, code, '/rhythm')).toBe('Complete Heart Block');
    expect(errors).toEqual([]);
  });

  test('a defib in another tab of the same browser links without a code, and its presses count', async ({ page, context }) => {
    const errors = trackErrors(page);
    const code = await openController(page);
    await startDefibSim(page, 'vf-arrest');
    const defib = await context.newPage();
    const defibErrors = trackErrors(defib);
    await defib.goto('/defib/index.html');                 // no ?session: the same-browser channel
    await expect(defib.locator('#linkBanner')).toBeHidden({ timeout: 10000 });
    await defib.click('.mode-label[data-mode="defib"]');
    await defib.click('#chargeBtn');
    await expect(defib.locator('#shockBtn')).toBeEnabled({ timeout: 5000 });
    await defib.click('#shockBtn');
    await expect.poll(() => live(page, code, '/defib/shockCount')).toBe(1);
    await defib.click('#analyseBtn');
    await expect.poll(() => page.evaluate(() => window.__simEngine.state.log.some(l => /Defib analysis \(student \(standalone defib\)\)/.test(l.msg)))).toBe(true);
    expect(errors).toEqual([]);
    expect(defibErrors).toEqual([]);
  });

  test('the clock starts itself at the learner\'s first action, so log times move on', async ({ page, context }) => {
    const code = await openController(page);
    await startDefibSim(page, 'vf-arrest');
    await expect(page.getByTestId('defib-clock-stopped')).toContainText('The clock has not started');
    const { defib, errors } = await openDevice(context, code);
    await defib.click('.mode-label[data-mode="defib"]');
    await expect.poll(() => page.evaluate(() => window.__simEngine.state.isRunning)).toBe(true);
    await expect(page.getByTestId('defib-clock-stopped')).toBeHidden();
    const log = await page.evaluate(() => window.__simEngine.state.log.map(l => l.msg));
    expect(log.some(m => /^Clock started automatically/.test(m))).toBe(true);
    // Later presses carry the running clock, not 00:00
    await expect.poll(() => page.evaluate(() => window.__simEngine.state.time), { timeout: 5000 }).toBeGreaterThan(1);
    await defib.click('#checkPulseBtn');
    await expect.poll(() => page.evaluate(() => (window.__simEngine.state.log.filter(l => /Student checked pulse/.test(l.msg)).pop() || {}).simTime)).not.toBe('00:00');
    expect(errors).toEqual([]);
  });

  test('a deliberate pause is not undone by a press on the defib', async ({ page, context }) => {
    const code = await openController(page);
    await startDefibSim(page, 'vf-arrest');
    await page.getByRole('button', { name: 'START', exact: true }).click();
    await page.getByRole('button', { name: 'PAUSE', exact: true }).click();
    await expect(page.getByTestId('defib-clock-stopped')).toContainText('Paused');
    const { defib, errors } = await openDevice(context, code);
    await defib.click('.mode-label[data-mode="defib"]');
    await expect.poll(() => page.evaluate(() => window.__simEngine.state.log.some(l => /Defibrillator mode: DEFIB/i.test(l.msg)))).toBe(true);
    expect(await page.evaluate(() => window.__simEngine.state.isRunning)).toBe(false);
    expect(errors).toEqual([]);
  });

  test('the device asks for a code when opened without one', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/defib/index.html');
    await expect(page.locator('#linkBanner')).toContainText('NOT LINKED TO SESSION');
    await expect(page.locator('#joinCode')).toBeVisible({ timeout: 20000 });
    expect(errors).toEqual([]);
  });
});
