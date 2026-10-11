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

test('welcome screen, the start options, each option and the patient screens card', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.getByTestId('welcome-controller')).toBeVisible();
  await check(page, 'welcome');
  await page.getByTestId('welcome-controller').click();
  await expect(page.getByTestId('mode-chooser')).toBeVisible();
  await check(page, 'start options');
  for (const id of ['quick', 'defib', 'vent', 'random', 'premade', 'custom']) {
    await page.getByTestId(`mode-${id}`).click();
    await check(page, `setup ${id}`);
    if (id === 'custom') {
      await page.getByRole('button', { name: 'Builder', exact: true }).click();
      await check(page, 'setup builder');
    }
    await page.getByRole('button', { name: 'All options' }).click();
  }
  await page.getByTestId('setup-toggle').click();
  await check(page, 'patient screens');
});

test('the patient screen join page', async ({ page }) => {
  await page.goto('/index.html');
  await page.getByTestId('welcome-screen').click();
  await expect(page.getByRole('heading', { name: 'Patient screen' })).toBeVisible();
  await check(page, 'join');
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
