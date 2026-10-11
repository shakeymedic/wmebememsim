// The Dräger Atlan A350 anaesthetic machine (vent/a350.html, generated from vent/c6.html by
// scripts/make-a350.mjs): the Anaesthetics / ICU card's default machine, the machine check, the
// breathing system (bag, APL valve, fresh gas) and the ventilator's modes.
const { test } = require('@playwright/test');
const { execFileSync } = require('child_process');
const path = require('path');
const { useFakeFirebase, trackErrors, openController, expandSection, live, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const logHas = (page, re) => page.evaluate((src) => window.__simEngine.state.log.some(l => new RegExp(src).test(l.msg)), re.source);
const state = (dev) => dev.evaluate(() => window.__vent.ventStateNow());

/* the Anaesthetics / ICU card on the A350 with one scenario, and a ventilator tablet linked to it */
async function startOnA350(page, context, scenario) {
  const code = await openController(page);
  await page.getByRole('button', { name: 'Anaesthetics / ICU', exact: true }).click();
  await expect(page.locator('[data-vent-device="a350"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('vent-setup')).toContainText('Dräger Atlan A350');
  await page.locator(`[data-vent-scenario="${scenario}"]`).click();
  await page.getByRole('button', { name: 'Start anaesthetic machine scenario' }).click();
  await expect.poll(() => live(page, code, '/vent/model')).toBe('a350');
  const dev = await context.newPage();
  const devErrors = trackErrors(dev);
  await dev.goto(`/vent/index.html?session=${code}`);
  await expect(dev).toHaveURL(new RegExp(`/vent/a350\\.html\\?session=${code}$`), { timeout: 10000 });
  await expect(dev.locator('#linkBanner')).toBeHidden({ timeout: 10000 });
  await expect(dev.locator('.title')).toHaveText('Atlan A350');
  return { code, dev, devErrors };
}
async function switchOn(dev) {
  await dev.locator('#kPower').click();
  await expect(dev.locator('#sbpage')).toContainText('Standby', { timeout: 10000 });
}
async function squeezeBag(dev, ms) {
  await dev.locator('#bag').dispatchEvent('pointerdown', { pointerId: 1 });
  await dev.waitForTimeout(ms);
  await dev.locator('#bag').dispatchEvent('pointerup', { pointerId: 1 });
}

test('vent/a350.html is up to date with the C6 page and scripts/a350/', () => {
  execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'make-a350.mjs'), '--check']);
});

test('the machine check: the leak test fails with the breathing system open and passes with the Y-piece sealed', async ({ page, context }) => {
  const errors = trackErrors(page);
  const { dev, devErrors } = await startOnA350(page, context, 'an-arrest');
  await switchOn(dev);
  await expect(dev.locator('.sb-ready')).toHaveClass(/yellow/);
  await dev.locator('#sbpage').getByRole('button', { name: 'Tests...' }).click();
  await dev.locator('[data-test="leak"]').click();
  await expect(dev.locator('#tcMsg')).toContainText('breathing system is open', { timeout: 10000 });
  await dev.locator('#ypiece').click();
  await dev.locator('[data-test="leak"]').click();
  await expect(dev.locator('#tcMsg')).toContainText('Leak test passed', { timeout: 30000 });
  await expect.poll(() => state(dev).then(s => s.tests)).toBe('system not done, leak ok');
  expect(await logHas(page, /Leak test failed/)).toBe(true);
  expect(await logHas(page, /Leak test passed/)).toBe(true);
  expect(errors).toEqual([]);
  expect(devErrors).toEqual([]);
});

