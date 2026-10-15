// Patient screens (data/simscreens.js, data/screens/screenspanel.js): a screen joins with the session
// code alone and the controller numbers it. The controller's Screens panel shows every screen's number
// on the screen itself (like Windows' Identify) and chooses what each one shows (monitor, defib,
// ventilator, or a mix), at any time.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, session, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const shot = async (page, name) => { if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png` }); };
const presence = async (page, code) => Object.values(await session(page, code, '/presence') || {});
const assigned = async (page, code) => Object.values(await session(page, code, '/screens') || {}).map(s => `${s.n}:${s.role}`).sort();
const openScreens = async (page) => { await page.getByRole('button', { name: /^Screens/ }).click(); await expect(page.getByTestId('screens-panel')).toBeVisible(); };
const row = (page, n) => page.getByTestId(`screen-row-${n}`);
const part = (page, n, p) => row(page, n).locator(`[data-part="${p}"]`);
const joinAsScreen = async (context, code) => {
  const screen = await context.newPage();
  const errors = trackErrors(screen);
  await screen.goto(`/index.html?mode=monitor&session=${code}`);
  return { screen, errors };
};

test('a device joins as a patient screen with the code alone; the controller numbers it and it shows everything', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await page.getByTestId('setup-toggle').click();                           // the panel open: screens show their numbers
  await expect(page.getByTestId('screens-empty')).toBeVisible();
  const screen = await context.newPage();
  const screenErrors = trackErrors(screen);
  await screen.goto('/index.html');
  await screen.getByTestId('welcome-screen').click();
  await expect(screen.getByRole('heading', { name: 'Patient screen' })).toBeVisible();
  await expect(screen.locator('[data-join-role]')).toHaveCount(0);           // no role to pick on the screen
  await screen.getByLabel(/session code/i).fill(code);
  await shot(screen, 'join-screen');
  await screen.getByRole('button', { name: 'Connect' }).click();
  expect(screen.url()).toMatch(new RegExp(`\\?mode=monitor&session=${code}$`));

  // Numbered by the controller, before any scenario has started
  await expect(screen.getByTestId('screen-number')).toContainText('Screen 1');
  await expect(screen.getByTestId('screen-number')).toContainText('Everything');
  await expect(page.getByTestId('setup-summary')).toContainText('1 patient screen connected. 1: Everything');
  await shot(screen, 'joined-numbered');

  // The start screen's panel lists it
  await expect(row(page, 1)).toContainText('Screen 1');
  await expect(part(page, 1, 'monitor')).toHaveAttribute('aria-pressed', 'true');
  await expect(part(page, 1, 'defib')).toHaveAttribute('aria-pressed', 'true');
  await expect(part(page, 1, 'vent')).toHaveAttribute('aria-pressed', 'true');
  await shot(page, 'setup-panel-one-screen');
  expect(errors).toEqual([]);
  expect(screenErrors).toEqual([]);
});

