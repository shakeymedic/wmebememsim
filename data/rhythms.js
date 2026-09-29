// data/rhythms.js — WAVE 3: THE SINGLE SHARED RHYTHM REGISTRY
// =============================================================================
// Before Wave 3 the application carried TWO divergent shockability lists and SEVEN
// disagreeing "is this an arrest?" lists, spread across data/engine.js, data/components.js,
// data/screens/*.js and the standalone defib/index.html. The lists disagreed about VT
// (excluded from PULSELESS, included in inArrest), which is why "VT with Pulse" (AM024)
// was given arrest ETCO2 physiology, and why the standalone defib called a rhythm shockable
// that the engine then refused to convert.
//
// This file is now the ONLY place any of the following is defined:
//   * which rhythm identifiers exist, and their canonical spelling
//   * every alias / legacy spelling that must resolve to a canonical identifier
//   * shockable (unsynchronised defibrillation indicated)
//   * pulseless (no cardiac output — obs must read zero, arrest physiology applies)
//   * ROSC-eligible (a sensible post-arrest rhythm to convert INTO)
//   * synchronised-cardioversion eligible
//   * the ECG waveform used to draw it, on BOTH the React monitor and the standalone defib
//
// It is plain ES5-compatible JavaScript with no JSX and no dependencies, so it can be loaded
// by a bare <script> tag from index.html AND from defib/index.html (which has no Babel).
// It must be loaded BEFORE data/components.js and data/engine.js.
// =============================================================================
(function () {
    'use strict';

    // -------------------------------------------------------------------------
    // 1. WAVEFORM PRIMITIVES — REAL TIME, NOT CYCLE-NORMALISED
    // Every complex is described in SECONDS relative to its R peak, the way an ECG is actually
    // measured: a narrow QRS is ~90 ms whatever the heart rate, the PR interval is fixed, and only
    // the QT shortens as the rate rises (Bazett). Before this, each beat was a shape stretched
    // across the whole cardiac cycle, so a QRS drawn at 40/min was 4.5 times wider than the same
    // QRS at 180/min: narrow-complex bradycardias looked broad and broad-complex tachycardias
    // looked narrow — exactly the distinction a trainee must learn to make.
    //
    // Amplitudes stay in the display units every renderer already used (normal sinus R ~= +45,
    // ~40 units = 1 mV). A narrow complex is built from named parts (P, Q, R, S, ST, T) so each
    // lead can weight the parts differently (see LEAD_PARTS): aVR is inverted, V1 is rS with a
    // flat T, R-wave progression runs across V2-V6.
    // -------------------------------------------------------------------------
    var gs = function (t, centre, amp, sigma) { var d = (t - centre) / sigma; return amp * Math.exp(-0.5 * d * d); };
    // Asymmetric bump: different widths either side of the peak (T waves rise slowly, fall faster).
    var ag = function (t, centre, amp, s1, s2) { var d = (t - centre) / (t < centre ? s1 : s2); return amp * Math.exp(-0.5 * d * d); };
    var clampNum = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };

    // QT from the R-R interval (Fridericia, QTc 0.40 s), measured from QRS onset. Fridericia rather
    // than Bazett: Bazett over-shortens the QT at fast rates, which squeezed the ST segment away.
    var qtFor = function (rr) { return clampNum(0.40 * Math.cbrt(clampNum(rr, 0.2, 3)), 0.24, 0.52); };
    var QRS_ONSET = -0.045;   // narrow QRS onset relative to the R peak (QRS ~90 ms)

    // The parts of a normal narrow complex, t = seconds from the R peak.
    // opts: { prMs (PR interval), p (P scale), t (T scale), st (ST shift, units), wide (QRS widening factor) }
    function narrowParts(t, rr, o) {
        var wide = o.wide || 1;
        var pr = o.pr || 0.16;                                   // P onset -> QRS onset
        var qt = qtFor(rr);
        var tPeak = QRS_ONSET * wide + qt - 0.09;
        var jPoint = 0.045 * wide;
        var parts = {
            P: gs(t, QRS_ONSET - pr + 0.05, 4.5 * (o.p === undefined ? 1 : o.p), 0.022),
            Q: gs(t, -0.028 * wide, -5, 0.007 * wide),
            R: gs(t, 0, 45 * (o.r === undefined ? 1 : o.r), 0.0095 * wide),
            S: gs(t, 0.026 * wide, -12, 0.008 * wide),
            T: ag(t, tPeak, 9 * (o.t === undefined ? 1 : o.t), (o.tNarrow ? 0.03 : 0.055) * qt / 0.40, (o.tNarrow ? 0.025 : 0.035) * qt / 0.40),
            ST: 0
        };
        if (o.st) {
            // A coved ST segment from the J point into the T wave (STEMI), or depression if negative.
            if (t > jPoint && t < tPeak + 0.04) {
                var x = (t - jPoint) / (tPeak + 0.04 - jPoint);
                parts.ST = o.st * Math.sin(Math.min(1, x * 1.25) * Math.PI / 2) * (x > 0.8 ? 1 - (x - 0.8) / 0.2 * 0.6 : 1);
            }
        }
        return parts;
    }

    // Broad ventricular complex (VT, idioventricular rhythm, ventricular escape in complete heart
    // block): ~160 ms, bizarre, with a discordant T wave.
    function ventricular(t, rr) {
        var qt = qtFor(rr) * 1.1;
        return ag(t, 0, 38, 0.028, 0.035) + gs(t, 0.075, -20, 0.030) + gs(t, 0.02 + qt * 0.62, -11, 0.06);
    }
    // Paced: a hairline spike, then a broad LBBB-like complex (negative in II) with discordant T.
    // The spike keeps a short flat top (~12 ms) so renderers that sample every few milliseconds
    // cannot miss it.
    function paced(t, rr) {
        var spike = Math.abs(t + 0.06) < 0.006 ? 32 : gs(t, -0.06, 32, 0.0025);
        return spike + gs(t, 0, -30, 0.028) + gs(t, 0.08, 10, 0.03) + gs(t, 0.02 + qtFor(rr) * 0.68, 11, 0.07);
    }
    // PEA: organised electrical activity without output — typically slow, broadened, low amplitude.
    function pea(t, rr) {
        return gs(t, -0.035, -4, 0.018) + gs(t, 0.015, 16, 0.024) + gs(t, 0.085, -7, 0.03) + gs(t, 0.02 + qtFor(rr) * 0.75, 4, 0.07);
    }
    // Agonal: very wide, slow, single bizarre deflection, essentially no T wave.
    function agonal(t) { return gs(t, 0, 13, 0.06) + gs(t, 0.18, -6, 0.08); }
    // LBBB: broad (~140 ms), notched, monophasic with discordant ST/T.
    function lbbb(t, rr) {
        return gs(t, QRS_ONSET - 0.11, 4.5, 0.022) + gs(t, -0.012, 30, 0.02) + gs(t, 0.045, 34, 0.022)
            + gs(t, 0.02 + qtFor(rr) * 0.7, -9, 0.05);
    }
    // RBBB as seen in a right-sided lead: rSR' with a slurred terminal S.
    function rbbb(t, rr) {
        return gs(t, QRS_ONSET - 0.11, 4.5, 0.022) + gs(t, -0.025, 18, 0.01) + gs(t, 0.012, -10, 0.01)
            + gs(t, 0.055, 26, 0.015) + gs(t, 0.095, -6, 0.02) + ag(t, qtFor(rr) - 0.13, 7, 0.055, 0.035);
    }

    // Complex templates keyed by waveform id. Each returns either a PARTS object (narrow complexes,
    // weighted per lead) or a number (broad complexes, scaled by the lead's overall gain).
    var TEMPLATES = {
        sinus:         function (t, rr) { return narrowParts(t, rr, {}); },
        svt:           function (t, rr) { return narrowParts(t, rr, { p: 0, t: 0.85 }); },
        junctional:    function (t, rr) { return narrowParts(t, rr, { p: 0, t: 0.9 }); },
        first_degree:  function (t, rr) { return narrowParts(t, rr, { pr: 0.30 }); },
        mobitz2:       function (t, rr) { return narrowParts(t, rr, {}); },
        af:            function (t, rr) { return narrowParts(t, rr, { p: 0, t: 0.85 }); },
        flutter:       function (t, rr) { return narrowParts(t, rr, { p: 0, t: 0.35 }); },
        stemi:         function (t, rr) { return narrowParts(t, rr, { st: 10, t: 1.5 }); },
        hyperkalaemia: function (t, rr) { return narrowParts(t, rr, { p: 0.35, wide: 1.8, t: 2.9, tNarrow: true }); },
        chb:           ventricular,
        vt:            ventricular,
        idioventricular: ventricular,
        pea: pea,
        agonal: agonal,
        paced: paced,
        bbb: lbbb,
        rbbb: rbbb
    };

    // Per-lead weights for the parts of a narrow complex (approximate normal adult 12-lead).
    // PADS ~ lead II as seen through anterolateral defibrillator pads.
    var LEAD_PARTS = {
        I:    { P: 0.6,  Q: 0.5, R: 0.55, S: 0.4,  T: 0.7,  ST: 0.6 },
        II:   { P: 1,    Q: 1,   R: 1,    S: 1,    T: 1,    ST: 1 },
        III:  { P: 0.4,  Q: 0.6, R: 0.5,  S: 0.6,  T: 0.3,  ST: 0.5 },
        aVR:  { P: -0.8, Q: -0.4, R: -0.75, S: -0.5, T: -0.8, ST: -0.7 },
        aVL:  { P: 0.2,  Q: 0.3, R: 0.3,  S: 0.5,  T: 0.2,  ST: 0.2 },
        aVF:  { P: 0.7,  Q: 0.8, R: 0.75, S: 0.8,  T: 0.65, ST: 0.75 },
        V1:   { P: 0.5,  Q: 0,   R: 0.2,  S: 2.5,  T: -0.3, ST: 0.3 },
        V2:   { P: 0.5,  Q: 0,   R: 0.45, S: 2.2,  T: 1.2,  ST: 0.6 },
        V3:   { P: 0.5,  Q: 0,   R: 0.8,  S: 1.4,  T: 1.2,  ST: 0.8 },
        V4:   { P: 0.5,  Q: 0.4, R: 1.25, S: 0.8,  T: 1.1,  ST: 1 },
        V5:   { P: 0.5,  Q: 0.8, R: 1.2,  S: 0.4,  T: 0.9,  ST: 0.9 },
        V6:   { P: 0.5,  Q: 0.9, R: 1.0,  S: 0.25, T: 0.7,  ST: 0.7 },
        PADS: { P: 0.85, Q: 0.85, R: 0.85, S: 0.85, T: 0.85, ST: 0.85 }
    };
    // Overall gain for broad / chaotic activity, whose shape is not decomposed by part.
    var LEAD_GAIN = { I: 0.65, II: 1.0, III: 0.45, aVR: -0.8, aVL: 0.35, aVF: 0.75, V1: -0.7, V2: 0.45, V3: 0.8, V4: 1.15, V5: 1.05, V6: 0.85, PADS: 0.85 };

    function sumParts(p, lead, stOverride) {
        var w = LEAD_PARTS[lead] || LEAD_PARTS.II;
        var st = stOverride === undefined ? p.ST * w.ST : stOverride;
        return p.P * w.P + p.Q * w.Q + p.R * w.R + p.S * w.S + p.T * w.T + st;
    }

    // Smooth, deterministic "value noise": a real monitor's baseline is filtered, so it wanders a
    // little but never fizzes frame to frame the way per-sample Math.random() did.
    function hash1(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
    function valueNoise(t, rate) {
        var x = t * rate, i = Math.floor(x), f = x - i;
        var u = f * f * (3 - 2 * f);
        return (hash1(i) * (1 - u) + hash1(i + 1) * u) * 2 - 1;
    }

    // Sawtooth flutter baseline, one flutter wave per unit of `fp` (atrial rate is fixed at
    // ~300/min whatever the ventricular response, so variable block draws correctly).
    var sawtooth = function (fp) {
        fp = fp - Math.floor(fp);
        if (fp < 0.18) return 4 - fp * 45;
        return -4 + ((fp - 0.18) / 0.82) * 8;
    };

    // REAL-TIME WAVEFORMS — driven by absolute time rather than by beats, because they are either
    // chaotic (VF), flat (asystole) or dissociated from the ventricular rate.
    var REALTIME = {
        // Coarse VF: dominant frequency ~4.5-5.5 Hz (270-330/min) that drifts, with waxing and
        // waning amplitude and changing morphology. Deterministic, so it never flickers.
        vf: function (absTime) {
            var t = absTime;
            var amp = 0.62 + 0.38 * Math.sin(0.9 * t + 0.4 * Math.sin(0.23 * t));
            var ph = 2 * Math.PI * 4.9 * t + 1.6 * Math.sin(0.7 * t) + 0.9 * Math.sin(0.31 * t + 1);
            return amp * (21 * Math.sin(ph) + 9 * Math.sin(1.9 * ph + 0.7 + 0.5 * Math.sin(0.5 * t)) + 5 * Math.sin(3.1 * ph + 1.3))
                + 3 * valueNoise(t, 9);
        },
        // Fine VF: smaller (<~0.2 mV) and faster, easily mistaken for asystole at low gain.
        vf_fine: function (absTime) {
            var t = absTime;
            var amp = 0.6 + 0.4 * Math.sin(1.3 * t + 0.6 * Math.sin(0.4 * t));
            var ph = 2 * Math.PI * 6.2 * t + 1.2 * Math.sin(0.9 * t);
            return amp * (5.5 * Math.sin(ph) + 2.5 * Math.sin(2.1 * ph + 0.8)) + 1.2 * valueNoise(t, 12);
        },
        // Asystole: never a ruler-straight line — slow baseline wander and a little filtered noise.
        asystole: function (absTime) { return 0.9 * Math.sin(2 * Math.PI * 0.22 * absTime) + 0.5 * valueNoise(absTime, 6); },
        // Chest compression artefact at ~110/min: a large, fairly sharp deflection per compression
        // with a recoil, riding on a wandering baseline.
        cpr: function (absTime) {
            var c = absTime * 1.83; c = c - Math.floor(c);
            return gs(c, 0.30, 30, 0.07) - gs(c, 0.55, 11, 0.10) + 3 * Math.sin(2 * Math.PI * 0.3 * absTime) + 1.5 * valueNoise(absTime, 15);
        },
        // Atrial flutter sawtooth at a fixed 300/min (5 Hz), dissociated from the ventricular rate.
        flutter_baseline: function (absTime) { return sawtooth(absTime * 5); },
        // AF: coarse-to-fine fibrillatory f waves (~6 Hz, varying size and shape), no P waves.
        af_baseline: function (absTime) {
            var t = absTime;
            var amp = 0.8 + 0.5 * Math.sin(0.8 * t + 0.5 * Math.sin(0.33 * t));
            return amp * (1.6 * Math.sin(2 * Math.PI * 6.1 * t + 1.1 * Math.sin(1.3 * t)) + 0.8 * Math.sin(2 * Math.PI * 8.3 * t + 0.4))
                + 0.5 * valueNoise(t, 20);
        },
        // Dissociated atrial activity for complete heart block: normal P waves at ~75/min, marching
        // through the slower ventricular escape at their own rate.
        chb_p: function (absTime) {
            var period = 60 / 75;
            var x = absTime - Math.floor(absTime / period) * period;
            return gs(x, period / 2, 4.5, 0.022);
        },
        // Filtered baseline: a slow respiratory wander plus a little smooth noise.
        baselineNoise: function (absTime) { return 0.8 * Math.sin(2 * Math.PI * 0.25 * (absTime || 0)) + 0.45 * valueNoise(absTime || 0, 25); }
    };

    // Waveform ids that describe a CYCLE-PHASE shape in the old sense are gone; this object keeps
    // the public name for anything that enumerates the available morphologies.
    var WAVEFORMS = TEMPLATES;

    // -------------------------------------------------------------------------
    // 2. THE REGISTRY
    // shockable        : unsynchronised defibrillation is indicated (pulseless VF/VT only)
    // pulseless        : no cardiac output — obs read zero and arrest physiology applies
    // arrest           : counts as cardiac arrest (identical to pulseless by definition;
    //                    kept as a derived accessor so no caller can reintroduce a
    //                    divergent "is arrest" list)
    // syncCardiovert   : synchronised cardioversion is the correct electrical therapy
    // roscEligible     : a clinically sensible rhythm to convert INTO after ROSC
    // defaultHrRange   : HR the facilitator's rhythm change should land on, if organised
    // -------------------------------------------------------------------------
    var R = [
        { id: 'Sinus Rhythm', label: 'Sinus Rhythm', short: 'NSR', waveform: 'sinus',
          aliases: ['NSR', 'Normal Sinus', 'nsr', 'Sinus', 'Sinus Rhythm (Post-MI)', 'normal_sinus'],
          // A rate band, so converting a tachycardia to sinus rhythm does not leave it at 190/min.
          shockable: false, pulseless: false, syncCardiovert: false, roscEligible: true, defaultHrRange: [65, 95] },

        { id: 'Sinus Tachycardia', label: 'Sinus Tachycardia', short: 'S.TACH', waveform: 'sinus',
          aliases: ['Sinus Tachy', 'sinus_tach', 'Sinus Tach', 'ST'],
          shockable: false, pulseless: false, syncCardiovert: false, roscEligible: true, defaultHrRange: [110, 130] },

        { id: 'Sinus Bradycardia', label: 'Sinus Bradycardia', short: 'S.BRADY', waveform: 'sinus',
          aliases: ['Sinus Brady', 'sinus_brady', 'Sinus Brad'],
          shockable: false, pulseless: false, syncCardiovert: false, roscEligible: true, defaultHrRange: [40, 50] },

        { id: 'AF', label: 'Atrial Fibrillation', short: 'AF', waveform: 'af',
          aliases: ['afib', 'Atrial Fibrillation', 'A Fib', 'AF (fast)'],
          shockable: false, pulseless: false, syncCardiovert: true, roscEligible: true, defaultHrRange: [110, 150] },

        { id: 'Atrial Flutter', label: 'Atrial Flutter', short: 'FLUTTER', waveform: 'flutter',
          aliases: ['aflutter', 'Flutter', 'Atrial flutter'],
          // C3: Atrial Flutter was missing from ROSC_RHYTHMS and had no defib waveform.
          shockable: false, pulseless: false, syncCardiovert: true, roscEligible: true, defaultHrRange: [140, 160] },

        { id: 'SVT', label: 'SVT', short: 'SVT', waveform: 'svt',
          aliases: ['svt', 'Supraventricular Tachycardia', 'AVNRT'],
          shockable: false, pulseless: false, syncCardiovert: true, roscEligible: true, defaultHrRange: [170, 200] },

        { id: 'Junctional', label: 'Junctional Rhythm', short: 'JUNC', waveform: 'junctional',
          aliases: ['junctional', 'Junctional Rhythm', 'Junctional Bradycardia', 'brady'],
          shockable: false, pulseless: false, syncCardiovert: false, roscEligible: true, defaultHrRange: [45, 60] },

        // Ventricular escape: broad, regular, slow, WITH a pulse (a bradycardia, not an arrest).
        // Common after reperfusion and as the escape rhythm when the conducting system fails.
        { id: 'Idioventricular', label: 'Idioventricular Rhythm', short: 'IVR', waveform: 'idioventricular',
          aliases: ['idioventricular', 'IVR', 'Idioventricular Rhythm', 'Ventricular Escape'],
          shockable: false, pulseless: false, syncCardiovert: false, roscEligible: true, defaultHrRange: [30, 40] },

        // VT = VT WITH A PULSE. Electrical therapy is SYNCHRONISED cardioversion, the patient
        // has output, and arrest physiology must NOT apply. This distinction is the whole
        // reason the registry exists.
        { id: 'VT', label: 'VT (with pulse)', short: 'VT', waveform: 'vt',
          aliases: ['Monomorphic VT', 'VT with Pulse', 'vtach', 'VT (with pulse)'],
          shockable: false, pulseless: false, syncCardiovert: true, roscEligible: true, defaultHrRange: [160, 190] },

        { id: 'pVT', label: 'Pulseless VT', short: 'pVT', waveform: 'vt',
          aliases: ['pvt', 'vt_pulseless', 'Pulseless VT', 'VT (Pulseless)', 'VT Pulseless', 'Pulseless Ventricular Tachycardia'],
          shockable: true, pulseless: true, syncCardiovert: false, roscEligible: false, defaultHrRange: null },

        { id: 'VF', label: 'Coarse VF', short: 'VF', waveform: 'vf', realtime: 'vf',
          aliases: ['vf', 'Coarse VF', 'coarse_vf', 'vfib', 'Ventricular Fibrillation', 'VF (coarse)'],
          shockable: true, pulseless: true, syncCardiovert: false, roscEligible: false, defaultHrRange: null },

        { id: 'Fine VF', label: 'Fine VF', short: 'FINE VF', waveform: 'vf_fine', realtime: 'vf_fine',
          aliases: ['fine_vf', 'VF (fine)'],
          shockable: true, pulseless: true, syncCardiovert: false, roscEligible: false, defaultHrRange: null },

        { id: 'PEA', label: 'PEA', short: 'PEA', waveform: 'pea',
          aliases: ['pea', 'Pulseless Electrical Activity', 'EMD'],
          shockable: false, pulseless: true, syncCardiovert: false, roscEligible: false, defaultHrRange: null },

        { id: 'Asystole', label: 'Asystole', short: 'ASYS', waveform: 'asystole', realtime: 'asystole',
          aliases: ['asystole', 'Flatline'],
          shockable: false, pulseless: true, syncCardiovert: false, roscEligible: false, defaultHrRange: null },

        { id: 'Agonal Rhythm', label: 'Agonal Rhythm', short: 'AGONAL', waveform: 'agonal',
          aliases: ['agonal', 'Agonal'],
          shockable: false, pulseless: true, syncCardiovert: false, roscEligible: false, defaultHrRange: null },

        { id: '1st Deg Heart Block', label: '1st Degree Heart Block', short: '1AVB', waveform: 'first_degree',
          aliases: ['1st Deg Block', '1st Degree AV Block', 'first_degree', '1AVB'],
          shockable: false, pulseless: false, syncCardiovert: false, roscEligible: true, defaultHrRange: [60, 75] },

        { id: '2nd Deg Heart Block', label: '2nd Degree Heart Block (Mobitz II)', short: '2AVB', waveform: 'mobitz2',
          aliases: ['2nd Deg Block', 'Mobitz II', 'Mobitz 2', '2nd Degree AV Block'],
          shockable: false, pulseless: false, syncCardiovert: false, roscEligible: true, defaultHrRange: [45, 60] },

        // Drawn as a BROAD ventricular escape (the usual picture at 35-45/min, and the one that
        // needs pacing) with normal P waves marching through it at their own rate.
        { id: 'Complete Heart Block', label: 'Complete Heart Block', short: 'CHB', waveform: 'chb',
          aliases: ['3rd Deg Block', '3rd Degree AV Block', 'CHB', 'chb', 'Third Degree Heart Block'],
          // C3: Complete Heart Block was missing from ROSC_RHYTHMS.
          shockable: false, pulseless: false, syncCardiovert: false, roscEligible: true, defaultHrRange: [35, 45] },

        { id: 'Paced', label: 'Paced Rhythm', short: 'PACED', waveform: 'paced',
          aliases: ['paced', 'Paced Rhythm', 'pacing'],
          shockable: false, pulseless: false, syncCardiovert: false, roscEligible: false, defaultHrRange: null },

        { id: 'STEMI', label: 'STEMI (ST Elevation)', short: 'STEMI', waveform: 'stemi',
          aliases: ['stemi', 'ST Elevation'],
          shockable: false, pulseless: false, syncCardiovert: false, roscEligible: true, defaultHrRange: [90, 110] },

        { id: 'Hyperkalaemia', label: 'Hyperkalaemic ECG', short: 'HIGH K', waveform: 'hyperkalaemia',
          aliases: ['Hyperkalemia', 'hyperkalaemia', 'Hyperkalaemia'],
          shockable: false, pulseless: false, syncCardiovert: false, roscEligible: true, defaultHrRange: [70, 95] },

        { id: 'LBBB', label: 'LBBB', short: 'LBBB', waveform: 'bbb',
          aliases: ['lbbb', 'Left Bundle Branch Block'],
          shockable: false, pulseless: false, syncCardiovert: false, roscEligible: true, defaultHrRange: null },

        { id: 'RBBB', label: 'RBBB', short: 'RBBB', waveform: 'rbbb',
          aliases: ['rbbb', 'Right Bundle Branch Block'],
          shockable: false, pulseless: false, syncCardiovert: false, roscEligible: true, defaultHrRange: null }
    ];

    // -------------------------------------------------------------------------
    // 1b. WAVE 7 — PER-BEAT R-R MODULATION (the irregularity model)
    //
    // The renderers advance a monotonically increasing BEAT PHASE (see data/components.js and
    // defib/index.html). The integer part of that phase is the beat index, so irregularity can be
    // expressed exactly the way it works clinically: as a per-beat multiplier on the R-R interval,
    // decided once for each beat and never revised. That is what makes AF irregularly IRREGULAR
    // rather than "regular with a wobbly baseline" (the pre-Wave-7 behaviour: AF measured a 0.3%
    // R-R coefficient of variation, i.e. metronomic, with only the fibrillatory baseline to hint
    // at the diagnosis), and it is what lets atrial flutter carry variable AV block.
    //
    // The multiplier is a deterministic hash of the beat index, NOT Math.random(), so:
    //   * the same beat always has the same length however many times it is re-evaluated,
    //   * nothing depends on frame rate or on how often the component re-renders,
    //   * verification can assert an exact expected variability.
    // -------------------------------------------------------------------------
    function beatHash(beat, salt) {
        var x = Math.sin((beat + 1) * 12.9898 + (salt || 0) * 78.233) * 43758.5453;
        return x - Math.floor(x);
    }

    // Multiplier applied to the NEXT R-R interval for `rhythmId` at beat `beat`.
    // 1 = perfectly regular. Anything that is supposed to look regular on a real monitor returns
    // exactly 1 and therefore cannot drift.
    function beatIntervalFactor(rhythmId, beat) {
        var id = canonical(rhythmId);
        var b = Math.floor(beat) || 0;
        if (id === 'AF') {
            // Irregularly irregular: a broad spread of intervals PLUS the occasional longer pause,
            // which is what makes AF recognisable at the bedside. CV lands around 18-22%.
            var f = 0.70 + 0.60 * beatHash(b, 1);
            if (beatHash(b, 2) < 0.12) f += 0.35;
            return f;
        }
        if (id === 'Atrial Flutter') {
            // Variable AV block: predominantly 2:1, with intermittent 3:1 and 4:1 beats. The
            // sawtooth underneath keeps running at 300/min regardless (REALTIME.flutter_baseline).
            var h = beatHash(b, 3);
            if (h < 0.60) return 1;
            if (h < 0.88) return 1.5;
            return 2;
        }
        if (id === 'Agonal Rhythm') {
            // Dying heart: wide, slow and grossly irregular.
            return 0.55 + 0.95 * beatHash(b, 4);
        }
        // Everything else — sinus at any rate, SVT, VT, the bundle branch blocks, STEMI,
        // hyperkalaemia, junctional, paced, PEA and complete heart block (whose VENTRICULAR escape
        // is regular; its irregularity is P-QRS dissociation, added in real time) — is regular.
        // Mobitz II is regular between beats and irregular because QRS complexes are DROPPED
        // (see `droppedBeat` below), which is the correct mechanism.
        return 1;
    }

    // Mobitz II drops roughly every 4th conducted beat: the P wave arrives on time, the QRS never
    // comes, and the R-R across the dropped beat is double. Keyed to the BEAT INDEX, so it is
    // correct at every heart rate. (Before Wave 7 it was keyed to `Math.floor(absTime / 1.2)` — a
    // hardcoded 1.2 s that only lined up with the cardiac cycle at exactly 50/min, and at any
    // other rate chopped the middle out of a complex.)
    function droppedBeat(rhythmId, beat) {
        return canonical(rhythmId) === '2nd Deg Heart Block' && (Math.floor(beat) % 4) === 3;
    }

    // -------------------------------------------------------------------------
    // 1c. WAVE 7 — CAPNOGRAPHY, WAVE 8 — SEVERITY-SCALED SHARK FIN
    // A real capnogram is a trapezoid, not a sine wave. Returned in kPa so the plateau can be
    // asserted against the numeric ETCO2 the monitor displays.
    //   phase 0.00-0.06  II   steep expiratory upstroke
    //   phase 0.06-0.62  III  alveolar plateau, slight positive slope, ENDING at ETCO2
    //   phase 0.62-0.72  0    rapid inspiratory downstroke
    //   phase 0.72-1.00  I    inspiratory baseline at zero
    // Patterns: 'normal' | 'bronchospastic' (shark fin) | 'nonobstructive' (an explicit
    // facilitator override that forces severity 0) | 'rebreathing' (baseline fails to reach zero)
    // | 'curare' (curare cleft in the plateau).
    //
    // WAVE 8 / FINDING 1. Wave 7 drew ONE fixed obstructive shape, and live verification measured
    // an upstroke occupying only 5-9% of the breath cycle in every case: the alveolar plateau
    // stayed visibly separate from the upstroke, so even "asthma" read as mild obstruction rather
    // than the shark fin of a silent chest. There is now a single CONTINUOUS shape family
    // parametrised by an obstruction severity 0-1:
    //
    //   * severity 0    -> byte-identical to the Wave 7 normal trapezoid (steep phase II, flat
    //                      slightly-upsloping phase III). Non-obstructive patients are unchanged.
    //   * rising severity pushes the phase II "knee" later, LOWERS the fraction of the ETCO2 that
    //     phase II reaches, slurs the rising limb and curves phase III, so the upstroke and the
    //     plateau progressively merge into one rising limb. Expiration also lengthens, as it does
    //     clinically.
    //   * severity ~1   -> there is no identifiable flat segment anywhere in expiration: one
    //                      continuous slurred rise to a rounded shoulder that only reaches the
    //                      ETCO2 at the very end of expiration. That is the shark fin.
    //
    // Severity is supplied by the engine's existing bronchospasm model (see
    // window.getObstruction in data/engine.js) — it is NOT a parallel piece of state, and it falls
    // as bronchodilators take effect, so treating the patient visibly normalises the trace.
    // -------------------------------------------------------------------------
    var CAPNO_EXP_END = 0.62;        // expiration ends here at severity 0
    var CAPNO_EXP_STRETCH = 0.045;   // severe obstruction prolongs expiration by this much
    var CAPNO_DOWN = 0.10;           // duration of the inspiratory downstroke
    var CAPNO_KNEE0 = 0.06 / CAPNO_EXP_END;   // phase II as a fraction of expiration, severity 0

    // The shape of the capnogram as a continuous function of obstruction severity. Exported so
    // verification measures the SHIPPING parameters rather than a copy of them.
    function capnoShapeParams(severity) {
        var s = Number(severity);
        if (!isFinite(s)) s = 0;
        s = s < 0 ? 0 : (s > 1 ? 1 : s);
        return {
            severity: s,
            expEnd: CAPNO_EXP_END + CAPNO_EXP_STRETCH * s,
            downEnd: CAPNO_EXP_END + CAPNO_EXP_STRETCH * s + CAPNO_DOWN,
            // Phase II as a fraction of expiration: 9.7% normal -> 40% severe.
            kneeFrac: CAPNO_KNEE0 + 0.303 * Math.pow(s, 1.5),
            // Fraction of the ETCO2 reached at the end of phase II: 0.90 normal -> 0.60 severe.
            // This is what destroys the boundary between the two phases — the upstroke stops well
            // short of the plateau level and simply keeps climbing.
            kneeLevel: 0.90 - 0.30 * s * s,
            upstrokeExp: 0.65 + 0.15 * s,    // slurring of the rising limb
            plateauExp: 1.00 - 0.15 * s      // phase III curvature: the rounded fin shoulder
        };
    }

    // Resolve the severity actually used for a (pattern, severity) pair. The facilitator's explicit
    // pattern override wins (Wave 5 facilitator supremacy); an omitted severity keeps the Wave 7
    // behaviour for any caller that has not been updated.
    function capnoSeverity(pattern, severity) {
        if (pattern === 'nonobstructive') return 0;
        var s = Number(severity);
        if (!isFinite(s)) s = (pattern === 'bronchospastic' ? 0.9 : 0);
        if (pattern === 'bronchospastic') s = Math.max(s, 0.15);
        return s < 0 ? 0 : (s > 1 ? 1 : s);
    }

    function capnogram(phase, etco2Kpa, pattern, severity) {
        var E = Number(etco2Kpa);
        if (!isFinite(E) || E <= 0) return 0;
        var t = phase - Math.floor(phase);
        var floorKpa = pattern === 'rebreathing' ? E * 0.14 : 0;   // failure to return to zero
        var P = capnoShapeParams(capnoSeverity(pattern, severity));
        var knee = P.expEnd * P.kneeFrac;
        var y;

        if (t < knee) {                                    // phase II — expiratory upstroke
            y = floorKpa + (E * P.kneeLevel - floorKpa) * Math.pow(t / knee, P.upstrokeExp);
        } else if (t < P.expEnd) {                         // phase III — alveolar plateau / fin
            var x = (t - knee) / (P.expEnd - knee);
            y = E * P.kneeLevel + E * (1 - P.kneeLevel) * Math.pow(x, P.plateauExp);  // ends at E
            if (pattern === 'curare' && t > 0.30 && t < 0.40) {
                y -= E * 0.28 * Math.sin((t - 0.30) / 0.10 * Math.PI);   // curare cleft
            }
        } else if (t < P.downEnd) {                        // phase 0 — inspiratory downstroke
            y = floorKpa + (E - floorKpa) * (1 - (t - P.expEnd) / CAPNO_DOWN);
        } else {                                           // phase I — inspiratory baseline
            y = floorKpa;
        }
        return Math.max(0, y);
    }

    var BY_ID = {};
    var ALIAS = {};
    R.forEach(function (r) {
        BY_ID[r.id] = r;
        ALIAS[r.id] = r.id;
        ALIAS[r.id.toLowerCase()] = r.id;
        (r.aliases || []).forEach(function (a) {
            ALIAS[a] = r.id;
            ALIAS[a.toLowerCase()] = r.id;
        });
    });

    var warned = {};
    function canonical(name) {
        if (name === null || name === undefined) return 'Sinus Rhythm';
        var key = String(name).trim();
        if (ALIAS[key]) return ALIAS[key];
        if (ALIAS[key.toLowerCase()]) return ALIAS[key.toLowerCase()];
        if (!warned[key]) {
            warned[key] = true;
            // Loud, not silent: an unknown rhythm previously fell through to a NORMAL trace.
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('RHYTHMS: unknown rhythm "' + key + '" — add it (or an alias) to data/rhythms.js. Falling back to Sinus Rhythm.');
            }
        }
        return 'Sinus Rhythm';
    }

    function entry(name) { return BY_ID[canonical(name)]; }
    function isKnown(name) {
        if (name === null || name === undefined) return false;
        var key = String(name).trim();
        return !!(ALIAS[key] || ALIAS[key.toLowerCase()]);
    }

    // The ONLY shockability predicate in the application.
    function isShockable(name) { return !!entry(name).shockable; }
    // The ONLY pulseless predicate. inArrest is defined as identical to pulseless so the
    // two can never drift the way the old seven lists did.
    function isPulseless(name) { return !!entry(name).pulseless; }
    function inArrest(name) { return isPulseless(name); }
    function isRoscEligible(name) { return !!entry(name).roscEligible; }
    function isSyncCardiovertible(name) { return !!entry(name).syncCardiovert; }
    function labelFor(name) { return entry(name).label; }
    function shortFor(name) { return entry(name).short; }
    function waveformFor(name) { return entry(name).waveform; }
    function realtimeFor(name) { return entry(name).realtime || null; }
    function defaultHrRange(name) { return entry(name).defaultHrRange || null; }

    // Every canonical identifier, and the derived lists the UI menus consume. Menus must read
    // these rather than hardcoding their own arrays.
    var ALL_IDS = R.map(function (r) { return r.id; });
    var SHOCKABLE_IDS = R.filter(function (r) { return r.shockable; }).map(function (r) { return r.id; });
    var PULSELESS_IDS = R.filter(function (r) { return r.pulseless; }).map(function (r) { return r.id; });
    var ROSC_IDS = R.filter(function (r) { return r.roscEligible; }).map(function (r) { return r.id; });
    var SYNC_IDS = R.filter(function (r) { return r.syncCardiovert; }).map(function (r) { return r.id; });
    // Rhythms offered in the facilitator's general "change rhythm" grid.
    var SELECTABLE_IDS = ALL_IDS.slice();
    // Rhythms offered in the ARREST menu — pulseless only, by definition.
    var ARREST_IDS = PULSELESS_IDS.slice();

    // -------------------------------------------------------------------------
    // 3. THE SHARED EVALUATOR
    // Every renderer calls this. `cyclePhase` is the position in the current beat [0,1) from the
    // caller's phase accumulator, `absTime` is seconds of animation time (used by the chaotic and
    // dissociated parts). opts:
    //   beat  - integer beat index from the phase accumulator (per-beat irregularity, dropped beats)
    //   hr    - the BASE rate the caller is drawing at (bpm); the beat's own R-R also includes
    //           beatIntervalFactor. Converts the phase into seconds so complexes keep real widths.
    //   lead  - 'I' | 'II' | 'III' | 'aVR' | 'aVL' | 'aVF' | 'V1'..'V6' | 'PADS' (default II)
    //   cpr   - chest compressions in progress (compression artefact dominates)
    //   noise - false for a deterministic, noise-free sample (verification, the 12-lead)
    //   st    - ST shift in display units for THIS lead (the 12-lead's STEMI territories)
    // Neighbouring beats are summed as well, so a T wave that runs into the next beat at a fast
    // rate, or a P wave that starts before its beat, is drawn continuously.
    // -------------------------------------------------------------------------
    function beatRr(id, hr, beat) {
        var base = 60 / clampNum(Number(hr) > 0 ? Number(hr) : 60, 10, 350);
        var f = beatIntervalFactor(id, beat);
        return base * (f > 0 ? f : 1);
    }
    // Where the R peak sits within its beat, in seconds from the start of the beat. P waves need
    // ~0.25 s in front of the QRS; at fast rates the complex is centred instead.
    function rAnchor(rr) { return Math.min(0.25, rr * 0.5); }

    function complexValue(id, r, t, rr, beat, lead, st) {
        var fn = TEMPLATES[r.waveform] || TEMPLATES.sinus;
        if (droppedBeat(id, beat)) {
            // Mobitz II: the P wave arrives on time and the QRS never comes.
            var p = narrowParts(t, rr, {});
            return p.P * (LEAD_PARTS[lead] || LEAD_PARTS.II).P;
        }
        var v = fn(t, rr);
        if (typeof v === 'number') return v * (LEAD_GAIN[lead] === undefined ? 1 : LEAD_GAIN[lead]);
        return sumParts(v, lead, st === undefined ? undefined : st);
    }

    function ecgValue(cyclePhase, absTime, rhythmName, opts) {
        opts = opts || {};
        var lead = opts.lead || 'II';
        var noiseOn = opts.noise !== false;
        var id = canonical(rhythmName);
        var r = BY_ID[id];
        var y;

        if (r.realtime && REALTIME[r.realtime]) {
            var g = LEAD_GAIN[lead] === undefined ? 1 : Math.abs(LEAD_GAIN[lead]);
            y = REALTIME[r.realtime](absTime) * g;
        } else {
            var beat = (opts.beat !== undefined && opts.beat !== null) ? Math.floor(opts.beat) : 0;
            var rrB = beatRr(id, opts.hr, beat);
            var rrPrev = beatRr(id, opts.hr, beat - 1);
            var rrNext = beatRr(id, opts.hr, beat + 1);
            var t = (cyclePhase - Math.floor(cyclePhase)) * rrB;         // seconds into this beat
            y = complexValue(id, r, t - rAnchor(rrB), rrB, beat, lead, opts.st)
              + complexValue(id, r, t + rrPrev - rAnchor(rrPrev), rrPrev, beat - 1, lead, opts.st)
              + complexValue(id, r, t - rrB - rAnchor(rrNext), rrNext, beat + 1, lead, opts.st);
            var lp = (LEAD_PARTS[lead] || LEAD_PARTS.II).P;
            if (r.waveform === 'af') y += REALTIME.af_baseline(absTime) * Math.abs(lp || 0.5);
            if (r.waveform === 'flutter') y += REALTIME.flutter_baseline(absTime) * (lead === 'V1' ? 0.6 : Math.abs(LEAD_GAIN[lead] || 1));
            if (r.waveform === 'chb') y += REALTIME.chb_p(absTime) * lp;
        }
        // Chest compressions swamp the trace; the underlying rhythm shows through faintly.
        if (opts.cpr) y = REALTIME.cpr(absTime) + y * 0.25;
        return y + (noiseOn ? REALTIME.baselineNoise(absTime) : 0);
    }

    // Phase (0-1) of the R peak within beat `beat`, or null when there is no R wave to find
    // (VF, asystole) or the beat is dropped. Used for SYNC markers and synchronised shocks.
    function rWavePhase(rhythmName, hr, beat) {
        var id = canonical(rhythmName);
        var r = BY_ID[id];
        if (r.realtime) return null;
        var b = Math.floor(beat || 0);
        if (droppedBeat(id, b)) return null;
        var rr = beatRr(id, hr, b);
        return rAnchor(rr) / rr;
    }

    // ---- PULSE WAVEFORMS (pleth and arterial line), beat by beat.
    // Each beat's pulse is a time-shifted, real-duration shape that starts a pulse-transit time
    // after its R wave, so a pulse follows every QRS at any rate (and none follows a dropped beat).
    // Beat-to-beat filling is modelled: after a short R-R the next pulse is smaller, so AF shows
    // the variable pulse volume (and pulse deficit) seen at the bedside.
    function plethShape(x) {                       // x = seconds from the pulse foot
        if (x < 0) return 0;
        if (x < 0.13) { var u = x / 0.13; return 20 * Math.pow(Math.sin(u * Math.PI / 2), 1.6); }
        var y = 20 * Math.exp(-(x - 0.13) / 0.30);
        return y - gs(x, 0.33, 2.2, 0.02) + gs(x, 0.39, 1.6, 0.035);
    }
    function artShape(x) {                         // radial arterial pressure pulse above diastole
        if (x < 0) return 0;
        if (x < 0.09) { var u = x / 0.09; return 26 * (1 - Math.pow(1 - u, 2.4)); }
        var y = 26 * Math.exp(-(x - 0.09) / 0.26);
        return y - gs(x, 0.30, 3.5, 0.015) + gs(x, 0.34, 3.2, 0.03);
    }
    function pulseValue(kind, cyclePhase, rhythmName, opts) {
        opts = opts || {};
        var id = canonical(rhythmName);
        var r = BY_ID[id];
        if (r.realtime) return 0;
        var shape = kind === 'art' ? artShape : plethShape;
        var transit = kind === 'art' ? 0.12 : 0.22;
        var beat = Math.floor(opts.beat || 0);
        var baseRr = 60 / clampNum(Number(opts.hr) > 0 ? Number(opts.hr) : 60, 10, 350);
        var t = (cyclePhase - Math.floor(cyclePhase)) * beatRr(id, opts.hr, beat);
        var y = 0, offset = 0;
        // This beat and the three before it (their pulses' tails), relative to this beat's start.
        for (var k = 0; k >= -3; k--) {
            var b = beat + k;
            if (k < 0) offset += beatRr(id, opts.hr, b);
            if (droppedBeat(id, b)) continue;
            var rr = beatRr(id, opts.hr, b);
            var fill = clampNum(Math.pow(beatRr(id, opts.hr, b - 1) / baseRr, 1.5), 0.3, 1.3);
            y += fill * shape(t + offset - rAnchor(rr) - transit);
        }
        return y;
    }

    // -------------------------------------------------------------------------
    // 4. PAEDIATRIC / WEIGHT-BASED DEFIBRILLATION ENERGY (C4)
    // RCUK: 4 J/kg for paediatric defibrillation. The standalone defib hardcoded
    // [50,70,85,100,120,150,170,200] and defaulted to 120 J for a 3.5 kg neonate.
    // -------------------------------------------------------------------------
    // The ZOLL R Series biphasic selections (the device this app simulates): 1-10 J in 1 J steps,
    // then 15, 20, 30, 50, 75, 100, 120, 150 and a 200 J maximum. 250-360 J do not exist on a
    // biphasic ZOLL.
    var ADULT_ENERGY_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30, 50, 75, 100, 120, 150, 200];
    var ADULT_DEFAULT_ENERGY = 150;

    // Children: 4 J/kg (RCUK), rounded to the nearest selection the device actually offers.
    function nearestStep(j) {
        var best = ADULT_ENERGY_STEPS[0];
        ADULT_ENERGY_STEPS.forEach(function (s) { if (Math.abs(s - j) < Math.abs(best - j) || (Math.abs(s - j) === Math.abs(best - j) && s > best)) best = s; });
        return best;
    }
    function recommendedEnergy(weightKg, ageYears) {
        if (isAdult(weightKg, ageYears)) return ADULT_DEFAULT_ENERGY;
        return Math.min(ADULT_DEFAULT_ENERGY, nearestStep(Math.max(1, Number(weightKg) * 4)));
    }

    // The device offers the same selections for every patient; the recommended one differs.
    function energySteps() {
        return ADULT_ENERGY_STEPS.slice();
    }

    // Permissive by design (Wave 1 philosophy): a wrong energy is never blocked, it is FLAGGED.
    // Returns null when the energy is acceptable, or a description when it is not.
    function energyDeviation(joules, weightKg, ageYears) {
        var j = Number(joules);
        var expected = recommendedEnergy(weightKg, ageYears);
        if (!isFinite(j) || j <= 0) return { expected: expected, given: joules, reason: 'no energy selected' };
        var ratio = j / expected;
        if (ratio > 1.5) return { expected: expected, given: j, reason: 'energy too high (' + j + ' J vs recommended ' + expected + ' J)' };
        if (ratio < 0.6) return { expected: expected, given: j, reason: 'energy too low (' + j + ' J vs recommended ' + expected + ' J)' };
        return null;
    }

    // An ADEQUATE shock for the fixed-count shock-response settings: at least 150 J (adult) or
    // 3 J/kg (child) to defibrillate; synchronised and at least 70 J (adult) or 1 J/kg (child) to
    // cardiovert. Anything less still counts as a delivered shock but cannot convert the rhythm.
    function isAdult(weightKg, ageYears) {
        var w = Number(weightKg);
        return !isFinite(w) || w <= 0 || w >= 40 || (isFinite(Number(ageYears)) && Number(ageYears) >= 16);
    }
    function adequateShock(joules, weightKg, ageYears, kind) {
        var j = Number(joules);
        if (!isFinite(j) || j <= 0) return false;
        var adult = isAdult(weightKg, ageYears);
        if (kind === 'cardiovert') return adult ? j >= 70 : j >= Math.max(1, Number(weightKg) * 1);
        return adult ? j >= 150 : j >= Math.max(1, Number(weightKg) * 3);
    }

    // Rhythms transcutaneous pacing can capture (slow rhythms with ventricles that respond).
    var PACEABLE = ['Sinus Bradycardia', 'Junctional', 'Idioventricular', '1st Deg Heart Block',
        '2nd Deg Heart Block', 'Complete Heart Block'];

    // How well a heart-rate-raising drug works in each rhythm (1 = full effect, the default).
    // Atropine acts on the sinus and AV nodes, so it helps sinus bradycardia and nodal block but
    // does little for block below the AV node (broad-complex complete heart block, Mobitz II) or a
    // ventricular escape. Isoprenaline and adrenaline raise the escape rate as well, which is why
    // they are the bridge to pacing when atropine fails.
    var DRUG_HR_RESPONSE = {
        Atropine: { 'Complete Heart Block': 0.15, '2nd Deg Heart Block': 0.4, 'Idioventricular': 0.1, 'Junctional': 0.8 },
        Isoprenaline: { 'Complete Heart Block': 1, '2nd Deg Heart Block': 1, 'Idioventricular': 0.9 },
        AdrenalineInfusion: { 'Complete Heart Block': 0.9, 'Idioventricular': 0.8 }
    };
    function drugHrResponse(key, rhythmName) {
        var t = DRUG_HR_RESPONSE[key];
        var v = t ? t[canonical(rhythmName)] : undefined;
        return typeof v === 'number' ? v : 1;
    }

    // -------------------------------------------------------------------------
    // 5. DRUG-MEDIATED CONVERSION (C6 — `changeRhythm: 'chance'` was UNHANDLED, so
    // Adrenaline IV and Amiodarone changed literally nothing).
    // chance = probability of conversion on administration; to = resulting rhythm.
    // shockBonus = additive bonus applied to the NEXT defibrillation attempt (the real
    // mechanism for adrenaline/amiodarone in a shockable arrest).
    // -------------------------------------------------------------------------
    var DRUG_CONVERSION = {
        AdrenalineIV: {
            'VF':      { chance: 0.00, shockBonus: 0.10 },
            'Fine VF': { chance: 0.00, shockBonus: 0.10 },
            'pVT':     { chance: 0.00, shockBonus: 0.10 },
            // In a non-shockable arrest adrenaline does not convert the rhythm on injection; it
            // improves the chance of ROSC at the following rhythm checks (see the engine).
            'PEA':     { chance: 0.00 },
            'Asystole':{ chance: 0.00 }
        },
        Amiodarone: {
            'VF':      { chance: 0.05, to: 'Sinus Rhythm', shockBonus: 0.12 },
            'Fine VF': { chance: 0.05, to: 'Sinus Rhythm', shockBonus: 0.12 },
            'pVT':     { chance: 0.10, to: 'Sinus Rhythm', shockBonus: 0.12 },
            'VT':      { chance: 0.35, to: 'Sinus Rhythm' },
            'AF':      { chance: 0.20, to: 'Sinus Rhythm' }
        },
        Adenosine: {
            'SVT':     { chance: 0.65, to: 'Sinus Rhythm' },
            'Atrial Flutter': { chance: 0.05, to: 'Atrial Flutter' }
        },
        Atropine: {
            'Sinus Bradycardia': { chance: 0.70, to: 'Sinus Rhythm' },
            '2nd Deg Heart Block': { chance: 0.20, to: 'Sinus Rhythm' },
            'Complete Heart Block': { chance: 0.05, to: 'Sinus Rhythm' }
        },
        MagSulph: {
            'VT':  { chance: 0.45, to: 'Sinus Rhythm' },
            'pVT': { chance: 0.15, to: 'Sinus Rhythm' }
        }
    };

    // -------------------------------------------------------------------------
    // 6. SHOCK OUTCOME TABLE (C7). Rhythm-appropriate, energy-sensitive outcomes with
    // refibrillation, instead of "ROSC is always exactly Sinus Rhythm".
    // Weights are relative, sampled only when the ROSC roll FAILS to produce ROSC, or
    // when it succeeds (roscOutcomes).
    // -------------------------------------------------------------------------
    var SHOCK_OUTCOMES = {
        'VF': {
            rosc:   [['Sinus Rhythm', 5], ['Sinus Tachycardia', 4], ['AF', 1], ['Sinus Bradycardia', 1]],
            noRosc: [['VF', 12], ['Fine VF', 3], ['Asystole', 2], ['PEA', 2]],
            refibChance: 0.18
        },
        'Fine VF': {
            rosc:   [['Sinus Rhythm', 3], ['Sinus Tachycardia', 3], ['Sinus Bradycardia', 1]],
            noRosc: [['Fine VF', 10], ['Asystole', 5], ['PEA', 3]],
            refibChance: 0.22
        },
        'pVT': {
            rosc:   [['Sinus Rhythm', 5], ['Sinus Tachycardia', 4], ['VT', 1]],
            noRosc: [['pVT', 10], ['VF', 4], ['Asystole', 1], ['PEA', 1]],
            refibChance: 0.15
        }
    };

    function weightedPick(pairs, rnd) {
        var total = 0, i;
        for (i = 0; i < pairs.length; i++) total += pairs[i][1];
        var x = (typeof rnd === 'number' ? rnd : Math.random()) * total;
        for (i = 0; i < pairs.length; i++) { x -= pairs[i][1]; if (x <= 0) return pairs[i][0]; }
        return pairs[pairs.length - 1][0];
    }

    // -------------------------------------------------------------------------
    // PUBLIC API
    // =========================================================================================
    // THE 12-LEAD, DRAWN FROM THE SAME RHYTHM REGISTRY AS THE MONITOR.
    // It used to draw one fixed sinus complex for EVERY rhythm (only STEMI changed it), so VF, AF,
    // heart block or hyperkalaemia on the monitor produced a normal 12-lead — the two screens
    // contradicted each other. Now it is a 10-second recording laid out the standard way (four
    // 2.5 s columns x three rows, then a 10 s lead II rhythm strip) at 25 mm/s and 10 mm/mV,
    // sampled from RHYTHMS.ecgValue with the same phase accumulation, beat irregularity (AF,
    // variable flutter, agonal) and dropped beats (Mobitz II) the live trace uses.
    // Per-lead morphology is an approximation by lead gain/polarity (aVR inverted, V1 mostly
    // negative, R-wave progression across V2-V6); STEMI draws its ST elevation only in the
    // territory's leads with reciprocal depression. It prints NO rhythm interpretation — reading
    // it is the team's job.
    // =========================================================================================
    const TWELVE_LEAD_LAYOUT = [['I', 'aVR', 'V1', 'V4'], ['II', 'aVL', 'V2', 'V5'], ['III', 'aVF', 'V3', 'V6']];
    // STEMI territory -> [leads with ST elevation, leads with reciprocal depression]
    const STEMI_TERRITORY = {
        anterior: [['V1', 'V2', 'V3', 'V4'], ['II', 'III', 'aVF']],
        inferior: [['II', 'III', 'aVF'], ['I', 'aVL']],
        lateral:  [['I', 'aVL', 'V5', 'V6'], ['II', 'III', 'aVF']]
    };
    const stemiTerritoryFor = (scenario) => {
        const txt = [scenario?.ecg?.findings, scenario?.investigations?.ecg?.findings, scenario?.title, scenario?.presentingComplaint]
            .filter(Boolean).join(' ').toLowerCase();
        if (/inferior|ii, iii|avf/.test(txt)) return 'inferior';
        if (/lateral|v5|v6|avl/.test(txt)) return 'lateral';
        return 'anterior';
    };

    function render12Lead(canvas, rhythm, scenario, hr) {
        if (!canvas) return;
        if (hr === undefined || hr === null) hr = 75;
        try {
            const RG = window.RHYTHMS;
            const ctx = canvas.getContext('2d');
            const w = canvas.width, h = canvas.height;
            const pxPerSec = w / 10;                 // 10 s across the page = 25 mm/s
            const small = pxPerSec * 0.04;           // 1 mm small square
            const pxPerUnit = (small * 10) / 40;     // registry units: ~40 = 1 mV (10 mm)

            ctx.fillStyle = 'white'; ctx.fillRect(0, 0, w, h);
            ctx.lineWidth = 1; ctx.strokeStyle = '#ffd6d6'; ctx.beginPath();
            for (let x = 0; x <= w; x += small) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
            for (let y = 0; y <= h; y += small) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
            ctx.stroke();
            ctx.strokeStyle = '#ff9f9f'; ctx.beginPath();
            for (let x = 0; x <= w; x += small * 5) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
            for (let y = 0; y <= h; y += small * 5) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
            ctx.stroke();

            // ---- one 10 s recording, sampled once and shared by every lead (a real 12-lead is
            // simultaneous; the columns are consecutive 2.5 s windows of the same recording).
            // Each lead is drawn from the registry's per-lead morphology (LEAD_PARTS / LEAD_GAIN),
            // so aVR is inverted, V1 is rS, and R waves progress across the chest leads.
            const rid = RG.canonical(rhythm);
            const INTRINSIC = { 'PEA': 38, 'Agonal Rhythm': 14, 'pVT': 180, 'Paced': 70 };
            const rateBpm = hr > 0 ? hr : (INTRINSIC[rid] || 60);
            const N = Math.round(w);                 // one sample per pixel across 10 s
            const phase = new Float64Array(N), beat = new Int32Array(N);
            let ph = 0; let beats = 0;
            for (let i = 0; i < N; i++) {
                phase[i] = ph - Math.floor(ph); beat[i] = Math.floor(ph);
                const f = RG.beatIntervalFactor ? RG.beatIntervalFactor(rid, Math.floor(ph)) : 1;
                const next = ph + (10 / N) * (rateBpm / 60) / (f > 0 ? f : 1);
                if (Math.floor(next) !== Math.floor(ph) && !(RG.droppedBeat && RG.droppedBeat(rid, Math.floor(ph)))) beats++;
                ph = next;
            }
            const baseWave = RG.waveformFor(rid);
            const scenarioStemi = scenario && (scenario?.ecg?.type === 'STEMI' || scenario?.investigations?.ecg?.type === 'STEMI');
            const isStemi = baseWave === 'stemi' || (scenarioStemi && ['sinus', 'svt'].indexOf(baseWave) !== -1);
            const terr = isStemi ? STEMI_TERRITORY[stemiTerritoryFor(scenario)] : null;
            const sample = (i, lead) => {
                const t = i * 10 / N;
                if (!isStemi) return RG.ecgValue(phase[i], t, rhythm, { beat: beat[i], hr: rateBpm, lead, noise: false });
                // ST elevation in the territory's leads, reciprocal depression opposite, none elsewhere.
                const st = terr[0].indexOf(lead) !== -1 ? 9 : (terr[1].indexOf(lead) !== -1 ? -4 : 0);
                return RG.ecgValue(phase[i], t, 'STEMI', { beat: beat[i], hr: rateBpm, lead, noise: false, st });
            };

            const rows = 4, rowH = h / rows, colW = w / 4;
            ctx.strokeStyle = '#111'; ctx.lineWidth = 1.2; ctx.lineJoin = 'round';
            ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#111';
            const trace = (lead, x0, x1, midY) => {
                ctx.beginPath();
                for (let x = Math.floor(x0); x < Math.min(N, Math.floor(x1)); x++) {
                    const y = midY - sample(x, lead) * pxPerUnit;
                    if (x === Math.floor(x0)) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                }
                ctx.stroke();
                ctx.fillText(lead, x0 + 6, midY - rowH * 0.32);
            };
            TWELVE_LEAD_LAYOUT.forEach((row, r) => row.forEach((lead, c) => {
                const x0 = c * colW;
                trace(lead, x0, x0 + colW, r * rowH + rowH * 0.55);
                if (c > 0) { ctx.beginPath(); ctx.moveTo(x0, r * rowH + rowH * 0.35); ctx.lineTo(x0, r * rowH + rowH * 0.75); ctx.stroke(); }
            }));
            trace('II', 0, w, 3 * rowH + rowH * 0.5);

            // No organised ventricular rate to report for chaotic / absent activity (VF, asystole).
            const rate = RG.realtimeFor(rid) ? '--' : Math.round(beats * 6);
            ctx.font = '13px monospace'; ctx.fillStyle = '#111';
            ctx.fillText(`ID: ${scenario && scenario.patientName ? scenario.patientName : 'UNKNOWN'}   ${new Date().toLocaleDateString('en-GB')}   25 mm/s  10 mm/mV   Vent. rate ${rate} bpm`, 10, h - 8);
        } catch (e) {
            console.error("12-Lead Render Error", e);
        }
    }


    // -------------------------------------------------------------------------
    window.RHYTHMS = {
        registry: R,
        byId: BY_ID,
        aliasMap: ALIAS,
        ALL: ALL_IDS,
        SHOCKABLE: SHOCKABLE_IDS,
        PULSELESS: PULSELESS_IDS,
        ARREST: ARREST_IDS,
        ROSC: ROSC_IDS,
        SYNC: SYNC_IDS,
        SELECTABLE: SELECTABLE_IDS,
        canonical: canonical,
        entry: entry,
        isKnown: isKnown,
        isShockable: isShockable,
        isPulseless: isPulseless,
        inArrest: inArrest,
        isRoscEligible: isRoscEligible,
        isSyncCardiovertible: isSyncCardiovertible,
        labelFor: labelFor,
        shortFor: shortFor,
        waveformFor: waveformFor,
        realtimeFor: realtimeFor,
        defaultHrRange: defaultHrRange,
        waveforms: WAVEFORMS,
        realtime: REALTIME,
        ecgValue: ecgValue,
        rWavePhase: rWavePhase,
        pulseValue: pulseValue,
        LEADS: ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'PADS'],
        // WAVE 7 — shared by the React monitor AND the standalone defibrillator.
        beatIntervalFactor: beatIntervalFactor,
        droppedBeat: droppedBeat,
        beatHash: beatHash,
        capnogram: capnogram,
        // WAVE 8: the capnogram shape family, exported so the obstruction severity that drives it
        // has exactly one definition and verification measures the shipping parameters.
        capnoShapeParams: capnoShapeParams,
        capnoSeverity: capnoSeverity,
        // Rhythms whose R-R is MEANT to vary. Verification reads this list rather than keeping its
        // own copy, so "which rhythms are irregular" has one definition like everything else here.
        IRREGULAR: ['AF', 'Atrial Flutter', '2nd Deg Heart Block', 'Agonal Rhythm'],
        ADULT_ENERGY_STEPS: ADULT_ENERGY_STEPS,
        ADULT_DEFAULT_ENERGY: ADULT_DEFAULT_ENERGY,
        recommendedEnergy: recommendedEnergy,
        energySteps: energySteps,
        energyDeviation: energyDeviation,
        DRUG_CONVERSION: DRUG_CONVERSION,
        SHOCK_OUTCOMES: SHOCK_OUTCOMES,
        weightedPick: weightedPick,
        isAdult: isAdult,
        adequateShock: adequateShock,
        PACEABLE: PACEABLE,
        DRUG_HR_RESPONSE: DRUG_HR_RESPONSE,
        drugHrResponse: drugHrResponse,
        // The 12-lead recording, shared by the React monitor and the standalone defibrillator.
        render12Lead: render12Lead
    };

    // Back-compat shim for the standalone defib page, which called a bare global.
    window.getECGValue = function (t, pT, absoluteTime, type, pathology, cpr) {
        return ecgValue(t, absoluteTime, type, { cpr: cpr });
    };

    // Node/verification harness support.
    if (typeof module !== 'undefined' && module.exports) module.exports = window.RHYTHMS;
})();
