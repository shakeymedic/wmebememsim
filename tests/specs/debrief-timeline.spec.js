// The debrief's obs graph: in every mode (full scenario, Quick Sim without START, Defib Sim) the
// debrief shows the patient's obs over time with the rhythm, what the team did and what the
// facilitator changed, and the printed report carries the same chart.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const E = (page, fn, arg) => page.evaluate(fn, arg);
// One dispatch per evaluate, so each tick sees the state the previous one produced.
const ticks = async (page, type, n) => { for (let i = 0; i < n; i++) await E(page, (t) => window.__simEngine.dispatch({ type: t }), type); };
const finish = async (page) => { await page.getByRole('button', { name: 'Finish' }).first().click(); await expect(page.getByText('Simulation Complete')).toBeVisible(); };

test('Quick Sim records the obs and real log times without pressing START', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await startQuickSim(page);
  await E(page, () => window.__simEngine.attachStandardMonitoring());
  // The record-only clock runs by itself...
  await expect.poll(() => E(page, () => window.__simEngine.state.history.length), { timeout: 12000 }).toBeGreaterThanOrEqual(2);
  const s = await E(page, () => ({ running: window.__simEngine.state.isRunning, time: window.__simEngine.state.time, sessionTime: window.__simEngine.state.sessionTime }));
  expect(s.running).toBe(false);
  expect(s.time).toBe(0);                                // ...without starting the physiology clock
  expect(s.sessionTime).toBeGreaterThanOrEqual(5);
  await E(page, () => window.__simEngine.manualUpdateVitals({ hr: 140 }));
  const last = await E(page, () => window.__simEngine.state.log.slice(-1)[0]);
  expect(last.msg).toMatch(/^Obs changed: HR \d+ → 140$/);
  expect(last.simTime).not.toBe('00:00');
  expect(errors).toEqual([]);
});

test('Quick Sim debrief: obs graph, rhythm, numbered events, read-out and table', async ({ page }) => {
  test.setTimeout(90000);
  const errors = trackErrors(page);
  await openController(page);
  await startQuickSim(page);
  await E(page, () => window.__simEngine.attachStandardMonitoring());
  await ticks(page, 'TICK_RECORD', 20);
  await E(page, () => window.__simEngine.manualUpdateVitals({ bpSys: 85, bpDia: 50 }));
  await E(page, () => window.__simEngine.startTrend({ spO2: 88 }, 30));
  await ticks(page, 'TICK_RECORD', 20);
  await E(page, () => window.__simEngine.triggerArrest('VF'));
  await ticks(page, 'TICK_RECORD', 10);
  await E(page, () => window.__simEngine.deliverShock(150, 'test'));
  await ticks(page, 'TICK_RECORD', 10);
  await E(page, () => window.__simEngine.triggerROSC('Sinus Rhythm'));
  await ticks(page, 'TICK_RECORD', 10);
  await finish(page);

  const tl = page.getByTestId('obs-timeline');
  await expect(tl).toBeVisible();
  const svg = tl.locator('svg').first();
  for (const t of ['Rhythm', 'Heart rate', 'Blood pressure', 'SpO2', 'Resp rate', 'Rhythm, arrest and shocks', 'Team actions and treatment', 'Facilitator changes']) {
    await expect(svg).toContainText(t);
  }
  const events = tl.getByTestId('obs-events');
  await expect(events).toContainText('Obs changed: BP 120/75 → 85/50');
  await expect(events).toContainText('Obs trend started: SpO2');
  await expect(events).toContainText('CARDIAC ARREST');
  await expect(events).toContainText('Shock delivered 150J');
  await expect(events).toContainText('ROSC achieved');
  await expect(events).toContainText('Standard monitoring');
  // Pulseless time is marked on the rhythm lane
  expect(await svg.locator('rect[fill="#d03b3b"]').count()).toBeGreaterThan(0);

  // Hover read-out, then the keyboard
  const box = await svg.boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await expect(tl.getByTestId('obs-readout')).toContainText('HR bpm');
  await page.mouse.move(0, 0);
  await expect(tl.getByTestId('obs-readout')).toHaveCount(0);
  await tl.locator('[role="group"]').focus();
  await page.keyboard.press('Home');
  await expect(tl.getByTestId('obs-readout')).toContainText('00:00');

  await tl.getByRole('button', { name: /Show the obs as a table/ }).click();
  await expect(tl.getByTestId('obs-table')).toContainText('85/50');
  expect(errors).toEqual([]);
});