test('while the Screens panel is open every screen shows its big number; closing it hides them', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  const a = await joinAsScreen(context, code);
  const b = await joinAsScreen(context, code);
  await expect.poll(() => assigned(page, code)).toEqual(['1:all', '2:all']);
  await expect.poll(() => a.screen.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  // The number comes up briefly by itself when the screen is numbered, then goes
  await expect(a.screen.getByTestId('screen-number')).toBeHidden({ timeout: 8000 });
  await expect(b.screen.getByTestId('screen-number')).toBeHidden({ timeout: 8000 });

  await openScreens(page);
  await expect(a.screen.getByTestId('screen-number')).toContainText('1');
  await expect(b.screen.getByTestId('screen-number')).toContainText('2');
  await shot(a.screen, 'identify-screen-1');
  await shot(page, 'live-screens-panel');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(a.screen.getByTestId('screen-number')).toBeHidden();
  await expect(b.screen.getByTestId('screen-number')).toBeHidden();
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

test('two screens: a quick set-up makes one the monitor and the other the defib and ventilator, and it can be changed live', async ({ page, context }) => {
  const errors = trackErrors(page);
  const code = await openController(page);
  await startQuickSim(page);
  const one = await joinAsScreen(context, code);
  const two = await joinAsScreen(context, code);
  await expect.poll(() => assigned(page, code)).toEqual(['1:all', '2:all']);

  await openScreens(page);
  await page.locator('[data-preset="split2"]').click();
  await expect.poll(() => assigned(page, code)).toEqual(['1:monitor', '2:devices']);
  await expect(page.locator('[data-preset="split2"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(two.screen.getByTestId('device-screen')).toBeVisible();
  await expect(two.screen.getByTestId('monitor-defib')).toBeVisible();
  await expect(page.getByTestId('screens-coverage')).toContainText('Monitor: screen 1');
  await expect(page.getByTestId('screens-coverage')).toContainText('Defib: screen 2');
  await expect(page.getByTestId('screens-coverage')).toContainText('Ventilator: screen 2');
  await shot(page, 'panel-two-screens');
  await page.getByRole('button', { name: 'Done' }).click();

  // The ventilator brought in comes to the front on screen 2, never on the monitor
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_VENT_PANEL', payload: true }));
  await expect(two.screen.getByTestId('monitor-vent')).toBeVisible();
  await expect(one.screen.getByTestId('monitor-vent')).toHaveCount(0);
  await expect(one.screen.getByTestId('screen-switcher')).toHaveCount(0);

  // Change of plan mid-scenario: screen 1 also gets the ventilator, screen 2 becomes the defib only
  await openScreens(page);
  await part(page, 1, 'vent').click();
  await part(page, 2, 'vent').click();
  await expect.poll(() => assigned(page, code)).toEqual(['1:monvent', '2:defib']);
  await expect(one.screen.getByTestId('monitor-vent')).toBeAttached();
  await expect(one.screen.getByTestId('screen-switcher').getByRole('button')).toHaveText(['Monitor', 'Ventilator']);
  await expect(two.screen.getByTestId('monitor-vent')).toHaveCount(0);
  await expect(two.screen.getByTestId('monitor-defib')).toBeVisible();
  await expect(two.screen.getByTestId('screen-switcher')).toHaveCount(0);   // one device: nothing to switch
  // The screen that changed says so with its number
  await expect(one.screen.getByTestId('screen-number')).toContainText('Monitor + ventilator');

  // A screen always shows something: its last part cannot be turned off
  await expect(part(page, 2, 'defib')).toBeDisabled();
  await page.getByRole('button', { name: 'Done' }).click();

  // The controller counts two screens, not the device pages inside them
  await expect.poll(async () => (await presence(page, code)).map(p => p.role).filter(r => /^screen:/.test(r)).sort()).toEqual(['screen:defib', 'screen:monvent']);
  await expect(page.getByTestId('connection-badge')).toContainText('2 screens linked');
  for (const e of [errors, one.errors, two.errors]) expect(e).toEqual([]);
});

test('a device brought in that no screen shows is flagged on the controller', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  await joinAsScreen(context, code);
  await expect.poll(() => assigned(page, code)).toEqual(['1:all']);
  await openScreens(page);
  await part(page, 1, 'vent').click();
  await part(page, 1, 'defib').click();
  await expect.poll(() => assigned(page, code)).toEqual(['1:monitor']);
  await expect(page.getByTestId('screens-coverage')).toContainText('Ventilator: on no screen');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('screens-warning')).toHaveCount(0);
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_VENT_PANEL', payload: true }));
  await expect(page.getByTestId('screens-warning')).toContainText(/ventilator on no screen/i);
  await page.getByTestId('screens-warning').click();
  await expect(page.getByTestId('screens-panel')).toBeVisible();
});

test('a reload keeps the screen\'s number and what it shows; a duplicated tab becomes a new screen', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  const { screen } = await joinAsScreen(context, code);
  await expect.poll(() => assigned(page, code)).toEqual(['1:all']);
  await openScreens(page);
  await part(page, 1, 'monitor').click();
  await expect.poll(() => assigned(page, code)).toEqual(['1:devices']);
  await expect(screen.getByTestId('device-screen')).toBeVisible();
  await screen.reload();
  await expect(screen.getByTestId('device-screen')).toBeVisible();
  await expect(screen.getByTestId('screen-number')).toContainText('1');          // panel still open
  expect(await assigned(page, code)).toEqual(['1:devices']);

  // A duplicated tab carries the same id in sessionStorage: it takes a new one
  const id = await screen.evaluate(() => sessionStorage.getItem('wmebem_screen_id'));
  const dup = await context.newPage();
  await dup.addInitScript((v) => { try { sessionStorage.setItem('wmebem_screen_id', v); } catch (e) {} }, id);
  await dup.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => assigned(page, code)).toEqual(['1:devices', '2:all']);
  await expect(dup.getByTestId('screen-number')).toContainText('2');
  expect(await dup.evaluate(() => sessionStorage.getItem('wmebem_screen_id'))).not.toBe(id);

  // The controller reloading keeps every number and choice
  await page.reload();
  await expect(page.getByTestId('setup-summary')).toContainText('2 patient screens connected. 1: Defib + ventilator · 2: Everything');
  await page.waitForTimeout(1000);
  expect(await assigned(page, code)).toEqual(['1:devices', '2:all']);
});

