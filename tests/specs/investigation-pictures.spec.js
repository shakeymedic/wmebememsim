// A picture for every result (Jake, 29 Oct 2026): every scenario's X-ray, CT, POCUS, ECG and urine
// has a picture where one exists (INVESTIGATIONS.resolveResult), a Quick Sim with nothing set is
// normal, the 12-lead is drawn from the live rhythm when there is no real tracing that fits, and the
// controller's Normal button sends a normal result with its picture.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, pressStart, expect, openRightColumn } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

async function openMonitor(context, code) {
  const monitor = await context.newPage();
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  { const snd = monitor.getByText('Tap to Enable Sound'); if (await snd.count()) await snd.click({ force: true }); }
  await expect(monitor.getByText('Tap to Enable Sound')).toHaveCount(0);
  return monitor;
}
async function loadScenario(page, id) {
  await page.evaluate((id) => {
    const base = window.ALL_SCENARIOS.find(s => s.id === id);
    window.__simEngine.dispatch({ type: 'LOAD_SCENARIO', payload: base });
  }, id);
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.scenario && window.__simEngine.state.scenario.id)).toBe(id);
  await openRightColumn(page);
}

test('every scenario result resolves, and every normal or untold result has a picture', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.INVESTIGATIONS && window.ALL_SCENARIOS && window.ALL_SCENARIOS.length > 0);
  const r = await page.evaluate(() => {
    const I = window.INVESTIGATIONS, bad = [], noPicture = [];
    for (const s of window.ALL_SCENARIOS) {
      const age = s.ageGenerator ? s.ageGenerator() : 40;
      for (const t of ['X-ray', 'CT', 'POCUS', 'ECG', 'Urine']) {
        const x = I.resolveResult(s, t, { rhythm: 'Sinus Rhythm', age });
        const pic = !!(x.image || x.images.length || x.live12 || x.urine);
        if (!x.text && !pic) bad.push(`${s.id} ${t}`);
        for (const k of [x.image].concat(x.images.map(i => i.key)).filter(Boolean)) if (!I.imageFor(k)) bad.push(`${s.id} ${t} missing image ${k}`);
        const f = I.FIELD[t], src = (s[f] && (typeof s[f] === 'string' || s[f].findings || s[f].image)) ? s[f] : (s.investigations || {})[f];
        // A normal (or untold) X-ray or CT always has a picture, except a child of 1 to 11 (no openly
        // licensed normal image of that age was found, so a written report)
        if ((t === 'X-ray' || t === 'CT') && I.isGenericNormal(t, src) && !pic && !(age >= 0.25 && age < 12) && !(t === 'CT' && age < 12)) noPicture.push(`${s.id} ${t}`);
      }
    }
    return { bad, noPicture, n: window.ALL_SCENARIOS.length };
  });
  expect(r.n).toBeGreaterThan(200);
  expect(r.bad).toEqual([]);
  expect(r.noPicture).toEqual([]);
});

test('normal pictures by age, the arrest heart, POCUS windows and the new scenario results', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.INVESTIGATIONS && window.ALL_SCENARIOS && window.ALL_SCENARIOS.length > 0);
  const r = await page.evaluate(() => {
    const I = window.INVESTIGATIONS, Q = window.buildQuickSimScenario;
    const by = (id) => window.ALL_SCENARIOS.find(s => s.id === id);
    const cxr = (age) => I.resolveResult(Q({ age }), 'X-ray', { rhythm: 'Sinus Rhythm', age });
    const quick = Q({ age: 40 });
    const all = Object.fromEntries(['X-ray', 'CT', 'POCUS', 'ECG', 'Urine'].map(t => [t, I.resolveResult(quick, t, { rhythm: 'Sinus Rhythm', age: 40 })]));
    return {
      adult: cxr(40).image, newborn: cxr(0.02).image, infant: cxr(0.5).image, child: cxr(6), teen: cxr(15).image,
      quick: all,
      vf: I.resolveResult(quick, 'POCUS', { rhythm: 'VF', age: 40 }),
      asystole: I.resolveResult(quick, 'POCUS', { rhythm: 'Asystole', age: 40 }),
      AT001: I.resolveResult(by('AT001'), 'X-ray', { rhythm: 'Sinus Rhythm', age: 40 }).image,
      AM052: I.resolveResult(by('AM052'), 'POCUS', { rhythm: 'Sinus Rhythm', age: 40 }).image,
      PS009: I.resolveResult(by('PS009'), 'Urine', { rhythm: 'Sinus Rhythm', age: 30 }).urine,
      AM063: I.resolveResult(by('AM063'), 'Urine', { rhythm: 'Sinus Rhythm', age: 30 }).urine,
      normalPtx: I.resolveResult(by('AM031'), 'X-ray', { rhythm: 'Sinus Rhythm', age: 40 }, { normal: true }).image,
      ownPtx: I.resolveResult(by('AM031'), 'X-ray', { rhythm: 'Sinus Rhythm', age: 40 }).image
    };
  });
  expect(r.adult).toBe('cxr-normal');
  expect(r.teen).toBe('cxr-normal');
  expect(r.newborn).toBe('cxr-normal-neonate');
  expect(r.infant).toBe('cxr-normal-infant');
  expect(r.child.image).toBe(null);
  expect(r.child.text).toMatch(/normal for age/i);
  // A Quick Sim: everything normal, each with a picture
  expect(r.quick['X-ray'].image).toBe('cxr-normal');
  expect(r.quick.CT.image).toBe('ct-normal-head');
  expect(r.quick.ECG.live12).toBe(true);
  expect(r.quick.Urine.urine).toBeTruthy();
  expect(r.quick.Urine.urine.nitrites).toMatch(/neg|-/i);
  expect(r.quick.POCUS.images.map(i => i.key)).toEqual(expect.arrayContaining(['us-echo-a4c', 'us-lung-sliding', 'us-fast-negative']));
  // In an arrest the heart window says so, and does not show a beating heart
  expect(r.vf.text).toMatch(/quivering/i);
  expect(r.vf.images.map(i => i.key)).not.toContain('us-echo-a4c');
  expect(r.asystole.text).toMatch(/no cardiac (motion|activity)|standstill/i);
  // Scenario results added
  expect(r.AT001).toBe('cxr-haemothorax');
  expect(r.AM052).toBe('us-fast-positive-2');
  expect(r.PS009.nitrites).toBe('+');
  expect(r.AM063.blood).toMatch(/\+\+\+/);
  // Normal overrides the scenario; the scenario's own result stays otherwise
  expect(r.normalPtx).toBe('cxr-normal');
  expect(r.ownPtx).toBe('cxr-ptx-tension');
});

