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
  // App Check needs the real SDK; with the fake it is not loaded (the site key is empty anyway).
  await context.route('**/vendor/firebase/firebase-app-check.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await context.route(/^https?:\/\/(?!localhost)/, r => r.abort());
}

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept().catch(() => {}));
  return errors;
}

// The first screen asks what this device is for; a reload in the same tab skips it.
async function chooseController(page) {
  const first = page.getByTestId('welcome-controller').or(page.getByText('Session Code', { exact: true }));
  await expect(first.first()).toBeVisible();
  if (await page.getByTestId('welcome-controller').isVisible()) await page.getByTestId('welcome-controller').click();
}

// Open the controller and return its session code
async function openController(page) {
  await page.goto('/index.html');
  await chooseController(page);
  await expect(page.getByText('Session Code', { exact: true })).toBeVisible();
  return page.evaluate(() => localStorage.getItem('wmebem_session_id'));
}

// Quick Sim starts with its rhythms-and-log column folded away (the obs column fills the screen). Most
// tests use that column, so this opens it unless { folded: true } is passed. Phones never fold it.
async function startQuickSim(page, { folded = false } = {}) {
  await page.getByRole('button', { name: 'Quick Sim', exact: true }).click();
  await page.getByRole('button', { name: 'Start Quick Sim' }).click();
  if (!folded) await openRightColumn(page);
  else await page.locator('[data-testid="right-fold-bar"] button').first().waitFor({ state: 'attached' });
}

// Every run (Quick Sim and scenarios alike) starts with the right-hand column folded away on a tablet
// or computer. Open it, as the facilitator does, when a test uses the interventions, rhythms or log.
// A no-op on a phone, where nothing folds.
async function openRightColumn(page) {
  const fold = page.locator('[data-testid="right-fold-bar"] button');
  await fold.first().waitFor({ state: 'attached' });
  if (!(await fold.isVisible())) return;
  await expect(async () => {
    if ((await fold.getAttribute('aria-expanded')) === 'false') await fold.click();
    await expect(fold).toHaveAttribute('aria-expanded', 'true', { timeout: 1000 });
  }).toPass({ timeout: 15000 });
}

// Every launch mode waits for START (the controller says "Not started" until then). Press it, as
// the facilitator does, when a test needs the patient live.
async function pressStart(page) {
  await page.getByRole('button', { name: 'START', exact: true }).click();
  await expect(page.getByRole('button', { name: 'PAUSE', exact: true })).toBeVisible();
}

// Open a collapsible section (data/components.js Section) if it is closed
async function expandSection(page, id) {
  const head = page.locator(`[data-section="${id}"] > div > button[aria-expanded]`);
  if (await head.getAttribute('aria-expanded') === 'false') await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'true');
}

// The live session as the fake database holds it
const session = (page, code, sub = '') => page.evaluate(([c, s]) => window.__fakeRtdb.get(`sessions/${c}${s}`), [code, sub]);
// The live patient the controller publishes (sessions/<CODE>/live)
const live = (page, code, sub = '') => session(page, code, '/live' + sub);

module.exports = { useFakeFirebase, trackErrors, chooseController, openController, startQuickSim, openRightColumn, pressStart, expandSection, session, live, expect };
