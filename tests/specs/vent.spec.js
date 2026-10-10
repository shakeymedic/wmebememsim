// The HAMILTON-T1 ventilator (vent/index.html): on its own tablet or on the room monitor, linked to
// the session like the defib tablet. Phase 1: it joins, reports to the log, mirrors to the
// controller and takes its lungs from the controller.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, expandSection, session, live, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const logHas = (page, re) => page.evaluate((src) => window.__simEngine.state.log.some(l => new RegExp(src).test(l.msg)), re.source);

async function openVent(context, code) {
  const vent = await context.newPage();
  const errors = trackErrors(vent);
  await vent.goto(`/vent/index.html?session=${code}`);
  await expect(vent.locator('#linkBanner')).toBeHidden({ timeout: 10000 });
  return { vent, errors };
}
// Power on, wait for the self-test, then start ventilation from Standby (the Power/Standby key).
async function startVentilating(dev) {
  await dev.locator('#kPower').click();
  // the self-test takes about 4 s and ends on the Standby window
  await expect(dev.getByRole('button', { name: 'Start ventilation' })).toBeVisible({ timeout: 10000 });
  await dev.locator('#kPower').click();
}

test('a ventilator tablet joins by session code, reports to the log and mirrors to the controller', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  const { vent, errors: ventErrors } = await openVent(context, code);
  await expect(vent.locator('#sessionTag')).toHaveText(`Session ${code}`);
  await expect.poll(async () => Object.values(await session(page, code, '/presence') || {}).map(p => p.role)).toContain('vent');

  await startVentilating(vent);
  await expect.poll(() => vent.evaluate(() => window.__vent.ventStateNow().state)).toBe('ventilating');
  await expect.poll(() => logHas(page, /^Ventilator: Self-test passed \(ventilator tablet\)/)).toBe(true);
  await expect.poll(() => logHas(page, /^Ventilator: Ventilation started \(NIV-ST\)/)).toBe(true);
  // An alarm arrives as an alarm, with its priority
  await vent.evaluate(() => window.raise('phigh'));
  await expect.poll(() => logHas(page, /^Ventilator alarm \(high priority\): High pressure \(ventilator tablet\)/)).toBe(true);

  // The facilitator's Ventilator section shows what the tablet shows
  await expect.poll(() => page.evaluate(() => Object.values(window.__simEngine.state.ventMirror || {}).map(m => m.state))).toContain('ventilating');
  await expandSection(page, 'vent');
  await expect(page.getByTestId('vent-mirror')).toContainText('Ventilator tablet');
  await expect(page.getByTestId('vent-mirror')).toContainText('Ventilating');
  await expect(page.getByTestId('vent-mirror')).toContainText('PEEP/CPAP 5 cmH2O');
  expect(errors).toEqual([]);
  expect(ventErrors).toEqual([]);
});

test('the controller chooses the lungs: picked from the scenario, then changed by the facilitator', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  await expect.poll(() => live(page, code, '/vent')).toMatchObject({ profile: 'normal' });
  const { vent, errors } = await openVent(context, code);
  await expect.poll(() => vent.evaluate(() => window.__vent.P.id)).toBe('normal');

  await expandSection(page, 'vent');
  await page.getByLabel('Ventilator lungs').selectOption('ards');
  await expect.poll(() => live(page, code, '/vent/profile')).toBe('ards');
  await expect.poll(() => vent.evaluate(() => [window.__vent.P.id, window.__vent.P.pr.sedated])).toEqual(['ards', true]);
  await page.getByLabel("Patient's own breathing").selectOption('yes');
  await expect.poll(() => vent.evaluate(() => [window.__vent.P.pr.sedated, window.__vent.P.pr.effort > 0])).toEqual([false, true]);
  expect(await logHas(page, /^Ventilator lungs set to ARDS/)).toBe(true);
  expect(errors).toEqual([]);
});

