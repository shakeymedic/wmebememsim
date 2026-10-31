// A small 16:9 phone (405 x 720, and 360 wide) and the same phone on its side (720 x 405). Seen on the
// live site on 31 Oct 2026: the NIBP number hidden behind Cycle / Auto, HR / SpO2 / RR numbers cut
// off at the bottom of their tiles in landscape, the scenario library's Load button off the right
// edge, the gas printout's reference ranges cut off, and a recommended action's name under its
// minus button. Desktop and tablet layouts are covered by every other spec.
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, pressStart, expect } = require('./helpers');

test.use({ viewport: { width: 405, height: 720 }, isMobile: true, hasTouch: true });
test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

const inside = (inner, outer) => inner.x >= outer.x - 1 && inner.y >= outer.y - 1
    && inner.x + inner.width <= outer.x + outer.width + 1 && inner.y + inner.height <= outer.y + outer.height + 1;
const overlaps = (a, b) => !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);

async function openLibrary(page) {
    await page.getByText('Scenario library', { exact: true }).click();
    await page.getByText('Adult Medical', { exact: true }).click();
    await expect(page.getByTestId('library-list')).toBeVisible();
}

// Load the first adult medical scenario with the patient already on the monitor, start it and
// open a room monitor in the same browser (the fake database is shared between its pages).
async function runScenarioWithMonitor(page, context) {
    const code = await openController(page);
    await openLibrary(page);
    await page.getByTestId('library-list').getByRole('button', { name: 'Load', exact: true }).first().click();
    await page.getByText('The patient is already on the monitor').click();
    await page.getByText('Start Scenario').click();
    await pressStart(page);
    const monitor = await context.newPage();
    const errors = trackErrors(monitor);
    await monitor.goto(`/index.html?mode=monitor&session=${code}`);
    await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
    await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_NIBP', payload: { sys: 145, dia: 94 } }));
    return { monitor, errors };
}

test('scenario library on a narrow phone: Edit and Load stay on screen', async ({ page }) => {
    const errors = trackErrors(page);
    await page.setViewportSize({ width: 360, height: 720 });
    await openController(page);
    await openLibrary(page);
    const list = await page.getByTestId('library-list').boundingBox();
    const loads = page.getByTestId('library-list').getByRole('button', { name: 'Load', exact: true });
    for (let i = 0; i < 3; i++) {
        const b = await loads.nth(i).boundingBox();
        expect(b.x + b.width).toBeLessThanOrEqual(Math.min(360, list.x + list.width) + 1);
    }
    expect(errors).toEqual([]);
});

test('room monitor on a small phone: NIBP clear of its buttons, every number inside its tile, both ways round', async ({ page, context }) => {
    const { monitor, errors } = await runScenarioWithMonitor(page, context);
    const check = async () => {
        const buttons = await monitor.getByTestId('nibp-buttons').boundingBox();
        const nibp = await monitor.locator('.obs-nibp').first().boundingBox();
        expect(overlaps(nibp, buttons)).toBe(false);
        for (const id of ['obs-heart-rate', 'obs-spo2', 'obs-resp-rate']) {
            const num = monitor.getByTestId(id);
            const tile = await num.locator('xpath=ancestor::*[contains(@class,"obs-tile")][1]').boundingBox();
            expect(inside(await num.boundingBox(), tile), id).toBe(true);
        }
    };
    await check();                                              // portrait 405 x 720
    await monitor.setViewportSize({ width: 720, height: 405 }); // on its side
    await expect.poll(() => monitor.getByTestId('obs-tiles').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(4);
    await check();
    await monitor.setViewportSize({ width: 640, height: 360 });
    await check();
    expect(errors).toEqual([]);
});

test('gas printout on a small phone: the reference ranges are not cut off', async ({ page, context }) => {
    const { monitor, errors } = await runScenarioWithMonitor(page, context);
    for (const width of [405, 360]) {
        await monitor.setViewportSize({ width, height: 720 });
        await monitor.getByRole('button', { name: /VBG/ }).last().click();
        const grid = monitor.getByTestId('vbg-grid');
        await expect(grid).toBeVisible();
        // Nothing in the printout (the closing bracket of a range above all) reaches past its right edge.
        const past = await grid.evaluate(el => {
            const right = el.getBoundingClientRect().right;
            return [...el.querySelectorAll('td, span')].filter(c => c.getBoundingClientRect().right > right + 0.5).map(c => c.textContent);
        });
        expect(past, `at ${width} px`).toEqual([]);
        await monitor.getByTestId('inv-result-close').click();
        await expect(grid).toHaveCount(0);
    }
    expect(errors).toEqual([]);
});

test('recommended action on a phone: the name stays clear of the minus button', async ({ page, context }) => {
    const errors = trackErrors(page);
    await runScenarioWithMonitor(page, context);
    await page.bringToFront();
    await page.getByRole('button', { name: /^Aspirin/ }).first().click();
    const minusBtn = page.getByRole('button', { name: /Remove one Aspirin/ }).first();
    const minus = await minusBtn.boundingBox();
    const label = minusBtn.locator('xpath=..').getByTestId('action-label');
    const range = await label.evaluate(el => { const r = document.createRange(); r.selectNodeContents(el); return [...r.getClientRects()].map(x => ({ x: x.x, y: x.y, width: x.width, height: x.height })); });
    for (const line of range) expect(overlaps(line, minus)).toBe(false);
    expect(errors).toEqual([]);
});
