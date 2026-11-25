// Full review of 25 Nov 2026: wording and recommended-action fixes checked against UK guidance.
const { test } = require('@playwright/test');
const { useFakeFirebase, openController, expect } = require('./helpers');

test.beforeEach(async ({ context }) => { await useFakeFirebase(context); });

test('review 25 Nov: tiles and recommended actions follow the guidance each brief names', async ({ page }) => {
  await openController(page);
  const d = await page.evaluate(() => {
    const sc = id => window.ALL_SCENARIOS.find(s => s.id === id);
    const I = window.INTERVENTIONS;
    return {
      chb: sc('AM023'), susp: sc('AT012'), abd: sc('PS006'), manic: sc('AM009'),
      abx: I.Antibiotics, del: I.Delivery, ergo: I.Ergometrine, ketIM: I.KetamineIM,
      unknown: window.ALL_SCENARIOS.flatMap(s => [...(s.recommendedActions || []), ...(s.stabilisers || [])].filter(k => !I[k]).map(k => s.id + ':' + k))
    };
  });
  // RCUK 2025 bradycardia: isoprenaline or adrenaline as the bridge to pacing; metaraminol is not in it.
  expect(d.chb.stabilisers).toEqual(['Pacing', 'Isoprenaline', 'AdrenalineInfusion']);
  // HSE RR708 (2009): standard first aid, lay flat; no "keep them sitting" advice.
  const susp = JSON.stringify(d.susp.instructorBrief);
  expect(susp).toContain('lay flat');
  expect(susp).not.toMatch(/Sit up|Gradual recline|upon lying flat/);
  // RCEM acute behavioural disturbance (2025): IM ketamine 4 mg/kg. NICE NG10: IM lorazepam.
  expect(d.abd.recommendedActions).toContain('KetamineIM');
  expect(d.abd.recommendedActions).not.toContain('Ketamine');
  expect(d.manic.recommendedActions).toEqual(['Obs', 'LorazepamIM']);
  expect(d.ketIM.log).toContain('4 mg/kg');
  expect(d.ketIM.log).not.toContain('4-5');
  // Generic tiles no longer name one drug or one route of delivery.
  expect(d.abx.label).toBe('IV Antibiotics (per local guideline)');
  expect(d.abx.log).not.toContain('Co-Amoxiclav');
  expect(d.del.label).toBe('Deliver the baby');
  expect(d.ergo.log).toBe('Ergometrine administered (IM, or slow IV).');
  expect(d.unknown).toEqual([]);
});
