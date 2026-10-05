// Capnography: the capnogram's shape and timing (RHYTHMS.capnogram), and that every screen that
// shows capnography draws it: the room monitor (normal and arrest views), the controller strip and
// the defib tablet.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, live, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

// Sample one breath at `rate` (100 samples per second) and describe it in seconds.
const breath = (page, args) => page.evaluate(({ E, pattern, severity, rate }) => {
  const R = window.RHYTHMS;
  const bt = R.breathTiming(rate);
  const N = Math.round(bt.T * 100);
  const ys = Array.from({ length: N }, (_, i) => R.capnogram(i / N, E, pattern, severity, rate));
  const at = (s) => ys[Math.min(N - 1, Math.max(0, Math.round(s * 100)))];
  // Time (s, from the start of expiration) the trace first reaches a fraction of the ETCO2
  const reach = (frac) => { for (let i = Math.round(bt.Ti * 100); i < N; i++) if (ys[i] >= frac * E) return i / 100 - bt.Ti; return null; };
  return { bt, N, min: Math.min(...ys), max: Math.max(...ys), first: ys[0], last: ys[N - 1], at: {
    down: at(0.3), insp: at(bt.Ti * 0.8), expStart: at(bt.Ti + 0.05) },
    t10: reach(0.10), t85: reach(0.85), t60: reach(0.60), t98: reach(0.98),
    plateauShare: ys.filter(y => y >= 0.98 * E).length / N,
    mid: at(bt.Ti + (bt.T - bt.Ti) * 0.3), ys };
}, args);

test.describe('the capnogram', () => {
  test.beforeEach(async ({ page }) => { await page.goto('/index.html'); });

  test('normal breath: downstroke at inspiration, zero baseline, steep upstroke, plateau ending at the ETCO2', async ({ page }) => {
    const b = await breath(page, { E: 5, pattern: 'normal', severity: 0, rate: 12 });
    expect(b.bt.T).toBeCloseTo(5, 5);
    expect(b.bt.Ti).toBeCloseTo(5 / 3, 5);                 // I:E 1:2
    expect(b.first).toBeCloseTo(5, 5);                      // inspiration starts from the end-tidal value
    expect(b.at.down).toBe(0);                              // and is back to zero within 0.3 s
    expect(b.at.insp).toBe(0);                              // phase I: inspiratory baseline
    expect(b.at.expStart).toBe(0);                          // dead-space gas leaves first
    expect(b.t85 - b.t10).toBeLessThan(0.4);                // phase II: steep upstroke
    expect(b.mid).toBeGreaterThan(4.4);                     // phase III: plateau...
    expect(b.mid).toBeLessThan(5);                          // ...with a slight upslope
    expect(b.last).toBeCloseTo(5, 5);                       // measured at the end of expiration
    expect(b.max).toBeCloseTo(5, 5);
  });

  test('the upstroke takes the same time at any rate; a slow rate widens the plateau', async ({ page }) => {
    const fast = await breath(page, { E: 4, pattern: 'normal', severity: 0, rate: 30 });
    const slow = await breath(page, { E: 7, pattern: 'normal', severity: 0, rate: 6 });
    for (const b of [fast, slow]) expect(b.t85 - b.t10).toBeLessThan(0.4);
    expect(slow.bt.Ti).toBeCloseTo(1.7, 5);                 // inspiration does not stretch past ~1.7 s
    expect(slow.plateauShare).toBeGreaterThan(0.4);         // a long expiratory pause holds the plateau
    expect(fast.plateauShare).toBeLessThan(0.3);
  });

  test('bronchospasm: a shark fin with no flat plateau, still ending at the ETCO2', async ({ page }) => {
    const b = await breath(page, { E: 6, pattern: 'bronchospastic', severity: 1, rate: 20 });
    expect(b.t60).toBeGreaterThan(0.5);                     // slurred, slow rise
    expect(b.mid).toBeLessThan(0.85 * 6);                   // still climbing well into expiration
    const exp = b.ys.slice(Math.round(b.bt.Ti * 100) + 20);
    for (let i = 1; i < exp.length; i++) expect(exp[i]).toBeGreaterThanOrEqual(exp[i - 1] - 1e-9);
    expect(b.last).toBeGreaterThan(5.9);                    // the last sample is 0.01 s before the peak
    expect(b.max).toBeCloseTo(6, 1);
  });

  test('rebreathing does not return to zero; a curare cleft notches the plateau', async ({ page }) => {
    const reb = await breath(page, { E: 5, pattern: 'rebreathing', severity: 0, rate: 12 });
    expect(reb.min).toBeGreaterThan(0.5);
    const cur = await breath(page, { E: 5, pattern: 'curare', severity: 0, rate: 12 });
    const plateau = cur.ys.slice(Math.round((cur.bt.Ti + 0.6) * 100), Math.round(cur.bt.T * 100) - 10);
    expect(Math.min(...plateau)).toBeLessThan(0.8 * 5);
  });

  test('no gas movement, no capnogram; CPR ventilates at 10 a minute', async ({ page }) => {
    const r = await page.evaluate(() => {
      const R = window.RHYTHMS;
      return {
        apnoea: R.capnoVentilating([], 0, false),
        bagged: R.capnoVentilating(['Bagging'], 0, false),
        cpr: R.capnoVentilating([], 0, true),
        breathing: R.capnoVentilating([], 14, false),
        cprRate: R.capnoRate(0, true), ownRate: R.capnoRate(18, true)
      };
    });
    expect(r).toEqual({ apnoea: false, bagged: true, cpr: true, breathing: true, cprRate: 10, ownRate: 18 });
  });
});

