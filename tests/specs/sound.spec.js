// Sound: which device makes which noise. A spy records every oscillator started (its type and the
// first frequency it was given) and every utterance spoken, so the tests can tell a charge tone
// (sine from 400 Hz), a shock (sawtooth from 100 Hz) and the NIBP cuff pump (sawtooth from 60 Hz)
// apart from the pulse beeps. These prove the sounds are produced on the right device; they cannot
// prove a real speaker is audible.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, expect } = require('./helpers');

const SPY = () => {
  window.__sounds = [];
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) {
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
  if (window.speechSynthesis) {
    const speak = window.speechSynthesis.speak.bind(window.speechSynthesis);
    window.speechSynthesis.speak = (u) => { if (u.text.trim()) window.__sounds.push({ type: 'speech', text: u.text }); try { speak(u); } catch (e) {} };
  }
};

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); await context.addInitScript(SPY); });

const heard = (page, type, f0) => page.evaluate(([type, f0]) => window.__sounds.filter(s => s.type === type && (f0 === null || s.f0 === f0)).length, [type, f0 === undefined ? null : f0]);
const spoken = (page) => page.evaluate(() => window.__sounds.filter(s => s.type === 'speech').map(s => s.text));

async function quickSimWithMonitor(page, context) {
  const code = await openController(page);
  await startQuickSim(page);
  const monitor = await context.newPage();
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  await monitor.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Tap to Enable Sound/i.test(x.textContent)); if (b) b.click(); });
  return { code, monitor };
}

test('Quick Sim (clock not started): charge, shock and the patient\'s voice play on the room monitor', async ({ page, context }) => {
  test.setTimeout(60000);
  const errors = trackErrors(page);
  const { monitor } = await quickSimWithMonitor(page, context);
  expect(await page.evaluate(() => window.__simEngine.state.isRunning)).toBe(false);
  await page.evaluate(() => { window.__simEngine.playSound('charge'); });
  await expect.poll(() => heard(monitor, 'sine', 400)).toBe(1);
  await page.evaluate(() => { window.__simEngine.playSound('shock'); });
  await expect.poll(() => heard(monitor, 'sawtooth', 100)).toBe(1);
  await page.evaluate(() => window.__simEngine.speak('My chest hurts'));
  await expect.poll(() => spoken(monitor)).toEqual(['My chest hurts']);
  // Sound plays on the monitor by default, so the controller stays quiet
  expect(await heard(page, 'sine', 400)).toBe(0);
  expect(await spoken(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('the NIBP cuff noise comes from the device set in "Sound plays on"', async ({ page, context }) => {
  test.setTimeout(60000);
  const { monitor } = await quickSimWithMonitor(page, context);
  await page.evaluate(() => window.__simEngine.attachStandardMonitoring());
  await page.evaluate(() => window.__simEngine.triggerNIBP());
  await expect.poll(() => heard(monitor, 'sawtooth', 60)).toBe(1);
  expect(await heard(page, 'sawtooth', 60)).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.nibp.inflating), { timeout: 10000 }).toBe(false);

  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_AUDIO_OUTPUT', payload: 'controller' }));
  await expect.poll(() => monitor.evaluate(() => window.__monitorEngine.state.audioOutput)).toBe('controller');
  await page.evaluate(() => window.__simEngine.triggerNIBP());
  await expect.poll(() => heard(page, 'sawtooth', 60)).toBe(1);
  await monitor.waitForTimeout(1000);
  expect(await heard(monitor, 'sawtooth', 60)).toBe(1);          // still just the first one
});

test('a monitor that joins later does not replay an old sound', async ({ page, context }) => {
  test.setTimeout(60000);
  const code = await openController(page);
  await startQuickSim(page);
  await page.evaluate(() => { window.__simEngine.playSound('charge'); window.__simEngine.speak('Hello'); });
  await page.waitForTimeout(9000);
  const monitor = await context.newPage();
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  await monitor.waitForTimeout(1500);
  expect(await heard(monitor, 'sine', 400)).toBe(0);
  expect(await spoken(monitor)).toEqual([]);
  // ...but the next one plays
  await page.evaluate(() => window.__simEngine.playSound('charge'));
  await expect.poll(() => heard(monitor, 'sine', 400)).toBe(1);
});

test('defib tablet: charge, shock, metronome and the cuff pump sound on the tablet', async ({ page, context }) => {
  test.setTimeout(60000);
  const errors = trackErrors(page);
  const code = await openController(page);
  await page.getByRole('button', { name: 'Defib Sim', exact: true }).click();
  await page.locator('[data-defib-scenario="unstable-svt"]').click();
  await page.getByRole('button', { name: 'Start Defib Sim' }).click();
  const defib = await context.newPage();
  const defibErrors = trackErrors(defib);
  await defib.goto(`/defib/index.html?session=${code}`);
  await expect(defib.locator('#linkBanner')).toBeHidden();
  await defib.evaluate(() => { const b = document.getElementById('soundBtn'); if (b) b.click(); });
  await defib.click('.mode-label[data-mode="defib"]');

  await defib.locator('#chargeBtn').click();
  await expect.poll(() => heard(defib, 'sine', 400)).toBeGreaterThanOrEqual(1);       // charging
  await expect.poll(() => heard(defib, 'sine', 1000), { timeout: 10000 }).toBeGreaterThanOrEqual(1); // charged
  await defib.locator('#shockBtn').click();
  await expect.poll(() => heard(defib, 'sine', 800)).toBeGreaterThanOrEqual(1);       // shock

  await defib.locator('#nibpBtn').click();
  await expect.poll(() => heard(defib, 'sawtooth', 60)).toBe(1);

  await page.evaluate(() => window.__simEngine.setMetronome(true));
  await expect.poll(() => heard(defib, 'square', 1000), { timeout: 5000 }).toBeGreaterThan(2);
  expect(errors).toEqual([]);
  expect(defibErrors).toEqual([]);
});
