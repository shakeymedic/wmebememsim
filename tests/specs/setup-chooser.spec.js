// The start screen's "How are you running the sim?" chooser: one computer with two screens, or two
// devices (this one runs the sim, or this one is the room monitor). The choice is remembered.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

test('first visit asks how the sim is being run; one computer, two screens', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/index.html');
  const card = page.getByTestId('setup-card');
  await expect(card.getByRole('heading', { name: 'How are you running the sim?' })).toBeVisible();
  await expect(card.getByText('Session Code', { exact: true })).toBeVisible();
  const code = await page.evaluate(() => localStorage.getItem('wmebem_session_id'));

  await card.getByTestId('setup-one').click();
  const open = card.getByRole('link', { name: 'Open the room monitor in a new window' });
  await expect(open).toHaveAttribute('href', new RegExp(`\\?mode=monitor&session=${code}$`));
  await expect(open).toHaveAttribute('target', 'emsim-room-monitor');
  await expect(card.getByText(/set it to extend/i)).toBeVisible();

  // Remembered on this device
  await page.reload();
  await expect(page.getByTestId('setup-card').getByRole('link', { name: 'Open the room monitor in a new window' })).toBeVisible();
  await expect(page.getByTestId('setup-card').getByRole('heading', { name: 'How are you running the sim?' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('two devices: this one runs the sim shows the code and a QR code for the monitor', async ({ page }) => {
  await page.goto('/index.html');
  const card = page.getByTestId('setup-card');
  await card.getByTestId('setup-two').click();
  await expect(card.getByTestId('setup-monitor-qr').locator('svg')).toBeVisible();
  await expect(card.getByTestId('session-code')).toHaveText(/^[A-Z0-9]{6}$/);
  await card.getByRole('button', { name: 'Change set-up' }).click();
  await expect(card.getByRole('heading', { name: 'How are you running the sim?' })).toBeVisible();
});

test('two devices: this is the room monitor goes to the code entry, with a way back', async ({ page }) => {
  await page.goto('/index.html');
  await page.getByTestId('setup-monitor').click();
  await expect(page.getByRole('heading', { name: 'Sim Monitor' })).toBeVisible();
  await page.getByRole('button', { name: /Back: this device runs the sim/ }).click();
  await expect(page.getByTestId('setup-card')).toBeVisible();
});
