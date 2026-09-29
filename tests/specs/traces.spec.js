const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, expect } = require('./helpers');

// The shared rhythm registry (data/rhythms.js), measured in the browser as the app ships it

test.describe('ECG and pulse waveforms', () => {
  let errors;
  test.beforeEach(async ({ page, context }) => {
    await useFakeFirebase(context);
    errors = trackErrors(page);
    await page.goto('/index.html');
    await page.waitForFunction(() => window.RHYTHMS);
  });
  test.afterEach(() => expect(errors).toEqual([]));

  // QRS duration (ms): the contiguous non-baseline region around the tallest deflection of a beat
  const qrsMs = (page, rhythm, hr, lead = 'II') => page.evaluate(([rhythm, hr, lead]) => {
    const RG = window.RHYTHMS, N = 6000, rr = 60 / hr;
    const ys = [];
    for (let i = 0; i < N; i++) ys.push(RG.ecgValue(i / N, 0, rhythm, { hr, beat: 4, noise: false, lead }));
    let m = 0;
    ys.forEach((y, i) => { if (Math.abs(y) > Math.abs(ys[m])) m = i; });
    // Walk outwards while the trace is off the baseline, bridging the brief zero crossings
    // between Q, R and S (up to 12 ms) but not the ST segment
    const gap = Math.ceil(0.012 / rr * N);
    const walk = dir => {
      let i = m, last = m, quiet = 0;
      while (i > 0 && i < N - 1 && quiet <= gap) { i += dir; if (Math.abs(ys[i]) > 2) { last = i; quiet = 0; } else quiet++; }
      return last;
    };
    return (walk(1) - walk(-1)) / N * rr * 1000;
  }, [rhythm, hr, lead]);

  test('a narrow QRS keeps its width at any heart rate', async ({ page }) => {
    const widths = [];
    for (const hr of [35, 60, 100, 150]) widths.push(await qrsMs(page, 'Sinus Rhythm', hr));
    for (const w of widths) expect(w).toBeGreaterThan(70);
    for (const w of widths) expect(w).toBeLessThan(120);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(8);
    expect(await qrsMs(page, 'SVT', 190)).toBeLessThan(120);
  });

  test('ventricular rhythms are broad even when slow or fast', async ({ page }) => {
    expect(await qrsMs(page, 'VT', 180)).toBeGreaterThan(120);
    expect(await qrsMs(page, 'Complete Heart Block', 35)).toBeGreaterThan(120);
    expect(await qrsMs(page, 'Idioventricular', 35)).toBeGreaterThan(120);
    expect(await qrsMs(page, 'LBBB', 75)).toBeGreaterThan(120);
  });

  test('idioventricular rhythm is a perfusing bradycardia, not an arrest', async ({ page }) => {
    const r = await page.evaluate(() => ({
      label: RHYTHMS.labelFor('IVR'), pulseless: RHYTHMS.isPulseless('Idioventricular'), shockable: RHYTHMS.isShockable('Idioventricular')
    }));
    expect(r).toEqual({ label: 'Idioventricular Rhythm', pulseless: false, shockable: false });
  });

  test('the R-wave phase marks the tallest point of each beat, and none exists in VF', async ({ page }) => {
    const r = await page.evaluate(() => {
      const RG = window.RHYTHMS, N = 4000, out = [];
      for (const [rh, hr] of [['Sinus Rhythm', 60], ['Sinus Rhythm', 150], ['AF', 130], ['VT', 170]]) {
        const rp = RG.rWavePhase(rh, hr, 7);
        let m = 0, mv = -1e9;
        for (let i = 0; i < N; i++) { const y = RG.ecgValue(i / N, 0, rh, { hr, beat: 7, noise: false }); if (y > mv) { mv = y; m = i; } }
        out.push(Math.abs(m / N - rp));
      }
      return { diffs: out, vf: RG.rWavePhase('VF', 0, 3), asys: RG.rWavePhase('Asystole', 0, 3) };
    });
    for (const d of r.diffs) expect(d).toBeLessThan(0.02);
    expect(r.vf).toBeNull();
    expect(r.asys).toBeNull();
  });

  test('the QT interval shortens as the rate rises', async ({ page }) => {
    const tPeak = await page.evaluate(() => {
      const RG = window.RHYTHMS, N = 6000, out = {};
      for (const hr of [50, 120]) {
        const rr = 60 / hr, rp = RG.rWavePhase('Sinus Rhythm', hr, 3);
        // The T peak: the maximum after the QRS has ended (from 80 ms after the R wave)
        let best = -1e9, at = 0;
        for (let i = 0; i < N; i++) {
          const dt = (i / N - rp) * rr;
          if (dt < 0.08 || dt > 0.5) continue;
          const y = RG.ecgValue(i / N, 0, 'Sinus Rhythm', { hr, beat: 3, noise: false });
          if (y > best) { best = y; at = dt; }
        }
        out[hr] = at;
      }
      return out;
    });
    expect(tPeak[120]).toBeLessThan(tPeak[50]);
    expect(tPeak[50]).toBeGreaterThan(0.2);
  });

  test('leads differ: aVR is inverted, V1 is rS and V6 has a tall R', async ({ page }) => {
    const r = await page.evaluate(() => {
      const RG = window.RHYTHMS, N = 3000;
      const range = lead => { let lo = 1e9, hi = -1e9; for (let i = 0; i < N; i++) { const y = RG.ecgValue(i / N, 0, 'Sinus Rhythm', { hr: 70, beat: 2, noise: false, lead }); lo = Math.min(lo, y); hi = Math.max(hi, y); } return { lo, hi }; };
      return { aVR: range('aVR'), V1: range('V1'), V6: range('V6'), II: range('II') };
    });
    expect(Math.abs(r.aVR.lo)).toBeGreaterThan(r.aVR.hi);
    expect(Math.abs(r.V1.lo)).toBeGreaterThan(r.V1.hi * 2);
    expect(r.V6.hi).toBeGreaterThan(Math.abs(r.V6.lo));
  });

  test('a pulse wave follows each QRS, is absent after a dropped beat, and varies in AF', async ({ page }) => {
    const r = await page.evaluate(() => {
      const RG = window.RHYTHMS;
      // Mobitz II drops every 4th beat (index 3): its pulse window should stay near baseline
      const peakIn = (rh, hr, beat, kind) => { let m = 0; for (let i = 0; i < 400; i++) m = Math.max(m, RG.pulseValue(kind, i / 400, rh, { hr, beat })); return m; };
      // Value where this beat's own pulse would peak: R + transit (0.22 s) + upstroke (0.13 s)
      const atOwnPeak = beat => { const hr = 50, rr = 60 / hr, ph = RG.rWavePhase('Sinus Rhythm', hr, 0) + 0.35 / rr; return RG.pulseValue('pleth', ph, '2nd Deg Heart Block', { hr, beat }); };
      const conducted = atOwnPeak(2);
      const afterDrop = atOwnPeak(3);
      const af = []; for (let b = 10; b < 40; b++) af.push(peakIn('AF', 110, b, 'art'));
      const delay = (() => { const hr = 60, rp = RG.rWavePhase('Sinus Rhythm', hr, 5); for (let i = 0; i < 1000; i++) { if (RG.pulseValue('pleth', i / 1000, 'Sinus Rhythm', { hr, beat: 5 }) > 3 && i / 1000 > rp) return (i / 1000 - rp) * 1; } return null; })();
      return { conducted, afterDrop, afMin: Math.min(...af), afMax: Math.max(...af), delay, vf: peakIn('VF', 0, 3, 'pleth') };
    });
    expect(r.afterDrop).toBeLessThan(r.conducted * 0.5);
    expect(r.afMax / r.afMin).toBeGreaterThan(1.3);
    expect(r.delay).toBeGreaterThan(0.15);
    expect(r.delay).toBeLessThan(0.4);
    expect(r.vf).toBe(0);
  });

  test('the monitor draws every rhythm without errors', async ({ page }) => {
    const bad = await page.evaluate(() => {
      const RG = window.RHYTHMS, out = [];
      RG.ALL.forEach(rh => {
        for (let i = 0; i < 500; i++) {
          for (const lead of RG.LEADS) {
            const y = RG.ecgValue(i / 500, i * 0.01, rh, { hr: 80, beat: i % 7, lead, cpr: i % 2 === 0 });
            if (!Number.isFinite(y)) out.push(`${rh} ${lead}`);
          }
          const p = RG.pulseValue('pleth', i / 500, rh, { hr: 80, beat: i % 7 });
          if (!Number.isFinite(p)) out.push(`${rh} pleth`);
        }
      });
      return [...new Set(out)];
    });
    expect(bad).toEqual([]);
  });
});
