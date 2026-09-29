// Defib Sim: the facilitator's Defib controller, custom sequences, RCUK prompts and the debrief
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, session, live, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

async function startDefibSim(page, scenarioId) {
  await page.getByRole('button', { name: 'Defib Sim', exact: true }).click();
  await page.locator(`[data-defib-scenario="${scenarioId}"]`).click();
}
const go = (page) => page.getByRole('button', { name: 'Start Defib Sim' }).click();
const engine = (page, fn, arg) => page.evaluate(([f, a]) => new Function('sim', 'arg', f)(window.__simEngine, a), [fn, arg]);

test.describe('Defib controller', () => {
  test('opens for a Defib Sim scenario and drives rhythm, artefacts, metronome and threshold', async ({ page }) => {
    const errors = trackErrors(page);
    const code = await openController(page);
    await startDefibSim(page, 'complete-hb');
    await go(page);
    await expect(page.getByTestId('defib-controller')).toBeVisible();
    await expect(page.getByTestId('defib-rhythm')).toHaveText(/Complete Heart Block/i);

    await page.locator('[data-rhythm="VF"]').click();
    await expect.poll(() => live(page, code, '/rhythm')).toBe('VF');
    await expect(page.getByTestId('arrest-status')).toContainText('In arrest');

    await page.locator('[data-artefact="movement"]').click();
    await expect.poll(() => live(page, code, '/noise/movement')).toBe(true);
    await page.getByRole('button', { name: /Metronome/ }).click();
    await expect.poll(() => live(page, code, '/defibView/metronome')).toBe(true);

    const before = await engine(page, 'return sim.state.pacingThreshold');
    await page.getByRole('button', { name: 'Raise the capture threshold' }).click();
    await expect.poll(() => engine(page, 'return sim.state.pacingThreshold')).toBe(before + 5);
    expect(errors).toEqual([]);
  });

  test('RCUK prompts follow the arrest: adrenaline and amiodarone after the 3rd shock', async ({ page }) => {
    const errors = trackErrors(page);
    await openController(page);
    await startDefibSim(page, 'vf-arrest');
    await go(page);
    await page.getByRole('button', { name: 'START', exact: true }).click();
    await page.getByLabel('Converts').selectOption('never');
    for (let i = 0; i < 3; i++) await engine(page, 'sim.deliverShock(150, "test")');
    await expect(page.getByTestId('arrest-status')).toContainText('3 shocks');
    const prompts = page.getByTestId('drug-prompts');
    await expect(prompts).toContainText('Adrenaline 1 mg IV due (after the 3rd shock)');
    await expect(prompts).toContainText('Amiodarone 300 mg IV due (after the 3rd shock)');
    await page.locator('[data-drug="AdrenalineIV"]').click();
    await expect.poll(() => engine(page, 'return sim.state.arrest.adrenaline.length')).toBe(1);
    await expect(prompts).not.toContainText('Adrenaline');
    await page.locator('[data-drug="Amiodarone"]').click();
    await expect(page.locator('[data-drug="Amiodarone"]')).toContainText('150 mg');
    expect(errors).toEqual([]);
  });

  test('a custom sequence moves on at a shock, a timer and an analysis', async ({ page }) => {
    const errors = trackErrors(page);
    const code = await openController(page);
    await startDefibSim(page, 'custom');
    // VF (on shock) -> Sinus (after 30 s) -> Asystole (on analyse)
    await page.getByLabel('Step 2 trigger').selectOption('timer_30');
    await page.getByRole('button', { name: '+ Add step' }).click();
    await page.getByLabel('Step 3 rhythm').selectOption('Asystole');
    await page.getByLabel('Step 3 trigger').selectOption('analyse');
    await go(page);
    await expect(page.getByTestId('defib-steps-runner')).toBeVisible();
    await page.getByRole('button', { name: 'START', exact: true }).click();
    await expect.poll(() => live(page, code, '/rhythm')).toBe('VF');

    // An analysis does not move a "shock" step on
    await engine(page, 'sim.analyseRhythm("test")');
    await page.waitForTimeout(300);
    expect(await live(page, code, '/rhythm')).toBe('VF');

    await engine(page, 'sim.deliverShock(150, "test")');
    await expect.poll(() => live(page, code, '/rhythm'), { timeout: 5000 }).toBe('Sinus Rhythm');
    expect(await engine(page, 'return sim.state.defibStep.index')).toBe(1);

    await engine(page, 'sim.dispatch({ type: "FAST_FORWARD", payload: 31 })');
    await expect.poll(() => live(page, code, '/rhythm'), { timeout: 5000 }).toBe('Asystole');

    await engine(page, 'sim.analyseRhythm("test")');
    await expect.poll(() => engine(page, 'return sim.state.defibStep.done')).toBe(true);
    await expect(page.getByTestId('defib-steps-runner')).toContainText('complete');
    expect(errors).toEqual([]);
  });

  test('the debrief gives Defib Sim feedback for a pacing scenario', async ({ page }) => {
    const errors = trackErrors(page);
    await openController(page);
    await startDefibSim(page, 'complete-hb');
    await go(page);
    await page.getByRole('button', { name: 'START', exact: true }).click();
    await engine(page, 'sim.setDefibMode("pacer", "test"); sim.dispatch({ type: "UPDATE_PACER_STATE", payload: { rate: 70, output: 120, demand: true } })');
    await expect.poll(() => engine(page, 'return sim.state.pacing.mechanical')).toBe(true);
    await page.locator('[data-drug="Fentanyl"]').click();
    await page.getByRole('button', { name: 'Finish' }).click();   // the confirm is accepted by trackErrors
    const fb = page.getByTestId('defib-feedback');
    await expect(fb).toBeVisible();
    await expect(fb).toContainText('Pacing successful');
    await expect(fb).toContainText('PACER mode selected');
    await expect(fb).toContainText('Analgesia or sedation given');
    await expect(fb).toContainText('No pulse check recorded');
    await expect(page.getByRole('button', { name: 'Certificate' })).toBeVisible();
    const cert = await page.evaluate(() => window.DefibSim.certificateHtml(window.__simEngine.state, 'A <Learner>'));
    expect(cert).toContain('A &lt;Learner&gt;');
    expect(cert).toContain('Complete heart block');
    expect(errors).toEqual([]);
  });
});
