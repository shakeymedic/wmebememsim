// ONE RULE FOR WHEN THE PATIENT GOES LIVE. Every launch mode waits for START. Before it nothing
// physiological moves (no trends, deterioration, drug effects or timed drug events), anything given
// is still recorded, and at START it starts acting. The controller says "Not started" until then.
// Also: the laptop layout (obs, ARREST and CPR on screen at 1366x768 and 1024x768) and the one-tap
// CPR / Defib buttons in the "Patient now" strip.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, pressStart, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const E = (page, fn, arg) => page.evaluate(fn, arg);
// window.__simEngine is the engine as last rendered, so let React render what was just done first.
const S = (page) => E(page, async () => {
  await new Promise(r => setTimeout(r, 150));
  const s = window.__simEngine.state;
  return { running: s.isRunning, time: s.time, sessionTime: s.sessionTime, hr: Math.round(s.vitals.hr), rr: Math.round(s.vitals.rr), spO2: Math.round(s.vitals.spO2),
    rhythm: s.rhythm, counts: s.interventionCounts, active: Array.from(s.activeInterventions), shocks: (s.defib && s.defib.shockCount) || 0, trendElapsed: s.trends ? s.trends.elapsed : 0 };
});
const logHas = (page, re) => E(page, async (src) => { await new Promise(r => setTimeout(r, 150)); return window.__simEngine.state.log.some(l => new RegExp(src).test(l.msg)); }, re.source);
const visibleNotStarted = (page) => page.locator('[data-testid="not-started"]:visible');

test('Quick Sim: nothing moves before START, everything given is recorded, and it acts from START', async ({ page }) => {
  test.setTimeout(90000);
  const errors = trackErrors(page);
  await openController(page);
  await startQuickSim(page);
  await expect(visibleNotStarted(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'PAUSE', exact: true })).toHaveCount(0);

  // The facilitator sets the patient up (allowed before START), then starts a ramp and gives things
  await E(page, () => window.__simEngine.manualUpdateVitals({ spO2: 85, rr: 30 }));
  await E(page, () => window.__simEngine.startTrend({ hr: 130 }, 10));
  await E(page, () => { window.__simEngine.applyIntervention('Oxygen'); window.__simEngine.applyIntervention('Bagging'); window.__simEngine.applyIntervention('Atropine'); });
  const given = await S(page);
  await page.waitForTimeout(7000);   // longer than oxygen's 5 s onset
  const before = await S(page);
  expect(before.running).toBe(false);
  expect(before.time).toBe(0);
  expect(before.sessionTime).toBe(0);
  expect(before.trendElapsed).toBe(0);
  expect(before.hr).toBe(given.hr);                         // no ramp
  expect(before.spO2).toBe(85);                             // no oxygen effect
  expect(before.rr).toBe(30);                               // bagging's instant effect waits too
  // ...but every one of them is recorded
  expect(before.counts.Atropine).toBe(1);
  expect(before.active).toEqual(expect.arrayContaining(['Oxygen', 'Bagging']));
  // ...and the log says each one waits for START
  expect(await E(page, () => window.__simEngine.state.log.filter(l => / recorded before START: the patient is not live yet/.test(l.msg)).length)).toBe(3);

  // START: the patient goes live and what was given starts acting now
  await pressStart(page);
  await expect(visibleNotStarted(page)).toHaveCount(0);
  expect(await logHas(page, /^Given before START, acting from now: .*Bag-Valve-Mask/)).toBe(true);
  await expect.poll(async () => (await S(page)).rr).toBe(14);                                   // bag-valve-mask rate
  await expect.poll(async () => (await S(page)).hr, { timeout: 15000 }).toBeGreaterThan(given.hr + 10);   // the ramp runs
  await expect.poll(async () => (await S(page)).spO2, { timeout: 20000 }).toBeGreaterThan(86);  // oxygen acts after its onset
  expect(errors).toEqual([]);
});

