// Jake's decision of 18 Oct 2026: the arrest scenarios CA001, CA002 and AM055 are filed under
// Cardiac Arrest, so they appear on the library's Cardiac Arrest tab. Their ids are unchanged.
const { test } = require('@playwright/test');
const { useFakeFirebase, openController, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

test('CA001, CA002 and AM055 are on the Cardiac Arrest tab and keep their ids', async ({ page }) => {
  await openController(page);
  const cats = await page.evaluate(() => ['CA001', 'CA002', 'AM055'].map(id => {
    const s = window.ALL_SCENARIOS.find(x => x.id === id);
    return s ? s.category : null;
  }));
  expect(cats).toEqual(['Cardiac Arrest', 'Cardiac Arrest', 'Cardiac Arrest']);

  await page.getByRole('button', { name: 'Scenario library', exact: true }).click();
  await page.getByRole('button', { name: 'Cardiac Arrest', exact: true }).click();
  for (const title of ['Adult VF Arrest', 'Paediatric PEA Arrest', 'HOCM Arrest']) {
    await expect(page.locator('div.justify-between', { hasText: title }).first()).toBeVisible();
  }
});
