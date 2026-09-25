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
    // WAVE 7: the spike was a gaussian with sigma ~0.004 of a cycle — about 3.5 ms. Both renderers
    // SAMPLE the waveform once per animation frame (6-16 ms), so more than half of all pacing spikes
    // were never drawn at all: measured 17 spikes where 35 beats were paced. A pacing spike that is
    // invisible half the time is the one feature of a paced rhythm a trainee must see, so the spike
    // now carries a short flat top (~13 ms of cycle) with gaussian shoulders. On screen it is still
    // a 1-2 px hairline at the 8 s sweep.
    var qrsPaced = function (t) {
        var spike = Math.abs(t - 0.150) < 0.0075 ? 32 : g(t, 0.150, 32, 0.00004);
        return spike
            + g(t, 0.205, -30, 0.0018)                         // wide negative paced QRS
            + g(t, 0.300, 10, 0.0030)
            + g(t, 0.470, 11, 0.0140);                         // discordant (positive) T
    };

    // Sawtooth flutter baseline, one flutter wave per `fp` cycle.
    // WAVE 7: the atrial sawtooth is NOT a function of the ventricular cycle. Atrial flutter
    // fibrillates the atria at a fixed ~300/min regardless of how many of those waves the AV node
    // conducts, so with variable block the sawtooth must keep marching at its own rate while the
    // QRS complexes fall irregularly on top of it. Previously it was locked to 2 waves per
    // ventricular cycle, which made the flutter rate change whenever the ventricular rate did
    // (240/min flutter at HR 120, 300/min at HR 150) and made variable block impossible to draw.
    var sawtooth = function (fp) {
        fp = fp - Math.floor(fp);
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
        // WAVE 7: the sawtooth is now added in REAL TIME at a fixed 300/min (REALTIME.flutter_baseline)
        // so it is independent of the ventricular rate and survives variable AV block.
        flutter:      function (t) { return qrsNarrow(t) + tWave(t) * 0.35; },
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
        // Atrial flutter sawtooth at a fixed 300/min (5 Hz), dissociated from the ventricular rate.
        flutter_baseline: function (absTime) { return sawtooth(absTime * 5); },
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
        if (r.waveform === 'flutter') y += REALTIME.flutter_baseline(absTime);
        if (r.waveform === 'chb') y += REALTIME.chb_p(absTime);
        if (r.waveform === 'mobitz2') {
            // Drop roughly every 4th ventricular beat: remove the QRS+T, keep the P. The beat index
            // comes from the caller's PHASE ACCUMULATOR (opts.beat) so the drop is rate-correct;
            // the absTime fallback preserves behaviour for any caller that has not been updated.
            var beat = (opts.beat !== undefined && opts.beat !== null) ? Math.floor(opts.beat) : Math.floor(absTime / 1.2);
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
    const LEAD_GAIN = { I: 0.65, II: 1.0, III: 0.45, aVR: -0.8, aVL: 0.35, aVF: 0.75, V1: -0.7, V2: 0.45, V3: 0.8, V4: 1.15, V5: 1.05, V6: 0.85 };
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
            const rid = RG.canonical(rhythm);
            const INTRINSIC = { 'PEA': 38, 'Agonal Rhythm': 14, 'pVT': 180, 'Paced': 70 };
            let freq;
            if (rid === 'VF') freq = 4; else if (rid === 'Fine VF') freq = 5; else if (rid === 'Asystole') freq = 0.1;
            else if (hr > 0) freq = hr / 60; else freq = (INTRINSIC[rid] || 60) / 60;
            const N = Math.round(w);                 // one sample per pixel across 10 s
            const phase = new Float64Array(N), beat = new Int32Array(N);
            let ph = 0; let beats = 0;
            for (let i = 0; i < N; i++) {
                phase[i] = ph - Math.floor(ph); beat[i] = Math.floor(ph);
                const f = RG.beatIntervalFactor ? RG.beatIntervalFactor(rid, Math.floor(ph)) : 1;
                const next = ph + (10 / N) * freq / (f > 0 ? f : 1);
                if (Math.floor(next) !== Math.floor(ph) && !(RG.droppedBeat && RG.droppedBeat(rid, Math.floor(ph)))) beats++;
                ph = next;
            }
            const baseWave = RG.waveformFor(rid);
            const scenarioStemi = scenario && (scenario?.ecg?.type === 'STEMI' || scenario?.investigations?.ecg?.type === 'STEMI');
            const isStemi = baseWave === 'stemi' || (scenarioStemi && ['sinus', 'svt'].indexOf(baseWave) !== -1);
            const terr = isStemi ? STEMI_TERRITORY[stemiTerritoryFor(scenario)] : null;
            const sample = (i, lead) => {
                const t = i * 10 / N;
                const gain = LEAD_GAIN[lead] || 1;
                if (!isStemi) return RG.ecgValue(phase[i], t, rhythm, { beat: beat[i], noise: false }) * gain;
                // Sinus complex everywhere; the ST shift is added AFTER the lead gain so that it is
                // elevation in every territory lead (including V1, whose gain is negative).
                let y = RG.ecgValue(phase[i], t, 'Sinus Rhythm', { beat: beat[i], noise: false }) * gain;
                const p = phase[i];
                if (p > 0.25 && p < 0.42) {
                    const ramp = Math.sin((p - 0.25) / 0.17 * Math.PI) * 0.35 + 0.65;   // coved segment
                    if (terr[0].indexOf(lead) !== -1) y += 9 * ramp;
                    if (terr[1].indexOf(lead) !== -1) y -= 4 * ramp;
                }
                return y;
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