test('Quick Sim: a timed drug event (adenosine) waits for START; an intervention taken off before START never acts', async ({ page }) => {
  test.setTimeout(90000);
  await openController(page);
  await startQuickSim(page);
  await E(page, () => { Math.random = () => 0; });   // adenosine always converts, so the test is deterministic
  await E(page, () => window.__simEngine.changeRhythm('SVT', 'manual selection'));
  await E(page, () => window.__simEngine.manualUpdateVitals({ rr: 30 }));
  await E(page, () => window.__simEngine.applyIntervention('Adenosine'));
  // Bagging on and off again before START: its effect is dropped
  await E(page, () => window.__simEngine.applyIntervention('Bagging'));
  await E(page, () => window.__simEngine.applyIntervention('Bagging'));
  await page.waitForTimeout(14000);   // past adenosine's 12 s conversion point
  const before = await S(page);
  expect(before.rhythm).toBe('SVT');
  expect(before.counts.Adenosine).toBe(1);
  expect(await logHas(page, /^Adenosine 6 mg given as a RAPID push/)).toBe(true);   // recorded at the time it was given
  await pressStart(page);
  expect(await logHas(page, /Given before START, acting from now: .*Bag-Valve-Mask/)).toBe(false);
  await page.waitForTimeout(5000);
  expect((await S(page)).rhythm).toBe('SVT');                                       // not at START itself...
  await expect.poll(async () => (await S(page)).rhythm, { timeout: 20000 }).not.toBe('SVT');   // ...but ~12 s after it
  expect((await S(page)).rr).toBe(30);
});

test('a library scenario opens not started: Start Scenario does not start the clock, START does', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
  await page.getByRole('button', { name: 'Adult Medical', exact: true }).click();
  await page.locator('div.justify-between', { hasText: 'Anaphylaxis (Adult)' }).first().getByRole('button', { name: 'Load' }).click();
  await page.getByRole('button', { name: 'Start Scenario' }).click();
  await expect(visibleNotStarted(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'START', exact: true })).toBeVisible();
  const v0 = await S(page);
  await page.waitForTimeout(3000);
  const v1 = await S(page);
  expect(v1.running).toBe(false);
  expect(v1.time).toBe(0);
  expect([v1.hr, v1.spO2]).toEqual([v0.hr, v0.spO2]);   // no deterioration before START
  // Adrenaline before START: recorded, and the improvement waits for START
  await E(page, () => window.__simEngine.applyIntervention('AdrenalineIM'));
  expect(await E(page, () => !!(window.__simEngine.state.trends && window.__simEngine.state.trends.active))).toBe(false);
  expect(await logHas(page, /IMPROVING/)).toBe(false);
  await pressStart(page);
  await expect.poll(() => E(page, () => !!(window.__simEngine.state.trends && window.__simEngine.state.trends.active))).toBe(true);
  expect(await logHas(page, /in anaphylaxis — patient condition IMPROVING/)).toBe(true);
  await expect.poll(async () => (await S(page)).time).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('a shock before START is recorded and reaches the patient at START; pause and resume still work', async ({ page }) => {
  await openController(page);
  await startQuickSim(page);
  await expect(visibleNotStarted(page)).toBeVisible();
  await E(page, () => window.__simEngine.triggerArrest('VF'));
  await E(page, () => window.__simEngine.deliverShock(200, 'test'));
  expect(await logHas(page, /^Shock delivered 200J/)).toBe(true);
  expect(await logHas(page, /^Shock 200J recorded before START/)).toBe(true);
  expect((await S(page)).shocks).toBe(0);
  await pressStart(page);
  await expect.poll(async () => (await S(page)).shocks).toBe(1);

  // Pause: the clock stops, the controller says "Paused" (not "Not started"), and resume carries on
  await page.getByRole('button', { name: 'PAUSE', exact: true }).click();
  await expect(page.getByTestId('paused-badge')).toBeVisible();
  await expect(visibleNotStarted(page)).toHaveCount(0);
  const t = (await S(page)).time;
  await page.waitForTimeout(2200);
  expect((await S(page)).time).toBe(t);
  await pressStart(page);
  await expect.poll(async () => (await S(page)).time).toBeGreaterThan(t);
});

test('tickActionFor: nothing before START, the full tick while running, a ramp alone while paused', async ({ page }) => {
  await openController(page);
  await startQuickSim(page);
  const r = await E(page, () => {
    const f = window.__pkInternals.tickActionFor;
    const trend = { active: true };
    return [
      f({ isRunning: false, pausedAt: null, trends: trend }, false),
      f({ isRunning: true, pausedAt: null, trends: trend }, false),
      f({ isRunning: false, pausedAt: 30, trends: trend }, false),
      f({ isRunning: false, pausedAt: 30, trends: { active: false } }, false),
      f({ isRunning: true, pausedAt: null, trends: trend }, true)
    ];
  });
  expect(r).toEqual([null, 'TICK_TIME', 'TICK_TRENDS', null, null]);
});