test('on the room monitor: the Ventilator toggle shows it, the learner can flip to the obs, and it carries on where it left off', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  const monitor = await context.newPage();
  const monitorErrors = trackErrors(monitor);
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);

  await expandSection(page, 'vent');
  await page.getByRole('button', { name: 'Show the ventilator on the patient screens' }).click();
  await expect(monitor.getByTestId('monitor-vent')).toBeVisible();
  await expect.poll(async () => Object.values(await session(page, code, '/presence') || {}).map(p => p.display)).toEqual(expect.arrayContaining(['ventilator']));
  const dev = monitor.frameLocator('iframe[title="Ventilator"]');
  await expect(dev.locator('#linkBanner')).toBeHidden({ timeout: 10000 });
  await expect(dev.locator('#btnFull')).toBeHidden();                       // embedded layout
  await startVentilating(dev);
  await expect.poll(() => logHas(page, /^Ventilator: Ventilation started .*\(ventilator on the monitor\)/)).toBe(true);

  // The learner can look at the obs without stopping the ventilator
  const sw = monitor.getByTestId('screen-switcher');
  await sw.getByRole('button', { name: 'Monitor' }).click();
  await expect(monitor.getByTestId('monitor-vent')).toBeHidden();
  await sw.getByRole('button', { name: 'Ventilator' }).click();
  await expect(monitor.getByTestId('monitor-vent')).toBeVisible();

  // Taken off the screen and brought back, the ventilator comes back as it was
  await page.waitForTimeout(3500);                                          // its settings are saved every 3 s
  await page.getByRole('button', { name: 'Take the ventilator off the patient screens' }).click();
  await expect(monitor.getByTestId('monitor-vent')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show the ventilator on the patient screens' }).click();
  const dev2 = monitor.frameLocator('iframe[title="Ventilator"]');
  await expect(dev2.locator('#linkBanner')).toBeHidden({ timeout: 10000 });
  await expect.poll(async () => { const f = monitor.frames().find(x => /vent\/index\.html/.test(x.url())); return f ? f.evaluate(() => window.__vent.ventStateNow().state) : null; }).toBe('ventilating');
  expect(monitorErrors).toEqual([]);
});

test('three tablets at once: room monitor, defib tablet and ventilator tablet, all on one patient', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  await page.getByRole('button', { name: /^Coarse VF/ }).click();
  const monitor = await context.newPage();
  const monitorErrors = trackErrors(monitor);
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  const defib = await context.newPage();
  const defibErrors = trackErrors(defib);
  await defib.goto(`/defib/index.html?session=${code}`);
  await expect(defib.locator('#linkBanner')).toBeHidden();
  const { vent, errors: ventErrors } = await openVent(context, code);

  await expect.poll(async () => Object.values(await session(page, code, '/presence') || {}).map(p => p.role).sort()).toEqual(['defib', 'monitor', 'vent']);
  await defib.click('.mode-label[data-mode="defib"]');
  await defib.click('#chargeBtn');
  await expect(defib.locator('#shockBtn')).toBeEnabled({ timeout: 5000 });
  await defib.click('#shockBtn');
  await startVentilating(vent);
  await expect.poll(() => live(page, code, '/defib/shockCount')).toBe(1);
  await expect.poll(() => logHas(page, /^Ventilator: Ventilation started/)).toBe(true);
  // Neither device took over the room monitor's screen
  await expect(monitor.getByTestId('monitor-defib')).toHaveCount(0);
  await expect(monitor.getByTestId('monitor-vent')).toHaveCount(0);
  for (const e of [errors, monitorErrors, defibErrors, ventErrors]) expect(e).toEqual([]);
});

test('a new scenario gives a fresh ventilator', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  const { vent } = await openVent(context, code);
  await startVentilating(vent);
  await expect.poll(() => vent.evaluate(() => window.__vent.ventStateNow().state)).toBe('ventilating');
  await page.evaluate(() => window.firebase.database().ref(`sessions/${localStorage.getItem('wmebem_session_id')}/live`).update({ scenarioTitle: 'Another patient' }));
  await expect.poll(() => vent.evaluate(() => window.__vent.ventStateNow().state)).toBe('off');
});

