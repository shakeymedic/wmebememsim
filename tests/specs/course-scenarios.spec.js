// Course scenarios (restricted section): grouping by course and workshop, the facilitator pack /
// mark sheet (scenario list, briefing, controller, debrief) and the admin upload. The data here is
// made up: real course content (e.g. ETC) is copyrighted and is never in the repository.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const UID = 'uid_a_learner_example_org';

const workshop = {
  id: 'TC_WS_1', title: 'Workshop 1: Test fall', course: 'TESTCOURSE', group: 'Alpha workshop', order: 11,
  category: 'Trauma', ageRange: 'Adult', acuity: 'Resus', patientAge: 40, sex: 'Male', patientName: 'Test Person',
  patientProfileTemplate: 'Fell from a test ladder.', vitals: { hr: 110, bpSys: 95, bpDia: 60, spO2: 94, rr: 24, gcs: 15 },
  pmh: ['Nil'], dhx: ['Nil'], allergies: ['Nil'], recommendedActions: ['Obs', 'Oxygen'], stabilisers: ['Oxygen'],
  learningObjectives: ['Recognise the test injury'], objectivesFacilitatorOnly: true,
  markScheme: {
    kind: 'workshop', source: 'Test pack', radioReport: ['Fell from a test ladder'],
    pathway: [{ role: 'A', findings: 'Talking\nNo airway issue', actions: 'Assess airway' }],
    results: [{ label: 'Venous gas', text: 'pH 7.30 (test value)' }],
    criteria: { technical: ['Test technical skill'], nonTechnical: ['Test teamwork skill'] },
    summary: 'A test summary.', debriefPoints: ['Test learning point'],
  },
};
const assessment = {
  id: 'TC_AS_3', title: 'Assessment 3: Test scenario', course: 'TESTCOURSE', group: 'Team leader assessment', order: 201,
  category: 'Trauma', ageRange: 'Adult', acuity: 'Resus', patientAge: 30, sex: 'Female', patientName: 'Test Patient',
  patientProfileTemplate: 'Test mechanism.', vitals: { hr: 120, bpSys: 90, spO2: 93, rr: 22 },
  recommendedActions: ['Obs'], stabilisers: [], objectivesFacilitatorOnly: true,
  markScheme: {
    kind: 'assessment', source: 'Test assessment', criticalPoints: ['Critical point 1: test one', 'Critical point 2: test two'],
    criticalNote: 'Test note.', criteria: { other: ['Other test criterion'] },
  },
};
const other = { id: 'OC_1', title: 'Other course scenario', course: 'OTHERCOURSE', group: 'Beta', order: 1, category: 'Cardiac Arrest', ageRange: 'Adult', acuity: 'Resus', patientProfileTemplate: 'Other.', vitals: { hr: 80 } };

async function signInWithAccess(page, role) {
  await page.evaluate(([u, r, a, b, c]) => {
    window.__fakeRtdb.set(`users/${u}`, { email: 'a.learner@example.org', status: 'approved', entitlements: { rcuk: true }, ...(r ? { role: r } : {}) });
    window.__fakeRtdb.set('restrictedScenarios', { [a.id]: a, [b.id]: b, [c.id]: c });
  }, [UID, role, workshop, assessment, other]);
  await page.getByRole('button', { name: /^Sign in$/ }).first().click();
  await page.getByLabel('Email').fill('a.learner@example.org');
  await page.getByLabel('Password').fill('correct horse');
  await page.locator('form button[type=submit]').click();
  await expect(page.getByRole('button', { name: /^Your account/ })).toBeVisible();
}

async function openCourseScenarios(page) {
  await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
  await page.getByRole('button', { name: /Course scenarios \(ALS, ETC\)/ }).click();
  await expect(page.getByText('Workshop 1: Test fall')).toBeVisible({ timeout: 10000 });
}

const card = (page, title) => page.locator('div.justify-between', { hasText: title }).first();

