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

    // The lung the breath engine uses: the profile, with breathing effort switched off when the
    // facilitator says the patient is not breathing for themselves (sedated and paralysed).
    function lungFor(config) {
        var c = config || {};
        var base = P[c.profile] || P.normal;
        var out = {};
        for (var k in base) out[k] = base[k];
        if (c.breathing === false) { out.sedated = true; out.effort = 0; }
        else if (c.breathing === true) { out.sedated = false; if (!out.effort) out.effort = 8; }
        return out;
    }

    window.VENT_PROFILES = { profiles: P, order: ORDER, profileForScenario: profileForScenario, lungFor: lungFor };
})();
