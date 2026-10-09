// The real Firebase SDK starts on the built pages. The other specs replace Firebase with a fake, so
// they cannot see a build that breaks the SDK itself (a minified app script once overwrote the
// SDK's global helpers, and the controller ran with no database at all while every spec passed).
const { test, expect } = require('@playwright/test');

for (const url of ['/index.html', '/index.html?mode=monitor&session=K7PQ3M']) {
  test(`the real Firebase SDK initialises the database: ${url}`, async ({ page }) => {
    await page.goto(url);
    await expect.poll(() => page.evaluate(() => window.firebaseSyncBootstrap && window.firebaseSyncBootstrap.state)).not.toBe('unavailable');
    expect(await page.evaluate(() => !!(window.db && typeof window.db.ref === 'function'))).toBe(true);
  });
}
