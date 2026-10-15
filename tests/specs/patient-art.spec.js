// The patient picture drawn from the generated artwork (images/patient/, data/screens/bodyart.js):
// the right body for the patient, limbs bent by fractures and missing below amputations, and every
// picture it uses actually loading.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const load = (page, change) => page.evaluate((change) => {
  const base = window.ALL_SCENARIOS.find(s => s.id === 'AM002');
  window.__simEngine.dispatch({ type: 'LOAD_SCENARIO', payload: Object.assign({}, base, { quickSim: false }, change) });
}, change);
const images = (page) => page.getByTestId('patient-figure').evaluate(svg => Array.from(svg.querySelectorAll('image')).map(i => i.getAttribute('href')));

test('the picture shows the right body, bends and amputations, and all its images load', async ({ page }) => {
  const errors = trackErrors(page);
  const bad = [];
  page.on('response', r => { if (/images\/patient\//.test(r.url()) && r.status() >= 400) bad.push(r.url()); });
  await openController(page);
  await startQuickSim(page);

  await load(page, { sex: 'Male', patientAge: 40, profile: 'A 40-year-old man. Right below knee amputation. Closed fracture of the left femur.' });
  await expect.poll(async () => (await images(page)).join(' ')).toMatch(/body\/male-torso\.webp/);
  let hrefs = await images(page);
  expect(hrefs).toContain('images/patient/body/trolley.webp');
  // Right leg: the thigh and knee pieces stay, the shin and foot below the amputation go
  expect(hrefs).toContain('images/patient/body/male-Rleg2.webp');
  expect(hrefs).not.toContain('images/patient/body/male-Rleg3.webp');
  expect(hrefs).toContain('images/patient/body/male-Lleg4.webp');
  // The left femur is bent at mid-thigh
  const bend = await page.getByTestId('patient-figure').evaluate(svg => {
    const img = svg.querySelector('image[href$="male-Lleg1.webp"]');
    return img && img.parentNode.getAttribute('transform');
  });
  expect(bend).toMatch(/^rotate\(-14 /);

  await load(page, { sex: 'Female', patientAge: 30, profile: 'She is 32 weeks pregnant.' });
  await expect.poll(async () => (await images(page)).join(' ')).toMatch(/pregnant-torso/);

  await load(page, { sex: 'Male', patientAge: 3, profile: 'A 3-year-old boy with a fever.' });
  await expect.poll(async () => (await images(page)).join(' ')).toMatch(/child-torso/);

  // Every picture the figure uses has loaded (none broken)
  await page.waitForTimeout(500);
  const broken = await page.getByTestId('patient-figure').evaluate(async svg => {
    const out = [];
    for (const i of svg.querySelectorAll('image')) {
      const ok = await new Promise(res => { const im = new Image(); im.onload = () => res(true); im.onerror = () => res(false); im.src = i.getAttribute('href'); });
      if (!ok) out.push(i.getAttribute('href'));
    }
    return out;
  });
  expect(broken).toEqual([]);
  expect(bad).toEqual([]);
  expect(errors).toEqual([]);
});

test('every kit and injury picture the code names exists', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForFunction(() => window.BodyArt);
  const missing = await page.evaluate(async () => {
    const names = Object.keys(window.BodyArt.KIT);
    const out = [];
    for (const n of names) { const r = await fetch(window.BodyArt.kitSrc(n)); if (!r.ok) out.push(n); }
    return out;
  });
  expect(missing).toEqual([]);
});
