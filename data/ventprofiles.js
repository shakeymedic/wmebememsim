// THE VENTILATOR'S LUNGS. One list, shared by the controller (the facilitator's Ventilator section)
// and the HAMILTON-T1 page (vent/index.html), which uses them in its breath engine.
//
// Five come from the standalone HAMILTON-T1 trainer (shakeymedic/niv-instructions) unchanged; "Normal
// lungs" is new here. All values are illustrative teaching values, not validated physiology:
//   C        compliance (l/cmH2O)              R     inspiratory resistance (cmH2O/(l/s), shown on the T1)
//   tau      time constant (s)                 vtBase  the patient's own tidal volume (l)
//   vd       dead space (l)                    rrBase  the patient's own breathing rate (/min)
//   effort   inspiratory effort (as a flow, l/min, compared with the flow trigger)
//   neuralTi the patient's own inspiratory time (s)
//   s0, sPeep  shunt fraction, and how much each cmH2O of PEEP reduces it
//   paco2, hco3, floor  the trainer's CO2 model (kPa, mmol/l, the lowest PaCO2 reachable)
//   fio2Pre  oxygen before the ventilator    ipeep  intrinsic PEEP (COPD)
//   needEpap the EPAP below which the upper airway obstructs (OHS)
//   sedated  intubated, sedated and paralysed: no breathing effort
(function () {
    var P = {
        normal: { name: 'Normal lungs', paco2: 5.3, hco3: 24, floor: 4.0, rrBase: 16, vtBase: 0.5, C: 0.05, tau: 0.4, vd: 0.15, s0: 0.05, sPeep: 0.002, neuralTi: 1.0, effort: 8, hr: 84, bp: '124/78', fio2Pre: 0.21, R: 8 },
        copd: { name: 'AECOPD', paco2: 9.6, hco3: 30, floor: 6.5, rrBase: 30, vtBase: 0.32, C: 0.022, tau: 0.5, vd: 0.25, s0: 0.45, sPeep: 0.005, neuralTi: 0.8, effort: 9, hr: 112, bp: '148/86', fio2Pre: 0.28, ipeep: true, R: 18 },
        cpo: { name: 'Cardiogenic pulmonary oedema', paco2: 6.4, hco3: 22, floor: 4.8, rrBase: 34, vtBase: 0.35, C: 0.03, tau: 0.25, vd: 0.15, s0: 0.87, sPeep: 0.011, neuralTi: 0.7, effort: 12, hr: 124, bp: '182/104', fio2Pre: 0.6, R: 9 },
        ohs: { name: 'Obesity hypoventilation', paco2: 9.0, hco3: 32, floor: 6.5, rrBase: 26, vtBase: 0.30, C: 0.018, tau: 0.35, vd: 0.2, s0: 0.5, sPeep: 0.01, neuralTi: 1.0, effort: 8, hr: 104, bp: '156/92', fio2Pre: 0.28, needEpap: 8, R: 12 },
        ards: { name: 'ARDS', paco2: 6.5, hco3: 22, floor: 4.5, rrBase: 20, vtBase: 0.42, C: 0.025, tau: 0.3, vd: 0.18, s0: 0.95, sPeep: 0.03, neuralTi: 1.0, effort: 0, hr: 118, bp: '104/62', fio2Pre: 1.0, R: 12, sedated: true },
        asthma: { name: 'Severe asthma', paco2: 8.0, hco3: 25, floor: 5.0, rrBase: 14, vtBase: 0.5, C: 0.05, tau: 1.3, vd: 0.18, s0: 0.75, sPeep: 0, neuralTi: 1.0, effort: 0, hr: 128, bp: '112/64', fio2Pre: 1.0, R: 26, sedated: true }
    };
    var ORDER = ['normal', 'copd', 'cpo', 'ohs', 'ards', 'asthma'];

    // A sensible starting lung for a scenario, from words in its title, complaint and condition.
    // The facilitator can change it at any time; this only picks the first choice.
    function profileForScenario(s) {
        if (!s) return 'normal';
        var text = [s.title, s.presentingComplaint, s.category, s.deterioration && s.deterioration.type, (s.pmh || []).join(' ')]
            .filter(Boolean).join(' ').toLowerCase();
        if (/\bards\b|respiratory distress syndrome/.test(text)) return 'ards';
        if (/asthma/.test(text)) return 'asthma';
        if (/obesity hypoventilation|\bohs\b/.test(text)) return 'ohs';
        if (/pulmonary oedema|pulmonary edema|heart failure|\bcpo\b|\bapo\b/.test(text)) return 'cpo';
        if (/copd|emphysema|chronic obstructive/.test(text)) return 'copd';
        return 'normal';
    }

    // The facilitator's lung adjustments (the trainer's Lungs panel, after Hamilton's VenTrainer):
    // compliance as % of the profile's, resistance, CO2 production as %, the oxygenation impairment
    // (shunt, %) and the patient's own rate. Stored in live.vent.lung; a missing key means the
    // profile's own value.
    var LUNG_ADJ = {
        c: { name: 'Compliance', unit: '%', min: 30, max: 200, step: 10, def: function () { return 100; } },
        r: { name: 'Resistance', unit: 'cmH2O/(l/s)', min: 1, max: 30, step: 1, def: function (b) { return b.R; } },
        m: { name: 'CO2 production', unit: '%', min: 65, max: 200, step: 5, def: function () { return 100; } },
        o: { name: 'Oxygenation impairment', unit: '%', min: 0, max: 95, step: 2.5, def: function (b) { return Math.round(b.s0 * 1000) / 10; } },
        e: { name: 'Spontaneous rate', unit: '/min', min: 6, max: 40, step: 1, def: function (b) { return b.rrBase; } }
    };
    var LUNG_ORDER = ['c', 'r', 'm', 'o', 'e'];

    // Problems the facilitator can inject (press again to fix). The first ten are the trainer's; the
    // next five are the DOPES problems added for the simulator; the mucus plug (for bronchoscopy
    // teaching; the Bronchoscopy intervention clears it too) and breath stacking came after. 'where' says which side models it:
    // the device (alarms and waveforms on the T1), the patient (the controller's obs), or both.
    var PROBLEMS = [
        { id: 'leakM', label: 'Moderate leak' },
        { id: 'leakL', label: 'Large leak' },
        { id: 'disc', label: 'Mask off / circuit disconnected' },
        { id: 'cough', label: 'Coughing / fighting the ventilator' },
        { id: 'kink', label: 'Kinked expiratory limb' },
        { id: 'apnoea', label: 'Patient stops breathing' },
        { id: 'o2fail', label: 'Oxygen supply failure' },
        { id: 'mains', label: 'Mains power lost' },
        { id: 'det', label: 'Patient tiring / deteriorating' },
        { id: 'circ', label: 'Cracked circuit (fails the leak test)' },
        { id: 'tubeout', label: 'Tube displaced (oesophageal: no CO2)' },
        { id: 'block', label: 'Tube blocked by secretions' },
        { id: 'bronch', label: 'Bronchospasm' },
        { id: 'ptx', label: 'Tension pneumothorax' },
        { id: 'battlow', label: 'Mains lost with the battery low' },
        { id: 'plug', label: 'Mucus plugging (lobar collapse)' },
        { id: 'trap', label: 'Breath stacking (air trapping)' }
    ];
    // The facilitator's problem buttons, grouped as a DOPES check would find them.
    var PROBLEM_GROUPS = [
        ['Tube and circuit', ['tubeout', 'block', 'kink', 'disc']],
        ['Lungs', ['ptx', 'bronch', 'plug', 'trap']],
        ['Patient', ['cough', 'apnoea', 'det']],
        ['Equipment', ['o2fail', 'mains', 'battlow', 'circ', 'leakM', 'leakL']]
    ];
    // What the candidate sees in this simulator once a problem is in (checked on an intubated
    // patient with normal lungs in (S)CMV+, 100% oxygen). Only where it has been checked.
    var PROBLEM_SIGNS = {
        tubeout: 'ETCO2 goes to zero and SpO2 falls over a minute or two. Pressures and volumes look normal.',
        block: 'Pressure limitation, low tidal volumes, AutoPEEP and a falling BP.',
        kink: 'Exhalation obstructed and High PEEP alarms, high pressures.',
        ptx: 'Pressure limitation, low tidal volumes, SpO2 falls, HR up and BP down. Needle or finger decompression fixes it.',
        bronch: 'Higher pressures, lower tidal volumes and AutoPEEP.',
        plug: 'Pressure limitation, low tidal volumes, SpO2 in the high 80s that oxygen barely helps and PEEP only partly. Bronchoscopy fixes it.',
        trap: 'AutoPEEP builds, Pplat rises and BP falls. Worse at a high rate; a lower rate and longer expiration help.'
    };
    var PLUG_SHUNT = 0.35;
    var PROBLEM_IDS = PROBLEMS.map(function (p) { return p.id; });
    function probList(v) {
        var a = Array.isArray(v) ? v : String(v || '').split(',');
        return a.filter(function (id) { return PROBLEM_IDS.indexOf(id) !== -1; });
    }

    // The T1's modes, in the order of its Modes window (the device names).
    var MODES = [['APVcmv', '(S)CMV+'], ['APVsimv', 'SIMV+'], ['VS', 'VS'], ['PCV+', 'PCV+'], ['PSIMV+', 'PSIMV+'], ['SPONT', 'SPONT'],
        ['DuoPAP', 'DuoPAP'], ['APRV', 'APRV'], ['ASV', 'ASV'], ['NIV', 'NIV'], ['NIV-ST', 'NIV-ST'], ['HiFlowO2', 'HiFlowO2']];

    // The lung the breath engine uses: the profile, with breathing effort switched off when the
    // facilitator says the patient is not breathing for themselves (sedated and paralysed), the
    // facilitator's lung adjustments, and the lung problems (bronchospasm and a blocked tube raise
    // the resistance; a tension pneumothorax and a mucus plug stiffen the lung and add shunt; breath
    // stacking slows emptying). vco2 is CO2 production relative to the profile's (1 = as described).
    function lungFor(config) {
        var c = config || {};
        var base = P[c.profile] || P.normal;
        var out = {};
        for (var k in base) out[k] = base[k];
        out.vco2 = 1;
        if (c.breathing === false) { out.sedated = true; out.effort = 0; }
        else if (c.breathing === true) { out.sedated = false; if (!out.effort) out.effort = 8; }
        var adj = c.lung || {};
        var num = function (key) { var d = LUNG_ADJ[key], v = Number(adj[key]); return adj[key] === undefined || adj[key] === null || !isFinite(v) ? null : Math.min(d.max, Math.max(d.min, v)); };
        var setR = function (r) { out.tau = out.tau * r / out.R; out.R = r; };
        var setC = function (C) { out.tau = out.tau / out.C * C; out.C = C; };
        if (num('c') !== null) setC(base.C * num('c') / 100);
        if (num('r') !== null) setR(num('r'));
        if (num('m') !== null) out.vco2 = num('m') / 100;
        if (num('o') !== null) out.s0 = num('o') / 100;
        if (num('e') !== null) out.rrBase = num('e');
        var probs = probList(c.probs);
        if (probs.indexOf('bronch') !== -1) setR(Math.min(60, out.R * 4));
        if (probs.indexOf('block') !== -1) setR(Math.min(80, out.R + 35));
        if (probs.indexOf('ptx') !== -1) { setC(out.C * 0.4); out.s0 = Math.min(0.97, out.s0 + 0.25); out.ptxShunt = 0.3; }
        // A mucus plug collapses a lobe: fewer lung units to inflate (stiffer), secretions in the
        // airways (more resistance), and blood flowing past unventilated lung. That true shunt (plug)
        // is mixed in by engine-vent.js: more oxygen cannot reach it, and PEEP only partly reopens it.
        if (probs.indexOf('plug') !== -1) { setC(out.C * 0.3); setR(Math.min(80, out.R + 20)); out.plug = PLUG_SHUNT; }
        // Breath stacking: expiratory flow limitation, so the lungs take four times as long to empty.
        // Each breath starts before the last has gone out: intrinsic PEEP builds, worse at a high rate.
        if (probs.indexOf('trap') !== -1) out.trapX = 4;
        return out;
    }

    window.VENT_PROFILES = { profiles: P, order: ORDER, profileForScenario: profileForScenario, lungFor: lungFor,
        LUNG_ADJ: LUNG_ADJ, LUNG_ORDER: LUNG_ORDER, PROBLEMS: PROBLEMS, PROBLEM_GROUPS: PROBLEM_GROUPS, PROBLEM_SIGNS: PROBLEM_SIGNS, probList: probList, MODES: MODES };
})();