// ---- Phase 2: the ventilator breathes for the patient ----

test('the physiology: more oxygen and PEEP raise SpO2, more ventilation lowers CO2, and CO2 settles over 3-5 minutes', async ({ page }) => {
  await openController(page);
  const r = await page.evaluate(() => {
    const VE = window.VENT_ENGINE;
    const cur = { vent: { profile: 'ards', breathing: false }, rhythm: 'Sinus Rhythm', ventLink: true };
    const run = (phys, secs, shown) => {
      let prev = null, out;
      for (let i = 0; i < secs; i++) { out = VE.step(prev, { phys }, cur, shown || { spO2: 90, etco2: 5 }); prev = out.ventPhys; }
      return out;
    };
    const base = { on: 1, conn: 1, rr: 18, autopeep: 0, inv: 1 };
    const lowO2 = run({ ...base, fio2: 0.4, peep: 5, r: 1 }, 300);
    const highO2 = run({ ...base, fio2: 1, peep: 5, r: 1 }, 300);
    const highPeep = run({ ...base, fio2: 0.4, peep: 15, r: 1 }, 300);
    const under = run({ ...base, fio2: 1, peep: 10, r: 0.5 }, 600);
    const over = run({ ...base, fio2: 1, peep: 10, r: 1.5 }, 600);
    // CO2 from 5.4 kPa towards the under-ventilated target: share of the gap closed after 1, 3 and 5 min
    const settle = [60, 180, 300].map(s => {
      const end = under.ventPhys.paco2, start = run({ ...base, fio2: 1, peep: 10, r: 0.5 }, 1).ventPhys.paco2;
      const at = run({ ...base, fio2: 1, peep: 10, r: 0.5 }, s).ventPhys.paco2;
      return (at - start) / (end - start);
    });
    const disc = run({ ...base, conn: 0, fio2: 0.21, peep: 0, r: 0.2 }, 5);
    const trapped = run({ ...base, fio2: 1, peep: 5, r: 1, autopeep: 10 }, 5);
    return { lowO2: lowO2.targets.spO2, highO2: highO2.targets.spO2, highPeep: highPeep.targets.spO2,
      under: under.ventPhys.paco2, over: over.ventPhys.paco2, settle, discEtco2: disc.targets.etco2, trapBp: trapped.offsets.bpSys,
      rr: highO2.targets.rr, etco2: highO2.targets.etco2, paco2: highO2.ventPhys.paco2 };
  });
  expect(r.highO2).toBeGreaterThan(r.lowO2 + 5);
  expect(r.highPeep).toBeGreaterThan(r.lowO2 + 5);
  expect(r.under).toBeGreaterThan(r.over + 0.8);        // ARDS: about 7.1 vs 6.1 kPa
  expect(r.settle[0]).toBeGreaterThan(0.4);          // about two thirds after a minute
  expect(r.settle[0]).toBeLessThan(0.8);
  expect(r.settle[1]).toBeGreaterThan(0.9);          // nearly there by 3 minutes
  expect(r.settle[2]).toBeGreaterThan(0.97);         // there by 5
  expect(r.discEtco2).toBe(0);                       // disconnected: no CO2 at the mouth
  expect(r.trapBp).toBeLessThan(0);                  // air trapping drops the BP
  expect(r.rr).toBe(18);
  expect(r.etco2).toBeLessThan(r.paco2);             // ETCO2 sits below PaCO2
});

