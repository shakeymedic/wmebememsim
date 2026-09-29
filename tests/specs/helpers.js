// Shared helpers for the WMEBEM Sim browser tests
const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');

const FAKE_FIREBASE = fs.readFileSync(path.join(__dirname, '..', 'fake-firebase.js'), 'utf8');
const FAKE_AUTH = fs.readFileSync(path.join(__dirname, '..', 'fake-auth.js'), 'utf8');

// Swap the Firebase SDK for the in-memory fake in every page of this context (popups included),
// and keep tests off the network.
async function useFakeFirebase(context) {
  await context.route('**/vendor/firebase/firebase-app.js', r => r.fulfill({ contentType: 'text/javascript', body: FAKE_FIREBASE }));
  await context.route('**/vendor/firebase/firebase-database.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await context.route('**/vendor/firebase/firebase-auth.js', r => r.fulfill({ contentType: 'text/javascript', body: FAKE_AUTH }));
  await context.route(/^https?:\/\/(?!localhost)/, r => r.abort());
}

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept().catch(() => {}));
  return errors;
}

// Open the controller and return its session code
async function openController(page) {
  await page.goto('/index.html');
  await expect(page.getByText('Session Code', { exact: true })).toBeVisible();
  return page.evaluate(() => localStorage.getItem('wmebem_session_id'));
}

async function startQuickSim(page) {
  await page.getByRole('button', { name: 'Quick Sim', exact: true }).click();
  await page.getByRole('button', { name: 'Start Quick Sim' }).click();
}

// The live session as the fake database holds it
const session = (page, code, sub = '') => page.evaluate(([c, s]) => window.__fakeRtdb.get(`sessions/${c}${s}`), [code, sub]);
// The live patient the controller publishes (sessions/<CODE>/live)
const live = (page, code, sub = '') => session(page, code, '/live' + sub);

module.exports = { useFakeFirebase, trackErrors, openController, startQuickSim, session, live, expect };
