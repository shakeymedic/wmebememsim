// THE VENTILATOR'S EFFECT ON THE PATIENT (phase 2 of the ventilator plan). Plain script, shared by
// the engine (vitalsReducer TICK_TIME / TICK_VENT), the session sync and the controller's
// Ventilator section. Loaded after data/ventprofiles.js and data/rhythms.js.
//
// The controller stays the only source of truth for the patient. The HAMILTON-T1 page
// (vent/index.html) reports what it delivers once a second in its mirror (ventState/<id>.phys):
//   on    1 while it is ventilating (or giving HiFlowO2), else 0
//   conn  1 while gas reaches the patient (0 when the circuit is disconnected)
//   fio2  the oxygen fraction the patient breathes (0.21 when disconnected)
//   peep  the end-expiratory pressure the lungs see (cmH2O)
//   r     alveolar ventilation relative to the patient's own at rest (1 = their usual)
//   rr    breaths a minute (the ventilator's measured total rate, or the patient's own)
//   autopeep  intrinsic PEEP the ventilator measures (cmH2O)
//   inv   1 when the ventilator is in an invasive mode
// From those this file works out SpO2, PaCO2 (shown as ETCO2), RR, and the effect of hypoxia,
// hypercapnia and air trapping on HR and BP. The formulas are the standalone trainer's (shunt that
// PEEP recruits, the oxygen dissociation curve, CO2 from alveolar ventilation). They are teaching
// approximations, not validated physiology.
(function () {
    var VP = window.VENT_PROFILES;
    var RG = window.RHYTHMS;

    // Interventions that mean a tube or supraglottic airway is in place.
    var TUBE_KEYS = ['RSI', 'FONA'];
    var SGA_KEYS = ['i-gel'];
    var has = function (set, k) { return !!(set && (typeof set.has === 'function' ? set.has(k) : set.indexOf(k) !== -1)); };

    // The lungs the ventilator ventilates, and whether the patient breathes for themselves. The
    // facilitator's explicit choice always wins; otherwise a paralysed or arrested patient does not
    // breathe, and anyone else breathes as the lung profile says.
    function configFor(cur) {
        var v = (cur && cur.vent) || {};
        var profile = v.profile && VP && VP.profiles[v.profile] ? v.profile : (VP ? VP.profileForScenario(cur && cur.scenario) : 'normal');
        var breathing = v.breathing === true || v.breathing === false ? v.breathing : null;
        if (breathing === null && cur && (cur.isParalysed || (RG && RG.inArrest(cur.rhythm || 'Sinus Rhythm')))) breathing = false;
        var out = { profile: profile, breathing: breathing };
        // The facilitator's lung adjustments and injected problems (phase 3), and the Assessment
        // switch that hides the T1's alarm help. Only present when set, so the payload stays small.
        var lung = {};
        if (v.lung && VP) VP.LUNG_ORDER.forEach(function (k) { var n = Number(v.lung[k]); if (v.lung[k] !== null && v.lung[k] !== undefined && isFinite(n)) lung[k] = n; });
        if (Object.keys(lung).length) out.lung = lung;
        var probs = VP ? VP.probList(v.probs) : [];
        if (probs.length) out.probs = probs.join(',');
        if (v.assess === true) out.assess = true;
        return out;
    }
    var hasProb = function (cfg, id) { return VP ? VP.probList(cfg.probs).indexOf(id) !== -1 : false; };
    function airwayFor(cur) {
        var a = cur && cur.activeInterventions;
        if (TUBE_KEYS.some(function (k) { return has(a, k); })) return 'tube';
        if (SGA_KEYS.some(function (k) { return has(a, k); })) return 'sga';
        return 'none';
    }

    // The ventilator that is breathing for the patient: ventilating, reporting what it delivers,
    // and the facilitator has not switched the link off. The most recent one if there are several.
    function driverFor(cur) {
        if (!cur || cur.ventLink === false) return null;
        if (RG && RG.inArrest(cur.rhythm || 'Sinus Rhythm')) return null;
        var mirrors = cur.ventMirror || {};
        var best = null;
        Object.keys(mirrors).forEach(function (k) {
            var m = mirrors[k];
            if (!m || m.state !== 'ventilating' || !m.phys || !(Number(m.phys.on) > 0)) return;
            if (!best || Number(m.ts) > Number(best.ts)) best = m;
        });
        return best;
    }

    var num = function (v, d) { var n = Number(v); return Number.isFinite(n) ? n : d; };
    var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
    // Severinghaus: SpO2 from PaO2 (mmHg)
    function sev(p) { p = Math.max(1, p); return 100 / (1 + 23400 / (p * p * p + 150 * p)); }
    // The end-tidal to arterial CO2 gap (kPa) widens with dead space.
    function co2Gap(lung) { return clamp(0.4 + 2 * (lung.vd / lung.vtBase - 0.3), 0.3, 1.5); }

    var SPO2_RATE = 0.05;      // per second: SpO2 follows its target with a time constant of about 20 s
    var CO2_TAU = 60;          // seconds: PaCO2 settles over 3-5 minutes (Jake's choice, 10 Oct 2026)

    // One second of ventilator physiology. `prev` is state.ventPhys (null the first time);
    // `shown` is what the monitor shows now (used to start from where the patient is).
    // Returns the new ventPhys, the displayed targets for spO2 / rr / etco2, and the HR/BP offsets.
    function step(prev, driver, cur, shown) {
        var cfg = configFor(cur);
        var lung = VP.lungFor(cfg);
        var ph = driver.phys || {};
        var fio2 = clamp(num(ph.fio2, 0.21), 0.21, 1);
        var peep = clamp(num(ph.peep, 0), 0, 40);
        var r = clamp(num(ph.r, 1), 0, 4);
        var gap = co2Gap(lung);
        // A tube in the oesophagus: the ventilator blows into the stomach (no alveolar ventilation, no CO2).
        var tubeOut = hasProb(cfg, 'tubeout');
        if (tubeOut) r = 0.2;
        var det = hasProb(cfg, 'det'), ptx = hasProb(cfg, 'ptx');
        var p = prev && prev.active ? prev : {
            active: true,
            spo2: clamp(num(shown && shown.spO2, 95), 40, 100),
            paco2: clamp(num(shown && shown.etco2, lung.paco2 - gap) + gap, 3, 15),
            applied: { hr: 0, bpSys: 0, bpDia: 0 }
        };
        // Oxygenation: the shunt falls with PEEP; PaO2 from the alveolar gas equation (simplified).
        var shunt = Math.max(0.05, lung.s0 - lung.sPeep * peep + (det ? 0.05 : 0));
        var pao2 = Math.max(2, (fio2 * 95 - p.paco2 / 0.8) * (1 - shunt));
        var spo2T = clamp(sev(pao2 * 7.5), 40, 100);
        var spo2 = p.spo2 + (spo2T - p.spo2) * SPO2_RATE;
        // CO2: the trainer's curve of PaCO2 against alveolar ventilation.
        var target = lung.floor + (lung.paco2 - lung.floor) * Math.exp(-0.5 * (r - 1));
        target = Math.min(target, lung.paco2 + 4) * (lung.vco2 || 1);   // CO2 production scales it (the trainer's rule)
        if (det) target += 2.5;
        var paco2 = p.paco2 + (target - p.paco2) / CO2_TAU;
        var conn = Number(ph.conn) > 0;
        var rr = clamp(Math.round(num(ph.rr, 0)), 0, 60);
        // No gas through the circuit: nothing to measure at the mouth.
        var etco2 = conn && rr > 0 && !tubeOut ? clamp(paco2 - gap, 0, 15) : 0;
        // HR rises with hypoxia and hypercapnia; air trapping lowers BP (as in the trainer).
        var trap = Math.max(0, num(ph.autopeep, 0) - 3);
        var offsets = {
            // A tension pneumothorax also obstructs venous return (until it is decompressed or fixed).
            hr: (spo2 < 88 ? (88 - spo2) * 1.5 : 0) + (paco2 > 9 ? 6 : 0) + (ptx ? 25 : 0),
            bpSys: -4 * trap - (ptx ? 35 : 0),
            bpDia: -2.5 * trap - (ptx ? 20 : 0)
        };
        return {
            ventPhys: { active: true, spo2: spo2, paco2: paco2, applied: p.applied },
            targets: { spO2: spo2, rr: rr, etco2: etco2 },
            offsets: offsets
        };
    }

    // The keys the ventilator drives directly, and those it nudges.
    var DRIVEN = ['spO2', 'rr', 'etco2'];
    var NUDGED = ['hr', 'bpSys', 'bpDia'];

    window.VENT_ENGINE = {
        configFor: configFor, airwayFor: airwayFor, driverFor: driverFor, step: step,
        DRIVEN: DRIVEN, NUDGED: NUDGED, CO2_TAU: CO2_TAU
    };
})();