test('Quick Sim on the monitor: drawn 12-lead at the live rate, dipstick, POCUS tabs, normal CXR', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  await pressStart(page);
  const monitor = await openMonitor(context, code);
  const monErrors = trackErrors(monitor);
  const card = monitor.getByTestId('inv-result');
  const close = async () => { const c = monitor.getByTestId('inv-result-close'); if (await c.isVisible()) await c.click(); };

  await page.evaluate(() => window.__simEngine.revealInvestigation('ECG', null));
  await expect(card.getByTestId('inv-ecg-live')).toBeVisible();
  // Drawn at the patient's rate at that moment
  const hr = await monitor.evaluate(() => window.__monitorEngine.state.vitals.hr);
  const drawn = Number(await card.getByTestId('inv-ecg-live').getAttribute('data-hr'));
  expect(Math.abs(drawn - hr)).toBeLessThanOrEqual(10);
  await card.getByTestId('inv-ecg-live').click();
  await expect(monitor.getByTestId('inv-ecg-live-full')).toBeVisible();
  await monitor.getByTestId('inv-ecg-live-full').click();
  await close();

  await page.evaluate(() => window.__simEngine.revealInvestigation('Urine', null));
  await expect(card.getByTestId('urine-dipstick')).toBeVisible();
  await expect(card.getByTestId('dip-nitrites')).toContainText(/Negative/i);
  await close();

  await page.evaluate(() => window.__simEngine.revealInvestigation('POCUS', null));
  await expect(card.getByTestId('inv-image-tabs')).toBeVisible();
  await card.getByTestId('inv-image-tabs').getByRole('button', { name: 'Lungs' }).click();
  await expect(card.getByTestId('inv-image')).toHaveAttribute('src', /us-lung-sliding/);
  await close();

  await page.evaluate(() => window.__simEngine.revealInvestigation('X-ray', null));
  await expect(card.getByTestId('inv-image')).toHaveAttribute('src', 'images/investigations/cxr-normal.jpg');
  expect(errors).toEqual([]);
  expect(monErrors).toEqual([]);
});

test('the Normal button sends a normal result with its picture, and a normal gas', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  await loadScenario(page, 'AM031');   // tension pneumothorax
  await pressStart(page);
  const monitor = await openMonitor(context, code);
  await page.getByRole('button', { name: 'Investigations', exact: true }).click();
  await page.getByRole('button', { name: 'Send X-ray' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Normal', exact: true }).click();
  const card = monitor.getByTestId('inv-result');
  await expect(card.getByTestId('inv-image')).toHaveAttribute('src', 'images/investigations/cxr-normal.jpg');
  await expect(card).not.toContainText('large right pneumothorax');
  await expect(card).not.toContainText('Normal / Unremarkable');

  const gas = await page.evaluate(async () => {
    window.__simEngine.revealInvestigation('VBG', null, { normal: true });
    await new Promise(r => setTimeout(r, 1500));
    return window.__simEngine.state.monitorPopup.customText;
  });
  expect(gas.__vbg).toBe(true);
  expect(gas.pH).toBeGreaterThanOrEqual(7.35);
  expect(gas.pH).toBeLessThanOrEqual(7.45);
  expect(gas.K).toBeGreaterThanOrEqual(3.5);
  expect(gas.K).toBeLessThanOrEqual(5.3);
});
