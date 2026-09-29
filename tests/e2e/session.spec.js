// The real Firebase SDK, the real database rules (in the emulator), and the real app.
const { test, expect } = require('@playwright/test');

const EMU = 'emulator=127.0.0.1:9000';
const errorsOf = (page) => { const e = []; page.on('pageerror', x => e.push(x.message)); page.on('dialog', d => d.accept().catch(() => {})); return e; };
const read = (page, path) => page.evaluate(p => window.db.ref(p).once('value').then(s => s.val()), path);

test('controller, room monitor and defib tablet share a live session through the real SDK and rules', async ({ page, context }) => {
  const errors = errorsOf(page);
  await page.goto(`/index.html?${EMU}`);
  await expect(page.getByText('Session Code', { exact: true })).toBeVisible();
  const code = await page.evaluate(() => localStorage.getItem('wmebem_session_id'));

  // Start a Defib Sim VF arrest; the patient is published under sessions/<CODE>/live
  await page.getByRole('button', { name: 'Defib Sim', exact: true }).click();
  await page.locator('[data-defib-scenario="vf-arrest"]').click();
  await page.getByRole('button', { name: 'Start Defib Sim' }).click();
  await expect.poll(() => read(page, `sessions/${code}/live/rhythm`), { timeout: 15000 }).toBe('VF');
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.syncStatus.state)).toBe('connected');

  // The room monitor receives it
  const monitor = await context.newPage();
  const monitorErrors = errorsOf(monitor);
  await monitor.goto(`/index.html?mode=monitor&session=${code}&${EMU}`);
  await expect.poll(() => monitor.evaluate(() => window.__monitorEngine && window.__monitorEngine.state.rhythm), { timeout: 15000 }).toBe('VF');
  await expect.poll(async () => Object.values(await read(page, `sessions/${code}/presence`) || {}).map(p => p.role)).toContain('monitor');

  // The defib tablet links, and its shock reaches the controller
  const defib = await context.newPage();
  const defibErrors = errorsOf(defib);
  await defib.goto(`/defib/index.html?session=${code}&${EMU}`);
  await expect(defib.locator('#linkBanner')).toBeHidden({ timeout: 15000 });
  await defib.click('.mode-label[data-mode="defib"]');
  await defib.click('#chargeBtn');
  await expect(defib.locator('#shockBtn')).toBeEnabled({ timeout: 5000 });
  await defib.click('#shockBtn');
  await expect.poll(() => page.evaluate(() => window.__simEngine.state.defib.shockCount), { timeout: 15000 }).toBe(1);
  await expect.poll(async () => Object.values(await read(page, `sessions/${code}/deviceState`) || {}).map(d => d.mode)).toContain('defib');

  // The rules are live: a field the app never writes is refused
  const refused = await page.evaluate(c => window.db.ref(`sessions/${c}/junk`).set(1).then(() => 'accepted', e => String(e && (e.code || e.message))), code);
  expect(refused).toMatch(/PERMISSION_DENIED|permission_denied/i);

  expect(errors).toEqual([]);
  expect(monitorErrors).toEqual([]);
  expect(defibErrors).toEqual([]);
});
