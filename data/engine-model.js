(() => {
    // THE SIMULATION ENGINE, PART 1 OF 3: the model. Initial states, physiology, drug kinetics,
    // deterioration, objectives and trends: plain functions and constants, no React. Loaded before
    // engine-reducers.js and engine.js, which take what they need from window.__EngineModel.
    const { useState, useEffect, useRef, useReducer } = React;
    const { INTERVENTIONS, calculateDynamicVbg, getRandomInt, clamp } = window;

    // The single shared rhythm registry. Every shockability, pulseless and
    // "is this an arrest?" decision in this file now goes through RG. The previous hardcoded
    // arrays (two shockability lists, seven arrest lists) are gone.
    const RG = window.RHYTHMS;
    if (!RG) throw new Error('data/rhythms.js must load before data/engine.js');

    // Serum potassium is a MODELLED VITAL. Hyperkalaemia and DKA were the two
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

    // A genuinely unique identifier for THIS RUN of a scenario.
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
        // The obstruction severity that shapes the capnogram. On the controller
        // this is DERIVED every render by getObstruction(); it is stored only on the student monitor,
        // where it arrives over the wire as `co2Severity` so both views draw the identical shape.
        co2Severity: 0,
        // The sim-clock second at which the FACILITATOR deliberately paused a
        // running session, or null. A session restored from storage is `null` even though its clock
        // is non-zero, which is exactly what tells "resumed, not yet started" apart from "paused
        // mid-session". Never persisted: reloading the page can only ever produce the former.
        pausedAt: null,
        monitorPopup: { type: null, timestamp: 0, customText: null },
        waveformGain: 1.0, noise: { interference: false },
        remotePacerState: { rate: 0, output: 0 }, notification: null, pacingThreshold: 70,
        icp: 10, activeLoops: {}, completedObjectives: new Set(), assessments: {},
        lastUpdate: 0, isOffline: false, showWetflag: true,
        // Mirrored top-level serum K+ (the authoritative copy lives in vitals.k).
        potassium: 4.2,
        // ---- WAVE 7 / ITEM 4: INTERMITTENT (POINT-OF-CARE) READINGS ------------------
        // Continuous monitoring (ECG, SpO2, capnography, art line, temperature probe) reveals a
        // LIVE value. A point-of-care check reveals the value AT THE MOMENT IT WAS TAKEN and must
        // then stop tracking, exactly as NIBP already does with its "LAST: 09:47" stamp. Each entry
        // is { value, at (sim seconds), clock (wall-clock string) } — primitives only, so the whole
        // object passes sanitizeForRealtimeDatabase untouched.
        pocReadings: {},
        // ---- WAVE 3 -------------------------------------------------------------------
        // The assessor's Defib open/close toggle. Modelled exactly on arrestPanelOpen
        // (SET_DEFIB_PANEL / synced top-level boolean) so the remote monitor reacts promptly.
        defibPanelOpen: false,
        // Defibrillator device + metrics state. Previously shockCountRef was a bare useRef
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
            shockBonus: 0,              // additive ROSC bonus banked by adrenaline/amiodarone
            episodeShocks: 0,           // ADEQUATE shocks since the current rhythm began (fixed-count policy)
            adrChecks: 0,               // rhythm checks since adrenaline in a non-shockable arrest
            refibDone: false            // the "VF recurs once" setting has fired
        },
        // How shocks and rhythm checks are resolved (see DEFIB_SETTING_VALUES below).
        //   shockResponse: 'model' (probabilistic, energy/CPR/drug-sensitive) | 'auto' (fixed:
        //                  arrest converts on the scenario's shock number or the 3rd adequate shock,
        //                  cardioversion on the 1st) | '1'..'5' | 'never'
        //   rOnT:          unsynchronised shock into a rhythm with a pulse: 'always' | 'sometimes' | 'never'
        //   refib:         after ROSC from VF/pVT: 'model' | 'once' (VF returns once) | 'off'
        defibSettings: { shockResponse: 'model', rOnT: 'never', refib: 'model' },
        // Transcutaneous pacing as the device delivers it (see the pacing effect in useSimulation).
        pacing: { electrical: false, mechanical: false, underlying: null, pre: null },
        // Defib Sim: the CPR metronome plays on the learner's defib tablet.
        metronomeOn: false,
        // The current cardiac arrest, for the RCUK drug prompts and the debrief: when it began (sim
        // seconds, null when there is no arrest), shocks delivered during it and the sim times of
        // each adrenaline and amiodarone dose. A new arrest starts a new record.
        arrest: { since: null, shocks: 0, adrenaline: [], amiodarone: [] },
        // Defib Sim custom scenarios: which step is running and since when (sim seconds).
        defibStep: null,
        // What each linked defib tablet is showing (sessions/<CODE>/deviceState). Controller-only:
        // never part of the sync payload.
        deviceMirror: {},
        // B4 / LEAK BARRIER: rhythmEvent and lastConversion are ASSESSOR-LOCAL. They are
        // deliberately absent from the Firebase sync payload (verified by
        // tests/specs/rules.spec.js: the sync payload has no such key) because `notification`
        // IS synced and IS rendered on the student monitor. Conversion announcements must never
        // appear on the patient-facing screen — that would tell the team the answer.
        rhythmEvent: null,              // { id, from, to, cause, detail, at } — drives the toast
        lastConversion: null,           // last CONVERSION (from !== to) — drives the persistent strip
        // Which remote devices are connected and what each is displaying.
        remotePresence: { clients: [], updatedAt: null },
        // `isOffline` is kept for existing UI behaviour; syncStatus carries the actionable
        // reason that the controller and second-screen monitor display to the user.
        syncStatus: { state: 'connecting', message: null, lastWriteAt: null }
    };

    const SYNC_OFFLINE_STATES = new Set(['unavailable', 'disconnected', 'error']);

    const DEFIB_SETTING_VALUES = {
        shockResponse: ['model', 'auto', '1', '2', '3', '4', '5', 'never'],
        rOnT: ['always', 'sometimes', 'never'],
        refib: ['model', 'once', 'off']
    };
    // Only known keys and values survive, so a scenario file or a remote command cannot put
    // anything else into the settings.
    const cleanDefibSettings = (base, patch) => {
        const out = { ...base };
        Object.keys(DEFIB_SETTING_VALUES).forEach(k => {
            const v = patch && patch[k] !== undefined ? String(patch[k]) : undefined;
            if (v !== undefined && DEFIB_SETTING_VALUES[k].indexOf(v) !== -1) out[k] = v;
        });
        return out;
    };

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
    // INDIVIDUALLY ATTACHABLE MONITORING
    //
    // One helper, derived from the SAME activeInterventions set that is already logged, already
    // flagged and already synced to the student monitor. No parallel state, nothing new on the
    // wire, and no scenario data changes: a scenario still starts with nothing attached, which is
    // the existing designed default ("NO SENSOR DETECTED").
    //
    // 'Obs' (Attach Monitoring) remains the ONE-CLICK FAST PATH and implies every continuous
    // sensor, so existing muscle memory and all 254 premade scenarios behave exactly as before.
    // The individual keys are additive. (Quick Sim now starts with nothing attached too.)
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
    // The four sensors the ONE-PRESS fast path attaches, and the deliberate
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
            // Two HONEST summary flags, so no button can claim more than it did.
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

    // PUPILS ARE CATEGORICAL, NOT CONTINUOUS.
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
        // K = serum potassium (mmol/L), ETCO2 = end-tidal CO2 (kPa, e.g. the CO2 load
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
    // Derived from the registry, NOT a local copy. The old literal included 'VT', which is
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
            // An ABSOLUTE ceiling on the composed vital, not just an additive dose cap.
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
    // 300s -> 120s. The declared rate (2 degC/h of cooling) was only ever reached
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

    // The Wave 2 documentation promised COSINE-SMOOTHED ramps; the code shipped a bare
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

    // Absolute, saturating ceilings. Collected from whichever entries are currently live so a
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
            // A saturating ceiling only ever removes DRUG-DRIVEN excess — it can never pull a
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
    // The new route-specific keys are wired in here too. A clinically correct treatment
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
    // HOW OBSTRUCTED IS THIS PATIENT RIGHT NOW?
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
    // "No rash, no wheeze" must NOT read as bronchospasm (ACE-inhibitor angio-oedema says exactly
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
        // Exported as a test handle for the categorical-vital guard.
        normalisePupils, isCategoricalVital,
        // Test handles for the metabolic and deterioration models.
        drivenVitals, applyDriveTick, drugCeilings, baseForDisplayed, easeRamp, fluidResponsiveness, inferPotassium, VOLUME_KEYS,
        ageBandOf, safeApnoeaSeconds, paediatricFieldScale, hasHighO2Consumption, DETERIORATION_TREATMENTS,
        FLUID_RESPONSE_LEVELS,
        // The bronchospasm severity model behind the shark-fin capnogram.
        getObstruction, inferObstruction, obstructionBand, BRONCHODILATORS, OBSTRUCTION_HINTS };

    const OBJECTIVE_TRIGGERS = {
        'Antibiotics':   ['antibio', 'sepsis', 'infection', 'antimicro'],
        'Fluids':        ['fluid', 'resus', 'bolus', 'iv fluid', 'saline'],
        'AdrenalineIM':  ['adrenaline', 'anaphyl', 'epinephrine'],
        'AdrenalineIV':  ['adrenaline', 'cardiac arrest', 'epinephrine'],
        // 'Adrenaline', 'O2', 'NaloxoneIV', 'Tranexamic', 'ChestDrain' and
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
        // Keys that were missing entirely, so an objective they should satisfy
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
    // MULTI-COMPONENT OBJECTIVE PROGRESS
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

    // The whole precedence decision in one pure, exported predicate, so "does a
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
            // Categorical vitals snap on the FIRST tick and are never interpolated, even when
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

    // What should the 1 Hz interval dispatch this second? Pulled out of the effect so the
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

    // Shared with engine-reducers.js and engine.js (the list is generated from what they use).
    window.__EngineModel = {
        ARREST_SUPPRESSED, DEFAULT_VITALS, INVASIVE_SENSOR_KEYS, OBJECTIVE_TRIGGERS, PULSELESS_RHYTHMS,
        SENSOR_DEFS, STANDARD_SENSOR_KEYS, SYNC_OFFLINE_STATES, VENTILATOR_RATE, VOLUME_KEYS,
        advanceTrendsOneSecond, ageBandOf, applyDeteriorationTick, applyDriveTick, applyRhythmHrBand,
        baseForDisplayed, buildDrugEntry, clampVital, cleanDefibSettings, composeVitals,
        deteriorationTreatmentFactor, drivenVitals, drugCeilings, drugOffsets, fluidResponsiveness,
        getObstruction, getSensors, getUnmetExpectations, hasHighO2Consumption, inferPotassium,
        initialCoreState, initialLogState, initialScenarioState, initialVitalsState, isCategoricalVital,
        isDrugSpent, isVentilated, isVitalValueSafe, newRunId, normaliseDeteriorationType,
        normalisePupils, paediatricFieldScale, paralysisFromDrugs, paralysisPhase, pkFactor, pkPhase,
        pkRemaining, safeApnoeaSeconds, sanitizeForRealtimeDatabase, scenarioText, tickActionFor
    };
})();