test('a ventilating T1 drives SpO2, RR and ETCO2 while the clock is stopped; typed obs hold until released; "I set them" hands back', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  await expandSection(page, 'vent');
  await page.getByLabel('Ventilator lungs').selectOption('ards');
  const { vent, errors: ventErrors } = await openVent(context, code);
  await expect.poll(() => vent.evaluate(() => window.__vent.P.id)).toBe('ards');
  await startVentilating(vent);

  const eng = (fn) => page.evaluate(fn);
  await expect.poll(() => eng(() => !!(window.__simEngine.state.ventPhys && window.__simEngine.state.ventPhys.active)), { timeout: 15000 }).toBe(true);
  await expect(page.getByTestId('vent-driving')).toBeVisible();
  await expect.poll(() => logHas(page, /^Ventilator is breathing for the patient/)).toBe(true);
  // ARDS on 100% oxygen: well saturated, the rate is the ventilator's, ETCO2 is there
  await expect.poll(() => eng(() => window.__simEngine.state.vitals.spO2), { timeout: 30000 }).toBeGreaterThan(94);
  await expect.poll(() => eng(() => window.__simEngine.state.vitals.rr)).toBe(18);
  expect(await eng(() => window.__simEngine.state.vitals.etco2)).toBeGreaterThan(3);
  // The candidate turns the oxygen down to 21%: the patient desaturates
  await vent.evaluate(() => { window.__vent.V.set.o2 = 21; });
  await expect.poll(() => eng(() => window.__simEngine.state.vitals.spO2), { timeout: 30000 }).toBeLessThan(85);

  // The facilitator types an SpO2: it stays as typed until released
  await eng(() => window.__simEngine.dispatch({ type: 'MANUAL_VITAL_UPDATE', payload: { key: 'spO2', value: 97 } }));
  await page.waitForTimeout(2500);
  expect(await eng(() => window.__simEngine.state.vitals.spO2)).toBe(97);
  await page.getByRole('button', { name: 'Release to ventilator' }).click();
  await expect.poll(() => eng(() => window.__simEngine.state.vitals.spO2), { timeout: 15000 }).toBeLessThan(96);
  expect(await logHas(page, /^Released SpO2 to the ventilator/)).toBe(true);

  // "I set them": the link is off and the ventilator lets go
  await page.getByRole('button', { name: 'I set them' }).click();
  await expect(page.getByTestId('vent-driving')).toHaveCount(0);
  await expect.poll(() => eng(() => window.__simEngine.state.ventPhys)).toBe(null);
  await expect.poll(() => logHas(page, /^Ventilator is no longer breathing for the patient/)).toBe(true);
  await expect.poll(() => live(page, code, '/vent')).toMatchObject({ profile: 'ards', airway: 'none' });
  expect(errors).toEqual([]);
  expect(ventErrors).toEqual([]);
});

test('a paralysed patient is not breathing for the ventilator', async ({ page }) => {
  const code = await openController(page);
  await startQuickSim(page);
  await expect.poll(() => live(page, code, '/vent')).toMatchObject({ profile: 'normal' });
  expect((await live(page, code, '/vent')).breathing).toBeUndefined();
  const cfg = await page.evaluate(() => window.VENT_ENGINE.configFor({ ...window.__simEngine.state, isParalysed: true }));
  expect(cfg.breathing).toBe(false);
});

test('with the clock running the ventilator still drives the obs, and hypoxia does not drift on top', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  await expandSection(page, 'vent');
  await page.getByLabel('Ventilator lungs').selectOption('ards');
  const { vent } = await openVent(context, code);
  await expect.poll(() => vent.evaluate(() => window.__vent.P.id)).toBe('ards');
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'START_SIM' }));
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.isRunning)).toBe(true);
  await startVentilating(vent);
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.vitals.rr), { timeout: 30000 }).toBe(18);
  const t0 = await page.evaluate(() => window.__simEngine.state.time);
  await page.waitForTimeout(3000);
  const s = await page.evaluate(() => { const st = window.__simEngine.state; return { t: st.time, phys: !!(st.ventPhys && st.ventPhys.active), hyp: st.hypoxiaTimer }; });
  expect(s.t).toBeGreaterThan(t0);
  expect(s.phys).toBe(true);
  expect(s.hyp).toBe(0);
  expect(errors).toEqual([]);
});

