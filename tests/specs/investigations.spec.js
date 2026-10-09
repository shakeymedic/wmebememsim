// Investigation results: the image library (every image present, credited and openly licensed),
// each scenario's own results, and how a result with an image reaches the room monitor.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const OPEN_LICENCES = ['CC0', 'Public domain', 'CC BY 2.0', 'CC BY 3.0', 'CC BY 4.0', 'CC BY-SA 2.5', 'CC BY-SA 3.0', 'CC BY-SA 4.0'];

test('the library: every image exists, is credited and openly licensed; every mapping resolves', async ({ page, request }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.INVESTIGATIONS && window.ALL_SCENARIOS && window.ALL_SCENARIOS.length > 0);
  const lib = await page.evaluate(() => {
    const I = window.INVESTIGATIONS;
    const ids = new Set(window.ALL_SCENARIOS.map(s => s.id));
    return {
      images: Object.keys(I.IMAGES).map(k => ({ k, ...I.IMAGES[k] })),
      badFindingImages: Object.keys(I.FINDINGS).flatMap(t => I.FINDINGS[t].filter(f => f.image && !I.IMAGES[f.image]).map(f => f.id)),
      badMappings: Object.keys(I.SCENARIO_RESULTS).flatMap(id => Object.keys(I.SCENARIO_RESULTS[id]).filter(t => !I.byId[I.SCENARIO_RESULTS[id][t]] || I.byId[I.SCENARIO_RESULTS[id][t]].type !== t).map(t => `${id}:${t}`)),
      unknownScenarios: Object.keys(I.SCENARIO_RESULTS).filter(id => !ids.has(id))
    };
  });
  expect(lib.badFindingImages).toEqual([]);
  expect(lib.badMappings).toEqual([]);
  expect(lib.unknownScenarios).toEqual([]);
  expect(lib.images.length).toBeGreaterThan(30);
  for (const img of lib.images) {
    expect(OPEN_LICENCES, img.k).toContain(img.licence);
    expect(img.author, img.k).toBeTruthy();
    expect(img.source, img.k).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    const res = await request.get('/' + img.src);
    expect(res.status(), img.src).toBe(200);
    const b = await res.body();
    expect(b[0] === 0xff && b[1] === 0xd8, `${img.src} is a JPEG`).toBe(true);
    expect(b.length, `${img.src} size`).toBeLessThan(450 * 1024);
  }
});

test('scenario results: specific findings replace the generic normal, and known content bugs are fixed', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.ALL_SCENARIOS && window.ALL_SCENARIOS.length > 0);
  const r = await page.evaluate(() => {
    const S = Object.fromEntries(window.ALL_SCENARIOS.map(s => [s.id, s]));
    return {
      tension: S.AM031.chestXray, tensionInv: S.AM031.investigations.chestXray,
      pneumonia: S.AM002.investigations.chestXray.image,
      sah: S.AM020.investigations.ct.image,
      stemi: S.AM001.investigations.ecg.image, stemiType: S.AM001.investigations.ecg.type,
      chb: S.AM023.ecg.type, hyperk: S.AM004.ecg.type,
      // "Ischaemia" in a title no longer gives a perforated-duodenum CT
      perfCt: window.ALL_SCENARIOS.filter(s => /Ischaemia/.test(s.title) && /duodenum/i.test((s.investigations.ct || {}).findings || '')).map(s => s.id),
      clearCxr: window.ALL_SCENARIOS.filter(s => /Lung fields clear/.test((s.investigations.chestXray || {}).findings || '')).length
    };
  });
  expect(r.tension.image).toBe('cxr-ptx-tension');
  expect(r.tension.findings).toMatch(/right pneumothorax/);
  expect(r.tensionInv.image).toBe('cxr-ptx-tension');
  expect(r.pneumonia).toBe('cxr-pneumonia');
  expect(r.sah).toBe('ct-sah');
  expect(r.stemi).toBe('ecg-stemi-anterior-2');
  expect(r.stemiType).toBe('STEMI');
  expect(r.chb).toBe('Complete Heart Block');
  expect(r.hyperk).toBe('Hyperkalaemia');
  expect(r.perfCt).toEqual([]);
  expect(r.clearCxr).toBeLessThan(252);
});

