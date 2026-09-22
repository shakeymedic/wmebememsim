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
    // 1. WAVEFORM PRIMITIVES
    // Cycle-normalised generators: f(t) with t in [0,1] across one cardiac cycle.
    // Amplitudes are in the same arbitrary display units both renderers already used
    // (R wave of a normal sinus complex ~= +45).
    // -------------------------------------------------------------------------
    var g = function (t, centre, amp, width) { return amp * Math.exp(-Math.pow(t - centre, 2) / width); };

    var pWave = function (t) { return g(t, 0.10, 4.5, 0.0015); };
    var qrsNarrow = function (t) {
        return g(t, 0.170, -6, 0.00030) + g(t, 0.205, 45, 0.00020) + g(t, 0.240, -14, 0.00030);
    };
    var tWave = function (t) { return g(t, 0.42, 9, 0.009); };

    // Wide, bizarre ventricular complex (VT / pulseless VT).
    var qrsVentricular = function (t) { return g(t, 0.20, 38, 0.0050) + g(t, 0.32, -22, 0.0040); };

    // PEA: electrical activity WITHOUT mechanical output. Clinically this is typically a
    // slow, broad, low-amplitude complex with no discernible P wave — NOT a normal sinus
    // complex. Rendering PEA as sinus at 150 bpm (the pre-Wave-3 behaviour in 9 scenarios)
    // taught students that a perfusing trace can accompany a pulseless patient.
    var qrsPEA = function (t) {
        return g(t, 0.18, -4, 0.0030) + g(t, 0.26, 16, 0.0045) + g(t, 0.38, -7, 0.0060) + g(t, 0.60, 4, 0.020);
    };

    // Agonal: very wide, very slow, single bizarre deflection, essentially no T wave.
    var qrsAgonal = function (t) { return g(t, 0.30, 13, 0.0120) + g(t, 0.52, -6, 0.0150); };

    // Paced: sharp pacing spike followed by a wide, LBBB-like paced complex and
    // discordant T. Previously existed only on the standalone defib — the React monitor
    // had no paced waveform at all, so transcutaneous pacing showed nothing.
    var qrsPaced = function (t) {
        return g(t, 0.150, 30, 0.000035)                       // pacing spike (very narrow, tall)
            + g(t, 0.205, -30, 0.0018)                         // wide negative paced QRS
            + g(t, 0.300, 10, 0.0030)
            + g(t, 0.470, 11, 0.0140);                         // discordant (positive) T
    };

    // Sawtooth flutter baseline at 2:1 conduction (2 flutter waves per ventricular cycle).
    var flutterBaseline = function (t) {
        var fp = (t * 2) % 1;
        if (fp < 0.18) return 4 - fp * 45;
        return -4 + ((fp - 0.18) / 0.82) * 8;
    };

    // Hyperkalaemia: broad QRS with tall tented T waves.
    var qrsHyperK = function (t) {
        return g(t, 0.170, -6, 0.0012) + g(t, 0.205, 40, 0.0011) + g(t, 0.250, -14, 0.0012) + g(t, 0.44, 26, 0.0060);
    };

    // Bundle branch block: wide notched QRS.
    var qrsWide = function (t) {
        return g(t, 0.165, -6, 0.0010) + g(t, 0.200, 38, 0.0011) + g(t, 0.235, 24, 0.0011) + g(t, 0.270, -12, 0.0012) + g(t, 0.45, -8, 0.0100);
    };

    // STEMI: sinus complex with a raised, coved ST segment.
    var stemiComplex = function (t) {
        var st = (t > 0.25 && t < 0.42) ? 10 : 0;
        return pWave(t) + qrsNarrow(t) + st + g(t, 0.44, 14, 0.010);
    };

    // WAVEFORM DICTIONARY — cycle-phase shapes. Keyed by waveform id, NOT rhythm name, so
    // several rhythms (e.g. VT and pulseless VT) can legitimately share one morphology.
    var WAVEFORMS = {
        sinus:        function (t) { return pWave(t) + qrsNarrow(t) + tWave(t); },
        svt:          function (t) { return qrsNarrow(t) + tWave(t) * 0.85; },
        junctional:   function (t) { return qrsNarrow(t) + tWave(t) * 0.9; },
        first_degree: function (t) { return pWave(t) + qrsNarrow(t - 0.10) + tWave(t - 0.10); },
        // Mobitz II: intermittently dropped QRS after a constant PR. The dropped beat is
        // produced in real time (see REALTIME.mobitz_drop) so the pattern is not frozen.
        mobitz2:      function (t) { return pWave(t) + qrsNarrow(t) + tWave(t); },
        // Complete heart block carries the slow ventricular escape only; the dissociated
        // atrial P waves are added in real time so AV dissociation visibly drifts.
        chb:          function (t) { return qrsNarrow(t) + tWave(t); },
        flutter:      function (t) { return flutterBaseline(t) + qrsNarrow(t) + tWave(t) * 0.35; },
        // AF has no organised P wave; the fibrillatory baseline is added in real time.
        af:           function (t) { return qrsNarrow(t) + tWave(t) * 0.85; },
        vt:           function (t) { return qrsVentricular(t); },
        pea:          qrsPEA,
        agonal:       qrsAgonal,
        paced:        qrsPaced,
        stemi:        stemiComplex,
        hyperkalaemia: function (t) { return pWave(t) * 0.4 + qrsHyperK(t); },
        // LBBB: broad, notched, monophasic wide QRS with discordant T.
        bbb:          function (t) {
            var y = pWave(t) + qrsWide(t);
            if (t > 0.30 && t < 0.42) y -= 6 * Math.sin((t - 0.30) / 0.12 * Math.PI);   // the notch
            return y;
        },
        // RBBB: rSR' in a right-sided lead — a second, later positive deflection with a slurred
        // terminal S, which is what actually distinguishes it from LBBB at the bedside.
        rbbb:         function (t) {
            var y = pWave(t) + qrsWide(t) * 0.75;
            if (t > 0.33 && t < 0.44) y += 26 * Math.sin((t - 0.33) / 0.11 * Math.PI);   // R'
            if (t > 0.44 && t < 0.56) y -= 7 * Math.sin((t - 0.44) / 0.12 * Math.PI);    // slurred S
            return y;
        }
    };

    // REALTIME WAVEFORMS — driven by absolute time rather than cardiac cycle phase, because
    // they are either chaotic (VF), flat (asystole) or dissociated from the ventricular rate.
    var REALTIME = {
        vf: function (absTime) {
            var ampMod = 0.65 + 0.45 * Math.sin(absTime * 1.7);
            return (Math.sin(absTime * 13.2) * 20 + Math.sin(absTime * 25.6 + 1.3) * 13 + Math.sin(absTime * 41.7 + 2.4) * 7) * ampMod
                + (Math.random() - 0.5) * 6;
        },
        vf_fine: function (absTime) {
            var ampMod = 0.6 + 0.4 * Math.sin(absTime * 2.1);
            return (Math.sin(absTime * 16.4) * 5 + Math.sin(absTime * 29.3 + 0.8) * 3.5 + Math.sin(absTime * 47.1 + 1.9) * 2) * ampMod
                + (Math.random() - 0.5) * 2.5;
        },
        asystole: function () { return (Math.random() - 0.5) * 1.2; },
        // CPR compression artefact at ~110/min.
        cpr: function (absTime) { return Math.sin(absTime * 2 * Math.PI * 1.83) * 28 + (Math.random() - 0.5) * 8; },
        af_baseline: function (absTime) {
            return Math.sin(absTime * 28) * 1.2 + Math.sin(absTime * 47 + 1.1) * 0.7 + (Math.random() - 0.5) * 1.4;
        },
        // Dissociated atrial activity for complete heart block (~75/min, independent rate).
        chb_p: function (absTime) {
            var period = 60 / 75;
            var phase = (absTime % period) / period;
            return 4.2 * Math.exp(-Math.pow(phase - 0.5, 2) / 0.005);
        },
        baselineNoise: function () { return (Math.random() - 0.5) * 1.5; }
    };

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
          shockable: false, pulseless: false, syncCardiovert: false, roscEligible: true, defaultHrRange: null },

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
          aliases: ['junctional', 'Junctional Rhythm'],
          shockable: false, pulseless: false, syncCardiovert: false, roscEligible: true, defaultHrRange: [45, 60] },

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
    // Both renderers call this. `cyclePhase` is the ventricular cycle position in [0,1),
    // `absTime` is seconds of wall/animation time (used by the chaotic + dissociated parts).
    // -------------------------------------------------------------------------
    function ecgValue(cyclePhase, absTime, rhythmName, opts) {
        opts = opts || {};
        if (opts.cpr) return REALTIME.cpr(absTime);
        // `noise:false` yields a deterministic sample. Verification harnesses use it so that the
        // cosmetic baseline jitter can never be mistaken for a genuine morphology difference.
        var noise = opts.noise === false ? 0 : null;

        var id = canonical(rhythmName);
        var r = BY_ID[id];
        var rt = r.realtime;
        if (rt && REALTIME[rt]) return REALTIME[rt](absTime);

        var fn = WAVEFORMS[r.waveform];
        var y = fn ? fn(cyclePhase % 1) : WAVEFORMS.sinus(cyclePhase % 1);

        if (r.waveform === 'af') y += REALTIME.af_baseline(absTime);
        if (r.waveform === 'chb') y += REALTIME.chb_p(absTime);
        if (r.waveform === 'mobitz2') {
            // Drop roughly every 4th ventricular beat: remove the QRS+T, keep the P.
            var beat = Math.floor(absTime / 1.2);
            if (beat % 4 === 3) y = pWave(cyclePhase % 1);
        }
        return y + (noise === 0 ? 0 : REALTIME.baselineNoise());
    }

    // -------------------------------------------------------------------------
    // 4. PAEDIATRIC / WEIGHT-BASED DEFIBRILLATION ENERGY (C4)
    // RCUK: 4 J/kg for paediatric defibrillation. The standalone defib hardcoded
    // [50,70,85,100,120,150,170,200] and defaulted to 120 J for a 3.5 kg neonate.
    // -------------------------------------------------------------------------
    var ADULT_ENERGY_STEPS = [50, 70, 85, 100, 120, 150, 170, 200, 250, 300, 360];
    var ADULT_DEFAULT_ENERGY = 150;

    function recommendedEnergy(weightKg, ageYears) {
        var w = Number(weightKg);
        if (!isFinite(w) || w <= 0) return ADULT_DEFAULT_ENERGY;
        // Adult dosing takes over once weight-based dosing would exceed the adult dose.
        if (w >= 40 || (isFinite(Number(ageYears)) && Number(ageYears) >= 16)) return ADULT_DEFAULT_ENERGY;
        return Math.max(1, Math.round(w * 4));
    }

    function energySteps(weightKg, ageYears) {
        var w = Number(weightKg);
        if (!isFinite(w) || w <= 0 || w >= 40 || (isFinite(Number(ageYears)) && Number(ageYears) >= 16)) {
            return ADULT_ENERGY_STEPS.slice();
        }
        // Weight-based ladder: 1, 2, 4 (recommended), 6, 8, 10 J/kg — 4 J/kg is the
        // recommended dose and is guaranteed to be present and selectable.
        var steps = [1, 2, 4, 6, 8, 10].map(function (m) { return Math.max(1, Math.round(w * m)); });
        var out = [];
        steps.forEach(function (s) { if (out.indexOf(s) === -1) out.push(s); });
        out.sort(function (a, b) { return a - b; });
        return out;
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
            'PEA':     { chance: 0.12, to: 'Sinus Tachycardia' },
            'Asystole':{ chance: 0.06, to: 'PEA' }
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
            '2nd Deg Heart Block': { chance: 0.35, to: 'Sinus Rhythm' },
            'Complete Heart Block': { chance: 0.10, to: 'Sinus Rhythm' }
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
        ADULT_ENERGY_STEPS: ADULT_ENERGY_STEPS,
        ADULT_DEFAULT_ENERGY: ADULT_DEFAULT_ENERGY,
        recommendedEnergy: recommendedEnergy,
        energySteps: energySteps,
        energyDeviation: energyDeviation,
        DRUG_CONVERSION: DRUG_CONVERSION,
        SHOCK_OUTCOMES: SHOCK_OUTCOMES,
        weightedPick: weightedPick
    };

    // Back-compat shim for the standalone defib page, which called a bare global.
    window.getECGValue = function (t, pT, absoluteTime, type, pathology, cpr) {
        return ecgValue(t, absoluteTime, type, { cpr: cpr });
    };

    // Node/verification harness support.
    if (typeof module !== 'undefined' && module.exports) module.exports = window.RHYTHMS;
})();
