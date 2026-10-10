// Patient screens (data/simscreens.js): the start screen sets up one, two or three patient screens,
// on this computer or on separate devices, and each screen shows what its role says.
//   1 screen:  the monitor, switching to the defib or ventilator when they are brought in
//   2 screens: the monitor, and the defib and ventilator switching between them
//   3 screens: the monitor, the defib and the ventilator
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, session, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const shot = async (page, name) => { if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` }); };
const presence = async (page, code) => Object.values(await session(page, code, '/presence') || {});

test('first visit asks how many patient screens and where; two screens on separate devices get a QR code each', async ({ page }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  const card = page.getByTestId('setup-card');
  await expect(card.getByRole('heading', { name: 'How are you running the sim?' })).toBeVisible();
  await shot(page, 'setup-chooser');
  await card.getByTestId('setup-count-2').click();
  await expect(card.getByTestId('setup-screen-monitor')).toHaveCount(0);      // still needs "where"
  await card.getByTestId('setup-where-devices').click();

  await expect(card.getByRole('heading', { name: /2 patient screens, on separate devices/ })).toBeVisible();
  await expect(card.getByTestId('setup-qr-monitor').locator('svg')).toBeVisible();
  await expect(card.getByTestId('setup-qr-devices')).toHaveAttribute('title', new RegExp(`\\?mode=monitor&session=${code}&screen=devices$`));
  await expect(card.getByTestId('setup-qr-monitor')).toHaveAttribute('title', new RegExp(`\\?mode=monitor&session=${code}&screen=monitor$`));
  await shot(page, 'setup-two-devices');

  // Remembered on this device
  await page.reload();
  await expect(page.getByTestId('setup-card').getByTestId('setup-screen-devices')).toBeVisible();
  await expect(page.getByTestId('setup-card').getByRole('heading', { name: 'How are you running the sim?' })).toHaveCount(0);

  // Changing it stays open until Done
  await page.getByRole('button', { name: 'Change set-up' }).click();
  await card.getByTestId('setup-count-3').click();
  await expect(card.getByRole('heading', { name: 'How are you running the sim?' })).toBeVisible();
  await card.getByRole('button', { name: 'Done' }).click();
  await expect(card.getByTestId('setup-qr-vent')).toHaveAttribute('title', new RegExp(`vent/index\\.html\\?session=${code}$`));
  await expect(card.getByTestId('setup-qr-defib')).toHaveAttribute('title', new RegExp(`defib/index\\.html\\?session=${code}$`));
  expect(errors).toEqual([]);
});

test('screens plugged into this computer open in their own windows', async ({ page, context }) => {
  const code = await openController(page);
  const card = page.getByTestId('setup-card');
  await card.getByTestId('setup-count-3').click();
  await card.getByTestId('setup-where-here').click();
  await expect(card.getByText(/set the extra screens to/i)).toBeVisible();
  await shot(page, 'setup-three-here');
  const [win] = await Promise.all([context.waitForEvent('page'), card.getByRole('button', { name: /Open screen 3: ventilator/ }).click()]);
  await win.waitForLoadState();
  expect(win.url()).toMatch(new RegExp(`/vent/index\\.html\\?session=${code}$`));
  // a separate window, not a tab in this one
  expect(await win.evaluate(() => window.opener !== null || window.name)).toBeTruthy();
  expect(await win.evaluate(() => window.name)).toBe('emsim-screen-vent');
});

test('the earlier one computer, two screens choice carries over as one patient screen on this computer', async ({ page }) => {
  await page.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('wmebem_setup_mode', 'one'); sessionStorage.setItem('seeded', '1'); } } catch (e) {} });
  await openController(page);
  await expect(page.getByTestId('setup-card').getByRole('heading', { name: /1 patient screen, plugged into this computer/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Open patient screen/ })).toBeVisible();
});

test('a device joins as a patient screen and picks what it shows', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  const screen = await context.newPage();
  const errors = trackErrors(screen);
  await screen.goto('/index.html');
  await screen.getByTestId('setup-join').click();
  await expect(screen.getByRole('heading', { name: 'Patient screen' })).toBeVisible();
  await screen.getByLabel('Session code').fill(code);
  await screen.locator('[data-join-role="devices"]').click();
  await shot(screen, 'join-screen');
  await screen.getByRole('button', { name: 'Connect' }).click();
  await expect(screen.getByTestId('device-screen')).toBeVisible();
  expect(screen.url()).toMatch(new RegExp(`\\?mode=monitor&session=${code}&screen=devices$`));
  // A reload keeps the role
  await screen.reload();
  await expect(screen.getByTestId('device-screen')).toBeVisible();

  // A ventilator screen goes straight to the ventilator page
  const vent = await context.newPage();
  await vent.goto('/index.html');
  await vent.getByTestId('setup-join').click();
  await vent.getByLabel('Session code').fill(code);
  await vent.locator('[data-join-role="vent"]').click();
  await vent.getByRole('button', { name: 'Connect' }).click();
  await expect(vent).toHaveURL(new RegExp(`/vent/index\\.html\\?session=${code}$`));
  await expect(vent.locator('#linkBanner')).toBeHidden({ timeout: 10000 });
  expect(errors).toEqual([]);
});

test('two screens: the monitor stays the monitor, the other screen switches between the defib and the ventilator', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  const monitor = await context.newPage();
  const monitorErrors = trackErrors(monitor);
  await monitor.goto(`/index.html?mode=monitor&session=${code}&screen=monitor`);
  const devices = await context.newPage();
  const devicesErrors = trackErrors(devices);
  await devices.goto(`/index.html?mode=monitor&session=${code}&screen=devices`);
  await expect(devices.getByTestId('device-screen')).toBeVisible();

  // Both devices are ready on the second screen; the defib is in front to begin with
  await expect(devices.getByTestId('monitor-defib')).toBeVisible();
  await expect(devices.getByTestId('monitor-vent')).toBeHidden();
  await expect(devices.frameLocator('iframe[title="Defibrillator"]').locator('#linkBanner')).toBeHidden({ timeout: 10000 });
  await expect(devices.frameLocator('iframe[title="Ventilator"]').locator('#linkBanner')).toBeHidden({ timeout: 10000 });

  // The facilitator brings in the ventilator: it comes to the front there, and never on the monitor
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_VENT_PANEL', payload: true }));
  await expect(devices.getByTestId('monitor-vent')).toBeVisible();
  await expect(devices.getByTestId('monitor-defib')).toBeHidden();
  await expect(monitor.getByTestId('monitor-vent')).toHaveCount(0);
  await expect(monitor.getByTestId('screen-switcher')).toHaveCount(0);
  await shot(devices, 'devices-vent');

  // The candidate switches to the defib and back; the ventilator keeps running underneath
  const ventFrame = () => devices.frames().find(f => /vent\/index\.html/.test(f.url()));
  await ventFrame().evaluate(() => { document.getElementById('kPower').click(); });
  await devices.getByTestId('screen-switcher').getByRole('button', { name: 'Defib' }).click();
  await expect(devices.getByTestId('monitor-defib')).toBeVisible();
  await expect.poll(() => ventFrame().evaluate(() => window.__vent.ventStateNow().state), { timeout: 15000 }).toBe('standby');
  await devices.getByTestId('screen-switcher').getByRole('button', { name: 'Ventilator' }).click();
  await expect(devices.getByTestId('monitor-vent')).toBeVisible();

  // The defib brought in comes to the front
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_DEFIB_PANEL', payload: true }));
  await expect(devices.getByTestId('monitor-defib')).toBeVisible();
  await expect(monitor.getByTestId('monitor-defib')).toHaveCount(0);
  expect(await page.evaluate(() => window.__simEngine.state.ventPanelOpen)).toBe(true);   // both in the room at once

  // The controller counts two screens, not the device pages inside them
  await expect.poll(async () => (await presence(page, code)).map(p => p.role).sort()).toEqual(['devices', 'monitor', 'monitor-defib', 'monitor-vent']);
  await expect(page.getByTestId('connection-badge')).toContainText('2 screens linked');
  for (const e of [errors, monitorErrors, devicesErrors]) expect(e).toEqual([]);
});

test('one screen: the monitor switches between the obs, the defib and the ventilator, keeping both devices loaded', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  const monitor = await context.newPage();
  const monitorErrors = trackErrors(monitor);
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  await expect(monitor.getByTestId('screen-switcher')).toHaveCount(0);       // nothing brought in yet

  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_VENT_PANEL', payload: true }));
  await expect(monitor.getByTestId('monitor-vent')).toBeVisible();
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_DEFIB_PANEL', payload: true }));
  await expect(monitor.getByTestId('monitor-defib')).toBeVisible();
  await expect(monitor.getByTestId('monitor-vent')).toBeHidden();            // still loaded, behind
  const sw = monitor.getByTestId('screen-switcher');
  await expect(sw.getByRole('button')).toHaveText(['Monitor', 'Defib', 'Ventilator']);
  await shot(monitor, 'all-defib');

  await sw.getByRole('button', { name: 'Monitor' }).click();
  await expect(monitor.getByTestId('monitor-defib')).toBeHidden();
  await expect(monitor.getByTestId('monitor-vent')).toBeHidden();
  await expect(monitor.locator('iframe[title="Ventilator"]')).toHaveCount(1);
  await expect.poll(async () => (await presence(page, code)).filter(p => p.role === 'monitor').map(p => p.display)).toEqual(['patient monitor']);
  await shot(monitor, 'all-monitor');
  await sw.getByRole('button', { name: 'Ventilator' }).click();
  await expect(monitor.getByTestId('monitor-vent')).toBeVisible();
  await expect.poll(async () => (await presence(page, code)).filter(p => p.role === 'monitor').map(p => p.display)).toEqual(['ventilator']);
  await shot(monitor, 'all-vent');

  // Taking the ventilator away hands the screen back to the monitor
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_VENT_PANEL', payload: false }));
  await expect(monitor.getByTestId('monitor-vent')).toHaveCount(0);
  await expect(sw.getByRole('button')).toHaveText(['Monitor', 'Defib']);
  await expect(monitor.getByTestId('monitor-defib')).toBeHidden();
  await expect(page.getByTestId('connection-badge')).toContainText(/patient monitor/i);
  expect(monitorErrors).toEqual([]);
});

test('Defib Sim\'s Open defib opens the defib in its own window', async ({ page, context }) => {
  const code = await openController(page);
  await page.getByRole('button', { name: 'Defib Sim', exact: true }).click();
  await page.getByRole('button', { name: /^Start Defib Sim/ }).click();
  const [win] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: 'Open defib' }).click()]);
  await win.waitForLoadState();
  expect(win.url()).toMatch(new RegExp(`/defib/index\\.html\\?session=${code}$`));
  expect(await win.evaluate(() => window.name)).toBe('emsim-screen-defib');
});
