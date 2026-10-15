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
  const fold = page.locator('[data-testid="right-fold-bar"] button');
  await fold.first().waitFor({ state: 'attached' });
  if (!folded && await fold.isVisible() && (await fold.getAttribute('aria-expanded')) === 'false') await fold.click();
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

module.exports = { useFakeFirebase, trackErrors, chooseController, openController, startQuickSim, pressStart, expandSection, session, live, expect };
