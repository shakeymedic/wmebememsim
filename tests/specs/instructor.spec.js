// The instructor (controller) screen layout: expandable sections that remember their state, the
// Screens and Tools menus, no duplicated actions, and the always-visible event log.
const { test } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { useFakeFirebase, trackErrors, openController, startQuickSim, expandSection, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

async function startScenario(page, category, title) {
  await page.getByRole('button', { name: /^premade$/i }).click();
  await page.getByRole('button', { name: category, exact: true }).click();
  await page.locator('div.justify-between', { hasText: title }).first().getByRole('button', { name: 'Load' }).click();
  await page.getByRole('button', { name: 'Start Scenario' }).click();
  await page.waitForFunction(() => !!(window.__simEngine && window.__simEngine.state.scenario));
}
const header = (page, title) => page.locator('[data-section] > div > button[aria-expanded]', { hasText: title });

test('sections: closed ones show a summary, open on click, and are remembered on this device', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await startScenario(page, 'Adult Medical', 'Anaphylaxis (Adult)');

  const monitoring = header(page, 'Monitoring & access');
  await expect(monitoring).toHaveAttribute('aria-expanded', 'false');
  await expect(monitoring).toContainText('Nothing attached');
  await expect(page.getByRole('button', { name: /ECG electrodes/i })).toHaveCount(0);
  // One-press attach stays on the closed header
  await page.locator('[data-section="monitoring"]').getByRole('button', { name: 'Attach standard' }).click();
  await expect(monitoring).toContainText('Standard on');
  await monitoring.click();
  await expect(monitoring).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: /ECG electrodes/i })).toBeVisible();

  // Open by default: Rhythm & resus; closed by default: Patient condition (Trend buttons still usable)
  await expect(header(page, 'Rhythm & resus')).toHaveAttribute('aria-expanded', 'true');
  await expect(header(page, 'Patient condition')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('[data-section="condition"]').getByRole('button', { name: 'Worse' }).click();
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.log.some(l => /Patient Deteriorating \(Trend\)/.test(l.msg)))).toBe(true);

  // Another session on this device: the section opens as the facilitator left it
  const second = await page.context().newPage();
  await openController(second);
  await startScenario(second, 'Adult Medical', 'SVT (Adult)');
  await expect(header(second, 'Monitoring & access')).toHaveAttribute('aria-expanded', 'true');
  await expect(header(second, 'Patient condition')).toHaveAttribute('aria-expanded', 'false');
  expect(errors).toEqual([]);
});

test('core obs, More obs, one drug panel, and no duplicated recommended actions', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await startScenario(page, 'Adult Medical', 'Anaphylaxis (Adult)');
  // Core six are big tiles; More obs has GCS and glucose (Simple view), plus pH and K+ in Full view
  for (const label of ['HR', 'BP', 'SpO2', 'RR', 'Temp', 'ETCO2']) await expect(page.getByRole('button', { name: `Adjust ${label}` }).last()).toBeVisible();
  const more = page.locator('[data-section="moreObs"]');
  for (const label of ['GCS', 'Glucose']) await expect(more.getByRole('button', { name: `Adjust ${label}` })).toBeVisible();
  for (const label of ['pH', 'K+']) await expect(more.getByRole('button', { name: `Adjust ${label}` })).toHaveCount(0);
  await page.getByTestId('view-mode').getByRole('button', { name: 'Full' }).click();
  for (const label of ['GCS', 'Glucose', 'pH', 'K+']) await expect(more.getByRole('button', { name: `Adjust ${label}` })).toBeVisible();

  // Each recommended action appears once in the Common tab
  const rec = await page.evaluate(() => window.__simEngine.state.scenario.recommendedActions.filter(k => window.INTERVENTIONS[k]).map(k => window.INTERVENTIONS[k].label));
  for (const label of rec) await expect(page.locator('button[title]').filter({ hasText: new RegExp('^' + label.replace(/[()+.]/g, '\\$&')) })).toHaveCount(1);

  // A drug shows in ONE "Drugs on board" panel
  await page.evaluate(() => { const e = window.__simEngine; e.applyIntervention('IV Access'); e.applyIntervention('AdrenalineIM'); });
  await expect(page.locator('[data-section="drugs"]')).toContainText('Drugs on board (1)');
  await expect(page.getByText(/Active drugs/i)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Simple / Full: Simple is the default, hides the extras, and is remembered on this device', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await startScenario(page, 'Adult Medical', 'Anaphylaxis (Adult)');
  const view = page.getByTestId('view-mode');
  await expect(view.getByRole('button', { name: 'Simple' })).toHaveAttribute('aria-pressed', 'true');
  await expandSection(page, 'monitoring');
  await expect(page.getByRole('button', { name: '+ Invasive' })).toHaveCount(0);
  // Drug-timing detail ("starts in", "peaks in", what it will do) is Full view only
  await page.evaluate(() => { const e = window.__simEngine; e.applyIntervention('IV Access'); e.applyIntervention('Paracetamol'); });
  const drugs = page.locator('[data-section="drugs"]');
  await expect(drugs).toBeVisible();
  await expect(drugs).not.toContainText(/starts in|peaks in/);

  await view.getByRole('button', { name: 'Full' }).click();
  await expect(view.getByRole('button', { name: 'Full' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '+ Invasive' })).toBeVisible();
  await expect(drugs).toContainText(/starts in|peaks in/);

  // Another session on this device opens in Full view
  const second = await page.context().newPage();
  await openController(second);
  await startQuickSim(second);
  await expect(second.getByTestId('view-mode').getByRole('button', { name: 'Full' })).toHaveAttribute('aria-pressed', 'true');
  await expect(second.getByTestId('presets').getByRole('button', { name: '+ Save current' })).toBeVisible();
  // ...and switching it back to Simple there changes this page too
  await second.getByTestId('view-mode').getByRole('button', { name: 'Simple' }).click();
  await expect(second.getByTestId('presets').getByRole('button', { name: '+ Save current' })).toHaveCount(0);
  await expect(second.getByTestId('presets').getByRole('button', { name: /presets in Full view/ })).toBeVisible();
  await expect(view.getByRole('button', { name: 'Simple' })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('Defib Sim controller: settings, pacing and drugs start closed with a summary; RCUK prompts stay visible', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await page.getByRole('button', { name: 'Defib Sim', exact: true }).click();
  await page.locator('[data-defib-scenario="vf-arrest"]').click();
  await page.getByRole('button', { name: 'Start Defib Sim' }).click();
  for (const [id, summary] of [['defibShock', /Realistic model|Auto/], ['defibPacing', /Threshold \d+ mA · no artefacts/], ['defibDrugs', 'Adrenaline 0 · Amiodarone 0']]) {
    const head = page.locator(`[data-section="${id}"] > div > button[aria-expanded]`);
    await expect(head).toHaveAttribute('aria-expanded', 'false');
    await expect(head).toContainText(summary);
  }
  await expect(page.locator('[data-rhythm="VF"]')).toBeVisible();          // rhythm stays open
  await expect(page.getByTestId('arrest-status')).toBeVisible();            // arrest stays open
  await expect(page.getByTestId('defib-log')).toBeVisible();                // log stays open
  await page.getByRole('button', { name: 'START', exact: true }).click();
  await page.evaluate(() => { const s = window.__simEngine; s.setDefibSettings({ shockResponse: 'never' }); for (let i = 0; i < 3; i++) s.deliverShock(150, 'test'); });
  await expect(page.getByTestId('drug-prompts')).toContainText('Adrenaline 1 mg IV due');
  await expect(page.locator('[data-section="defibShock"] > div > button')).toContainText('Never converts');
  expect(errors).toEqual([]);
});

test('the event log is always on screen: notes, flags, and the full log', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await startScenario(page, 'Adult Medical', 'Anaphylaxis (Adult)');
  const log = page.getByTestId('event-log');
  await log.getByLabel('Note for the log').fill('Team leader identified');
  await log.getByRole('button', { name: 'Add note' }).click();
  await expect(log).toContainText('Team leader identified');
  await log.getByRole('button', { name: /^Flag log entry/ }).first().click();
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.log.slice(-1)[0].flagged)).toBe(true);
  await log.getByRole('button', { name: 'Full log' }).click();
  await expect(page.getByRole('dialog')).toContainText('Team leader identified');
  expect(errors).toEqual([]);
});

