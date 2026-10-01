// The instructor guides (guides/): reachable from the app, every link on them works, the PDFs are
// served, and the pages pass the same automated accessibility checks as the app.
const { test } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { useFakeFirebase, openController, startQuickSim, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const PAGES = ['guides/index.html', 'guides/quick-start.html', 'guides/instructor-guide.html'];

test('the footer links to the guides on the instructor screens, never on the room monitor', async ({ page, context }) => {
  const code = await openController(page);
  const check = async () => {
    const links = page.locator('footer').getByTestId('guide-links');
    await expect(links.getByRole('link', { name: 'Quick start' })).toHaveAttribute('href', 'guides/quick-start.html');
    await expect(links.getByRole('link', { name: 'Full guide' })).toHaveAttribute('href', 'guides/instructor-guide.html');
    await expect(links.getByRole('link', { name: 'PDFs' })).toHaveAttribute('href', 'guides/index.html');
  };
  await check();                                   // setup screen
  await startQuickSim(page);
  await check();                                   // live scenario
  const monitor = await context.newPage();
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  await expect(monitor.getByText('Tap to Enable Sound')).toBeVisible();
  await expect(monitor.getByTestId('guide-links')).toHaveCount(0);
});

test('every link on the guide pages works, including the PDFs and in-page contents', async ({ page, request }) => {
  for (const url of PAGES) {
    await page.goto('/' + url);
    await expect(page.locator('h1')).toBeVisible();
    const hrefs = await page.$$eval('a[href]', as => as.map(a => a.getAttribute('href')));
    for (const href of hrefs) {
      if (/^https?:/.test(href)) continue;                       // the live site's own address
      if (href.startsWith('#')) {
        expect(await page.locator(href).count(), `${url} ${href}`).toBe(1);
        continue;
      }
      const target = new URL(href, page.url());
      const res = await request.get(target.pathname);
      expect(res.status(), `${url} -> ${href}`).toBe(200);
      if (href.endsWith('.pdf')) expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');
    }
  }
});

test('accessibility: the guide pages', async ({ page }) => {
  for (const url of PAGES) {
    await page.goto('/' + url);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const bad = r.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')
      .map(v => `${url}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(' | ')}`);
    expect(bad).toEqual([]);
  }
});
