// Fixes from the full recheck of 14 Oct 2026. Each test reproduces a bug found then.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, pressStart, session, expect } = require('./helpers');

test.beforeEach(async ({ context, page }) => { await useFakeFirebase(context); page.on('dialog', d => d.accept().catch(() => {})); });

test('the Course scenarios sign-in box keeps what you type while the screen updates in the background', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  const screen = await context.newPage();                       // a joined screen makes the controller update every few seconds
  await screen.goto(`/index.html?mode=monitor&session=${code}`);
  await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
  await page.getByRole('button', { name: /Course scenarios/ }).click();
  await page.getByRole('button', { name: /Sign in or create an account/ }).click();
  await page.getByLabel('Email').fill('typing@example.org');
  await page.waitForTimeout(7000);                              // past the 5 s presence sweep
  await expect(page.getByLabel('Email')).toHaveValue('typing@example.org');
  expect(errors).toEqual([]);
});

test('the connection badge keeps counting joined screens when a scenario starts', async ({ page, context }) => {
  const code = await openController(page);
  const screen = await context.newPage();
  await screen.goto(`/index.html?mode=monitor&session=${code}`);
  await expect(page.getByTestId('setup-summary')).toContainText('1 patient screen connected');
  await startQuickSim(page);
  await expect(page.getByTestId('connection-badge')).toContainText(/patient monitor/i, { timeout: 2000 });
});

const UID = 'uid_a_learner_example_org';
async function signIn(page) {
  await page.getByRole('button', { name: /^Sign in$/ }).first().click();
  await page.getByLabel('Email').fill('a.learner@example.org');
  await page.getByLabel('Password').fill('correct horse');
  await page.locator('form button[type=submit]').click();
}

test('the Builder: after saving one scenario the next one is new, and editing keeps the human-factor challenge', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await signIn(page);
  await page.getByRole('button', { name: 'My scenarios', exact: true }).click();
  await page.getByRole('button', { name: 'Builder', exact: true }).click();
  await page.getByPlaceholder('Scenario Title').fill('First one');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved "First one" to your account.')).toBeVisible();
  await page.getByRole('button', { name: 'Builder', exact: true }).click();
  await expect(page.getByPlaceholder('Scenario Title')).toHaveValue('');
  await page.getByPlaceholder('Scenario Title').fill('Second one');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved "Second one" to your account.')).toBeVisible();
  const titles = async () => Object.values(await page.evaluate(u => window.__fakeRtdb.get(`userScenarios/${u}`), UID) || {}).map(s => s.title).sort();
  await expect.poll(titles).toEqual(['First one', 'Second one']);

  // A saved scenario with a challenge (and a field the Builder does not show) keeps both when edited
  await page.evaluate(u => {
    const all = window.__fakeRtdb.get(`userScenarios/${u}`);
    const id = Object.keys(all).find(k => all[k].title === 'First one');
    const s = { ...all[id], hf: { id: 'hf1', type: 'x', description: 'x' }, evolution: { note: 'kept' } };
    window.firebase.database().ref(`userScenarios/${u}/${id}`).set(s);
  }, UID);
  await page.getByText('First one').locator('xpath=ancestor::div[.//button[normalize-space()="Edit"]][1]').getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByTestId('builder-editing')).toBeVisible();
  await page.getByPlaceholder('Scenario Title').fill('First one, renamed');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(titles).toEqual(['First one, renamed', 'Second one']);
  const edited = Object.values(await page.evaluate(u => window.__fakeRtdb.get(`userScenarios/${u}`), UID)).find(s => s.title === 'First one, renamed');
  expect(edited.evolution).toEqual({ note: 'kept' });
  expect(edited.hf.id).toBe('hf1');
  expect(errors).toEqual([]);
});

test('a finished run is not offered for resuming after a reload', async ({ page }) => {
  await openController(page);
  await startQuickSim(page);
  await pressStart(page);
  await expect.poll(() => page.evaluate(() => !!localStorage.getItem('wmebem_sim_state')), { timeout: 15000 }).toBe(true);
  await page.getByRole('button', { name: /Finish/ }).first().click();
  await expect(page.getByText('Simulation Complete')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('wmebem_sim_state'))).toBeNull();
  await page.reload();
  await expect(page.getByTestId('mode-chooser')).toBeVisible();
  await expect(page.getByText(/Resume Previous|Scenario paused/)).toHaveCount(0);
});

test('Back from a briefing does not offer the unstarted scenario as "paused", and the screens go back to waiting', async ({ page, context }) => {
  const code = await openController(page);
  await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
  await page.getByRole('button', { name: /Adult Medical/ }).click();
  await page.getByRole('button', { name: 'Load', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Start Scenario' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Setup' }).click();
  await expect(page.getByTestId('mode-chooser').or(page.getByRole('button', { name: /All options/ })).first()).toBeVisible();
  await expect(page.getByText(/Scenario paused|Return to scenario/)).toHaveCount(0);
  await expect.poll(() => session(page, code, '/live')).toBeNull();
});