test('an older link with ?screen= starts the screen as that, and the controller can still change it', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  const screen = await context.newPage();
  await screen.goto(`/index.html?mode=monitor&session=${code}&screen=devices`);
  await expect(screen.getByTestId('device-screen')).toBeVisible();
  await expect.poll(() => assigned(page, code)).toEqual(['1:devices']);
  await openScreens(page);
  await part(page, 1, 'monitor').click();
  await expect.poll(() => assigned(page, code)).toEqual(['1:all']);
  await expect(screen.getByTestId('device-screen')).toHaveCount(0);
});

test('a screen plugged into this computer opens in a window of its own, a new one each time', async ({ page, context }) => {
  const code = await openController(page);
  await page.getByTestId('setup-toggle').click();
  await expect(page.getByTestId('screens-empty')).toBeVisible();
  await expect(page.getByTestId('screens-qr')).toHaveAttribute('title', new RegExp(`\\?mode=monitor&session=${code}$`));
  const [w1] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: 'Open a patient screen on this computer' }).click()]);
  await w1.waitForLoadState();
  expect(w1.url()).toMatch(new RegExp(`\\?mode=monitor&session=${code}$`));
  const [w2] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: 'Open a patient screen on this computer' }).click()]);
  await w2.waitForLoadState();
  expect(await w1.evaluate(() => window.name)).not.toBe(await w2.evaluate(() => window.name));
  await expect(row(page, 1)).toBeVisible();
  await expect(row(page, 2)).toBeVisible();
  await expect(w1.getByTestId('screen-number')).toContainText('Screen 1');
  await expect(w2.getByTestId('screen-number')).toContainText('Screen 2');
  // Three screens offer the three-way split
  const [w3] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: 'Open a patient screen on this computer' }).click()]);
  await w3.waitForLoadState();
  await page.locator('[data-preset="split3"]').click();
  await expect.poll(() => assigned(page, code)).toEqual(['1:monitor', '2:defib', '3:vent']);
  await expect(page.getByTestId('setup-summary')).toContainText('1: Monitor · 2: Defib · 3: Ventilator');
  await shot(page, 'setup-three-screens');
});

test('one screen: the monitor switches between the obs, the defib and the ventilator, keeping both devices loaded', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  const monitor = await context.newPage();
  const monitorErrors = trackErrors(monitor);
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  await expect(monitor.getByTestId('screen-switcher')).toHaveCount(0);       // nothing brought in yet
  { const snd = monitor.getByText('Tap to Enable Sound'); if (await snd.count()) await snd.click({ force: true }); }     // the (bouncing) sound card sits on top of everything

  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_VENT_PANEL', payload: true }));
  await expect(monitor.getByTestId('monitor-vent')).toBeVisible();
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_DEFIB_PANEL', payload: true }));
  await expect(monitor.getByTestId('monitor-defib')).toBeVisible();
  await expect(monitor.getByTestId('monitor-vent')).toBeHidden();            // still loaded, behind
  const sw = monitor.getByTestId('screen-switcher');
  await expect(sw.getByRole('button')).toHaveText(['Monitor', 'Defib', 'Ventilator']);

  await sw.getByRole('button', { name: 'Monitor' }).click();
  await expect(monitor.getByTestId('monitor-defib')).toBeHidden();
  await expect(monitor.getByTestId('monitor-vent')).toBeHidden();
  await expect(monitor.locator('iframe[title="Ventilator"]')).toHaveCount(1);
  await expect.poll(async () => (await presence(page, code)).filter(p => p.role === 'screen:all').map(p => p.display)).toEqual(['patient monitor']);
  await sw.getByRole('button', { name: 'Ventilator' }).click();
  await expect(monitor.getByTestId('monitor-vent')).toBeVisible();
  await expect.poll(async () => (await presence(page, code)).filter(p => p.role === 'screen:all').map(p => p.display)).toEqual(['ventilator']);

  // The candidate switches to the defib and back; the ventilator keeps running underneath
  const ventFrame = () => monitor.frames().find(f => /vent\/index\.html/.test(f.url()));
  await ventFrame().evaluate(() => { document.getElementById('kPower').click(); });
  await sw.getByRole('button', { name: 'Defib' }).click();
  await expect.poll(() => ventFrame().evaluate(() => window.__vent.ventStateNow().state), { timeout: 15000 }).toBe('standby');

  // Taking the ventilator away hands the screen back to the monitor
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_VENT_PANEL', payload: false }));
  await expect(monitor.getByTestId('monitor-vent')).toHaveCount(0);
  await expect(sw.getByRole('button')).toHaveText(['Monitor', 'Defib']);
  await expect(page.getByTestId('connection-badge')).toContainText(/defib|patient monitor/i);
  expect(monitorErrors).toEqual([]);
});