test('room monitor: the capnogram lane in the normal view and the arrest view', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'TOGGLE_ETCO2' }));
  await expect.poll(() => live(page, code, '/etco2Enabled')).toBe(true);
  const monitor = await context.newPage();
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  await expect(monitor.getByText('0–8 kPa')).toBeVisible();
  await expect(page.getByText('0–8 kPa')).toBeVisible();          // controller strip too
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_ARREST_PANEL', payload: true }));
  await expect(monitor.getByTestId('arrest-capnogram')).toBeVisible();
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'TOGGLE_ETCO2' }));
  await expect(monitor.getByTestId('arrest-capnogram')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('defib tablet: capnogram and ETCO2 appear only while capnography is attached', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await page.getByRole('button', { name: 'Defib Sim', exact: true }).click();
  await page.locator('[data-defib-scenario="vf-arrest"]').click();
  await page.getByRole('button', { name: 'Start Defib Sim' }).click();
  const defib = await context.newPage();
  const defibErrors = trackErrors(defib);
  await defib.goto(`/defib/index.html?session=${code}`);
  await expect(defib.locator('#linkBanner')).toBeHidden();
  await defib.click('.mode-label[data-mode="defib"]');
  await expect(defib.locator('#co2Container')).toBeHidden();
  await expect(defib.locator('#etco2Display')).toHaveText('--');

  await page.getByRole('button', { name: 'Start CPR' }).click();
  await page.getByTestId('defib-capno').click();
  await expect(page.getByTestId('defib-capno')).toHaveAttribute('aria-pressed', 'true');
  await expect(defib.locator('#co2Container')).toBeVisible();
  await expect(defib.locator('#etco2Display')).not.toHaveText('--');
  await defib.waitForTimeout(2500);
  // Something has been drawn in the capnogram's colour
  const drawn = await defib.evaluate(() => {
    const c = document.getElementById('co2Canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] < 80) n++;
    return n;
  });
  expect(drawn).toBeGreaterThan(50);

  await page.getByTestId('defib-capno').click();
  await expect(defib.locator('#co2Container')).toBeHidden();
  expect(errors).toEqual([]);
  expect(defibErrors).toEqual([]);
});

test('the ETCO2 control offers every capnogram shape the monitor can draw', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await startQuickSim(page);
  await page.getByRole('button', { name: 'Adjust ETCO2' }).last().click();
  for (const [label, pattern] of [['Rebreathing', 'rebreathing'], ['Curare cleft', 'curare'], ['Obstructive', 'bronchospastic'], ['Force normal', 'nonobstructive'], ['Auto', 'normal']]) {
    await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__simEngine.state.etco2Pathology)).toBe(pattern);
  }
  expect(errors).toEqual([]);
});
