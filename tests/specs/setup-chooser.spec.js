// The start screen's "How are you running the sim?" chooser. The screen set-ups themselves are in
// screens.spec.js; this covers the way in for a device that is a patient screen.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

test('first visit asks how the sim is being run, and shows the session code', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  const card = page.getByTestId('setup-card');
  await expect(card.getByRole('heading', { name: 'How are you running the sim?' })).toBeVisible();
  await expect(card.getByTestId('session-code')).toHaveText(/^[A-Z0-9]{6}$/);
  expect(errors).toEqual([]);
});

test('this device is a patient screen goes to the code entry, with a way back', async ({ page }) => {
  await page.goto('/index.html');
  await page.getByTestId('setup-join').click();
  await expect(page.getByRole('heading', { name: 'Patient screen' })).toBeVisible();
  await page.getByRole('button', { name: /Back: this device runs the sim/ }).click();
  await expect(page.getByTestId('setup-card')).toBeVisible();
});
