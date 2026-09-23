(() => {
    const { useState, useEffect, useRef, useReducer } = React;
    const { INTERVENTIONS, calculateDynamicVbg, getRandomInt, clamp } = window;

    // WAVE 3 / C1: the single shared rhythm registry. Every shockability, pulseless and
    // "is this an arrest?" decision in this file now goes through RG. The previous hardcoded
    // arrays (two shockability lists, seven arrest lists) are gone.
    const RG = window.RHYTHMS;
    if (!RG) throw new Error('data/rhythms.js must load before data/engine.js');

    // WAVE 4a / E8: serum potassium is a MODELLED VITAL. Hyperkalaemia and DKA were the two
    // flagship metabolic scenarios with no measurable endpoint at all: the app had
    // Insulin/Dextrose, calcium salts, salbutamol and bicarbonate but K+ existed only inside a
    // log string. `k` is a first-class vital now (controller + student monitor + sync payload),
    // so "did the K+ actually come down?" is answerable.
    const DEFAULT_VITALS = { etco2: 4.5, temp: 36.5, bm: 5.5, ph: 7.4, k: 4.2, hr: 80, bpSys: 120, bpDia: 80, spO2: 98, rr: 16, gcs: 15, pupils: 3 };

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
        hypoxiaTimer: 0,
        // ---- WAVE 5 / ITEM 6: FACILITATOR SUPREMACY OVER RHYTHM-DERIVED RATES ------------------
        // A map of vital keys the facilitator has TYPED a value for (`{ hr: true }`). It exists for
        // one reason: a rhythm change used to overwrite a manually-set HR with the new rhythm's
        // registry rate band, so typing HR 130 and then selecting Atrial Fibrillation showed 140 and
        // the tile no longer agreed with what was typed. Manual writes are precedence step 1 in the
        // Wave 2 order (manual -> trends -> deterioration -> airway -> drug envelope -> clamp), and
        // the rhythm band is a step-1 write too, so the tie has to be broken explicitly. It is broken
        // in the facilitator's favour, consistently with the rest of the app.
        // The hold is released only by an explicit release (arrest / ROSC / pulseless transitions,
        // which are themselves deliberate facilitator writes that define a new baseline) or by
        // loading a new scenario. Booleans only, so it survives JSON persistence untouched; it is
        // NOT part of the sync payload (the monitor does not run physiology).
        manualHold: {}
    };

    const initialLogState = {
        log: [], history: []
    };

    const initialScenarioState = {
        scenario: null, investigationsRevealed: {}, loadingInvestigations: {}
    };

    // WAVE 4b / D1: a genuinely unique identifier for THIS RUN of a scenario.
    // The debrief's instructor-notes localStorage key was built from `state.sessionID`, which has
    // never existed on state, so it silently fell back to `scenario.id`. That meant every run of the
    // same scenario shared one notes key and notes bled between sessions — and with Quick Sim, where
    // there is no meaningful scenario id at all, they would bleed across every quick sim ever run.
    // `runId` is minted once per LOAD_SCENARIO/RESTORE_SESSION, is a primitive (so it survives sync
    // and JSON persistence untouched), and is restored with a resumed session so resuming a run
    // reopens the SAME notes rather than starting a blank set.
    const newRunId = () => `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    const initialCoreState = {
        runId: null,
        time: 0, cycleTimer: 0, isRunning: false, rhythm: "Sinus Rhythm",
        monitorTimer: { visible: false, active: false, time: 0 },
        flash: null, activeInterventions: new Set(), interventionCounts: {},
        activeDurations: {}, isMuted: false,
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
        // WAVE 8 / FINDING 1: the obstruction severity that shapes the capnogram. On the controller
        // this is DERIVED every render by getObstruction(); it is stored only on the student monitor,
        // where it arrives over the wire as `co2Severity` so both views draw the identical shape.
        co2Severity: 0,
        // WAVE 8 / FINDING 2: the sim-clock second at which the FACILITATOR deliberately paused a
        // running session, or null. A session restored from storage is `null` even though its clock
        // is non-zero, which is exactly what tells "resumed, not yet started" apart from "paused
        // mid-session". Never persisted: reloading the page can only ever produce the former.
        pausedAt: null,
        monitorPopup: { type: null, timestamp: 0, customText: null },
        waveformGain: 1.0, noise: { interference: false },
        remotePacerState: { rate: 0, output: 0 }, notification: null, pacingThreshold: 70,
        icp: 10, activeLoops: {}, completedObjectives: new Set(), assessments: {},
        lastUpdate: 0, isOffline: false, showWetflag: true,
        // WAVE 4a / E8: mirrored top-level serum K+ (the authoritative copy lives in vitals.k).
        potassium: 4.2,
        // ---- WAVE 7 / ITEM 4: INTERMITTENT (POINT-OF-CARE) READINGS ------------------
        // Continuous monitoring (ECG, SpO2, capnography, art line, temperature probe) reveals a
        // LIVE value. A point-of-care check reveals the value AT THE MOMENT IT WAS TAKEN and must
        // then stop tracking, exactly as NIBP already does with its "LAST: 09:47" stamp. Each entry
        // is { value, at (sim seconds), clock (wall-clock string) } — primitives only, so the whole
        // object passes sanitizeForRealtimeDatabase untouched.
        pocReadings: {},
        // ---- WAVE 3 -------------------------------------------------------------------
        // A3: the assessor's Defib open/close toggle. Modelled exactly on arrestPanelOpen
        // (SET_DEFIB_PANEL / synced top-level boolean) so the remote monitor reacts promptly.
        defibPanelOpen: false,
        // B5: defibrillator device + metrics state. Previously shockCountRef was a bare useRef
        // that never reached state, Firebase, localStorage OR the debrief, and reset on resume.
        defib: {
            mode: 'monitor',            // monitor | defib | pacer | aed
            energy: null,               // currently selected energy (null = not yet resolved from weight)
            charged: false,
            chargeEnergy: null,
            syncMode: false,
            shockCount: 0,              // EVERY shock delivered, including into non-shockable rhythms
            shockableShocks: 0,         // shocks into a shockable rhythm — the only ones that drive ROSC
            totalEnergy: 0,
            lastEnergy: null,
            lastShockAt: null,          // ms epoch; drives the inter-shock refractory period
            analysing: false,
            lastAnalysis: null,
            shockBonus: 0               // additive ROSC bonus banked by adrenaline/amiodarone
        },
        // B4 / LEAK BARRIER: rhythmEvent and lastConversion are ASSESSOR-LOCAL. They are
        // deliberately absent from the Firebase sync payload (verified by
        // verify_wave3.js :: conversion announcements are not synced) because `notification`
        // IS synced and IS rendered on the student monitor. Conversion announcements must never
        // appear on the patient-facing screen — that would tell the team the answer.
        rhythmEvent: null,              // { id, from, to, cause, detail, at } — drives the toast
        lastConversion: null,           // last CONVERSION (from !== to) — drives the persistent strip
        // A5: which remote devices are connected and what each is displaying.
        remotePresence: { clients: [], updatedAt: null },
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

    // =====================================================================================
    // WAVE 7 / ITEM 4 — INDIVIDUALLY ATTACHABLE MONITORING
    //
    // One helper, derived from the SAME activeInterventions set that is already logged, already
    // flagged and already synced to the student monitor. No parallel state, nothing new on the
    // wire, and no scenario data changes: a scenario still starts with nothing attached, which is
    // the existing designed default ("NO SENSOR DETECTED").
    //
    // 'Obs' (Attach Monitoring) remains the ONE-CLICK FAST PATH and implies every continuous
    // sensor, so existing muscle memory, all 254 premade scenarios and the Quick Sim seed behave
    // exactly as before. The individual keys are additive.
    //
    // PERMISSIVE PHILOSOPHY UNCHANGED: sensors gate what the MONITOR DISPLAYS. They are never
    // prerequisites. Giving a drug with no IV access still proceeds and still raises the existing
    // amber deviation flag via `expects: ['IV Access']`.
    // =====================================================================================
    const SENSOR_DEFS = [
        { id: 'ecg',   key: 'MonECG',   label: 'ECG electrodes',  reveals: 'ECG trace + HR',        kind: 'continuous' },
        { id: 'spo2',  key: 'MonSpO2',  label: 'SpO2 probe',      reveals: 'pleth + SpO2',          kind: 'continuous' },
        { id: 'nibp',  key: 'MonNIBP',  label: 'NIBP cuff',       reveals: 'blood pressure',        kind: 'continuous' },
        { id: 'etco2', key: 'ToggleETCO2', label: 'Capnography',  reveals: 'capnogram + ETCO2',     kind: 'continuous' },
        { id: 'temp',  key: 'MonTemp',  label: 'Temp probe',      reveals: 'temperature',           kind: 'continuous' },
        { id: 'art',   key: 'ArtLine',  label: 'Arterial line',   reveals: 'continuous ABP',        kind: 'continuous' },
        { id: 'iv',    key: 'IV Access', label: 'IV / IO access', reveals: 'route for drugs',       kind: 'access' },
        { id: 'bm',    key: 'CheckGlucose', label: 'POC glucose', reveals: 'glucose (one-off)',     kind: 'poc', poc: 'bm' },
        { id: 'vbg',   key: 'CheckVBG', label: 'POC VBG',         reveals: 'pH + K+ (one-off)',     kind: 'poc', poc: 'vbg' }
    ];
    // Attaching everything = 'Obs' plus the individual continuous keys, so the monitor is fully
    // populated in a single action.
    const ATTACH_ALL_KEYS = ['Obs', 'MonECG', 'MonSpO2', 'MonNIBP', 'MonTemp'];
    // WAVE 8 / FINDING 4. The four sensors the ONE-PRESS fast path attaches, and the deliberate
    // clinical acts it does NOT. 'Obs' is a shorthand for exactly the standard four; it has never
    // implied capnography, an arterial line or IV access, and that clinical default is unchanged.
    // What changes is the honesty of the label: the fast path is now called "Attach standard", and
    // an "all on" state is only ever shown when everything really is on (see getSensors().all).
    const STANDARD_SENSOR_KEYS = ['MonECG', 'MonSpO2', 'MonNIBP', 'MonTemp'];
    // Offered as its own clearly-labelled action, never as part of the fast path.
    const INVASIVE_SENSOR_KEYS = ['IV Access', 'ArtLine', 'ToggleETCO2'];

    const getSensors = (coreState) => {
        const active = (coreState && coreState.activeInterventions) || new Set();
        const all = active.has && active.has('Obs');
        const has = (k) => !!(active.has && active.has(k));
        return {
            ecg: !!all || has('MonECG'),
            spo2: !!all || has('MonSpO2'),
            nibp: !!all || has('MonNIBP'),
            temp: !!all || has('MonTemp'),
            // Capnography keeps its own long-standing toggle rather than gaining a second switch.
            etco2: !!(coreState && coreState.etco2Enabled),
            art: has('ArtLine'),
            iv: has('IV Access') || has('IO Access'),
            any: !!all || has('MonECG') || has('MonSpO2') || has('MonNIBP') || has('MonTemp') ||
                 has('ArtLine') || !!(coreState && coreState.etco2Enabled),
            // WAVE 8 / FINDING 4: two HONEST summary flags, so no button can claim more than it did.
            // `standard` = the four sensors the fast path attaches. `all` = literally everything.
            get standard() { return this.ecg && this.spo2 && this.nibp && this.temp; },
            get all() { return this.ecg && this.spo2 && this.nibp && this.temp && this.etco2 && this.art && this.iv; }
        };
    };
    window.getSensors = getSensors;
    window.SENSOR_DEFS = SENSOR_DEFS;
    window.ATTACH_ALL_KEYS = ATTACH_ALL_KEYS;
    window.STANDARD_SENSOR_KEYS = STANDARD_SENSOR_KEYS;
    window.INVASIVE_SENSOR_KEYS = INVASIVE_SENSOR_KEYS;

    // Is the patient moving gas? Reads the EXISTING airway/paralysis model rather than inventing a
    // parallel one: a respiratory rate the monitor can see, or a device that delivers breaths.
    // Oesophageal intubation / disconnection / apnoea / paralysis-without-ventilation therefore all
    // resolve to "not ventilating" for free, and capnography correctly shows NO waveform.
    const isCapnoVentilating = (coreState, vitals) => {
        const rr = vitals && Number.isFinite(vitals.rr) ? vitals.rr : 0;
        if (rr > 0) return true;
        return isVentilated(coreState && coreState.activeInterventions) || !!(coreState && coreState.cprInProgress);
    };
    window.isCapnoVentilating = isCapnoVentilating;
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

    // WAVE 4b / D5: PUPILS ARE CATEGORICAL, NOT CONTINUOUS.
    // `pupils` legitimately holds either a number (3, 4, 8 — a diameter in mm) or one of a small set
    // of descriptive strings ('Dilated', 'Pinpoint', 'Unequal'), which the arrest and ROSC paths both
    // write. Interpolating between 3 and 'Dilated' yields NaN, and a NaN in `vitals` is rejected by
    // RTDB, which freezes the student monitor. This was latent only because no UI reached it — Quick
    // Sim adds a facilitator who can reach every vital, so it is guarded explicitly now rather than
    // relying on the incidental typeof checks further down.
    // Rule: pupils NEVER interpolate. They SNAP to the target, whatever its type. Numeric values are
    // coerced and clamped to a plausible 1-9 mm; strings pass through verbatim.
    const PUPIL_MIN_MM = 1, PUPIL_MAX_MM = 9;
    const normalisePupils = (val) => {
        if (typeof val === 'number') return Number.isFinite(val) ? Math.min(PUPIL_MAX_MM, Math.max(PUPIL_MIN_MM, Math.round(val))) : 3;
        const s = String(val === undefined || val === null ? '' : val).trim();
        if (s === '') return 3;
        // A numeric string from a number input ('4') is a diameter, not a description.
        const n = Number(s);
        if (Number.isFinite(n)) return Math.min(PUPIL_MAX_MM, Math.max(PUPIL_MIN_MM, Math.round(n)));
        return s;
    };
    // True for any vital that must never be linearly interpolated by the trend engine.
    const isCategoricalVital = (key) => key === 'pupils';

    const formatVital = (key, val) => {
        if (key === 'ph') return Math.round(val * 100) / 100;
        if (['temp', 'bm', 'etco2', 'k'].includes(key)) return Math.round(val * 10) / 10;
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
        gcs: [['gcs', 1]], BM: [['bm', 1]], Temp: [['temp', 1]], pH: [['ph', 1]],
        // WAVE 4a: K = serum potassium (mmol/L), ETCO2 = end-tidal CO2 (kPa, e.g. the CO2 load
        // after sodium bicarbonate).
        K: [['k', 1]], ETCO2: [['etco2', 1]]
    };
    const PK_EFFECT_FIELDS = Object.keys(EFFECT_TARGETS);

    const VITAL_LIMITS = {
        hr: [0, 250], bpSys: [0, 300], bpDia: [0, 200], spO2: [0, 100], rr: [0, 60],
        gcs: [3, 15], temp: [22, 43], bm: [0.5, 45], ph: [6.6, 7.9], etco2: [0, 15],
        // Survivable-and-recordable range for serum K+. Below 1.5 / above 9.5 is not a number a
        // simulator needs to display, and clamping keeps the RTDB payload finite.
        k: [1.5, 9.5]
    };
    const clampVital = (key, v) => {
        const lim = VITAL_LIMITS[key];
        if (!lim) return v;
        return Math.min(lim[1], Math.max(lim[0], v));
    };
    // Vitals a pulseless patient cannot express. Suppressed from the drug envelope during arrest.
    const ARREST_SUPPRESSED = ['hr', 'bpSys', 'bpDia', 'rr', 'spO2'];
    // C1: derived from the registry, NOT a local copy. The old literal included 'VT', which is
    // why VT-with-a-pulse (AM024) was treated as an arrest by the drug envelope.
    const PULSELESS_RHYTHMS = RG.PULSELESS;

    const PK_DEFAULT_MAX_DOSES = 3;
    const PK_PLATEAU_FRACTION = 0.35;   // share of the peak->offset window spent at full effect

    // Build the stored activeDrugs entry for an intervention. Primitives only, so the entry passes
    // sanitizeForRealtimeDatabase unchanged and survives JSON persistence.
    const buildDrugEntry = (key, action, startTime, dose = 1, opts = {}) => {
        if (!action || !action.pk) return null;
        const pk = opts.pk || action.pk;
        const effect = {};
        const srcEffect = opts.effect || action.effect;
        // WAVE 4a / E6 + paediatric notes: per-field magnitude scaling. A fixed HR +15 is a large
        // change in an adult and a small one in an infant whose baseline is 150, and BP responses
        // are proportionally smaller in children. `fieldScale` carries that (and any dosing
        // multiplier) into the STORED entry, so it survives sync, persistence and the debrief.
        const fieldScale = opts.fieldScale || null;
        PK_EFFECT_FIELDS.forEach(f => {
            let v = srcEffect ? srcEffect[f] : undefined;
            if (typeof v === 'number' && Number.isFinite(v) && v !== 0) {
                if (fieldScale && Number.isFinite(fieldScale[f])) v = v * fieldScale[f];
                effect[f] = Math.round(v * 1000) / 1000;
            }
        });
        const paralytic = !!(srcEffect && srcEffect.paralysed);
        // WAVE 4a / PART 2D: a `drive` declares that this intervention moves a vital at a RATE
        // towards a TARGET (active warming/cooling, a fixed-rate insulin infusion) instead of
        // parking it at a fixed offset. The driven vitals are integrated into baseVitals by
        // applyDriveTick and are therefore EXCLUDED from this entry's additive envelope, so the
        // effect can never be counted twice.
        const drives = [];
        if (action.drive) {
            [action.drive, action.drive.secondary].forEach(dr => {
                if (dr && dr.vital && Number.isFinite(Number(dr.ratePerHour))) {
                    drives.push({ vital: dr.vital, ratePerHour: Number(dr.ratePerHour), target: Number.isFinite(Number(dr.target)) ? Number(dr.target) : null });
                }
            });
        }
        // An entry with no numeric effect, no paralysis role and no rate drive contributes nothing to
        // the vitals — but it is still a drug that is running, and WAVE 5 / ITEM 10 is precisely about
        // a facilitator being unable to tell "pending, working as intended" from "nothing happened".
        // Levetiracetam and the other agents whose modelled effect is anticonvulsant rather than
        // haemodynamic used to vanish from the Active Drugs panel entirely. They now appear, with
        // their onset countdown, and contribute exactly zero to the envelope (there is nothing in
        // `effect` to add), so no vitals behaviour changes anywhere.
        if (Object.keys(effect).length === 0 && !paralytic && !drives.length && !action.pk) return null;
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
            reversed: false, effect,
            // Descriptive only (E1). Rendered on the button/label and in the debrief so IM vs IV
            // is visible at a glance; route BEHAVIOUR always comes from a separate key.
            route: action.route || null,
            drives,
            // E7: an ABSOLUTE ceiling on the composed vital, not just an additive dose cap.
            // Atropine cannot take the heart rate past full vagal blockade however many doses are
            // given, and a beta-agonist cannot push it past ~155.
            ceilingVital: (action.ceiling && action.ceiling.vital) || null,
            ceilingValue: (action.ceiling && Number.isFinite(Number(action.ceiling.value))) ? Number(action.ceiling.value) : null
        };
    };

    // Vitals currently being RATE-DRIVEN by a running intervention, so the additive envelope must
    // not also apply them. Keyed by vital name.
    const drivenVitals = (activeDrugs, t) => {
        const out = {};
        (activeDrugs || []).forEach(d => {
            if (!d.drives || !d.drives.length) return;
            if (d.sustained && d.stopTime >= 0) return;          // stopped: no longer driving
            if (t - d.startTime < d.onset) return;               // not started yet
            d.drives.forEach(dr => { out[dr.vital] = true; });
        });
        return out;
    };

    // PART 2D — ONE realistic warming rate and ONE realistic cooling rate, with NO artificial
    // plateau: integrate towards normothermia (or, for insulin, towards a target glucose) and STOP
    // on arrival. The old model held Temp at +/-1.5 degC of wherever the patient started, so a
    // patient at 30.0 degC could never be warmed past 31.5 and hyperthermia could never be
    // corrected at all. Integrates into `base` IN PLACE; returns true if anything moved.
    // How long a rate-driven intervention (warming blanket, cooling, insulin infusion) takes to
    // reach its full rate after its onset.
    // WAVE 5 / ITEM 9: 300s -> 120s. The declared rate (2 degC/h of cooling) was only ever reached
    // after a 300 s pk onset PLUS a 300 s linear ramp, and the ramp costs half of its own window, so
    // the first ten minutes delivered roughly a third of the declared rate — which is exactly the
    // discrepancy live testing measured (0.1 degC per 8-10 min instead of per ~3 min). 120 s keeps the
    // switch-on smooth without hiding the rate. The rate itself is unchanged and the base integration
    // is unrounded, so nothing is lost per tick.
    const DRIVE_RAMP_SECONDS = 120;
    const applyDriveTick = (base, activeDrugs, t) => {
        let moved = false;
        (activeDrugs || []).forEach(d => {
            if (!d.drives || !d.drives.length) return;
            if (d.sustained && d.stopTime >= 0) return;
            const el = t - d.startTime;
            if (el < d.onset) return;
            // Ramp in over a FIXED short window after onset (not onset -> peak). A drive is a RATE,
            // so `peak` here means "time to the full nominal excursion" and is measured in hours for
            // warming/cooling — ramping the rate itself over that window would make a Bair Hugger
            // take half a day to reach 1.5 degC/h and the earlier build's temperature looked frozen.
            // 300 s of spin-up keeps the switch-on smooth without blunting the rate.
            const ramp = Math.max(0, Math.min(1, (el - d.onset) / DRIVE_RAMP_SECONDS));
            d.drives.forEach(dr => {
                const cur = base[dr.vital];
                if (typeof cur !== 'number' || !Number.isFinite(cur)) return;
                const perSecond = (dr.ratePerHour / 3600) * ramp * (Number(d.dose) || 1);
                if (!perSecond) return;
                let next = cur + perSecond;
                if (dr.target !== null && dr.target !== undefined) {
                    // Never overshoot the target, and never push a vital the wrong way if it is
                    // already past it (warming a pyrexial patient does not cool them).
                    if (perSecond > 0) next = Math.min(next, Math.max(cur, dr.target));
                    else next = Math.max(next, Math.min(cur, dr.target));
                }
                next = clampVital(dr.vital, next);
                if (next !== cur) { base[dr.vital] = next; moved = true; }
            });
        });
        return moved;
    };

    // WAVE 4a / E11: the Wave 2 documentation promised COSINE-SMOOTHED ramps; the code shipped a bare
    // linear interpolation. Rather than downgrade the documentation, the smoothing is now implemented:
    // a raised-cosine ease maps 0..1 -> 0..1 with zero slope at both ends, so a drug's effect eases in
    // and eases out instead of starting and stopping with a visible kink on the trend graph. Midpoint
    // is still exactly 0.5, so every pk timing (onset/peak/plateau/offset) is unchanged.
    const easeRamp = (x) => {
        if (!(x > 0)) return 0;
        if (x >= 1) return 1;
        return 0.5 - 0.5 * Math.cos(Math.PI * x);
    };

    // 0 before onset -> cosine-eased ramp to 1 at peak -> plateau -> eased decay to 0 at offset.
    const pkFactor = (d, t) => {
        if (!d) return 0;
        const el = t - d.startTime;
        if (!Number.isFinite(el) || el <= d.onset) return 0;
        if (el < d.peak) return easeRamp((el - d.onset) / Math.max(1, d.peak - d.onset));
        if (d.sustained) {
            if (d.stopTime === undefined || d.stopTime === null || d.stopTime < 0) return 1;  // still running
            const tail = d.offset > 0 ? d.offset : 120;
            const since = t - d.stopTime;
            if (since <= 0) return 1;
            if (since >= tail) return 0;
            return easeRamp(1 - (since / tail));
        }
        if (!d.offset || d.offset <= d.peak) return 1;   // no modelled wear-off
        const plateauEnd = (d.plateau !== undefined && d.plateau >= 0)
            ? d.plateau
            : d.peak + PK_PLATEAU_FRACTION * (d.offset - d.peak);
        if (el <= plateauEnd) return 1;
        if (el >= d.offset) return 0;
        return easeRamp(1 - ((el - plateauEnd) / Math.max(1, d.offset - plateauEnd)));
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
        const driven = drivenVitals(activeDrugs, t);
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
                targets.forEach(([vital, scale]) => {
                    // A rate-driven vital (warming/cooling temperature, insulin glucose/K+) is owned
                    // by applyDriveTick in base space. Adding the envelope too would double-count.
                    if (driven[vital]) return;
                    out[vital] = (out[vital] || 0) + amt * f * scale;
                });
            });
        });
        return out;
    };

    // E7: absolute, saturating ceilings. Collected from whichever entries are currently live so a
    // spent dose stops constraining anything.
    const drugCeilings = (activeDrugs, t) => {
        const out = {};
        (activeDrugs || []).forEach(d => {
            if (!d.ceilingVital || d.ceilingValue === null || d.ceilingValue === undefined) return;
            if (!(pkFactor(d, t) > 0)) return;
            const prev = out[d.ceilingVital];
            out[d.ceilingVital] = prev === undefined ? d.ceilingValue : Math.max(prev, d.ceilingValue);
        });
        return out;
    };

    // Step 5 + 6 of the precedence order: base + envelope -> clamp -> coherence -> round.
    // FACILITATOR SUPREMACY vs the E7 ceiling. The facilitator types the number they want to SEE,
    // so a displayed target has to be inverted through the composition. composeVitals maps
    //     base -> base + min(off, max(0, ceil - base))
    // which is monotone with a plateau at the ceiling, so the inverse is simply: a target ABOVE the
    // ceiling is stored as-is (the drug legitimately contributes nothing once the patient's own
    // rate already exceeds full vagal blockade), and anything at or below it has the current drug
    // contribution removed. Without this a ceilinged drug would silently swallow part of a manual
    // write or trend target, which Waves 1-2 guarantee can never happen.
    const baseForDisplayed = (key, value, off, ceil) => {
        if (typeof value !== 'number' || !Number.isFinite(value)) return value;
        if (!off) return value;
        if (Number.isFinite(ceil) && off > 0 && value > ceil) return value;
        return value - off;
    };

    const composeVitals = (base, activeDrugs, t, inArrest) => {
        const offs = drugOffsets(activeDrugs, t);
        const ceil = drugCeilings(activeDrugs, t);
        const out = {};
        Object.keys(base).forEach(k => {
            const bv = base[k];
            if (typeof bv !== 'number' || !Number.isFinite(bv)) { out[k] = bv; return; }
            let off = offs[k] || 0;
            if (inArrest && ARREST_SUPPRESSED.indexOf(k) !== -1) off = 0;
            let composed = bv + off;
            // E7: a saturating ceiling only ever removes DRUG-DRIVEN excess — it can never pull a
            // vital below where the underlying physiology already is (a tachycardic septic patient
            // given atropine does not have their heart rate "capped" down to 115).
            if (off > 0 && ceil[k] !== undefined && composed > ceil[k]) composed = Math.max(bv, ceil[k]);
            out[k] = formatVital(k, clampVital(k, composed));
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
    // WAVE 4a: the new route-specific keys are wired in here too. A clinically correct treatment
    // given by a route the engine did not know about (buccal midazolam for status, IM adrenaline
    // escalated to an infusion, IM benzylpenicillin pre-hospital) previously did NOT slow the
    // autonomous deterioration at all, so the learner was punished for correct non-IV practice.
    const DETERIORATION_TREATMENTS = {
        shock: ['Fluids', 'FluidInfusion', 'Blood', 'Noradrenaline', 'Metaraminol', 'AdrenalineIM', 'TXA', 'Antibiotics', 'Ceftriaxone', 'Tazocin', 'Gentamicin', 'PelvicBinder', 'Tourniquet', 'REBOA', 'Thoracotomy', 'Pericardiocentesis', 'Hydrocortisone', 'Terlipressin', 'Octaplex', 'Albumin', 'Surgery', 'CalciumChloride',
            'AdrenalineInfusion', 'AdrenalinePush'],
        resp: ['Oxygen', 'Nebs', 'NebAdrenaline', 'CPAP', 'NIV', 'Bagging', 'MagSulph', 'Hydrocortisone', 'Dexamethasone', 'i-gel', 'RSI', 'Needle', 'FingerThoracostomy', 'SeldingerDrain', 'SurgicalDrain', 'ChestSeal', 'Furosemide', 'GTNInfusion', 'Antibiotics', 'Thrombolysis',
            'NebsContinuous', 'SalbutamolIV', 'MagnesiumInfusion'],
        airway: ['Manoeuvres', 'OPA', 'NPA', 'Suction', 'Magills', 'i-gel', 'RSI', 'FONA', 'NebAdrenaline', 'Dexamethasone', 'AdrenalineIM', 'Bagging', 'Oxygen', 'Chlorphenamine',
            'AdrenalineInfusion'],
        cardiac: ['Atropine', 'Pacing', 'PacingPads', 'Adenosine', 'Amiodarone', 'Cardioversion', 'Aspirin', 'GTN', 'GTNInfusion', 'PPCI', 'Thrombolysis', 'Metaraminol', 'Fluids', 'Digibind', 'CalciumChloride', 'Calcium', 'InsulinDextrose', 'Noradrenaline', 'Furosemide', 'NIV',
            'AmiodaroneInfusion', 'LabetalolInfusion', 'Digoxin'],
        neuro: ['HypertonicSaline', 'RSI', 'Lorazepam', 'Midazolam', 'Thrombolysis', 'Oxygen', 'Dextrose', 'Glucagon', 'Pabrinex', 'Naloxone', 'Antibiotics', 'Ceftriaxone', 'Dexamethasone', 'Surgery',
            'MidazolamBuccal', 'MidazolamIN', 'MidazolamIM', 'DiazepamIV', 'DiazepamPR', 'LorazepamIM', 'Levetiracetam', 'Phenytoin', 'NaloxoneIM', 'NaloxoneIN', 'Flumazenil', 'GlucoseOral', 'Benzylpenicillin', 'BenzylpenicillinIM'],
        arrest: ['CPR', 'Lucas', 'AdrenalineIV', 'Defib', 'Amiodarone']
    };

    // =============================================================================================
    // PART 2B — VOLUME RESPONSIVENESS
    // ---------------------------------------------------------------------------------------------
    // A 500 mL bolus raised the BP by exactly +8 mmHg in every one of the 254 scenarios, which
    // taught that fluid is the answer to cardiogenic shock and APO. Responsiveness is now a
    // PROPERTY OF THE PATIENT: it scales the dose multiplier of every volume intervention
    // (crystalloid bolus, maintenance infusion, blood, albumin).
    //
    // A scenario may declare it explicitly — `fluidResponse: 'high' | 'moderate' | 'low' | 'none'`
    // or a raw 0-1.2 number, plus `fluidOverload: true` — but it does NOT have to: the default is
    // INFERRED from the scenario's deterioration `type` and its title/diagnosis text, so all 254
    // existing scenarios behave sensibly with no hand-authoring.
    // =============================================================================================
    const FLUID_RESPONSE_LEVELS = { high: 1.15, moderate: 0.8, low: 0.3, none: 0.08 };
    const FLUID_UNRESPONSIVE_HINTS = ['cardiogenic', 'pulmonary oedema', 'pulmonary edema', ' apo', 'apo ', 'heart failure', 'lvf', 'fluid overload', 'overload', 'decompensated heart', 'cardiac failure', 'tamponade', 'myocarditis', 'dialysis', 'renal failure', 'esrf', 'end stage renal'];
    const FLUID_RESPONSIVE_HINTS = ['haemorrh', 'hemorrh', 'bleed', 'trauma', 'ruptured', 'aaa', 'ectopic', 'pph', 'postpartum', 'burn', 'dka', 'hhs', 'dehydr', 'gastroenteritis', 'diarrhoea', 'vomit', 'sepsis', 'septic', 'hypovol', 'anaphyla', 'addisonian', 'adrenal', 'hyperemesis', 'heat stroke', 'rhabdo', 'obstruction', 'pancreatitis', 'stab', 'gunshot', 'fracture', 'splenic', 'liver lac'];
    const scenarioText = (s) => [s && s.title, s && s.presentingComplaint, s && s.diagnosis,
        s && s.instructorBrief && s.instructorBrief.progression,
        s && s.instructorBrief && s.instructorBrief.diagnosis].filter(Boolean).join(' ').toLowerCase();

    const fluidResponsiveness = (scenario) => {
        const s = scenario || {};
        // 1. Explicit declaration always wins.
        if (typeof s.fluidResponse === 'number' && Number.isFinite(s.fluidResponse)) {
            return { factor: Math.max(0, Math.min(1.2, s.fluidResponse)), overload: !!s.fluidOverload, source: 'scenario' };
        }
        if (typeof s.fluidResponse === 'string' && FLUID_RESPONSE_LEVELS[s.fluidResponse.toLowerCase()] !== undefined) {
            const lvl = s.fluidResponse.toLowerCase();
            return { factor: FLUID_RESPONSE_LEVELS[lvl], overload: !!s.fluidOverload || lvl === 'none', source: 'scenario' };
        }
        // 2. Inferred default.
        const txt = scenarioText(s);
        if (FLUID_UNRESPONSIVE_HINTS.some(h => txt.indexOf(h) !== -1)) {
            return { factor: FLUID_RESPONSE_LEVELS.none, overload: true, source: 'inferred:overload' };
        }
        if (FLUID_RESPONSIVE_HINTS.some(h => txt.indexOf(h) !== -1)) {
            return { factor: FLUID_RESPONSE_LEVELS.high, overload: false, source: 'inferred:hypovolaemic' };
        }
        const type = normaliseDeteriorationType(s.deterioration && s.deterioration.type);
        if (type === 'shock') return { factor: FLUID_RESPONSE_LEVELS.high, overload: false, source: 'inferred:shock' };
        if (type === 'cardiac') return { factor: FLUID_RESPONSE_LEVELS.low, overload: false, source: 'inferred:cardiac' };
        if (type === 'resp') return { factor: FLUID_RESPONSE_LEVELS.low, overload: false, source: 'inferred:resp' };
        return { factor: FLUID_RESPONSE_LEVELS.moderate, overload: false, source: 'inferred:default' };
    };
    const VOLUME_KEYS = ['Fluids', 'FluidInfusion', 'Blood', 'Albumin'];

    // E8 support: a sensible STARTING potassium for scenarios that never declared one, so the two
    // flagship metabolic scenarios have a real endpoint. Explicit scenario vitals always win.
    const inferPotassium = (scenario) => {
        const txt = scenarioText(scenario);
        if (txt.indexOf('hyperkal') !== -1) return 7.1;
        if (txt.indexOf('hypokal') !== -1) return 2.4;
        if (txt.indexOf('dka') !== -1 || txt.indexOf('ketoacid') !== -1) return 5.4;
        if (txt.indexOf('crush') !== -1 || txt.indexOf('rhabdo') !== -1) return 6.2;
        if (txt.indexOf('renal failure') !== -1 || txt.indexOf('dialysis') !== -1) return 6.0;
        if (txt.indexOf('addisonian') !== -1) return 5.8;
        if (txt.indexOf('pyloric') !== -1 || txt.indexOf('vomit') !== -1) return 3.2;
        return null;
    };

    // =============================================================================================
    // PART 5 / E4 + E6 — AGE-AWARE PHYSIOLOGY
    // ---------------------------------------------------------------------------------------------
    // WETFLAG weight-based dosing already exists but only ever edited a LOG STRING, so a paediatric
    // dose and an adult dose were physiologically identical. Two age-dependent things matter most:
    //   1. SAFE APNOEA TIME. A well pre-oxygenated healthy adult tolerates 6-10 min of apnoea; an
    //      infant desaturates in 60-90 s. The old model gave 40 s WITH pre-oxygenation and 10 s
    //      without, for every patient of every age — which actively mis-teaches RSI.
    //   2. EFFECT MAGNITUDE relative to baseline: HR/RR responses are proportionally larger in a
    //      small child (baseline HR 150), BP responses smaller.
    // =============================================================================================
    const ageBandOf = (scenario) => {
        const s = scenario || {};
        let age = Number(s.patientAge);
        if (!Number.isFinite(age)) {
            if (s.ageRange === 'Paediatric') age = 5;
            else if (s.ageRange === 'Neonate' || /neonat/i.test(s.title || '')) age = 0;
            else age = 40;
        }
        if (age < 1) return 'infant';
        if (age < 5) return 'toddler';
        if (age < 12) return 'child';
        return 'adult';
    };
    // Seconds of apnoea tolerated BEFORE the saturation starts to fall. Pre-oxygenation is the
    // dominant term; the floor is the un-preoxygenated value.
    const SAFE_APNOEA = {
        adult:   { preox: 360, none: 45 },
        child:   { preox: 210, none: 35 },
        toddler: { preox: 150, none: 25 },
        infant:  { preox: 105, none: 20 }
    };
    const safeApnoeaSeconds = (scenario, opts = {}) => {
        const band = ageBandOf(scenario);
        const table = SAFE_APNOEA[band] || SAFE_APNOEA.adult;
        let grace = opts.preoxygenated ? table.preox : table.none;
        // Pre-oxygenation has to have been RUNNING long enough to denitrogenate. Less than ~120 s
        // of 15 L/min buys proportionally less.
        if (opts.preoxygenated && Number.isFinite(opts.preoxSeconds) && opts.preoxSeconds < 120) {
            grace = table.none + (grace - table.none) * Math.max(0, opts.preoxSeconds) / 120;
        }
        // Apnoeic (nasal) oxygenation extends the safe window as well as halving the drop rate.
        if (opts.apnoeicO2) grace *= 1.5;
        // Physiology that shortens it: shunt, sepsis, pregnancy, obesity, a low starting SpO2.
        if (Number.isFinite(opts.startingSpO2) && opts.startingSpO2 < 94) grace *= Math.max(0.25, (opts.startingSpO2 - 80) / 14);
        if (opts.highConsumption) grace *= 0.6;
        return Math.max(8, Math.round(grace));
    };
    const HIGH_CONSUMPTION_HINTS = ['sepsis', 'septic', 'pregnan', 'eclamp', 'obes', 'bariatric', 'peritonitis', 'dka', 'burn', 'anaphyla', 'status asthmaticus'];
    const hasHighO2Consumption = (scenario) => {
        const txt = scenarioText(scenario);
        return HIGH_CONSUMPTION_HINTS.some(h => txt.indexOf(h) !== -1);
    };
    // E6 / paediatric note 2: per-effect-field magnitude scaling by age band.
    const PAEDIATRIC_FIELD_SCALE = {
        infant:  { HR: 1.4, RR: 1.35, BP: 0.7 },
        toddler: { HR: 1.3, RR: 1.25, BP: 0.8 },
        child:   { HR: 1.15, RR: 1.1, BP: 0.9 },
        adult:   null
    };
    const paediatricFieldScale = (scenario) => PAEDIATRIC_FIELD_SCALE[ageBandOf(scenario)] || null;

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

    // =============================================================================================
    // WAVE 8 / FINDING 1 — HOW OBSTRUCTED IS THIS PATIENT RIGHT NOW?
    // ---------------------------------------------------------------------------------------------
    // ONE number, 0 (not obstructed) to 1 (life-threatening bronchospasm, silent chest), derived
    // entirely from state the engine already holds. It is the single source of truth for the
    // capnogram's shark fin (RHYTHMS.capnogram) — there is no parallel "obstruction" state, nothing
    // new is persisted and nothing new has to be authored into the 254 scenarios.
    //
    //   base     the obstructive diagnosis, INFERRED from the scenario text exactly the way
    //            fluidResponsiveness() infers volume responsiveness.
    //   tiring   how hard the patient is working right now (hypoxia + tachypnoea), up to +0.20.
    //   relief   bronchodilator effect, read from each drug's OWN pk envelope in activeDrugs, so
    //            salbutamol/ipratropium nebs, IV salbutamol, magnesium, nebulised or IM adrenaline
    //            and steroids normalise the capnogram OVER MINUTES as they take effect, and the fin
    //            relapses if they are allowed to wear off. This is the teaching point.
    //   override the facilitator's explicit etco2Pathology choice always wins (Wave 5 supremacy).
    // =============================================================================================
    const OBSTRUCTION_HINTS = [
        { re: /silent chest|status asthmaticus|life.?threatening asthma|near.?fatal asthma/, v: 0.95, why: 'life-threatening asthma' },
        { re: /acute severe asthma|severe asthma/, v: 0.85, why: 'acute severe asthma' },
        { re: /asthma|asthmatic/, v: 0.65, why: 'asthma' },
        { re: /bronchospasm/, v: 0.60, why: 'bronchospasm' },
        { re: /bronchiolitis/, v: 0.60, why: 'bronchiolitis' },
        { re: /copd|chronic obstructive|emphysema/, v: 0.55, why: 'COPD' },
        { re: /anaphyla/, v: 0.45, why: 'anaphylaxis' },
        { re: /wheez/, v: 0.45, why: 'wheeze' }
    ];
    // Relief weight per bronchodilator/anti-inflammatory. Each is multiplied by that dose's own pk
    // factor, so relief RAMPS with the drug rather than appearing the instant the button is pressed.
    const BRONCHODILATORS = {
        'Nebs': 0.40, 'NebsContinuous': 0.50, 'NebAdrenaline': 0.35, 'SalbutamolIV': 0.45,
        'MagSulph': 0.35, 'MagnesiumInfusion': 0.35,
        'AdrenalineIM': 0.35, 'AdrenalineInfusion': 0.35, 'AdrenalineIV': 0.25, 'AdrenalinePush': 0.20,
        'Hydrocortisone': 0.12, 'Dexamethasone': 0.12
    };
    const OBSTRUCTION_BANDS = [
        { at: 0.06, label: 'none' }, { at: 0.35, label: 'mild' },
        { at: 0.70, label: 'moderate' }, { at: 1.01, label: 'severe' }
    ];
    const obstructionBand = (s) => {
        for (let i = 0; i < OBSTRUCTION_BANDS.length; i++) if (s < OBSTRUCTION_BANDS[i].at) return OBSTRUCTION_BANDS[i].label;
        return 'severe';
    };
    // "No rash, no wheeze" must NOT read as bronchospasm (ACE-inhibitor angioedema says exactly
    // that, and is bradykinin-mediated: adrenaline and nebs do little, which is its whole point).
    const scrubNegations = (txt) => String(txt || '')
        .replace(/\b(?:no|without|not?)\s+(?:[a-z]+\s+)?(?:wheez\w*|bronchospasm)/g, ' ')
        .replace(/\bno\s+rash,?\s*no\s+wheez\w*/g, ' ');

    const inferObstruction = (scenario) => {
        const txt = scrubNegations(scenarioText(scenario));
        let base = 0, why = null;
        OBSTRUCTION_HINTS.forEach(h => { if (h.re.test(txt) && h.v > base) { base = h.v; why = h.why; } });
        if (!base) return { base: 0, why: null };
        // Acuity is a real severity signal in this data set: the same diagnosis is authored at
        // Resus or at Majors.
        const acuity = String((scenario && scenario.acuity) || '').toLowerCase();
        if (acuity === 'resus') base = Math.min(1, base * 1.1);
        else if (acuity === 'majors') base = base * 0.85;
        else if (acuity === 'minors') base = base * 0.6;
        return { base: Math.max(0, Math.min(1, base)), why };
    };

    const getObstruction = (coreState, vitals, scenarioArg) => {
        const cs = coreState || {};
        const scenario = scenarioArg || cs.scenario || null;
        const pattern = cs.etco2Pathology || 'normal';
        const inferred = inferObstruction(scenario);
        let base = inferred.base;
        const v = vitals || cs.vitals || {};
        let tiring = 0;
        if (base > 0) {
            if (Number.isFinite(v.spO2)) tiring += Math.min(0.12, Math.max(0, (92 - v.spO2) / 100));
            if (Number.isFinite(v.rr)) tiring += Math.min(0.08, Math.max(0, (v.rr - 24) / 200));
        }
        // Bronchodilator relief, from the pk envelopes that are already running.
        const t = Number.isFinite(cs.time) ? cs.time : 0;
        const perKey = {};
        (Array.isArray(cs.activeDrugs) ? cs.activeDrugs : []).forEach(d => {
            const w = BRONCHODILATORS[d && d.key];
            if (!w) return;
            const f = pkFactor(d, t);
            if (!(f > 0)) return;
            // Two doses of the same agent count; a sixth neb does not keep adding.
            perKey[d.key] = Math.min(w * 2, (perKey[d.key] || 0) + w * f);
        });
        let relief = Object.keys(perKey).reduce((a, k) => a + perKey[k], 0);
        relief = Math.max(0, Math.min(0.95, relief));
        let severity = (base + tiring) * (1 - relief);
        severity = Math.max(0, Math.min(1, severity));
        // Facilitator override (Wave 5): an explicit choice is never overruled by the model.
        let source = inferred.why ? `scenario: ${inferred.why}` : 'no obstructive diagnosis';
        if (pattern === 'bronchospastic') { severity = Math.max(severity, 0.85); source = 'facilitator: forced obstructive'; }
        else if (pattern === 'nonobstructive') { severity = 0; source = 'facilitator: forced non-obstructive'; }
        return {
            severity: Math.round(severity * 1000) / 1000,
            band: obstructionBand(severity),
            base: Math.round(base * 1000) / 1000,
            tiring: Math.round(tiring * 1000) / 1000,
            relief: Math.round(relief * 1000) / 1000,
            pattern, source
        };
    };
    window.getObstruction = getObstruction;
    window.OBSTRUCTION_HINTS = OBSTRUCTION_HINTS;
    window.BRONCHODILATORS = BRONCHODILATORS;

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

    window.__pkInternals = { pkFactor, pkPhase, pkRemaining, drugOffsets, composeVitals, buildDrugEntry, paralysisFromDrugs, deteriorationDeltas, applyDeteriorationTick, deteriorationTreatmentFactor, normaliseDeteriorationType, formatVital, clampVital, DEFAULT_VITALS, EFFECT_TARGETS, VITAL_LIMITS, isDrugSpent,
        // WAVE 4b / D5: exported so the verifiers can assert the categorical-vital guard directly.
        normalisePupils, isCategoricalVital,
        // WAVE 4a additions, all exercised directly by the Node verification harness.
        drivenVitals, applyDriveTick, drugCeilings, baseForDisplayed, easeRamp, fluidResponsiveness, inferPotassium, VOLUME_KEYS,
        ageBandOf, safeApnoeaSeconds, paediatricFieldScale, hasHighO2Consumption, DETERIORATION_TREATMENTS,
        FLUID_RESPONSE_LEVELS,
        // WAVE 8: the bronchospasm severity model behind the shark-fin capnogram.
        getObstruction, inferObstruction, obstructionBand, BRONCHODILATORS, OBSTRUCTION_HINTS };

    const OBJECTIVE_TRIGGERS = {
        'Antibiotics':   ['antibio', 'sepsis', 'infection', 'antimicro'],
        'Fluids':        ['fluid', 'resus', 'bolus', 'iv fluid', 'saline'],
        'AdrenalineIM':  ['adrenaline', 'anaphyl', 'epinephrine'],
        'AdrenalineIV':  ['adrenaline', 'cardiac arrest', 'epinephrine'],
        // E10: 'Adrenaline', 'O2', 'NaloxoneIV', 'Tranexamic', 'ChestDrain' and
        // 'NeedleDecomp' were DEAD KEYS — no such intervention exists, so those learning
        // objectives could never auto-complete. Remapped to the real keys.
        'AdrenalinePush':      ['adrenaline', 'epinephrine', 'hypotension'],
        'AdrenalineInfusion':  ['adrenaline', 'anaphyl', 'epinephrine', 'refractory'],
        'Oxygen':        ['oxygen', 'o2', 'airway'],
        'Aspirin':       ['aspirin', 'acs', 'stemi', 'nstemi'],
        'GTN':           ['gtn', 'nitrate', 'acs'],
        'InsulinInfusion': ['insulin', 'dka', 'glucose'],
        'InsulinDextrose': ['insulin', 'dka', 'glucose', 'hyperkalaemia', 'hyperkalemia'],
        'Atropine':      ['atropine', 'bradycardia', 'heart block'],
        'Lorazepam':     ['lorazepam', 'seizure', 'benzodiazep'],
        'LorazepamIM':   ['lorazepam', 'seizure', 'benzodiazep'],
        'MidazolamBuccal': ['seizure', 'status epilepticus', 'benzodiazep', 'convuls'],
        'MidazolamIN':   ['seizure', 'status epilepticus', 'benzodiazep', 'convuls'],
        'MidazolamIM':   ['seizure', 'status epilepticus', 'benzodiazep', 'convuls'],
        'DiazepamPR':    ['seizure', 'status epilepticus', 'benzodiazep', 'convuls'],
        'DiazepamIV':    ['seizure', 'status epilepticus', 'benzodiazep', 'convuls'],
        'Levetiracetam': ['seizure', 'status epilepticus', 'anticonvuls'],
        'Phenytoin':     ['seizure', 'status epilepticus', 'anticonvuls'],
        'Naloxone':      ['naloxone', 'opiate', 'opioid'],
        'NaloxoneIM':    ['naloxone', 'opiate', 'opioid'],
        'NaloxoneIN':    ['naloxone', 'opiate', 'opioid'],
        'TXA':           ['tranexam', 'haemorrhage', 'trauma'],
        'RSI':           ['rsi', 'intubat', 'airway management'],
        'SeldingerDrain':['chest drain', 'pneumothorax', 'haemothorax'],
        'SurgicalDrain': ['chest drain', 'pneumothorax', 'haemothorax'],
        'Needle':        ['needle', 'pneumothorax', 'tension'],
        'Benzylpenicillin':   ['meningo', 'meningitis', 'antibio', 'sepsis'],
        'BenzylpenicillinIM': ['meningo', 'meningitis', 'antibio', 'sepsis'],
        'NebsContinuous':     ['asthma', 'salbutamol', 'nebuli', 'wheeze'],
        'Nebs':               ['asthma', 'salbutamol', 'nebuli', 'wheeze'],
        // WAVE 5 / ITEM 2: keys that were missing entirely, so an objective they should satisfy
        // could never be credited and a correctly-treated scenario could read 0%. 'Calcium' is the
        // one that produced the reported bug: giving Calcium Gluconate in Hyperkalaemia (Renal)
        // matched nothing at all, so "Hyperkalaemia treatment" stayed at 0/1.
        'Calcium':            ['calcium', 'hyperkalaemia', 'hyperkalemia', 'membrane'],
        'SalbutamolIV':       ['hyperkalaemia', 'hyperkalemia', 'asthma', 'salbutamol', 'nebuli'],
        'MagSulph':           ['magnesium', 'asthma', 'torsade', 'eclampsia', 'pre-eclampsia'],
        'Amiodarone':         ['amiodarone', 'tachycardia algorithm', 'antiarrhythmic', 'refractory vf'],
        'Adenosine':          ['adenosine', 'svt', 'narrow complex'],
        'Manoeuvres':         ['vagal', 'svt', 'manoeuvre'],
        'Cardioversion':      ['cardiovers', 'tachycardia algorithm', 'safe cardioversion'],
        'Pacing':             ['pacing', 'bradycardia algorithm', 'heart block'],
        'Thrombolysis':       ['thrombolysis', 'thrombolytic'],
        'Blood':              ['haemorrhage', 'transfus', 'blood protocol', 'major haemorrhage'],
        'Hydrocortisone':     ['steroid', 'adrenal', 'addison', 'anaphyl', 'thyroid'],
        'Dexamethasone':      ['steroid', 'asthma', 'copd', 'meningitis', 'croup'],
        'Furosemide':         ['furosemide', 'diuretic', 'heart failure', 'pulmonary oedema'],
        'GTNInfusion':        ['gtn', 'nitrate', 'heart failure', 'pulmonary oedema'],
        'CPAP':               ['cpap', 'heart failure', 'pulmonary oedema', 'non-invasive'],
        'NIV':                ['niv', 'non-invasive', 'copd', 'oxygen targets'],
        'Cooling':            ['cooling', 'hyperthermia', 'heat'],
        'Warming':            ['warming', 'hypothermia', 'myxoedema'],
        'HypertonicSaline':   ['hyponatr', 'sodium correction', 'cerebral oedema'],
        'Bisphosphonate':     ['hypercalcaem', 'hypercalcem', 'bisphosphonate'],
        'Terlipressin':       ['variceal', 'terlipressin'],
        'Labetalol':          ['bp control', 'bp target', 'hypertensive', 'dissection'],
        'Surgery':            ['surgical', 'surgery', 'theatre', 'definitive care'],
        'FingerThoracostomy': ['thoracostomy', 'pneumothorax', 'tension'],
        'Cyproheptadine':     ['serotonin', 'cyproheptadine'],
        'T3T4':               ['myxoedema', 'thyroid', 'liothyronine'],
        'Nimodipine':         ['sah', 'subarachnoid', 'nimodipine', 'vasospasm'],
        'Chlorphenamine':     ['antihistamine', 'anaphyl'],
        'Heparin':            ['lmwh', 'anticoagul', 'heparin', 'thrombo'],
    };

    // =============================================================================================
    // WAVE 5 / ITEM 2 — MULTI-COMPONENT OBJECTIVE PROGRESS
    // ---------------------------------------------------------------------------------------------
    // Objectives are authored as free text ("Hyperkalaemia treatment") and credited by keyword
    // matching an intervention key against that text. That is fine for a single-drug objective and
    // badly misleading for a multi-component one: hyperkalaemia needs BOTH calcium (membrane
    // stabilisation) AND insulin/dextrose (potassium shift), so giving one of the two produced a
    // flat "0% — Objectives Met: 0/1" that reads like a bug rather than like partial credit.
    //
    // `computeObjectiveProgress` derives the COMPONENTS of each objective from data that already
    // exists — the scenario's own recommendedActions/stabilisers/instructorBrief interventions,
    // intersected with OBJECTIVE_TRIGGERS — and reports which were done and which were not.
    // It is deliberately honest rather than generous:
    //   * an objective with >= 2 known components is 'met' ONLY when every component was given;
    //   * one of two components is 'partial' with a fraction of 0.5 and the missing item named;
    //   * an objective with no derivable components falls back to the engine's completedObjectives
    //     set exactly as before, so nothing regresses.
    // The score is reported twice and labelled: a strict fully-met percentage, and a
    // component-weighted partial-credit percentage. Neither is inflated; both are explained.
    // =============================================================================================
    const objectiveComponentKeys = (scenario, objective) => {
        const objLower = String(objective == null ? '' : objective).toLowerCase();
        if (!objLower) return [];
        const pool = [];
        const push = (arr) => { if (Array.isArray(arr)) arr.forEach(k => { if (typeof k === 'string' && pool.indexOf(k) === -1) pool.push(k); }); };
        push(scenario && scenario.recommendedActions);
        push(scenario && scenario.stabilisers);
        push(scenario && scenario.instructorBrief && scenario.instructorBrief.interventions);
        return pool.filter(key => {
            const triggers = OBJECTIVE_TRIGGERS[key];
            return !!triggers && triggers.some(kw => objLower.indexOf(kw) !== -1);
        });
    };

    // WAVE 5 / ITEM 6: the whole precedence decision in one pure, exported predicate, so "does a
    // rhythm change overwrite a manually typed HR?" is answerable by a test rather than by reading
    // the dispatch wrapper. TRUE = apply the rhythm's registry rate band; FALSE = the facilitator's
    // own HR stands. `releaseManual` is the list of keys the transition itself has just reset
    // (arrest / ROSC / pulseless <-> organised), which legitimately clears the hold.
    const applyRhythmHrBand = (cur, releaseManual) => {
        const held = !!(cur && cur.manualHold && cur.manualHold.hr);
        const released = Array.isArray(releaseManual) && releaseManual.indexOf('hr') !== -1;
        return !held || released;
    };

    const computeObjectiveProgress = (scenario, opts) => {
        const o = opts || {};
        const scen = scenario || {};
        const a = Array.isArray(scen.learningObjectives) ? scen.learningObjectives : [];
        const b = Array.isArray(scen.instructorBrief && scen.instructorBrief.learningObjectives) ? scen.instructorBrief.learningObjectives : [];
        const seen = new Set();
        const objectives = [...a, ...b].filter(x => typeof x === 'string' && x.length && !seen.has(x) && seen.add(x) !== false);
        const counts = o.interventionCounts || {};
        const activeSet = o.activeInterventions instanceof Set ? o.activeInterventions : new Set(Array.isArray(o.activeInterventions) ? o.activeInterventions : []);
        const completed = o.completedObjectives instanceof Set ? o.completedObjectives : new Set(Array.isArray(o.completedObjectives) ? o.completedObjectives : []);
        const given = (key) => (Number(counts[key]) || 0) > 0 || activeSet.has(key);
        const labelOf = (key) => {
            const defs = window.INTERVENTIONS || {};
            return (defs[key] && defs[key].label) || key;
        };

        const rows = objectives.map(objective => {
            const keys = objectiveComponentKeys(scen, objective);
            const components = keys.map(key => ({ key, label: labelOf(key), met: given(key) }));
            const metCount = components.filter(c => c.met).length;
            const touched = completed.has(objective);
            let status, fraction;
            if (components.length === 0) {
                // No derivable components: fall back to the legacy keyword credit, unchanged.
                status = touched ? 'met' : 'none';
                fraction = touched ? 1 : 0;
            } else if (metCount === components.length) {
                status = 'met';
                fraction = 1;
            } else if (metCount > 0 || touched) {
                status = 'partial';
                // `touched` with no component evidence still counts as started, never as complete.
                fraction = metCount > 0 ? metCount / components.length : 0;
            } else {
                status = 'none';
                fraction = 0;
            }
            return {
                objective,
                components,
                metComponents: components.filter(c => c.met).map(c => c.label),
                missingComponents: components.filter(c => !c.met).map(c => c.label),
                multiComponent: components.length > 1,
                touched,
                status,
                fraction
            };
        });

        const total = rows.length;
        const fullyMet = rows.filter(r => r.status === 'met').length;
        const partial = rows.filter(r => r.status === 'partial').length;
        const creditSum = rows.reduce((sum, r) => sum + r.fraction, 0);
        return {
            objectives: rows,
            total,
            fullyMet,
            partial,
            notStarted: rows.filter(r => r.status === 'none').length,
            // Strict: only fully-completed objectives count. This is the headline number and it never
            // goes up because of partial work.
            score: total > 0 ? Math.round((fullyMet / total) * 100) : null,
            // Component-weighted partial credit, always shown alongside and always labelled.
            partialScore: total > 0 ? Math.round((creditSum / total) * 100) : null,
            hasPartial: partial > 0
        };
    };

    window.OBJECTIVE_TRIGGERS = OBJECTIVE_TRIGGERS;
    window.computeObjectiveProgress = computeObjectiveProgress;
    window.__pkInternals = window.__pkInternals || {};
    window.__pkInternals.objectiveComponentKeys = objectiveComponentKeys;
    window.__pkInternals.applyRhythmHrBand = applyRhythmHrBand;

    // ================= WAVE 6: ONE definition of "advance a ramp by one second" ===================
    // Mutates `base` (base space) and `trends` (elapsed / active) in place and returns { owned, ran }:
    // `owned` is the set of keys the ramp owns this second, so autonomous deterioration and
    // rate-driven drives do not fight it. Used by BOTH the full physiology tick (TICK_TIME) and the
    // clock-independent trend tick (TICK_TRENDS), so there is exactly ONE interpolation and a ramp
    // cannot behave differently before and after START.
    const advanceTrendsOneSecond = (base, trends) => {
        const owned = {};
        if (!trends || !trends.active) return { owned, ran: false };
        const targets = trends.targets || {};
        const startVitals = trends.startVitals || {};
        const duration = Number(trends.duration);
        trends.elapsed = (Number(trends.elapsed) || 0) + 1;
        // A 0 s / invalid duration means "now": progress 1 on the first tick, never NaN.
        const progress = (Number.isFinite(duration) && duration > 0) ? Math.min(1, trends.elapsed / duration) : 1;
        Object.keys(targets).forEach(key => {
            const startVal = startVitals[key];
            const targetVal = targets[key];
            // D5: categorical vitals snap on the FIRST tick and are never interpolated, even when
            // both ends happen to be numbers (there is no such thing as 3.4 mm of pupil on a
            // clinical chart, and a half-way value between 3 and 'Dilated' is NaN).
            if (isCategoricalVital(key)) {
                if (targetVal !== undefined) { base[key] = normalisePupils(targetVal); owned[key] = true; }
            } else if (startVal !== undefined && targetVal !== undefined && typeof startVal === 'number' && typeof targetVal === 'number') {
                base[key] = startVal + ((targetVal - startVal) * progress);
                owned[key] = true;
            } else if (startVal !== undefined && targetVal !== undefined) {
                base[key] = targetVal;   // other non-numeric: snap, never interpolate
                owned[key] = true;
            }
        });
        if (!Number.isFinite(duration) || trends.elapsed >= duration) {
            Object.keys(targets).forEach(key => {
                base[key] = isCategoricalVital(key) ? normalisePupils(targets[key]) : targets[key];
                owned[key] = true;
            });
            trends.active = false;
        }
        return { owned, ran: true };
    };
    window.__pkInternals.advanceTrendsOneSecond = advanceTrendsOneSecond;

    // WAVE 6: what should the 1 Hz interval dispatch this second? Pulled out of the effect so the
    // whole gating decision is one pure, exported function that a test can interrogate.
    //   * the student monitor NEVER runs physiology (it would fight the authoritative vitals
    //     arriving over Firebase);
    //   * a running session runs the full pipeline;
    //   * a session that has not been started (or has been paused) still advances an ACTIVE RAMP,
    //     because a ramp is an explicit facilitator instruction, not a property of scenario time.
    //     This is what makes the vitals-modal ramp and Trend Better/Worse work in Quick Sim, where
    //     the controller is reached without ever passing through the briefing screen's START.
    const tickActionFor = (state, isMonitorMode) => {
        if (isMonitorMode) return null;
        if (!state) return null;
        if (state.isRunning) return 'TICK_TIME';
        if (state.trends && state.trends.active) return 'TICK_TRENDS';
        return null;
    };
    window.__pkInternals.tickActionFor = tickActionFor;

    const vitalsReducer = (state, action) => {
        const cs = action.currentState;
        switch (action.type) {
            case 'CLEAR_SESSION': return { ...initialVitalsState };
            case 'LOAD_SCENARIO': 
                if(!action.payload) return { ...initialVitalsState };
                const initialVitals = { ...initialVitalsState.vitals, ...action.payload.vitals };
                // E8: give the scenario a clinically coherent starting K+ if it never declared one,
                // so hyperkalaemia scenarios actually start hyperkalaemic and the treatment has a
                // measurable endpoint. An explicit scenario/vitalsMod value always wins.
                if (action.payload.vitals === undefined || action.payload.vitals === null || action.payload.vitals.k === undefined) {
                    const inferredK = inferPotassium(action.payload);
                    if (inferredK !== null) initialVitals.k = inferredK;
                }
                return { ...initialVitalsState, vitals: initialVitals, baseVitals: { ...initialVitals }, prevVitals: { ...initialVitals } };
            case 'RESTORE_SESSION': {
                const restoredVitals = { ...initialVitalsState.vitals, ...(action.payload.vitals || {}) };
                return { ...state, vitals: restoredVitals, baseVitals: { ...restoredVitals, ...(action.payload.baseVitals || {}) }, prevVitals: { ...restoredVitals, ...(action.payload.prevVitals || {}) }, trends: action.payload.trends || state.trends, hypoxiaTimer: action.payload.hypoxiaTimer || 0, manualHold: action.payload.manualHold || {} };
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
                // WAVE 5 / ITEM 6: arrest, ROSC and pulseless<->organised transitions define a NEW
                // baseline, so they explicitly release the manual hold on the vitals they rewrite.
                let hold = state.manualHold || {};
                if (Array.isArray(action.releaseManual) && action.releaseManual.length) {
                    hold = { ...hold };
                    action.releaseManual.forEach(k => { delete hold[k]; });
                }
                return { ...state, baseVitals: base, vitals: composeVitals(base, cs ? cs.activeDrugs : [], t, inArrest), manualHold: hold };
            }
            case 'MANUAL_VITAL_UPDATE': {
                // Boundary guard: a NaN here propagates into the Firebase payload, which RTDB rejects,
                // and the rejected diff is then retried forever — freezing the student monitor.
                const { key, value } = action.payload;
                if (!isVitalValueSafe(key, value)) return state;
                // D5: a manual pupil write is normalised at the boundary, so nothing downstream ever
                // sees a raw '' / NaN / '4' ambiguity.
                if (isCategoricalVital(key)) {
                    const pv = normalisePupils(value);
                    const pbase = { ...state.baseVitals, [key]: pv };
                    return { ...state, baseVitals: pbase, vitals: { ...state.vitals, [key]: pv }, prevVitals: { ...state.vitals }, manualHold: { ...(state.manualHold || {}), [key]: true } };
                }
                const t = cs ? cs.time : 0;
                const drugs = cs ? cs.activeDrugs : [];
                const inArrest = cs ? PULSELESS_RHYTHMS.indexOf(cs.rhythm) !== -1 : false;
                // The facilitator types the number they want to SEE. Store it in base space by
                // removing whatever the drugs are currently contributing, so the displayed value is
                // exactly what was asked for and any later wear-off still unwinds correctly.
                let baseValue = value;
                if (typeof value === 'number') {
                    const offs = drugOffsets(drugs, t);
                    const ceils = drugCeilings(drugs, t);
                    const off = (inArrest && ARREST_SUPPRESSED.indexOf(key) !== -1) ? 0 : (offs[key] || 0);
                    baseValue = clampVital(key, baseForDisplayed(key, value, off, ceils[key]));
                }
                const base = { ...state.baseVitals, [key]: baseValue };
                // WAVE 5 / ITEM 6: record that the facilitator typed this one. See `manualHold`.
                return { ...state, baseVitals: base, vitals: composeVitals(base, drugs, t, inArrest), prevVitals: { ...state.vitals }, manualHold: { ...(state.manualHold || {}), [key]: true } };
            }
            case 'START_TREND': {
                const safeTargets = {};
                const t0 = cs ? cs.time : 0;
                const offs = drugOffsets(cs ? cs.activeDrugs : [], t0);
                const ceils = drugCeilings(cs ? cs.activeDrugs : [], t0);
                Object.keys(action.payload.targets || {}).forEach(k => {
                    if (!isVitalValueSafe(k, action.payload.targets[k])) return;
                    const raw = action.payload.targets[k];
                    // Targets are given in DISPLAYED space ("take the BP to 90"); convert to base space
                    // by removing the drug contribution present at the moment the trend starts, so the
                    // trend and the envelope add up to the number the facilitator asked for.
                    safeTargets[k] = (typeof raw === 'number' && offs[k]) ? clampVital(k, baseForDisplayed(k, raw, offs[k], ceils[k])) : raw;
                });
                if (Object.keys(safeTargets).length === 0) return state;
                return { ...state, trends: { active: true, targets: safeTargets, duration: action.payload.duration, elapsed: 0, startVitals: { ...state.baseVitals } } };
            }
            case 'STOP_TREND': return { ...state, trends: { ...state.trends, active: false, elapsed: 0 } };
            case 'TRIGGER_IMPROVE':
            case 'TRIGGER_DETERIORATE': return { ...state, trends: action.payload.trends };
            // ======================= WAVE 6 / QUICK SIM RAMPS ==========================================
            // A ramp ("take the HR to 130 over 120 s") is the facilitator's own instruction and must
            // progress as soon as it is given. Before Wave 6 the ONLY thing that advanced a trend was
            // TICK_TIME, and the 1 Hz interval that dispatches it is gated on isRunning — so a ramp
            // started before START silently did nothing. Quick Sim skips the briefing screen and
            // therefore never calls engine.start(), which is why the bug showed up there first: in
            // Quick Sim the controller normally sits at 00:00 for the whole teaching session.
            //
            // TICK_TRENDS advances ONLY the trend layer. It does not touch the session clock, the
            // drug pk clock, autonomous deterioration, the airway model, the hypoxia timer or the
            // debrief history — all of those are properties of elapsed scenario time and must stay
            // gated on the clock. The precedence order is unchanged: this is step 2 running on its
            // own, with the drug envelope still applied last by composeVitals().
            case 'TICK_TRENDS': {
                if (!state.trends || !state.trends.active) return state;
                const base = { ...state.baseVitals };
                const newTrends = { ...state.trends };
                const step = advanceTrendsOneSecond(base, newTrends);
                if (!step.ran) return state;
                const t = cs ? cs.time : 0;
                const inArrest = cs ? RG.inArrest(cs.rhythm || 'Sinus Rhythm') : false;
                const composed = composeVitals(base, cs ? (cs.activeDrugs || []) : [], t, inArrest);
                return { ...state, baseVitals: base, vitals: composed, prevVitals: state.prevVitals, trends: newTrends };
            }
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
                const inArrest = RG.inArrest(rhythm);   // C1: registry, not a seventh private list
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
                // WAVE 6: the interpolation itself now lives in advanceTrendsOneSecond() so the
                // clock-independent trend tick (TICK_TRENDS) runs the IDENTICAL maths — a ramp must
                // behave the same whether or not the session clock is running.
                const trendStep = advanceTrendsOneSecond(base, newTrends);
                const trendOwned = trendStep.owned;
                if (trendStep.ran) vitalsChanged = true;

                // ----- STEP 3: AUTONOMOUS DETERIORATION (Group C).
                // Gated on deteriorationMode === 'auto'. Integrating into `base` is what guarantees C3:
                // switching modes only starts/stops the integration, so there is no discontinuity in
                // either direction — the current obs ARE the baseline.
                const detMode = cs ? (cs.deteriorationMode || 'manual') : 'manual';
                const det = scen && scen.deterioration ? scen.deterioration : null;
                const detType = det ? normaliseDeteriorationType(det.type) : null;
                const detRate = det ? Number(det.rate) : 0;
                // WAVE 5 / ITEM 9: a RATE-DRIVEN vital (active warming/cooling, fixed-rate insulin)
                // is owned by its drive for exactly as long as the drive runs, in the same way a
                // running trend owns its targets. Without this, autonomous deterioration and the drive
                // both integrate into the same base value in the same tick and the net movement no
                // longer matches either declared rate. No current deterioration type touches `temp`,
                // so this is defensive today and correct by construction tomorrow.
                const driveOwned = drivenVitals(activeDrugs, tNow);
                const ownedBySomething = { ...trendOwned, ...driveOwned };
                if (isRunning && detMode === 'auto' && det && det.active !== false && detType && Number.isFinite(detRate) && detRate > 0 && !inArrest) {
                    const factor = deteriorationTreatmentFactor(detType, cs);
                    if (factor !== 0 && applyDeteriorationTick(base, detType, detRate, factor, ownedBySomething)) vitalsChanged = true;
                }

                // ----- STEP 3b: RATE-DRIVEN VITALS (Wave 4a, PART 2D).
                // Active warming/cooling and a fixed-rate insulin infusion move a vital at a RATE
                // towards a TARGET. They integrate into the BASE (like deterioration) rather than
                // sitting in the additive envelope, which is what lets a 30.0 degC patient actually
                // reach 36.8 and a pyrexial one actually come down. drugOffsets() excludes these
                // vitals from the envelope for exactly as long as the drive is running, so no
                // effect is ever applied twice.
                if (isRunning && applyDriveTick(base, activeDrugs, tNow)) vitalsChanged = true;

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
                    // E4 / WAVE 4a: SAFE APNOEA TIME, age- and physiology-appropriate.
                    // Was: 40 s with pre-oxygenation, 10 s without, for every patient of every age.
                    // Three minutes of good pre-oxygenation buys a healthy adult 6-10 minutes; an
                    // infant gets 90-120 s; a septic/pregnant/obese patient far less. Teaching that
                    // pre-oxygenation buys 30 extra seconds is dangerous in RSI and in paediatrics.
                    const preoxygenated = activeInt.has('Preoxygenation') || activeInt.has('Bagging') || activeInt.has('NIV') || activeInt.has('CPAP');
                    const apnoeicO2 = activeInt.has('ApnoeicOxygenation');
                    const preoxDur = (cs && cs.activeDurations && cs.activeDurations['Preoxygenation'])
                        ? Math.max(0, tNow - cs.activeDurations['Preoxygenation'].startTime) : (preoxygenated ? 180 : 0);
                    const graceSeconds = safeApnoeaSeconds(scen, {
                        preoxygenated, apnoeicO2, preoxSeconds: preoxDur,
                        startingSpO2: seenSpO2, highConsumption: hasHighO2Consumption(scen)
                    });
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
            case 'CLEAR_SESSION': return { ...initialCoreState, runId: null, activeInterventions: new Set(), interventionCounts: {}, isOffline: state.isOffline, syncStatus: state.syncStatus };
            case 'LOAD_SCENARIO': 
                if(!action.payload) return { ...initialCoreState, runId: null, activeInterventions: new Set(), interventionCounts: {}, isOffline: state.isOffline, syncStatus: state.syncStatus };
                const initialRhythm = (action.payload.ecg && action.payload.ecg.type) ? action.payload.ecg.type : "Sinus Rhythm";
                let startICP = 10;
                if(action.payload.category === 'Trauma' && (action.payload.title || '').includes('Head')) startICP = 25;
                // C5: default to AUTO for any scenario that declares deterioration, MANUAL otherwise.
                // The mode is logged at scenario start and on every change so a facilitator who never
                // touches the toggle is never surprised by moving numbers.
                const det0 = action.payload.deterioration || null;
                const detMode0 = (det0 && det0.active && normaliseDeteriorationType(det0.type) && Number(det0.rate) > 0) ? 'auto' : 'manual';
                // WAVE 4b / A2 + A6: QUICK SIM. The synthetic blank patient carries no `deterioration`
                // block, so detMode0 resolves to 'manual' with no special case — requirement A6 — while
                // the AUTO/MANUAL toggle stays available because it is state-driven, not scenario-driven.
                //
                // The one thing Quick Sim DOES need seeding is monitoring. 'Obs' (Monitoring) is the
                // gate on the ECG trace, the pulse-ox beep scheduler and the alarm limits, and Quick
                // Sim has no intervention library to attach it from. Seeding the REAL intervention key
                // means the monitor, the beeps and the alarms all work through their existing,
                // unmodified code paths instead of needing a quickSim branch in each of them.
                const quick0 = !!action.payload.quickSim;
                return { ...initialCoreState, runId: newRunId(), rhythm: initialRhythm, icp: startICP, isOffline: state.isOffline, syncStatus: state.syncStatus,
                    showWetflag: action.payload.showWetflag !== false, deteriorationMode: detMode0,
                    // Always a FRESH Set: initialCoreState holds one shared instance, so spreading it
                    // would hand every session the same object.
                    activeInterventions: new Set(quick0 ? ['Obs'] : []),
                    interventionCounts: quick0 ? { Obs: 1 } : {} };
            case 'RESTORE_SESSION': {
                // Whitelist, never spread. coreState is merged LAST in useSimulation, so any `vitals`,
                // `log` or `scenario` key carried in from the snapshot would shadow the live values
                // owned by the other three reducers for the rest of the session.
                const p = action.payload || {};
                return { ...state,
                    // D1: resuming reopens the SAME run, and therefore the same instructor notes.
                    // Pre-Wave-4b snapshots carry no runId, so mint one rather than leaving it null.
                    runId: p.runId || state.runId || newRunId(),
                    time: p.time || 0, cycleTimer: p.cycleTimer || 0, rhythm: p.rhythm || state.rhythm,
                    interventionCounts: p.interventionCounts || {}, activeDurations: p.activeDurations || {},
                    nibp: p.nibp || state.nibp, etco2Enabled: !!p.etco2Enabled,
                    isParalysed: !!p.isParalysed, paralysis: p.paralysis || { active: !!p.isParalysed, agent: null, startTime: 0, onset: 0, duration: 0 },
                    showWetflag: p.showWetflag !== false,
                    icp: p.icp === undefined || p.icp === null ? 10 : p.icp,
                    activeDrugs: Array.isArray(p.activeDrugs) ? p.activeDrugs : [],
                    deteriorationMode: p.deteriorationMode === 'auto' ? 'auto' : 'manual',
                    // B5: shock count / cumulative energy survive a resume now that they live in
                    // state rather than in a useRef that reset to zero.
                    defib: { ...initialCoreState.defib, ...(p.defib || {}) },
                    lastConversion: p.lastConversion || null,
                    activeInterventions: new Set(p.activeInterventions || []),
                    completedObjectives: new Set(p.completedObjectives || []),
                    // WAVE 8 / FINDING 2. A resumed session is NOT a paused session. Its clock is
                    // non-zero and it is not running, which Wave 6 read as "deliberately paused" and
                    // therefore froze the controller's waveform strip until START was pressed. The
                    // pause marker is deliberately NOT restored from the snapshot: a page reload can
                    // only ever produce "restored, not yet started".
                    pausedAt: null,
                    isRunning: false };
            }
            case 'START_SIM': return { ...state, isRunning: true, isFinished: false, pausedAt: null };
            // A deliberate facilitator pause — and the ONLY thing that sets the pause marker. The
            // marker is the sim-clock second it happened at, so it is a primitive and survives sync.
            case 'PAUSE_SIM': return { ...state, isRunning: false, pausedAt: Number.isFinite(state.time) ? state.time : 0 };
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
            case 'UPDATE_RHYTHM': {
                // B1/B2: UPDATE_RHYTHM used to log NOTHING; logging was scattered across five
                // call sites with five different formats and three of them logged nothing at all.
                // Every transition now arrives here carrying `cause`/`detail` (see changeRhythm()),
                // and the reducer records the assessor-local announcement state.
                const to = RG.canonical(action.payload);
                const from = state.rhythm;
                const ev = {
                    id: (action.eventId || Date.now()),
                    from, to,
                    cause: action.cause || 'unspecified',
                    detail: action.detail || null,
                    converted: from !== to,
                    at: Date.now()
                };
                return { ...state, rhythm: to, rhythmEvent: ev, lastConversion: ev.converted ? ev : state.lastConversion };
            }
            case 'CLEAR_RHYTHM_EVENT': return { ...state, rhythmEvent: null };
            // B5 / A: defibrillator device state + metrics. Merge semantics so a charge does not
            // clobber the running shock tally.
            case 'SET_DEFIB_STATE': return { ...state, defib: { ...state.defib, ...(action.payload || {}) } };
            case 'SET_DEFIB_PANEL': return { ...state, defibPanelOpen: !!action.payload };
            case 'SET_REMOTE_PRESENCE': return { ...state, remotePresence: { clients: action.payload || [], updatedAt: Date.now() } };
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
                potassium: Number.isFinite(action.payload.potassium) ? action.payload.potassium : state.potassium,
                activeDrugs: Array.isArray(action.payload.activeDrugs) ? action.payload.activeDrugs : [],
                deteriorationMode: action.payload.deteriorationMode === 'auto' ? 'auto' : 'manual',
                rhythm: action.payload.rhythm, cprInProgress: action.payload.cprInProgress, etco2Enabled: action.payload.etco2Enabled, etco2Pathology: action.payload.co2Pathology || 'normal', co2Severity: Number.isFinite(action.payload.co2Severity) ? action.payload.co2Severity : 0, flash: action.payload.flash, cycleTimer: action.payload.cycleTimer, activeInterventions: new Set(action.payload.activeInterventions || []), nibp: action.payload.nibp || state.nibp, speech: action.payload.speech || state.speech, soundEffect: action.payload.soundEffect || state.soundEffect, audioOutput: action.payload.audioOutput || 'monitor', arrestPanelOpen: action.payload.arrestPanelOpen !== undefined ? action.payload.arrestPanelOpen : state.arrestPanelOpen, defibPanelOpen: !!action.payload.defibPanelOpen, defib: { ...state.defib, ...(action.payload.defib || {}) }, isFinished: action.payload.isFinished || false, monitorPopup: action.payload.monitorPopup || state.monitorPopup, waveformGain: action.payload.waveformGain || 1.0, noise: action.payload.noise || { interference: false }, notification: action.payload.notification || null, remotePacerState: action.payload.remotePacerState || {rate: 0, output: 0}, pacingThreshold: action.payload.pacingThreshold || 70, lastUpdate: Date.now(), showWetflag: action.payload.showWetflag !== undefined ? action.payload.showWetflag : true, monitorTimer: action.payload.monitorTimer || state.monitorTimer, pocReadings: action.payload.pocReadings || state.pocReadings || {} };
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
            // WAVE 4a / E13: TITRATABLE INFUSIONS. A running infusion was locked to the magnitude it
            // was started at, so noradrenaline, GTN, adrenaline, labetalol and insulin could only be
            // ON or OFF - titration to effect, the whole teaching point of a vasoactive infusion, was
            // impossible. `dose` is already the multiplier the envelope is scaled by, so the rate
            // change is a single field edit and the next tick composes it (no new entry, no reset of
            // the pk clock, nothing double-counted). Bounded 0.25x - 3x; permissive, never blocking.
            case 'SET_DRUG_DOSE': {
                const { key, dose } = action.payload || {};
                if (!key || !Number.isFinite(Number(dose))) return state;
                const next = Math.max(0.25, Math.min(3, Number(dose)));
                let changed = false;
                const drugs = (state.activeDrugs || []).map(d => {
                    if (d.key !== key || !d.sustained || d.stopTime >= 0) return d;
                    changed = true;
                    return { ...d, dose: next };
                });
                return changed ? { ...state, activeDrugs: drugs } : state;
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
            // WAVE 8 / FINDING 3 — DETACHING ONE SENSOR.
            // 'Obs' is a SHORTHAND for the four standard sensors, which is why a second press on an
            // "attached" chip previously appeared to do nothing: the chip read as on (via 'Obs') but
            // its own key was not in the set, so the press ATTACHED the individual key and changed
            // nothing visible. Detaching therefore has to expand the shorthand first: 'Obs' is
            // replaced by the individual keys for the sensors that STAY, and only the requested one
            // comes off. The chips and the PROCEDURES cards both read getSensors(), so they cannot
            // get out of sync, and exactly one channel goes dark on the student monitor.
            case 'DETACH_SENSOR': {
                const dkey = action.payload;
                const next = new Set(state.activeInterventions);
                if (dkey === 'Obs') {
                    // Detaching the fast path itself removes all four standard sensors.
                    next.delete('Obs');
                    STANDARD_SENSOR_KEYS.forEach(k => next.delete(k));
                } else {
                    if (next.has('Obs') && STANDARD_SENSOR_KEYS.indexOf(dkey) !== -1) {
                        next.delete('Obs');
                        STANDARD_SENSOR_KEYS.forEach(k => { if (k !== dkey) next.add(k); });
                    }
                    next.delete(dkey);
                }
                const dDurations = { ...state.activeDurations };
                delete dDurations[dkey];
                if (dkey === 'Obs') STANDARD_SENSOR_KEYS.forEach(k => { delete dDurations[k]; });
                const dStopped = (state.activeDrugs || []).map(d => (d.key === dkey && d.sustained && d.stopTime < 0) ? { ...d, stopTime: state.time } : d);
                return { ...state, activeInterventions: next, activeDurations: dDurations, activeDrugs: dStopped };
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
            // WAVE 7 / ITEM 4: a point-of-care check. Records the value AT THIS MOMENT with both a
            // sim-clock offset and a wall-clock stamp, so the monitor can render it as a reading
            // ("GLUCOSE 4.1 @ 09:47") rather than a live channel.
            case 'RECORD_POC': {
                const p = action.payload || {};
                if (!p.key) return state;
                const entry = { at: Number.isFinite(p.at) ? p.at : state.time,
                                clock: p.clock || new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
                                value: Number.isFinite(p.value) ? p.value : null,
                                value2: Number.isFinite(p.value2) ? p.value2 : null };
                return { ...state, pocReadings: { ...(state.pocReadings || {}), [p.key]: entry } };
            }
            case 'TOGGLE_CPR': return { ...state, cprInProgress: action.payload };
            case 'SET_QUEUED_RHYTHM': return { ...state, queuedRhythm: action.payload };
            case 'FAST_FORWARD': return { ...state, time: state.time + action.payload };
            // WAVE 4b / D4: the `processedEvents` / MARK_EVENT_PROCESSED machinery is GONE. It existed
            // to de-duplicate timed scenario events, but no scenario in the library has ever carried
            // an `events` or `timeline` array, nothing ever dispatched MARK_EVENT_PROCESSED, and the
            // Set was being serialised into every localStorage snapshot for nothing. Autonomous
            // progression is handled by the Wave 3/4a deterioration model instead. If timed scripted
            // events are ever wanted, build them on `scenario.deterioration`'s rate model rather than
            // resurrecting this.
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
                const newRhythm = RG.canonical(action.payload);
                // C1: ONE definition. `pulseless` and `isArrest` are the SAME registry predicate —
                // the pre-Wave-3 code had two different lists here that disagreed about VT, so
                // VT-with-a-pulse got arrest physiology while also being excluded from zeroing.
                const isArrest = RG.inArrest(newRhythm);
                const cur = stateRef.current;
                // Rhythm-driven vitals are a facilitator-level write: they target the BASE.
                let rhythmVitals = { ...cur.baseVitals };

                // WAVE 5 / ITEM 6: does the facilitator hold HR? A pulseless/organised transition
                // releases the hold (it defines a new baseline); an organised -> organised rhythm
                // change respects it.
                let releaseManual = [];

                if (RG.isPulseless(newRhythm)) {
                    // A shockable/pulseless rhythm showing a pre-arrest BP and SpO2 is clinically
                    // contradictory; the numeric panel must agree with the trace.
                    if (rhythmVitals.hr > 0 || rhythmVitals.bpSys > 0) {
                        dispatchVitals({ type: 'STOP_TREND', currentState: cur });
                        rhythmVitals = { ...rhythmVitals, hr: 0, bpSys: 0, bpDia: 0, spO2: 0, rr: 0, gcs: 3, pupils: 'Dilated', etco2: 1.5 };
                        releaseManual = ['hr', 'bpSys', 'bpDia', 'spO2', 'rr', 'gcs', 'pupils', 'etco2'];
                    }
                } else if (RG.isPulseless(cur.rhythm)) {
                    // Coming out of a pulseless rhythm into an organised one — an organised rhythm must
                    // never be left displaying HR 0.
                    const age = cur.scenario?.patientAge ?? 40;
                    const base = (window.getBaseVitals ? window.getBaseVitals(age) : { hr: 80, rr: 16, bpSys: 110, bpDia: 70 });
                    dispatchVitals({ type: 'STOP_TREND', currentState: cur });
                    rhythmVitals = { ...rhythmVitals, hr: base.hr, bpSys: base.bpSys, bpDia: base.bpDia, spO2: 94, rr: base.rr, gcs: 8, pupils: 3, etco2: Math.round((5.0 + Math.random() * 1.5) * 10) / 10 };
                    releaseManual = ['hr', 'bpSys', 'bpDia', 'spO2', 'rr', 'gcs', 'pupils', 'etco2'];
                }

                // Registry-supplied rate band for the new rhythm, so every organised rhythm
                // (including the ones previously missing: Atrial Flutter, VT, 1st/2nd degree block,
                // Junctional, STEMI) lands on a clinically sensible heart rate.
                //
                // WAVE 5 / ITEM 6 — FACILITATOR SUPREMACY. The band is applied only when the
                // facilitator has NOT typed an HR of their own (or has just had the hold released by
                // an arrest/ROSC transition above). If they have, their number stands and the rhythm
                // change says so in the log, rather than silently replacing 130 with 140.
                if (!cur.arrestPanelOpen && !cur.defibPanelOpen && !isArrest) {
                    const band = RG.defaultHrRange(newRhythm);
                    const stillHeld = !applyRhythmHrBand(cur, releaseManual);
                    if (band && !stillHeld) {
                        rhythmVitals.hr = getRandomInt(band[0], band[1]);
                    } else if (band && stillHeld) {
                        const shown = Math.round(cur.vitals.hr);
                        dispatchLog({ type: 'ADD_LOG', currentState: cur, payload: {
                            msg: `HR left at your manual value of ${shown} for ${RG.labelFor(newRhythm)} (typical ${band[0]}-${band[1]}/min). Manual values always win — set HR again from the HR tile to change it.`,
                            type: 'info', flagged: false, deviation: null
                        } });
                    }
                }
                dispatchVitals({ type: 'UPDATE_VITALS', payload: rhythmVitals, releaseManual, currentState: stateRef.current });
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
                // A7: REQUEST_SYNC is a handshake. The standalone defib broadcasts it on load and
                // NOTHING handled it, so a defib opened mid-scenario sat on frozen fake normals
                // until the next vitals tick. Answer it immediately, running or not.
                if (data.type === 'REQUEST_SYNC') {
                    postToChannel({ type: 'SYNC_VITALS', payload: buildDefibSyncPayloadRef.current() });
                    return;
                }

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
                    // The sync flag was transmitted and then DISCARDED here before Wave 3.
                    deliverShock(data.payload.energy, 'student (standalone defib)', { sync: !!data.payload.sync });
                } else if (data.type === 'SYNC_TOGGLE') {
                    dispatch({ type: 'SET_DEFIB_STATE', payload: { syncMode: !!data.payload?.sync } });
                    addLogEntry(`SYNC ${data.payload?.sync ? 'ON' : 'OFF'} (student, standalone defib)`, 'action');
                } else if (data.type === 'ENERGY_SELECT') {
                    setDefibEnergy(data.payload?.energy, 'student (standalone defib)');
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
                    dispatch({ type: 'SET_DEFIB_STATE', payload: { mode: data.payload.mode } });
                    if (data.payload.mode === 'defib' || data.payload.mode === 'pacer') {
                        dispatch({ type: 'SET_ARREST_PANEL', payload: true });
                    }
                }
            };
            return () => { if (simChannel.current) simChannel.current.onmessage = null; };
        }, [isMonitorMode]);

        // A7 / C4: the standalone defib page previously received rhythm + 5 numbers and NOTHING
        // else — no weight, no age, no recommended energy, no session-ended flag — which is why it
        // hardcoded 120 J for a 3.5 kg neonate and kept showing a live-looking trace after the end
        // of the session. One builder, used by both the periodic broadcast and REQUEST_SYNC.
        const buildDefibSyncPayload = () => {
            const cur = stateRef.current;
            const weight = Number(cur.scenario?.wetflag?.weight);
            const age = cur.scenario?.patientAge;
            return {
                linked: true,
                sessionID: sessionID || null,
                rhythm: cur.rhythm, hr: cur.vitals.hr, spO2: cur.vitals.spO2,
                etco2: cur.vitals.etco2, bpSys: cur.vitals.bpSys, bpDia: cur.vitals.bpDia,
                gain: cur.waveformGain, interference: cur.noise.interference,
                cpr: cur.cprInProgress, captureThreshold: cur.pacingThreshold,
                audioOutput: cur.audioOutput,
                isRunning: !!cur.isRunning, isFinished: !!cur.isFinished,
                patientName: cur.scenario?.patientName || null,
                ageRange: cur.scenario?.ageRange || null,
                patientAge: Number.isFinite(Number(age)) ? Number(age) : null,
                weight: Number.isFinite(weight) && weight > 0 ? weight : null,
                wetflag: cur.scenario?.wetflag || null,
                recommendedEnergy: RG.recommendedEnergy(Number.isFinite(weight) && weight > 0 ? weight : null, age),
                energyLevels: RG.energySteps(Number.isFinite(weight) && weight > 0 ? weight : null, age),
                defib: cur.defib || {}
            };
        };
        const buildDefibSyncPayloadRef = useRef(buildDefibSyncPayload);
        buildDefibSyncPayloadRef.current = buildDefibSyncPayload;

        useEffect(() => {
            if (!isMonitorMode) {
                postToChannel({ type: 'SYNC_VITALS', payload: buildDefibSyncPayload() });
            }
        }, [state.vitals, state.rhythm, state.waveformGain, state.noise, state.pacingThreshold, state.audioOutput,
            state.cprInProgress, state.isRunning, state.isFinished, state.scenario, state.defib]);

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
                // WAVE 8 / FINDING 1. The obstruction severity behind the shark fin is computed HERE,
                // from the authoritative controller state, and published as a plain number so the
                // student monitor draws exactly the same capnogram shape the facilitator sees. Never
                // undefined, never NaN: sanitizeForRealtimeDatabase passes a finite number through.
                const obstruction = getObstruction(cur, cur.vitals, cur.scenario);
                const co2Severity = Number.isFinite(obstruction.severity) ? obstruction.severity : 0;
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
                    // A3: the assessor's Defib open/close toggle, and the defib device state the
                    // student's monitor-hosted defibrillator renders (mode, selected energy, charge
                    // state, SYNC, running shock tally).
                    //
                    // B4 LEAK BARRIER — DO NOT ADD `rhythmEvent`, `lastConversion` OR ANY
                    // CONVERSION ANNOUNCEMENT TO THIS PAYLOAD. `notification` below is rendered on
                    // the STUDENT monitor; conversion announcements are assessor-only by design and
                    // verify_wave3.js asserts their absence from this object.
                    defibPanelOpen: !!cur.defibPanelOpen,
                    defib: cur.defib || {},
                    monitorPopup: cur.monitorPopup, waveformGain: cur.waveformGain,
                    noise: cur.noise, notification: cur.notification,
                    remotePacerState: cur.remotePacerState, pacingThreshold: cur.pacingThreshold,
                    showWetflag: cur.showWetflag, co2Pathology, co2Severity,
                    // Top-level keys only — the write diff is shallow and per-key. Never undefined.
                    isRunning: !!cur.isRunning, isMuted: !!cur.isMuted,
                    activeLoops: cur.activeLoops || {}, isParalysed: !!cur.isParalysed,
                    // Wave 2. BM / Temp / pH ride inside `vitals` (verified by the sync payload test);
                    // activeDrugs and deteriorationMode are top-level, primitives only, never undefined,
                    // so sanitizeForRealtimeDatabase passes them through untouched.
                    activeDrugs: Array.isArray(cur.activeDrugs) ? cur.activeDrugs : [],
                    deteriorationMode: cur.deteriorationMode || 'manual',
                    // WAVE 4a / E8. K+ rides inside `vitals` like temp/bm/ph AND is published as its
                    // own TOP-LEVEL key, because the write diff is shallow and per-key: a lab value
                    // the student monitor renders must never be undefined or NaN on the wire.
                    potassium: (cur.vitals && Number.isFinite(cur.vitals.k)) ? cur.vitals.k : DEFAULT_VITALS.k,
                    // WAVE 7 / ITEM 4. Which sensors are attached already rides on the wire inside
                    // `activeInterventions` (the monitor derives them with getSensors), so nothing new
                    // is needed for those. Point-of-care readings DO need their own top-level key:
                    // primitives only, never undefined, so sanitizeForRealtimeDatabase passes it
                    // through untouched. Assessor-only conversion announcements are still absent.
                    pocReadings: cur.pocReadings || {}
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
            state.activeDrugs, state.deteriorationMode,
            state.defibPanelOpen, state.defib
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

        // =====================================================================================
        // A5: PRESENCE / CONNECTION INDICATOR.
        // Modelled on the existing syncStatus state machine: the monitor writes a presence child
        // under sessions/<CODE>/presence/<clientId> with an onDisconnect() removal and a 10s
        // heartbeat; the controller reduces the children into state.remotePresence and shows a
        // badge next to the existing sync badge saying WHAT each remote device is displaying.
        // =====================================================================================
        const presenceIdRef = useRef(null);
        if (!presenceIdRef.current) presenceIdRef.current = Math.random().toString(36).slice(2, 10);

        // --- monitor side: announce ourselves and what we are showing.
        const presenceDisplay = isMonitorMode
            ? (state.defibPanelOpen ? 'defib' : (state.arrestPanelOpen ? 'arrest view' : 'patient monitor'))
            : null;
        useEffect(() => {
            const db = window.db;
            if (!db || !sessionID || !isMonitorMode) return;
            const ref = db.ref(`sessions/${sessionID}/presence/${presenceIdRef.current}`);
            const write = () => {
                ref.update({
                    role: 'monitor',
                    display: presenceDisplay,
                    ua: (navigator.userAgent || '').slice(0, 120),
                    ts: Date.now()
                }).catch(e => console.warn('Presence write failed', e));
            };
            // onDisconnect() is what makes a closed tab / dead tablet disappear promptly; the
            // heartbeat is what makes a WIFI dropout (where onDisconnect never fires) detectable.
            ref.onDisconnect().remove().catch(() => {});
            write();
            const hb = setInterval(write, 10000);
            return () => { clearInterval(hb); ref.remove().catch(() => {}); };
        }, [isMonitorMode, sessionID, presenceDisplay]);

        // --- controller side: reduce the presence children, expiring stale heartbeats.
        useEffect(() => {
            const db = window.db;
            if (!db || !sessionID || isMonitorMode) return;
            const ref = db.ref(`sessions/${sessionID}/presence`);
            const STALE_MS = 30000;
            let latest = {};
            const push = () => {
                const now = Date.now();
                const clients = Object.keys(latest)
                    .map(k => ({ id: k, ...(latest[k] || {}) }))
                    .filter(c => Number.isFinite(Number(c.ts)) && (now - Number(c.ts)) < STALE_MS);
                dispatch({ type: 'SET_REMOTE_PRESENCE', payload: clients });
            };
            const onVal = (snap) => { latest = snap.val() || {}; push(); };
            const onErr = (e) => {
                console.error('Presence read failed:', e);
                dispatch({ type: 'SET_REMOTE_PRESENCE', payload: [] });
            };
            ref.on('value', onVal, onErr);
            const sweep = setInterval(push, 5000);
            return () => { ref.off('value', onVal); clearInterval(sweep); };
        }, [isMonitorMode, sessionID]);

        // =====================================================================================
        // A6: STUDENT DEVICE EVENTS.
        // sessions/<CODE>/command is a single set() slot already owned by the monitor's NIBP
        // control, so reusing it for defib events would clobber an in-flight NIBP command (and
        // vice versa). Device events therefore get their OWN node with PUSH semantics.
        // Every event converges on the same shared outcome helpers the facilitator uses
        // (initCharge / deliverShock / applyShockOutcome / applyCardioversion).
        // =====================================================================================
        const deviceEventsSinceRef = useRef(Date.now());
        const sendDeviceEvent = (type, payload = {}) => {
            if (!isMonitorMode || !sessionID || !window.db) return false;
            const safe = sanitizeForRealtimeDatabase({ type, payload, ts: Date.now(), from: presenceIdRef.current });
            if (!safe.value || safe.dropped.length) {
                console.error('Invalid device event not sent:', safe.dropped.join(', '));
                return false;
            }
            try {
                window.db.ref(`sessions/${sessionID}/deviceEvents`).push(safe.value).catch(e => {
                    console.error('Device event send failed:', e);
                    dispatch({ type: 'SET_SYNC_STATUS', payload: { state: 'error', message: `Defib event write failed: ${e.message || 'unknown error'}` } });
                });
                return true;
            } catch (e) {
                console.error('Device event send failed:', e);
                return false;
            }
        };

        useEffect(() => {
            const db = window.db;
            if (!db || !sessionID || isMonitorMode) return;
            const ref = db.ref(`sessions/${sessionID}/deviceEvents`);
            // Only ever act on events newer than this listener, so a re-mount cannot replay a
            // whole arrest's worth of shocks.
            const startedAt = deviceEventsSinceRef.current;
            const onChild = (snap) => {
                const ev = snap.val();
                if (!ev || !ev.type) return;
                if (!(Number(ev.ts) >= startedAt)) { snap.ref.remove().catch(() => {}); return; }
                const cur = stateRef.current;
                const src = 'student (monitor defib)';
                const p = ev.payload || {};
                switch (ev.type) {
                    case 'DEVICE_MODE': setDefibMode(p.mode, src); break;
                    case 'ENERGY_SELECT': setDefibEnergy(p.energy, src); break;
                    case 'SYNC_TOGGLE': dispatch({ type: 'SET_DEFIB_STATE', payload: { syncMode: !!p.sync } });
                        addLogEntry(`SYNC ${p.sync ? 'ON' : 'OFF'} (${src})${p.sync && RG.isPulseless(cur.rhythm) ? ' — armed in a pulseless rhythm; the device will not discharge. Flagged.' : ''}`,
                            p.sync && RG.isPulseless(cur.rhythm) ? 'warning' : 'action', !!(p.sync && RG.isPulseless(cur.rhythm)));
                        break;
                    case 'CHARGE_INIT': initCharge(p.energy); break;
                    case 'SHOCK_DELIVERED': deliverShock(p.energy, src, { sync: !!p.sync }); break;
                    case 'ANALYSE': analyseRhythm(src); break;
                    case 'PACER_UPDATE': dispatch({ type: 'UPDATE_PACER_STATE', payload: { rate: p.rate, output: p.output } }); break;
                    case 'CHECK_PULSE': addLogEntry('Student checked pulse (monitor defib)', 'action'); break;
                    case 'CPR_TOGGLE': toggleCPR(!!p.on, src); break;
                    case 'MARKER_EVENT': addLogEntry('Student marked event (monitor defib)', 'manual', true); break;
                    case 'ALARM_SILENCE': addLogEntry('Alarm silenced by student (monitor defib)', 'info'); break;
                    case 'REQUEST_12LEAD': addLogEntry('Student requested 12-lead (monitor)', 'action'); break;
                    default: addLogEntry(`Unhandled student device event: ${ev.type}`, 'system'); break;
                }
                // Consume the event so the queue cannot grow without bound across a long session.
                snap.ref.remove().catch(() => {});
            };
            const onErr = (e) => {
                console.error('Device event listener failed:', e);
                dispatch({ type: 'SET_SYNC_STATUS', payload: { state: 'error', message: `Defib event read failed: ${e.message || 'unknown error'}` } });
            };
            ref.limitToLast(25).on('child_added', onChild, onErr);
            return () => ref.off('child_added', onChild);
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
                        // D1: the per-run id travels with the snapshot so a resumed session reopens
                        // the same instructor notes instead of a blank set.
                        runId: cur.runId || null,
                        rhythm: cur.rhythm, time: cur.time, cycleTimer: cur.cycleTimer,
                        activeInterventions: Array.from(cur.activeInterventions),
                        interventionCounts: cur.interventionCounts, activeDurations: cur.activeDurations,
                        completedObjectives: Array.from(cur.completedObjectives),
                        log: cur.log.slice(-200), // recent log only
                        nibp: cur.nibp, etco2Enabled: cur.etco2Enabled, isParalysed: cur.isParalysed, paralysis: cur.paralysis,
                        showWetflag: cur.showWetflag, icp: cur.icp,
                        // B5: shock count / cumulative energy must survive a resume.
                        defib: cur.defib, lastConversion: cur.lastConversion
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
            // C1: no pulse means no beep. Registry-derived, so it cannot drift from the
            // physiology the way the old private list did.
            const SILENT_RHYTHMS = RG.PULSELESS;
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
            const pulseless = RG.isPulseless(current.rhythm);   // C1: registry
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

            // WAVE 7 / ITEM 4 — POINT-OF-CARE CHECKS. These are INTERMITTENT: they publish the value
            // as it is right now, timestamped, and then stop tracking. Repeating the check takes a
            // fresh sample. (A continuous sensor, by contrast, keeps updating.) Fully permissive: a
            // VBG with no IV access has already raised its amber flag above and still proceeds.
            if (key === 'CheckGlucose' || key === 'CheckVBG') {
                const v = cur.vitals || {};
                const clock = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                if (key === 'CheckGlucose') {
                    dispatch({ type: 'RECORD_POC', payload: { key: 'bm', value: Number.isFinite(v.bm) ? v.bm : null, at: cur.time, clock } });
                    addLogEntry(`Capillary glucose ${Number.isFinite(v.bm) ? v.bm.toFixed(1) : '--'} mmol/L (POC, ${clock}).`, 'action');
                } else {
                    // The VBG reports pH and potassium at the moment the sample was taken.
                    dispatch({ type: 'RECORD_POC', payload: { key: 'vbg', value: Number.isFinite(v.ph) ? v.ph : null, value2: Number.isFinite(v.k) ? v.k : null, at: cur.time, clock } });
                    addLogEntry(`VBG: pH ${Number.isFinite(v.ph) ? v.ph.toFixed(2) : '--'}, K+ ${Number.isFinite(v.k) ? v.k.toFixed(1) : '--'} mmol/L (POC, ${clock}).`, 'action');
                }
                // Execution deliberately CONTINUES into the normal intervention path below, so the
                // check is counted and logged by exactly the same machinery as everything else.
            }

            const isActive = cur.activeInterventions.has(key);
            if (action.type === 'continuous' && isActive) {
                 // Deliberate toggle-off. The button shows an explicit ACTIVE state and a tooltip saying
                 // a second press stops it, so removal cannot be mistaken for a repeat dose.
                 // WAVE 8 / FINDING 3: monitoring keys take the sensor-aware removal, which expands the
                 // 'Obs' shorthand. Without this the PROCEDURES card and the chip could disagree about
                 // what is attached; both now resolve through getSensors() over the same set.
                 if (key === 'Obs' || STANDARD_SENSOR_KEYS.indexOf(key) !== -1) dispatch({ type: 'DETACH_SENSOR', payload: key });
                 else dispatch({ type: 'REMOVE_INTERVENTION', payload: key });
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
            // PART 5 — PAEDIATRIC DOSING NOTES the review flagged as mattering clinically. These are
            // COACHING LINES, never blocks: the facilitator always gets to give the drug.
            if (scenario.ageRange === 'Paediatric' || ageBandOf(scenario) !== 'adult') {
                const wt = scenario.wetflag && scenario.wetflag.weight;
                if (key === 'Atropine') addLogEntry(`Paediatric atropine: 20 mcg/kg${wt ? ` = ${Math.round(20 * wt)} mcg` : ''}, MINIMUM 100 mcg (smaller doses cause paradoxical bradycardia), maximum single dose 500 mcg.`, 'info');
                if (key === 'MidazolamBuccal') addLogEntry(`Buccal midazolam 0.5 mg/kg${wt ? ` ≈ ${Math.round(0.5 * wt * 10) / 10} mg` : ''} — APLS step 1 when there is no IV/IO access. Second dose after 10 min, then escalate to a second-line agent.`, 'info');
                if (key === 'KetamineIM') addLogEntry(`Paediatric IM ketamine for procedural sedation: 4 mg/kg${wt ? ` = ${Math.round(4 * wt)} mg` : ''}. Peak dissociation ~5 min, 15-30 min of usable sedation — do NOT stack doses while waiting.`, 'info');
                if (key === 'Sux') addLogEntry('Suxamethonium in a child: bradycardia is common (and marked with a second dose) — have atropine drawn up.', 'warning');
                if (key === 'Dextrose' && wt) addLogEntry(`WETFLAG glucose: 2 ml/kg of 10% = ${Math.round(2 * wt)} ml.`, 'info');
                if (key === 'Adenosine') addLogEntry('Paediatric adenosine: 0.1 mg/kg, then 0.2 mg/kg. Same near-instant transient kinetics as an adult.', 'info');
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
            //
            // WAVE 4a adds three things to the entry:
            //   * PART 2B volume responsiveness  -> `dose` multiplier for fluid/blood/albumin
            //   * PART 5  paediatric scaling      -> per-field magnitude scale by age band
            //   * PART 2C cumulative-dose ceiling -> an explicit, VISIBLE max-dose warning
            const entryOpts = {};
            let volumeNote = null;
            if (VOLUME_KEYS.indexOf(key) !== -1) {
                const vr = fluidResponsiveness(scenario);
                entryOpts.dose = vr.factor;
                volumeNote = vr;
            }
            const pScale = paediatricFieldScale(scenario);
            if (pScale) entryOpts.fieldScale = pScale;
            // Paediatric note: suxamethonium bradycardia is common in children, and marked with a
            // second dose. The adult entry has no haemodynamic effect at all.
            if (key === 'Sux' && pScale) {
                entryOpts.effect = { ...(action.effect || {}), HR: -20 };
            }
            const drugEntry = buildDrugEntry(key, action, cur.time, entryOpts.dose === undefined ? 1 : entryOpts.dose, entryOpts);
            if (drugEntry) {
                dispatch({ type: 'ADD_ACTIVE_DRUG', payload: drugEntry });
                // PART 2C: the ceiling used to be reached SILENTLY. It is counted from every dose
                // given (interventionCounts), not only from the entries that happen to still be
                // pharmacologically live, and it is announced in the log (flagged, so it reaches the
                // debrief) AND as a toast. Nothing is ever blocked.
                const givenBefore = (cur.interventionCounts || {})[key] || 0;
                const cum = action.cumulative || null;
                const capDoses = cum ? Math.max(1, Math.round(Number(cum.max) / Number(cum.perDose))) : drugEntry.maxDoses;
                const effectiveCap = Math.min(drugEntry.maxDoses, capDoses);
                if (givenBefore + 1 >= effectiveCap) {
                    const totalText = cum ? ` (cumulative ${((givenBefore + 1) * Number(cum.perDose)).toLocaleString()} ${cum.unit} of a ${Number(cum.max).toLocaleString()} ${cum.unit} maximum)` : '';
                    const atOrPast = givenBefore + 1 > effectiveCap;
                    const msg = atOrPast
                        ? `${action.label}: MAXIMUM MODELLED DOSE ALREADY REACHED${totalText} — this dose adds NO further response.${cum ? ' ' + cum.message : ''}`
                        : `${action.label}: maximum modelled dose reached${totalText}.${cum ? ' ' + cum.message : ' Further doses will add no further response.'}`;
                    addLogEntry(msg, 'warning', true, { action: key, label: action.label, missing: ['within maximum cumulative dose'] });
                    dispatch({ type: 'SET_NOTIFICATION', payload: { msg: `${action.label} — MAX DOSE reached (no further effect)`, type: 'warning', id: Date.now() } });
                } else if (!drugEntry.sustained && drugEntry.onset > 15) {
                    addLogEntry(`${action.label}: onset ~${drugEntry.onset}s, peak ~${Math.round(drugEntry.peak / 60 * 10) / 10} min${drugEntry.offset > drugEntry.peak ? `, wears off by ~${Math.round(drugEntry.offset / 60)} min` : ''}.`, 'info');
                }
                if (volumeNote) {
                    // The facilitator is told WHY the bolus did or did not work, because that is the
                    // teaching point the sim was previously unable to make.
                    if (volumeNote.factor >= 1) addLogEntry(`${action.label}: this patient is FLUID RESPONSIVE (${volumeNote.source}) — expect a meaningful rise in blood pressure over the next few minutes.`, 'info');
                    else if (volumeNote.factor <= 0.35) addLogEntry(`${action.label}: this patient is NOT fluid responsive (${volumeNote.source}) — the pressure will barely move. Reassess: does this shock need a pressor, an inotrope, blood or the operating theatre?`, 'warning', true, { action: key, label: action.label, missing: ['fluid responsiveness'] });
                    else addLogEntry(`${action.label}: partial fluid responsiveness (${volumeNote.source}) — reassess after the bolus.`, 'info');
                    if (volumeNote.overload) {
                        // Fluid into a wet patient worsens gas exchange. Time-limited via the envelope.
                        const oedema = buildDrugEntry(key + 'Overload', action, cur.time, 1, {
                            effect: { SpO2: -5, RR: 3 },
                            pk: { onset: 60, peak: 600, offset: 3600, maxDoses: 3 }
                        });
                        if (oedema) dispatch({ type: 'ADD_ACTIVE_DRUG', payload: oedema });
                        addLogEntry(`${action.label} given to a fluid-overloaded patient — oxygenation is WORSENING. Consider stopping fluid, sitting them up, CPAP/NIV, GTN and diuresis.`, 'danger', true, { action: key, label: action.label, missing: ['fluid responsiveness'] });
                    }
                }
                // E9: a declared REBOUND phase is pushed as a second, delayed entry (late
                // hypoglycaemia after insulin/dextrose being the archetype). pkFactor already
                // returns 0 for an entry whose startTime is in the future, so nothing else changes.
                if (action.rebound) {
                    const rb = buildDrugEntry(key + 'Rebound', action, cur.time + (Number(action.rebound.delay) || 0), 1,
                        { effect: action.rebound.effect, pk: action.rebound.pk || action.pk });
                    if (rb) {
                        dispatch({ type: 'ADD_ACTIVE_DRUG', payload: rb });
                        if (action.rebound.log) addLogEntry(action.rebound.log, 'info');
                    }
                }
            }
            if (action.type === 'continuous') { newActive.add(key); addLogEntry(logMsg, 'action'); } else { newCounts[key] = count; addLogEntry(logMsg, 'action'); }
            dispatch({ type: 'UPDATE_INTERVENTION_STATE', payload: { active: newActive, counts: newCounts } });

            dispatch({ type: 'SET_NOTIFICATION', payload: { msg: action.label + " Administered", type: 'success', id: Date.now() } });

            // WAVE 5 / ITEM 2: the trigger table now lives at module scope (see OBJECTIVE_TRIGGERS
            // above) so the debrief can derive the COMPONENTS of a multi-component objective from the
            // same data the engine credits from. Behaviour here is unchanged: any matching key marks
            // the objective as touched; the debrief decides met vs partial.
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
            // ---- E10: THE DEAD KEY. This test used to be `key === 'Adrenaline' && count >= 2`, and
            // there is NO intervention called 'Adrenaline' in INTERVENTIONS — the key is
            // 'AdrenalineIM' (or AdrenalineIV/AdrenalinePush/AdrenalineInfusion). Anaphylaxis
            // scenarios therefore NEVER improved, no matter how correctly they were treated.
            // It also only matched scenarios whose TITLE contained "Anaphylaxis", so an
            // anaphylaxis presenting as "Peanut reaction" was excluded.
            const ANAPHYLAXIS_ADRENALINE = ['AdrenalineIM', 'AdrenalineIV', 'AdrenalinePush', 'AdrenalineInfusion'];
            const looksAnaphylactic = (() => {
                const txt = scenarioText(scenario);
                return txt.indexOf('anaphyla') !== -1 || txt.indexOf('allergic reaction') !== -1 || txt.indexOf('angio-oedema') !== -1 || txt.indexOf('angiooedema') !== -1;
            })();
            if (looksAnaphylactic && ANAPHYLAXIS_ADRENALINE.indexOf(key) !== -1) {
                // RCUK: improvement after the FIRST correct dose of IM adrenaline is the expected
                // clinical course, and the 5-minute repeat is the next step if it does not come.
                dispatch({ type: 'TRIGGER_IMPROVE' });
                addLogEntry(`${action.label} in anaphylaxis — patient condition IMPROVING. Reassess at 5 minutes and repeat IM adrenaline if the improvement is incomplete.`, 'success');
            }
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
                // E3: REVERSAL IS NOT INSTANT. Sugammadex restores a train-of-four ratio > 0.9 in
                // roughly 1.5-3 min (longer for a deep block), and the whole teaching point is that
                // you keep ventilating while you wait. Previously the blockade vanished on the
                // administering tick, which taught the opposite.
                const rev = action.reversalOver || { onset: (action.pk && action.pk.onset) || 60, full: (action.pk && action.pk.peak) || 180 };
                const onsetS = Math.max(0, Number(rev.onset) || 0);
                const fullS = Math.max(onsetS + 1, Number(rev.full) || onsetS + 120);
                addLogEntry(`${action.label}: reversal is NOT instant — first twitches at ~${onsetS}s, full reversal by ~${Math.round(fullS / 60 * 10) / 10} min. KEEP VENTILATING until spontaneous effort is adequate.`, 'warning', true, { action: key, label: action.label, missing: ['continued ventilation during reversal'] });
                const startedAt = Date.now();
                const finishReversal = () => {
                    const now = stateRef.current;
                    if (!now || now.isFinished) return;
                    dispatch({ type: 'REVERSE_PARALYSIS_DRUGS' });
                    dispatch({ type: 'SET_PARALYSIS', payload: { active: false } });
                    if (!isVentilated(now.activeInterventions)) {
                        dispatch({ type: 'UPDATE_VITALS', payload: { ...now.baseVitals, rr: Math.max(now.baseVitals.rr || 0, 10) } });
                    }
                    addLogEntry(`${action.label}: neuromuscular blockade now fully reversed (${Math.round((Date.now() - startedAt) / 1000)}s) — spontaneous ventilation returning.`, 'success');
                };
                // Partial reversal first (weak, inadequate effort), then full reversal.
                setTimeout(() => {
                    const now = stateRef.current;
                    if (!now || now.isFinished) return;
                    addLogEntry(`${action.label}: first twitches returning — respiratory effort is present but INADEQUATE. Continue to support ventilation.`, 'info');
                }, onsetS * 1000);
                setTimeout(finishReversal, fullS * 1000);
            }

            // --- B3: effect.cpr. Wave 3 owns the full CPR/cprInProgress/defib work; this is the safe,
            // non-overlapping part: an intervention that declares itself to be chest compressions sets
            // the flag, and removing it clears the flag (see REMOVE_INTERVENTION above for the drug
            // tail). That immediately activates the already-written arrest ETCO2 physiology, the CPR
            // waveform artefact and the ROSC bonus, all of which were dead code. Wave 3 should extend
            // this (compression quality, pauses, metronome) rather than re-adding the flag.
            if (action.effect.cpr === true && !cur.cprInProgress) {
                // C5 (Wave 3): route through the shared helper so the cycle timer resets, the
                // assessor gets the CPR indicator and the coaching line is consistent wherever
                // compressions are started from.
                toggleCPR(true, action.label || 'intervention');
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

            // =====================================================================================
            // PART 2A — 1 mg IV ADRENALINE IN A PERFUSING PATIENT: "yes, and model the consequence".
            // Never blocked. A prominent FLAGGED DEVIATION is raised, and the realistic consequence
            // (marked hypertension and tachycardia, occasionally arrhythmia) is simulated through
            // the pk envelope so it is time-limited and wears off, exactly like the real thing.
            // =====================================================================================
            if (key === 'AdrenalineIV' && !isArrest) {
                addLogEntry(`⚠ 1 mg IV ADRENALINE GIVEN TO A PATIENT WITH A PULSE (${RG.labelFor(cur.rhythm)}). This is a TEN-FOLD to TWENTY-FOLD overdose for a perfusing patient — the peri-arrest / anaphylaxis doses are 50-100 mcg IV (push-dose) or 500 mcg IM. Expect a hypertensive, tachycardic response; watch for arrhythmia, pulmonary oedema and myocardial ischaemia.`, 'danger', true, { action: key, label: action.label, missing: ['a pulseless rhythm (1 mg IV is an ARREST dose)'] });
                dispatch({ type: 'SET_NOTIFICATION', payload: { msg: '1mg IV adrenaline in a PERFUSING patient — flagged. Modelling the consequence.', type: 'danger', id: Date.now() } });
                // The consequence rides on its own entry so it is additive to the drug's normal
                // effect, independently capped, and fully gone within ~10 min.
                const overdose = buildDrugEntry('AdrenalineIVOverdose', action, cur.time, 1, {
                    effect: { HR: 35, BP: 55 },
                    pk: { onset: 15, peak: 75, plateau: 180, offset: 600, maxDoses: 3 }
                });
                if (overdose) dispatch({ type: 'ADD_ACTIVE_DRUG', payload: overdose });
                dispatch({ type: 'TRIGGER_SPEAK', payload: 'My heart is pounding — my chest feels tight and my head is thumping.' });
            }

            // =====================================================================================
            // E2 — ADENOSINE: a SCRIPTED, TRANSIENT sequence, not a jump to HR 80.
            // Half-life is under 10 s. What the team must see is: flush → a few seconds of AV block
            // or sinus pause (the frightening bit) → either conversion to sinus at ~15 s or the SVT
            // simply carrying on, in which case you escalate 6 → 12 → 12 mg. Everything is resolved
            // inside ~45 s, and nothing lingers (pk offset 40 s).
            // =====================================================================================
            if (action.avBlock && !isArrest) {
                const ab = action.avBlock;
                const doseNo = count;                    // 1st = 6 mg, 2nd/3rd = 12 mg
                const doseMg = doseNo === 1 ? 6 : 12;
                addLogEntry(`Adenosine ${doseMg} mg given as a RAPID push into a large proximal vein with an immediate saline flush. Warn the patient: flushing, chest tightness and a feeling of doom are expected and last seconds.`, 'action');
                dispatch({ type: 'TRIGGER_SPEAK', payload: 'Oh — that feels horrible. My chest is tight. I feel like something awful is happening.' });
                addLogEntry(`Transient AV block / sinus pause for ~${ab.pause || 8}s — run a rhythm strip NOW: this is the diagnostic window.`, 'warning');
                const chances = Array.isArray(ab.chanceByDose) ? ab.chanceByDose : [0.55, 0.75, 0.8];
                const chance = chances[Math.min(doseNo, chances.length) - 1];
                setTimeout(() => {
                    const now = stateRef.current;
                    if (!now || !now.isRunning || now.isFinished) return;
                    if (RG.inArrest(now.rhythm)) return;
                    applyDrugConversion(now, 'Adenosine', `Adenosine ${doseMg} mg`, { chance });
                }, Math.max(1, Number(ab.convertAt) || 12) * 1000);
            }

            // C6: all three changeRhythm modes are handled now. 'sync' and 'chance' were silently
            // ignored before Wave 3, which is why the Cardioversion intervention did nothing and
            // Adrenaline IV / Amiodarone changed no rhythm in any scenario.
            if (action.avBlock) {
                // handled above as a timed sequence — do NOT convert on the administering tick.
            } else if (action.effect.changeRhythm === 'defib') {
                applyShockOutcome(cur, { energy: (cur.defib && cur.defib.energy) || undefined, sync: false, source: 'facilitator' });
            } else if (action.effect.changeRhythm === 'sync') {
                applyCardioversion(cur, { energy: (cur.defib && cur.defib.energy) || undefined, source: 'facilitator' });
            } else if (action.effect.changeRhythm === 'chance') {
                applyDrugConversion(cur, key, action.label || key);
            } else if (typeof action.effect.changeRhythm === 'string' && RG.isKnown(action.effect.changeRhythm)) {
                // A scenario/intervention may name a specific target rhythm outright.
                changeRhythm(action.effect.changeRhythm, 'intervention', { agent: action.label || key });
            }

            // ARREST PHYSIOLOGY. During a pulseless rhythm there is no cardiac output, so drugs cannot
            // drive HR/BP — and, critically, SpO2 must NOT imply perfusion that does not exist (BVM in
            // asystole used to display SpO2 25%). Previously HR/BP/RR were silently discarded while
            // SpO2/GCS were still applied; now the suppression is total and it is LOGGED.
            const isArrest = RG.inArrest(cur.rhythm);   // C1: registry. The old literal also required bpSys<10 AND wrongly included VT-with-a-pulse.
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
            let paceCaptured = false;
            if (!isArrest) {
                if (action.effect.HR) {
                    // 'reset' is retained for backwards compatibility with saved/custom interventions.
                    // Adenosine no longer uses it: an instant jump to HR 80 in one tick was exactly
                    // the behaviour that hid the pause-then-conversion teaching point (see the
                    // adenosine sequence below).
                    if (action.effect.HR === 'reset') newVitals.hr = 80;
                    else if (action.effect.HR === 'pace') {
                        // Pacing only captures if output exceeds threshold
                        const pacer = cur.remotePacerState || { rate: 0, output: 0 };
                        if (pacer.output >= cur.pacingThreshold && pacer.rate > 0) {
                            newVitals.hr = pacer.rate;
                            paceCaptured = true;
                            // E5: electrical capture without mechanical capture is worthless, and a
                            // rate number alone taught trainees not to feel for a pulse.
                            addLogEntry(`Pacing: ELECTRICAL capture at ${pacer.output}mA, rate ${pacer.rate}. Now CONFIRM MECHANICAL CAPTURE — feel a central pulse / check the SpO2 trace. Give analgesia and sedation: pacing hurts.`, 'success');
                        } else {
                            addLogEntry(`Pacing: no capture (output ${pacer.output}mA < threshold ${cur.pacingThreshold}mA) — increase the output until every pacing spike is followed by a QRS AND a pulse.`, 'warning');
                        }
                    }
                    else if (!pkOwned('HR')) newVitals.hr = clampVital('hr', newVitals.hr + action.effect.HR);
                }
                // E5: perfusion only improves if the pacer actually captured.
                if (key === 'Pacing' && !paceCaptured) { /* no haemodynamic benefit without capture */ }
                else if (action.effect.BP && !pkOwned('BP')) {
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
        
        // =====================================================================================
        // B1: THE SINGLE CHOKE POINT FOR EVERY RHYTHM TRANSITION.
        // Before Wave 3 the rhythm could change from FIVE places (manual grid, ARREST menu, ROSC
        // menu, shock outcome, nextCycle) with three of them logging nothing, and UPDATE_RHYTHM
        // itself logging nothing at all. Nothing may dispatch UPDATE_RHYTHM directly any more.
        //
        // `cause` is a short machine-ish token ('defibrillation', 'manual selection', 'arrest',
        // 'ROSC', 'drug', 'cardioversion', 'deterioration', 'rhythm check', 'refibrillation').
        // `meta` carries the clinical detail the assessor needs: energy, synchronised, drug label.
        //
        // B4 LEAK BARRIER: the announcement is written to state.rhythmEvent / state.lastConversion,
        // which are ASSESSOR-LOCAL and deliberately excluded from the Firebase payload. It is NOT
        // written to `notification`, because `notification` is synced and rendered on the student
        // monitor — announcing "VF → Sinus (defibrillation)" there would hand the team the answer.
        // =====================================================================================
        const conversionSeqRef = useRef(0);
        const changeRhythm = (next, cause = 'unspecified', meta = {}) => {
            const cur = stateRef.current;
            const from = RG.canonical(cur.rhythm);
            const to = RG.canonical(next);
            if (!RG.isKnown(next)) {
                addLogEntry(`Rhythm "${next}" is not in the rhythm registry — showing ${RG.labelFor(to)} instead. This is a content bug, please report it.`, 'warning', true);
            }

            // Human-readable detail: energy + synchronisation for shocks, agent for drugs.
            const bits = [];
            if (cause) bits.push(cause);
            if (Number.isFinite(Number(meta.energy))) bits.push(`${Math.round(Number(meta.energy))}J`);
            if (meta.sync === true) bits.push('synchronised');
            if (meta.sync === false && meta.energy) bits.push('unsynchronised');
            if (meta.agent) bits.push(meta.agent);
            if (meta.note) bits.push(meta.note);
            const detail = bits.join(', ');

            conversionSeqRef.current += 1;
            const eventId = `${Date.now()}-${conversionSeqRef.current}`;

            // B2: one consistent, assessor-readable line for EVERY transition, converted or not.
            if (from === to) {
                addLogEntry(`Rhythm: ${RG.labelFor(from)} unchanged (${detail || cause})`, 'info');
            } else {
                addLogEntry(`Rhythm: ${RG.labelFor(from)} \u2192 ${RG.labelFor(to)} (${detail || cause})`, 'action', false);
            }

            dispatch({ type: 'UPDATE_RHYTHM', payload: to, cause, detail, eventId });
            return to;
        };

        // Cosmetic: auto-expire the assessor toast so it behaves like the existing notification toast.
        useEffect(() => {
            if (!coreState.rhythmEvent) return;
            const id = setTimeout(() => dispatchCore({ type: 'CLEAR_RHYTHM_EVENT', currentState: stateRef.current }), 6000);
            return () => clearTimeout(id);
        }, [coreState.rhythmEvent && coreState.rhythmEvent.id]);

        const arrestVitals = (base) => ({ ...base, hr: 0, bpSys: 0, bpDia: 0, spO2: 0, rr: 0, gcs: 3, pupils: 'Dilated', etco2: 1.5 });
        // WAVE 5 / ITEM 6: the vitals an arrest / ROSC write owns outright. Writing them releases the
        // facilitator's manual hold, because the transition itself establishes a new baseline.
        const RESET_HOLD_KEYS = ['hr', 'bpSys', 'bpDia', 'spO2', 'rr', 'gcs', 'pupils', 'etco2'];

        const triggerArrest = (type = 'VF', cause = 'arrest') => {
            const cur = stateRef.current;
            dispatch({ type: 'STOP_TREND' });
            dispatch({ type: 'UPDATE_VITALS', payload: arrestVitals(cur.baseVitals), releaseManual: RESET_HOLD_KEYS });
            changeRhythm(type, cause);
            addLogEntry(`CARDIAC ARREST - ${RG.labelFor(type)}`, 'manual', true);
            dispatch({ type: 'SET_FLASH', payload: 'red' });
        };

        const triggerROSC = (rhythm = 'Sinus Rhythm', cause = 'ROSC', meta = {}) => {
            const cur = stateRef.current;
            // ---- WAVE 5 / ITEM 7: ROSC IS NEVER A SILENT NO-OP -----------------------------------
            // "Return of spontaneous circulation" only means something if there was no spontaneous
            // circulation to start with. Clicking a ROSC rhythm when the patient already has an
            // organised rhythm with output used to overwrite the obs with post-ROSC values (GCS 8,
            // SpO2 94, a rhythm-band HR) on a patient who was never pulseless — and when the chosen
            // rhythm equalled the current one it produced no visible change at all, so the
            // facilitator could not tell whether the click had registered.
            // Permissive philosophy: nothing is blocked. The rhythm change is still performed, the
            // post-arrest obs are NOT forced onto a patient who never arrested, and the reason is
            // both logged and shown as a toast.
            if (!RG.isPulseless(cur.rhythm)) {
                const target0 = RG.canonical(rhythm);
                const same = target0 === RG.canonical(cur.rhythm);
                addLogEntry(
                    same
                        ? `ROSC selected (${RG.labelFor(target0)}) but the patient is not in a pulseless rhythm and is already in ${RG.labelFor(target0)} \u2014 nothing to restore, so the obs were left exactly as they are. Use ARREST first, or the rhythm grid / vitals tiles to change anything.`
                        : `ROSC selected (${RG.labelFor(target0)}) but the patient is not in a pulseless rhythm (currently ${RG.labelFor(cur.rhythm)}) \u2014 treated as a plain rhythm change. Post-arrest obs were NOT applied, because there was no arrest to recover from.`,
                    'warning', true);
                dispatch({ type: 'SET_NOTIFICATION', payload: {
                    msg: same ? `Already in ${RG.labelFor(target0)} \u2014 no change made` : `Not in arrest \u2014 rhythm changed to ${RG.labelFor(target0)} only`,
                    type: 'warning', id: Date.now() } });
                if (!same) changeRhythm(target0, `${cause} (patient not in arrest \u2014 rhythm change only)`, meta);
                return;
            }
            const age = cur.scenario?.patientAge ?? 40;
            const base = (window.getBaseVitals ? window.getBaseVitals(age) : { hr: 80, rr: 16, bpSys: 110, bpDia: 70 });
            const newEtco2 = Math.round((5.0 + (Math.random() * 1.5)) * 10) / 10;
            // C7: ROSC is no longer always exactly Sinus Rhythm. Honour the rhythm we were given,
            // and let the registry supply its rate band so a ROSC into AF is not shown at 80/min.
            const target = RG.canonical(rhythm);
            const band = RG.defaultHrRange(target);
            const hr = band ? getRandomInt(band[0], band[1]) : base.hr;
            dispatch({ type: 'STOP_TREND' });
            dispatch({ type: 'UPDATE_VITALS', payload: { ...cur.baseVitals, hr, bpSys: base.bpSys, bpDia: base.bpDia, spO2: 94, rr: base.rr, gcs: 8, pupils: 3, etco2: newEtco2 }, releaseManual: RESET_HOLD_KEYS });
            changeRhythm(target, cause, meta);
            if (cur.scenario) {
                const updatedScenario = { ...cur.scenario, deterioration: { ...(cur.scenario.deterioration || {}), active: false } };
                dispatch({ type: 'UPDATE_SCENARIO', payload: updatedScenario });
            }
            addLogEntry(`ROSC achieved (${RG.labelFor(target)}). Post-ROSC care: 12-lead, targeted oxygenation, treat the cause.`, 'success', true);
            dispatch({ type: 'SET_FLASH', payload: 'green' });
        };

        // =====================================================================================
        // DEFIBRILLATION (C4 / C6 / C7) — one shared outcome helper, reached by:
        //   * the facilitator's arrest/defib panel (initCharge / deliverShock)
        //   * the 'Defib' intervention (effect.changeRhythm === 'defib')
        //   * a student pressing SHOCK on the monitor-hosted defib (Firebase deviceEvents)
        //   * a student pressing SHOCK on the standalone defib page (BroadcastChannel)
        // =====================================================================================
        const SHOCK_REFRACTORY_MS = 5000;   // C7: stops charge/shock button-mashing maximising ROSC
        const refibTimerRef = useRef(null);

        const defibWeight = () => {
            const cur = stateRef.current;
            const w = Number(cur.scenario?.wetflag?.weight);
            return Number.isFinite(w) && w > 0 ? w : null;
        };
        const recommendedShockEnergy = () => {
            const cur = stateRef.current;
            return RG.recommendedEnergy(defibWeight(), cur.scenario?.patientAge);
        };

        const scheduleRefibrillation = (fromRhythm) => {
            const table = RG.SHOCK_OUTCOMES[RG.canonical(fromRhythm)];
            if (!table || !table.refibChance) return;
            if (Math.random() >= table.refibChance) return;
            if (refibTimerRef.current) clearTimeout(refibTimerRef.current);
            const delay = 20000 + Math.random() * 40000;
            refibTimerRef.current = setTimeout(() => {
                refibTimerRef.current = null;
                const cur = stateRef.current;
                if (!cur.isRunning || cur.isFinished) return;
                if (RG.isPulseless(cur.rhythm)) return;     // already re-arrested another way
                dispatch({ type: 'UPDATE_VITALS', payload: arrestVitals(cur.baseVitals) });
                changeRhythm(fromRhythm, 'refibrillation', { note: 're-arrest after ROSC' });
                dispatch({ type: 'SET_FLASH', payload: 'red' });
            }, delay);
        };

        // The ONE place a shock outcome is decided.
        function applyShockOutcome(cur, opts = {}) {
            const joules = Number.isFinite(Number(opts.energy)) ? Math.round(Number(opts.energy)) : recommendedShockEnergy();
            const sync = !!opts.sync;
            const source = opts.source || 'facilitator';
            const now = Date.now();
            const d = cur.defib || {};

            // --- Metrics (B5). EVERY delivered shock counts here, shockable or not, and these
            // numbers live in state so they reach Firebase, localStorage and the debrief.
            const nextDefib = {
                shockCount: (d.shockCount || 0) + 1,
                totalEnergy: (d.totalEnergy || 0) + joules,
                lastEnergy: joules,
                lastShockAt: now,
                charged: false,
                chargeEnergy: null
            };

            // --- C4: paediatric energy. Never blocked, always flagged (Wave 1 philosophy).
            const dev = RG.energyDeviation(joules, defibWeight(), cur.scenario?.patientAge);
            if (dev) {
                addLogEntry(`Shock energy deviation: ${dev.reason}. Recommended for this patient: ${dev.expected}J (4 J/kg for a child).`, 'warning', true,
                    { action: 'Defib', label: 'Defibrillation', missing: [`correct energy (${dev.expected}J)`] });
            }

            const shockable = RG.isShockable(cur.rhythm);

            // --- C7 FIX: the shock counter used to increment BEFORE this guard, so shocking a
            // non-shockable rhythm silently inflated the ROSC probability of the next real shock.
            if (!shockable) {
                dispatch({ type: 'SET_DEFIB_STATE', payload: nextDefib });
                if (RG.isSyncCardiovertible(cur.rhythm) && !sync) {
                    addLogEntry(`Unsynchronised shock delivered into ${RG.labelFor(cur.rhythm)} — this rhythm needs SYNCHRONISED cardioversion. Not blocked, but flagged.`, 'warning', true,
                        { action: 'Defib', label: 'Defibrillation', missing: ['synchronisation'] });
                } else {
                    addLogEntry(`Shock delivered into non-shockable rhythm (${RG.labelFor(cur.rhythm)}) — no effect. Check the rhythm before shocking.`, 'warning', true,
                        { action: 'Defib', label: 'Defibrillation', missing: ['a shockable rhythm'] });
                }
                changeRhythm(cur.rhythm, 'defibrillation', { energy: joules, sync, note: 'non-shockable, no change' });
                return;
            }

            if (sync) {
                addLogEntry(`SYNCHRONISED shock delivered into ${RG.labelFor(cur.rhythm)} — a pulseless rhythm has no R wave to synchronise to, so the device would not fire in sync. Treat as unsynchronised. Flagged.`, 'warning', true,
                    { action: 'Defib', label: 'Defibrillation', missing: ['unsynchronised mode'] });
            }

            nextDefib.shockableShocks = (d.shockableShocks || 0) + 1;

            // --- C7: refractory period. A shock stacked on top of the previous one within 5s is
            // still delivered and still logged, but earns no new physiological roll.
            const stacked = d.lastShockAt && (now - d.lastShockAt) < SHOCK_REFRACTORY_MS;
            if (stacked) {
                nextDefib.shockableShocks = d.shockableShocks || 0;   // does not advance the ROSC ladder
                dispatch({ type: 'SET_DEFIB_STATE', payload: nextDefib });
                addLogEntry(`Second shock delivered ${Math.round((now - d.lastShockAt) / 1000)}s after the last one — stacked shocks give no additional benefit. Two minutes of good CPR between shocks is the intervention. Flagged.`, 'warning', true,
                    { action: 'Defib', label: 'Defibrillation', missing: ['2 minutes of CPR between shocks'] });
                changeRhythm(cur.rhythm, 'defibrillation', { energy: joules, sync: false, note: 'stacked shock, no change' });
                return;
            }

            dispatch({ type: 'SET_DEFIB_STATE', payload: nextDefib });

            // --- FACILITATOR OVERRIDE (C7): "next shock converts to X". Uses the previously
            // unreachable queuedRhythm / SET_QUEUED_RHYTHM code, which is now driven by a real
            // control on the assessor's defib panel.
            if (cur.queuedRhythm) {
                const q = RG.canonical(cur.queuedRhythm);
                dispatch({ type: 'SET_QUEUED_RHYTHM', payload: null });
                if (RG.isPulseless(q)) {
                    dispatch({ type: 'UPDATE_VITALS', payload: arrestVitals(cur.baseVitals) });
                    changeRhythm(q, 'defibrillation (facilitator override)', { energy: joules });
                } else {
                    triggerROSC(q, 'defibrillation (facilitator override)', { energy: joules });
                    scheduleRefibrillation(cur.rhythm);
                }
                return;
            }

            // --- C7: energy-, rhythm-, CPR- and drug-sensitive ROSC probability.
            const shocks = nextDefib.shockableShocks;
            const expected = recommendedShockEnergy();
            // Under-dosing genuinely reduces defibrillation success; over-dosing does not help.
            const energyFactor = Math.max(0.4, Math.min(1.1, joules / Math.max(1, expected)));
            const rhythmFactor = (RG.canonical(cur.rhythm) === 'Fine VF') ? 0.6 : 1.0;   // fine VF defibrillates poorly
            const cprBonus = cur.cprInProgress ? 0.10 : 0;
            const drugBonus = Math.min(0.15, Number(d.shockBonus) || 0);
            const base = 0.08 + 0.07 * Math.min(shocks, 5);
            const roscChance = Math.max(0.02, Math.min(0.55, (base + cprBonus + drugBonus) * energyFactor * rhythmFactor));

            const fromRhythm = RG.canonical(cur.rhythm);
            const table = RG.SHOCK_OUTCOMES[fromRhythm] || RG.SHOCK_OUTCOMES['VF'];
            if (Math.random() < roscChance) {
                const target = RG.weightedPick(table.rosc);
                // Banked drug bonus is consumed by a successful shock.
                dispatch({ type: 'SET_DEFIB_STATE', payload: { shockBonus: 0 } });
                triggerROSC(target, 'defibrillation', { energy: joules, sync: false });
                scheduleRefibrillation(fromRhythm);
            } else {
                const target = RG.weightedPick(table.noRosc);
                if (target !== fromRhythm) {
                    dispatch({ type: 'UPDATE_VITALS', payload: arrestVitals(cur.baseVitals) });
                }
                changeRhythm(target, 'defibrillation', { energy: joules, sync: false, note: target === fromRhythm ? 'no change — resume CPR' : 'post-shock rhythm change' });
                if (target === fromRhythm) {
                    addLogEntry('No change after shock. Resume compressions immediately, 2-minute cycle, consider escalating energy.', 'warning');
                }
            }
        }

        // --- C6: SYNCHRONISED CARDIOVERSION. `toggleSync` used to only flip a flag; the flag was
        // transmitted and then DISCARDED engine-side, and the 'Cardioversion' intervention's
        // changeRhythm:'sync' was never handled at all.
        function applyCardioversion(cur, opts = {}) {
            const joules = Number.isFinite(Number(opts.energy)) ? Math.round(Number(opts.energy)) : recommendedShockEnergy();
            const d = cur.defib || {};
            const now = Date.now();
            dispatch({ type: 'SET_DEFIB_STATE', payload: {
                shockCount: (d.shockCount || 0) + 1,
                totalEnergy: (d.totalEnergy || 0) + joules,
                lastEnergy: joules, lastShockAt: now, charged: false, chargeEnergy: null, syncMode: true
            } });

            const dev = RG.energyDeviation(joules, defibWeight(), cur.scenario?.patientAge);
            if (dev) addLogEntry(`Cardioversion energy deviation: ${dev.reason}. Recommended: ${dev.expected}J.`, 'warning', true,
                { action: 'Cardioversion', label: 'Synchronised Cardioversion', missing: [`correct energy (${dev.expected}J)`] });

            if (RG.isPulseless(cur.rhythm)) {
                // Never blocked — flagged. A defibrillator in SYNC mode will not discharge into VF,
                // and that is itself the teaching point.
                addLogEntry(`SYNC mode armed in ${RG.labelFor(cur.rhythm)} — a real defibrillator will not discharge in SYNC without an R wave. Switch to unsynchronised defibrillation. Flagged.`, 'danger', true,
                    { action: 'Cardioversion', label: 'Synchronised Cardioversion', missing: ['unsynchronised mode for a pulseless rhythm'] });
                changeRhythm(cur.rhythm, 'cardioversion', { energy: joules, sync: true, note: 'no R wave, device would not fire' });
                return;
            }
            if (!RG.isSyncCardiovertible(cur.rhythm)) {
                addLogEntry(`Synchronised shock delivered into ${RG.labelFor(cur.rhythm)} — cardioversion is not indicated for this rhythm. Flagged.`, 'warning', true,
                    { action: 'Cardioversion', label: 'Synchronised Cardioversion', missing: ['an indication for cardioversion'] });
                changeRhythm(cur.rhythm, 'cardioversion', { energy: joules, sync: true, note: 'not indicated, no change' });
                return;
            }

            // Success depends on the rhythm and on adequate energy.
            const baseSuccess = { 'SVT': 0.85, 'VT': 0.80, 'AF': 0.6, 'Atrial Flutter': 0.9 }[RG.canonical(cur.rhythm)] || 0.7;
            const expected = recommendedShockEnergy();
            const energyFactor = Math.max(0.5, Math.min(1.1, joules / Math.max(1, expected)));
            if (Math.random() < baseSuccess * energyFactor) {
                const band = RG.defaultHrRange('Sinus Rhythm');
                dispatch({ type: 'UPDATE_VITALS', payload: { ...cur.baseVitals, hr: getRandomInt(70, 95) } });
                changeRhythm('Sinus Rhythm', 'cardioversion', { energy: joules, sync: true });
            } else {
                changeRhythm(cur.rhythm, 'cardioversion', { energy: joules, sync: true, note: 'unsuccessful — escalate energy, check sedation and synchronisation' });
            }
        }

        // --- C6: DRUG-MEDIATED CONVERSION. `changeRhythm: 'chance'` was unhandled, so Adrenaline IV
        // and Amiodarone — the two most important drugs in a shockable arrest — changed NOTHING.
        function applyDrugConversion(cur, key, label, opts = {}) {
            const table = RG.DRUG_CONVERSION[key];
            const rid = RG.canonical(cur.rhythm);
            let rule = table && table[rid];
            // E2: adenosine's success probability escalates with the 6 → 12 → 12 mg sequence, so the
            // caller may supply the chance for THIS dose. The registry still owns the target rhythm.
            if (rule && Number.isFinite(opts.chance)) rule = { ...rule, chance: opts.chance };
            if (!rule) {
                addLogEntry(`${label} given in ${RG.labelFor(rid)} — no direct rhythm effect expected for this combination.`, 'info');
                return;
            }
            if (rule.shockBonus) {
                const d = cur.defib || {};
                dispatch({ type: 'SET_DEFIB_STATE', payload: { shockBonus: Math.min(0.15, (Number(d.shockBonus) || 0) + rule.shockBonus) } });
                addLogEntry(`${label} on board — improves the chance that the NEXT shock is successful (${Math.round(rule.shockBonus * 100)}% added).`, 'info');
            }
            if (!rule.chance || !rule.to) return;
            if (Math.random() < rule.chance) {
                if (RG.isPulseless(rule.to)) {
                    dispatch({ type: 'UPDATE_VITALS', payload: arrestVitals(cur.baseVitals) });
                    changeRhythm(rule.to, 'drug', { agent: label });
                } else if (RG.isPulseless(rid)) {
                    triggerROSC(rule.to, 'drug', { agent: label });
                } else {
                    changeRhythm(rule.to, 'drug', { agent: label });
                }
            } else {
                addLogEntry(`${label} given — rhythm unchanged (${RG.labelFor(rid)}).`, 'info');
            }
        }

        function initCharge(energy) {
            const cur = stateRef.current;
            const j = Number.isFinite(Number(energy)) ? Math.round(Number(energy)) : recommendedShockEnergy();
            dispatch({ type: 'SET_FLASH', payload: 'yellow' });
            dispatch({ type: 'SET_DEFIB_STATE', payload: { charged: true, chargeEnergy: j, energy: j } });
            addLogEntry(`Defib charging (${j}J${cur.defib?.syncMode ? ', SYNC' : ''})`, 'warning');
            dispatch({ type: 'SET_NOTIFICATION', payload: { msg: `Charging ${j}J...`, type: 'warning', id: Date.now() } });
            setTimeout(() => dispatch({ type: 'SET_FLASH', payload: null }), 1000);
        }

        function deliverShock(energy, source = 'facilitator', opts = {}) {
            const cur = stateRef.current;
            const j = Number.isFinite(Number(energy)) ? Math.round(Number(energy)) : recommendedShockEnergy();
            const sync = opts.sync !== undefined ? !!opts.sync : !!(cur.defib && cur.defib.syncMode);
            dispatch({ type: 'SET_FLASH', payload: 'red' });
            // B5: logged as 'danger' AND flagged, and the debrief now plots danger-type markers.
            addLogEntry(`Shock delivered ${j}J${sync ? ' (SYNC)' : ''} (${source})`, 'danger', true);
            dispatch({ type: 'SET_NOTIFICATION', payload: { msg: `Shock Delivered ${j}J`, type: 'danger', id: Date.now() } });
            setTimeout(() => dispatch({ type: 'SET_FLASH', payload: null }), 500);
            if (sync) applyCardioversion(cur, { energy: j, source });
            else applyShockOutcome(cur, { energy: j, sync: false, source });
        }

        // Assessor-facing defib device controls, shared by the controller panel and by student
        // events arriving over Firebase / BroadcastChannel.
        const setDefibMode = (mode, source = 'facilitator') => {
            dispatch({ type: 'SET_DEFIB_STATE', payload: { mode, charged: false, chargeEnergy: null } });
            addLogEntry(`Defibrillator mode: ${String(mode).toUpperCase()} (${source})`, 'action');
        };
        const setDefibEnergy = (j, source = 'facilitator') => {
            const v = Math.max(1, Math.round(Number(j) || 0));
            dispatch({ type: 'SET_DEFIB_STATE', payload: { energy: v, charged: false, chargeEnergy: null } });
            addLogEntry(`Energy selected: ${v}J (${source})`, 'action');
        };
        const toggleDefibSync = (source = 'facilitator') => {
            const cur = stateRef.current;
            const next = !(cur.defib && cur.defib.syncMode);
            dispatch({ type: 'SET_DEFIB_STATE', payload: { syncMode: next } });
            addLogEntry(`SYNC ${next ? 'ON' : 'OFF'} (${source})${next && RG.isPulseless(cur.rhythm) ? ' — SYNC armed in a pulseless rhythm; the device will not discharge. Flagged.' : ''}`, next && RG.isPulseless(cur.rhythm) ? 'warning' : 'action', next && RG.isPulseless(cur.rhythm));
        };
        const analyseRhythm = (source = 'student') => {
            const cur = stateRef.current;
            const shockable = RG.isShockable(cur.rhythm);
            const result = shockable ? 'SHOCK ADVISED' : 'NO SHOCK ADVISED';
            dispatch({ type: 'SET_DEFIB_STATE', payload: { analysing: false, lastAnalysis: { result, rhythm: RG.canonical(cur.rhythm), at: Date.now() } } });
            addLogEntry(`Defib analysis (${source}): ${result} — ${RG.labelFor(cur.rhythm)}`, 'action');
            return result;
        };
        const setQueuedRhythm = (r) => {
            if (!r) { dispatch({ type: 'SET_QUEUED_RHYTHM', payload: null }); addLogEntry('Facilitator override cleared: next shock follows the model.', 'system'); return; }
            const q = RG.canonical(r);
            dispatch({ type: 'SET_QUEUED_RHYTHM', payload: q });
            addLogEntry(`Facilitator override armed: the NEXT shock will convert to ${RG.labelFor(q)}.`, 'system');
        };
        const toggleCPR = (on, source = 'facilitator') => {
            const cur = stateRef.current;
            const next = on === undefined ? !cur.cprInProgress : !!on;
            if (next === cur.cprInProgress) return;
            dispatch({ type: 'TOGGLE_CPR', payload: next });
            if (next) dispatch({ type: 'RESET_CYCLE_TIMER' });
            addLogEntry(next
                ? `CPR started (${source}) — arrest ETCO2, compression artefact and the ROSC bonus are now active. Aim for 100-120/min, minimise pauses.`
                : `CPR stopped (${source}).`, next ? 'action' : 'warning', !next && RG.isPulseless(cur.rhythm));
        };

        const revealInvestigation = (type, customText = null) => {
            dispatch({ type: 'SET_LOADING_INVESTIGATION', payload: type });
            setTimeout(() => {
                const cur = stateRef.current;
                let finalCustomText = customText;

                // VBG: if no manual override supplied, derive from current state
                // D1: the AUTHORED VBG is authoritative for the baseline. It used to be bypassed
                // whenever scenario.vbg was null (113/254 scenarios, because enrichScenario wrote
                // the resolved default block to scenario.investigations.vbg but left the top-level
                // scenario.vbg null), so generateVbg('normal') supplied its VENOUS default of
                // pO2 5.0 over an authored arterial pO2 of 12.
                // PRECEDENCE, deliberately: authored scenario.vbg  >  enriched
                // scenario.investigations.vbg  >  generateVbg('normal'). calculateDynamicVbg then
                // applies TIME/TREATMENT DELTAS on top of that baseline; every key it does not
                // model (pO2, Na, Ca) is carried through from the authored block untouched.
                if (type === 'VBG' && !customText && cur.scenario && window.calculateDynamicVbg) {
                    const startVbg = cur.scenario.vbg || cur.scenario.investigations?.vbg || window.generateVbg?.('normal');
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
        // 2-minute ALS cycle. Wired to a real button on the assessor's defib panel in Wave 3
        // (it previously existed but nothing could reach it).
        const nextCycle = () => {
            const cur = stateRef.current;
            dispatch({ type: 'FAST_FORWARD', payload: 120 });
            dispatch({ type: 'RESET_CYCLE_TIMER' });
            addLogEntry('Rhythm check at 2 minutes (+2:00 fast forward)', 'system');
            if (cur.queuedRhythm) {
                const q = RG.canonical(cur.queuedRhythm);
                dispatch({ type: 'SET_QUEUED_RHYTHM', payload: null });
                if (RG.isPulseless(q)) {
                    dispatch({ type: 'UPDATE_VITALS', payload: arrestVitals(cur.baseVitals) });
                    changeRhythm(q, 'rhythm check (facilitator override)');
                } else {
                    triggerROSC(q, 'rhythm check (facilitator override)');
                }
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
            // WAVE 5 / ITEM 7 (same class of defect as the ROSC no-op): with no audio context yet
            // — the "Tap to Enable Sound" gesture not having happened — this returned silently, so the
            // button looked broken. Say why instead.
            if (!audioCtxRef.current) {
                addLogEntry(`Continuous sound "${type}" was not started: audio has not been enabled on this device yet. Tap the sound prompt on the monitor (or any control on this page) first.`, 'warning');
                dispatch({ type: 'SET_NOTIFICATION', payload: { msg: 'Audio not enabled yet — tap to enable sound first', type: 'warning', id: Date.now() } });
                return;
            }
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
        // ---- WAVE 5 / ITEM 10: A LONG-ONSET DRUG MUST LOOK LIKE IT IS WORKING ------------------
        // IV paracetamol is correctly modelled (onset ~900 s, peak ~90 min, Temp -0.5), and correct
        // pharmacology means NOTHING moves inside a 4-minute sim segment. That is right and must not
        // be falsified — but the facilitator had no way to tell "working as intended, 12 minutes to
        // go" from "did nothing". The panel row now carries the countdown to onset, the countdown to
        // peak, and a plain-English summary of the effect that is coming.
        const EFFECT_WORDS = {
            HR: (v) => `HR ${v > 0 ? '+' : ''}${v}`,
            BP: (v) => `BP ${v > 0 ? '+' : ''}${v} mmHg`,
            RR: (v) => `RR ${v > 0 ? '+' : ''}${v}`,
            SpO2: (v) => `SpO2 ${v > 0 ? '+' : ''}${v}%`,
            gcs: (v) => `GCS ${v > 0 ? '+' : ''}${v}`,
            BM: (v) => `glucose ${v > 0 ? '+' : ''}${v} mmol/L`,
            Temp: (v) => `${v < 0 ? '\u2212' : '+'}${Math.abs(v)} \u00b0C`,
            pH: (v) => `pH ${v > 0 ? '+' : ''}${v}`,
            K: (v) => `K+ ${v > 0 ? '+' : ''}${v} mmol/L`,
            ETCO2: (v) => `ETCO2 ${v > 0 ? '+' : ''}${v} kPa`
        };
        const describeDrugEffect = (d) => {
            const bits = [];
            const defn = (window.INTERVENTIONS || {})[d.key] || {};
            if (defn.antipyretic) bits.push('antipyretic');
            Object.keys(d.effect || {}).forEach(f => {
                const fn = EFFECT_WORDS[f];
                if (fn) bits.push(fn(d.effect[f]));
            });
            (d.drives || []).forEach(dr => {
                const per = Number(dr.ratePerHour);
                if (!Number.isFinite(per) || !per) return;
                const unit = dr.vital === 'temp' ? '\u00b0C/h' : dr.vital === 'bm' ? 'mmol/L/h' : '/h';
                bits.push(`${dr.vital === 'temp' ? 'temperature' : dr.vital} ${per > 0 ? '+' : '\u2212'}${Math.abs(per)} ${unit}${dr.target !== null && dr.target !== undefined ? ` toward ${dr.target}` : ''}`);
            });
            if (d.paralytic) bits.push('neuromuscular blockade');
            // ITEM 10: an agent whose modelled action is clinical rather than haemodynamic (the
            // anticonvulsants) must still say something, or its row looks broken.
            if (!bits.length) bits.push('clinical effect only \u2014 no modelled change to the obs');
            return bits.join(', ');
        };

        const getActiveDrugStatus = () => {
            const cur = stateRef.current;
            const t = cur.time;
            const rows = (cur.activeDrugs || []).map(d => {
                const factor = pkFactor(d, t);
                const remaining = pkRemaining(d, t);
                const el = t - d.startTime;
                // Live drive telemetry: current value, rate, target and an honest ETA, so a slow but
                // correct 2 degC/h of cooling is visibly in progress even between two 0.1 degC display
                // steps. `baseVitals` is the unrounded physiology, which is why sub-display-step
                // movement is real here and never lost (ITEM 9).
                const drives = (d.drives || []).map(dr => {
                    const nowVal = cur.baseVitals ? cur.baseVitals[dr.vital] : undefined;
                    const perHour = Number(dr.ratePerHour);
                    let etaSeconds = null;
                    if (Number.isFinite(nowVal) && Number.isFinite(perHour) && perHour !== 0 && dr.target !== null && dr.target !== undefined) {
                        const gap = dr.target - nowVal;
                        if ((gap > 0) === (perHour > 0) && Math.abs(gap) > 0.001) etaSeconds = Math.round(Math.abs(gap / perHour) * 3600);
                        else etaSeconds = 0;
                    }
                    return { vital: dr.vital, ratePerHour: perHour, target: dr.target, current: Number.isFinite(nowVal) ? Math.round(nowVal * 100) / 100 : null, etaSeconds, active: el >= d.onset };
                });
                return {
                    key: d.key, label: d.label, phase: pkPhase(d, t),
                    intensity: Math.round(Math.min(1, factor) * 100),
                    remaining, elapsed: el, sustained: !!d.sustained,
                    stopped: d.sustained && d.stopTime >= 0, paralytic: !!d.paralytic, reversed: !!d.reversed,
                    effect: d.effect || {},
                    // ITEM 10: countdowns and the plain-English expectation.
                    onsetIn: Math.max(0, d.onset - el),
                    peakIn: Math.max(0, d.peak - el),
                    onsetSeconds: d.onset, peakSeconds: d.peak,
                    expected: describeDrugEffect(d),
                    drives,
                    route: d.route || null
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
                if (r.elapsed < m.elapsed) { m.phase = r.phase; m.elapsed = r.elapsed; m.onsetIn = r.onsetIn; m.peakIn = r.peakIn; }
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
        const reset = () => { if (refibTimerRef.current) { clearTimeout(refibTimerRef.current); refibTimerRef.current = null; } dispatch({ type: 'CLEAR_SESSION' }); };
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
            // WAVE 6: the decision of WHAT to tick is tickActionFor's, not this effect's. A stopped
            // clock with an active ramp still ticks — trend-only — so a facilitator's "take the HR to
            // 130 over 2 minutes" works the moment it is set, including in Quick Sim where START is
            // never pressed.
            const action = tickActionFor(state, isMonitorMode);
            if (action) {
                timerRef.current = setInterval(() => {
                    tickRef.current = Date.now();
                    dispatch({ type: action });
                }, 1000);
            } else {
                if (timerRef.current) clearInterval(timerRef.current);
            }
            return () => { if (timerRef.current) clearInterval(timerRef.current); };
        }, [state.isRunning, isMonitorMode, !!(state.trends && state.trends.active)]);

        // =====================================================================================
        // WAVE 8 / FINDING 3 — EVERY MONITORING CHIP IS A TRUE TWO-WAY TOGGLE.
        // One press attaches, the next press DETACHES, and the chip's own state is what decides
        // which. The whole class of confusion came from the chip reading its state through
        // getSensors() (so 'Obs' made it look attached) while pressing it applied its INDIVIDUAL
        // key: the press was a no-op to look at. Attachment and detachment are both logged, so both
        // appear in the timeline and the debrief.
        //
        // Not a toggle, deliberately: a point-of-care check. Repeating a glucose or a VBG takes a
        // FRESH, newly-timestamped sample, which is the clinically important behaviour and is what
        // a facilitator pressing it again means.
        // =====================================================================================
        const toggleSensor = (id) => {
            const cur = stateRef.current;
            const def = SENSOR_DEFS.filter(d => d.id === id)[0];
            if (!def) { console.warn(`toggleSensor('${id}') ignored: no such sensor.`); return; }
            if (def.kind === 'poc') { applyIntervention(def.key); return; }
            const on = !!getSensors(cur)[def.id];
            // Capnography keeps its own long-standing toggle, which already goes both ways and logs.
            if (def.key === 'ToggleETCO2' || !on) { applyIntervention(def.key); return; }
            dispatch({ type: 'DETACH_SENSOR', payload: def.key });
            addLogEntry(`${def.label} removed \u2014 ${def.reveals} no longer visible to the team.`, 'action');
            dispatch({ type: 'SET_NOTIFICATION', payload: { msg: `${def.label} DETACHED (press again to re-attach)`, type: 'info', id: Date.now() } });
        };
        // WAVE 8 / FINDING 4. The fast path attaches the STANDARD four and says so. The invasive
        // action is separate and explicitly labelled, because an arterial line, IV access and
        // capnography are deliberate clinical acts, not a default.
        const attachStandardMonitoring = () => applyIntervention('Obs');
        const attachInvasiveMonitoring = () => {
            const s = getSensors(stateRef.current);
            if (!s.iv) applyIntervention('IV Access');
            if (!s.art) applyIntervention('ArtLine');
            if (!s.etco2) applyIntervention('ToggleETCO2');
        };

        return { state, dispatch, start, pause, stop, reset, applyIntervention, addLogEntry, manualUpdateVital, triggerArrest, triggerROSC, revealInvestigation, clearInvestigation, nextCycle, enableAudio, speak, playSound, toggleAudioLoop, startTrend, triggerNIBP, toggleNIBPMode, triggerAction, initCharge, deliverShock, playAlertTone,
        // Wave 3 surface
        changeRhythm, applyCardioversion: (o) => applyCardioversion(stateRef.current, o || {}),
        setDefibMode, setDefibEnergy, toggleDefibSync, analyseRhythm, setQueuedRhythm, toggleCPR,
        sendDeviceEvent, recommendedShockEnergy,
        defibEnergySteps: () => RG.energySteps(defibWeight(), stateRef.current.scenario?.patientAge), audioContextState: audioCtxState, getUnmetExpectations: (action) => getUnmetExpectations(action, stateRef.current), setDeteriorationMode, toggleDeteriorationMode, describeDeterioration, getActiveDrugStatus,
        // Wave 8 surface: two-way sensor toggles, the honest fast paths and the derived obstruction.
        toggleSensor, attachStandardMonitoring, attachInvasiveMonitoring,
        getObstruction: () => getObstruction(stateRef.current, stateRef.current.vitals, stateRef.current.scenario) };
    };
    window.useSimulation = useSimulation;
})();