test('"Patient now" strip: one-tap Start/Stop CPR and Defib during a pulseless rhythm, in the full and compact strip', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await startQuickSim(page);
  const strip = page.getByTestId('patient-status');
  await expect(strip.getByTestId('status-cpr')).toHaveCount(0);   // only in a pulseless rhythm
  await E(page, () => window.__simEngine.triggerArrest('VF'));
  for (const view of ['full', 'compact']) {
    const toggle = strip.getByRole('button', { name: /^(More|Less)$/ });
    if ((await toggle.textContent()).trim() === (view === 'full' ? 'More' : 'Less')) await toggle.click();
    await expect(strip.getByTestId(view === 'full' ? 'patient-flags' : 'patient-compact').getByTestId('status-cpr')).toBeVisible();
    // Start CPR: the same action, and the same log line, as the defib panel's CPR button
    await strip.getByRole('button', { name: 'Start CPR' }).click();
    await expect.poll(() => E(page, () => window.__simEngine.state.cprInProgress)).toBe(true);
    expect(await logHas(page, /^CPR started \(facilitator\)/)).toBe(true);
    await expect(strip).toContainText('CPR in progress');
    await strip.getByRole('button', { name: 'Stop CPR' }).click();
    await expect.poll(() => E(page, () => window.__simEngine.state.cprInProgress)).toBe(false);
    expect(await logHas(page, /^CPR stopped \(facilitator\)/)).toBe(true);
    // Defib: the same SET_DEFIB_PANEL as the Defib button under Rhythm & resus
    await strip.getByRole('button', { name: 'Defib', exact: true }).click();
    await expect.poll(() => E(page, () => window.__simEngine.state.defibPanelOpen)).toBe(true);
    await expect(page.getByTestId('defib-panel')).toBeVisible();
    await expect(page.locator('[data-section="resus"]').getByRole('button', { name: 'Close Defib', exact: true })).toBeVisible();
    await strip.getByRole('button', { name: 'Close Defib' }).click();
    await expect.poll(() => E(page, () => window.__simEngine.state.defibPanelOpen)).toBe(false);
  }
  // Out of arrest the buttons go
  await E(page, () => window.__simEngine.triggerROSC('Sinus Rhythm'));
  await expect(strip.getByTestId('status-cpr')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// Inside the viewport AND inside every scrolling/clipping box around it (the controller's left column).
const onScreen = (page, selector) => page.evaluate((sel) => {
  const el = Array.from(document.querySelectorAll(sel)).filter(e => e.getBoundingClientRect().height > 0)[0];
  if (!el) return 'missing';
  const r = el.getBoundingClientRect();
  let bottom = window.innerHeight;
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (/(auto|scroll|hidden)/.test(getComputedStyle(p).overflowY)) bottom = Math.min(bottom, p.getBoundingClientRect().bottom);
  }
  return r.top >= 0 && r.bottom <= bottom ? 'on screen' : `off screen (${Math.round(r.top)}-${Math.round(r.bottom)}, visible to ${Math.round(bottom)})`;
}, selector);

for (const [w, h] of [[1366, 768], [1024, 768]]) {
  test(`laptop ${w}x${h}: HR, ARREST and CPR are on screen without scrolling (Quick Sim and a library scenario)`, async ({ browser }) => {
    for (const mode of ['quick', 'library']) {
      const context = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block' });
      await useFakeFirebase(context);
      const page = await context.newPage();
      await openController(page);
      if (mode === 'quick') await startQuickSim(page);
      else {
        await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
        await page.getByRole('button', { name: 'Cardiac Arrest', exact: true }).click();
        await page.locator('div.justify-between', { hasText: 'Adult - PEA Arrest' }).first().getByRole('button', { name: 'Load' }).click();
        await page.getByRole('button', { name: 'Start Scenario' }).click();
      }
      await expect(visibleNotStarted(page)).toBeVisible();
      await E(page, () => { const e = window.__simEngine; e.attachStandardMonitoring(); if (!window.RHYTHMS.isPulseless(e.state.rhythm)) e.triggerArrest('VF'); });
      await pressStart(page);
      await expect(page.getByTestId('status-cpr')).toBeVisible();
      const hrTile = 'div.hidden.md\\:grid > *:first-child';
      expect(await page.locator(hrTile).first().textContent()).toMatch(/^HR/);
      expect(`${mode} HR: ${await onScreen(page, hrTile)}`).toBe(`${mode} HR: on screen`);
      expect(`${mode} ARREST: ${await onScreen(page, 'button[aria-label^="Choose an arrest rhythm"]')}`).toBe(`${mode} ARREST: on screen`);
      expect(`${mode} CPR: ${await onScreen(page, '[data-testid="status-cpr"]')}`).toBe(`${mode} CPR: on screen`);
      expect(`${mode} Defib: ${await onScreen(page, '[data-testid="status-defib"]')}`).toBe(`${mode} Defib: on screen`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await context.close();
    }
  });
}
