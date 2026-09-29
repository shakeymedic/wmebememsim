(() => {
    // THE SIMULATION ENGINE, PART 2 OF 3: the reducers (vitals, log, scenario, core state).
    const { useState, useEffect, useRef, useReducer } = React;
    const { INTERVENTIONS, calculateDynamicVbg, getRandomInt, clamp } = window;

    // WAVE 3 / C1: the single shared rhythm registry. Every shockability, pulseless and
    // "is this an arrest?" decision in this file now goes through RG. The previous hardcoded
    // arrays (two shockability lists, seven arrest lists) are gone.
    const RG = window.RHYTHMS;
    if (!RG) throw new Error('data/rhythms.js must load before data/engine.js');
    const {
        ARREST_SUPPRESSED, PULSELESS_RHYTHMS, STANDARD_SENSOR_KEYS, SYNC_OFFLINE_STATES, VENTILATOR_RATE,
        advanceTrendsOneSecond, applyDeteriorationTick, applyDriveTick, baseForDisplayed, clampVital,
        cleanDefibSettings, composeVitals, deteriorationTreatmentFactor, drivenVitals, drugCeilings,
        drugOffsets, hasHighO2Consumption, inferPotassium, initialCoreState, initialLogState,
        initialScenarioState, initialVitalsState, isCategoricalVital, isDrugSpent, isVentilated,
        isVitalValueSafe, newRunId, normaliseDeteriorationType, normalisePupils, paralysisFromDrugs,
        paralysisPhase, pkFactor, safeApnoeaSeconds, sanitizeForRealtimeDatabase
    } = window.__EngineModel;

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
                // A scenario that STARTS in cardiac arrest starts with arrest observations. The
                // built-in arrest scenarios only set hr/bp/SpO2/GCS, so the defaults filled in a
                // respiratory rate of 16 and normal pupils on a pulseless patient. Anything the
                // scenario states explicitly (its vitalsMod) still wins.
                const startRhythm = (action.payload.ecg && action.payload.ecg.type) || 'Sinus Rhythm';
                if (RG.isPulseless(startRhythm)) {
                    const stated = action.payload.vitalsMod || {};
                    const arrestObs = { bpSys: 0, bpDia: 0, spO2: 0, rr: 0, gcs: 3, pupils: 'Dilated', etco2: 1.5 };
                    Object.keys(arrestObs).forEach(k => { if (stated[k] === undefined) initialVitals[k] = arrestObs[k]; });
                }
                return { ...initialVitalsState, vitals: initialVitals, baseVitals: { ...initialVitals }, prevVitals: { ...initialVitals } };
            case 'RESTORE_SESSION': {
                const restoredVitals = { ...initialVitalsState.vitals, ...(action.payload.vitals || {}) };
                return { ...state, vitals: restoredVitals, baseVitals: { ...restoredVitals, ...(action.payload.baseVitals || {}) }, prevVitals: { ...restoredVitals, ...(action.payload.prevVitals || {}) }, trends: action.payload.trends || state.trends, hypoxiaTimer: action.payload.hypoxiaTimer || 0, manualHold: action.payload.manualHold || {} };
            }
            // The monitor does not run physiology; the authoritative composed vitals arrive over the
            // wire, so base == displayed there.
            case 'SYNC_FROM_MASTER': return { ...state, vitals: action.payload.vitals || state.vitals, baseVitals: { ...initialVitalsState.vitals, ...(action.payload.vitals || {}) }, trends: action.payload.trends || state.trends };
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
                // Monitoring is NOT seeded, in Quick Sim or anywhere else: every launch mode starts
                // with nothing attached ("NO SENSOR DETECTED"), and the facilitator attaches the
                // standard set or individual sensors from the controller's Monitoring & access panel.
                // (Quick Sim used to seed 'Obs' here; it no longer does, by request.)
                return { ...initialCoreState, runId: newRunId(), rhythm: initialRhythm, icp: startICP, isOffline: state.isOffline, syncStatus: state.syncStatus,
                    showWetflag: action.payload.showWetflag !== false, deteriorationMode: detMode0,
                    defibSettings: cleanDefibSettings(initialCoreState.defibSettings, action.payload.defibSettings),
                    pacingThreshold: Number(action.payload.pacingThreshold) > 0 ? Number(action.payload.pacingThreshold) : initialCoreState.pacingThreshold,
                    arrest: { since: RG.isPulseless(initialRhythm) ? 0 : null, shocks: 0, adrenaline: [], amiodarone: [] },
                    defibStep: (action.payload.defibSim && Array.isArray(action.payload.defibSim.steps) && action.payload.defibSim.steps.length)
                        ? { index: 0, since: 0, done: false } : null,
                    // Always a FRESH Set: initialCoreState holds one shared instance, so spreading it
                    // would hand every session the same object.
                    activeInterventions: new Set(),
                    interventionCounts: {} };
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
                    defibSettings: cleanDefibSettings(initialCoreState.defibSettings, p.defibSettings),
                    arrest: (p.arrest && typeof p.arrest === 'object')
                        ? { since: Number.isFinite(p.arrest.since) ? p.arrest.since : null, shocks: Number(p.arrest.shocks) || 0,
                            adrenaline: Array.isArray(p.arrest.adrenaline) ? p.arrest.adrenaline : [], amiodarone: Array.isArray(p.arrest.amiodarone) ? p.arrest.amiodarone : [] }
                        : initialCoreState.arrest,
                    defibStep: (p.defibStep && Number.isFinite(p.defibStep.index)) ? { index: p.defibStep.index, since: Number(p.defibStep.since) || 0, done: !!p.defibStep.done } : null,
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
                // A new rhythm starts a new episode for the fixed-count shock and rhythm-check rules.
                const defibAfter = ev.converted ? { ...state.defib, episodeShocks: 0, adrChecks: 0 } : state.defib;
                // Arrest bookkeeping: entering a pulseless rhythm from one with a pulse starts a new
                // arrest; leaving it ends the arrest (the record stays for the debrief until the next).
                const arrest0 = state.arrest || initialCoreState.arrest;
                let arrestAfter = arrest0;
                if (RG.isPulseless(to) && arrest0.since === null) arrestAfter = { since: Number(state.time) || 0, shocks: 0, adrenaline: [], amiodarone: [] };
                else if (!RG.isPulseless(to) && arrest0.since !== null) arrestAfter = { ...arrest0, since: null };
                return { ...state, rhythm: to, rhythmEvent: ev, lastConversion: ev.converted ? ev : state.lastConversion, defib: defibAfter, arrest: arrestAfter };
            }
            case 'CLEAR_RHYTHM_EVENT': return { ...state, rhythmEvent: null };
            // B5 / A: defibrillator device state + metrics. Merge semantics so a charge does not
            // clobber the running shock tally.
            case 'SET_DEFIB_STATE': {
                const nextDefib = { ...state.defib, ...(action.payload || {}) };
                const a = state.arrest || initialCoreState.arrest;
                const shocked = (Number(nextDefib.shockCount) || 0) > (Number(state.defib && state.defib.shockCount) || 0);
                return { ...state, defib: nextDefib, arrest: shocked && a.since !== null ? { ...a, shocks: a.shocks + 1 } : a };
            }
            case 'SET_DEFIB_STEP': return { ...state, defibStep: action.payload ? { ...(state.defibStep || {}), ...action.payload } : null };
            // Device artefacts shown on the learner's defib: only these keys, only booleans.
            case 'SET_NOISE': {
                const n = { ...(state.noise || {}) };
                ['interference', 'movement', 'leadoff'].forEach(k => { if (action.payload && action.payload[k] !== undefined) n[k] = !!action.payload[k]; });
                return { ...state, noise: n };
            }
            case 'SET_DEFIB_PANEL': return { ...state, defibPanelOpen: !!action.payload };
            case 'SET_DEFIB_SETTINGS': return { ...state, defibSettings: cleanDefibSettings(state.defibSettings, action.payload) };
            case 'SET_PACING_THRESHOLD': return { ...state, pacingThreshold: Math.max(10, Math.min(140, Math.round(Number(action.payload) || state.pacingThreshold))) };
            case 'SET_PACING': return { ...state, pacing: { ...state.pacing, ...(action.payload || {}) } };
            case 'SET_METRONOME': return { ...state, metronomeOn: !!action.payload };
            case 'SET_DEVICE_MIRROR': return { ...state, deviceMirror: action.payload || {} };
            case 'SET_REMOTE_PRESENCE': return { ...state, remotePresence: { clients: action.payload || [], updatedAt: Date.now() } };
            case 'START_NIBP': return { ...state, nibp: { ...state.nibp, inflating: true } };
            // Abandons a measurement in progress: no reading is committed (the commit timer is
            // cleared by the effect that owns it as soon as `inflating` goes false).
            case 'STOP_NIBP': return { ...state, nibp: { ...state.nibp, inflating: false } };
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
                // Whether the pulse tone and alarms should sound, decided once on the controller
                // (see isAudioLive). Older controllers do not send it; isAudioLive falls back.
                audioLive: action.payload.audioLive === undefined ? undefined : !!action.payload.audioLive,
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
                const a = state.arrest || initialCoreState.arrest;
                const arrestKey = action.payload.key === 'AdrenalineIV' ? 'adrenaline' : (action.payload.key === 'Amiodarone' ? 'amiodarone' : null);
                const arrestAfter = arrestKey && a.since !== null ? { ...a, [arrestKey]: [...a[arrestKey], Number(state.time) || 0] } : a;
                return { ...state, activeDrugs: [...(state.activeDrugs || []), action.payload], arrest: arrestAfter };
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
            // =================================================================================
            // WAVE 9 / ROOT FIX — THIS ACTION IS A DELTA, NOT A WHOLE-SET REPLACEMENT.
            //
            // It used to carry `{ active: <a whole new Set>, counts: <a whole new object> }`, both
            // built by applyIntervention from `stateRef.current`. stateRef only catches up in an
            // effect AFTER a commit, so TWO applyIntervention calls in the SAME tick (React 18
            // batches them into one commit) each computed their replacement set from the same
            // pre-batch snapshot, and the second dispatch silently threw away the first one's
            // addition. That is exactly how "+ INVASIVE" attached the arterial line and lost IV
            // access while still logging both. It also lost interventionCounts for every drug but
            // the last when two drugs were given in one tick.
            //
            // A delta is immune: every dispatch in the batch is folded through the reducer in
            // order, each one seeing the accumulated `state`, so nothing can be overwritten.
            // The legacy whole-set payload is still honoured for any external/older caller.
            // =================================================================================
            case 'UPDATE_INTERVENTION_STATE': {
                const p = action.payload || {};
                const isDelta = Array.isArray(p.add) || Array.isArray(p.remove) || Array.isArray(p.inc);
                if (!isDelta) return { ...state, activeInterventions: p.active, interventionCounts: p.counts };
                const nextActive = new Set(state.activeInterventions);
                (p.add || []).forEach(k => nextActive.add(k));
                (p.remove || []).forEach(k => nextActive.delete(k));
                const nextCounts = { ...state.interventionCounts };
                (p.inc || []).forEach(k => { nextCounts[k] = (nextCounts[k] || 0) + 1; });
                return { ...state, activeInterventions: nextActive, interventionCounts: nextCounts };
            }
            // =================================================================================
            // WAVE 9 — ATOMIC BATCH ATTACH. One press = ONE reducer action, however many sensors
            // it puts on. The controller's "+ Invasive" and "Attach standard" buttons, the
            // PROCEDURES monitoring cards and the individual chips all come through here, so no
            // attach path can ever again lose a sensor to batching.
            //
            // Capnography is part of the same action rather than a separate TOGGLE_ETCO2 dispatch,
            // and it is SET rather than toggled — pressing "+ Invasive" twice in one tick can no
            // longer turn the capnograph back off.
            // =================================================================================
            case 'ATTACH_SENSORS': {
                const p = (action.payload && typeof action.payload === 'object' && !Array.isArray(action.payload)) ? action.payload : { keys: action.payload };
                const keys = (Array.isArray(p.keys) ? p.keys : (p.keys ? [p.keys] : [])).filter(k => k && k !== 'ToggleETCO2');
                const next = new Set(state.activeInterventions);
                keys.forEach(k => next.add(k));
                // Durations are started in the same action, so the PROCEDURES card countdown cannot
                // disagree with the chip either.
                const durs = { ...state.activeDurations };
                keys.forEach(k => {
                    const d = INTERVENTIONS[k] && INTERVENTIONS[k].duration;
                    if (d && !durs[k]) durs[k] = { startTime: state.time, duration: d };
                });
                const etco2 = p.etco2 === undefined ? state.etco2Enabled : !!p.etco2;
                return { ...state, activeInterventions: next, activeDurations: durs, etco2Enabled: etco2 };
            }
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
            // WAVE 9: ONE implementation, taking a LIST. 'DETACH_SENSOR' (one key) is now literally
            // 'DETACH_SENSORS' with a single-element list, so a batch detach expands the 'Obs'
            // shorthand exactly once for the whole batch and cannot lose a removal to batching
            // either — the previous code path was only safe because it happened to be dispatched
            // one key at a time.
            case 'DETACH_SENSOR':
            case 'DETACH_SENSORS': {
                const p = (action.payload && typeof action.payload === 'object' && !Array.isArray(action.payload)) ? action.payload : { keys: action.payload };
                const raw = Array.isArray(p.keys) ? p.keys : (p.keys ? [p.keys] : []);
                const dkeys = raw.filter(k => !!k);
                const next = new Set(state.activeInterventions);
                const dDurations = { ...state.activeDurations };
                const wantsEtco2Off = dkeys.indexOf('ToggleETCO2') !== -1;
                // Expand the 'Obs' shorthand ONCE, for the whole batch: every standard sensor that
                // is NOT being detached is re-added as its own key, then every requested key goes.
                const detachingObs = dkeys.indexOf('Obs') !== -1;
                const touchesStandard = detachingObs || dkeys.some(k => STANDARD_SENSOR_KEYS.indexOf(k) !== -1);
                if (touchesStandard && next.has('Obs')) {
                    next.delete('Obs');
                    delete dDurations['Obs'];
                    if (!detachingObs) STANDARD_SENSOR_KEYS.forEach(k => { if (dkeys.indexOf(k) === -1) next.add(k); });
                }
                dkeys.forEach(dkey => {
                    if (dkey === 'Obs') {
                        next.delete('Obs');
                        STANDARD_SENSOR_KEYS.forEach(k => { next.delete(k); delete dDurations[k]; });
                    } else {
                        next.delete(dkey);
                    }
                    delete dDurations[dkey];
                });
                const dStopped = (state.activeDrugs || []).map(d => (dkeys.indexOf(d.key) !== -1 && d.sustained && d.stopTime < 0) ? { ...d, stopTime: state.time } : d);
                return { ...state, activeInterventions: next, activeDurations: dDurations, activeDrugs: dStopped,
                         etco2Enabled: wantsEtco2Off ? false : state.etco2Enabled };
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

    window.__EngineReducers = { coreReducer, logReducer, scenarioReducer, vitalsReducer };
})();
