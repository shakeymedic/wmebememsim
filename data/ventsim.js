// =================================================================================================
// VENTILATOR SIM: the ventilator-training mode (phase 4 of the ventilator plan).
//
// Like Defib Sim, a Ventilator Sim session runs through the SAME engine, Firebase session, monitor
// and debrief as every other mode. This file only describes it: the built-in scenarios, the patient
// each one loads, and the debrief feedback read from the event log and the ventilator samples
// (state.ventSamples, recorded every 15 s while a ventilator breathes for the patient).
//
// The teaching targets below are the simulator's, written for these scenarios from BTS/ICS NIV and
// ARDS lung-protective ventilation principles as commonly taught; they are not a guideline and
// should be reviewed by the facilitator. Plain JS (no JSX). Exposes window.VentSim.
// =================================================================================================
(function () {
    'use strict';

    // airway: 'tube' means intubated before the scenario starts (RSI recorded), 'none' a mask.
    // targets: spo2 [low, high] (%), vtMax / vtMin (ml/kg ideal body weight), pplatMax, dpMax
    // (driving pressure = Pplat - PEEP), autopeepMax, ipapMax, peepMin (all cmH2O), etco2 [low, high] (kPa).
    // problems: the problems this scenario is written around (the facilitator injects them).
    var SCENARIOS = [
        { id: 'copd-niv', name: 'AECOPD: start NIV', group: 'Noninvasive ventilation',
          description: '68-year-old with an exacerbation of COPD. Drowsy, using accessory muscles. On 28% oxygen: SpO2 85%, respiratory acidosis (PaCO2 9.6 kPa). Set up and titrate NIV.',
          profile: 'copd', breathing: null, airway: 'none', age: 68, sex: 'Male',
          vitals: { hr: 112, bpSys: 148, bpDia: 86, rr: 30, spO2: 85, etco2: 8.8, gcs: 14, temp: 37.4 },
          targets: { spo2: [88, 92], ipapMax: 30, niv: true },
          problems: ['leakL', 'det', 'cough'] },
        { id: 'cpo-cpap', name: 'Cardiogenic pulmonary oedema: CPAP', group: 'Noninvasive ventilation',
          description: '74-year-old with acute pulmonary oedema. Sitting up, frothy sputum, crackles to the apices. SpO2 86% on 60% oxygen. Start CPAP (NIV mode with no pressure support) and titrate.',
          profile: 'cpo', breathing: null, airway: 'none', age: 74, sex: 'Female',
          vitals: { hr: 124, bpSys: 182, bpDia: 104, rr: 34, spO2: 86, etco2: 5.6, gcs: 15, temp: 36.9 },
          targets: { spo2: [94, 98], peepMin: 8, niv: true },
          problems: ['leakM', 'disc'] },
        { id: 'ohs-niv', name: 'Obesity hypoventilation: NIV', group: 'Noninvasive ventilation',
          description: '58-year-old with obesity hypoventilation, drowsy with a raised CO2. Snores and obstructs when asleep. Set up NIV with enough EPAP to hold the upper airway open.',
          profile: 'ohs', breathing: null, airway: 'none', age: 58, sex: 'Male',
          vitals: { hr: 104, bpSys: 156, bpDia: 92, rr: 26, spO2: 84, etco2: 8.2, gcs: 13, temp: 37.0 },
          targets: { spo2: [88, 92], peepMin: 8, ipapMax: 30, niv: true },
          problems: ['leakM', 'apnoea'] },
        { id: 'ards', name: 'ARDS: lung-protective ventilation', group: 'Invasive ventilation',
          description: '45-year-old with severe pneumonia, just intubated in the ED, sedated and paralysed, being bagged on 100% oxygen. Set lung-protective ventilation: low tidal volume, enough PEEP, a safe plateau pressure.',
          profile: 'ards', breathing: false, airway: 'tube', age: 45, sex: 'Male',
          vitals: { hr: 118, bpSys: 104, bpDia: 62, rr: 20, spO2: 86, etco2: 6.0, gcs: 3, temp: 38.6 },
          targets: { spo2: [88, 95], vtMax: 8, vtIdeal: 6, pplatMax: 30, dpMax: 15, peepMin: 8 },
          problems: ['disc', 'block'] },
        { id: 'asthma', name: 'Severe asthma, intubated', group: 'Invasive ventilation',
          description: '24-year-old with life-threatening asthma, intubated after failing to improve. Sedated and paralysed. Watch for air trapping: low rate, long expiratory time, and accept a raised CO2.',
          profile: 'asthma', breathing: false, airway: 'tube', age: 24, sex: 'Female',
          vitals: { hr: 128, bpSys: 112, bpDia: 64, rr: 14, spO2: 90, etco2: 7.0, gcs: 3, temp: 37.1 },
          targets: { spo2: [93, 98], pplatMax: 30, autopeepMax: 5 },
          problems: ['bronch', 'ptx'] },
        { id: 'post-rsi', name: 'After RSI in the ED: set up the ventilator', group: 'Invasive ventilation',
          description: '52-year-old intubated in the ED for a falling GCS after an overdose. Sedated and paralysed, tube position confirmed. The ventilator is switched off: check it, set it up from scratch and connect.',
          profile: 'normal', breathing: false, airway: 'tube', age: 52, sex: 'Male',
          vitals: { hr: 96, bpSys: 124, bpDia: 76, rr: 12, spO2: 97, etco2: 4.8, gcs: 3, temp: 36.8 },
          targets: { spo2: [94, 98], vtMin: 6, vtMax: 8, pplatMax: 30, etco2: [4.5, 6.0] },
          problems: [] },
        { id: 'dopes', name: 'Troubleshooting (DOPES)', group: 'Troubleshooting',
          description: 'Intubated, sedated and paralysed patient on the ventilator. The facilitator introduces problems one at a time: displaced or blocked tube, pneumothorax, equipment failure, stacked breaths. Find and fix each one.',
          profile: 'normal', breathing: false, airway: 'tube', age: 60, sex: 'Female',
          vitals: { hr: 90, bpSys: 128, bpDia: 74, rr: 14, spO2: 97, etco2: 4.9, gcs: 3, temp: 36.9 },
          targets: { spo2: [94, 98], vtMin: 6, vtMax: 8, pplatMax: 30 },
          problems: ['tubeout', 'block', 'ptx', 'disc', 'kink', 'o2fail'] },
        { id: 'transfer', name: 'Interhospital transfer', group: 'Troubleshooting',
          description: 'Ventilated patient for transfer to a tertiary centre. Prepare the ventilator for transport, then manage what happens in the ambulance: mains power, battery, the oxygen cylinder and a disconnection.',
          profile: 'normal', breathing: false, airway: 'tube', age: 38, sex: 'Male',
          vitals: { hr: 88, bpSys: 122, bpDia: 72, rr: 14, spO2: 98, etco2: 4.7, gcs: 3, temp: 36.7 },
          targets: { spo2: [94, 98], vtMin: 6, vtMax: 8, pplatMax: 30 },
          problems: ['mains', 'battlow', 'o2fail', 'disc'] }
    ];
    function byId(id) { for (var i = 0; i < SCENARIOS.length; i++) if (SCENARIOS[i].id === id) return SCENARIOS[i]; return null; }

    function buildScenario(opts) {
        opts = opts || {};
        var sc = byId(opts.scenario);
        if (!sc) throw new Error('Unknown ventilator scenario.');
        var RG = window.RHYTHMS;
        var rhythm = sc.vitals.hr > 100 && RG && RG.isKnown('Sinus Tachycardia') ? 'Sinus Tachycardia' : 'Sinus Rhythm';
        var base = window.buildQuickSimScenario({ age: sc.age, sex: sc.sex, name: opts.name || 'Ventilator Sim Patient', rhythm: rhythm });
        var vitals = Object.assign({}, base.vitals, sc.vitals);
        var mode = opts.mode === 'assessment' ? 'assessment' : 'education';
        return Object.assign({}, base, {
            id: 'VENT_' + sc.id + '_' + Date.now(),
            title: 'Ventilator Sim: ' + sc.name,
            category: 'Ventilator Sim',
            acuity: 'Resus',
            presentingComplaint: sc.description,
            profile: sc.description,
            patientProfileTemplate: sc.description,
            vitalsMod: vitals,
            vitals: vitals,
            ventSim: {
                scenario: sc.id, name: sc.name, group: sc.group, description: sc.description, mode: mode,
                profile: sc.profile, breathing: sc.breathing, airway: sc.airway,
                targets: sc.targets, problems: sc.problems.slice()
            }
        });
    }

    // ---- DEBRIEF -----------------------------------------------------------------------------
    var clock = function (sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };
    var median = function (a) { if (!a.length) return null; var s = a.slice().sort(function (x, y) { return x - y; }); var m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    var round1 = function (v) { return Math.round(v * 10) / 10; };
    var PROBLEM_LABEL = function (id) { var VP = window.VENT_PROFILES; var p = VP && VP.PROBLEMS.filter(function (x) { return x.id === id; })[0]; return p ? p.label : id; };

    // Was a ventilator part of this session at all?
    function used(state) {
        var log = (state && state.log) || [];
        return !!(state && state.scenario && state.scenario.ventSim) || log.some(function (l) { return /^Ventilator[ :(]/.test(l.msg || ''); });
    }

    function assess(state) {
        var sc = (state && state.scenario) || {};
        var vs = sc.ventSim || null;
        var tg = (vs && vs.targets) || {};
        var log = (state && state.log) || [];
        var samples = (state && state.ventSamples) || [];
        var hist = (state && state.history) || [];
        var t = function (l) { return Number(l.timeSeconds) || 0; };
        var find = function (re) { return log.filter(function (l) { return re.test(l.msg || ''); }); };
        var good = [], improve = [], stats = [];

        // Who did what: the candidate's own device actions are "Ventilator: ..."; remote changes are
        // "Ventilator (facilitator): ...".
        var starts = find(/^Ventilator: (Ventilation started|Therapy started)/);
        var leak = find(/^Ventilator: Leak test passed/), flow = find(/^Ventilator: Flow sensor calibration passed/);
        var limits = find(/^Ventilator: (Alarm limit changed|Alarm limits set with Auto)/);
        var settings = find(/^Ventilator: Setting changed/);
        var hiAlarms = find(/^Ventilator alarm \(high priority\)/);
        var remote = find(/^Ventilator \(facilitator\):/);

        if (starts.length) {
            var how = /started \((.+?)\) \(/.exec(starts[0].msg + ' (') ;
            stats.push('Ventilation first started at ' + clock(t(starts[0])) + (how ? ' in ' + how[1] : ''));
            if (leak.length && flow.length && t(leak[0]) <= t(starts[0]) && t(flow[0]) <= t(starts[0])) good.push('Pre-use check done before connecting: leak test and flow sensor calibration');
            else improve.push('The leak test and flow sensor calibration were not both passed before ventilation started (System > Tests & calib)');
        } else if (vs) {
            improve.push('The ventilator was never started by the candidate');
        }
        if (limits.length) good.push('Alarm limits reviewed (' + limits.length + ' change' + (limits.length === 1 ? '' : 's') + ')');
        else if (starts.length) improve.push('The alarm limits were never adjusted: set them around this patient (Alarms > Limits, or Auto once ventilating)');
        if (settings.length) stats.push(settings.length + ' setting change' + (settings.length === 1 ? '' : 's') + ' by the candidate');
        if (hiAlarms.length) stats.push(hiAlarms.length + ' high-priority alarm' + (hiAlarms.length === 1 ? '' : 's'));
        if (remote.length) stats.push(remote.length + ' change' + (remote.length === 1 ? '' : 's') + ' made remotely by the facilitator');

        // NIV scenarios: an NIV mode, and a sensible inspiratory pressure
        var invStarts = starts.filter(function (l) { return /\((\(S\)CMV\+|SIMV\+|VS|PCV\+|PSIMV\+|SPONT|DuoPAP|APRV|ASV)/.test(l.msg); });
        if (tg.niv && starts.length) {
            if (invStarts.length) improve.push('An invasive mode was used for a patient with a mask: choose NIV, NIV-ST (or CPAP as NIV with no pressure support)');
            else good.push('A noninvasive mode was used');
        }

        // Ventilator samples (while it was breathing for the patient)
        var vtk = samples.filter(function (s) { return s.vte > 0 && s.ibw > 0 && !s.niv; }).map(function (s) { return s.vte / s.ibw; });
        var pplat = samples.filter(function (s) { return s.pplat > 0; }).map(function (s) { return s.pplat; });
        var dp = samples.filter(function (s) { return s.pplat > 0 && s.peep >= 0; }).map(function (s) { return s.pplat - s.peep; });
        var ap = samples.filter(function (s) { return s.autopeep >= 0; }).map(function (s) { return s.autopeep; });
        var peeps = samples.filter(function (s) { return s.setPeep >= 0; }).map(function (s) { return s.setPeep; });
        var ipaps = samples.filter(function (s) { return s.ipap > 0; }).map(function (s) { return s.ipap; });
        if (vtk.length) {
            var mv = round1(median(vtk));
            stats.push('Median tidal volume ' + mv + ' ml/kg ideal body weight (' + vtk.length + ' sample' + (vtk.length === 1 ? '' : 's') + ')');
            if (tg.vtMax) {
                if (mv <= tg.vtMax && (!tg.vtMin || mv >= tg.vtMin)) good.push('Tidal volume ' + mv + ' ml/kg IBW, within the target ' + (tg.vtMin ? tg.vtMin + '-' : 'up to ') + tg.vtMax + ' ml/kg' + (tg.vtIdeal && mv <= tg.vtIdeal + 0.5 ? ' (lung-protective, about ' + tg.vtIdeal + ' ml/kg)' : ''));
                else improve.push('Tidal volume ' + mv + ' ml/kg IBW: the target here is ' + (tg.vtMin ? tg.vtMin + '-' : 'up to ') + tg.vtMax + ' ml/kg ideal body weight');
            }
        }
        if (pplat.length) {
            var pmax = Math.max.apply(null, pplat);
            stats.push('Highest plateau pressure ' + round1(pmax) + ' cmH2O');
            if (tg.pplatMax) { if (pmax <= tg.pplatMax) good.push('Plateau pressure stayed at or below ' + tg.pplatMax + ' cmH2O'); else improve.push('Plateau pressure reached ' + round1(pmax) + ' cmH2O (target ' + tg.pplatMax + ' or less)'); }
        }
        if (dp.length && tg.dpMax) {
            var dmed = round1(median(dp));
            if (dmed <= tg.dpMax) good.push('Driving pressure ' + dmed + ' cmH2O (target ' + tg.dpMax + ' or less)'); else improve.push('Driving pressure ' + dmed + ' cmH2O (Pplat minus PEEP): the target is ' + tg.dpMax + ' or less');
        }
        if (ap.length && tg.autopeepMax !== undefined) {
            var last = ap[ap.length - 1];
            if (last <= tg.autopeepMax) good.push('AutoPEEP ' + round1(last) + ' cmH2O at the end: air trapping controlled');
            else improve.push('AutoPEEP still ' + round1(last) + ' cmH2O at the end: lower the rate and lengthen expiration');
        }
        if (peeps.length && tg.peepMin) {
            var pk = Math.max.apply(null, peeps);
            if (pk >= tg.peepMin) good.push('PEEP/CPAP of ' + pk + ' cmH2O used (target at least ' + tg.peepMin + ')'); else improve.push('PEEP/CPAP never reached ' + tg.peepMin + ' cmH2O (highest ' + pk + ')');
        }
        if (ipaps.length && tg.ipapMax) {
            var im = Math.max.apply(null, ipaps);
            if (im > tg.ipapMax) improve.push('Inspiratory pressure reached ' + im + ' cmH2O: above ' + tg.ipapMax + ' needs senior review (BTS/ICS)');
        }

        // SpO2 and ETCO2 in their target range, from the debrief obs record, after ventilation began
        var from = starts.length ? t(starts[0]) : null;
        if (from !== null && tg.spo2) {
            var sp = hist.filter(function (h) { return h.time >= from + 60 && Number.isFinite(Number(h.spo2)) && h.spo2 > 0; });
            if (sp.length) {
                var inR = sp.filter(function (h) { return h.spo2 >= tg.spo2[0] && h.spo2 <= tg.spo2[1]; }).length;
                var pct = Math.round(inR / sp.length * 100);
                var line = 'SpO2 in the target ' + tg.spo2[0] + '-' + tg.spo2[1] + '% for ' + pct + '% of the time after the first minute';
                if (pct >= 70) good.push(line); else improve.push(line);
            }
        }
        if (from !== null && tg.etco2) {
            var ec = hist.filter(function (h) { return h.time >= from + 180 && Number(h.etco2) > 0; });
            if (ec.length) {
                var e = round1(ec[ec.length - 1].etco2);
                if (e >= tg.etco2[0] && e <= tg.etco2[1]) good.push('ETCO2 ' + e + ' kPa at the end, within ' + tg.etco2[0] + '-' + tg.etco2[1]);
                else improve.push('ETCO2 ' + e + ' kPa at the end: aim for ' + tg.etco2[0] + '-' + tg.etco2[1] + ' kPa');
            }
        }

        // Problems: when each was injected and when it was fixed
        var problems = [];
        var open = {};
        log.forEach(function (l) {
            var m = /^Ventilator problem injected: (.+) \(facilitator\)$/.exec(l.msg || '');
            if (m) { open[m[1]] = { label: m[1], at: t(l), fixedAt: null }; problems.push(open[m[1]]); return; }
            m = /^Ventilator problem fixed: (.+) \(facilitator\)$/.exec(l.msg || '');
            if (m && open[m[1]]) { open[m[1]].fixedAt = t(l); delete open[m[1]]; return; }
            if (/^Ventilator problem fixed: tension pneumothorax decompressed/.test(l.msg || '')) {
                var k = PROBLEM_LABEL('ptx'); if (open[k]) { open[k].fixedAt = t(l); open[k].by = 'decompression'; delete open[k]; } return;
            }
            if (/^Ventilator problems: all fixed/.test(l.msg || '')) Object.keys(open).forEach(function (k2) { open[k2].fixedAt = t(l); delete open[k2]; });
        });
        problems.forEach(function (p) {
            p.text = p.label + ': injected at ' + clock(p.at) + (p.fixedAt !== null ? ', fixed ' + clock(p.fixedAt - p.at) + ' later' + (p.by === 'decompression' ? ' (chest decompressed)' : '') : ', not fixed by the end');
        });

        return { good: good, improve: improve, stats: stats, problems: problems, samples: samples.length };
    }

    window.VentSim = { SCENARIOS: SCENARIOS, byId: byId, buildScenario: buildScenario, assess: assess, used: used };
})();
