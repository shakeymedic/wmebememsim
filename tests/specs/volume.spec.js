// Patient-screen volume, set on the controller and carried to the screens inside live.defib.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, expect } = require('./helpers');

const SPY = () => {
  window.__gains = []; window.__said = [];
  const AC = window.AudioContext || window.webkitAudioContext;
  const create = AC.prototype.createGain;
  AC.prototype.createGain = function () { const g = create.call(this); window.__gains.push(g); return g; };
  const speak = window.speechSynthesis.speak.bind(window.speechSynthesis);
  window.speechSynthesis.speak = (u) => { if (u.text.trim()) window.__said.push({ text: u.text, volume: u.volume }); try { speak(u); } catch (e) {} };
};

test('the controller sets the volume on the room monitor: sounds, voice and mute', async ({ page, context }) => {
  test.setTimeout(60000);
  await useFakeFirebase(context);
  await context.addInitScript(SPY);
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  const monitor = await context.newPage();
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  await monitor.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Tap to Enable Sound/i.test(x.textContent)); if (b) b.click(); });

  await page.getByRole('button', { name: /^Patient screen volume 100%/ }).click();
  await page.locator('#volumeSlider').fill('50');
  await expect.poll(() => monitor.evaluate(() => window.__monitorEngine.state.defib.volume)).toBe(0.5);
  // The test tone builds the output stage; its volume node follows the controller.
  await page.getByRole('button', { name: 'Test sound' }).click();
  await expect.poll(() => monitor.evaluate(() => window.__gains.some(g => Math.abs(g.gain.value - 0.5) < 0.01 && g.numberOfOutputs === 1 && g.context.__simVol === g))).toBe(true);
  await page.evaluate(() => window.__simEngine.speak('Hello'));
  await expect.poll(() => monitor.evaluate(() => window.__said)).toEqual([{ text: 'Hello', volume: 0.5 }]);

  await page.locator('#volumeSlider').fill('150');
  await expect.poll(() => monitor.evaluate(() => window.__monitorEngine.state.defib.volume)).toBe(1.5);
  await page.getByRole('button', { name: 'Mute all' }).click();
  await expect.poll(() => monitor.evaluate(() => window.__monitorEngine.state.defib.volume)).toBe(0);
  await page.evaluate(() => window.__simEngine.speak('Quiet'));
  await monitor.waitForTimeout(1000);
  expect((await monitor.evaluate(() => window.__said)).map(s => s.text)).toEqual(['Hello']);
  await page.getByRole('button', { name: 'Unmute' }).click();
  await expect.poll(() => monitor.evaluate(() => window.__monitorEngine.state.defib.volume)).toBe(1.5);
  expect(errors).toEqual([]);
});

test('the defib tablet and the ventilator follow the controller\'s volume', async ({ page, context }) => {
  test.setTimeout(60000);
  await useFakeFirebase(context);
  await context.addInitScript(SPY);
  const code = await openController(page);
  await page.getByRole('button', { name: 'Defib Sim', exact: true }).click();
  await page.locator('[data-defib-scenario="unstable-svt"]').click();
  await page.getByRole('button', { name: 'Start Defib Sim' }).click();
  const defib = await context.newPage();
  await defib.goto(`/defib/index.html?session=${code}`);
  await expect(defib.locator('#linkBanner')).toBeHidden();
  const vent = await context.newPage();
  await vent.goto(`/vent/index.html?session=${code}`);
  await expect.poll(() => vent.evaluate(() => LIVE.linked)).toBe(true);

  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_VOLUME', payload: 0.3 }));
  await expect.poll(() => vent.evaluate(() => LIVE.volume)).toBe(0.3);
  await defib.evaluate(() => { const b = document.getElementById('soundBtn'); if (b) b.click(); });
  await defib.click('.mode-label[data-mode="defib"]');
  await defib.locator('#chargeBtn').click();
  await expect.poll(() => defib.evaluate(() => window.__gains.some(g => g.context.__simVol === g && Math.abs(g.gain.value - 0.3) < 0.01))).toBe(true);
});