test('Man/Spon: a squeeze of the bag ventilates, and a closed APL valve with a high flow fills the circuit', async ({ page, context }) => {
  const errors = trackErrors(page);
  const { code, dev, devErrors } = await startOnA350(page, context, 'an-arrest');
  await switchOn(dev);
  await dev.locator('#qsMan').click();
  await expect.poll(() => state(dev).then(s => s.state)).toBe('ventilating');
  expect((await state(dev)).mode).toBe('MAN');
  await squeezeBag(dev, 1500);
  await dev.waitForTimeout(2500);
  const s = await state(dev);
  expect(s.mon.vte).toBeGreaterThan(150);
  expect(s.mon.ppeak).toBeGreaterThan(10);
  await expandSection(page, 'vent');
  await expect(page.getByTestId('vent-mirror')).toContainText('Atlan A350');
  // the APL valve at 70 and 10 L/min of fresh gas: the bag fills and the pressure climbs
  for (let i = 0; i < 8; i++) await dev.locator('#aplUp').click();
  await dev.evaluate(() => window.__vent.remoteCommand({ type: 'set', key: 'fgf', val: 10 }));
  await expect.poll(() => dev.evaluate(() => window.__vent.G.circP), { timeout: 30000 }).toBeGreaterThan(30);
  await expect.poll(() => state(dev).then(s => s.alarms), { timeout: 30000 }).toContain('Airway press. continuously high');
  // opening the APL valve to Spont lets it out
  for (let i = 0; i < 14; i++) await dev.locator('#aplDn').click();
  await expect.poll(() => dev.evaluate(() => window.__vent.G.circP), { timeout: 10000 }).toBeLessThan(2);
  expect(await logHas(page, /APL valve: Spont/)).toBe(true);
  await expect.poll(() => live(page, code, '/vent/model')).toBe('a350');
  expect(errors).toEqual([]);
  expect(devErrors).toEqual([]);
});

test('settings: touch, turn and press the knob to confirm; an unconfirmed change resets after 15 s; a new mode waits for the knob', async ({ page, context }) => {
  const { dev, devErrors } = await startOnA350(page, context, 'an-paw');
  await switchOn(dev);
  // in Standby a tab sets the mode straight away
  await dev.locator('[data-tabmode="VC"]').click();
  await dev.locator('#sbpage').getByRole('button', { name: 'Start...' }).click();
  await dev.locator('#knob').click();
  await expect.poll(() => state(dev).then(s => [s.state, s.mode])).toEqual(['ventilating', 'SCMV']);
  // RR 12 -> 13, confirmed with the knob
  await dev.locator('[data-scope="ctrl"][data-key="rate"]').click();
  await expect(dev.locator('[data-scope="ctrl"][data-key="rate"]')).toHaveClass(/sel/);
  await dev.locator('#kCW').click();
  await dev.locator('#knob').click();
  await expect.poll(() => dev.evaluate(() => window.__vent.V.set.rate)).toBe(13);
  expect(await logHas(page, /Setting changed: RR 13/)).toBe(true);
  // PEEP 3 -> 5, not confirmed: back to 3 after 15 s
  await dev.locator('[data-scope="ctrl"][data-key="peep"]').click();
  await dev.locator('#kCW').click(); await dev.locator('#kCW').click();
  await expect(dev.locator('[data-scope="ctrl"][data-key="peep"] .v')).toHaveText('5');
  await dev.waitForTimeout(16000);
  await expect(dev.locator('[data-scope="ctrl"][data-key="peep"] .v')).toHaveText('3');
  expect(await dev.evaluate(() => window.__vent.V.set.peep)).toBe(3);
  // PC: shown in light green until the knob confirms it
  await dev.locator('[data-tabmode="PC"]').click();
  await expect(dev.locator('[data-scope="draft"][data-key="pinsp"]')).toHaveClass(/avail/);
  expect((await state(dev)).mode).toBe('SCMV');
  await dev.locator('#knob').click();
  await expect.poll(() => state(dev).then(s => s.mode)).toBe('PCV+');
  expect(await logHas(page, /Mode changed VC-CMV → PC-CMV/)).toBe(true);
  await dev.waitForTimeout(8000);
  // Pinsp is the total pressure on the A350 (15), not above PEEP
  const s = await state(dev);
  expect(s.mon.ppeak).toBeGreaterThan(12);
  expect(s.mon.ppeak).toBeLessThan(18);
  await dev.screenshot({ path: test.info().outputPath('a350.png') });
  expect(devErrors).toEqual([]);
});

