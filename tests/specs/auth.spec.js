// Accounts: the sign-in library loads only when needed; sign-in, sign-out and restricted content
// (client-side gating only: the real enforcement is database.rules.json, which the in-memory
// database does not apply).
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const authRequests = (page) => { const seen = []; page.on('request', r => { if (/firebase-auth\.js/.test(r.url())) seen.push(r.url()); }); return seen; };

async function signIn(page, email, password = 'correct horse') {
  await page.getByRole('button', { name: /^Sign in$/ }).first().click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.locator('form button[type=submit]').click();
}

test('the controller and the room monitor do not download the sign-in library', async ({ page, context }) => {
  const errors = trackErrors(page);
  const seen = authRequests(page);
  const code = await openController(page);
  await page.waitForTimeout(1000);
  expect(seen).toEqual([]);
  const monitor = await context.newPage();
  const seenMon = authRequests(monitor);
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await monitor.waitForTimeout(1000);
  expect(seenMon).toEqual([]);
  expect(errors).toEqual([]);
});

test('signing in fetches the library, a reload restores the account, and signing out stops the fetch', async ({ page }) => {
  const errors = trackErrors(page);
  const seen = authRequests(page);
  await openController(page);
  await signIn(page, 'a.learner@example.org', 'wrong');
  await expect(page.getByText('Incorrect password.')).toBeVisible();
  expect(seen.length).toBe(1);
  await page.locator('form button[type=submit]').click();   // still wrong
  await page.getByLabel('Password').fill('correct horse');
  await page.locator('form button[type=submit]').click();
  await page.getByRole('button', { name: 'Close account panel' }).click();
  await expect(page.getByRole('button', { name: /Sign out/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: /Sign out/ })).toBeVisible();    // restored at start-up

  await page.getByRole('button', { name: /Sign out/ }).click();
  await expect(page.getByRole('button', { name: /^Sign in$/ })).toBeVisible();
  const before = seen.length;
  await page.reload();
  await expect(page.getByText('Session Code', { exact: true })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(seen.length).toBe(before);                                                // not fetched again
  expect(errors).toEqual([]);
});

test('restricted scenarios: locked without the entitlement, listed with it', async ({ page }) => {
  trackErrors(page);
  await openController(page);
  const uid = 'uid_a_learner_example_org';
  await page.evaluate(([u]) => {
    window.__fakeRtdb.set(`users/${u}`, { email: 'a.learner@example.org', status: 'pending' });
    window.__fakeRtdb.set('restrictedScenarios/RC001', { id: 'RC001', title: 'Restricted Test Scenario', category: 'Cardiac Arrest', ageRange: 'Adult', acuity: 'Resus', patientProfileTemplate: 'Test.', vitalsMod: { hr: 0, bpSys: 0 }, ecg: { type: 'VF', findings: 'VF' } });
  }, [uid]);
  await signIn(page, 'a.learner@example.org');
  await page.getByRole('button', { name: 'Close account panel' }).click();
  await page.getByRole('button', { name: /^premade$/i }).click();
  await page.getByRole('button', { name: /Restricted \(RCUK\)/ }).click();
  await expect(page.getByText('This section is locked.')).toBeVisible();
  await expect(page.getByText('awaiting approval')).toBeVisible();

  await page.evaluate(([u]) => window.__fakeRtdb.set(`users/${u}`, { email: 'a.learner@example.org', status: 'approved', entitlements: { rcuk: true } }), [uid]);
  await expect(page.getByText('Restricted Test Scenario')).toBeVisible({ timeout: 10000 });
});
