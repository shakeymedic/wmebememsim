// The first screen: is this device the controller or a patient screen? The controller then picks
// what to run; the patient screen set-up is optional and folded away. The set-ups themselves are in
// screens.spec.js.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

test('first visit asks what the device is for; the controller sees the start options and the session code', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  await expect(page.getByRole('heading', { name: 'What is this device for?' })).toBeVisible();
  await expect(page.getByTestId('session-code')).toHaveCount(0);
  await page.getByTestId('welcome-controller').click();
  await expect(page.getByRole('heading', { name: 'What do you want to run?' })).toBeVisible();
  const card = page.getByTestId('setup-card');
  await expect(card.getByTestId('session-code')).toHaveText(/^[A-Z0-9]{6}$/);
  // the screen set-up is not asked up front
  await expect(card.getByTestId('setup-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(card.getByTestId('screens-panel')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a reload in the same tab keeps the controller choice; a new tab asks again', async ({ page, context }) => {
  await page.goto('/index.html');
  await page.getByTestId('welcome-controller').click();
  await expect(page.getByTestId('mode-chooser')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('mode-chooser')).toBeVisible();
  const other = await context.newPage();
  await other.goto('/index.html');
  await expect(other.getByTestId('welcome-controller')).toBeVisible();
});

test('picking an option opens it, and All options goes back', async ({ page }) => {
  await page.goto('/index.html');
  await page.getByTestId('welcome-controller').click();
  await page.getByTestId('mode-quick').click();
  await expect(page.getByRole('button', { name: 'Start Quick Sim' })).toBeVisible();
  await expect(page.getByTestId('mode-chooser')).toHaveCount(0);
  await page.getByRole('button', { name: 'All options' }).click();
  await expect(page.getByTestId('mode-chooser')).toBeVisible();
});

test('patient screen goes to the code entry, with a way back', async ({ page }) => {
  await page.goto('/index.html');
  await page.getByTestId('welcome-screen').click();
  await expect(page.getByRole('heading', { name: 'Patient screen' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'What is this device for?' })).toBeVisible();
});