test('the gas: a sevoflurane dial and the fresh gas raise the end-tidal agent and show xMAC', async ({ page, context }) => {
  const { dev, devErrors } = await startOnA350(page, context, 'an-arrest');
  await switchOn(dev);
  await dev.locator('[data-tabmode="VC"]').click();
  await dev.locator('#sbpage').getByRole('button', { name: 'Start...' }).click();
  await dev.locator('#sbStart').click();
  await dev.evaluate(() => window.__vent.remoteCommand({ type: 'set', key: 'fgf', val: 6 }));
  for (let i = 0; i < 10; i++) await dev.locator('#vapUp').click();
  await expect.poll(() => dev.evaluate(() => window.__vent.G.etag), { timeout: 60000 }).toBeGreaterThan(0.5);
  await expect(dev.locator('#smp')).toContainText('xMAC');
  await expect(dev.locator('#smp')).toContainText('Sev');
  // FiO2 comes up towards 100% with O2 100% at 6 L/min
  await expect.poll(() => dev.evaluate(() => window.__vent.G.fio2), { timeout: 30000 }).toBeGreaterThan(40);
  expect(devErrors).toEqual([]);
});

test('hints and the Education guide: hover shows what a control is, "Change mode to PC-SIMV" points at each step, and Assessment hides the guide', async ({ page, context }) => {
  const errors = trackErrors(page);
  const { dev, devErrors } = await startOnA350(page, context, 'an-paw');
  await dev.setViewportSize({ width: 1400, height: 900 });
  // hover: a bubble says what the key is
  await dev.locator('#kPower').hover();
  await expect(dev.locator('.a-tip')).toBeVisible();
  await expect(dev.locator('.a-tip')).toContainText('On / Standby');
  await dev.mouse.move(2, 2);
  await expect(dev.locator('.a-tip')).toBeHidden();
  // the guide is open beside the machine in Education
  await expect(dev.locator('#guide')).toBeVisible();
  await expect(dev.locator('#guideBody')).toContainText('switched off');
  await switchOn(dev);
  await dev.locator('[data-tabmode="VC"]').click();
  await dev.locator('#sbpage').getByRole('button', { name: 'Start...' }).click();
  await dev.locator('#knob').click();
  await expect.poll(() => state(dev).then(s => s.mode)).toBe('SCMV');
  // How do I… change mode to PC-SIMV: the tab, then SIMV, then the knob
  await dev.locator('[data-task="mode:PSIMV+"]').click();
  await expect(dev.locator('[data-tabmode="PC"]')).toHaveClass(/g-hl/);
  await dev.locator('[data-tabmode="PC"]').click();
  await expect(dev.locator('[data-sync="simv"]')).toHaveClass(/g-hl/);
  await dev.locator('[data-sync="simv"]').click();
  await expect(dev.locator('#knob')).toHaveClass(/g-hl/);
  await expect(dev.locator('#knob')).toHaveClass(/confirm/);
  expect((await state(dev)).mode).toBe('SCMV');
  await dev.locator('#knob').click();
  await expect.poll(() => state(dev).then(s => s.mode)).toBe('PSIMV+');
  await expect(dev.locator('.g-hl')).toHaveCount(0);
  await dev.screenshot({ path: test.info().outputPath('a350-guide.png') });
  // Assessment: no guide
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_VENT_CONFIG', payload: { assess: true } }));
  await expect.poll(() => dev.evaluate(() => document.body.classList.contains('assess'))).toBe(true);
  await expect(dev.locator('#guide')).toBeHidden();
  expect(errors).toEqual([]);
  expect(devErrors).toEqual([]);
});

