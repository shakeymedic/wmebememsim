// Offline: after one online visit the app and the defib tablet load with no network at all.
const { test } = require('@playwright/test');
const { useFakeFirebase, expect } = require('./helpers');

test.use({ serviceWorkers: 'allow' });
test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

async function waitForStoredFiles(page, prefix) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(async (p) => {
    const keys = (await caches.keys()).filter(k => k.startsWith(p));
    if (!keys.length) return 0;
    return (await (await caches.open(keys[0])).keys()).length;
  }, prefix), { timeout: 20000 }).toBeGreaterThan(10);
}

test('the controller works offline after one visit', async ({ page, context }) => {
  await page.goto('/index.html');
  await expect(page.getByText('Session Code', { exact: true })).toBeVisible();
  await waitForStoredFiles(page, 'emsim-app-');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText('Session Code', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Quick Sim', exact: true }).click();
  await page.getByRole('button', { name: 'Start Quick Sim' }).click();
  await expect(page.getByTestId('connection-badge')).toHaveText(/Live|Sync error|Syncing/);
  await context.setOffline(false);
});

test('the defib tablet works offline after one visit, and keeps the app cache', async ({ page, context }) => {
  await page.goto('/index.html');
  await waitForStoredFiles(page, 'emsim-app-');
  await page.goto('/defib/index.html');
  await waitForStoredFiles(page, 'emsim-defib-');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#zollDevice')).toBeVisible();
  await expect(page.locator('#linkBanner')).toContainText('NOT LINKED');
  // Installing the defib worker must not have deleted the app's stored files
  const appKeys = await page.evaluate(async () => (await caches.keys()).filter(k => k.startsWith('emsim-app-')).length);
  expect(appKeys).toBe(1);
  await context.setOffline(false);
});
