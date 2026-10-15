const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, pressStart, live, expect } = require('./helpers');

// Facilitator-chosen monitor trace variations (data/screens/traceoptions.js): ECG artefact, pleth
// styles, arterial line damping and the fast-flush test. The shapes live in data/rhythms.js.

test.describe('trace variation shapes', () => {
  let errors;
  test.beforeEach(async ({ page, context }) => {
    await useFakeFirebase(context);
    errors = trackErrors(page);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.RHYTHMS);
  });
  test.afterEach(() => expect(errors).toEqual([]));

  // One beat of a pulse trace, sampled finely
  const beat = (page, kind, style) => page.evaluate(([kind, style]) => {
    const ys = [];
    for (let i = 0; i < 2000; i++) ys.push(window.RHYTHMS.pulseValue(kind, i / 2000, 'Sinus Rhythm', { hr: 60, beat: 5, style }));
    let peak = -1e9, at = 0;
    ys.forEach((y, i) => { if (y > peak) { peak = y; at = i; } });
    // Turning points after the peak: ringing shows many, a smooth decay none
    let turns = 0;
    for (let i = at + 2; i < ys.length - 1; i++) if ((ys[i] - ys[i - 1]) * (ys[i + 1] - ys[i]) < 0) turns++;
    return { peak, turns };
  }, [kind, style]);

  test('poor perfusion gives a small pleth; damping changes the arterial wave', async ({ page }) => {
    const pleth = await beat(page, 'pleth', 'normal');
    const poor = await beat(page, 'pleth', 'poor');
    expect(poor.peak).toBeLessThan(pleth.peak * 0.4);
    expect(poor.turns).toBe(0);                       // no dicrotic notch

    const art = await beat(page, 'art', 'normal');
    const over = await beat(page, 'art', 'overdamped');
    const under = await beat(page, 'art', 'underdamped');
    expect(over.peak).toBeLessThan(art.peak);
    expect(over.turns).toBe(0);                       // blunted, no notch
    expect(under.peak).toBeGreaterThan(art.peak * 1.2);
    expect(under.turns).toBeGreaterThan(art.turns + 2); // ringing
  });

  test('the displayed ABP moves with damping but the mean does not', async ({ page }) => {
    const r = await page.evaluate(() => ['normal', 'overdamped', 'underdamped'].map(s => window.RHYTHMS.artDisplayBias(s)));
    expect(r[0]).toEqual({ sys: 0, dia: 0 });
    expect(r[1].sys).toBeLessThan(0);
    expect(r[2].sys).toBeGreaterThan(0);
    for (const b of r) expect(Math.abs(b.sys + 2 * b.dia)).toBeLessThanOrEqual(1);
  });

  test('the flush test rings once or twice when normal, many times when underdamped, never when overdamped', async ({ page }) => {
    const r = await page.evaluate(() => {
      const count = (style) => {
        let n = 0, prev = 1;
        for (let x = 0; x < 1.5; x += 0.002) {
          const y = window.RHYTHMS.flushRelease(x, style);
          if (prev >= -0.03 && y < -0.03) n++;        // each visible dip below the baseline
          prev = y;
        }
        return n;
      };
      return { normal: count('normal'), under: count('underdamped'), over: count('overdamped') };
    });
    expect(r.normal).toBeGreaterThanOrEqual(1);
    expect(r.normal).toBeLessThanOrEqual(2);
    expect(r.under).toBeGreaterThanOrEqual(4);
    expect(r.over).toBe(0);
  });

  test('ECG artefact: lead off flattens the monitor lead but not the pads', async ({ page }) => {
    const r = await page.evaluate(() => {
      const RG = window.RHYTHMS;
      return {
        lead: RG.ecgArtefact({ leadoff: true }, 3, 'II'),
        pads: RG.ecgArtefact({ leadoff: true }, 3, 'PADS'),
        clean: RG.ecgArtefact({}, 3, 'II'),
        tremor: Math.max(...Array.from({ length: 200 }, (_, i) => Math.abs(RG.ecgArtefact({ tremor: true }, i / 100, 'II').add)))
      };
    });
    expect(Math.abs(r.lead.replace)).toBeLessThan(2);
    expect(r.pads).toEqual({ add: 0 });
    expect(r.clean).toEqual({ add: 0 });
    expect(r.tremor).toBeGreaterThan(3);
  });
});

test('controller picks a trace variation and the room monitor shows it', async ({ page, context }) => {
  await useFakeFirebase(context);
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  await page.evaluate(() => {
    const e = window.__simEngine;
    e.dispatch({ type: 'ATTACH_SENSORS', payload: ['Obs'] });
    e.applyIntervention('ArtLine');
  });
  await pressStart(page);
  await page.evaluate(() => window.__simEngine.manualUpdateVitals({ bpSys: 120, bpDia: 70 }));

  // Pleth: SpO2 window
  await page.getByRole('button', { name: 'Adjust SpO2' }).last().click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('[data-trace="pleth-poor"]').click();
  await expect(dialog.locator('[data-trace="pleth-poor"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => live(page, code, '/noise/pleth')).toBe('poor');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // Arterial line: BP window, underdamped, then a flush
  await page.getByRole('button', { name: 'Adjust BP' }).last().click();
  await dialog.locator('[data-trace="art-underdamped"]').click();
  await expect.poll(() => live(page, code, '/noise/art')).toBe('underdamped');
  await dialog.locator('[data-trace="art-flush"]').click();
  await expect.poll(() => live(page, code, '/noise/artFlush')).toBe(1);
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // ECG: HR window, lead off
  await page.getByRole('button', { name: 'Adjust HR', exact: true }).last().click();
  await dialog.locator('[data-trace="ecg-leadoff"]').click();
  await expect.poll(() => live(page, code, '/noise/leadoff')).toBe(true);
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  const monitor = await context.newPage();
  const monErrors = trackErrors(monitor);
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  await expect(monitor.getByTestId('pleth-poor-signal')).toBeVisible();
  await expect(monitor.getByTestId('ecg-check-leads')).toBeVisible();
  // Underdamped: systolic over-reads by 20, diastolic under-reads by 10 (the true BP is unchanged)
  await expect.poll(async () => (await monitor.getByTestId('obs-abp').textContent()).trim()).toBe('140/60');
  expect(await page.evaluate(() => window.__simEngine.state.vitals.bpSys)).toBe(120);

  // Back to normal clears the labels and the ABP offset
  await page.evaluate(() => window.__simEngine.setNoise({ pleth: 'normal', art: 'normal', leadoff: false }));
  await expect(monitor.getByTestId('pleth-poor-signal')).toHaveCount(0);
  await expect(monitor.getByTestId('ecg-check-leads')).toHaveCount(0);
  await expect.poll(async () => (await monitor.getByTestId('obs-abp').textContent()).trim()).toBe('120/70');
  expect(errors).toEqual([]);
  expect(monErrors).toEqual([]);
});
