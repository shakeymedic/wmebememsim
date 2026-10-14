// "What do you want to run?" has a way back to the app's first screen (Controller or Patient screen),
// so a device opened as a controller can be turned into a patient screen without clearing anything.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

test('Start screen goes back from "What do you want to run?" to the first screen, and stays there on reload', async ({ page }) => {
  const errors = trackErrors(page);
  await openController(page);
  await expect(page.getByTestId('mode-chooser')).toBeVisible();
  await page.getByRole('button', { name: 'Back to the start screen' }).click();
  await expect(page.getByTestId('welcome-controller')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('welcome-controller')).toBeVisible();     // no longer remembered as a controller
  await page.getByTestId('welcome-controller').click();
  await expect(page.getByTestId('mode-chooser')).toBeVisible();
  expect(errors).toEqual([]);
});