test('the skills checklist ticks reach the debrief, and survive a reload and Resume', async ({ page }) => {
  await openController(page);
  await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
  await page.getByRole('button', { name: /Adult Medical/ }).click();
  await page.getByRole('button', { name: 'Load', exact: true }).first().click();
  await page.getByRole('button', { name: 'Start Scenario' }).click();
  await pressStart(page);
  await page.getByRole('button', { name: 'Assessment', exact: true }).click();
  await page.getByRole('button', { name: 'Mark Team Leadership as achieved' }).click();
  await page.getByRole('button', { name: 'Mark CPR Quality as needing improvement' }).click();
  await expect.poll(() => page.evaluate(() => { try { return (JSON.parse(localStorage.getItem('wmebem_sim_state')).assessments || {})['Team Leadership']; } catch (e) { return null; } }), { timeout: 15000 }).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  expect(await page.evaluate(() => window.__simEngine.state.assessments['CPR Quality'])).toBe(false);
  await page.getByRole('button', { name: /Finish/ }).first().click();
  await expect(page.getByTestId('debrief-skills')).toContainText('Team Leadership');
  await expect(page.getByTestId('debrief-skills')).toContainText('Observed');
  await expect(page.getByTestId('debrief-skills')).toContainText('Needs improvement');
});

test('a resumed paced patient keeps the pacer, its capture threshold and the ventilator link', async ({ page }) => {
  await openController(page);
  await startQuickSim(page);
  await pressStart(page);
  await page.evaluate(() => {
    const e = window.__simEngine;
    e.dispatch({ type: 'SET_PACING_THRESHOLD', payload: 55 });
    e.dispatch({ type: 'UPDATE_PACER_STATE', payload: { rate: 70, output: 80, demand: true } });
    e.dispatch({ type: 'SET_PACING', payload: { underlying: 'Complete Heart Block' } });
    e.dispatch({ type: 'SET_VENT_LINK', payload: false });
  });
  await expect.poll(() => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('wmebem_sim_state')).pacingThreshold; } catch (e) { return null; } }), { timeout: 15000 }).toBe(55);
  await page.reload();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  const st = await page.evaluate(() => { const s = window.__simEngine.state; return { th: s.pacingThreshold, out: s.remotePacerState.output, under: s.pacing.underlying, link: s.ventLink }; });
  expect(st).toEqual({ th: 55, out: 80, under: 'Complete Heart Block', link: false });
});

test('after Finish, presses on the defib tablet no longer change the debrief', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  await pressStart(page);
  await page.getByRole('button', { name: /Finish/ }).first().click();
  await expect(page.getByText('Simulation Complete')).toBeVisible();
  const before = await page.evaluate(() => ({ n: window.__simEngine.state.log.length, shocks: window.__simEngine.state.defib.shockCount }));
  await page.evaluate(c => window.firebase.database().ref(`sessions/${c}/deviceEvents`).push({ type: 'SHOCK_DELIVERED', payload: { energy: 150 }, ts: Date.now() + 1000, from: 'test', device: 'standalone-defib' }), code);
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({ n: window.__simEngine.state.log.length, shocks: window.__simEngine.state.defib.shockCount }));
  expect(after).toEqual(before);
});

test('the defib tablet: a dumped charge stops showing CHARGED, and a new scenario gives a fresh device', async ({ page, context }) => {
  const code = await openController(page);
  await page.getByRole('button', { name: 'Defib Sim', exact: true }).click();
  await page.locator('[data-defib-scenario="vf-arrest"]').click();
  await page.getByRole('button', { name: 'Start Defib Sim' }).click();
  await pressStart(page);
  const defib = await context.newPage();
  const errors = trackErrors(defib);
  await defib.clock.install();
  await defib.goto(`/defib/index.html?session=${code}`);
  await expect(defib.locator('#linkBanner')).toBeHidden();
  await defib.click('.mode-label[data-mode="defib"]');
  await defib.click('#chargeBtn');
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.defib.charged)).toBe(true);
  await defib.clock.runFor(65000);
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.defib.charged)).toBe(false);

  // Pacing left on, then a new scenario on the same code
  await defib.click('.mode-label[data-mode="pacer"]');
  await expect.poll(() => defib.evaluate(() => window.device.mode)).toBe('pacer');
  await page.getByRole('button', { name: /Finish/ }).first().click();
  await page.getByRole('button', { name: 'Exit to Menu' }).click();
  await startQuickSim(page);
  await expect.poll(() => defib.evaluate(() => window.device.mode), { timeout: 10000 }).toBe('off');
  expect(errors).toEqual([]);
});
