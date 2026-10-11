// My scenarios: custom scenarios are saved to the signed-in account (userScenarios/<uid>), saving
// needs an account, and scenarios saved in this browser before can be moved into the account.
// (Client side only: database.rules.json, tested in tests/rules, is what stops one account reading
// another's.)
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const UID = 'uid_a_learner_example_org';
const mine = (page, uid = UID) => page.evaluate(u => window.__fakeRtdb.get(`userScenarios/${u}`), uid);
const deviceList = (page) => page.evaluate(() => localStorage.getItem('wmebem_custom_scenarios'));

async function signIn(page, email = 'a.learner@example.org') {
  await page.getByRole('button', { name: /^Sign in$/ }).first().click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('correct horse');
  await page.locator('form button[type=submit]').click();
}
async function openMyScenarios(page) {
  await page.getByRole('button', { name: 'My scenarios', exact: true }).click();
}
async function buildOne(page, title) {
  await page.getByRole('button', { name: 'Builder', exact: true }).click();
  await page.getByPlaceholder('Scenario Title').fill(title);
}

test('signed out: My scenarios asks you to sign in, and Builder runs without saving', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await openMyScenarios(page);
  await expect(page.getByText('Sign in to save your own scenarios')).toBeVisible();
  await expect(page.getByRole('button', { name: /Import JSON/ })).toHaveCount(0);

  await buildOne(page, 'Unsaved chest pain');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('builder-save-note')).toContainText('Saving needs an account');
  await page.getByRole('button', { name: 'Run without saving' }).click();
  await expect(page.getByRole('button', { name: 'Start Scenario' })).toBeVisible();
  expect(await deviceList(page)).toBeNull();
  expect(await page.evaluate(() => window.__fakeRtdb.get('userScenarios'))).toBeNull();
  expect(errors).toEqual([]);
});

test('signing in from the Builder keeps what you typed, then Save stores it in your account', async ({ page, context }) => {
  const errors = trackErrors(page);
  // A second page in the same browser keeps the in-memory database across the reload below.
  const holder = await context.newPage();
  await holder.goto('/index.html');
  await openController(page);
  await openMyScenarios(page);
  await buildOne(page, 'Saved sepsis');
  await page.getByTestId('builder-save-note').getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Email').fill('a.learner@example.org');
  await page.getByLabel('Password').fill('correct horse');
  await page.locator('form button[type=submit]').click();
  await expect(page.getByPlaceholder('Scenario Title')).toHaveValue('Saved sepsis');

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved "Saved sepsis" to your account.')).toBeVisible();
  const row = page.locator('div.justify-between', { hasText: 'Saved sepsis' }).first();
  await expect(row).toBeVisible();
  const stored = await mine(page);
  const ids = Object.keys(stored || {});
  expect(ids).toHaveLength(1);
  expect(ids[0]).toMatch(/^CUST_/);
  expect(stored[ids[0]]).toMatchObject({ id: ids[0], title: 'Saved sepsis' });
  expect(await deviceList(page)).toBeNull();

  // Editing and saving again updates the same scenario rather than adding a copy
  await row.getByRole('button', { name: 'Edit' }).click();
  await page.getByPlaceholder('Scenario Title').fill('Saved sepsis (v2)');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('div.justify-between', { hasText: 'Saved sepsis (v2)' })).toBeVisible();
  expect(Object.keys(await mine(page))).toEqual(ids);

  // Still there after a reload, and it runs
  await page.reload();
  await openMyScenarios(page);
  const again = page.locator('div.justify-between', { hasText: 'Saved sepsis (v2)' }).first();
  await expect(again).toBeVisible();
  await again.getByRole('button', { name: 'Load' }).click();
  await expect(page.getByRole('button', { name: 'Start Scenario' })).toBeVisible();
  await holder.close();
  expect(errors).toEqual([]);
});