test('full scenario debrief shows the interventions on the graph, and the report carries it', async ({ page }) => {
  test.setTimeout(90000);
  const errors = trackErrors(page);
  await openController(page);
  await startQuickSim(page);
  await E(page, () => {
    const base = window.ALL_SCENARIOS.find(s => s.ageRange !== 'Paediatric' && !s.defibSim);
    window.__simEngine.dispatch({ type: 'LOAD_SCENARIO', payload: window.generatePatientFromTemplate(base, {}) });
  });
  await expect.poll(() => E(page, () => !window.__simEngine.state.scenario.quickSim)).toBe(true);
  await E(page, () => window.__simEngine.start());
  await ticks(page, 'TICK_TIME', 12);
  await E(page, () => window.__simEngine.applyIntervention('Oxygen'));
  await ticks(page, 'TICK_TIME', 12);
  await finish(page);
  const tl = page.getByTestId('obs-timeline');
  await expect(tl).toBeVisible();
  await expect(tl.getByTestId('obs-events')).toContainText(/oxygen/i);

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download Report/ }).click()]);
  const html = require('fs').readFileSync(await download.path(), 'utf8');
  expect(html).toContain('Obs, interventions and changes');
  expect(html).toMatch(/<svg[^>]*role="img"/);
  expect(html).toContain('What happened');
  expect(html).toMatch(/oxygen/i);
  expect(html).not.toMatch(/<script/i);
  expect(errors).toEqual([]);
});

test('a full scenario finished without START says why there is no graph', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await startQuickSim(page);
  await E(page, () => {
    const base = window.ALL_SCENARIOS.find(s => s.ageRange !== 'Paediatric' && !s.defibSim);
    window.__simEngine.dispatch({ type: 'LOAD_SCENARIO', payload: window.generatePatientFromTemplate(base, {}) });
  });
  await expect.poll(() => E(page, () => !window.__simEngine.state.scenario.quickSim)).toBe(true);
  await finish(page);
  await expect(page.getByTestId('obs-timeline-empty')).toContainText('press START');
  expect(errors).toEqual([]);
});

test('Defib Sim debrief has the graph with the shocks and rhythm changes', async ({ page }) => {
  test.setTimeout(90000);
  const errors = trackErrors(page);
  await openController(page);
  await page.getByRole('button', { name: 'Defib Sim', exact: true }).click();
  await page.locator('[data-defib-scenario="vf-arrest"]').click();
  await page.getByRole('button', { name: 'Start Defib Sim' }).click();
  await page.getByRole('button', { name: 'START', exact: true }).click();
  await ticks(page, 'TICK_TIME', 12);
  await E(page, () => window.__simEngine.deliverShock(150, 'test'));
  await ticks(page, 'TICK_TIME', 12);
  await finish(page);
  const tl = page.getByTestId('obs-timeline');
  await expect(tl).toBeVisible();
  await expect(tl.getByTestId('obs-events')).toContainText('Shock delivered 150J');
  await expect(tl.locator('svg').first()).toContainText('Rhythm, arrest and shocks');
  expect(errors).toEqual([]);
});

test('the obs graph survives a reload and resume', async ({ page }) => {
  test.setTimeout(60000);
  await openController(page);
  await startQuickSim(page);
  await E(page, () => window.__simEngine.attachStandardMonitoring());
  await ticks(page, 'TICK_RECORD', 21);
  const n = await E(page, () => window.__simEngine.state.history.length);
  expect(n).toBeGreaterThanOrEqual(4);
  await expect.poll(() => E(page, () => { try { return (JSON.parse(localStorage.getItem('wmebem_sim_state')).history || []).length; } catch (e) { return 0; } }), { timeout: 15000 }).toBeGreaterThanOrEqual(n);
  await page.reload();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect.poll(() => E(page, () => window.__simEngine.state.history.length)).toBeGreaterThanOrEqual(n);
  expect(await E(page, () => window.__simEngine.state.sessionTime)).toBeGreaterThanOrEqual(20);
});
