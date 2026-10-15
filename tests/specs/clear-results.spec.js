// Jake, 15 Oct 2026: the controller can clear the images and investigation results it sends, and in
// Quick Sim the investigations sit in the obs column just above Rhythm & resus.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, pressStart, expandSection, expect } = require('./helpers');

test.beforeEach(async ({ context, page }) => { await useFakeFirebase(context); page.on('dialog', d => d.accept()); });

async function openMonitor(context, code) {
  const monitor = await context.newPage();
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  return monitor;
}
// The result card stays in the page and fades out when there is nothing to show.
const shown = (monitor) => monitor.getByTestId('inv-result').evaluate(el => !/opacity-0/.test(el.parentElement.className));

test('Quick Sim: Send puts a result on the monitor and Clear screens takes it off', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page, { folded: true });
  await pressStart(page);
  const monitor = await openMonitor(context, code);
  const monErrors = trackErrors(monitor);

  // In the obs column (not the folded right column), just above Rhythm & resus
  const order = await page.evaluate(() => {
    const ids = Array.from(document.querySelectorAll('[data-section]')).map(e => e.getAttribute('data-section'));
    const inv = document.querySelector('[data-section="quickInvResults"]');
    return { ids, inRight: !!inv.closest('#right-column') };
  });
  expect(order.inRight).toBe(false);
  expect(order.ids.indexOf('resus') - order.ids.indexOf('quickInvResults')).toBe(1);
  await expandSection(page, 'quickInvResults');
  await expect(page.getByTestId('inv-on-screens')).toContainText('Nothing sent');

  await page.getByTestId('inv-send-X-ray').click();
  await expect.poll(() => shown(monitor)).toBe(true);
  await expect(page.getByTestId('inv-on-screens')).toContainText('On the patient screens: X-ray');

  await page.getByTestId('inv-clear-screens').click();
  await expect.poll(() => shown(monitor)).toBe(false);
  await expect(page.getByTestId('inv-on-screens')).toContainText('Nothing sent');
  expect(await page.evaluate(() => window.__simEngine.state.log.map(l => l.msg).join('|'))).toContain('cleared from the patient screens');

  // A result the team opens on the monitor after the clear stays up while the controller keeps syncing
  await monitor.getByRole('button', { name: /VBG/ }).first().click();
  await expect.poll(() => shown(monitor)).toBe(true);
  await monitor.waitForTimeout(3000);
  expect(await shown(monitor)).toBe(true);
  // ...and Clear screens takes that off too
  await page.getByTestId('inv-clear-screens').click();
  await expect.poll(() => shown(monitor)).toBe(false);
  expect(errors).toEqual([]);
  expect(monErrors).toEqual([]);
});

test('a library image sent from the result chooser clears too, and Defib Sim has Clear screens', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  await pressStart(page);
  const monitor = await openMonitor(context, code);
  await page.evaluate(() => window.__simEngine.revealInvestigation('X-ray', 'report text', { image: 'cxr-copd', hideReport: true }));
  await expect(monitor.getByTestId('inv-image')).toHaveAttribute('src', 'images/investigations/cxr-copd.jpg');
  await expandSection(page, 'quickInvResults');
  await page.getByTestId('inv-clear-screens').click();
  await expect.poll(() => shown(monitor)).toBe(false);

  await page.getByRole('button', { name: 'Finish' }).first().click();
  await page.getByRole('button', { name: 'Exit to Menu' }).click();
  await page.getByRole('button', { name: 'Defib Sim', exact: true }).click();
  await page.locator('[data-defib-scenario="vf-arrest"]').click();
  await page.getByRole('button', { name: 'Start Defib Sim' }).click();
  const head = page.locator('[data-section]').filter({ hasText: 'Investigations: send or change' }).first();
  await expandSection(page, await head.getAttribute('data-section'));
  await expect(page.getByTestId('inv-clear-screens')).toBeVisible();
});

test('Clear screens also takes the patient picture off the monitor', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  await pressStart(page);
  const monitor = await openMonitor(context, code);
  await page.getByTestId('patient-status').getByTestId('picture-on-monitor').click();
  await expect(monitor.getByTestId('monitor-picture')).toBeVisible();
  await expandSection(page, 'quickInvResults');
  await expect(page.getByTestId('inv-on-screens')).toContainText('Patient picture');
  await page.getByTestId('inv-clear-screens').click();
  await expect(monitor.getByTestId('monitor-picture')).toHaveCount(0);
});
