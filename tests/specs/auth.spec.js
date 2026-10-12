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
  // The sign-in box closes by itself and the header shows the account
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Your account/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: /^Your account/ })).toBeVisible();    // restored at start-up

  await page.getByRole('button', { name: /^Your account/ }).click();
  await expect(page.getByText('Signed in as')).toBeVisible();
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
  // No approval status in the header by default
  await expect(page.getByText('pending', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
  await page.getByRole('button', { name: /Course scenarios \(ALS, ETC\)/ }).click();
  await expect(page.getByText('This section is locked.')).toBeVisible();
  await page.getByRole('button', { name: 'Request ALS access' }).click();
  await expect(page.getByTestId('course-access-rcuk')).toContainText('Requested, awaiting approval');
  await expect(page.getByTestId('course-access-etc').getByRole('button', { name: 'Request ETC access' })).toBeVisible();
  await expect.poll(() => page.evaluate(([u]) => window.__fakeRtdb.get(`users/${u}/requestedAccess/rcuk`), [uid])).toBe(true);

  await page.evaluate(([u]) => window.__fakeRtdb.set(`users/${u}`, { email: 'a.learner@example.org', status: 'approved', entitlements: { rcuk: true } }), [uid]);
  await expect(page.getByText('Restricted Test Scenario')).toBeVisible({ timeout: 10000 });
});

test('Continue with Google: a clear message when it is not switched on, and it signs in when it is', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await page.getByRole('button', { name: /^Sign in$/ }).first().click();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page.getByText('Google sign-in is not switched on for this project yet.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Create account', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Create account with Google' })).toBeVisible();

  await page.evaluate(() => { window.__fakeGoogleEmail = 'g.user@gmail.com'; });
  await page.getByRole('button', { name: 'Create account with Google' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);                              // closes by itself
  await expect(page.getByRole('button', { name: 'Your account (Google User)' })).toBeVisible();
  // The profile is created on first sign-in, exactly as for an email account
  await expect.poll(() => page.evaluate(() => window.__fakeRtdb.get('users/uid_g_user_gmail_com/email'))).toBe('g.user@gmail.com');
  expect(errors).toEqual([]);
});

test('the account panel: course access is opt-in, requested from the panel, and sign out is there', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await signIn(page, 'a.learner@example.org');
  await page.getByRole('button', { name: /^Your account/ }).click();
  const panel = page.getByRole('dialog');
  await expect(panel.getByText('Course scenarios (optional)')).toBeVisible();
  await expect(panel.getByText(/Each course is approved separately/)).toBeVisible();
  await panel.getByRole('button', { name: 'Request ETC access' }).click();
  await expect(panel.getByTestId('course-access-etc')).toContainText('Requested, awaiting approval');
  await expect(panel.getByTestId('course-access-rcuk').getByRole('button', { name: 'Request ALS access' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__fakeRtdb.get('users/uid_a_learner_example_org/requestedAccess/etc'))).toBe(true);
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(errors).toEqual([]);
});
