(() => {
    const { useState, useEffect, useRef, useReducer } = React;
    const { INTERVENTIONS, calculateDynamicVbg, getRandomInt, clamp } = window;

    const DEFAULT_VITALS = { etco2: 4.5, temp: 36.5, bm: 5.5, ph: 7.4, hr: 80, bpSys: 120, bpDia: 80, spO2: 98, rr: 16, gcs: 15, pupils: 3 };

    const initialVitalsState = {
        vitals: { ...DEFAULT_VITALS },
        // baseVitals is the UNDERLYING physiology at full float precision. `vitals` is what is
        // displayed and synced: baseVitals + the additive drug envelope, rounded. Keeping the base
        // unrounded is what lets slow processes (0.005 GCS/s of rising ICP, 0.02 degC/s of active
        // warming) accumulate at all — Wave 1 already hit this with oxygen's +0.2%/s being rounded
        // straight back to the same integer every tick.
        baseVitals: { ...DEFAULT_VITALS },
        prevVitals: {},
        trends: { active: false, targets: {}, duration: 0, elapsed: 0, startVitals: {} },
        hypoxiaTimer: 0
    };

    const initialLogState = {
        log: [], history: []
    };

    const initialScenarioState = {
        scenario: null, investigationsRevealed: {}, loadingInvestigations: {}
    };

    const initialCoreState = {
        time: 0, cycleTimer: 0, isRunning: false, rhythm: "Sinus Rhythm",
        monitorTimer: { visible: false, active: false, time: 0 },
        flash: null, activeInterventions: new Set(), interventionCounts: {},
        activeDurations: {}, processedEvents: new Set(), isMuted: false,
        etco2Enabled: false, isParalysed: false, queuedRhythm: null, cprInProgress: false,
        // Every administered drug that carries a `pk` envelope, with the time it was given. This is
        // the single source of truth for drug timing: numeric effects, wear-off AND neuromuscular
        // blockade all derive from these entries (Wave 1's bespoke paralysis timer is now folded in).
        // Primitives only, so it passes sanitizeForRealtimeDatabase and JSON persistence unchanged.
        activeDrugs: [],
        // AUTO  = the scenario's declared deterioration type/rate drives the obs autonomously.
        // MANUAL = complete manual control, nothing changes on its own.
        // Switching is discontinuity-free by construction: see the deterioration comment above.
        deteriorationMode: 'manual',
        // Derived view of the paralytic entry in activeDrugs, kept for the UI, persistence and sync.
        paralysis: { active: false, agent: null, startTime: 0, onset: 0, duration: 0 },
        nibp: { sys: null, dia: null, lastTaken: null, mode: 'manual', timer: 0, interval: 3 * 60, inflating: false, history: [] },
        speech: { text: null, timestamp: 0, source: null }, soundEffect: { type: null, timestamp: 0 },
        audioOutput: 'monitor', arrestPanelOpen: false, isFinished: false, etco2Pathology: 'normal',
        monitorPopup: { type: null, timestamp: 0, customText: null },
        waveformGain: 1.0, noise: { interference: false },
        remotePacerState: { rate: 0, output: 0 }, notification: null, pacingThreshold: 70,
        icp: 10, activeLoops: {}, completedObjectives: new Set(), assessments: {},
        lastUpdate: 0, isOffline: false, showWetflag: true,
        // `isOffline` is kept for existing UI behaviour; syncStatus carries the actionable
        // reason that the controller and second-screen monitor display to the user.
        syncStatus: { state: 'connecting', message: null, lastWriteAt: null }
    };

    const SYNC_OFFLINE_STATES = new Set(['unavailable', 'disconnected', 'error']);

    // Realtime Database rejects undefined, NaN and Infinity anywhere in a payload, including
    // nested NIBP/trend/investigation data. Sanitise the whole wire payload, not just vitals.
    const sanitizeForRealtimeDatabase = (value, path = '', dropped = []) => {
        if (value === undefined) {
            dropped.push(path || '(root)');
            return { value: undefined, dropped };
        }
        if (typeof value === 'number' && !Number.isFinite(value)) {
            dropped.push(path || '(root)');
            return { value: undefined, dropped };
        }
        if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return { value, dropped };
        }
        if (Array.isArray(value)) {
            const result = [];
            value.forEach((item, index) => {
                const safe = sanitizeForRealtimeDatabase(item, `${path}[${index}]`, dropped);
                if (safe.value !== undefined) result.push(safe.value);
            });
            return { value: result, dropped };
        }
        if (typeof value === 'object') {
            const result = {};
            Object.keys(value).forEach(key => {
                const safe = sanitizeForRealtimeDatabase(value[key], path ? `${path}.${key}` : key, dropped);
                if (safe.value !== undefined) result[key] = safe.value;
            });
            return { value: result, dropped };
        }
        dropped.push(path || '(root)');
        return { value: undefined, dropped };
    };

    // --- PERMISSIVE EXPECTATIONS (never blocking) -------------------------------------------------
    // A facilitator must never be prevented from doing anything; unmet expectations are recorded so
    // the deviation becomes teaching data. An expectation counts as MET if the key is an active
    // continuous intervention OR has been given at least once as a bolus — the original code tested
    // only `activeInterventions`, which bolus drugs never join, so RSI's own prerequisites
    // (Propofol + Roc, both boluses) could never be satisfied in any of the 254 scenarios.
    const isExpectationMet = (key, coreState) => {
        if (!coreState) return false;
        const active = coreState.activeInterventions;
        if (active && typeof active.has === 'function' && active.has(key)) return true;
        const counts = coreState.interventionCounts || {};
        return (counts[key] || 0) > 0;
    };

    const labelFor = (key) => (INTERVENTIONS[key] && INTERVENTIONS[key].label) || key;

    // Returns a list of human-readable descriptions of what is NOT in place yet. `requires` is still
    // accepted as a synonym for `expects` so older/custom scenario data keeps working.
    const getUnmetExpectations = (action, coreState) => {
        if (!action) return [];
        const missing = [];
        const all = action.expects || action.requires || [];
        all.forEach(key => { if (!isExpectationMet(key, coreState)) missing.push(labelFor(key)); });
        (action.expectsAny || []).forEach(group => {
            const keys = group.keys || [];
            if (!keys.some(k => isExpectationMet(k, coreState))) missing.push(group.label || keys.map(labelFor).join(' / '));
        });
        return missing;
    };
    window.getUnmetExpectations = getUnmetExpectations;

    // Airway interventions that deliver breaths for the patient. Shared by the hypoxia model and the
    // paralysis model so "paralysed but unbagged" desaturates and "paralysed and ventilated" does not.
    const VENTILATING = ['Bagging', 'RSI', 'i-gel', 'NIV', 'CPAP', 'FONA'];
    const isVentilated = (activeInt) => !!activeInt && VENTILATING.some(k => activeInt.has(k));
    const VENTILATOR_RATE = 14;

    // Paralysis only bites after the drug's onset time, and stops at the end of its duration.
    const paralysisPhase = (paralysis, time) => {
        if (!paralysis || !paralysis.active) return 'none';
        const start = paralysis.startTime || 0;
        const onset = paralysis.onset || 0;
        const duration = paralysis.duration || 0;
        if (time < start + onset) return 'onset';
        if (duration > 0 && time >= start + onset + duration) return 'expired';
        return 'active';
    };

    // 'pupils' and 'gcs' are the only non-numeric vitals the UI can set (gcs may arrive as a string).
    const isVitalValueSafe = (key, val) => {
        if (key === 'pupils') return val !== undefined && val !== null && val !== '';
        return Number.isFinite(Number(val)) && val !== '' && val !== null;
    };

    const formatVital = (key, val) => {
        if (key === 'ph') return Math.round(val * 100) / 100;
        if (['temp', 'bm', 'etco2'].includes(key)) return Math.round(val * 10) / 10;
        return Math.round(val);
    };

    // =============================================================================================
    // PHARMACOKINETIC ENVELOPE (Wave 2)
    // ---------------------------------------------------------------------------------------------
    // Every drug effect used to be an instantaneous clamped jump written straight into `vitals`, so
    // nothing ever ramped, nothing ever wore off, repeat dosing was uncapped (3x atropine = HR +60),
    // and any running trend erased the effect on the next 1 Hz tick because the trend interpolator
    // rewrites ABSOLUTE values from a frozen `startVitals` snapshot.
    //
    // The fix is architectural: drug effects are never written into the physiology. They are held in
    // `activeDrugs[]` and evaluated every tick as an ADDITIVE OFFSET on top of whatever the
    // physiology produced:
    //
    //     displayed = clamp(baseVitals + SUM(drugOffset(t)))
    //
    // so trends, deterioration, the airway/apnoea model and manual adjustments all operate on the
    // BASE and can never overwrite a drug, and wear-off is free: when an entry's envelope returns to
    // zero the patient drifts back onto the underlying trajectory.
    //
    // FINAL COMPOSITION / PRECEDENCE ORDER (see vitalsReducer TICK_TIME, which implements it):
    //   1. MANUAL facilitator writes (MANUAL_VITAL_UPDATE / UPDATE_VITALS / arrest / ROSC / rhythm)
    //      set the BASE directly and win immediately — the facilitator is never overruled.
    //   2. TRENDS interpolate the BASE from a base-space snapshot towards base-space targets.
    //   3. AUTONOMOUS DETERIORATION integrates per-second deltas into the BASE (AUTO mode only,
    //      skipped for any vital a trend currently owns, skipped in arrest).
    //   4. AIRWAY / PARALYSIS / HYPOXIA / ETCO2 model adjusts the BASE (it owns RR while paralysed
    //      and owns SpO2 while apnoeic, so it deliberately runs after 2 and 3).
    //   5. DRUG PK ENVELOPE is summed and ADDED to the base — never written into it.
    //   6. CLAMP to physiological limits, derive diastolic coherence, round -> `vitals`.
    //   Arrest overrides 5 for hr/bpSys/bpDia/rr/spO2: a pulseless patient has no perfusion to
    //   measure, matching the Wave 1 arrest guard in applyIntervention.
    // =============================================================================================

    // effect field -> [vital, scale]. BP moves the diastolic 0.6x with the systolic so the pair can
    // never become incoherent (dia > sys) after an offset is applied.
    const EFFECT_TARGETS = {
        HR: [['hr', 1]], BP: [['bpSys', 1], ['bpDia', 0.6]], RR: [['rr', 1]], SpO2: [['spO2', 1]],
        gcs: [['gcs', 1]], BM: [['bm', 1]], Temp: [['temp', 1]], pH: [['ph', 1]]
    };
    const PK_EFFECT_FIELDS = Object.keys(EFFECT_TARGETS);

    const VITAL_LIMITS = {
        hr: [0, 250], bpSys: [0, 300], bpDia: [0, 200], spO2: [0, 100], rr: [0, 60],
        gcs: [3, 15], temp: [22, 43], bm: [0.5, 45], ph: [6.6, 7.9], etco2: [0, 15]
    };
    const clampVital = (key, v) => {
        const lim = VITAL_LIMITS[key];
        if (!lim) return v;
        return Math.min(lim[1], Math.max(lim[0], v));
    };
    // Vitals a pulseless patient cannot express. Suppressed from the drug envelope during arrest.
    const ARREST_SUPPRESSED = ['hr', 'bpSys', 'bpDia', 'rr', 'spO2'];
    const PULSELESS_RHYTHMS = ['VF', 'VT', 'pVT', 'PEA', 'Asystole'];

    const PK_DEFAULT_MAX_DOSES = 3;
    const PK_PLATEAU_FRACTION = 0.35;   // share of the peak->offset window spent at full effect

    // Build the stored activeDrugs entry for an intervention. Primitives only, so the entry passes
    // sanitizeForRealtimeDatabase unchanged and survives JSON persistence.
    const buildDrugEntry = (key, action, startTime, dose = 1) => {
        if (!action || !action.pk) return null;
        const pk = action.pk;
        const effect = {};
        PK_EFFECT_FIELDS.forEach(f => {
            const v = action.effect ? action.effect[f] : undefined;
            if (typeof v === 'number' && Number.isFinite(v) && v !== 0) effect[f] = v;
        });
        const paralytic = !!(action.effect && action.effect.paralysed);
        // An entry with no numeric effect and no paralysis role would contribute nothing.
        if (Object.keys(effect).length === 0 && !paralytic) return null;
        const onset = Math.max(0, Number(pk.onset) || 0);
        const peak = Math.max(onset, Number(pk.peak) || onset);
        const offset = Math.max(0, Number(pk.offset) || 0);
        const plateau = (pk.plateau === undefined || pk.plateau === null) ? null : Math.max(peak, Number(pk.plateau) || peak);
        return {
            key, label: action.label || key, startTime, dose,
            onset, peak, offset,
            plateau: plateau === null ? -1 : plateau,       // -1 == derive the default plateau
            // A continuous intervention (infusion, ventilator, warming blanket) holds at peak while it
            // is running; `offset` then means the decay tail AFTER it is stopped.
            sustained: action.type === 'continuous',
            stopTime: -1,                                   // -1 == still running
            maxDoses: Math.max(1, Number(pk.maxDoses) || PK_DEFAULT_MAX_DOSES),
            paralytic,
            // Paralysis window: onset -> paralysisEnd. Folded into this single entry so there is no
            // parallel timer (Wave 1 left a bespoke one with a note asking for exactly this).
            paralysisEnd: paralytic ? (action.paralysis && action.paralysis.duration
                ? onset + Math.max(1, Number(action.paralysis.duration))
                : (offset || onset + 2700)) : -1,
            reversed: false, effect
        };
    };

    // 0 before onset -> linear ramp to 1 at peak -> plateau -> linear decay to 0 at offset.
    const pkFactor = (d, t) => {
        if (!d) return 0;
        const el = t - d.startTime;
        if (!Number.isFinite(el) || el <= d.onset) return 0;
        if (el < d.peak) return (el - d.onset) / Math.max(1, d.peak - d.onset);
        if (d.sustained) {
            if (d.stopTime === undefined || d.stopTime === null || d.stopTime < 0) return 1;  // still running
            const tail = d.offset > 0 ? d.offset : 120;
            const since = t - d.stopTime;
            if (since <= 0) return 1;
            if (since >= tail) return 0;
            return 1 - (since / tail);
        }
        if (!d.offset || d.offset <= d.peak) return 1;   // no modelled wear-off
        const plateauEnd = (d.plateau !== undefined && d.plateau >= 0)
            ? d.plateau
            : d.peak + PK_PLATEAU_FRACTION * (d.offset - d.peak);
        if (el <= plateauEnd) return 1;
        if (el >= d.offset) return 0;
        return 1 - ((el - plateauEnd) / Math.max(1, d.offset - plateauEnd));
    };

    // Human-readable phase for the facilitator's Active Drugs panel (A5).
    const pkPhase = (d, t) => {
        const el = t - d.startTime;
        if (el < d.onset) return 'onset';
        if (el < d.peak) return 'rising';
        if (d.sustained) return (d.stopTime !== undefined && d.stopTime !== null && d.stopTime >= 0) ? 'wearing off' : 'running';
        if (!d.offset || d.offset <= d.peak) return 'peak';
        const plateauEnd = (d.plateau !== undefined && d.plateau >= 0) ? d.plateau : d.peak + PK_PLATEAU_FRACTION * (d.offset - d.peak);
        if (el <= plateauEnd) return 'peak';
        if (el < d.offset) return 'wearing off';
        return 'gone';
    };
    // Seconds until the entry contributes nothing. null == indefinite (running infusion / no offset).
    const pkRemaining = (d, t) => {
        if (d.sustained) {
            if (d.stopTime === undefined || d.stopTime === null || d.stopTime < 0) return null;
            return Math.max(0, (d.stopTime + (d.offset > 0 ? d.offset : 120)) - t);
        }
        if (!d.offset || d.offset <= d.peak) return null;
        return Math.max(0, (d.startTime + d.offset) - t);
    };
    const isDrugSpent = (d, t) => {
        if (d.sustained) return (d.stopTime !== undefined && d.stopTime !== null && d.stopTime >= 0) && pkFactor(d, t) <= 0;
        if (!d.offset || d.offset <= d.peak) return false;
        return t >= d.startTime + d.offset;
    };

    // Sum every active drug's contribution per vital, with a PER-DRUG CEILING so repeat dosing is
    // additive but not unbounded: two doses of atropine give +40, ten doses still give +40.
    const drugOffsets = (activeDrugs, t) => {
        const perKey = {};
        (activeDrugs || []).forEach(d => {
            const f = pkFactor(d, t);
            if (!(f > 0)) return;
            const bucket = perKey[d.key] || (perKey[d.key] = { f: 0, effect: d.effect || {}, maxDoses: d.maxDoses || PK_DEFAULT_MAX_DOSES });
            bucket.f += f * (Number(d.dose) || 1);
        });
        const out = {};
        Object.keys(perKey).forEach(k => {
            const b = perKey[k];
            const f = Math.min(b.f, b.maxDoses);
            Object.keys(b.effect).forEach(field => {
                const targets = EFFECT_TARGETS[field];
                if (!targets) return;
                const amt = Number(b.effect[field]);
                if (!Number.isFinite(amt)) return;
                targets.forEach(([vital, scale]) => { out[vital] = (out[vital] || 0) + amt * f * scale; });
            });
        });
        return out;
    };

    // Step 5 + 6 of the precedence order: base + envelope -> clamp -> coherence -> round.
    const composeVitals = (base, activeDrugs, t, inArrest) => {
        const offs = drugOffsets(activeDrugs, t);
        const out = {};
        Object.keys(base).forEach(k => {
            const bv = base[k];
            if (typeof bv !== 'number' || !Number.isFinite(bv)) { out[k] = bv; return; }
            let off = offs[k] || 0;
            if (inArrest && ARREST_SUPPRESSED.indexOf(k) !== -1) off = 0;
            out[k] = formatVital(k, clampVital(k, bv + off));
        });
        if (Number.isFinite(out.bpSys) && Number.isFinite(out.bpDia)) {
            if (out.bpSys <= 0) out.bpDia = 0;
            else if (out.bpDia > out.bpSys - 5) out.bpDia = Math.max(0, Math.round(out.bpSys * 0.62));
        }
        return out;
    };

    // Paralysis, derived from the SAME activeDrugs entries (one timer, not two).
    const paralysisFromDrugs = (activeDrugs, t) => {
        let best = null;
        (activeDrugs || []).forEach(d => {
            if (!d.paralytic || d.reversed) return;
            const end = d.paralysisEnd > 0 ? d.startTime + d.paralysisEnd : Infinity;
            if (t >= d.startTime + d.onset && t < end) {
                if (!best || end > best.end) best = { agent: d.key, startTime: d.startTime, onset: d.onset, end, duration: end - (d.startTime + d.onset) };
            }
        });
        return best;
    };

    // =============================================================================================
    // AUTONOMOUS DETERIORATION (Wave 2, Group C)
    // ---------------------------------------------------------------------------------------------
    // 198 of 254 scenarios declare `deterioration.active` + `rate`, but only `type === 'neuro'` was
    // ever consumed and `rate` was read NOWHERE, so every patient was physiologically static.
    //
    // Deltas below are per-second, per unit `rate` (scenario rates run 0.01 - 0.2). They are
    // INTEGRATED into baseVitals, which is the whole reason the AUTO/MANUAL toggle cannot produce a
    // discontinuity: toggling only gates the integration, it never recomputes a value from the
    // scenario's original starting vitals. Stop integrating and the obs simply stay where they are;
    // start again and they continue from there.
    // =============================================================================================
    const normaliseDeteriorationType = (t) => {
        const s = String(t || '').toLowerCase();
        if (!s) return null;
        if (s.indexOf('resp') === 0) return 'resp';
        if (s.indexOf('shock') === 0 || s.indexOf('sepsis') === 0 || s.indexOf('haemorrh') === 0) return 'shock';
        if (s.indexOf('neuro') === 0) return 'neuro';
        if (s.indexOf('airway') === 0) return 'airway';
        if (s.indexOf('cardiac') === 0 || s.indexOf('cardio') === 0) return 'cardiac';
        if (s.indexOf('arrest') === 0) return 'arrest';
        return null;
    };

    // Interventions that address each pathology. Any of them slows the decline; enough of them
    // reverses it (C4). Matching is permissive — a bolus given once counts, same as Wave 1's
    // expectation test, so the facilitator is credited for treatment either way.
    const DETERIORATION_TREATMENTS = {
        shock: ['Fluids', 'FluidInfusion', 'Blood', 'Noradrenaline', 'Metaraminol', 'AdrenalineIM', 'TXA', 'Antibiotics', 'Ceftriaxone', 'Tazocin', 'Gentamicin', 'PelvicBinder', 'Tourniquet', 'REBOA', 'Thoracotomy', 'Pericardiocentesis', 'Hydrocortisone', 'Terlipressin', 'Octaplex', 'Albumin', 'Surgery', 'CalciumChloride'],
        resp: ['Oxygen', 'Nebs', 'NebAdrenaline', 'CPAP', 'NIV', 'Bagging', 'MagSulph', 'Hydrocortisone', 'Dexamethasone', 'i-gel', 'RSI', 'Needle', 'FingerThoracostomy', 'SeldingerDrain', 'SurgicalDrain', 'ChestSeal', 'Furosemide', 'GTNInfusion', 'Antibiotics', 'Thrombolysis'],
        airway: ['Manoeuvres', 'OPA', 'NPA', 'Suction', 'Magills', 'i-gel', 'RSI', 'FONA', 'NebAdrenaline', 'Dexamethasone', 'AdrenalineIM', 'Bagging', 'Oxygen', 'Chlorphenamine'],
        cardiac: ['Atropine', 'Pacing', 'PacingPads', 'Adenosine', 'Amiodarone', 'Cardioversion', 'Aspirin', 'GTN', 'GTNInfusion', 'PPCI', 'Thrombolysis', 'Metaraminol', 'Fluids', 'Digibind', 'CalciumChloride', 'Calcium', 'InsulinDextrose', 'Noradrenaline', 'Furosemide', 'NIV'],
        neuro: ['HypertonicSaline', 'RSI', 'Lorazepam', 'Midazolam', 'Thrombolysis', 'Oxygen', 'Dextrose', 'Glucagon', 'Pabrinex', 'Naloxone', 'Antibiotics', 'Ceftriaxone', 'Dexamethasone', 'Surgery'],
        arrest: ['CPR', 'Lucas', 'AdrenalineIV', 'Defib', 'Amiodarone']
    };

    // 1 = full decline, 0 = halted, negative = actively recovering.
    const deteriorationTreatmentFactor = (type, cs) => {
        const list = DETERIORATION_TREATMENTS[type] || [];
        let n = 0;
        list.forEach(k => { if (isExpectationMet(k, cs)) n++; });
        const stabilisers = (cs && cs.scenario && cs.scenario.stabilisers) || [];
        // A declared stabiliser is the definitive treatment: decline reverses.
        if (stabilisers.length && stabilisers.some(k => isExpectationMet(k, cs))) return -0.6;
        return Math.max(-0.6, 1 - 0.45 * n);
    };

    // Bands the patient is allowed to recover INTO when the treatment factor is negative, so
    // successful treatment normalises rather than overshooting into hypertension/hyperoxia.
    const RECOVERY_BAND = { hr: [58, 110], bpSys: [95, 135], spO2: [92, 98], rr: [12, 22], gcs: [3, 15], etco2: [4.0, 6.0], temp: [36.0, 37.5] };
    // Floors/ceilings autonomous deterioration alone may reach. Going all the way to zero is the
    // facilitator's call (ARREST), not a slow drift's.
    const DETERIORATION_BOUND = { hr: [25, 220], bpSys: [35, 240], spO2: [40, 100], rr: [4, 55], gcs: [3, 15], etco2: [1.5, 10], bm: [1.0, 40], temp: [30, 42] };

    const deteriorationDeltas = (type, base) => {
        const d = {};
        const add = (k, v) => { d[k] = (d[k] || 0) + v; };
        switch (type) {
            case 'shock':
                add('bpSys', -1.0);
                if (base.bpSys > 70) { add('hr', 0.9); }                    // compensatory tachycardia
                else { add('hr', -1.2); add('spO2', -0.35); add('gcs', -0.03); }  // decompensation
                add('spO2', -0.1);
                add('etco2', -0.004);
                break;
            case 'resp':
                add('spO2', -0.45);
                if (base.rr < 38) { add('rr', 0.9); } else { add('rr', -1.2); add('spO2', -1.0); }  // tiring
                add('etco2', 0.01);
                if (base.spO2 < 80) { add('hr', 0.6); add('gcs', -0.02); }
                break;
            case 'airway':
                add('spO2', -0.8); add('etco2', 0.015);
                if (base.spO2 > 85) add('rr', 0.7); else add('rr', -1.0);
                if (base.spO2 < 80) { add('hr', 0.5); add('gcs', -0.04); }
                break;
            case 'cardiac':
                add('bpSys', -0.6); add('spO2', -0.15);
                if (base.hr >= 100) add('hr', 0.7); else if (base.hr <= 60) add('hr', -0.5); else add('hr', 0.3);
                break;
            case 'neuro':
                // Cushing response: falling GCS, rising pressure, falling rate, irregular breathing.
                add('gcs', -0.05); add('bpSys', 0.35); add('hr', -0.2); add('rr', -0.1);
                break;
            case 'arrest':
                add('bpSys', -1.6); add('hr', -1.0); add('spO2', -0.8); add('gcs', -0.08);
                break;
            default: return null;
        }
        // Diastolic follows the systolic so the pair stays coherent through a long decline.
        if (d.bpSys) add('bpDia', d.bpSys * 0.6);
        return d;
    };

    // Integrate one second of deterioration into `base` IN PLACE. Returns true if anything moved.
    const applyDeteriorationTick = (base, type, rate, factor, ownedByTrend) => {
        const deltas = deteriorationDeltas(type, base);
        if (!deltas) return false;
        let moved = false;
        const recovering = factor < 0;
        Object.keys(deltas).forEach(k => {
            if (ownedByTrend && ownedByTrend[k]) return;      // a running trend owns this vital
            if (typeof base[k] !== 'number' || !Number.isFinite(base[k])) return;
            const step = deltas[k] * rate * factor;
            if (!Number.isFinite(step) || step === 0) return;
            let next = base[k] + step;
            const bound = DETERIORATION_BOUND[k];
            if (bound) next = Math.min(bound[1], Math.max(bound[0], next));
            if (recovering) {
                const band = RECOVERY_BAND[k];
                if (band) {
                    // Do not push a vital past normal while recovering, and never move it the wrong
                    // way if it is already inside the band.
                    if (base[k] < band[0]) next = Math.min(next, band[0]);
                    else if (base[k] > band[1]) next = Math.max(next, band[1]);
                    else next = base[k];
                }
            }
            next = clampVital(k, next);
            if (next !== base[k]) { base[k] = next; moved = true; }
        });
        return moved;
    };

    window.__pkInternals = { pkFactor, pkPhase, pkRemaining, drugOffsets, composeVitals, buildDrugEntry, paralysisFromDrugs, deteriorationDeltas, applyDeteriorationTick, deteriorationTreatmentFactor, normaliseDeteriorationType, formatVital, clampVital, DEFAULT_VITALS, EFFECT_TARGETS, VITAL_LIMITS, isDrugSpent };

    const vitalsReducer = (state, action) => {
        const cs = action.currentState;
        switch (action.type) {
            case 'CLEAR_SESSION': return { ...initialVitalsState };
            case 'LOAD_SCENARIO': 
                if(!action.payload) return { ...initialVitalsState };
                const initialVitals = { ...initialVitalsState.vitals, ...action.payload.vitals };
                return { ...initialVitalsState, vitals: initialVitals, baseVitals: { ...initialVitals }, prevVitals: { ...initialVitals } };
            case 'RESTORE_SESSION': {
                const restoredVitals = { ...initialVitalsState.vitals, ...(action.payload.vitals || {}) };
                return { ...state, vitals: restoredVitals, baseVitals: { ...restoredVitals, ...(action.payload.baseVitals || {}) }, prevVitals: { ...restoredVitals, ...(action.payload.prevVitals || {}) }, trends: action.payload.trends || state.trends, hypoxiaTimer: action.payload.hypoxiaTimer || 0 };
            }
            // The monitor does not run physiology; the authoritative composed vitals arrive over the
            // wire, so base == displayed there.
            case 'SYNC_FROM_MASTER': return { ...state, vitals: action.payload.vitals, baseVitals: { ...initialVitalsState.vitals, ...(action.payload.vitals || {}) }, trends: action.payload.trends || state.trends };
            // UPDATE_VITALS writes the BASE (precedence step 1). Displayed vitals are recomposed with
            // the drug envelope so a facilitator/arrest/ROSC write can never silently delete an
            // in-flight drug effect, and a drug effect can never fight an explicit write.
            case 'UPDATE_VITALS': {
                const base = { ...state.baseVitals, ...action.payload };
                const t = cs ? cs.time : 0;
                const inArrest = cs ? PULSELESS_RHYTHMS.indexOf(cs.rhythm) !== -1 : false;
                return { ...state, baseVitals: base, vitals: composeVitals(base, cs ? cs.activeDrugs : [], t, inArrest) };
            }
            case 'MANUAL_VITAL_UPDATE': {
                // Boundary guard: a NaN here propagates into the Firebase payload, which RTDB rejects,
                // and the rejected diff is then retried forever — freezing the student monitor.
                const { key, value } = action.payload;
                if (!isVitalValueSafe(key, value)) return state;
                const t = cs ? cs.time : 0;
                const drugs = cs ? cs.activeDrugs : [];
                const inArrest = cs ? PULSELESS_RHYTHMS.indexOf(cs.rhythm) !== -1 : false;
                // The facilitator types the number they want to SEE. Store it in base space by
                // removing whatever the drugs are currently contributing, so the displayed value is
                // exactly what was asked for and any later wear-off still unwinds correctly.
                let baseValue = value;
                if (typeof value === 'number') {
                    const offs = drugOffsets(drugs, t);
                    const off = (inArrest && ARREST_SUPPRESSED.indexOf(key) !== -1) ? 0 : (offs[key] || 0);
                    baseValue = clampVital(key, value - off);
                }
                const base = { ...state.baseVitals, [key]: baseValue };
                return { ...state, baseVitals: base, vitals: composeVitals(base, drugs, t, inArrest), prevVitals: { ...state.vitals } };
            }
            case 'START_TREND': {
                const safeTargets = {};
                const t0 = cs ? cs.time : 0;
                const offs = drugOffsets(cs ? cs.activeDrugs : [], t0);
                Object.keys(action.payload.targets || {}).forEach(k => {
                    if (!isVitalValueSafe(k, action.payload.targets[k])) return;
                    const raw = action.payload.targets[k];
                    // Targets are given in DISPLAYED space ("take the BP to 90"); convert to base space
                    // by removing the drug contribution present at the moment the trend starts, so the
                    // trend and the envelope add up to the number the facilitator asked for.
                    safeTargets[k] = (typeof raw === 'number' && offs[k]) ? clampVital(k, raw - offs[k]) : raw;
                });
                if (Object.keys(safeTargets).length === 0) return state;
                return { ...state, trends: { active: true, targets: safeTargets, duration: action.payload.duration, elapsed: 0, startVitals: { ...state.baseVitals } } };
            }
            case 'STOP_TREND': return { ...state, trends: { ...state.trends, active: false, elapsed: 0 } };
            case 'TRIGGER_IMPROVE':
            case 'TRIGGER_DETERIORATE': return { ...state, trends: action.payload.trends };
            case 'TICK_TIME': {
                // ===== THE COMPOSITION PIPELINE (precedence order documented at the top of this file).
                // Everything from here to step 5 operates on `base` (unrounded underlying physiology).
                // The drug envelope is added at the very end and is never written into `base`.
                let base = { ...state.baseVitals };
                let vitalsChanged = false;
                let newTrends = { ...state.trends };
                let currentHypoxiaTimer = state.hypoxiaTimer;
                const isRunning = cs ? cs.isRunning : false;
                const activeInt = cs ? cs.activeInterventions : new Set();
                const icp = cs ? cs.icp : 10;
                const scen = cs ? cs.scenario : null;
                const rhythm = cs ? cs.rhythm : 'Sinus Rhythm';
                const cprActive = cs ? cs.cprInProgress : false;
                const inArrest = ['VF', 'VT', 'pVT', 'PEA', 'Asystole'].includes(rhythm);
                const isBagging = isVentilated(activeInt);
                const time0 = cs ? cs.time : 0;
                // coreReducer increments `time` in the same dispatch, so the authoritative clock for
                // this tick is time0 + 1. Every pk/deterioration calculation uses tNow.
                const tNow = time0 + 1;
                const activeDrugs = cs ? (cs.activeDrugs || []) : [];

                // ----- STEP 2: TRENDS. A trend interpolates the BASE from a base-space snapshot
                // towards base-space targets. Because it no longer touches the displayed vitals, the
                // Wave 1 defect where a trend erased a drug effect within one second is structurally
                // impossible: the drug lives in a separate additive layer.
                const trendOwned = {};
                if (newTrends.active) {
                    newTrends.elapsed += 1;
                    const progress = Math.min(1, newTrends.elapsed / newTrends.duration);
                    Object.keys(newTrends.targets).forEach(key => {
                        const startVal = newTrends.startVitals[key];
                        const targetVal = newTrends.targets[key];
                        if (startVal !== undefined && targetVal !== undefined && typeof startVal === 'number' && typeof targetVal === 'number') {
                            base[key] = startVal + ((targetVal - startVal) * progress);
                            trendOwned[key] = true;
                        } else if (startVal !== undefined && targetVal !== undefined) {
                            base[key] = targetVal;   // non-numeric (pupils): snap, never interpolate
                            trendOwned[key] = true;
                        }
                    });
                    if (newTrends.elapsed >= newTrends.duration) {
                        Object.keys(newTrends.targets).forEach(key => { base[key] = newTrends.targets[key]; });
                        newTrends.active = false;
                    }
                    vitalsChanged = true;
                }

                // ----- STEP 3: AUTONOMOUS DETERIORATION (Group C).
                // Gated on deteriorationMode === 'auto'. Integrating into `base` is what guarantees C3:
                // switching modes only starts/stops the integration, so there is no discontinuity in
                // either direction — the current obs ARE the baseline.
                const detMode = cs ? (cs.deteriorationMode || 'manual') : 'manual';
                const det = scen && scen.deterioration ? scen.deterioration : null;
                const detType = det ? normaliseDeteriorationType(det.type) : null;
                const detRate = det ? Number(det.rate) : 0;
                if (isRunning && detMode === 'auto' && det && det.active !== false && detType && Number.isFinite(detRate) && detRate > 0 && !inArrest) {
                    const factor = deteriorationTreatmentFactor(detType, cs);
                    if (factor !== 0 && applyDeteriorationTick(base, detType, detRate, factor, trendOwned)) vitalsChanged = true;
                }

                // ----- STEP 4: AIRWAY / PARALYSIS / HYPOXIA / ETCO2.
                // PARALYSIS is now derived from the SAME activeDrugs entry as the drug's numeric
                // envelope (Wave 1 left a bespoke parallel timer with a note asking for this). Once the
                // blocker's onset has passed, respiration is the ventilator rate if the patient is
                // being ventilated and ZERO if not, which feeds the hypoxia model below.
                const paraFromDrugs = paralysisFromDrugs(activeDrugs, tNow);
                const paraPhase = paraFromDrugs ? 'active' : paralysisPhase(cs ? cs.paralysis : null, tNow);
                if (!inArrest && paraPhase === 'active') {
                    const targetRr = isBagging ? VENTILATOR_RATE : 0;
                    if (base.rr !== targetRr) { base.rr = targetRr; vitalsChanged = true; }
                }

                // Hypoxia: SpO2 falls if hypoventilating or apnoeic without ventilatory support.
                // NOTE this reads the DISPLAYED spO2/rr of the previous tick (state.vitals), because a
                // drug that is currently supporting respiration or oxygenation genuinely should stop
                // the patient desaturating — the model must see what the monitor sees.
                const seenSpO2 = Number.isFinite(state.vitals.spO2) ? state.vitals.spO2 : base.spO2;
                const seenRr = (!inArrest && paraPhase === 'active') ? base.rr : (Number.isFinite(state.vitals.rr) ? state.vitals.rr : base.rr);
                if (!inArrest && seenSpO2 > 0 && (seenRr < 8 || seenRr <= 0) && !isBagging) {
                    currentHypoxiaTimer++;
                    // Pre-oxygenation buys a longer safe apnoea time; apnoeic (nasal) oxygenation
                    // halves the rate of desaturation once it starts.
                    const preoxygenated = activeInt.has('Preoxygenation');
                    const apnoeicO2 = activeInt.has('ApnoeicOxygenation');
                    const graceSeconds = preoxygenated ? 40 : 10;
                    if (currentHypoxiaTimer > graceSeconds) {
                        // Steeper drop below 88 (Severinghaus curve)
                        let dropRate = seenSpO2 < 88 ? 1.5 : 0.5;
                        if (apnoeicO2) dropRate = dropRate / 2;
                        base.spO2 = Math.max(20, base.spO2 - dropRate);
                        vitalsChanged = true;
                    }
                } else {
                    currentHypoxiaTimer = 0;
                    // Recovery. Wave 1 had to step a whole point every 3 s because SpO2 was stored as
                    // an integer and +0.2/s rounded straight back. `base` is now unrounded, so a smooth
                    // +0.35/s is both correct and visible. Count any positive-pressure or high-flow
                    // source, not just the 'Oxygen' key.
                    const oxygenSource = activeInt.has('Oxygen') || activeInt.has('Preoxygenation') || activeInt.has('ApnoeicOxygenation') || isBagging;
                    if (oxygenSource && base.spO2 < 98) { base.spO2 = Math.min(98, base.spO2 + 0.35); vitalsChanged = true; }
                }

                if (scen && scen.deterioration && normaliseDeteriorationType(scen.deterioration.type) === 'neuro' && isRunning) {
                    if (icp > 25) { base.bpSys = Math.min(220, base.bpSys + 0.2); base.bpDia = Math.min(180, base.bpDia + 0.12); base.hr = Math.max(30, base.hr - 0.1); vitalsChanged = true; }
                }

                // ETCO2 dynamics — non-arrest hyperventilation/hypoventilation
                if (!inArrest) {
                    if (base.rr > 30) { base.etco2 = Math.max(2.5, base.etco2 - 0.01); vitalsChanged = true; }
                    if (base.rr < 10 && base.rr > 0) { base.etco2 = Math.min(8.0, base.etco2 + 0.01); vitalsChanged = true; }
                } else {
                    // Arrest ETCO2 — responds to CPR quality and bagging (key clinical marker)
                    let targetEtco2 = 0.8; // poor/no perfusion baseline
                    if (cprActive) targetEtco2 += 1.2;
                    if (isBagging) targetEtco2 += 1.0;
                    if (cprActive && isBagging) targetEtco2 += 0.5; // synergy
                    const delta = targetEtco2 - base.etco2;
                    if (Math.abs(delta) > 0.02) {
                        base.etco2 = base.etco2 + delta * 0.15;
                        vitalsChanged = true;
                    }
                }

                // ----- STEPS 5 + 6: add the drug envelope, clamp, round. Recomposed EVERY tick from
                // `base` so offsets can never accumulate rounding error, and so a drug wearing off
                // unwinds exactly back onto the underlying trajectory.
                Object.keys(base).forEach(k => {
                    if (typeof base[k] === 'number') {
                        if (!Number.isFinite(base[k])) base[k] = state.baseVitals[k];
                        else base[k] = clampVital(k, base[k]);
                    }
                });
                const composed = composeVitals(base, activeDrugs, tNow, inArrest);
                // A live drug envelope changes the numbers even on a tick where nothing else moved.
                if (!vitalsChanged) {
                    for (const k in composed) { if (composed[k] !== state.vitals[k]) { vitalsChanged = true; break; } }
                }

                // Snapshot prevVitals every 15 seconds so trend arrows reflect recent direction.
                const time = cs ? cs.time : 0;
                let nextPrev = state.prevVitals;
                if (time > 0 && time % 15 === 0) {
                    nextPrev = { ...state.vitals };
                }

                return { ...state, baseVitals: base, vitals: vitalsChanged ? composed : state.vitals, prevVitals: nextPrev, trends: newTrends, hypoxiaTimer: currentHypoxiaTimer };
            }
            default: return state;
        }
    };

    const logReducer = (state, action) => {
        const cs = action.currentState;
        switch (action.type) {
            case 'CLEAR_SESSION': return { ...initialLogState };
            case 'LOAD_SCENARIO': return { ...initialLogState };
            case 'RESTORE_SESSION': return { log: action.payload.log || [], history: action.payload.history || [] };
            case 'START_SIM': return { ...state, log: [...state.log, { time: new Date().toLocaleTimeString(), simTime: '00:00', msg: "Simulation Started", type: 'system' }] };
            case 'PAUSE_SIM': return { ...state, log: [...state.log, { time: new Date().toLocaleTimeString(), simTime: cs ? `${Math.floor(cs.time/60)}:${(cs.time%60).toString().padStart(2,'0')}` : '', msg: "Simulation Paused", type: 'system' }] };
            case 'ADD_LOG': 
                const timestamp = new Date().toLocaleTimeString('en-GB'); 
                const simTime = cs ? `${Math.floor(cs.time/60).toString().padStart(2,'0')}:${(cs.time%60).toString().padStart(2,'0')}` : '00:00'; 
                // `deviation` carries the structured "performed WITHOUT" record so the debrief can
                // render a Sequence deviations card rather than re-parsing log text.
                return { ...state, log: [...state.log, { time: timestamp, simTime, msg: action.payload.msg, type: action.payload.type, flagged: action.payload.flagged || false, deviation: action.payload.deviation || null, timeSeconds: cs ? cs.time : 0 }] };
            case 'TOGGLE_FLAG':
                const newLog = [...state.log];
                if(newLog[action.payload]) { newLog[action.payload] = { ...newLog[action.payload], flagged: !newLog[action.payload].flagged }; }
                return { ...state, log: newLog };
            case 'TICK_TIME':
                const time = cs ? cs.time : 0;
                const vitals = cs ? cs.vitals : {};
                if (time % 5 === 0) {
                    // B2: temp / bm / ph are modelled vitals now, so they belong in the debrief trace
                    // too (the graph plots HR/BP/SpO2; the replay scrubber reads the rest).
                    return { ...state, history: [...state.history, { time: time, hr: vitals.hr, bp: vitals.bpSys, spo2: vitals.spO2, rr: vitals.rr, temp: vitals.temp, bm: vitals.bm, ph: vitals.ph, gcs: vitals.gcs }] };
                }
                return state;
            default: return state;
        }
    };

    const scenarioReducer = (state, action) => {
        switch (action.type) {
            case 'CLEAR_SESSION': return { ...initialScenarioState };
            case 'LOAD_SCENARIO': return { ...initialScenarioState, scenario: action.payload };
            case 'RESTORE_SESSION': return { scenario: window.rehydrateScenario(action.payload.scenario), investigationsRevealed: action.payload.investigationsRevealed || {}, loadingInvestigations: action.payload.loadingInvestigations || {} };
            case 'SYNC_FROM_MASTER': 
                const syncedScenario = { 
                    ...state.scenario, 
                    title: action.payload.scenarioTitle, patientName: action.payload.patientName,
                    patientAge: action.payload.patientAge, sex: action.payload.sex, ageRange: action.payload.ageRange,
                    wetflag: action.payload.wetflag, deterioration: { type: action.payload.pathology },
                    ...action.payload.investigations 
                };
                return { ...state, scenario: syncedScenario };
            case 'UPDATE_SCENARIO': return { ...state, scenario: action.payload };
            case 'REVEAL_INVESTIGATION': return { ...state, investigationsRevealed: { ...state.investigationsRevealed, [action.payload]: true }, loadingInvestigations: { ...state.loadingInvestigations, [action.payload]: false } };
            case 'SET_LOADING_INVESTIGATION': return { ...state, loadingInvestigations: { ...state.loadingInvestigations, [action.payload]: true } };
            default: return state;
        }
    };

    const coreReducer = (state, action) => {
        const cs = action.currentState;
        switch (action.type) {
            case 'CLEAR_SESSION': return { ...initialCoreState, isOffline: state.isOffline, syncStatus: state.syncStatus };
            case 'LOAD_SCENARIO': 
                if(!action.payload) return { ...initialCoreState, isOffline: state.isOffline, syncStatus: state.syncStatus };
                const initialRhythm = (action.payload.ecg && action.payload.ecg.type) ? action.payload.ecg.type : "Sinus Rhythm";
                let startICP = 10;
                if(action.payload.category === 'Trauma' && (action.payload.title || '').includes('Head')) startICP = 25;
                // C5: default to AUTO for any scenario that declares deterioration, MANUAL otherwise.
                // The mode is logged at scenario start and on every change so a facilitator who never
                // touches the toggle is never surprised by moving numbers.
                const det0 = action.payload.deterioration || null;
                const detMode0 = (det0 && det0.active && normaliseDeteriorationType(det0.type) && Number(det0.rate) > 0) ? 'auto' : 'manual';
                return { ...initialCoreState, rhythm: initialRhythm, icp: startICP, isOffline: state.isOffline, syncStatus: state.syncStatus, showWetflag: action.payload.showWetflag !== false, deteriorationMode: detMode0 };
            case 'RESTORE_SESSION': {
                // Whitelist, never spread. coreState is merged LAST in useSimulation, so any `vitals`,
                // `log` or `scenario` key carried in from the snapshot would shadow the live values
                // owned by the other three reducers for the rest of the session.
                const p = action.payload || {};
                return { ...state,
                    time: p.time || 0, cycleTimer: p.cycleTimer || 0, rhythm: p.rhythm || state.rhythm,
                    interventionCounts: p.interventionCounts || {}, activeDurations: p.activeDurations || {},
                    nibp: p.nibp || state.nibp, etco2Enabled: !!p.etco2Enabled,
                    isParalysed: !!p.isParalysed, paralysis: p.paralysis || { active: !!p.isParalysed, agent: null, startTime: 0, onset: 0, duration: 0 },
                    showWetflag: p.showWetflag !== false,
                    icp: p.icp === undefined || p.icp === null ? 10 : p.icp,
                    activeDrugs: Array.isArray(p.activeDrugs) ? p.activeDrugs : [],
                    deteriorationMode: p.deteriorationMode === 'auto' ? 'auto' : 'manual',
                    activeInterventions: new Set(p.activeInterventions || []),
                    processedEvents: new Set(p.processedEvents || []),
                    completedObjectives: new Set(p.completedObjectives || []),
                    isRunning: false };
            }
            case 'START_SIM': return { ...state, isRunning: true, isFinished: false };
            case 'PAUSE_SIM': return { ...state, isRunning: false };
            case 'STOP_SIM': return { ...state, isRunning: false, isFinished: true };
            case 'SET_OFFLINE': return { ...state, isOffline: action.payload };
            case 'SET_SYNC_STATUS': {
                const syncStatus = {
                    state: action.payload?.state || 'error',
                    message: action.payload?.message || null,
                    lastWriteAt: action.payload?.lastWriteAt || state.syncStatus?.lastWriteAt || null
                };
                return { ...state, syncStatus, isOffline: SYNC_OFFLINE_STATES.has(syncStatus.state) };
            }
            case 'TICK_TIME':
                const newDurations = { ...state.activeDurations }; 
                let durChanged = false;
                Object.keys(newDurations).forEach(key => { 
                    const elapsed = state.time + 1 - newDurations[key].startTime; 
                    if (elapsed >= newDurations[key].duration) { delete newDurations[key]; durChanged = true; } 
                });
                let newNibp = { ...state.nibp }; 
                if (newNibp.mode === 'auto') { newNibp.timer -= 1; }
                let currentICP = state.icp;
                if (cs && cs.scenario && cs.scenario.deterioration && cs.scenario.deterioration.type === 'neuro' && state.isRunning) {
                    if (state.time % 10 === 0) currentICP += 0.1; 
                }
                
                let newMonitorTimer = { ...state.monitorTimer };
                if (newMonitorTimer.active) { newMonitorTimer.time += 1; }

                const tNext = state.time + 1;

                // Retire spent drug entries so activeDrugs cannot grow without bound over a long
                // session. A spent entry contributes exactly zero, so pruning is observationally free.
                let nextDrugs = state.activeDrugs || [];
                const kept = nextDrugs.filter(d => !isDrugSpent(d, tNext) && !(d.reversed && pkFactor(d, tNext) <= 0));
                if (kept.length !== nextDrugs.length) nextDrugs = kept;

                // Neuromuscular blockade wears off. Sux (~8 min) and roc (~45 min) therefore diverge,
                // and the patient is no longer permanently paralysed after a single dose. Derived from
                // the activeDrugs entry — ONE timer, per the Wave 1 note.
                const para = paralysisFromDrugs(nextDrugs, tNext);
                let nextParalysis = state.paralysis;
                let nextIsParalysed = state.isParalysed;
                if (para) {
                    if (!state.paralysis.active || state.paralysis.agent !== para.agent || state.paralysis.startTime !== para.startTime) {
                        nextParalysis = { active: true, agent: para.agent, startTime: para.startTime, onset: para.onset, duration: para.duration };
                    }
                    nextIsParalysed = true;
                } else if (state.paralysis.active || state.isParalysed) {
                    // Either the blockade expired or there never was an activeDrugs entry (legacy
                    // restored session). Keep honouring an explicit legacy timer until it expires.
                    const legacy = !state.activeDrugs.some(d => d.paralytic) && paralysisPhase(state.paralysis, tNext) === 'active';
                    if (!legacy) {
                        nextParalysis = { active: false, agent: null, startTime: 0, onset: 0, duration: 0 };
                        nextIsParalysed = false;
                    }
                }

                return { ...state, time: tNext, cycleTimer: state.cycleTimer + 1, activeDurations: durChanged ? newDurations : state.activeDurations, nibp: newNibp, icp: currentICP, monitorTimer: newMonitorTimer, activeDrugs: nextDrugs, paralysis: nextParalysis, isParalysed: nextIsParalysed };
            
            case 'TOGGLE_MONITOR_TIMER': return { ...state, monitorTimer: { ...state.monitorTimer, visible: !state.monitorTimer.visible } };
            case 'START_MONITOR_TIMER': return { ...state, monitorTimer: { ...state.monitorTimer, active: true } };
            case 'PAUSE_MONITOR_TIMER': return { ...state, monitorTimer: { ...state.monitorTimer, active: false } };
            case 'RESET_MONITOR_TIMER': return { ...state, monitorTimer: { ...state.monitorTimer, time: 0 } };
            
            case 'RESET_CYCLE_TIMER': return { ...state, cycleTimer: 0 };
            case 'UPDATE_RHYTHM': return { ...state, rhythm: action.payload };
            case 'START_NIBP': return { ...state, nibp: { ...state.nibp, inflating: true } };
            case 'COMMIT_NIBP': 
                const safeSys = cs && cs.vitals.bpSys ? cs.vitals.bpSys : 0;
                const safeDia = cs && cs.vitals.bpDia ? cs.vitals.bpDia : 0;
                const now = new Date();
                const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
                const newEntry = { sys: safeSys, dia: safeDia, time: timeStr };
                const newHistoryArr = [newEntry, ...(state.nibp.history || [])].slice(0, 3);
                return { ...state, nibp: { ...state.nibp, sys: safeSys, dia: safeDia, lastTaken: Date.now(), timer: state.nibp.interval, inflating: false, history: newHistoryArr } };
            case 'TOGGLE_NIBP_MODE': const newMode = state.nibp.mode === 'manual' ? 'auto' : 'manual'; return { ...state, nibp: { ...state.nibp, mode: newMode, timer: newMode === 'auto' ? state.nibp.interval : 0 } };
            case 'SET_NIBP': return { ...state, nibp: { ...state.nibp, sys: action.payload.sys, dia: action.payload.dia, lastTaken: Date.now(), inflating: false } };
            case 'TRIGGER_SPEAK': return { ...state, speech: { text: action.payload, timestamp: Date.now(), source: 'controller' } };
            case 'TRIGGER_SOUND': return { ...state, soundEffect: { type: action.payload, timestamp: Date.now() } };
            case 'SET_AUDIO_OUTPUT': return { ...state, audioOutput: action.payload };
            case 'SYNC_FROM_MASTER': return { ...state,
                // isRunning / isMuted / activeLoops are what make the STUDENT MONITOR audible: every
                // audio path in this file is gated on isRunning, which the monitor can only learn
                // about over the wire because it never calls start() itself.
                isRunning: !!action.payload.isRunning,
                isMuted: !!action.payload.isMuted,
                activeLoops: action.payload.activeLoops || {},
                isParalysed: !!action.payload.isParalysed,
                activeDrugs: Array.isArray(action.payload.activeDrugs) ? action.payload.activeDrugs : [],
                deteriorationMode: action.payload.deteriorationMode === 'auto' ? 'auto' : 'manual',
                rhythm: action.payload.rhythm, cprInProgress: action.payload.cprInProgress, etco2Enabled: action.payload.etco2Enabled, etco2Pathology: action.payload.co2Pathology || 'normal', flash: action.payload.flash, cycleTimer: action.payload.cycleTimer, activeInterventions: new Set(action.payload.activeInterventions || []), nibp: action.payload.nibp || state.nibp, speech: action.payload.speech || state.speech, soundEffect: action.payload.soundEffect || state.soundEffect, audioOutput: action.payload.audioOutput || 'monitor', arrestPanelOpen: action.payload.arrestPanelOpen !== undefined ? action.payload.arrestPanelOpen : state.arrestPanelOpen, isFinished: action.payload.isFinished || false, monitorPopup: action.payload.monitorPopup || state.monitorPopup, waveformGain: action.payload.waveformGain || 1.0, noise: action.payload.noise || { interference: false }, notification: action.payload.notification || null, remotePacerState: action.payload.remotePacerState || {rate: 0, output: 0}, pacingThreshold: action.payload.pacingThreshold || 70, lastUpdate: Date.now(), showWetflag: action.payload.showWetflag !== undefined ? action.payload.showWetflag : true, monitorTimer: action.payload.monitorTimer || state.monitorTimer };
            case 'UPDATE_ASSESSMENT': return { ...state, assessments: action.payload };
            case 'SET_FLASH': return { ...state, flash: action.payload };
            case 'START_INTERVENTION_TIMER': return { ...state, activeDurations: { ...state.activeDurations, [action.payload.key]: { startTime: state.time, duration: action.payload.duration } } };
            // --- PK envelope bookkeeping -------------------------------------------------------
            case 'ADD_ACTIVE_DRUG': {
                if (!action.payload) return state;
                // Re-starting a continuous infusion that is still decaying: revive that entry rather
                // than stacking a second one, so stopping and restarting a pressor is not a dose.
                const existing = (state.activeDrugs || []).findIndex(d => d.key === action.payload.key && d.sustained && d.stopTime >= 0);
                if (existing !== -1 && action.payload.sustained) {
                    const revived = state.activeDrugs.slice();
                    revived[existing] = { ...revived[existing], stopTime: -1 };
                    return { ...state, activeDrugs: revived };
                }
                return { ...state, activeDrugs: [...(state.activeDrugs || []), action.payload] };
            }
            case 'STOP_ACTIVE_DRUG': {
                // A continuous intervention was switched off: start its offset tail from now.
                let changed = false;
                const next = (state.activeDrugs || []).map(d => {
                    if (d.key === action.payload && d.sustained && d.stopTime < 0) { changed = true; return { ...d, stopTime: state.time }; }
                    return d;
                });
                return changed ? { ...state, activeDrugs: next } : state;
            }
            case 'REVERSE_PARALYSIS_DRUGS': {
                let changed = false;
                const next = (state.activeDrugs || []).map(d => {
                    if (d.paralytic && !d.reversed) { changed = true; return { ...d, reversed: true, paralysisEnd: Math.max(1, state.time - d.startTime) }; }
                    return d;
                });
                if (!changed) return state;
                return { ...state, activeDrugs: next, isParalysed: false, paralysis: { active: false, agent: null, startTime: 0, onset: 0, duration: 0 } };
            }
            case 'SET_DETERIORATION_MODE':
                return { ...state, deteriorationMode: action.payload === 'auto' ? 'auto' : 'manual' };
            case 'UPDATE_INTERVENTION_STATE': return { ...state, activeInterventions: action.payload.active, interventionCounts: action.payload.counts };
            case 'REMOVE_INTERVENTION': {
                const removedActive = new Set(state.activeInterventions); removedActive.delete(action.payload);
                const removedDurations = { ...state.activeDurations }; delete removedDurations[action.payload];
                // Stopping an infusion/device starts its offset tail rather than deleting the effect.
                const stopped = (state.activeDrugs || []).map(d => (d.key === action.payload && d.sustained && d.stopTime < 0) ? { ...d, stopTime: state.time } : d);
                return { ...state, activeInterventions: removedActive, activeDurations: removedDurations, activeDrugs: stopped };
            }
            case 'DECREMENT_INTERVENTION': const decKey = action.payload; const decCounts = { ...state.interventionCounts }; if (decCounts[decKey] > 0) decCounts[decKey]--; return { ...state, interventionCounts: decCounts };
            case 'SET_PARALYSIS': {
                // Accepts either a bare boolean (legacy) or { active, agent, onset, duration }.
                const p = action.payload;
                if (typeof p === 'boolean') {
                    return { ...state, isParalysed: p, paralysis: p ? { ...state.paralysis, active: true } : { active: false, agent: null, startTime: 0, onset: 0, duration: 0 } };
                }
                if (!p || p.active === false) {
                    return { ...state, isParalysed: false, paralysis: { active: false, agent: null, startTime: 0, onset: 0, duration: 0 } };
                }
                return { ...state, isParalysed: true, paralysis: { active: true, agent: p.agent || null, startTime: p.startTime !== undefined ? p.startTime : state.time, onset: p.onset || 0, duration: p.duration || 0 } };
            }
            case 'TRIGGER_POPUP': {
                const p = (action.payload && typeof action.payload === 'object') ? action.payload : { type: action.payload, customText: action.customText || null };
                return { ...state, monitorPopup: { type: p.type, timestamp: Date.now(), customText: p.customText !== undefined ? p.customText : null } };
            }
            case 'CLEAR_POPUP': return { ...state, monitorPopup: { type: null, timestamp: Date.now(), customText: null } };
            case 'SET_MUTED': return { ...state, isMuted: action.payload };
            case 'TOGGLE_ETCO2': return { ...state, etco2Enabled: !state.etco2Enabled };
            case 'SET_ETCO2_PATHOLOGY': return { ...state, etco2Pathology: action.payload };
            case 'TOGGLE_CPR': return { ...state, cprInProgress: action.payload };
            case 'SET_QUEUED_RHYTHM': return { ...state, queuedRhythm: action.payload };
            case 'FAST_FORWARD': return { ...state, time: state.time + action.payload };
            case 'MARK_EVENT_PROCESSED': const newEvents = new Set(state.processedEvents); newEvents.add(action.payload); return { ...state, processedEvents: newEvents };
            case 'SET_ARREST_PANEL': return { ...state, arrestPanelOpen: action.payload };
            case 'SET_GAIN': return { ...state, waveformGain: action.payload };
            case 'TOGGLE_INTERFERENCE': return { ...state, noise: { ...state.noise, interference: !state.noise.interference } };
            case 'UPDATE_PACER_STATE': return { ...state, remotePacerState: action.payload };
            case 'SET_NOTIFICATION': return { ...state, notification: action.payload };
            case 'UPDATE_AUDIO_LOOPS': return { ...state, activeLoops: action.payload };
            case 'COMPLETE_OBJECTIVE': const newObjs = new Set(state.completedObjectives); newObjs.add(action.payload); return { ...state, completedObjectives: newObjs };
            case 'SET_WETFLAG_VISIBILITY': return { ...state, showWetflag: action.payload };
            default: return state;
        }
    };

    // Test hook. The reducers are the physiology, so the Node verification harness reduces the REAL
    // ones rather than a reimplementation — that is the only way the composition and no-discontinuity
    // guarantees are actually proven rather than asserted about a copy.
    window.__pkInternals.reducers = { vitalsReducer, coreReducer, logReducer, scenarioReducer, initialVitalsState, initialCoreState, initialLogState, initialScenarioState };
    // The Firebase payload contract is verified too, so the sanitiser has to be reachable.
    window.__pkInternals.sanitizeForRealtimeDatabase = sanitizeForRealtimeDatabase;

    const useSimulation = (initialScenario, isMonitorMode = false, sessionID = null) => {
        const [vitalsState, dispatchVitals] = useReducer(vitalsReducer, initialVitalsState);
        const [logState, dispatchLog] = useReducer(logReducer, initialLogState);
        const [scenarioState, dispatchScenario] = useReducer(scenarioReducer, initialScenarioState);
        const [coreState, dispatchCore] = useReducer(coreReducer, initialCoreState);

        const state = { ...vitalsState, ...logState, ...scenarioState, ...coreState };
        const timerRef = useRef(null);
        const tickRef = useRef(null);
        const audioCtxRef = useRef(null);
        const loopNodesRef = useRef({}); 
        const stateRef = useRef(state);
        const lastCmdRef = useRef(0);
        const lastPayloadRef = useRef({});
        
        // The local defib bridge is optional — everything clinical goes over Firebase. Older iOS
        // Safari and locked-down MDM profiles have no BroadcastChannel, and throwing here would
        // blank the whole controller before the ErrorBoundary could render a fallback.
        const simChannel = useRef(null);
        const channelReady = useRef(false);
        if (!channelReady.current) {
            channelReady.current = true;
            try { simChannel.current = ('BroadcastChannel' in window) ? new BroadcastChannel('sim_channel') : null; }
            catch (e) { console.warn('BroadcastChannel unavailable — defib bridge disabled', e); simChannel.current = null; }
        }
        const postToChannel = (msg) => { if (simChannel.current) { try { simChannel.current.postMessage(msg); } catch (e) { console.warn('Channel post failed', e); } } };

        useEffect(() => { stateRef.current = state; }, [state]);

        const dispatch = (action) => {
            let enhancedAction = { ...action, currentState: stateRef.current };
            
            if (action.type === 'TRIGGER_IMPROVE') {
                let impTargets = {}; 
                const scen = stateRef.current.scenario;
                const vits = stateRef.current.vitals;
                if (scen && scen.evolution && scen.evolution.improved && scen.evolution.improved.vitals) { impTargets = { ...scen.evolution.improved.vitals }; } 
                else { impTargets.hr = Math.max(60, vits.hr - 15); impTargets.bpSys = Math.min(120, vits.bpSys + 15); impTargets.spO2 = Math.min(99, vits.spO2 + 5); }
                // Trends operate in BASE space (see the precedence comment): snapshot the base, not
                // the displayed vitals, or the trend would swallow whatever the drugs are contributing.
                enhancedAction = { ...enhancedAction, payload: { trends: { active: true, targets: impTargets, duration: 30, elapsed: 0, startVitals: { ...stateRef.current.baseVitals } } } };
                if (scen?.vbg && window.calculateDynamicVbg) {
                    dispatchScenario({ type: 'UPDATE_SCENARIO', payload: { ...scen, vbg: window.calculateDynamicVbg(scen.vbg, vits, stateRef.current.activeInterventions, 0, 'improve') }, currentState: stateRef.current });
                }
                dispatchCore({ type: 'SET_FLASH', payload: 'green', currentState: stateRef.current });
            }
            if (action.type === 'TRIGGER_DETERIORATE') {
                 let detTargets = {};
                 const scen = stateRef.current.scenario;
                 const vits = stateRef.current.vitals;
                 if (scen && scen.evolution && scen.evolution.deteriorated && scen.evolution.deteriorated.vitals) { detTargets = { ...scen.evolution.deteriorated.vitals }; } 
                 else { detTargets.hr = Math.min(170, vits.hr + 20); detTargets.bpSys = Math.max(60, vits.bpSys - 20); detTargets.spO2 = Math.max(80, vits.spO2 - 10); }
                 enhancedAction = { ...enhancedAction, payload: { trends: { active: true, targets: detTargets, duration: 30, elapsed: 0, startVitals: { ...stateRef.current.baseVitals } } } };
                 if (scen?.vbg && window.calculateDynamicVbg) {
                     dispatchScenario({ type: 'UPDATE_SCENARIO', payload: { ...scen, vbg: window.calculateDynamicVbg(scen.vbg, vits, stateRef.current.activeInterventions, 0, 'deteriorate') }, currentState: stateRef.current });
                 }
                 dispatchCore({ type: 'SET_FLASH', payload: 'red', currentState: stateRef.current });
            }

            if (action.type === 'UPDATE_RHYTHM') {
                const newRhythm = action.payload;
                // 'VT' is deliberately absent: it is offered in the general rhythm list and is commonly
                // taught as VT-with-a-pulse. Only the unambiguously pulseless rhythms zero the numbers.
                const PULSELESS = ['VF', 'pVT', 'Asystole', 'PEA'];
                const isArrest = ['VF', 'VT', 'pVT', 'Asystole', 'PEA'].includes(newRhythm);
                const cur = stateRef.current;
                // Rhythm-driven vitals are a facilitator-level write: they target the BASE.
                let rhythmVitals = { ...cur.baseVitals };

                if (PULSELESS.includes(newRhythm)) {
                    // A shockable/pulseless rhythm showing a pre-arrest BP and SpO2 is clinically
                    // contradictory; the numeric panel must agree with the trace.
                    if (rhythmVitals.hr > 0 || rhythmVitals.bpSys > 0) {
                        dispatchVitals({ type: 'STOP_TREND', currentState: cur });
                        rhythmVitals = { ...rhythmVitals, hr: 0, bpSys: 0, bpDia: 0, spO2: 0, rr: 0, gcs: 3, pupils: 'Dilated', etco2: 1.5 };
                    }
                } else if (PULSELESS.includes(cur.rhythm)) {
                    // Coming out of a pulseless rhythm into an organised one — an organised rhythm must
                    // never be left displaying HR 0.
                    const age = cur.scenario?.patientAge ?? 40;
                    const base = (window.getBaseVitals ? window.getBaseVitals(age) : { hr: 80, rr: 16, bpSys: 110, bpDia: 70 });
                    dispatchVitals({ type: 'STOP_TREND', currentState: cur });
                    rhythmVitals = { ...rhythmVitals, hr: base.hr, bpSys: base.bpSys, bpDia: base.bpDia, spO2: 94, rr: base.rr, gcs: 8, pupils: 3, etco2: Math.round((5.0 + Math.random() * 1.5) * 10) / 10 };
                }

                if (!cur.arrestPanelOpen && !isArrest) {
                    if (newRhythm === 'AF') rhythmVitals.hr = getRandomInt(110, 150);
                    if (newRhythm === 'SVT') rhythmVitals.hr = getRandomInt(170, 200);
                    if (newRhythm === 'Complete Heart Block') rhythmVitals.hr = getRandomInt(35, 45);
                    if (newRhythm === 'Sinus Bradycardia') rhythmVitals.hr = getRandomInt(40, 50);
                    if (newRhythm === 'Sinus Tachycardia') rhythmVitals.hr = getRandomInt(110, 130);
                    if (newRhythm === 'Atrial Flutter') rhythmVitals.hr = 150; 
                }
                dispatchVitals({ type: 'UPDATE_VITALS', payload: rhythmVitals, currentState: stateRef.current });
            }

            dispatchVitals(enhancedAction);
            dispatchLog(enhancedAction);
            dispatchScenario(enhancedAction);
            dispatchCore(enhancedAction);
        };

        // Register BroadcastChannel handler ONCE — read live state via stateRef to avoid stale closures.
        useEffect(() => {
            if (isMonitorMode || !simChannel.current) return;
            simChannel.current.onmessage = (event) => {
                const data = event.data;
                const cur = stateRef.current;

                // While paused, log the student's action instead of discarding it. The defib shows its
                // own local banner, so a dropped press leaves the two screens silently disagreeing.
                // PACER_UPDATE is device state, not a clinical action — it must stay in sync even paused,
                // otherwise the facilitator's capture threshold view drifts from the student's dial.
                if (!cur.isRunning && data.type !== 'PACER_UPDATE') {
                    const pausedLabels = {
                        SHOCK_DELIVERED: `student pressed SHOCK (${data.payload?.energy ?? '?'}J)`,
                        CHARGE_INIT: `student pressed CHARGE (${data.payload?.energy ?? '?'}J)`,
                        MARKER_EVENT: 'student marked event',
                        CHECK_PULSE: 'student checked pulse',
                        ANALYSIS_RESULT: `defib analysis: ${data.payload?.result || 'unknown result'}`,
                        ALARM_SILENCE: 'student silenced alarm',
                        REQUEST_12LEAD: 'student requested 12-lead',
                        DEVICE_MODE: `student set device mode to ${data.payload?.mode ?? '?'}`
                    };
                    if (pausedLabels[data.type]) {
                        dispatch({ type: 'ADD_LOG', payload: { msg: `(paused) ${pausedLabels[data.type]}`, type: 'system' } });
                    }
                    return;
                }

                if (data.type === 'PACER_UPDATE') {
                    dispatch({ type: 'UPDATE_PACER_STATE', payload: data.payload });
                } else if (data.type === 'CHARGE_INIT') {
                    initCharge(data.payload.energy);
                } else if (data.type === 'SHOCK_DELIVERED') {
                    deliverShock(data.payload.energy, 'student');
                } else if (data.type === 'CHECK_PULSE') {
                    dispatch({ type: 'ADD_LOG', payload: { msg: 'Student Checked Pulse', type: 'action' } });
                } else if (data.type === 'ANALYSIS_RESULT') {
                    dispatch({ type: 'ADD_LOG', payload: { msg: `Defib Analysis: ${data.payload?.result || 'Unknown result'}`, type: 'action' } });
                } else if (data.type === 'ALARM_SILENCE') {
                    dispatch({ type: 'ADD_LOG', payload: { msg: 'Alarm Silenced by Student', type: 'info' } });
                } else if (data.type === 'MARKER_EVENT') {
                    dispatch({ type: 'ADD_LOG', payload: { msg: 'Student Marked Event', type: 'manual', flagged: true } });
                } else if (data.type === 'REQUEST_12LEAD') {
                    dispatch({ type: 'ADD_LOG', payload: { msg: 'Student Requested 12-Lead', type: 'action' } });
                    // Send only the fields render12LeadDefib reads. The full scenario still carries
                    // ageGenerator(), and a function makes postMessage throw DataCloneError.
                    const s = cur.scenario || {};
                    postToChannel({ type: 'SHOW_12LEAD', payload: {
                        rhythm: cur.rhythm, hr: cur.vitals.hr,
                        scenario: { patientName: s.patientName, ecg: s.ecg || null, investigations: { ecg: s.investigations?.ecg || null } }
                    } });
                } else if (data.type === 'DEVICE_MODE') {
                    if (data.payload.mode === 'defib' || data.payload.mode === 'pacer') {
                        dispatch({ type: 'SET_ARREST_PANEL', payload: true });
                    }
                }
            };
            return () => { if (simChannel.current) simChannel.current.onmessage = null; };
        }, [isMonitorMode]);

        useEffect(() => {
            if (!isMonitorMode) {
                postToChannel({
                    type: 'SYNC_VITALS',
                    payload: {
                        rhythm: state.rhythm, hr: state.vitals.hr, spO2: state.vitals.spO2,
                        etco2: state.vitals.etco2, bpSys: state.vitals.bpSys, bpDia: state.vitals.bpDia,
                        gain: state.waveformGain, interference: state.noise.interference,
                        cpr: state.cprInProgress, captureThreshold: state.pacingThreshold,
                        audioOutput: state.audioOutput 
                    }
                });
            }
        }, [state.vitals, state.rhythm, state.waveformGain, state.noise, state.pacingThreshold, state.audioOutput]);

        useEffect(() => {
            const db = window.db;
            if (!db) {
                const bootstrap = window.firebaseSyncBootstrap || {};
                dispatch({
                    type: 'SET_SYNC_STATUS',
                    payload: {
                        state: bootstrap.state === 'unavailable' ? 'unavailable' : 'error',
                        message: bootstrap.message || 'Firebase Realtime Database is unavailable.'
                    }
                });
                return;
            }

            dispatch({ type: 'SET_SYNC_STATUS', payload: { state: 'connecting', message: 'Connecting to live session…' } });
            const connectionRef = db.ref('.info/connected');
            const onConnection = (snap) => {
                if (snap.val() === true) {
                    dispatch({ type: 'SET_SYNC_STATUS', payload: { state: 'connected', message: null } });
                } else {
                    dispatch({ type: 'SET_SYNC_STATUS', payload: { state: 'disconnected', message: 'Realtime Database connection is unavailable.' } });
                }
            };
            const onConnectionError = (error) => {
                console.error('Firebase connection-state listener failed:', error);
                dispatch({ type: 'SET_SYNC_STATUS', payload: { state: 'error', message: `Firebase connection error: ${error.message || 'unknown error'}` } });
            };
            connectionRef.on('value', onConnection, onConnectionError);
            return () => connectionRef.off('value', onConnection);
        }, []);

        // Firebase sync — throttled to 500ms; reads live state from stateRef so we don't depend on
        // the whole `state` object identity (which changes every render).
        const syncTimerRef = useRef(null);
        useEffect(() => {
            const db = window.db;
            if (!db || !sessionID || isMonitorMode || !state.scenario) return;
            const sessionRef = db.ref(`sessions/${sessionID}`);

            const flush = () => {
                syncTimerRef.current = null;
                const cur = stateRef.current;
                if (!cur.scenario) return;
                const co2Pathology = cur.etco2Pathology || 'normal';
                const payload = {
                    vitals: cur.vitals, rhythm: cur.rhythm, cprInProgress: cur.cprInProgress,
                    etco2Enabled: cur.etco2Enabled, flash: cur.flash, cycleTimer: cur.cycleTimer,
                    monitorTimer: cur.monitorTimer,
                    scenarioTitle: cur.scenario.title || '', patientName: cur.scenario.patientName || '',
                    patientAge: cur.scenario.patientAge, sex: cur.scenario.sex,
                    ageRange: cur.scenario.ageRange, wetflag: cur.scenario.wetflag || null,
                    pathology: cur.scenario.deterioration?.type || 'normal',
                    // Investigations: enrichScenario writes generated CXR/CT/urine/POCUS reports to
                    // scenario.investigations.*, but this payload previously read only the top-level
                    // fields — so students saw generic default text in essentially every scenario
                    // (CT and POCUS lost in 254/254). Read the generated block and let any top-level
                    // override (e.g. the "lung re-expanded" CXR rewrite) win.
                    // investigations.ecg deliberately carries the ORIGINAL, un-normalised ecg (STEMI
                    // stays STEMI) so the monitor's 12-lead draws ST elevation, while the monitoring
                    // trace keeps using the separately-synced normalised `rhythm`.
                    investigations: (() => {
                        const gen = cur.scenario.investigations || {};
                        return {
                            vbg: cur.scenario.vbg || gen.vbg || null,
                            ecg: gen.ecg || cur.scenario.ecg || null,
                            chestXray: cur.scenario.chestXray || gen.chestXray || null,
                            urine: cur.scenario.urine || gen.urine || null,
                            ct: cur.scenario.ct || gen.ct || null,
                            pocus: cur.scenario.pocus || gen.pocus || null
                        };
                    })(),
                    activeInterventions: Array.from(cur.activeInterventions),
                    nibp: cur.nibp, speech: cur.speech, soundEffect: cur.soundEffect,
                    audioOutput: cur.audioOutput, trends: cur.trends,
                    arrestPanelOpen: cur.arrestPanelOpen, isFinished: cur.isFinished,
                    monitorPopup: cur.monitorPopup, waveformGain: cur.waveformGain,
                    noise: cur.noise, notification: cur.notification,
                    remotePacerState: cur.remotePacerState, pacingThreshold: cur.pacingThreshold,
                    showWetflag: cur.showWetflag, co2Pathology,
                    // Top-level keys only — the write diff is shallow and per-key. Never undefined.
                    isRunning: !!cur.isRunning, isMuted: !!cur.isMuted,
                    activeLoops: cur.activeLoops || {}, isParalysed: !!cur.isParalysed,
                    // Wave 2. BM / Temp / pH ride inside `vitals` (verified by the sync payload test);
                    // activeDrugs and deteriorationMode are top-level, primitives only, never undefined,
                    // so sanitizeForRealtimeDatabase passes them through untouched.
                    activeDrugs: Array.isArray(cur.activeDrugs) ? cur.activeDrugs : [],
                    deteriorationMode: cur.deteriorationMode || 'manual'
                };
                const sanitised = sanitizeForRealtimeDatabase(payload);
                const safePayload = sanitised.value || {};
                if (sanitised.dropped.length) {
                    const dropped = sanitised.dropped.join(', ');
                    console.error(`Firebase sync omitted invalid value(s): ${dropped}`);
                    dispatch({
                        type: 'SET_SYNC_STATUS',
                        payload: { state: 'degraded', message: `Invalid data omitted from sync: ${dropped}` }
                    });
                }
                const diff = {};
                for (const key in safePayload) {
                    if (JSON.stringify(safePayload[key]) !== JSON.stringify(lastPayloadRef.current[key])) {
                        diff[key] = safePayload[key];
                    }
                }
                if (Object.keys(diff).length > 0) {
                    // Only advance the acknowledged snapshot after RTDB accepts the write. Advancing it
                    // before the promise resolves made a permission-denied write look successful forever.
                    sessionRef.update(diff).then(() => {
                        lastPayloadRef.current = safePayload;
                        dispatch({
                            type: 'SET_SYNC_STATUS',
                            payload: {
                                state: sanitised.dropped.length ? 'degraded' : 'connected',
                                message: sanitised.dropped.length ? 'Some invalid data was omitted from sync.' : null,
                                lastWriteAt: Date.now()
                            }
                        });
                    }).catch(e => {
                        console.error("Sync Write Error:", e);
                        dispatch({
                            type: 'SET_SYNC_STATUS',
                            payload: { state: 'error', message: `Live session write failed: ${e.message || 'unknown error'}` }
                        });
                    });
                }
            };

            if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
            syncTimerRef.current = setTimeout(flush, 500);
            return () => { if (syncTimerRef.current) { clearTimeout(syncTimerRef.current); syncTimerRef.current = null; } };
        }, [
            state.vitals, state.rhythm, state.cprInProgress, state.etco2Enabled, state.flash,
            state.cycleTimer, state.monitorTimer, state.scenario, state.activeInterventions,
            state.nibp, state.speech, state.soundEffect, state.audioOutput, state.trends,
            state.arrestPanelOpen, state.isFinished, state.monitorPopup, state.waveformGain,
            state.noise, state.notification, state.remotePacerState, state.pacingThreshold,
            state.showWetflag, state.etco2Pathology, isMonitorMode, sessionID,
            state.isRunning, state.isMuted, state.activeLoops, state.isParalysed,
            state.activeDrugs, state.deteriorationMode
        ]);

        useEffect(() => {
            const db = window.db; 
            if (!db || !sessionID || !isMonitorMode) return; 
            const sessionRef = db.ref(`sessions/${sessionID}`);
            const handleUpdate = (snapshot) => { 
                const data = snapshot.val(); 
                if (data) { 
                    try {
                        dispatch({ type: 'SYNC_FROM_MASTER', payload: data });
                        dispatch({ type: 'SET_SYNC_STATUS', payload: { state: 'connected', message: null } });
                    }
                    catch (err) { console.error("Sync Error", err); } 
                } 
            };
            const handleReadError = (error) => {
                console.error('Firebase monitor read failed:', error);
                dispatch({
                    type: 'SET_SYNC_STATUS',
                    payload: { state: 'error', message: `Live session read failed: ${error.message || 'unknown error'}` }
                });
            };
            sessionRef.on('value', handleUpdate, handleReadError);
            return () => sessionRef.off('value', handleUpdate);
        }, [isMonitorMode, sessionID]);

        // Persist a slim snapshot to localStorage every 5s. This is a single interval keyed only on
        // isMonitorMode: the previous effect re-ran on every vitals tick, and its cleanup cleared the
        // pending timeout each time, so at 1Hz the 5s write never actually fired and resume was dead.
        useEffect(() => {
            if (isMonitorMode) return;
            const id = setInterval(() => {
                try {
                    const cur = stateRef.current;
                    if (!cur.scenario || cur.log.length === 0) return;
                    const slim = {
                        // The whole scenario, not just an identifier: every screen dereferences fields
                        // like patientProfileTemplate, and a stub makes them throw on resume.
                        scenario: cur.scenario,
                        vitals: cur.vitals, baseVitals: cur.baseVitals, prevVitals: cur.prevVitals, trends: cur.trends, hypoxiaTimer: cur.hypoxiaTimer,
                        activeDrugs: cur.activeDrugs, deteriorationMode: cur.deteriorationMode,
                        rhythm: cur.rhythm, time: cur.time, cycleTimer: cur.cycleTimer,
                        activeInterventions: Array.from(cur.activeInterventions),
                        interventionCounts: cur.interventionCounts, activeDurations: cur.activeDurations,
                        processedEvents: Array.from(cur.processedEvents),
                        completedObjectives: Array.from(cur.completedObjectives),
                        log: cur.log.slice(-200), // recent log only
                        nibp: cur.nibp, etco2Enabled: cur.etco2Enabled, isParalysed: cur.isParalysed, paralysis: cur.paralysis,
                        showWetflag: cur.showWetflag, icp: cur.icp
                    };
                    localStorage.setItem('wmebem_sim_state', JSON.stringify(slim));
                } catch (e) {
                    console.warn('localStorage persist failed', e);
                }
            }, 5000);
            return () => clearInterval(id);
        }, [isMonitorMode]);
        // The context is created at mount (before any gesture) so it is born 'suspended' under the
        // autoplay policy. The "Tap to Enable Sound" overlay resumes THIS ref, which is correct; what
        // was missing was recovery when iOS/tab-backgrounding re-suspends it, so watch statechange.
        const [audioCtxState, setAudioCtxState] = useState('unknown');
        useEffect(() => {
            if (!audioCtxRef.current) {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                if (!AudioContext) return;
                try { audioCtxRef.current = new AudioContext(); } catch (e) { console.warn('AudioContext unavailable', e); return; }
            }
            const ctx = audioCtxRef.current;
            setAudioCtxState(ctx.state);
            const onStateChange = () => {
                setAudioCtxState(ctx.state);
                // Re-suspension is common on iOS and when a tab is backgrounded. Try to recover
                // immediately; if the browser refuses without a gesture the overlay can be re-shown.
                if (ctx.state === 'suspended') { try { ctx.resume().catch(() => {}); } catch (e) {} }
            };
            ctx.addEventListener('statechange', onStateChange);
            return () => ctx.removeEventListener('statechange', onStateChange);
        }, []);

        // Resume + prime. Some iOS builds only truly unlock output once a buffer has been *played*
        // inside the user gesture, so push a one-sample silent buffer through as well.
        const resumeAudio = (prime = false) => {
            const ctx = audioCtxRef.current;
            if (!ctx) return Promise.resolve(false);
            const primeSilence = () => {
                if (!prime) return;
                try {
                    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
                    const source = ctx.createBufferSource();
                    source.buffer = buffer;
                    source.connect(ctx.destination);
                    source.start(0);
                } catch (e) { /* priming is best-effort */ }
            };
            if (ctx.state === 'suspended') {
                try {
                    const p = ctx.resume();
                    if (p && typeof p.then === 'function') {
                        return p.then(() => { primeSilence(); setAudioCtxState(ctx.state); return true; }).catch(e => { console.warn('AudioContext resume failed', e); return false; });
                    }
                } catch (e) { console.warn('AudioContext resume threw', e); return Promise.resolve(false); }
            }
            primeSilence();
            return Promise.resolve(true);
        };

        // Is this device the one that should be making noise right now?
        const isAudioRouted = (current) => (isMonitorMode && (current.audioOutput === 'monitor' || current.audioOutput === 'both'))
            || (!isMonitorMode && (current.audioOutput === 'controller' || current.audioOutput === 'both'));

        // Pulse-oximeter beep. Every early exit now RESCHEDULES: previously a manual rhythm change to
        // pVT/VF with a non-zero HR exited the loop permanently (and `rhythm` was not a dependency),
        // killing audio for the rest of the session with no way back.
        useEffect(() => {
            let timerId;
            let cancelled = false;
            const SILENT_RHYTHMS = ['VF', 'Asystole', 'pVT', 'PEA'];
            const scheduleBeep = () => {
                if (cancelled) return;
                const current = stateRef.current;
                const ctx = audioCtxRef.current;
                const retry = (ms) => { timerId = setTimeout(scheduleBeep, ms); };

                if (!current.isRunning) { retry(1000); return; }
                if (current.vitals.hr <= 0 || SILENT_RHYTHMS.includes(current.rhythm)) { retry(1000); return; }
                if (!current.activeInterventions.has('Obs')) { retry(1000); return; }

                if (!current.isMuted && ctx && isAudioRouted(current)) {
                    if (ctx.state === 'suspended') { resumeAudio(); retry(500); return; }
                    try {
                        const osc = ctx.createOscillator(); const gain = ctx.createGain();
                        osc.type = 'sine';
                        const spO2 = current.vitals.spO2;
                        // Real oximeters keep dropping in pitch well below 85%. The old mapping clamped
                        // at 400 Hz from 85% downwards — exactly where the cue matters most. Now the
                        // tone continues to fall to a floor of 180 Hz at 50%, and stays recognisable.
                        let freq = 800;
                        if (spO2 >= 85) freq = 400 + ((spO2 - 85) * (400 / 15));
                        else freq = Math.max(180, 400 - ((85 - spO2) * (220 / 35)));
                        osc.frequency.value = Math.max(120, Math.min(900, freq));
                        osc.connect(gain); gain.connect(ctx.destination);
                        const now = ctx.currentTime; gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(0.1, now + 0.01); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
                        osc.start(now); osc.stop(now + 0.2);
                    } catch (e) { console.warn('Beep failed', e); }
                }
                retry(60000 / (Math.max(20, current.vitals.hr) || 60));
            };

            resumeAudio();
            scheduleBeep();
            return () => { cancelled = true; clearTimeout(timerId); };
        }, [isMonitorMode, audioCtxState]);

        // PHYSIOLOGICAL ALARMS. These used to exist only on the facilitator's laptop (livesim.js had
        // its own separate AudioContext), so trainees could never hear a desat or brady alarm on the
        // device that in real life screams. They now live in shared engine code, run on whichever
        // device `audioOutput` routes to, and are driven by the synced vitals.
        const lastAlarmRef = useRef({});
        const playAlertTone = (type) => {
            const ctx = audioCtxRef.current;
            if (!ctx) return;
            try {
                if (ctx.state === 'suspended') { resumeAudio(); return; }
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain); gain.connect(ctx.destination);
                osc.frequency.value = type === 'critical' ? 880 : 660;
                osc.type = 'sine';
                gain.gain.setValueAtTime(0.3, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
                osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.5);
            } catch (e) { /* never let an alarm take down the sim */ }
        };

        useEffect(() => {
            const current = state;
            if (!current.isRunning || current.isMuted) return;
            if (!isAudioRouted(current)) return;
            // No monitoring attached means no alarm limits are being watched — same rule as the beep.
            if (!current.activeInterventions.has('Obs')) return;
            const age = current.scenario?.patientAge ?? 40;
            const th = (window.getAlarmThresholds && window.getAlarmThresholds(age)) || { hr: { low: 40, high: 130 }, rr: { low: 8, high: 30 }, spO2: 90 };
            const v = current.vitals || {};
            const now = Date.now();
            const fire = (key, tone) => {
                if (now - (lastAlarmRef.current[key] || 0) > 10000) { playAlertTone(tone); lastAlarmRef.current[key] = now; }
            };
            const pulseless = ['VF', 'pVT', 'Asystole', 'PEA'].includes(current.rhythm);
            if (pulseless) { fire('arrest', 'critical'); return; }
            if (v.hr > th.hr.high || v.hr < th.hr.low) fire('hr', 'critical');
            if (v.spO2 < th.spO2) fire('spO2', 'critical');
            if (v.rr < th.rr.low || v.rr > th.rr.high) fire('rr', 'alert');
        }, [state.vitals.hr, state.vitals.spO2, state.vitals.rr, state.rhythm, state.isRunning, state.isMuted, state.audioOutput, isMonitorMode]);
        
        useEffect(() => { 
            if (state.nibp.mode === 'auto' && state.nibp.timer <= 0 && state.isRunning && !state.nibp.inflating) { dispatch({ type: 'START_NIBP' }); }
            if (state.nibp.inflating) { playInflationSound(); const timeout = setTimeout(() => { dispatch({ type: 'COMMIT_NIBP' }); }, 5000); return () => clearTimeout(timeout); }
        }, [state.nibp.timer, state.isRunning, state.nibp.inflating]);
        
        const lastSoundRef = useRef(0);
        useEffect(() => { 
            if (state.soundEffect && state.soundEffect.timestamp > lastSoundRef.current) { 
                lastSoundRef.current = state.soundEffect.timestamp; 
                if (!state.isRunning) return;
                const shouldPlay = (isMonitorMode && (state.audioOutput === 'monitor' || state.audioOutput === 'both')) || (!isMonitorMode && (state.audioOutput === 'controller' || state.audioOutput === 'both')); 
                if (shouldPlay && audioCtxRef.current) { playMedicalSound(state.soundEffect.type); } 
            } 
        }, [state.soundEffect, isMonitorMode, state.audioOutput, state.isRunning]);
        
        const lastSpeechRef = useRef(0);
        useEffect(() => { 
            if (state.speech && state.speech.timestamp > lastSpeechRef.current) { 
                if (Date.now() - state.speech.timestamp > 8000) { lastSpeechRef.current = state.speech.timestamp; return; } 
                lastSpeechRef.current = state.speech.timestamp; 
                if (!state.isRunning) return;
                const shouldPlay = (isMonitorMode && (state.audioOutput === 'monitor' || state.audioOutput === 'both')) || (!isMonitorMode && (state.audioOutput === 'controller' || state.audioOutput === 'both')); 
                if (shouldPlay && 'speechSynthesis' in window) { 
                    window.speechSynthesis.cancel(); 
                    if (window.speechSynthesis.paused) window.speechSynthesis.resume(); 
                    const utterance = new SpeechSynthesisUtterance(state.speech.text); 
                    const voices = window.speechSynthesis.getVoices();
                    if (voices.length > 0) {
                        const enVoice = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('en'));
                        utterance.voice = enVoice || voices[0];
                    }
                    window.speechSynthesis.speak(utterance); 
                } 
            } 
        }, [state.speech, isMonitorMode, state.audioOutput, state.isRunning]);

        const addLogEntry = (msg, type = 'info', flagged = false, deviation = null) => dispatch({ type: 'ADD_LOG', payload: { msg, type, flagged, deviation } });
        
        const applyIntervention = (key) => {
            // Always read live state — this function is invoked from async paths (Firebase command listener)
            // where the closed-over `state` would be stale.
            const cur = stateRef.current;
            const scenario = cur.scenario;
            // These two used to be silent no-ops, so a mistyped key or a not-yet-loaded scenario made
            // the button look broken with no explanation anywhere.
            if (!scenario) {
                console.warn(`applyIntervention('${key}') ignored: no scenario is loaded.`);
                dispatch({ type: 'SET_NOTIFICATION', payload: { msg: 'No scenario loaded — load a scenario first.', type: 'danger', id: Date.now() } });
                return;
            }

            if (key === 'ToggleETCO2') { dispatch({ type: 'TOGGLE_ETCO2' }); addLogEntry(cur.etco2Enabled ? 'ETCO2 Disconnected' : 'ETCO2 Connected', 'action'); return; }
            const action = INTERVENTIONS[key];
            if (!action) {
                console.warn(`Unknown intervention key '${key}' — no definition in INTERVENTIONS.`);
                addLogEntry(`Unknown intervention '${key}' requested — nothing applied (check scenario data).`, 'warning', true);
                dispatch({ type: 'SET_NOTIFICATION', payload: { msg: `Unknown intervention: ${key}`, type: 'danger', id: Date.now() } });
                return;
            }

            // PERMISSIVE GATING. Nothing is ever blocked. Unmet expectations are recorded as a flagged
            // deviation (amber log row, toolbar chip, debrief card) plus a brief non-blocking toast.
            // Performing RSI without pre-oxygenation is assessable behaviour worth RECORDING, not
            // preventing. Follows the existing non-blocking precedents (pacing without capture, shock
            // into a non-shockable rhythm).
            const missingLabels = getUnmetExpectations(action, cur);
            if (missingLabels.length > 0) {
                const missingText = missingLabels.join(', ');
                addLogEntry(`${action.label} performed WITHOUT: ${missingText}`, 'warning', true, { action: key, label: action.label, missing: missingLabels });
                dispatch({ type: 'SET_NOTIFICATION', payload: { msg: `${action.label} — missing ${missingText} (proceeding)`, type: 'warning', id: Date.now() } });
            }

            const isActive = cur.activeInterventions.has(key);
            if (action.type === 'continuous' && isActive) {
                 // Deliberate toggle-off. The button shows an explicit ACTIVE state and a tooltip saying
                 // a second press stops it, so removal cannot be mistaken for a repeat dose.
                 dispatch({ type: 'REMOVE_INTERVENTION', payload: key });
                 // B3: stopping compressions clears the flag as well as starting the drug's offset tail.
                 if (action.effect && action.effect.cpr === true && cur.cprInProgress) dispatch({ type: 'TOGGLE_CPR', payload: false });
                 addLogEntry(`${action.label} removed.`, 'action');
                 dispatch({ type: 'SET_NOTIFICATION', payload: { msg: `${action.label} STOPPED (second press toggles off)`, type: 'info', id: Date.now() } });
                 return;
            }

            const isPaedsWf = scenario.ageRange === 'Paediatric' && scenario.wetflag;
            let logMsg = action.log;
            if (key === 'Fluids') {
                logMsg = isPaedsWf ? `Fluid Bolus (${scenario.wetflag.fluids}ml) administered.` : `Fluid Bolus (500ml) administered.`;
            }
            if (isPaedsWf) {
                if (key === 'AdrenalineIV') logMsg = `IV Adrenaline (${scenario.wetflag.adrenaline}mcg) administered.`;
                if (key === 'Lorazepam') logMsg = `IV Lorazepam (${scenario.wetflag.lorazepam}mg) administered.`;
                if (key === 'InsulinDextrose') logMsg = `Glucose (${scenario.wetflag.glucose}ml) administered.`;
            }
            // Instant (no-pk) effects are applied to the BASE physiology, exactly as before. Anything
            // carrying a `pk` envelope is instead pushed onto activeDrugs and composed every tick.
            const newVitals = { ...cur.baseVitals };
            let newActive = new Set(cur.activeInterventions);
            let newCounts = { ...cur.interventionCounts };
            const count = (newCounts[key] || 0) + 1;
            if (action.duration && !cur.activeDurations[key]) dispatch({ type: 'START_INTERVENTION_TIMER', payload: { key, duration: action.duration } });

            // --- PK ENVELOPE (A1) ------------------------------------------------------------------
            // Push an entry instead of mutating vitals. Repeat dosing pushes another entry, which is
            // naturally cumulative, but each drug's total contribution is capped at pk.maxDoses.
            const drugEntry = buildDrugEntry(key, action, cur.time, 1);
            if (drugEntry) {
                dispatch({ type: 'ADD_ACTIVE_DRUG', payload: drugEntry });
                const priorDoses = (cur.activeDrugs || []).filter(d => d.key === key && pkFactor(d, cur.time) > 0).length;
                const atCeiling = priorDoses >= drugEntry.maxDoses;
                if (atCeiling) {
                    addLogEntry(`${action.label}: already at the modelled maximum effect (${drugEntry.maxDoses} dose${drugEntry.maxDoses > 1 ? 's' : ''}) — further doses add no further response.`, 'warning', true);
                } else if (!drugEntry.sustained && drugEntry.onset > 15) {
                    addLogEntry(`${action.label}: onset ~${drugEntry.onset}s, peak ~${Math.round(drugEntry.peak / 60 * 10) / 10} min${drugEntry.offset > drugEntry.peak ? `, wears off by ~${Math.round(drugEntry.offset / 60)} min` : ''}.`, 'info');
                }
            }
            if (action.type === 'continuous') { newActive.add(key); addLogEntry(logMsg, 'action'); } else { newCounts[key] = count; addLogEntry(logMsg, 'action'); }
            dispatch({ type: 'UPDATE_INTERVENTION_STATE', payload: { active: newActive, counts: newCounts } });

            dispatch({ type: 'SET_NOTIFICATION', payload: { msg: action.label + " Administered", type: 'success', id: Date.now() } });

            // Generic objective completion — matches intervention key against learning objective text
            const OBJECTIVE_TRIGGERS = {
                'Antibiotics':   ['antibio', 'sepsis', 'infection', 'antimicro'],
                'Fluids':        ['fluid', 'resus', 'bolus', 'iv fluid', 'saline'],
                'AdrenalineIM':  ['adrenaline', 'anaphyl', 'epinephrine'],
                'AdrenalineIV':  ['adrenaline', 'cardiac arrest', 'epinephrine'],
                'Adrenaline':    ['adrenaline', 'anaphyl', 'epinephrine'],
                'O2':            ['oxygen', 'o2', 'airway'],
                'Aspirin':       ['aspirin', 'acs', 'stemi', 'nstemi'],
                'GTN':           ['gtn', 'nitrate', 'acs'],
                'InsulinInfusion': ['insulin', 'dka', 'glucose'],
                'InsulinDextrose': ['insulin', 'dka', 'glucose', 'hyperkalaemia', 'hyperkalemia'],
                'Atropine':      ['atropine', 'bradycardia', 'heart block'],
                'Lorazepam':     ['lorazepam', 'seizure', 'benzodiazep'],
                'NaloxoneIV':    ['naloxone', 'opiate', 'opioid'],
                'Tranexamic':    ['tranexam', 'haemorrhage', 'trauma'],
                'RSI':           ['rsi', 'intubat', 'airway management'],
                'ChestDrain':    ['chest drain', 'pneumothorax', 'haemothorax'],
                'NeedleDecomp':  ['needle', 'pneumothorax', 'tension'],
            };
            const triggers = OBJECTIVE_TRIGGERS[key];
            const objList = (scenario.learningObjectives || []).concat(scenario.instructorBrief?.learningObjectives || []);
            if (triggers && objList.length) {
                objList.forEach(obj => {
                    const objLower = obj.toLowerCase();
                    if (triggers.some(kw => objLower.includes(kw))) {
                        dispatch({ type: 'COMPLETE_OBJECTIVE', payload: obj });
                    }
                });
            }

            if (scenario.stabilisers && scenario.stabilisers.includes(key)) { dispatch({ type: 'TRIGGER_IMPROVE' }); addLogEntry("Patient condition IMPROVING", "success"); }
            if (scenario.title && scenario.title.includes('Anaphylaxis') && key === 'Adrenaline' && count >= 2) { dispatch({ type: 'TRIGGER_IMPROVE' }); }
            // --- PARALYSIS (roc vs sux genuinely differ) ---
            // WAVE 2: folded into the pk envelope. The blockade window is derived from the SAME
            // activeDrugs entry pushed above (onset = pk.onset, end = pk.offset or paralysis.duration),
            // so there is exactly one timer. SET_PARALYSIS is only used here as an immediate mirror for
            // the UI/sync before the next tick recomputes it from activeDrugs.
            if (action.paralysis || action.effect.paralysed) {
                const pz = action.paralysis || { onset: (action.pk && action.pk.onset) || 60, duration: ((action.pk && action.pk.offset) || 2760) - ((action.pk && action.pk.onset) || 60) };
                dispatch({ type: 'SET_PARALYSIS', payload: { active: true, agent: key, startTime: cur.time, onset: pz.onset, duration: pz.duration } });
                if (key === 'Sux') addLogEntry('Fasciculations observed after suxamethonium.', 'info');
                const ventilated = isVentilated(cur.activeInterventions);
                addLogEntry(`${action.label}: paralysis in ~${pz.onset}s, lasting ~${Math.round(pz.duration / 60)} min.${ventilated ? '' : ' Patient is NOT being ventilated — expect apnoea and desaturation.'}`, ventilated ? 'info' : 'warning', !ventilated);
            }
            if (action.effect.reverseParalysis) {
                // Reverse the activeDrugs entries themselves so nothing can resurrect the blockade.
                dispatch({ type: 'REVERSE_PARALYSIS_DRUGS' });
                dispatch({ type: 'SET_PARALYSIS', payload: { active: false } });
                if (!isVentilated(cur.activeInterventions)) newVitals.rr = Math.max(newVitals.rr, 10);
            }

            // --- B3: effect.cpr. Wave 3 owns the full CPR/cprInProgress/defib work; this is the safe,
            // non-overlapping part: an intervention that declares itself to be chest compressions sets
            // the flag, and removing it clears the flag (see REMOVE_INTERVENTION above for the drug
            // tail). That immediately activates the already-written arrest ETCO2 physiology, the CPR
            // waveform artefact and the ROSC bonus, all of which were dead code. Wave 3 should extend
            // this (compression quality, pauses, metronome) rather than re-adding the flag.
            if (action.effect.cpr === true && !cur.cprInProgress) {
                dispatch({ type: 'TOGGLE_CPR', payload: true });
                addLogEntry('CPR in progress — arrest ETCO2 and compression artefact now modelled.', 'info');
            }

            // --- AIRWAY / RSI: clinically honest oxygenation instead of a jump to SpO2 99 ---
            // The facilitator keeps full control of the outcome: a successful RSI secures the airway
            // (RSI counts as ventilation), while FailedIntubation/CICO hand the airway back and let the
            // existing hypoxia model desaturate the paralysed patient. Nothing here is random.
            if (key === 'RSI') {
                const preoxKeys = ['Preoxygenation', 'ApnoeicOxygenation', 'Oxygen', 'Bagging', 'NIV', 'CPAP'];
                const preoxed = preoxKeys.some(k => cur.activeInterventions.has(k));
                if (preoxed) {
                    addLogEntry('Apnoeic period begins — pre-oxygenated, so saturations are protected for now.', 'info');
                } else {
                    // No reservoir: desaturation starts immediately. The tick-level hypoxia model carries
                    // it on from here if the airway is not secured promptly.
                    newVitals.spO2 = clamp(newVitals.spO2 - 6, 0, 100);
                    addLogEntry('Apnoeic period begins with NO pre-oxygenation — desaturating.', 'warning', true, { action: 'RSI', label: action.label, missing: ['pre-oxygenation'] });
                }
                if (!cur.activeInterventions.has('ApnoeicOxygenation')) {
                    addLogEntry('No apnoeic oxygenation in place — safe apnoea time is shorter.', 'info');
                }
                addLogEntry('Confirm the tube: ETCO2 waveform, chest rise, bilateral air entry. Declare failed intubation early if the view is poor.', 'info');
            }
            if (key === 'TubeConfirm' && !cur.etco2Enabled) {
                dispatch({ type: 'TOGGLE_ETCO2' });
                addLogEntry('ETCO2 connected for tube confirmation.', 'action');
            }
            if (key === 'FailedIntubation' || key === 'CICO') {
                // The airway is NOT secured: stop treating RSI as ventilation so a paralysed patient
                // desaturates until the facilitator rescues with i-gel, BVM or FONA.
                if (cur.activeInterventions.has('RSI')) dispatch({ type: 'REMOVE_INTERVENTION', payload: 'RSI' });
                addLogEntry(key === 'CICO' ? 'CICO: airway NOT secured. Oxygenate by any means, then front-of-neck access.' : 'Airway NOT secured after failed attempt. Oxygenate between attempts.', 'danger', true);
            }

            if (action.effect.changeRhythm === 'defib') {
                applyShockOutcome(cur);
            }

            // ARREST PHYSIOLOGY. During a pulseless rhythm there is no cardiac output, so drugs cannot
            // drive HR/BP — and, critically, SpO2 must NOT imply perfusion that does not exist (BVM in
            // asystole used to display SpO2 25%). Previously HR/BP/RR were silently discarded while
            // SpO2/GCS were still applied; now the suppression is total and it is LOGGED.
            const isArrest = cur.vitals.bpSys < 10 && (['VF','VT','Asystole','PEA','pVT'].includes(cur.rhythm));
            if (isArrest) {
                const e = action.effect || {};
                const suppressed = ['HR', 'BP', 'RR', 'SpO2'].filter(f => e[f] !== undefined && e[f] !== null);
                if (suppressed.length) {
                    addLogEntry(`${action.label} given during arrest (${cur.rhythm}) — ${suppressed.join('/')} unchanged: a pulseless patient has no perfusion to measure. ETCO2 is the marker to watch.`, 'warning');
                }
            }
            // Any numeric field the pk envelope owns is deliberately NOT applied here — otherwise the
            // drug would land twice (once instantly, once through the envelope). `pkOwned` is what
            // preserves today's instant behaviour for everything WITHOUT a pk block.
            const pkOwned = (field) => !!(drugEntry && drugEntry.effect && drugEntry.effect[field] !== undefined);
            if (!isArrest) {
                if (action.effect.HR) {
                    if (action.effect.HR === 'reset') newVitals.hr = 80;
                    else if (action.effect.HR === 'pace') {
                        // Pacing only captures if output exceeds threshold
                        const pacer = cur.remotePacerState || { rate: 0, output: 0 };
                        if (pacer.output >= cur.pacingThreshold && pacer.rate > 0) {
                            newVitals.hr = pacer.rate;
                            addLogEntry(`Pacing: capture at ${pacer.output}mA, rate ${pacer.rate}`, 'success');
                        } else {
                            addLogEntry(`Pacing: no capture (output ${pacer.output}mA < threshold ${cur.pacingThreshold}mA)`, 'warning');
                        }
                    }
                    else if (!pkOwned('HR')) newVitals.hr = clampVital('hr', newVitals.hr + action.effect.HR);
                }
                if (action.effect.BP && !pkOwned('BP')) {
                    newVitals.bpSys = clampVital('bpSys', newVitals.bpSys + action.effect.BP);
                    newVitals.bpDia = clampVital('bpDia', newVitals.bpDia + action.effect.BP * 0.6);
                }
                if (action.effect.RR) {
                    if (action.effect.RR === 'vent') { newVitals.rr = VENTILATOR_RATE; }
                    else if (typeof action.effect.RR === 'number' && !pkOwned('RR')) { newVitals.rr = clampVital('rr', newVitals.rr + action.effect.RR); }
                }
            }
            // SpO2 is inside the arrest guard too: a pulse oximeter cannot read a saturation without
            // a pulse, so BVM in asystole must not display 25%.
            if (!isArrest && action.effect.SpO2 && !pkOwned('SpO2')) newVitals.spO2 = clampVital('spO2', newVitals.spO2 + action.effect.SpO2);

            if (action.effect.gcs) {
                if (typeof action.effect.gcs === 'string') { if (action.effect.gcs === 'sedated') newVitals.gcs = 3; }
                else if (!pkOwned('gcs')) { newVitals.gcs = clampVital('gcs', newVitals.gcs + action.effect.gcs); }
            }

            // --- GROUP B: BM / Temp / pH were authored on 12 interventions and read by NOTHING, so
            // Dextrose could not change the glucose reading, Warming/Cooling could not change the
            // temperature and SodiumBicarb's pH was dropped on the floor. They are now first-class
            // modelled vitals. Anything with a pk block ramps through the envelope; anything without
            // one still lands instantly, which keeps the schema backwards compatible.
            if (action.effect.BM !== undefined && action.effect.BM !== null && !pkOwned('BM')) newVitals.bm = clampVital('bm', newVitals.bm + Number(action.effect.BM));
            if (action.effect.Temp !== undefined && action.effect.Temp !== null && !pkOwned('Temp')) newVitals.temp = clampVital('temp', newVitals.temp + Number(action.effect.Temp));
            if (action.effect.pH !== undefined && action.effect.pH !== null && !pkOwned('pH')) newVitals.ph = clampVital('ph', (Number.isFinite(newVitals.ph) ? newVitals.ph : 7.4) + Number(action.effect.pH));

            const updatedScenario = { ...scenario }; let updateNeeded = false;
            if ((key === 'Needle' || key === 'FingerThoracostomy') && updatedScenario.chestXray && updatedScenario.chestXray.findings && updatedScenario.chestXray.findings.includes('Pneumothorax')) { updatedScenario.chestXray.findings = "Lung re-expanded."; updateNeeded = true; }
            if (updateNeeded) dispatch({ type: 'UPDATE_SCENARIO', payload: updatedScenario });
            dispatch({ type: 'UPDATE_VITALS', payload: newVitals });
        };

        const applyInterventionRef = useRef(applyIntervention);
        useEffect(() => { applyInterventionRef.current = applyIntervention; }, [applyIntervention]);

        useEffect(() => {
            const db = window.db; 
            if (!db || !sessionID || isMonitorMode) return; 
            
            const cmdRef = db.ref(`sessions/${sessionID}/command`);
            const handleCmd = (snap) => {
                const val = snap.val();
                if (val && val.ts > lastCmdRef.current) {
                    lastCmdRef.current = val.ts;
                    if (val.type === 'START_NIBP') dispatch({ type: 'START_NIBP' });
                    if (val.type === 'TOGGLE_NIBP_MODE') dispatch({ type: 'TOGGLE_NIBP_MODE' });
                    if (val.type === 'TRIGGER_ACTION') { if (applyInterventionRef.current) { applyInterventionRef.current(val.payload); } }
                }
            };
            const handleCommandReadError = (error) => {
                console.error('Firebase command listener failed:', error);
                dispatch({
                    type: 'SET_SYNC_STATUS',
                    payload: { state: 'error', message: `Live-session command read failed: ${error.message || 'unknown error'}` }
                });
            };
            cmdRef.on('value', handleCmd, handleCommandReadError);
            return () => cmdRef.off('value', handleCmd);
        }, [isMonitorMode, sessionID]);

        const manualUpdateVital = (key, value) => { dispatch({ type: 'MANUAL_VITAL_UPDATE', payload: { key, value } }); addLogEntry(`Manual: ${key} -> ${value}`, 'manual'); };
        
        const triggerArrest = (type = 'VF') => {
            const cur = stateRef.current;
            dispatch({ type: 'STOP_TREND' });
            dispatch({ type: 'UPDATE_VITALS', payload: { ...cur.baseVitals, hr: 0, bpSys: 0, bpDia: 0, spO2: 0, rr: 0, gcs: 3, pupils: 'Dilated', etco2: 1.5 } });
            dispatch({ type: 'UPDATE_RHYTHM', payload: type });
            addLogEntry(`CARDIAC ARREST - ${type}`, 'manual');
            dispatch({ type: 'SET_FLASH', payload: 'red' });
        };

        const triggerROSC = (rhythm = 'Sinus Rhythm') => {
            const cur = stateRef.current;
            const age = cur.scenario?.patientAge ?? 40;
            const base = (window.getBaseVitals ? window.getBaseVitals(age) : { hr: 80, rr: 16, bpSys: 110, bpDia: 70 });
            const newEtco2 = Math.round((5.0 + (Math.random() * 1.5)) * 10) / 10;
            dispatch({ type: 'STOP_TREND' });
            dispatch({ type: 'UPDATE_VITALS', payload: { ...cur.baseVitals, hr: base.hr, bpSys: base.bpSys, bpDia: base.bpDia, spO2: 94, rr: base.rr, gcs: 8, pupils: 3, etco2: newEtco2 } });
            dispatch({ type: 'UPDATE_RHYTHM', payload: rhythm });
            if (cur.scenario) {
                const updatedScenario = { ...cur.scenario, deterioration: { ...(cur.scenario.deterioration || {}), active: false } };
                dispatch({ type: 'UPDATE_SCENARIO', payload: updatedScenario });
            }
            addLogEntry(`ROSC achieved (${rhythm}).`, 'success');
            dispatch({ type: 'SET_FLASH', payload: 'green' });
        };

        // Shared shock outcome. Both the facilitator's Defib intervention and a student shock arriving
        // over the channel route through here so the two paths cannot drift apart again.
        const shockCountRef = useRef(0);
        const SHOCKABLE = ['VF', 'VT', 'pVT'];
        function applyShockOutcome(cur) {
            shockCountRef.current += 1;
            if (!SHOCKABLE.includes(cur.rhythm)) {
                addLogEntry(`Shock delivered into non-shockable rhythm (${cur.rhythm}) — no effect.`, 'warning');
                return;
            }
            if (cur.queuedRhythm) {
                dispatch({ type: 'UPDATE_RHYTHM', payload: cur.queuedRhythm });
                if (cur.queuedRhythm === 'Sinus Rhythm') triggerROSC();
                else addLogEntry(`Rhythm changed to ${cur.queuedRhythm}`, 'manual');
                dispatch({ type: 'SET_QUEUED_RHYTHM', payload: null });
                return;
            }
            // ROSC chance rises with shocks and good CPR; capped at 50%. Defib never causes asystole.
            const roscChance = Math.min(0.5, 0.08 + 0.07 * shockCountRef.current + 0.1 * (cur.cprInProgress ? 1 : 0));
            if (Math.random() < roscChance) triggerROSC();
            else addLogEntry('Defib: No change in rhythm. Resume CPR.', 'warning');
        }

        function initCharge(energy) {
            const j = Number.isFinite(Number(energy)) ? Math.round(Number(energy)) : 150;
            dispatch({ type: 'SET_FLASH', payload: 'yellow' });
            addLogEntry(`Defib Charging (${j}J)`, 'warning');
            dispatch({ type: 'SET_NOTIFICATION', payload: { msg: `Charging ${j}J...`, type: 'warning', id: Date.now() } });
            setTimeout(() => dispatch({ type: 'SET_FLASH', payload: null }), 1000);
        }

        function deliverShock(energy, source = 'facilitator') {
            const cur = stateRef.current;
            const j = Number.isFinite(Number(energy)) ? Math.round(Number(energy)) : 150;
            dispatch({ type: 'SET_FLASH', payload: 'red' });
            addLogEntry(`Shock Delivered ${j}J (${source})`, 'danger', true);
            dispatch({ type: 'SET_NOTIFICATION', payload: { msg: `Shock Delivered ${j}J`, type: 'danger', id: Date.now() } });
            setTimeout(() => dispatch({ type: 'SET_FLASH', payload: null }), 500);
            applyShockOutcome(cur);
        }

        const revealInvestigation = (type, customText = null) => {
            dispatch({ type: 'SET_LOADING_INVESTIGATION', payload: type });
            setTimeout(() => {
                const cur = stateRef.current;
                let finalCustomText = customText;

                // VBG: if no manual override supplied, derive from current state
                if (type === 'VBG' && !customText && cur.scenario && window.calculateDynamicVbg) {
                    const startVbg = cur.scenario.vbg || window.generateVbg?.('normal');
                    const dynamic = window.calculateDynamicVbg(startVbg, cur.vitals, cur.activeInterventions, cur.time);
                    // Pass the structured object — monitor.js will detect and render the table.
                    finalCustomText = { __vbg: true, ...dynamic };
                }

                dispatch({ type: 'REVEAL_INVESTIGATION', payload: type });
                dispatch({ type: 'TRIGGER_POPUP', payload: { type, customText: finalCustomText } });
                addLogEntry(`${type} Result Available`, 'success');
            }, 100);
        };
        const clearInvestigation = () => { dispatch({ type: 'CLEAR_POPUP' }); };
        const nextCycle = () => {
            const cur = stateRef.current;
            dispatch({ type: 'FAST_FORWARD', payload: 120 });
            addLogEntry('Fast Forward: +2 Minutes (Next Cycle)', 'system');
            if (cur.queuedRhythm) {
                dispatch({ type: 'UPDATE_RHYTHM', payload: cur.queuedRhythm });
                if (cur.queuedRhythm === 'Sinus Rhythm') triggerROSC();
                else addLogEntry(`Rhythm Check: Changed to ${cur.queuedRhythm}`, 'manual');
                dispatch({ type: 'SET_QUEUED_RHYTHM', payload: null });
            }
        };
        const speak = (text) => { dispatch({ type: 'TRIGGER_SPEAK', payload: text }); addLogEntry(`Patient: "${text}"`, 'manual'); }; 
        const playSound = (type) => { dispatch({ type: 'TRIGGER_SOUND', payload: type }); addLogEntry(`Sound: ${type}`, 'manual'); };
        const startTrend = (targets, durationSecs) => { dispatch({ type: 'START_TREND', payload: { targets, duration: durationSecs } }); addLogEntry(`Trending vitals over ${durationSecs}s`, 'system'); };
        // Firebase may never have loaded (offline tablet, blocked CDN). Without this guard the student
        // monitor throws on every NIBP/action press instead of falling back to acting locally.
        const sendCommand = (payload) => {
            if (!isMonitorMode || !sessionID || !window.db) return false;
            const safe = sanitizeForRealtimeDatabase({ ...payload, ts: Date.now() });
            if (!safe.value || safe.dropped.length) {
                const message = `Invalid monitor command was not sent: ${safe.dropped.join(', ') || 'unknown field'}`;
                console.error(message);
                dispatch({ type: 'SET_SYNC_STATUS', payload: { state: 'error', message } });
                return false;
            }
            try {
                window.db.ref(`sessions/${sessionID}/command`).set(safe.value).then(() => {
                    dispatch({ type: 'SET_SYNC_STATUS', payload: { state: 'connected', message: null, lastWriteAt: Date.now() } });
                }).catch(e => {
                    console.error('Command send failed:', e);
                    dispatch({
                        type: 'SET_SYNC_STATUS',
                        payload: { state: 'error', message: `Live-session command write failed: ${e.message || 'unknown error'}` }
                    });
                });
                return true;
            } catch (e) {
                console.error('Command send failed:', e);
                dispatch({ type: 'SET_SYNC_STATUS', payload: { state: 'error', message: `Live-session command write failed: ${e.message || 'unknown error'}` } });
                return false;
            }
        };
        const triggerNIBP = () => { if (!sendCommand({ type: 'START_NIBP' })) dispatch({ type: 'START_NIBP' }); };
        const toggleNIBPMode = () => { if (!sendCommand({ type: 'TOGGLE_NIBP_MODE' })) dispatch({ type: 'TOGGLE_NIBP_MODE' }); };
        const triggerAction = (action) => { if (!sendCommand({ type: 'TRIGGER_ACTION', payload: action })) applyIntervention(action); };
        
        const playInflationSound = () => { if (audioCtxRef.current && audioCtxRef.current.state !== 'running') { resumeAudio(); } if (audioCtxRef.current && audioCtxRef.current.state === 'running') { const ctx = audioCtxRef.current; const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(60, ctx.currentTime); osc.frequency.linearRampToValueAtTime(50, ctx.currentTime + 5); const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 150; osc.connect(filter); filter.connect(gain); gain.connect(ctx.destination); gain.gain.setValueAtTime(0.3, ctx.currentTime); gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 4.5); gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 5); osc.start(); osc.stop(ctx.currentTime + 5); } };
        
        const playMedicalSound = (type) => {
            if (!audioCtxRef.current) return; const ctx = audioCtxRef.current; if (ctx.state === 'suspended') ctx.resume(); const t = ctx.currentTime;
            
            if (type === 'charge') {
                const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.type = 'sine'; osc.frequency.setValueAtTime(400, t); osc.frequency.exponentialRampToValueAtTime(1200, t + 2.0);
                osc.connect(gain); gain.connect(ctx.destination); gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(0.3, t + 0.1); gain.gain.setValueAtTime(0.3, t + 1.8); gain.gain.linearRampToValueAtTime(0, t + 2.0);
                osc.start(t); osc.stop(t + 2.0);
            }
            else if (type === 'shock') {
                const osc = ctx.createOscillator(); const gain = ctx.createGain(); const filter = ctx.createBiquadFilter(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(100, t); osc.frequency.exponentialRampToValueAtTime(50, t + 0.2);
                filter.type = 'lowpass'; filter.frequency.setValueAtTime(3000, t); filter.frequency.exponentialRampToValueAtTime(100, t + 0.2);
                osc.connect(filter); filter.connect(gain); gain.connect(ctx.destination); gain.gain.setValueAtTime(1.0, t); gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
                osc.start(t); osc.stop(t + 0.2);
            }
            else if (type === 'Wheeze') { const osc = ctx.createOscillator(); const gain = ctx.createGain(); const lfo = ctx.createOscillator(); const lfoGain = ctx.createGain(); osc.type = 'triangle'; osc.frequency.value = 400; lfo.frequency.value = 0.4; lfoGain.gain.value = 150; lfo.connect(lfoGain); lfoGain.connect(osc.frequency); osc.connect(gain); gain.connect(ctx.destination); gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(0.1, t + 1); gain.gain.linearRampToValueAtTime(0, t + 3); osc.start(t); lfo.start(t); osc.stop(t+3); lfo.stop(t+3); }
            else if (type === 'Stridor') { const osc1 = ctx.createOscillator(); const osc2 = ctx.createOscillator(); const gain = ctx.createGain(); osc1.frequency.value = 600; osc2.frequency.value = 620; osc1.type = 'sawtooth'; osc2.type = 'sawtooth'; osc1.connect(gain); osc2.connect(gain); gain.connect(ctx.destination); gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(0.1, t + 0.5); gain.gain.linearRampToValueAtTime(0, t + 2); osc1.start(t); osc2.start(t); osc1.stop(t+2); osc2.stop(t+2); }
            else if (type === 'Vomit') { const bufferSize = ctx.sampleRate * 2; const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate); const data = buffer.getChannelData(0); for (let i = 0; i < bufferSize; i++) { data[i] = Math.random() * 2 - 1; } const bufferSource = ctx.createBufferSource(); bufferSource.buffer = buffer; const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 300; const gain = ctx.createGain(); bufferSource.connect(filter); filter.connect(gain); gain.connect(ctx.destination); gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(0.3, t + 0.2); gain.gain.exponentialRampToValueAtTime(0.01, t + 1.5); bufferSource.start(t); bufferSource.stop(t+1.5); }
            else if (type === 'Snoring') { const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.type = 'sawtooth'; osc.frequency.value = 40; osc.connect(gain); gain.connect(ctx.destination); gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(0.2, t + 0.5); gain.gain.linearRampToValueAtTime(0, t + 1.5); osc.start(t); osc.stop(t+1.5); }
        };
        
        // Loop synthesis split out from the toggle so the STUDENT MONITOR can start/stop the same
        // continuous wheeze/stridor purely from the synced `activeLoops` map (it previously never
        // reached students at all, because activeLoops was not in the payload).
        const startAudioLoop = (type) => {
            const ctx = audioCtxRef.current;
            if (!ctx || loopNodesRef.current[type]) return;
            if (ctx.state === 'suspended') resumeAudio();
            try {
                const osc = ctx.createOscillator(); const gain = ctx.createGain(); const lfo = ctx.createOscillator(); const lfoGain = ctx.createGain();
                if (type === 'Wheeze') { osc.type = 'triangle'; osc.frequency.value = 400; lfo.frequency.value = 0.25; lfoGain.gain.value = 200; }
                else if (type === 'Stridor') { osc.type = 'sawtooth'; osc.frequency.value = 600; lfo.frequency.value = 0.3; lfoGain.gain.value = 100; }
                else { osc.type = 'triangle'; osc.frequency.value = 400; lfo.frequency.value = 0.25; lfoGain.gain.value = 150; }
                lfo.connect(lfoGain); lfoGain.connect(osc.frequency); osc.connect(gain); gain.connect(ctx.destination);
                const now = ctx.currentTime; gain.gain.setValueAtTime(0, now); gain.gain.value = 0.05;
                osc.start(); lfo.start();
                loopNodesRef.current[type] = { stop: () => { try { gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5); } catch (e) {} setTimeout(() => { try { osc.stop(); lfo.stop(); } catch (e) {} }, 500); } };
            } catch (e) { console.warn('Audio loop failed to start', e); }
        };
        const stopAudioLoop = (type) => {
            if (!loopNodesRef.current[type]) return;
            loopNodesRef.current[type].stop();
            delete loopNodesRef.current[type];
        };

        const toggleAudioLoop = (type) => {
            if (!audioCtxRef.current) return;
            if (loopNodesRef.current[type]) {
                stopAudioLoop(type);
                const newLoops = {...state.activeLoops}; delete newLoops[type];
                dispatch({type: 'UPDATE_AUDIO_LOOPS', payload: newLoops});
                addLogEntry(`Audio Loop Stopped: ${type}`, 'manual');
            } else {
                startAudioLoop(type);
                dispatch({type: 'UPDATE_AUDIO_LOOPS', payload: {...state.activeLoops, [type]: true}});
                addLogEntry(`Audio Loop Started: ${type}`, 'manual');
            }
        };

        // Reconcile the locally-playing loops with the synced state. Runs on both devices, so the
        // facilitator's mute and audio routing apply to continuous sounds as well.
        useEffect(() => {
            const current = state;
            const wanted = (current.isMuted || !isAudioRouted(current)) ? {} : (current.activeLoops || {});
            Object.keys(loopNodesRef.current).forEach(type => { if (!wanted[type]) stopAudioLoop(type); });
            Object.keys(wanted).forEach(type => { if (wanted[type] && !loopNodesRef.current[type]) startAudioLoop(type); });
        }, [state.activeLoops, state.isMuted, state.audioOutput, isMonitorMode, audioCtxState]);

        // --- GROUP C: the AUTO / MANUAL deterioration toggle -------------------------------------
        // C3 is the critical requirement: "if switching from one to the other the obs should remain
        // the same at the point of switching." That is guaranteed structurally rather than by fixing
        // up numbers here — deterioration INTEGRATES into baseVitals, so the mode flag only gates
        // whether the integration runs. No vital is recomputed, re-snapshotted or reset by either
        // direction of the switch, so the displayed obs at second N are identical either way.
        const describeDeterioration = () => {
            const cur = stateRef.current;
            const det = cur.scenario && cur.scenario.deterioration ? cur.scenario.deterioration : null;
            const type = det ? normaliseDeteriorationType(det.type) : null;
            const rate = det ? Number(det.rate) : 0;
            return { type, rate: Number.isFinite(rate) ? rate : 0, declared: !!(det && det.active !== false && type && rate > 0) };
        };
        const setDeteriorationMode = (mode) => {
            const next = mode === 'auto' ? 'auto' : 'manual';
            const cur = stateRef.current;
            if (cur.deteriorationMode === next) return;
            const d = describeDeterioration();
            dispatch({ type: 'SET_DETERIORATION_MODE', payload: next });
            if (next === 'auto') {
                addLogEntry(d.declared
                    ? `Deterioration mode: AUTO — resuming ${d.type} decline at rate ${d.rate} FROM THE CURRENT OBS (HR ${cur.vitals.hr}, BP ${cur.vitals.bpSys}, SpO2 ${cur.vitals.spO2}%, RR ${cur.vitals.rr}, GCS ${cur.vitals.gcs}).`
                    : 'Deterioration mode: AUTO — but this scenario declares no deterioration type/rate, so nothing will change on its own.', 'system');
            } else {
                addLogEntry(`Deterioration mode: MANUAL — autonomous change stopped at HR ${cur.vitals.hr}, BP ${cur.vitals.bpSys}, SpO2 ${cur.vitals.spO2}%, RR ${cur.vitals.rr}, GCS ${cur.vitals.gcs}. Obs unchanged; full manual control.`, 'system');
            }
            dispatch({ type: 'SET_NOTIFICATION', payload: { msg: next === 'auto' ? 'AUTO: scenario deterioration active' : 'MANUAL: obs only change when you change them', type: 'info', id: Date.now() } });
        };
        const toggleDeteriorationMode = () => setDeteriorationMode(stateRef.current.deteriorationMode === 'auto' ? 'manual' : 'auto');

        // A5: what the facilitator needs to see — which drugs are live, the phase they are in and how
        // long is left, so "why are the obs still moving?" always has a visible answer.
        const getActiveDrugStatus = () => {
            const cur = stateRef.current;
            const t = cur.time;
            const rows = (cur.activeDrugs || []).map(d => {
                const factor = pkFactor(d, t);
                const remaining = pkRemaining(d, t);
                return {
                    key: d.key, label: d.label, phase: pkPhase(d, t),
                    intensity: Math.round(Math.min(1, factor) * 100),
                    remaining, elapsed: t - d.startTime, sustained: !!d.sustained,
                    stopped: d.sustained && d.stopTime >= 0, paralytic: !!d.paralytic, reversed: !!d.reversed,
                    effect: d.effect || {}
                };
            }).filter(r => r.phase !== 'gone');
            // Collapse repeat doses of the same drug into one row showing the dose count.
            const merged = {};
            rows.forEach(r => {
                const m = merged[r.key];
                if (!m) { merged[r.key] = { ...r, doses: 1 }; return; }
                m.doses += 1;
                m.intensity = Math.min(100, m.intensity + r.intensity);
                if (r.remaining === null || (m.remaining !== null && r.remaining > m.remaining)) m.remaining = r.remaining;
                // Show the phase of the most recent dose, which is what is actually changing the obs.
                if (r.elapsed < m.elapsed) { m.phase = r.phase; m.elapsed = r.elapsed; }
            });
            return Object.values(merged);
        };

        const start = () => {
            resumeAudio(true);
            // C5: state the mode explicitly at scenario start so an untouched toggle is never a surprise.
            const d = describeDeterioration();
            const mode = stateRef.current.deteriorationMode;
            addLogEntry(mode === 'auto' && d.declared
                ? `Deterioration mode: AUTO (scenario declares ${d.type}, rate ${d.rate}) — the patient will deteriorate on their own unless treated. Switch to MANUAL for full manual control.`
                : 'Deterioration mode: MANUAL — the obs will only change when you change them, or when a drug/trend you start changes them.', 'system');
            dispatch({ type: 'START_SIM' });
        };
        const pause = () => { dispatch({ type: 'PAUSE_SIM' }); };
        const stop = () => { dispatch({ type: 'STOP_SIM' }); };
        const reset = () => { shockCountRef.current = 0; dispatch({ type: 'CLEAR_SESSION' }); };
        // Called from the monitor's "Tap to Enable Sound" overlay, i.e. inside a real user gesture:
        // resume properly (awaiting the promise) and prime with a silent buffer for iOS.
        const enableAudio = () => {
            const p = resumeAudio(true);
            if (window.speechSynthesis) {
                try {
                    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
                    // Speaking an empty utterance inside the gesture unlocks TTS on iOS Safari.
                    const warm = new SpeechSynthesisUtterance(' ');
                    warm.volume = 0;
                    window.speechSynthesis.speak(warm);
                } catch (e) {}
            }
            return p;
        };

        useEffect(() => {
            // Physiology is owned by the controller. isRunning is now synced so the monitor can make
            // sound, but the monitor must NOT run its own 1 Hz physiology tick or it would fight the
            // authoritative vitals arriving over Firebase.
            if (state.isRunning && !isMonitorMode) {
                timerRef.current = setInterval(() => {
                    tickRef.current = Date.now();
                    dispatch({ type: 'TICK_TIME' }); 
                }, 1000);
            } else {
                if (timerRef.current) clearInterval(timerRef.current);
            }
            return () => { if (timerRef.current) clearInterval(timerRef.current); };
        }, [state.isRunning, isMonitorMode]);

        return { state, dispatch, start, pause, stop, reset, applyIntervention, addLogEntry, manualUpdateVital, triggerArrest, triggerROSC, revealInvestigation, clearInvestigation, nextCycle, enableAudio, speak, playSound, toggleAudioLoop, startTrend, triggerNIBP, toggleNIBPMode, triggerAction, initCharge, deliverShock, playAlertTone, audioContextState: audioCtxState, getUnmetExpectations: (action) => getUnmetExpectations(action, stateRef.current), setDeteriorationMode, toggleDeteriorationMode, describeDeterioration, getActiveDrugStatus };
    };
    window.useSimulation = useSimulation;
})();