async function loadScenario(page, id) {
  await page.evaluate((id) => {
    const base = window.ALL_SCENARIOS.find(s => s.id === id);
    window.__simEngine.dispatch({ type: 'LOAD_SCENARIO', payload: base });
  }, id);
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.scenario && window.__simEngine.state.scenario.id)).toBe(id);
}
async function openMonitor(context, code) {
  const monitor = await context.newPage();
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  // The sound overlay covers the monitor until tapped
  await monitor.getByText('Tap to Enable Sound').click({ force: true });   // it bounces, so never "stable"
  await expect(monitor.getByText('Tap to Enable Sound')).toHaveCount(0);
  return monitor;
}

test('the scenario X-ray reaches the monitor as a real image with its report and credit', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  await loadScenario(page, 'AM031');
  const monitor = await openMonitor(context, code);
  const monErrors = trackErrors(monitor);
  await page.evaluate(() => window.__simEngine.revealInvestigation('X-ray', null));
  const card = monitor.getByTestId('inv-result');
  await expect(card.getByTestId('inv-image')).toHaveAttribute('src', 'images/investigations/cxr-ptx-tension.jpg');
  await expect(card).toContainText('large right pneumothorax');
  await expect(card).toContainText('Hellerhoff, CC BY-SA 3.0');
  await card.getByTestId('inv-image').click();
  await expect(monitor.getByTestId('inv-image-full')).toBeVisible();
  // The team can order it too, from the monitor
  await monitor.getByTestId('inv-image-full').click();
  expect(errors).toEqual([]);
  expect(monErrors).toEqual([]);
});

test('the facilitator can send a library image without its report', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  await loadScenario(page, 'AM002');
  const monitor = await openMonitor(context, code);
  await page.evaluate(() => window.__simEngine.revealInvestigation('X-ray', 'report text', { image: 'cxr-copd', hideReport: true }));
  const card = monitor.getByTestId('inv-result');
  await expect(card.getByTestId('inv-image')).toHaveAttribute('src', 'images/investigations/cxr-copd.jpg');
  await expect(card).not.toContainText('report text');
});

test('a real 12-lead shows only while the rhythm still fits it', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  await loadScenario(page, 'AM001');
  const monitor = await openMonitor(context, code);
  await monitor.getByRole('button', { name: /12-Lead/ }).click();
  await expect(monitor.getByTestId('ecg-12lead-image')).toHaveAttribute('src', 'images/investigations/ecg-stemi-anterior-2.jpg');
  await monitor.getByTestId('ecg-12lead-image').click();
  // Sent as a result, the ECG card shows the same tracing with the report written for it
  await page.evaluate(() => window.__simEngine.revealInvestigation('ECG', null));
  const card = monitor.getByTestId('inv-result');
  await expect(card.getByTestId('inv-image')).toHaveAttribute('src', 'images/investigations/ecg-stemi-anterior-2.jpg');
  await expect(card).toContainText('greatest in V3');
  await monitor.getByRole('button', { name: 'Dismiss investigation result' }).click();
  await page.evaluate(() => window.__simEngine.triggerArrest('VF'));
  await expect.poll(() => monitor.evaluate(() => window.__monitorEngine.state.rhythm)).toMatch(/VF/);
  await monitor.getByRole('button', { name: /12-Lead/ }).click();
  await expect(monitor.getByTestId('ecg-12lead-image')).toHaveCount(0);
  await expect(monitor.locator('canvas[width="1000"]')).toBeVisible();
});

test('the controller previews the scenario result and lists image results', async ({ page }) => {
  await openController(page);
  await startQuickSim(page);
  await loadScenario(page, 'AM031');
  await page.evaluate(() => window.__simEngine.start());
  await page.getByRole('button', { name: 'Investigations', exact: true }).click();
  await page.getByRole('button', { name: 'Send X-ray' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByTestId('inv-scenario-preview')).toContainText('large right pneumothorax');
  await expect(dlg.getByTestId('inv-library').getByRole('button')).not.toHaveCount(0);
  await expect(dlg.getByText(/Show the written report with the image/)).toBeVisible();
});
