// Resuming a session after a reload, and the downloadable debrief report
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, expandSection, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

test('a running scenario can be resumed after the page is reloaded', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await page.getByRole('button', { name: 'Defib Sim', exact: true }).click();
  await page.locator('[data-defib-scenario="complete-hb"]').click();
  await page.getByRole('button', { name: 'Start Defib Sim' }).click();
  await page.getByRole('button', { name: 'START', exact: true }).click();
  await page.locator('[data-rhythm="AF"]').click();
  await expandSection(page, 'defibDrugs');
  await page.locator('[data-drug="Atropine"]').click();
  // The snapshot is written every 5 s
  await expect.poll(() => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('wmebem_sim_state')).rhythm; } catch (e) { return null; } }), { timeout: 15000 }).toBe('AF');
  const before = await page.evaluate(() => ({ time: window.__simEngine.state.time, runId: window.__simEngine.state.runId }));

  await page.reload();
  await expect(page.getByText('Resume Previous?')).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByTestId('defib-controller')).toBeVisible();
  const after = await page.evaluate(() => ({ rhythm: window.__simEngine.state.rhythm, time: window.__simEngine.state.time, runId: window.__simEngine.state.runId,
    atropine: window.__simEngine.state.interventionCounts.Atropine, defibSim: !!window.__simEngine.state.scenario.defibSim, arrest: window.__simEngine.state.arrest }));
  expect(after.rhythm).toBe('AF');
  expect(after.defibSim).toBe(true);
  expect(after.atropine).toBe(1);
  expect(after.runId).toBe(before.runId);          // the same run (instructor notes are keyed on it)
  expect(after.time).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('the debrief report downloads as a self-contained page with the log and the defib feedback', async ({ page }) => {
  trackErrors(page);
  await openController(page);
  await page.getByRole('button', { name: 'Defib Sim', exact: true }).click();
  await page.locator('[data-defib-scenario="vf-arrest"]').click();
  await page.getByRole('button', { name: 'Start Defib Sim' }).click();
  await page.getByRole('button', { name: 'START', exact: true }).click();
  await page.evaluate(() => window.__simEngine.deliverShock(150, 'test'));
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByTestId('defib-feedback')).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download Report/ }).click()]);
  const html = require('fs').readFileSync(await download.path(), 'utf8');
  expect(html).toMatch(/<!DOCTYPE html>/i);
  expect(html).toContain('Simulation Log');
  expect(html).toMatch(/Shock delivered 150J/);
  expect(html).toContain('Defib Sim feedback');
  expect(html).toContain('Ventricular Fibrillation');
  expect(html).not.toMatch(/<script/i);                // a static report
});