test('each account sees only its own scenarios, and Delete removes one from the account', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await page.evaluate(() => {
    window.__fakeRtdb.set('userScenarios/uid_a_learner_example_org/CUST_1', { id: 'CUST_1', title: 'Learner A case', category: 'Medical', savedAt: 1 });
    window.__fakeRtdb.set('userScenarios/uid_b_learner_example_org/CUST_2', { id: 'CUST_2', title: 'Learner B case', category: 'Medical', savedAt: 1 });
  });
  await signIn(page);
  await openMyScenarios(page);
  await expect(page.getByText('Learner A case')).toBeVisible();
  await expect(page.getByText('Learner B case')).toHaveCount(0);

  await page.getByRole('button', { name: 'Delete Learner A case' }).click();   // the confirm is accepted
  await expect(page.getByText('Learner A case')).toHaveCount(0);
  expect(await mine(page)).toBeNull();

  await page.getByRole('button', { name: /^Your account/ }).click();
  await page.getByRole('button', { name: /Sign out/ }).click();
  await expect(page.getByText('Sign in to save your own scenarios')).toBeVisible();
  await signIn(page, 'b.learner@example.org');
  await expect(page.getByText('Learner B case')).toBeVisible();
  expect(errors).toEqual([]);
});

test('scenarios saved on this device before can still run signed out, and move into the account on sign-in', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('wmebem_custom_scenarios', JSON.stringify([
      { id: 'CUST_100', title: 'Old device case', category: 'Medical', patientAge: 50, sex: 'Male', vitals: { hr: 90, bpSys: 110 } },
      { id: 'bad/id', title: 'Odd id case', category: 'Medical' },
      { title: 'No id, not a scenario' }
    ]));
  });
  await openController(page);
  await openMyScenarios(page);
  const device = page.getByTestId('device-scenarios');
  await expect(device).toContainText('2 scenario(s) saved on this device only');
  await expect(device.getByText('Old device case')).toBeVisible();

  await signIn(page);
  await device.getByRole('button', { name: 'Add to my account' }).click();
  await expect(page.getByText('Added 2 scenario(s) from this device to your account.')).toBeVisible();
  await expect(page.getByTestId('device-scenarios')).toHaveCount(0);
  expect(await deviceList(page)).toBeNull();
  const stored = await mine(page);
  expect(stored.CUST_100).toMatchObject({ id: 'CUST_100', title: 'Old device case' });
  // An id that cannot be a database key is given a new one rather than lost
  const odd = Object.values(stored).find(s => s.title === 'Odd id case');
  expect(odd.id).toMatch(/^CUST_/);
  expect(stored[odd.id]).toBeTruthy();
  await expect(page.locator('div.justify-between', { hasText: 'Old device case' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('importing a file adds its scenarios to the account and skips ones already there', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await page.evaluate(() => window.__fakeRtdb.set('userScenarios/uid_a_learner_example_org/CUST_1', { id: 'CUST_1', title: 'Already mine', savedAt: 1 }));
  await signIn(page);
  await openMyScenarios(page);
  await expect(page.getByText('Already mine')).toBeVisible();
  const dialogs = [];
  page.on('dialog', d => dialogs.push(d.message()));
  await page.getByLabel('Import scenarios from a JSON file').setInputFiles({
    name: 'scenarios.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify([{ id: 'CUST_1', title: 'Already mine (copy)' }, { id: 'CUST_7', title: 'Imported case' }, { nope: 1 }]))
  });
  await expect(page.getByText('Imported case')).toBeVisible();
  await expect.poll(() => dialogs.join(' ')).toContain('Imported 1 new scenario(s) into your account. 1 skipped');
  const stored = await mine(page);
  expect(Object.keys(stored).sort()).toEqual(['CUST_1', 'CUST_7']);
  expect(stored.CUST_1.title).toBe('Already mine');
  expect(errors).toEqual([]);
});

test('importing the same file twice does not copy a scenario whose id had to be changed', async ({ page }) => {
  await openController(page);
  await signIn(page);
  await openMyScenarios(page);
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.accept().catch(() => {}); });
  const file = { name: 'odd.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([{ id: 'case.one/v2', title: 'Odd id case' }])) };
  await page.getByLabel('Import scenarios from a JSON file').setInputFiles(file);
  await expect.poll(() => dialogs.length).toBe(1);
  await expect(page.getByText('Odd id case')).toBeVisible();
  await page.getByLabel('Import scenarios from a JSON file').setInputFiles(file);
  await expect.poll(() => dialogs.length).toBe(2);
  expect(dialogs[1]).toContain('Imported 0 new scenario(s)');
  const stored = await mine(page);
  expect(Object.keys(stored).length).toBe(1);
  expect(Object.keys(stored)[0]).toMatch(/^CUST_[0-9a-z]+$/);
});