test('Defib Sim has the Screens panel too, and Open defib still opens the defib in its own window', async ({ page, context }) => {
  const code = await openController(page);
  await page.getByRole('button', { name: 'Defib Sim', exact: true }).click();
  await page.getByRole('button', { name: /^Start Defib Sim/ }).click();
  await joinAsScreen(context, code);
  await openScreens(page);
  await expect(row(page, 1)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  const [win] = await Promise.all([context.waitForEvent('page'), page.getByRole('button', { name: 'Open defib' }).click()]);
  await win.waitForLoadState();
  expect(win.url()).toMatch(new RegExp(`/defib/index\\.html\\?session=${code}$`));
  expect(await win.evaluate(() => window.name)).toBe('emsim-screen-defib');
  // A page opened from a defib link is listed, but is not numbered
  await openScreens(page);
  await expect(page.getByTestId('screens-others')).toContainText('a defib page');
  await expect(row(page, 2)).toHaveCount(0);
});

test('a device stays loaded when the controller adds or removes the monitor on its screen (pacing is not stopped)', async ({ page, context }) => {
  const code = await openController(page);
  await startQuickSim(page);
  const { screen, errors } = await joinAsScreen(context, code);
  await expect.poll(() => assigned(page, code)).toEqual(['1:all']);
  await page.evaluate(() => { window.__simEngine.dispatch({ type: 'SET_DEFIB_PANEL', payload: true }); window.__simEngine.dispatch({ type: 'SET_VENT_PANEL', payload: true }); });
  await expect(screen.getByTestId('monitor-defib')).toBeAttached();
  await expect(screen.getByTestId('monitor-vent')).toBeAttached();
  const mark = () => screen.evaluate(() => [...document.querySelectorAll('iframe')].forEach(f => { f.contentWindow.__mark = 1; }));
  const marks = () => screen.evaluate(() => [...document.querySelectorAll('iframe')].map(f => f.title + ':' + (f.contentWindow && f.contentWindow.__mark === 1)).sort());
  await expect.poll(() => screen.evaluate(() => [...document.querySelectorAll('iframe')].every(f => f.contentDocument && f.contentDocument.readyState === 'complete'))).toBe(true);
  await mark();
  await openScreens(page);
  await part(page, 1, 'monitor').click();                                     // all -> defib + ventilator
  await expect.poll(() => assigned(page, code)).toEqual(['1:devices']);
  await expect(screen.getByTestId('device-screen')).toBeVisible();
  expect(await marks()).toEqual(['Defibrillator:true', 'Ventilator:true']);
  await part(page, 1, 'monitor').click();                                     // and back
  await expect.poll(() => assigned(page, code)).toEqual(['1:all']);
  await expect(screen.getByTestId('device-screen')).toHaveCount(0);
  expect(await marks()).toEqual(['Defibrillator:true', 'Ventilator:true']);
  await part(page, 1, 'vent').click();                                        // the ventilator leaves this screen
  await expect.poll(() => assigned(page, code)).toEqual(['1:mondefib']);
  await expect(screen.getByTestId('monitor-vent')).toHaveCount(0);
  expect(await marks()).toEqual(['Defibrillator:true']);
  expect(errors).toEqual([]);
});

test('a leftover presence row with an old heartbeat is not numbered as a connected screen', async ({ page }) => {
  const code = await openController(page);
  await page.evaluate((c) => window.db.ref(`sessions/${c}/presence/oldtab123456`).set({ role: 'screen:all', display: 'patient monitor', ts: Date.now() - 3600000 }), code);
  await page.getByTestId('setup-toggle').click();
  await expect(page.getByTestId('screens-empty')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await assigned(page, code)).toEqual([]);
  // If it is really alive, its next heartbeat makes it a screen
  await page.evaluate((c) => window.db.ref(`sessions/${c}/presence/oldtab123456`).update({ ts: Date.now() }), code);
  await expect.poll(() => assigned(page, code)).toEqual(['1:all']);
});
