// Accessibility: automated WCAG 2.1 A/AA checks (axe-core) on the main screens. Any critical or
// serious violation fails. (Automated checks find roughly a third of accessibility problems; they
// do not replace testing with a screen reader and keyboard.)
const { test } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { useFakeFirebase, openController, startQuickSim, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

async function check(page, where) {
  await page.waitForTimeout(700);                 // let fade-in animations finish before measuring
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const bad = r.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
    .map(v => `${where}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`);
  expect(bad).toEqual([]);
}

test('setup screen, every start tab', async ({ page }) => {
  await openController(page);
  for (const tab of [/^quick sim$/i, /^defib sim$/i, /^random$/i, /^premade$/i, /^custom$/i, /^builder/i]) {
    await page.getByRole('button', { name: tab }).first().click();
    await check(page, `setup ${tab}`);
  }
});

test('Quick Sim controller and the room monitor', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  await check(page, 'controller');
  const monitor = await context.newPage();
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await check(monitor, 'monitor');
});

test('Defib controller and the defib tablet', async ({ page, context }) => {
  const code = await openController(page);
  await page.getByRole('button', { name: 'Defib Sim', exact: true }).click();
  await page.locator('[data-defib-scenario="vf-arrest"]').click();
  await page.getByRole('button', { name: 'Start Defib Sim' }).click();
  await check(page, 'defib controller');
  const defib = await context.newPage();
  await defib.goto(`/defib/index.html?session=${code}`);
  await check(defib, 'defib tablet');
});
