// "Download PDF" on the debrief: the report is saved as an A4 PDF (data/report-pdf.js), split over
// as many pages as it needs, and falls back to the web-page report if the PDF cannot be made.
const fs = require('fs');
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, expect } = require('./helpers');

test.beforeEach(async ({ context, page }) => { await useFakeFirebase(context); page.on('dialog', d => d.accept()); });

const E = (page, fn, arg) => page.evaluate(fn, arg);
const finish = async (page) => { await page.getByRole('button', { name: 'Finish' }).first().click(); await expect(page.getByText('Simulation Complete')).toBeVisible(); };

const longRun = async (page) => {
  await openController(page);
  await startQuickSim(page);
  await E(page, () => window.__simEngine.start());
  // A long log, so the report runs over several pages.
  for (let i = 0; i < 6; i++) await E(page, (n) => { for (let j = 0; j < 25; j++) window.__simEngine.addLogEntry(`Test event ${n * 25 + j + 1}`, 'action'); window.__simEngine.dispatch({ type: 'TICK_TIME' }); }, i);
  await finish(page);
};

test('Download PDF saves a multi-page A4 PDF of the debrief', async ({ page }) => {
  test.setTimeout(90000);
  const errors = trackErrors(page);
  await longRun(page);
  const btn = page.getByRole('button', { name: /Download PDF/ });
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), btn.click()]);
  expect(download.suggestedFilename()).toMatch(/^Debrief - .+ - \d{4}-\d{2}-\d{2} \d{4}\.pdf$/);
  const buf = fs.readFileSync(await download.path());
  expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  expect(pages).toBeGreaterThan(1);
  expect(buf.toString('latin1')).toMatch(/\/MediaBox \[0 0 595\.2\d* 841\.8\d*\]/);   // A4
  if (process.env.SAVE_PDF) fs.copyFileSync(await download.path(), process.env.SAVE_PDF);
  await expect(btn).toBeEnabled();
  expect(await page.locator('iframe[aria-hidden="true"]').count()).toBe(0);   // the off-screen frame is removed
  expect(errors).toEqual([]);
});

test('if the PDF cannot be made, the report is saved as a web page instead', async ({ page }) => {
  await page.route('**/vendor/jspdf.umd.min.js', (route) => route.abort());
  await longRun(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download PDF/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.html$/);
  const html = fs.readFileSync(await download.path(), 'utf8');
  expect(html).toContain('Simulation Log');
  expect(html).toContain('Test event 150');
});
