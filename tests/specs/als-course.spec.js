// ALS course scenarios (CASTest, CASTeach): the "bold points" pass rule, the course's own wording on
// the mark sheet, and a scenario's own shock settings and post-ROSC obs. The data here is made up:
// the real RCUK course content is copyrighted and is never in the repository.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const E = (page, fn, arg) => page.evaluate(fn, arg);

const castest = {
  id: 'TEST_CAST_1', title: 'Test CAST: made-up arrest', course: 'ALS', group: 'Test assessments', order: 1,
  category: 'Cardiac Arrest', ageRange: 'Adult', acuity: 'Resus', patientAge: 50, sex: 'Male',
  patientProfileTemplate: 'Made-up test patient.', vitals: { hr: 0, bpSys: 0, bpDia: 0, spO2: 0, rr: 0, gcs: 3 }, rhythm: 'VF',
  recommendedActions: ['CPR', 'Defib'], objectivesFacilitatorOnly: true,
  defibSettings: { shockResponse: '1', refib: 'off' }, successRhythm: 'Sinus Tachycardia',
  roscVitals: { hr: 123, bpSys: 101, bpDia: 61, rr: 0, gcs: 3 },
  markScheme: {
    kind: 'assessment', kindLabel: 'Test CAST assessment', passRule: 'critical',
    verdictLabels: { pass: 'All bold points achieved', notYet: 'Bold point not achieved' },
    sectionLabels: { critical: 'Bold points', other: 'Non-bold points' },
    pathwayHeadings: { role: 'Stage', findings: 'Clinical course', actions: 'Expected actions' },
    pathway: [{ role: 'VF', findings: 'Test VF', actions: 'Test shock' }],
    setup: { equipment: ['Test process note'], equipmentLabel: 'Test process' },
    criticalPoints: ['Bold one', 'Bold two'], criteria: { other: ['Non-bold one'] },
  },
};

test('CASTest pass rule: only the bold points decide the verdict, in the course\'s own words', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  const r = await E(page, (s) => {
    const R = (m) => { const x = window.MarkScheme.result(s, m); return [x.verdict, x.passed]; };
    return {
      none: R({}),
      boldOnly: R({ cp0: 'A', cp1: 'A' }),
      boldAndOtherMissed: R({ cp0: 'A', cp1: 'A', ot0: 'N' }),
      boldMissed: R({ cp0: 'A', cp1: 'N', ot0: 'A' }),
      boldUnmarked: R({ cp0: 'A', ot0: 'A' }),
      // Without passRule the old rule stands: a missed other criterion means not yet achieved
      oldRule: (() => { const x = window.MarkScheme.result({ ...s, markScheme: { ...s.markScheme, passRule: undefined, verdictLabels: undefined } }, { cp0: 'A', cp1: 'A', ot0: 'N' }); return [x.verdict, x.passed]; })(),
    };
  }, castest);
  expect(r).toEqual({
    none: [null, false],
    boldOnly: ['All bold points achieved', true],
    boldAndOtherMissed: ['All bold points achieved', true],
    boldMissed: ['Bold point not achieved', false],
    boldUnmarked: [null, false],
    oldRule: ['Not yet achieved', false],
  });
  const html = await E(page, (s) => window.MarkScheme.sheetHtml(s, { cp0: 'A', cp1: 'A', ot0: 'N' }), castest);
  expect(html).toContain('Bold points');
  expect(html).toContain('Non-bold points');
  expect(html).toContain('<th>Stage</th><th>Clinical course</th><th>Expected actions</th>');
  expect(html).toContain('All bold points achieved');
  expect(html).toContain('<h4>Test process</h4>');
  expect(html).not.toContain('On arrival');
  expect(errors).toEqual([]);
});

test('a scenario\'s own shock settings and post-ROSC obs are used', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await page.waitForFunction(() => !!window.__simEngine);
  await E(page, (s) => window.__simEngine.dispatch({ type: 'LOAD_SCENARIO', payload: window.generatePatientFromTemplate(window.enrichScenario(s), {}) }), castest);
  await page.waitForFunction(() => (window.__simEngine.state.scenario || {}).id === 'TEST_CAST_1');
  await E(page, () => window.__simEngine.start());
  expect(await E(page, () => ({ ...window.__simEngine.state.defibSettings }))).toMatchObject({ shockResponse: '1', refib: 'off' });
  expect(await E(page, () => window.__simEngine.state.rhythm)).toBe('VF');
  await E(page, () => window.__simEngine.deliverShock(150, 'test'));
  await expect.poll(() => E(page, () => window.__simEngine.state.rhythm), { timeout: 10000 }).toBe('Sinus Tachycardia');
  const v = await E(page, () => { const b = window.__simEngine.state.baseVitals; return { hr: b.hr, bpSys: b.bpSys, bpDia: b.bpDia, rr: b.rr, gcs: b.gcs }; });
  expect(v).toEqual({ hr: 123, bpSys: 101, bpDia: 61, rr: 0, gcs: 3 });
  expect(errors).toEqual([]);
});

test('without roscVitals, ROSC still gives the generic post-arrest obs', async ({ page }) => {
  await openController(page);
  await page.waitForFunction(() => !!window.__simEngine);
  const plain = { ...castest, id: 'TEST_CAST_2', roscVitals: undefined };
  await E(page, (s) => window.__simEngine.dispatch({ type: 'LOAD_SCENARIO', payload: window.generatePatientFromTemplate(window.enrichScenario(s), {}) }), plain);
  await page.waitForFunction(() => (window.__simEngine.state.scenario || {}).id === 'TEST_CAST_2');
  await E(page, () => window.__simEngine.start());
  await E(page, () => window.__simEngine.triggerROSC('Sinus Rhythm'));
  await expect.poll(() => E(page, () => window.__simEngine.state.baseVitals.gcs)).toBe(8);
  expect(await E(page, () => window.__simEngine.state.baseVitals.spO2)).toBe(94);
});
