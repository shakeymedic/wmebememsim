const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, startQuickSim, session, expect } = require('./helpers');

// Existing behaviour that later changes must not break

test.describe('Controller, monitor and defib linked by session code', () => {
  let errors;
  test.beforeEach(async ({ page, context }) => {
    await useFakeFirebase(context);
    errors = trackErrors(page);
  });
  test.afterEach(() => expect(errors).toEqual([]));

  test('the controller mints a six-character code and publishes Quick Sim to the session', async ({ page }) => {
    const code = await openController(page);
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    await startQuickSim(page);
    await expect.poll(() => session(page, code, '/rhythm')).toBe('Sinus Rhythm');
    await page.getByRole('button', { name: /^Coarse VF/ }).click();
    await expect.poll(() => session(page, code, '/rhythm')).toBe('VF');
  });

  test('the room monitor joins the session and announces itself', async ({ page, context }) => {
    const code = await openController(page);
    await startQuickSim(page);
    const monitor = await context.newPage();
    const monitorErrors = trackErrors(monitor);
    await monitor.goto(`/index.html?mode=monitor&session=${code}`);
    await expect.poll(async () => Object.values(await session(page, code, '/presence') || {}).map(p => p.role)).toContain('monitor');
    expect(monitorErrors).toEqual([]);
  });

  test('the standalone defib links, and its shock reaches the controller', async ({ page, context }) => {
    const code = await openController(page);
    await startQuickSim(page);
    await page.getByRole('button', { name: /^Coarse VF/ }).click();
    const defib = await context.newPage();
    const defibErrors = trackErrors(defib);
    await defib.goto(`/defib/index.html?session=${code}`);
    await expect(defib.locator('#linkBanner')).toBeHidden();
    await expect.poll(async () => Object.values(await session(page, code, '/presence') || {}).map(p => p.role)).toContain('defib');

    await defib.click('.mode-label[data-mode="defib"]');
    await defib.click('#chargeBtn');
    await expect(defib.locator('#shockBtn')).toBeEnabled({ timeout: 5000 });
    await defib.click('#shockBtn');
    await expect.poll(() => session(page, code, '/defib/shockCount')).toBe(1);
    expect(defibErrors).toEqual([]);
  });
});

test('a monitor that joins before the controller publishes waits instead of crashing', async ({ page, context }) => {
  await useFakeFirebase(context);
  const monitor = await context.newPage();
  const monitorErrors = [];
  monitor.on('console', m => { if (m.type() === 'error' && /Render error|TypeError/.test(m.text())) monitorErrors.push(m.text()); });
  await monitor.goto('/index.html?mode=monitor&session=ZZZ999');
  await monitor.waitForTimeout(1500);
  expect(monitorErrors).toEqual([]);
  // The controller then takes that code and starts publishing: the monitor picks the patient up
  await page.goto('/index.html?session=ZZZ999');
  await expect(page.getByText('Session Code', { exact: true })).toBeVisible();
  // A monitor-only code like this is not a current-format code, so the controller mints its own;
  // point the monitor at it instead.
  const code = await page.evaluate(() => localStorage.getItem('wmebem_session_id'));
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await monitor.waitForTimeout(800);
  await startQuickSim(page);
  await expect.poll(() => session(page, code, '/rhythm')).toBe('Sinus Rhythm');
  await monitor.waitForTimeout(1000);
  expect(monitorErrors).toEqual([]);
});
