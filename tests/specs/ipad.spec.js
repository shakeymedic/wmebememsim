// iPad checks in Safari's engine (WebKit), run by the ipad-landscape and ipad-portrait projects only.
// Nobody on the team has an iPad to hand, but courses run the sim on them, so these catch the
// Safari-only breakages early: script errors, pages wider than the screen, the defib not fitting, and
// sound not starting after the first tap. They cannot prove a real iPad speaker is audible or that
// Google sign-in works on a real iPad. Screenshots of each screen are attached to the test report.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, pressStart, live, expect } = require('./helpers');

// Record every audio context and every oscillator started, as sound.spec.js does
const AUDIO_SPY = () => {
  window.__sounds = [];
  window.__audioContexts = [];
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const AC = window[name];
    if (!AC) continue;
    const Spied = class extends AC { constructor(...a) { super(...a); window.__audioContexts.push(this); } };
    window[name] = Spied;
    const create = AC.prototype.createOscillator;
    AC.prototype.createOscillator = function () {
      const o = create.call(this);
      const set = o.frequency.setValueAtTime.bind(o.frequency);
      o.frequency.setValueAtTime = (v, t) => { if (o.__f0 === undefined) o.__f0 = v; return set(v, t); };
      const start = o.start.bind(o);
      o.start = (...a) => { window.__sounds.push({ type: o.type, f0: Math.round(o.__f0 !== undefined ? o.__f0 : o.frequency.value) }); return start(...a); };
      return o;
    };
  }
};

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); await context.addInitScript(AUDIO_SPY); });

const snap = async (page, testInfo, name) => testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' });

// Nothing on the page reaches past the right-hand edge of the screen
const overflow = (page) => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
async function expectNoSidewaysScroll(page, where) {
  const o = await overflow(page);
  expect(o.scroll, `${where}: page is ${o.scroll}px wide on a ${o.width}px screen`).toBeLessThanOrEqual(o.width + 1);
}

async function joinMonitor(context, code) {
  const monitor = await context.newPage();
  const errors = trackErrors(monitor);
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  return { monitor, errors };
}

test('controller: start screen and a running Quick Sim load with no script errors and fit the screen', async ({ page }, testInfo) => {
  const errors = trackErrors(page);
  await openController(page);
  await expectNoSidewaysScroll(page, 'start screen');
  await snap(page, testInfo, 'controller-start');
  await startQuickSim(page);
  await pressStart(page);
  await expect(page.getByRole('button', { name: 'PAUSE', exact: true })).toBeInViewport();
  await expectNoSidewaysScroll(page, 'Quick Sim');
  await snap(page, testInfo, 'controller-quick-sim');
  expect(errors).toEqual([]);
});

test('room monitor: the first tap starts sound, and a charge from the controller plays on it', async ({ page, context }, testInfo) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  const { monitor, errors: monitorErrors } = await joinMonitor(context, code);
  await expectNoSidewaysScroll(monitor, 'monitor');
  await snap(monitor, testInfo, 'monitor-before-tap');
  // A headless browser may allow sound without a gesture, in which case the button never shows
  const unlock = monitor.getByTestId('enable-sound');
  if (await unlock.isVisible()) {
    await unlock.tap();
    await expect(unlock).toBeHidden();
  }
  await expect.poll(() => monitor.evaluate(() => window.__audioContexts.some(c => c.state === 'running'))).toBe(true);
  await page.evaluate(() => { window.__simEngine.playSound('charge'); });
  await expect.poll(() => monitor.evaluate(() => window.__sounds.filter(s => s.type === 'sine' && s.f0 === 400).length)).toBe(1);
  await snap(monitor, testInfo, 'monitor-running');
  expect(errors).toEqual([]);
  expect(monitorErrors).toEqual([]);
});

test('defib: the whole device fits the iPad screen without scrolling', async ({ page, context }, testInfo) => {
  const code = await openController(page);
  await startQuickSim(page);
  await expect.poll(() => live(page, code, '/vitals')).toBeTruthy();
  const defib = await context.newPage();
  const errors = trackErrors(defib);
  await defib.goto(`/defib/index.html?session=${code}`);
  await expect(defib.locator('#linkBanner')).toBeHidden();
  await defib.locator('.mode-label[data-mode="defib"]').click();
  const box = await defib.evaluate(() => {
    const r = document.getElementById('zollDevice').getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: window.innerWidth, h: window.innerHeight, scrollH: document.documentElement.scrollHeight };
  });
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(box.w + 0.5);
  expect(box.bottom).toBeLessThanOrEqual(box.h + 0.5);
  expect(box.scrollH).toBeLessThanOrEqual(box.h + 1);
  await snap(defib, testInfo, 'defib');
  expect(errors).toEqual([]);
});

test('ventilator: loads with no script errors and fits the screen', async ({ page, context }, testInfo) => {
  const code = await openController(page);
  await startQuickSim(page);
  await expect.poll(() => live(page, code, '/vitals')).toBeTruthy();
  const vent = await context.newPage();
  const errors = trackErrors(vent);
  await vent.goto(`/vent/index.html?session=${code}`);
  await vent.waitForLoadState('load');
  await vent.waitForTimeout(1500);
  await expectNoSidewaysScroll(vent, 'ventilator');
  await snap(vent, testInfo, 'ventilator');
  expect(errors).toEqual([]);
});
