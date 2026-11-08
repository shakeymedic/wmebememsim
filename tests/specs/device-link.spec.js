// The same-device link (data/local-link.js): with no internet, a controller and a patient screen in
// the same browser on the same device still link, directly, without Firebase.
// These tests give the pages a "dead" Firebase (never connects, writes go nowhere, nothing is shared
// between pages), so anything that reaches the monitor can only have come over the device link.
const { test } = require('@playwright/test');
const { trackErrors, openController, startQuickSim, pressStart, expect } = require('./helpers');

const DEAD_FIREBASE = `(function () {
  var never = function () { return new Promise(function () {}); };
  function ref(path) {
    var r = {
      key: String(path || '').split('/').filter(Boolean).pop() || null,
      child: function (c) { return ref(path + '/' + c); },
      limitToLast: function () { return r; },
      orderByChild: function () { return r; },
      on: function (ev, cb) {
        if (path === '.info/connected' && ev === 'value') setTimeout(function () { cb({ key: 'connected', val: function () { return false; }, exists: function () { return true; } }); }, 0);
        return cb;
      },
      off: function () {},
      once: never, set: never, update: never, remove: never,
      push: function () { var c = ref(path + '/-x' + Math.random().toString(36).slice(2)); var p = never(); c.then = p.then.bind(p); c.catch = p.catch.bind(p); return c; },
      onDisconnect: function () { return { remove: never, set: never, cancel: never }; }
    };
    return r;
  }
  var db = { ref: ref };
  window.firebase = { apps: [], initializeApp: function (c) { window.firebase.apps.push({ options: c }); return window.firebase.apps[0]; }, database: function () { return db; } };
})();`;

async function useDeadFirebase(context) {
  await context.route('**/vendor/firebase/firebase-app.js', r => r.fulfill({ contentType: 'text/javascript', body: DEAD_FIREBASE }));
  await context.route('**/vendor/firebase/firebase-database.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await context.route('**/vendor/firebase/firebase-auth.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await context.route('**/vendor/firebase/firebase-app-check.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await context.route(/^https?:\/\/(?!localhost)/, r => r.abort());
}

const monitorHr = (monitor) => monitor.evaluate(() => {
  const e = window.__monitorEngine;
  return e && e.state.lastUpdate ? e.state.vitals.hr : null;
});

test('with no internet, choosing "Link on this device only" links a patient screen in the same browser', async ({ page, context }) => {
  await useDeadFirebase(context);
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  await pressStart(page);
  // Not linked: Firebase never connects.
  await expect(page.getByTestId('connection-badge')).toContainText(/sync error|syncing/i);
  await page.getByRole('button', { name: /^Screens/ }).click();
  await expect(page.getByTestId('device-link')).toBeVisible();
  await page.getByTestId('device-link-on').click();
  await expect(page.getByTestId('device-link')).toContainText('Linked on this device only');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('connection-badge')).toContainText(/this device/i);

  const monitor = await context.newPage();
  const monErrors = trackErrors(monitor);
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitorHr(monitor), { timeout: 15000 }).not.toBeNull();
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'UPDATE_VITALS', payload: { hr: 143 } }));
  await expect.poll(() => monitorHr(monitor), { timeout: 15000 }).toBe(143);
  // The patient screen's warning banner has gone.
  await expect(monitor.getByText('Disconnected from live session.')).toHaveCount(0);

  // Turning it off again goes back to the (dead) internet link.
  await page.getByRole('button', { name: /^Screens/ }).click();
  await page.getByTestId('device-link-off').click();
  await expect(page.getByTestId('device-link')).toContainText('No internet?');
  expect(errors).toEqual([]);
  expect(monErrors).toEqual([]);
});

test('when the browser is offline the device link turns on by itself', async ({ page, context }) => {
  await useDeadFirebase(context);
  await context.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false, configurable: true }); });
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  await pressStart(page);
  await expect(page.getByTestId('connection-badge')).toContainText(/this device/i);
  const monitor = await context.newPage();
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'UPDATE_VITALS', payload: { hr: 51 } }));
  await expect.poll(() => monitorHr(monitor), { timeout: 15000 }).toBe(51);
  expect(errors).toEqual([]);
});

test('a patient screen that is disconnected offers the device link', async ({ page, context }) => {
  await useDeadFirebase(context);
  const code = await openController(page);
  await startQuickSim(page);
  await pressStart(page);
  const monitor = await context.newPage();
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  const btn = monitor.getByTestId('device-link-on');
  await expect(btn).toBeVisible({ timeout: 15000 });
  await btn.click();
  // The choice is shared by every tab of the site in this browser, so the controller follows.
  await expect(page.getByTestId('connection-badge')).toContainText(/this device/i);
  await expect.poll(() => monitorHr(monitor), { timeout: 15000 }).not.toBeNull();
});
