// The patient voice library: stock phrases recorded once per voice (scripts/make-voices.mjs) and played
// on the room monitor through the boosted sound output; anything without a clip uses the device's own
// voice. Clips are faked here (a short WAV served at the clip's URL) so the test does not depend on
// which recordings are in the repository.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, expect } = require('./helpers');

const ROOT = path.join(__dirname, '..', '..');
const load = (rel) => { const sb = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sb); return sb.window; };

test('the library is well formed and every listed clip is in the repository', () => {
  const { VOICE_LIBRARY: lib } = load('data/voices.js');
  const { VOICE_CLIPS: clips } = load('data/voice-clips.js');
  expect(lib.voices.length).toBeGreaterThan(0);
  const ids = lib.groups.flatMap(g => g.phrases.map(p => p.id));
  expect(new Set(ids).size).toBe(ids.length);
  for (const p of lib.groups.flatMap(g => g.phrases)) expect(p.text.length).toBeGreaterThan(0);
  for (const c of clips) expect(fs.existsSync(path.join(ROOT, 'voices', `${c}.mp3`)), c).toBe(true);
});

// 0.3 s of 440 Hz, 16-bit mono WAV.
const wav = () => {
  const rate = 8000, n = rate * 0.3, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / rate)), 44 + i * 2);
  return b;
};

const SPY = () => {
  window.__clips = []; window.__said = [];
  const AC = window.AudioContext || window.webkitAudioContext;
  const create = AC.prototype.createBufferSource;
  AC.prototype.createBufferSource = function () {
    const s = create.call(this); const start = s.start.bind(s);
    s.start = (...a) => { if (s.buffer && s.buffer.duration > 0.1) window.__clips.push(Math.round(s.buffer.duration * 10) / 10); return start(...a); };
    return s;
  };
  const speak = window.speechSynthesis.speak.bind(window.speechSynthesis);
  window.speechSynthesis.speak = (u) => { if (u.text.trim()) window.__said.push(u.text); try { speak(u); } catch (e) {} };
};

test('a stock phrase plays its recorded clip on the room monitor; one without a clip uses the built-in voice', async ({ page, context }) => {
  test.setTimeout(60000);
  await useFakeFirebase(context);
  await context.addInitScript(SPY);
  await context.route('**/data/voice-clips.js', r => r.fulfill({ contentType: 'text/javascript', body: 'window.VOICE_CLIPS = ["woman/yes"];' }));
  await context.route('**/voices/woman/yes.mp3', r => r.fulfill({ contentType: 'audio/mpeg', body: wav() }));
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  const monitor = await context.newPage();
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  await monitor.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Tap to Enable Sound/i.test(x.textContent)); if (b) b.click(); });

  await page.getByRole('button', { name: /^Patient voice/ }).click();
  await page.locator('#voicePick').selectOption('woman');
  await page.getByRole('button', { name: '"Yes."' }).click();
  await expect.poll(() => monitor.evaluate(() => window.__clips)).toEqual([0.3]);
  expect(await monitor.evaluate(() => window.__said)).toEqual([]);

  await page.getByRole('button', { name: '"No."' }).click();
  await expect.poll(() => monitor.evaluate(() => window.__said)).toEqual(['No.']);
  // Sounds (groans etc.) only show for a voice that has them recorded
  await expect(page.getByRole('button', { name: 'Groan' })).toHaveCount(0);
  // The controller stays quiet (sound plays on the monitor by default)
  expect(await page.evaluate(() => [window.__clips, window.__said])).toEqual([[], []]);
  expect(errors).toEqual([]);
});

test('"Match the patient" picks the voice from the patient\'s age and sex', async ({ page, context }) => {
  await useFakeFirebase(context);
  await openController(page);
  await startQuickSim(page);
  await page.getByRole('button', { name: /^Patient voice/ }).click();
  const { patientAge, sex } = await page.evaluate(() => window.__simEngine.state.scenario);
  const female = /^f/i.test(sex || '');
  const want = patientAge < 12 ? 'Child' : patientAge < 18 ? 'Teenager' : patientAge >= 70 ? (female ? 'Older woman' : 'Older man') : (female ? 'Woman' : 'Man');
  await expect(page.locator('#voicePick option[value="auto"]')).toHaveText(`Match the patient (${want})`);
});
