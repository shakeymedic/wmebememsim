// Kit already on from the scene (data/prehospital.js): a scenario whose words say the patient arrives with
// oxygen, fluids running, a collar and blocks, a tourniquet ... starts with that kit on the patient picture
// and in the kit state, as set-up kit (no effect on the obs, not the team's).
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, pressStart, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const SIDE_IMPACT = 'David, a 30-year-old male driver of a car, has been involved in a side impact collision. At scene he is conscious and complaining of chest and lower abdominal pain. He arrives with O2, IV fluids running and is fully immobilised.';

test('the words of a scenario give the kit already on, and leave out what is absent or still to do', async ({ page }) => {
  await openController(page);
  const kit = (text, extra) => page.evaluate(([t, x]) => window.prehospitalKit(Object.assign({ patientProfileTemplate: t }, x || {})).kit, [text, extra]);
  expect(await kit(SIDE_IMPACT)).toEqual(['Oxygen', 'IV Access', 'FluidInfusion', 'Collar', 'HeadBlocks', 'Scoop']);
  expect(await kit('Single gunshot wound to the medial thigh. Pulsatile bleeding at the scene, tourniquet applied by police.')).toEqual(['Tourniquet']);
  expect(await kit('Arrives in collar and blocks on a scoop, 15 L O2 via non-rebreathe mask.')).toEqual(['Collar', 'HeadBlocks', 'Scoop', 'Oxygen']);
  expect(await kit('Two large-bore cannulae sited, 500 ml saline given. Pelvic binder in place.')).toEqual(['IV Access', 'PelvicBinder']);
  expect(await kit('Test', { markScheme: { radioReport: ['A: 45 M', 'T: O2, collar & blocks, IV access'] } })).toEqual(['Oxygen', 'Collar', 'HeadBlocks', 'IV Access']);
  // Readings, negatives and things still to do put nothing on
  expect(await kit('SpO2 88% on room air. Oxygen saturations 85%. Home oxygen user.')).toEqual([]);
  expect(await kit('No IV access obtained. Self-extricated, not immobilised. Needs a pelvic binder.')).toEqual([]);
  expect(await kit('Leg immobilised in a vacuum splint.')).toEqual(['Splinting']);
  // The author's own list wins, and an empty one means nothing on
  expect(await page.evaluate(t => window.withPrehospitalKit({ patientProfileTemplate: t, setupKit: [] }).setupKit, SIDE_IMPACT)).toEqual([]);
  expect(await page.evaluate(() => window.withPrehospitalKit({ patientProfileTemplate: 'Arrives with O2.', setupKit: ['Collar', 'Obs', 'Nonsense'] }).setupKit)).toEqual(['Collar']);
});

test('a side-impact RTC that arrives with O2, IV fluids and fully immobilised starts with all of it on the picture', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await startQuickSim(page);
  await page.evaluate((text) => {
    const sc = window.withPrehospitalKit({ id: 'TEST_RTC', title: 'Side-impact RTC', category: 'Trauma', ageRange: 'Adult', acuity: 'Resus',
      patientAge: 30, sex: 'Male', patientProfileTemplate: text, vitals: { hr: 115, bpSys: 86, bpDia: 65, spO2: 92, rr: 35, gcs: 13 }, recommendedActions: ['Obs'] });
    window.__simEngine.dispatch({ type: 'LOAD_SCENARIO', payload: sc });
  }, SIDE_IMPACT);
  const status = page.getByTestId('patient-status');
  if (await status.getByRole('button', { name: 'More' }).isVisible()) await status.getByRole('button', { name: 'More' }).click();
  const fig = status.getByTestId('patient-figure');
  for (const part of ['mask', 'iv', 'drip', 'giving-set', 'collar', 'blocks', 'scoop']) await expect(fig.locator(`[data-part="${part}"]`).first()).toBeAttached();
  await expect(status).toContainText('IV fluids running');
  const s = await page.evaluate(() => ({ act: [...window.__simEngine.state.activeInterventions], kit: window.__simEngine.state.scenario.setupKit, spo2: window.__simEngine.state.vitals.spO2, bp: window.__simEngine.state.vitals.bpSys }));
  expect(s.act.sort()).toEqual(['Collar', 'FluidInfusion', 'HeadBlocks', 'IV Access', 'Oxygen', 'Scoop']);
  expect(s.kit).toEqual(['Oxygen', 'IV Access', 'FluidInfusion', 'Collar', 'HeadBlocks', 'Scoop']);
  // Monitoring is still the team's to attach
  await expect(status).toContainText('Nothing attached');
  // The kit does not change the obs once the patient goes live
  await pressStart(page);
  await page.waitForTimeout(1500);
  const v = await page.evaluate(() => window.__simEngine.state.vitals);
  expect(v.spO2).toBe(s.spo2);
  expect(v.bpSys).toBe(s.bp);
  expect(errors).toEqual([]);
});

test('library: the gunshot wound to the thigh arrives with the police tourniquet on', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
  await page.getByRole('button', { name: 'Trauma', exact: true }).click();
  await page.locator('div.justify-between', { hasText: 'Gunshot Wound (Thigh)' }).first().getByRole('button', { name: 'Load' }).click();
  await page.getByRole('button', { name: 'Start Scenario' }).click();
  await expect.poll(() => page.evaluate(() => [...window.__simEngine.state.activeInterventions])).toEqual(['Tourniquet']);
  const log = await page.evaluate(() => window.__simEngine.state.log.map(l => l.msg));
  expect(log.some(m => /already in place when the team arrives \(from the scenario\): Tourniquet/.test(m))).toBe(true);
  // Not counted as the team's
  expect(await page.evaluate(() => window.__simEngine.state.scenario.setupKit)).toEqual(['Tourniquet']);
  expect(errors).toEqual([]);
});
