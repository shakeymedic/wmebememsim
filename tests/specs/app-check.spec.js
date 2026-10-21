// Firebase App Check (data/firebase-config.js). With an empty site key nothing changes; with the
// shipped key, every page that uses the database turns App Check on (reCAPTCHA Enterprise, auto-refresh) BEFORE its
// first firebase.database(). Enforcement is a Firebase console switch and is never set from the code.
const fs = require('fs');
const path = require('path');
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, chooseController, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

// Stands in for firebase-app-check-compat.js on top of the fake SDK: records activate() and every
// firebase.database() call, in order.
const STUB = `(function () {
  var calls = window.__appCheckCalls = [];
  var db = firebase.database;
  firebase.database = function () { calls.push({ type: 'database' }); return db.apply(this, arguments); };
  function ReCaptchaEnterpriseProvider(key) { this.siteKey = key; }
  firebase.appCheck = function () { return { activate: function (p, refresh) { calls.push({ type: 'activate', provider: p instanceof ReCaptchaEnterpriseProvider ? 'enterprise' : '?', key: p.siteKey, refresh: refresh }); } }; };
  firebase.appCheck.ReCaptchaEnterpriseProvider = ReCaptchaEnterpriseProvider;
})();`;

async function withSiteKey(context, key) {
  await context.route('**/vendor/firebase/firebase-app-check.js', r => r.fulfill({ contentType: 'text/javascript', body: STUB }));
  const cfg = fs.readFileSync(path.join(__dirname, '..', '..', 'dist', 'data', 'firebase-config.js'), 'utf8');
  const keyed = cfg.replace(/APP_CHECK_SITE_KEY\s*=\s*(['"])[^'"]*\1/, `APP_CHECK_SITE_KEY="${key}"`);
  expect(keyed).not.toBe(cfg);
  await context.route('**/data/firebase-config.js', r => r.fulfill({ contentType: 'text/javascript', body: keyed }));
}

test('the shipped key is the reCAPTCHA Enterprise key ID', async () => {
  const cfg = fs.readFileSync(path.join(__dirname, '..', '..', 'dist', 'data', 'firebase-config.js'), 'utf8');
  expect(cfg).toMatch(/APP_CHECK_SITE_KEY\s*=\s*(['"])6LejavotAAAAABzVzU6ToO0X5YtvXOf1MEoOdUz6\1/);
  expect(cfg).toContain('ReCaptchaEnterpriseProvider');
});

test('with an empty site key, App Check stays off and the controller works as before', async ({ page, context }) => {
  await withSiteKey(context, '');
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await chooseController(page);
  await expect(page.getByText('Session Code', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.APP_CHECK_SITE_KEY)).toBe('');
  const calls = await page.evaluate(() => window.__appCheckCalls);
  expect(calls.filter(c => c.type === 'activate')).toEqual([]);
  expect(calls.some(c => c.type === 'database')).toBe(true);
  expect(errors).toEqual([]);
});

for (const url of ['/index.html', '/index.html?mode=monitor&session=K7PQ3M', '/defib/index.html?session=K7PQ3M',
                   '/vent/index.html?session=K7PQ3M', '/vent/c6.html?session=K7PQ3M', '/vent/a350.html?session=K7PQ3M']) {
  test(`with a site key, App Check starts before the first database use: ${url}`, async ({ page, context }) => {
    await withSiteKey(context, 'test-site-key');
    const errors = trackErrors(page);
    await page.goto(url);
    await expect.poll(() => page.evaluate(() => (window.__appCheckCalls || []).some(c => c.type === 'database'))).toBe(true);
    const calls = await page.evaluate(() => window.__appCheckCalls);
    expect(calls[0]).toEqual({ type: 'activate', provider: 'enterprise', key: 'test-site-key', refresh: true });
    expect(calls.filter(c => c.type === 'activate')).toHaveLength(1);
    expect(errors).toEqual([]);
  });
}