// ---- Phase 3: the examiner controls the ventilator ----

test('the facilitator controls a ventilator remotely: power, start, mode, a setting, a limit, lock, standby', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  const { vent, errors: ventErrors } = await openVent(context, code);
  await expandSection(page, 'vent');
  await expect(page.getByTestId('vent-mirror')).toContainText('Off');
  const remote = page.getByTestId('vent-remote');
  await remote.locator('summary').click();
  await remote.getByRole('button', { name: 'Switch on' }).click();
  await expect.poll(() => vent.evaluate(() => window.__vent.ventStateNow().state), { timeout: 10000 }).toBe('standby');
  await remote.getByRole('button', { name: 'Start ventilation' }).click();
  await expect.poll(() => vent.evaluate(() => window.__vent.ventStateNow().state)).toBe('ventilating');
  await expect.poll(() => logHas(page, /^Ventilator \(facilitator\): Ventilation started/)).toBe(true);
  expect(await logHas(page, /^Ventilator: Ventilation started/)).toBe(false);   // the facilitator's, not the candidate's

  await page.getByLabel('Ventilator mode').selectOption('APVcmv');
  await expect.poll(() => vent.evaluate(() => window.__vent.V.mode)).toBe('APVcmv');
  // PEEP: one step up, then typed
  await expect(page.getByLabel('PEEP/CPAP value')).toBeVisible();
  const peep0 = await vent.evaluate(() => window.__vent.V.set.peep);
  await page.getByRole('button', { name: 'PEEP/CPAP up' }).click();
  await expect.poll(() => vent.evaluate(() => window.__vent.V.set.peep)).toBe(peep0 + 1);
  await page.getByLabel('PEEP/CPAP value').fill('12');
  await page.getByLabel('PEEP/CPAP value').press('Enter');
  await expect.poll(() => vent.evaluate(() => window.__vent.V.set.peep)).toBe(12);
  await expect.poll(() => logHas(page, /^Ventilator \(facilitator\): Setting changed: PEEP\/CPAP 12/)).toBe(true);
  // A typed value out of range is held to the device's range
  await page.getByLabel('Oxygen value').fill('150');
  await page.getByLabel('Oxygen value').press('Enter');
  await expect.poll(() => vent.evaluate(() => window.__vent.V.set.o2)).toBe(100);
  // An alarm limit
  await remote.getByText('Alarm limits').click();
  await remote.getByLabel('Pressure high value').fill('45');
  await remote.getByLabel('Pressure high value').press('Enter');
  await expect.poll(() => vent.evaluate(() => window.__vent.V.lim.phigh)).toBe(45);
  // Lock the candidate's screen, then standby despite the lock
  await remote.getByRole('button', { name: 'Lock screen' }).click();
  await expect.poll(() => vent.evaluate(() => window.__vent.V.locked)).toBe(true);
  await remote.getByRole('button', { name: 'Standby' }).click();
  await expect.poll(() => vent.evaluate(() => window.__vent.ventStateNow().state)).toBe('standby');
  // Commands are consumed
  await expect.poll(async () => Object.keys(await session(page, code, '/ventCmd') || {}).length).toBe(0);
  expect(errors).toEqual([]);
  expect(ventErrors).toEqual([]);
});