test('the new anaesthetic machine scenarios build and start on the A350', async ({ page, context }) => {
  const errors = trackErrors(page);
  await openController(page);
  const r = await page.evaluate(() => ['an-oeso', 'an-disc', 'an-check', 'an-lowflow', 'an-emergence'].map(id => {
    const s = window.VentSim.forDevice('a350').find(x => x.id === id);
    const b = window.VentSim.buildScenario({ scenario: id, device: 'a350' });
    const missing = (s.recommended || []).concat(s.stabilisers || []).filter(k => !window.INTERVENTIONS[k]);
    return { id, title: b.title, missing, probsOk: s.problems.concat(s.startProblems || []).every(p => window.VENT_PROFILES.PROBLEMS.some(x => x.id === p)) };
  }));
  for (const x of r) { expect(x.missing, x.id).toEqual([]); expect(x.probsOk, x.id).toBe(true); }
  expect(r.find(x => x.id === 'an-check').title).toBe('Anaesthetic machine: Machine check, pre-oxygenation and induction');
  const { dev, devErrors } = await startOnA350(page, context, 'an-lowflow');
  await switchOn(dev);
  await expect(dev.locator('#guideBody')).toContainText('Standby');
  expect(errors).toEqual([]);
  expect(devErrors).toEqual([]);
});

test('hand ventilation keeps working when the bag has filled up: a squeeze vents the excess through the APL valve', async ({ page, context }) => {
  const { dev, devErrors } = await startOnA350(page, context, 'an-arrest');
  await switchOn(dev);
  await dev.locator('#qsMan').click();
  await expect.poll(() => state(dev).then(s => s.state)).toBe('ventilating');
  // the bag overfull at the APL pressure (what 2 L/min does to it over a minute between squeezes)
  await dev.evaluate(() => { window.__vent.G.bag = 4.5; });
  await expect.poll(() => dev.evaluate(() => window.__vent.G.circP)).toBeGreaterThan(25);
  for (let i = 0; i < 2; i++) { await squeezeBag(dev, 1200); await dev.waitForTimeout(2500); }
  expect((await state(dev)).mon.vte).toBeGreaterThan(150);
  expect(await dev.evaluate(() => window.__vent.G.circP)).toBeLessThan(5);
  // Man/Spon is not reported as an invasive mode (a mask is fine), and the gas survives a reload
  expect((await state(dev)).phys.inv).toBe(0);
  await dev.evaluate(() => { window.__vent.G.fio2 = 87; window.__vent.G.etag = 1.9; });
  await dev.waitForTimeout(3500);
  await dev.reload();
  await expect(dev.locator('#linkBanner')).toBeHidden({ timeout: 10000 });
  expect(await dev.evaluate(() => window.__vent.G.fio2)).toBeGreaterThan(80);
  expect(await dev.evaluate(() => window.__vent.G.etag)).toBeGreaterThan(1.5);
  expect(devErrors).toEqual([]);
});

test('the ventilator debrief understands the A350: its system test, its mode names and CPAP/PSV', async ({ page }) => {
  await openController(page);
  const out = await page.evaluate(() => {
    const L = (s, msg) => ({ timeSeconds: s, msg });
    const run = (tg, log) => window.VentSim.assess({ scenario: { ventSim: { targets: tg } }, log, ventSamples: [], history: [] });
    const a = run({ vc: true }, [L(10, 'Ventilator: System test passed (tablet)'), L(20, 'Ventilator: Leak test passed (tablet)'),
      L(30, 'Ventilator: Therapy started (VC-CMV) (tablet)')]);
    const b = run({ spont: true }, [L(30, 'Ventilator: Therapy started (Man/Spon) (tablet)'), L(60, 'Ventilator: Mode changed Man/Spon → CPAP/PSV (tablet)')]);
    return { a: a.good.concat(a.improve).join(' | '), b: b.good.concat(b.improve).join(' | ') };
  });
  expect(out.a).toContain('Pre-use check done before connecting: system test and leak test');
  expect(out.a).toContain('A volume-controlled mode was used');
  expect(out.b).toContain('The trial was run on pressure support');
});