test('course scenarios are grouped by workshop, filtered by course, and the mark sheet opens from the list', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await signInWithAccess(page);
  await openCourseScenarios(page);
  await expect(page.getByText('Course material is copyrighted', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Alpha workshop' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Team leader assessment' })).toBeVisible();

  // Course chips: only the chosen course is listed
  await page.getByRole('button', { name: 'OTHERCOURSE', exact: true }).click();
  await expect(page.getByText('Other course scenario')).toBeVisible();
  await expect(page.getByText('Workshop 1: Test fall')).toHaveCount(0);
  await page.getByRole('button', { name: 'TESTCOURSE', exact: true }).click();
  await expect(page.getByText('Other course scenario')).toHaveCount(0);

  // A scenario without a mark scheme has no Mark sheet button
  await page.getByRole('button', { name: 'All courses', exact: true }).click();
  await expect(card(page, 'Other course scenario').getByRole('button', { name: 'Mark sheet' })).toHaveCount(0);

  await card(page, 'Workshop 1: Test fall').getByRole('button', { name: 'Mark sheet' }).click();
  const sheet = page.getByRole('dialog', { name: /Mark sheet: Workshop 1: Test fall/ });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId('mark-pathway')).toContainText('Assess airway');
  await expect(sheet.getByText('pH 7.30 (test value)')).toBeVisible();
  await expect(sheet.getByText('Test technical skill')).toBeVisible();
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('team leader assessment: briefing and controller open the sheet, the debrief marks it and gives the verdict', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await signInWithAccess(page);
  await openCourseScenarios(page);
  await card(page, 'Assessment 3: Test scenario').getByRole('button', { name: 'Load' }).click();

  const brief = page.getByTestId('briefing-marksheet');
  await expect(brief).toContainText('Team leader assessment');
  await brief.getByRole('button', { name: 'Open the mark sheet' }).click();
  const sheet = page.getByRole('dialog', { name: /Mark sheet: Assessment 3/ });
  await expect(sheet.getByText('Critical point 1: test one')).toBeVisible();
  await expect(sheet.getByText('Test note.')).toBeVisible();
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('button', { name: 'Start Scenario' }).click();
  await page.getByRole('button', { name: 'Mark sheet' }).click();
  await expect(page.getByRole('dialog', { name: /Mark sheet: Assessment 3/ })).toBeVisible();
  await page.getByRole('dialog', { name: /Mark sheet: Assessment 3/ }).getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('button', { name: 'Finish' }).first().click();
  await expect(page.getByText('Simulation Complete')).toBeVisible();
  const deb = page.getByTestId('debrief-marksheet');
  await expect(deb).toBeVisible();
  const mark = (label, text) => deb.getByRole('button', { name: `${label}: ${text}`, exact: true }).click();
  await mark('Achieved', 'Critical point 1: test one');
  await mark('Not achieved', 'Critical point 2: test two');
  await expect(deb.getByTestId('mark-verdict')).toHaveText(/Not yet achieved/i);
  await mark('Achieved', 'Critical point 2: test two');
  await expect(deb.getByTestId('mark-verdict')).toHaveCount(0);           // one item still unmarked
  await mark('Achieved', 'Other test criterion');
  await expect(deb.getByTestId('mark-verdict')).toHaveText(/Pass/i);

  // The marks go into the report, and the live session never carries the mark scheme
  const html = await page.evaluate(([s]) => window.MarkScheme.criteriaHtml(s, { cp1: 'A', cp2: 'N' }), [assessment]);
  expect(html).toContain('Critical point 2: test two');
  const code = await page.evaluate(() => localStorage.getItem('wmebem_session_id'));
  const sess = await page.evaluate(([c]) => JSON.stringify(window.__fakeRtdb.get(`sessions/${c}`) || {}), [code]);
  expect(sess).not.toContain('markScheme');
  expect(sess).not.toContain('Critical point 1');
  expect(errors).toEqual([]);
});

test('course objectives are judged by the facilitator, never inferred from keywords', async ({ page }) => {
  await openController(page);
  const rows = await page.evaluate(([s]) => {
    const p = window.computeObjectiveProgress(window.enrichScenario(s), { interventionCounts: { Oxygen: 3 } });
    return p.objectives.map(r => ({ status: r.status, judged: r.facilitatorJudged, source: r.source }));
  }, [{ ...workshop, learningObjectives: ['Give oxygen and recognise the test injury'] }]);
  expect(rows).toEqual([{ status: 'none', judged: true, source: 'authored' }]);
});

test('admin: a course scenario file is checked and uploaded to the database', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await signInWithAccess(page, 'admin');
  await page.getByRole('button', { name: 'Admin', exact: true }).click();
  const box = page.getByTestId('course-upload');
  await expect(box).toBeVisible();

  // A field name the database cannot store is reported, not uploaded
  await box.getByLabel('Course scenario file').setInputFiles({ name: 'bad.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ BAD_1: { id: 'BAD_1', title: 'Bad', objectiveActions: { 'a / b': [] } } })) });
  await expect(box.getByText(/cannot contain/)).toBeVisible();
  await expect(box.getByRole('button', { name: /^Upload/ })).toHaveCount(0);

  const file = { NEW_1: { ...workshop, id: 'NEW_1', title: 'Uploaded scenario' }, NEW_2: { ...other, id: 'NEW_2', title: 'Second uploaded' } };
  await box.getByLabel('Course scenario file').setInputFiles({ name: 'course.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
  await expect(box.getByText('TESTCOURSE: 1, OTHERCOURSE: 1', { exact: false })).toBeVisible();
  await box.getByRole('button', { name: 'Upload 2 scenarios' }).click();
  await expect(box.getByText('Uploaded 2 scenarios.', { exact: false })).toBeVisible();
  // Merged, not replaced: the existing scenarios are still there
  const ids = await page.evaluate(() => Object.keys(window.__fakeRtdb.get('restrictedScenarios') || {}).sort());
  expect(ids).toEqual(['NEW_1', 'NEW_2', 'OC_1', 'TC_AS_3', 'TC_WS_1']);
  expect(await page.evaluate(() => window.__fakeRtdb.get('restrictedScenarios/NEW_1/markScheme/kind'))).toBe('workshop');
  expect(errors).toEqual([]);
});