test('injected problems reach the ventilator, the lungs can be adjusted, and Assessment hides the alarm help', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  await expandSection(page, 'vent');
  await page.getByLabel('Ventilator lungs').selectOption('ards');
  const { vent, errors } = await openVent(context, code);
  await startVentilating(vent);
  await expect.poll(() => vent.evaluate(() => window.__vent.ventStateNow().state)).toBe('ventilating');

  const panel = page.getByTestId('vent-patient');
  await panel.getByRole('button', { name: 'Mask off / circuit disconnected' }).click();
  await expect.poll(() => live(page, code, '/vent/probs')).toBe('disc');
  await expect.poll(() => vent.evaluate(() => window.__vent.P.disc)).toBe(true);
  expect(await logHas(page, /^Ventilator problem injected: Mask off \/ circuit disconnected \(facilitator\)/)).toBe(true);
  await panel.getByRole('button', { name: 'Fix: Mask off / circuit disconnected' }).click();
  await expect.poll(() => vent.evaluate(() => window.__vent.P.disc)).toBe(false);

  // Mains lost: the T1 runs on battery
  await panel.getByRole('button', { name: 'Mains power lost' }).click();
  await expect.poll(() => vent.evaluate(() => window.__vent.P.mains)).toBe(false);
  await panel.getByRole('button', { name: 'Fix all' }).click();
  await expect.poll(() => vent.evaluate(() => window.__vent.P.mains)).toBe(true);

  // Bronchospasm raises the resistance on the ventilator
  const r0 = await vent.evaluate(() => window.__vent.P.pr.R);
  await panel.getByRole('button', { name: 'Bronchospasm' }).click();
  await expect.poll(() => vent.evaluate(() => window.__vent.P.pr.R)).toBeGreaterThan(r0 * 2);

  // Lungs: compliance down a step
  await panel.getByText('Lungs', { exact: true }).click();
  await panel.getByRole('button', { name: 'Compliance down' }).click();
  await expect(page.getByTestId('vent-lung-c')).toContainText('90');
  await expect.poll(() => live(page, code, '/vent/lung/c')).toBe(90);
  await expect.poll(() => vent.evaluate(() => Math.round(window.__vent.P.pr.C / window.VENT_PROFILES.profiles.ards.C * 100))).toBe(90);
  expect(await logHas(page, /^Ventilator lungs: compliance 90%/)).toBe(true);

  // Assessment
  await panel.getByRole('button', { name: 'Assessment' }).click();
  await expect.poll(() => vent.evaluate(() => document.body.classList.contains('assess'))).toBe(true);
  expect(errors).toEqual([]);
});

test('a displaced tube takes the CO2 away, and a tension pneumothorax drops the BP until it is decompressed', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  await expandSection(page, 'vent');
  await page.getByLabel('Ventilator lungs').selectOption('ards');
  const { vent } = await openVent(context, code);
  await startVentilating(vent);
  const E = (fn) => page.evaluate(fn);
  await expect.poll(() => E(() => window.__simEngine.state.vitals.etco2), { timeout: 30000 }).toBeGreaterThan(3);
  const panel = page.getByTestId('vent-patient');
  await panel.getByRole('button', { name: 'Tube displaced (oesophageal: no CO2)' }).click();
  await expect.poll(() => E(() => window.__simEngine.state.vitals.etco2), { timeout: 10000 }).toBe(0);
  await panel.getByRole('button', { name: 'Fix: Tube displaced (oesophageal: no CO2)' }).click();
  await expect.poll(() => E(() => window.__simEngine.state.vitals.etco2), { timeout: 10000 }).toBeGreaterThan(3);

  const bp0 = await E(() => window.__simEngine.state.vitals.bpSys);
  await panel.getByRole('button', { name: 'Tension pneumothorax' }).click();
  await expect.poll(() => E(() => window.__simEngine.state.vitals.bpSys), { timeout: 10000 }).toBeLessThan(bp0 - 25);
  await E(() => window.__simEngine.applyIntervention('Needle'));
  await expect.poll(() => E(() => (window.__simEngine.state.vent.probs || []).includes('ptx'))).toBe(false);
  expect(await logHas(page, /^Ventilator problem fixed: tension pneumothorax decompressed/)).toBe(true);
});

// ---- Phase 4: Ventilator Sim ----

