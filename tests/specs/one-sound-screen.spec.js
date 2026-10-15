// Several patient screens on one session (one computer opens a window per screen) each run their own
// clock. If more than one beeped the pulse, the room heard two trains of beeps drifting in and out of
// step (Jake, 15 Oct 2026). Only one screen showing the monitor makes the monitor's sounds; a screen
// showing only the defib and ventilator makes none of them.
const { test } = require('@playwright/test');
const { useFakeFirebase, openController, startQuickSim, pressStart, expect } = require('./helpers');

const SPY = () => {
  window.__beeps = 0;
  const AC = window.AudioContext;
  const create = AC.prototype.createOscillator;
  AC.prototype.createOscillator = function () {
    const o = create.call(this);
    const start = o.start.bind(o);
    // The pulse tone is a sine between 120 and 900 Hz lasting 0.2 s
    o.start = (...a) => { if (o.type === 'sine') window.__beeps++; return start(...a); };
    return o;
  };
};

test('two monitor windows and a devices window: exactly one of them beeps the pulse', async ({ page, context }) => {
  test.setTimeout(90000);
  await useFakeFirebase(context);
  await context.addInitScript(SPY);
  const code = await openController(page);
  await startQuickSim(page);
  await page.evaluate(() => window.__simEngine.attachStandardMonitoring());
  await pressStart(page);

  const open = async (extra = '') => {
    const p = await context.newPage();
    await p.goto(`/index.html?mode=monitor&session=${code}${extra}`);
    await expect.poll(() => p.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
    await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Tap to Enable Sound/i.test(x.textContent)); if (b) b.click(); });
    return p;
  };
  const screens = [await open(), await open(), await open('&screen=devices')];
  // Every screen is in the presence list before counting
  await expect.poll(() => page.evaluate(([c]) => Object.values(window.__fakeRtdb.get(`sessions/${c}/presence`) || {}).filter(v => /^screen:/.test(v.role)).length, [code])).toBe(3);
  await screens[0].waitForTimeout(1500);
  for (const s of screens) await s.evaluate(() => { window.__beeps = 0; });
  await screens[0].waitForTimeout(5000);
  const counts = [];
  for (const s of screens) counts.push(await s.evaluate(() => window.__beeps));
  // HR 75 for 5 s is about 6 beats
  const monitors = counts.slice(0, 2).sort((a, b) => a - b);
  expect(monitors[0], `beeps per screen: ${counts}`).toBe(0);
  expect(monitors[1], `beeps per screen: ${counts}`).toBeGreaterThanOrEqual(4);
  expect(counts[2], `beeps per screen: ${counts}`).toBe(0);

  // The beeping window closes: the other monitor takes over
  const loud = counts[0] > 0 ? 0 : 1;
  await screens[loud].close();
  const other = screens[1 - loud];
  await expect.poll(() => page.evaluate(([c]) => Object.values(window.__fakeRtdb.get(`sessions/${c}/presence`) || {}).filter(v => /^screen:/.test(v.role)).length, [code])).toBe(2);
  await other.waitForTimeout(1500);
  await other.evaluate(() => { window.__beeps = 0; });
  await other.waitForTimeout(4000);
  expect(await other.evaluate(() => window.__beeps)).toBeGreaterThanOrEqual(3);
});
