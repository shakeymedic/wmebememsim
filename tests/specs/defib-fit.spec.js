// The defib tablet keeps one shape and fits the window: on anything bigger than a phone the whole
// device is scaled to fit (device.css "Fitting the screen"), so it never stretches, squashes or
// needs scrolling on a laptop, a tablet either way up or a big screen. Phones keep the stacked,
// scrolling layout.
const { test } = require('@playwright/test');
const { useFakeFirebase, openController, startQuickSim, live, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const LANDSCAPE = [[1366, 768], [1440, 900], [1280, 800], [1024, 768], [1920, 1080], [844, 390]];
const PORTRAIT = [[768, 1024], [820, 1180]];

async function measure(page) {
  return page.evaluate(() => {
    const r = document.getElementById('zollDevice').getBoundingClientRect();
    const c = document.getElementById('ecgCanvas');
    const cr = c.getBoundingClientRect();
    return {
      left: r.left, top: r.top, right: r.right, bottom: r.bottom, ratio: r.width / r.height,
      scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight,
      // the trace is drawn for the size it shows at, so it stays sharp at any scale
      canvasW: c.width / (window.devicePixelRatio || 1), shownW: cr.width
    };
  });
}

async function linkedDefib(context, code, w, h, embedded) {
  const defib = await context.newPage();
  await defib.setViewportSize({ width: w, height: h });
  await defib.goto(`/defib/index.html?session=${code}${embedded ? '&embedded=1' : ''}`);
  await expect(defib.locator('#linkBanner')).toBeHidden();
  await defib.locator('.mode-label[data-mode="defib"]').click();
  return defib;
}

for (const embedded of [false, true]) {
  test(`${embedded ? 'in the room monitor' : 'on its own'}: the device keeps its shape and fits every screen`, async ({ page, context }) => {
    const code = await openController(page);
    await startQuickSim(page);
    await expect.poll(() => live(page, code, '/vitals')).toBeTruthy();
    for (const [sizes, shape] of [[LANDSCAPE, 'fit-land'], [PORTRAIT, 'fit-port']]) {
      let ratio = null;
      for (const [w, h] of sizes) {
        const defib = await linkedDefib(context, code, w, h, embedded);
        await expect(defib.locator('html')).toHaveClass(new RegExp(shape));
        const m = await measure(defib);
        const where = `${w}x${h}`;
        expect(m.left, where).toBeGreaterThanOrEqual(0);
        expect(m.top, where).toBeGreaterThanOrEqual(0);
        expect(m.right, where).toBeLessThanOrEqual(w + 0.5);
        expect(m.bottom, where).toBeLessThanOrEqual(h + 0.5);
        expect(m.scrollW, where).toBeLessThanOrEqual(w);
        expect(m.scrollH, where).toBeLessThanOrEqual(h);
        if (ratio === null) ratio = m.ratio;
        expect(Math.abs(m.ratio - ratio), `${where} shape`).toBeLessThan(0.01);
        expect(Math.abs(m.canvasW - m.shownW), `${where} trace`).toBeLessThan(2);
        // the controls a shock needs are on screen and work
        for (const sel of ['#chargeBtn', '#shockBtn', '#analyseBtn', '#syncBtn', '[data-energy-dir="1"]']) {
          await expect(defib.locator(sel), `${where} ${sel}`).toBeInViewport({ ratio: 0.99 });
        }
        await defib.locator('#chargeBtn').click();
        await expect(defib.locator('#shockBtn')).toBeEnabled({ timeout: 8000 });
        await defib.close();
      }
    }
  });
}

test('a turned tablet switches shape, and the device refits', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  await expect.poll(() => live(page, code, '/vitals')).toBeTruthy();
  const defib = await linkedDefib(context, code, 1024, 768, false);
  await expect(defib.locator('html')).toHaveClass(/fit-land/);
  await defib.setViewportSize({ width: 768, height: 1024 });
  await expect(defib.locator('html')).toHaveClass(/fit-port/);
  await expect.poll(async () => (await measure(defib)).bottom).toBeLessThanOrEqual(1024.5);
  const m = await measure(defib);
  expect(m.right).toBeLessThanOrEqual(768.5);
  expect(Math.abs(m.canvasW - m.shownW)).toBeLessThan(2);
});

test('a phone keeps the stacked layout and scrolls, unscaled', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  await expect.poll(() => live(page, code, '/vitals')).toBeTruthy();
  const defib = await linkedDefib(context, code, 390, 844, false);
  await expect(defib.locator('html')).not.toHaveClass(/fit-/);
  const m = await measure(defib);
  expect(m.right).toBeLessThanOrEqual(390);
  expect(m.scrollW).toBeLessThanOrEqual(390);
  expect(m.scrollH).toBeGreaterThan(844);
  expect(await defib.locator('#zollDevice').evaluate(el => getComputedStyle(el).transform)).toBe('none');
});

test('Education Defib Sim: the hint cards row sits under the device, and both fit a laptop screen', async ({ page, context }) => {
  const code = await openController(page);
  await page.getByRole('button', { name: 'Defib Sim', exact: true }).click();
  await page.getByRole('button', { name: /^Education/ }).click();
  await page.locator('[data-defib-scenario="vf-arrest"]').click();
  await page.getByRole('button', { name: 'Start Defib Sim' }).click();
  await expect.poll(() => live(page, code, '/rhythm')).toBe('VF');
  const defib = await linkedDefib(context, code, 1366, 768, false);
  await expect(defib.locator('#hintsRow')).toBeVisible();
  const hint = defib.locator('[data-hint="shockable"]');
  await expect(hint).toBeInViewport({ ratio: 1 });
  const m = await measure(defib);
  expect((await hint.boundingBox()).y).toBeGreaterThanOrEqual(m.bottom);
  expect(m.scrollH).toBeLessThanOrEqual(768);
  await hint.click();
  await expect(defib.locator('#hintOverlay')).toBeVisible();
});