test('Ventilator Sim: ARDS in Assessment, on the room monitor, through to the ventilator debrief', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await page.getByRole('button', { name: 'Ventilator Sim', exact: true }).click();
  await page.locator('[data-vent-scenario="ards"]').click();
  await page.getByTestId('vent-setup').getByRole('button', { name: /^Assessment/ }).click();
  await page.getByRole('button', { name: 'Start Ventilator Sim' }).click();
  await expect(page.getByTestId('vent-brief')).toContainText('ARDS: lung-protective ventilation (Assessment)');
  await expect.poll(() => live(page, code, '/vent')).toMatchObject({ profile: 'ards', breathing: false, airway: 'tube', assess: true });
  expect(await live(page, code, '/ventPanelOpen')).toBe(true);

  // The candidate's tablet is the room monitor, with the ventilator already on it
  const monitor = await context.newPage();
  const monitorErrors = trackErrors(monitor);
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect(monitor.getByTestId('monitor-vent')).toBeVisible({ timeout: 10000 });
  const dev = monitor.frameLocator('iframe[title="Ventilator"]');
  await expect(dev.locator('#linkBanner')).toBeHidden({ timeout: 10000 });
  const frame = () => monitor.frames().find(f => /vent\/index\.html/.test(f.url()));
  await expect.poll(() => frame().evaluate(() => [window.__vent.P.id, document.body.classList.contains('assess')])).toEqual(['ards', true]);
  await startVentilating(dev);
  await expect.poll(() => logHas(page, /^Ventilator: Ventilation started \(\(S\)CMV\+\) \(ventilator on the monitor\)/)).toBe(true);
  // The candidate sets a lung-protective tidal volume on the device (6 ml/kg of a 70 kg IBW)
  await frame().evaluate(() => { E = { scope: 'ctrl', key: 'vt', val: 420 }; confirmEdit(); });
  await expect.poll(() => logHas(page, /^Ventilator: Setting changed: Vt 420/)).toBe(true);

  // A problem, injected and fixed
  const panel = page.getByTestId('vent-patient');
  await panel.getByRole('button', { name: 'Tube blocked by secretions' }).click();
  await page.waitForTimeout(1500);
  await panel.getByRole('button', { name: 'Fix: Tube blocked by secretions' }).click();
  // Long enough for the ventilator record (every 15 s) to hold the new tidal volume
  await expect.poll(() => page.evaluate(() => (window.__simEngine.state.ventSamples || []).filter(s => s.vte > 0).length), { timeout: 40000 }).toBeGreaterThan(1);

  await page.getByRole('button', { name: 'Finish' }).first().click();
  await expect(page.getByText('Simulation Complete')).toBeVisible();
  const fb = page.getByTestId('vent-feedback');
  await expect(fb).toContainText('ARDS: lung-protective ventilation');
  await expect(fb).toContainText('Ventilation first started at');
  await expect(fb).toContainText('Median tidal volume');
  await expect(fb).toContainText('leak test and flow sensor calibration were not both passed');
  await expect(fb).toContainText(/Tube blocked by secretions: injected at \d+:\d\d, fixed \d+:\d\d later/);
  expect(errors).toEqual([]);
  expect(monitorErrors).toEqual([]);
});

test('every Ventilator Sim scenario starts with its lungs, airway and patient', async ({ page }) => {
  await openController(page);
  const ids = await page.evaluate(() => window.VentSim.SCENARIOS.map(s => s.id));
  expect(ids.length).toBe(8);
  for (const id of ids) {
    const r = await page.evaluate((id) => {
      const s = window.VentSim.buildScenario({ scenario: id, mode: 'education' });
      return { profile: s.ventSim.profile, ok: !!window.VENT_PROFILES.profiles[s.ventSim.profile], spo2: s.vitals.spO2, title: s.title, quick: s.quickSim };
    }, id);
    expect(r.ok, id).toBe(true);
    expect(r.title).toMatch(/^Ventilator Sim: /);
    expect(r.spo2).toBeGreaterThan(80);
  }
});
