// Defib tablet hover hints: every control says what it is (data-tip), shown in one bubble on
// mouse hover or keyboard focus, and taps on a touch screen are left alone.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, live, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

async function openDevice(context, code) {
  const defib = await context.newPage();
  const errors = trackErrors(defib);
  // Console errors too, except resources the tests deliberately keep off the network (fonts).
  defib.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await defib.goto(`/defib/index.html?session=${code}`);
  await expect(defib.locator('#linkBanner')).toBeHidden();
  return { defib, errors };
}

test.describe('Defib hover hints', () => {
  test('hovering a control shows what it is, and leaving or pressing hides it', async ({ page, context }) => {
    const code = await openController(page);
    await startQuickSim(page);
    await expect.poll(() => live(page, code, '/vitals')).toBeTruthy();
    const { defib, errors } = await openDevice(context, code);
    const bubble = defib.locator('.tip-bubble');
    await expect(bubble).toBeHidden();

    for (const [sel, text] of [
      ['#chargeBtn', /Charges to the selected energy/],
      ['[data-energy-dir="1"]', /Raises the energy by one step/],
      ['.mode-label[data-mode="pacer"]', /Pacing mode/],
      ['#syncBtn', /synchronised mode/],
      ['#shockBtn', /Delivers the shock/]            // disabled until charged, still explained
    ]) {
      await defib.hover(sel);
      await expect(bubble).toBeVisible();
      await expect(bubble).toHaveText(text);
    }
    // Inside the viewport, and never catches a press
    const box = await bubble.boundingBox();
    const vp = defib.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    expect(await bubble.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');

    // A press hides it, and the press still works
    await defib.hover('.mode-label[data-mode="defib"]');
    await expect(bubble).toHaveText(/Manual defibrillation mode/);
    await defib.mouse.down(); await defib.mouse.up();
    await expect(bubble).toBeHidden();
    await expect(defib.locator('#modeInfo')).toHaveText('MODE: DEFIB');

    // Displays explain themselves too; moving off everything hides the bubble; Escape hides it
    await defib.hover('#hrDisplay');
    await expect(bubble).toHaveText(/Heart rate/);
    await defib.mouse.move(2, 2);
    await expect(bubble).toBeHidden();
    await defib.hover('#ecgCanvas');
    await expect(bubble).toHaveText(/ECG trace/);
    await defib.keyboard.press('Escape');
    await expect(bubble).toBeHidden();

    // Keyboard focus shows it as well
    await defib.locator('#leadBtn').focus();
    await defib.keyboard.press('Tab');
    await expect(bubble).toBeVisible();
    await expect(bubble).toHaveText(await defib.evaluate(() => document.activeElement.closest('[data-tip]').dataset.tip));
    expect(errors).toEqual([]);
  });

  test('every button on the device has a hint, for screen readers too, and no native title', async ({ page, context }) => {
    const code = await openController(page);
    await startQuickSim(page);
    const { defib, errors } = await openDevice(context, code);
    const missing = await defib.evaluate(() => [...document.querySelectorAll('#zollDevice button, #hintsRow button, #zollDevice input')]
      .filter(b => !(b.dataset.tip || '').trim() || b.getAttribute('aria-description') !== b.dataset.tip)
      .map(b => b.id || b.className + ':' + b.textContent.trim()));
    expect(missing).toEqual([]);
    expect(await defib.locator('[data-tip][title]').count()).toBe(0);
    // A re-labelled button keeps its hint
    await defib.click('.mode-label[data-mode="pacer"]');
    await defib.click('#pacerModeBtn');
    await expect(defib.locator('#pacerModeBtn')).toHaveText('MODE: ASYNC');
    await defib.mouse.move(2, 2);                                      // a press hides it until the pointer comes back
    await defib.hover('#pacerModeBtn');
    await expect(defib.locator('.tip-bubble')).toHaveText(/demand pacing and asynchronous/);
    expect(errors).toEqual([]);
  });
});

test.describe('Defib hover hints on touch', () => {
  test.use({ hasTouch: true });
  test('a tap presses the control and shows no bubble', async ({ page, context }) => {
    const code = await openController(page);
    await startQuickSim(page);
    const { defib, errors } = await openDevice(context, code);
    await defib.tap('.mode-label[data-mode="monitor"]');
    await expect(defib.locator('#modeInfo')).toHaveText('MODE: MONITOR');
    await defib.waitForTimeout(700);
    await expect(defib.locator('.tip-bubble')).toBeHidden();
    expect(errors).toEqual([]);
  });
});