test('Screens and Tools menus hold the tools that used to crowd the top bar', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await startScenario(page, 'Adult Medical', 'Anaphylaxis (Adult)');
  await page.getByRole('button', { name: /^Screens/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Join by QR code' })).toBeVisible();
  // One patient screen by default: it opens in its own window
  const [win] = await Promise.all([context.waitForEvent('page'), page.getByRole('menuitem', { name: /^Open the patient screen/ }).click()]);
  await win.waitForLoadState();
  expect(win.url()).toMatch(new RegExp(`\\?mode=monitor&session=${code}$`));
  await page.bringToFront();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.getByRole('button', { name: /^Tools/ }).click();
  await page.getByRole('menuitem', { name: 'Mute alarms' }).click();
  await expect(page.getByRole('button', { name: 'Unmute alarms' })).toBeVisible();   // muted stays visible
  await page.getByRole('button', { name: /^Tools/ }).click();
  await page.getByRole('menuitem', { name: 'Timer alerts' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(errors).toEqual([]);
});

test('accessibility: the scenario controller, with sections open and closed', async ({ page }) => {
  await openController(page);
  await startScenario(page, 'Adult Medical', 'Anaphylaxis (Adult)');
  await page.evaluate(() => { const e = window.__simEngine; e.applyIntervention('IV Access'); e.applyIntervention('AdrenalineIM'); });
  await page.waitForTimeout(3600);   // the "administered" pop-up fades out after 3 s; axe would catch it mid-fade
  for (const round of ['default', 'all open', 'full view']) {
    if (round === 'full view') await page.getByTestId('view-mode').getByRole('button', { name: 'Full' }).click();
    if (round === 'all open') {
      const closed = page.locator('[data-section] > div > button[aria-expanded="false"]');
      for (let n = 0; n < 12 && await closed.count() > 0; n++) await closed.first().click();
      await expect(closed).toHaveCount(0);
    }
    await page.waitForTimeout(700);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const bad = r.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
      .map(v => `${round}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`);
    expect(bad).toEqual([]);
  }
});

test('accessibility: the Defib Sim controller with every section open', async ({ page }) => {
  await openController(page);
  await page.getByRole('button', { name: 'Defib Sim', exact: true }).click();
  await page.locator('[data-defib-scenario="vf-arrest"]').click();
  await page.getByRole('button', { name: 'Start Defib Sim' }).click();
  for (const id of ['defibShock', 'defibPacing', 'defibDrugs']) await expandSection(page, id);
  await page.waitForTimeout(700);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = r.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
    .map(v => `${v.id} (${v.impact}) ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`);
  expect(bad).toEqual([]);
});