test('on a tablet: the guide starts closed below 1280 px, touch targets are at least 44 px, and upright the machine is stacked to fill the screen', async ({ page, context }) => {
  const { code, dev, devErrors } = await startOnA350(page, context, 'an-arrest');
  const open = async (w, h) => {
    const p = await context.newPage();
    await p.setViewportSize({ width: w, height: h });
    await p.goto(`/vent/a350.html?session=${code}`);
    await expect(p.locator('#linkBanner')).toBeHidden({ timeout: 10000 });
    return p;
  };
  await dev.close();
  // 1024 x 768 (a landscape tablet): the guide is closed until asked for
  const tab = await open(1024, 768);
  await expect(tab.locator('#guide')).toHaveClass(/closed/);
  await expect(tab.locator('#t1')).not.toHaveClass(/portrait/);
  await switchOn(tab);
  // every control answers a touch anywhere in a 44 x 44 px square centred on it (its drawing can be smaller);
  // a mode tab's square sits on its bottom edge (its touch area reaches up, not down over the settings)
  const hits = await tab.evaluate((sels) => sels.map(sel => {
    const el = document.querySelector(sel), r = el.getBoundingClientRect(), cx = r.left + r.width / 2;
    const cy = el.matches('.ttab') ? r.bottom - 22 : r.top + r.height / 2;
    const pts = [[cx - 21, cy], [cx + 21, cy], [cx, cy - 21], [cx, cy + 21]];
    return sel + ':' + pts.every(([x, y]) => { const at = document.elementFromPoint(x, y); return at && (at === el || el.contains(at)); });
  }), ['#vapDn', '#vapUp', '#auxDn', '#auxUp', '#aplDn', '#aplUp', '#kPower', '#kAudio', '#kLight', '#kFlush', '#o2sw', '[data-tabmode="PC"]', '[data-open="alarms"].mm', '#guideToggle']);
  expect(hits.filter(h => !h.endsWith(':true'))).toEqual([]);
  // the + button still works from the edge of its touch area
  const up = await tab.locator('#vapUp').boundingBox();
  await tab.mouse.click(up.x + up.width / 2 + 20, up.y + up.height / 2);
  await expect(tab.locator('#vapVal')).not.toHaveText('0');
  // the guide opens when asked for
  await tab.locator('#guideToggle').click();
  await expect(tab.locator('#guide')).not.toHaveClass(/closed/);
  await tab.locator('#guideToggle').click();   // (the choice is remembered: close it again for the next page)
  await expect(tab.locator('#guide')).toHaveClass(/closed/);
  await tab.close();

  // 768 x 1024 (upright): stacked, the machine fills the width, the gas panel sits under the screen
  const up2 = await open(768, 1024);
  await expect(up2.locator('#t1')).toHaveClass(/portrait/);
  const lay = await up2.evaluate(() => {
    const d = document.querySelector('#device').getBoundingClientRect(), s = document.querySelector('#t1scaler').getBoundingClientRect();
    const scr = document.querySelector('#screenbox').getBoundingClientRect(), hw = document.querySelector('.hw-vap').getBoundingClientRect();
    return { fillW: s.width / d.width, fillH: s.height / d.height, hwBelow: hw.top > scr.bottom, screenW: scr.width };
  });
  expect(lay.fillW).toBeGreaterThan(0.9);
  expect(lay.fillH).toBeGreaterThan(0.85);
  expect(lay.hwBelow).toBe(true);
  expect(lay.screenW).toBeGreaterThan(600);
  await up2.close();

  // 1366 x 768 (a laptop): the guide is open beside the machine
  await page.evaluate(() => localStorage.removeItem('wmebem_a350_guide'));
  const lap = await open(1366, 768);
  await expect(lap.locator('#guide')).not.toHaveClass(/closed/);
  expect(devErrors).toEqual([]);
});
