(() => {
    // THE SIMULATION ENGINE, PART 3 OF 3: useSimulation, the hook every screen runs. The model
    // (engine-model.js) and reducers (engine-reducers.js) load first.
    const { useState, useEffect, useRef, useReducer } = React;
    const { INTERVENTIONS, calculateDynamicVbg, getRandomInt, clamp } = window;

    // WAVE 3 / C1: the single shared rhythm registry. Every shockability, pulseless and
    // "is this an arrest?" decision in this file now goes through RG. The previous hardcoded
    // arrays (two shockability lists, seven arrest lists) are gone.
    const RG = window.RHYTHMS;
    if (!RG) throw new Error('data/rhythms.js must load before data/engine.js');
    const {
        DEFAULT_VITALS, INVASIVE_SENSOR_KEYS, OBJECTIVE_TRIGGERS, SENSOR_DEFS, STANDARD_SENSOR_KEYS,
        VENTILATOR_RATE, VOLUME_KEYS, ageBandOf, applyRhythmHrBand, buildDrugEntry, clampVital,
        fluidResponsiveness, getObstruction, getSensors, getUnmetExpectations, initialCoreState,
        initialLogState, initialScenarioState, initialVitalsState, isDrugSpent, isVentilated,
        normaliseDeteriorationType, paediatricFieldScale, pkFactor, pkPhase, pkRemaining,
        newRunId, sanitizeForRealtimeDatabase, scenarioText, tickActionFor
    } = window.__EngineModel;
    const { coreReducer, logReducer, scenarioReducer, vitalsReducer } = window.__EngineReducers;

    const useSimulation = (initialScenario, isMonitorMode = false, sessionID = null) => {
        const [vitalsState, rawDispatchVitals] = useReducer(vitalsReducer, initialVitalsState);
        const [logState, rawDispatchLog] = useReducer(logReducer, initialLogState);
        const [scenarioState, rawDispatchScenario] = useReducer(scenarioReducer, initialScenarioState);
        const [coreState, rawDispatchCore] = useReducer(coreReducer, initialCoreState);

        const state = { ...vitalsState, ...logState, ...scenarioState, ...coreState };

        // ---- stateRef IS ALWAYS CURRENT ------------------------------------------------------------
        // Engine functions read the latest state through stateRef, but React only re-renders after an
        // event handler or timer has finished, so two dispatches in the same moment used to see the
        // state from BEFORE the first one (three quick doses all counted as dose 1; a rhythm change
        // followed by an obs write could undo itself). Every dispatch therefore also runs the same
        // pure reducer on a shadow copy and updates stateRef at once. React's own result replaces
        // the shadow at the next render, so the two can differ at most by a timestamp.
        const REDUCERS = { vitals: vitalsReducer, log: logReducer, scenario: scenarioReducer, core: coreReducer };
        const renderedRef = useRef(null);
        const shadowRef = useRef(null);
        renderedRef.current = { vitals: vitalsState, log: logState, scenario: scenarioState, core: coreState };
        shadowRef.current = null;
        const applyShadow = (key, action) => {
            const base = shadowRef.current || renderedRef.current;
            let next = base[key];
            try { next = REDUCERS[key](base[key], action); } catch (e) { /* React will surface it */ }
            const s = { ...base, [key]: next };
            shadowRef.current = s;
            stateRef.current = { ...s.vitals, ...s.log, ...s.scenario, ...s.core };
        };
        const dispatchVitals = (a) => { applyShadow('vitals', a); rawDispatchVitals(a); };
        const dispatchLog = (a) => { applyShadow('log', a); rawDispatchLog(a); };
        const dispatchScenario = (a) => { applyShadow('scenario', a); rawDispatchScenario(a); };
        const dispatchCore = (a) => { applyShadow('core', a); rawDispatchCore(a); };
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
            // A new run's id is decided here, once, so the shadow copy and React agree on it.
            if ((action.type === 'LOAD_SCENARIO' || action.type === 'RESTORE_SESSION') && !action.runId) action = { ...action, runId: newRunId() };
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
                    const pp = data.payload || {};
                    dispatch({ type: 'UPDATE_PACER_STATE', payload: { rate: Number(pp.rate) || 0, output: Number(pp.output) || 0, demand: pp.demand !== false } });
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
                    // Judged by the controller from its own rhythm, exactly as over Firebase.
                    analyseRhythm('student (standalone defib)');
                } else if (data.type === 'LEAD_CHANGE') {
                    addLogEntry(`Monitoring lead changed to ${String(data.payload?.lead || '?').slice(0, 8)} (standalone defib)`, 'action');
                } else if (data.type === 'SIZE_CHANGE') {
                    addLogEntry(`ECG size x${Number(data.payload?.gain) || 1} (standalone defib)`, 'info');
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
                    // Logged like the Firebase path, so the debrief sees the same record either way.
                    setDefibMode(data.payload.mode, 'student (standalone defib)');
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
        // What the learner's defib is allowed to show. Pulse-check results and RCUK hints are an
        // Education-mode aid in Defib Sim only (a real defibrillator tells you neither).
        const defibViewFor = (cur) => {
            const ds = cur.scenario && cur.scenario.defibSim;
            const edu = !!(ds && ds.mode !== 'assessment');
            return { defibSim: !!ds, pulseFeedback: edu, hints: edu, metronome: !!cur.metronomeOn };
        };
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
                defib: cur.defib || {},
                noise: cur.noise || {},
                pacing: { electrical: !!(cur.pacing && cur.pacing.electrical), mechanical: !!(cur.pacing && cur.pacing.mechanical) },
                defibView: defibViewFor(cur)
            };
        };
        const buildDefibSyncPayloadRef = useRef(buildDefibSyncPayload);
        buildDefibSyncPayloadRef.current = buildDefibSyncPayload;

        useEffect(() => {
            if (!isMonitorMode) {
                postToChannel({ type: 'SYNC_VITALS', payload: buildDefibSyncPayload() });
            }
        }, [state.vitals, state.rhythm, state.waveformGain, state.noise, state.pacingThreshold, state.audioOutput,
            state.cprInProgress, state.isRunning, state.isFinished, state.scenario, state.defib, state.pacing, state.metronomeOn]);

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
            // The patient lives under sessions/<CODE>/live, apart from the device channels
            // (presence, deviceEvents, deviceState, command), so a device's heartbeat or a defib
            // screen update does not re-deliver the whole patient to every monitor.
            const sessionRef = db.ref(`sessions/${sessionID}/live`);

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
                    // The defib tablet's pulse-check result (Education) and pacing capture state.
                    pacing: { electrical: !!(cur.pacing && cur.pacing.electrical), mechanical: !!(cur.pacing && cur.pacing.mechanical) },
                    defibView: defibViewFor(cur),
                    monitorPopup: cur.monitorPopup, waveformGain: cur.waveformGain,
                    noise: cur.noise, notification: cur.notification,
                    remotePacerState: cur.remotePacerState, pacingThreshold: cur.pacingThreshold,
                    showWetflag: cur.showWetflag, co2Pathology, co2Severity,
                    // Top-level keys only — the write diff is shallow and per-key. Never undefined.
                    isRunning: !!cur.isRunning, audioLive: isAudioLive(cur), isMuted: !!cur.isMuted,
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
                    pocReadings: cur.pocReadings || {},
                    // SESSION HYGIENE: when this session last carried live data, rounded to the minute
                    // so it adds at most one tiny write a minute. RTDB cannot expire data on its own;
                    // a scheduled cleanup job (see README) deletes sessions whose updatedAt is old.
                    updatedAt: Math.floor(Date.now() / 60000) * 60000
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
            state.defibPanelOpen, state.defib, state.pacing, state.metronomeOn
        ]);

        useEffect(() => {
            const db = window.db; 
            if (!db || !sessionID || !isMonitorMode) return; 
            const sessionRef = db.ref(`sessions/${sessionID}/live`);
            const handleUpdate = (snapshot) => { 
                const data = snapshot.val(); 
                // A session holding only presence (a monitor or defib that joined before the
                // controller published anything) has no patient yet: keep waiting rather than
                // applying an empty patient, which crashed the monitor.
                if (data && data.vitals) { 
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
                const where = ev.device === 'standalone-defib' ? 'standalone defib' : 'monitor defib';
                const src = `student (${where})`;
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
                    case 'PACER_UPDATE': dispatch({ type: 'UPDATE_PACER_STATE', payload: { rate: Number(p.rate) || 0, output: Number(p.output) || 0, demand: p.demand !== false } }); break;
                    case 'CHECK_PULSE': addLogEntry(`Student checked pulse (${where})`, 'action'); break;
                    case 'CPR_TOGGLE': toggleCPR(!!p.on, src); break;
                    case 'MARKER_EVENT': addLogEntry(`Student marked event (${where})`, 'manual', true); break;
                    case 'ALARM_SILENCE': addLogEntry(`Alarm silenced by student (${where})`, 'info'); break;
                    case 'REQUEST_12LEAD': addLogEntry(`Student requested 12-lead (${where})`, 'action'); break;
                    case 'LEAD_CHANGE': addLogEntry(`Monitoring lead changed to ${String(p.lead || '?').slice(0, 8)} (${where})`, 'action'); break;
                    case 'SIZE_CHANGE': addLogEntry(`ECG size x${Number(p.gain) || 1} (${where})`, 'info'); break;
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

        // What each defib tablet is displaying, so a remote facilitator sees the device.
        useEffect(() => {
            const db = window.db;
            if (!db || !sessionID || isMonitorMode) return;
            const ref = db.ref(`sessions/${sessionID}/deviceState`);
            const onVal = (snap) => {
                const v = snap.val() || {};
                const now = Date.now();
                const fresh = {};
                Object.keys(v).forEach(k => { if (v[k] && Number(v[k].ts) > now - 60000) fresh[k] = v[k]; });
                dispatch({ type: 'SET_DEVICE_MIRROR', payload: fresh });
            };
            ref.on('value', onVal, () => {});
            return () => ref.off('value', onVal);
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
                        defib: cur.defib, lastConversion: cur.lastConversion, defibSettings: cur.defibSettings,
                        arrest: cur.arrest, defibStep: cur.defibStep
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
        // Should the pulse tone and physiological alarms sound at all? Normally only while the clock
        // runs. Quick Sim is different: it is driven without ever pressing START (the trace already
        // runs before START), so there the monitor is audible until the facilitator deliberately
        // PAUSES or finishes — the same rule the waveform strip uses. The team monitor cannot see
        // `pausedAt`, so the controller publishes the answer as `audioLive`.
        const isAudioLive = (current) => {
            if (isMonitorMode && current.audioLive !== undefined) return !!current.audioLive;
            if (current.isRunning) return true;
            const paused = current.pausedAt !== null && current.pausedAt !== undefined;
            return !!(current.scenario && current.scenario.quickSim && !paused && !current.isFinished);
        };
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

                if (!isAudioLive(current)) { retry(1000); return; }
                if (current.vitals.hr <= 0 || SILENT_RHYTHMS.includes(current.rhythm)) { retry(1000); return; }
                // Follows the INDIVIDUAL sensors, not the 'Obs' shorthand: detaching one standard
                // sensor expands 'Obs' into its individual keys, so keying on 'Obs' silenced the beep
                // as soon as anything was removed, and a lone SpO2 probe never beeped at all.
                // The pulse tone comes from the SpO2 probe or, with no probe on, the ECG (QRS tone).
                const beepSensors = getSensors(current);
                if (!beepSensors.spo2 && !beepSensors.ecg) { retry(1000); return; }

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
                        // Pitch tracks saturation only when a probe is actually measuring it.
                        if (!beepSensors.spo2) freq = 800;
                        else if (spO2 >= 85) freq = 400 + ((spO2 - 85) * (400 / 15));
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
            if (!isAudioLive(current) || current.isMuted) return;
            if (!isAudioRouted(current)) return;
            // Each alarm is watched only by the sensor that measures it — same rule as the beep.
            // (This used to key on the 'Obs' shorthand, which disappears as soon as any single
            // standard sensor is detached, so removing one probe silenced every alarm.)
            const alarmSensors = getSensors(current);
            const pulseWatched = alarmSensors.ecg || alarmSensors.spo2;
            if (!pulseWatched) return;
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
            if (alarmSensors.spo2 && v.spO2 < th.spO2) fire('spO2', 'critical');
            // Respiratory rate is chest-wall impedance off the ECG electrodes.
            if (alarmSensors.ecg && (v.rr < th.rr.low || v.rr > th.rr.high)) fire('rr', 'alert');
        }, [state.vitals.hr, state.vitals.spO2, state.vitals.rr, state.rhythm, state.isRunning, state.isMuted, state.audioOutput, isMonitorMode, state.activeInterventions, state.audioLive, state.pausedAt]);
        
        // Auto mode only measures while a cuff is actually on (it resumes when the cuff goes back on).
        useEffect(() => {
            if (state.nibp.mode === 'auto' && state.nibp.timer <= 0 && state.isRunning && !state.nibp.inflating && getSensors(state).nibp) { dispatch({ type: 'START_NIBP' }); }
        }, [state.nibp.timer, state.nibp.mode, state.isRunning, state.nibp.inflating, state.activeInterventions]);
        // The measurement itself: ~5 s of inflation, then the reading is committed. This is its OWN
        // effect, keyed only on `inflating`. It used to share the auto-trigger effect above, whose
        // dependencies include the auto-mode countdown — which changes every second while the sim
        // runs — so each tick cancelled the commit and restarted the inflation sound, and an
        // auto-mode reading never completed.
        useEffect(() => {
            if (!state.nibp.inflating) return;
            playInflationSound();
            const timeout = setTimeout(() => { dispatch({ type: 'COMMIT_NIBP' }); }, 5000);
            return () => clearTimeout(timeout);
        }, [state.nibp.inflating]);
        
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
                if (key === 'Adenosine') addLogEntry(`Paediatric adenosine (RCUK/ERC 2025): 0.1-0.2 mg/kg${wt ? ` (${Math.round(0.1 * wt * 10) / 10}-${Math.round(0.2 * wt * 10) / 10} mg)` : ''}, max 6 mg, as a rapid flush into a large vein with a 12-lead running; if SVT persists after at least 1 min, 0.3 mg/kg${wt ? ` (${Math.round(0.3 * wt * 10) / 10} mg)` : ''}, max 12-18 mg. Neonates start at 150 mcg/kg.`, 'info');
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
            // A heart-rate drug works differently in different rhythms: atropine barely moves a
            // broad escape rhythm, isoprenaline does (RHYTHMS.drugHrResponse).
            const hrResponse = RG.drugHrResponse(key, cur.rhythm);
            if (hrResponse !== 1) {
                entryOpts.fieldScale = { ...(entryOpts.fieldScale || {}), HR: ((entryOpts.fieldScale && entryOpts.fieldScale.HR) || 1) * hrResponse };
                if (hrResponse < 0.5) addLogEntry(`${action.label} in ${RG.labelFor(cur.rhythm)}: little rate response expected — the block/escape is below the level this drug acts on. Consider isoprenaline or adrenaline infusion as a bridge, and pacing.`, 'info');
            }
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
            // WAVE 9 / ROOT FIX: a DELTA, not the whole set/counts object. Two interventions applied
            // in the same tick (two clicks in one batch, a batch helper, or the Firebase command
            // listener firing twice) used to lose everything but the last one, because both payloads
            // were built from the same pre-commit `stateRef.current`.
            if (action.type === 'continuous') dispatch({ type: 'UPDATE_INTERVENTION_STATE', payload: { add: [key], inc: [] } });
            else dispatch({ type: 'UPDATE_INTERVENTION_STATE', payload: { add: [], inc: [key] } });

            // A point-of-care test is taken, not given.
            const isPocCheck = SENSOR_DEFS.some(d => d.kind === 'poc' && d.key === key);
            dispatch({ type: 'SET_NOTIFICATION', payload: { msg: action.label + (isPocCheck ? " checked" : " Administered"), type: 'success', id: Date.now() } });

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
                // Bradykinin-mediated angio-oedema (ACE inhibitor, hereditary) is NOT anaphylaxis:
                // adrenaline does little for it, which is the teaching point of that scenario.
                if (txt.indexOf('bradykinin') !== -1 || txt.indexOf('ace-inhibitor') !== -1 || txt.indexOf('ace inhibitor') !== -1) return false;
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
            // simply carrying on, in which case you escalate 6 → 12 → 18 mg (RCUK). Everything is resolved
            // inside ~45 s, and nothing lingers (pk offset 40 s).
            // =====================================================================================
            if (action.avBlock && !isArrest) {
                const ab = action.avBlock;
                const doseNo = count;                    // RCUK: 6 mg, then 12 mg, then 18 mg
                const doseMg = doseNo === 1 ? 6 : (doseNo === 2 ? 12 : 18);
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
            // WAVE 9 / ROOT FIX (same class): send only the fields this intervention actually
            // CHANGED. The payload is merged onto the LIVE baseVitals by the reducer, so a whole
            // snapshot-derived object here meant two instant-effect interventions in one tick
            // overwrote each other's vitals. A field-level diff composes instead.
            const vitalsDelta = {};
            Object.keys(newVitals).forEach(f => { if (newVitals[f] !== cur.baseVitals[f]) vitalsDelta[f] = newVitals[f]; });
            // Still dispatched unconditionally (an empty delta simply recomposes the displayed
            // vitals from the live base + the drug envelope, exactly as before).
            dispatch({ type: 'UPDATE_VITALS', payload: vitalsDelta });
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
                    if (val.type === 'STOP_NIBP') dispatch({ type: 'STOP_NIBP' });
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

        // ---- Shock-response settings (state.defibSettings). ----------------------------------
        const shockPolicy = (cur) => (cur.defibSettings && cur.defibSettings.shockResponse) || 'model';
        // How many ADEQUATE shocks this rhythm needs before it converts, or null for "never".
        // 'auto' uses the scenario's own number when it sets one (scenario.shockToConvert).
        const shocksRequired = (cur, isArrest) => {
            const pol = shockPolicy(cur);
            if (pol === 'never') return null;
            if (/^[1-5]$/.test(pol)) return Number(pol);
            const sc = Number(cur.scenario && cur.scenario.shockToConvert);
            return Number.isFinite(sc) && sc > 0 ? sc : (isArrest ? 3 : 1);
        };
        // Is `key` pharmacologically on board right now (a dose given and not yet worn off)?
        const drugOnBoard = (cur, key) => (cur.activeDrugs || []).some(d => d.key === key && !isDrugSpent(d, cur.time));
        // Where a fixed-count shockable arrest converts to (scenario.successRhythm if it names one).
        const roscTargetFor = (cur, fromRhythm) => {
            const named = cur.scenario && cur.scenario.successRhythm;
            if (named && RG.isKnown(named) && !RG.isPulseless(named)) return RG.canonical(named);
            const table = RG.SHOCK_OUTCOMES[RG.canonical(fromRhythm)] || RG.SHOCK_OUTCOMES['VF'];
            return RG.weightedPick(table.rosc);
        };
        // "VF recurs once": 30-90 s after ROSC, if the patient is still in the rhythm they converted to.
        const scheduleFixedRefib = (convertedTo) => {
            if (refibTimerRef.current) clearTimeout(refibTimerRef.current);
            dispatch({ type: 'SET_DEFIB_STATE', payload: { refibDone: true } });
            refibTimerRef.current = setTimeout(() => {
                refibTimerRef.current = null;
                const now = stateRef.current;
                if (!now || now.isFinished || RG.canonical(now.rhythm) !== RG.canonical(convertedTo)) return;
                dispatch({ type: 'UPDATE_VITALS', payload: arrestVitals(now.baseVitals) });
                changeRhythm('VF', 'refibrillation', { note: 're-arrest after ROSC' });
                addLogEntry('VF has recurred after ROSC (refibrillation). Restart CPR and the shockable pathway.', 'danger', true);
                dispatch({ type: 'SET_FLASH', payload: 'red' });
            }, 30000 + Math.random() * 60000);
        };
        const afterShockRosc = (cur, fromRhythm, convertedTo) => {
            const refib = (cur.defibSettings && cur.defibSettings.refib) || 'model';
            if (refib === 'model') scheduleRefibrillation(fromRhythm);
            else if (refib === 'once' && !(cur.defib && cur.defib.refibDone)) scheduleFixedRefib(convertedTo);
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
                // An UNSYNCHRONISED shock into a rhythm WITH A PULSE can land on the T wave and
                // cause VF (R-on-T). Whether it does is the facilitator's setting.
                const perfusing = !RG.isPulseless(cur.rhythm) && RG.rWavePhase(cur.rhythm, cur.vitals && cur.vitals.hr, 0) !== null;
                const rOnT = (cur.defibSettings && cur.defibSettings.rOnT) || 'never';
                const causesVf = perfusing && !sync && (rOnT === 'always' || (rOnT === 'sometimes' && Math.random() < 1 / 3));
                if (causesVf) {
                    addLogEntry(`UNSYNCHRONISED shock delivered into ${RG.labelFor(cur.rhythm)} landed on the T wave — VF induced (R-on-T). A patient with a pulse needs SYNCHRONISED cardioversion.`, 'danger', true,
                        { action: 'Defib', label: 'Defibrillation', missing: ['synchronisation'] });
                    dispatch({ type: 'UPDATE_VITALS', payload: arrestVitals(cur.baseVitals), releaseManual: RESET_HOLD_KEYS });
                    changeRhythm('VF', 'defibrillation (R-on-T)', { energy: joules, sync: false });
                    dispatch({ type: 'SET_FLASH', payload: 'red' });
                    return;
                }
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

            const fromRhythm = RG.canonical(cur.rhythm);
            const policy = shockPolicy(cur);

            // --- FIXED-COUNT POLICIES ('auto', '1'-'5', 'never'): an adequate shock advances the
            // episode count, and the rhythm converts when the count is reached.
            if (policy !== 'model') {
                const adequate = RG.adequateShock(joules, defibWeight(), cur.scenario?.patientAge, 'arrest');
                if (!adequate) {
                    dispatch({ type: 'SET_DEFIB_STATE', payload: nextDefib });
                    changeRhythm(cur.rhythm, 'defibrillation', { energy: joules, sync: false, note: 'energy too low to defibrillate — resume CPR' });
                    addLogEntry(`Shock at ${joules}J is below the energy needed to defibrillate this patient (${RG.isAdult(defibWeight(), cur.scenario?.patientAge) ? 'at least 150 J' : 'at least 3 J/kg'}). Resume CPR and select a higher energy.`, 'warning', true,
                        { action: 'Defib', label: 'Defibrillation', missing: ['adequate energy'] });
                    return;
                }
                nextDefib.episodeShocks = (d.episodeShocks || 0) + 1;
                dispatch({ type: 'SET_DEFIB_STATE', payload: nextDefib });
                if (cur.queuedRhythm) {
                    const q = RG.canonical(cur.queuedRhythm);
                    dispatch({ type: 'SET_QUEUED_RHYTHM', payload: null });
                    if (RG.isPulseless(q)) {
                        dispatch({ type: 'UPDATE_VITALS', payload: arrestVitals(cur.baseVitals) });
                        changeRhythm(q, 'defibrillation (facilitator override)', { energy: joules });
                    } else {
                        triggerROSC(q, 'defibrillation (facilitator override)', { energy: joules });
                        afterShockRosc(cur, fromRhythm, q);
                    }
                    return;
                }
                const required = shocksRequired(cur, true);
                if (required !== null && nextDefib.episodeShocks >= required) {
                    const target = roscTargetFor(cur, fromRhythm);
                    triggerROSC(target, 'defibrillation', { energy: joules, sync: false });
                    afterShockRosc(cur, fromRhythm, target);
                } else {
                    changeRhythm(cur.rhythm, 'defibrillation', { energy: joules, sync: false, note: 'no change — resume CPR' });
                    addLogEntry('No change after shock. Resume compressions immediately, 2-minute cycle, consider escalating energy.', 'warning');
                }
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

            const table = RG.SHOCK_OUTCOMES[fromRhythm] || RG.SHOCK_OUTCOMES['VF'];
            if (Math.random() < roscChance) {
                const target = RG.weightedPick(table.rosc);
                // Banked drug bonus is consumed by a successful shock.
                dispatch({ type: 'SET_DEFIB_STATE', payload: { shockBonus: 0 } });
                triggerROSC(target, 'defibrillation', { energy: joules, sync: false });
                afterShockRosc(cur, fromRhythm, target);
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
            const nextDefib = {
                shockCount: (d.shockCount || 0) + 1,
                totalEnergy: (d.totalEnergy || 0) + joules,
                lastEnergy: joules, lastShockAt: now, charged: false, chargeEnergy: null, syncMode: true
            };

            const dev = RG.energyDeviation(joules, defibWeight(), cur.scenario?.patientAge);
            if (dev) addLogEntry(`Cardioversion energy deviation: ${dev.reason}. Recommended: ${dev.expected}J.`, 'warning', true,
                { action: 'Cardioversion', label: 'Synchronised Cardioversion', missing: [`correct energy (${dev.expected}J)`] });

            if (RG.isPulseless(cur.rhythm)) {
                dispatch({ type: 'SET_DEFIB_STATE', payload: nextDefib });
                // Never blocked — flagged. A defibrillator in SYNC mode will not discharge into VF,
                // and that is itself the teaching point.
                addLogEntry(`SYNC mode armed in ${RG.labelFor(cur.rhythm)} — a real defibrillator will not discharge in SYNC without an R wave. Switch to unsynchronised defibrillation. Flagged.`, 'danger', true,
                    { action: 'Cardioversion', label: 'Synchronised Cardioversion', missing: ['unsynchronised mode for a pulseless rhythm'] });
                changeRhythm(cur.rhythm, 'cardioversion', { energy: joules, sync: true, note: 'no R wave, device would not fire' });
                return;
            }
            if (!RG.isSyncCardiovertible(cur.rhythm)) {
                dispatch({ type: 'SET_DEFIB_STATE', payload: nextDefib });
                addLogEntry(`Synchronised shock delivered into ${RG.labelFor(cur.rhythm)} — cardioversion is not indicated for this rhythm. Flagged.`, 'warning', true,
                    { action: 'Cardioversion', label: 'Synchronised Cardioversion', missing: ['an indication for cardioversion'] });
                changeRhythm(cur.rhythm, 'cardioversion', { energy: joules, sync: true, note: 'not indicated, no change' });
                return;
            }

            // The rhythm FIRST (it brings the new rhythm's rate band), then any obs the scenario names.
            // In the other order the rhythm change, which reads the pre-shock state, put the
            // tachycardic rate back: "Sinus Rhythm" at 190/min.
            const convertToSinus = () => {
                const sv = cur.scenario && cur.scenario.successVitals;
                const named = cur.scenario && cur.scenario.successRhythm;
                const target = named && RG.isKnown(named) && !RG.isPulseless(named) ? RG.canonical(named) : 'Sinus Rhythm';
                changeRhythm(target, 'cardioversion', { energy: joules, sync: true });
                if (sv && typeof sv === 'object') {
                    const vit = {};
                    ['hr', 'bpSys', 'bpDia', 'spO2', 'rr', 'etco2'].forEach(k => { if (Number.isFinite(Number(sv[k]))) vit[k] = Number(sv[k]); });
                    if (Object.keys(vit).length) dispatch({ type: 'UPDATE_VITALS', payload: vit });
                }
            };

            if (shockPolicy(cur) !== 'model') {
                if (!RG.adequateShock(joules, defibWeight(), cur.scenario?.patientAge, 'cardiovert')) {
                    dispatch({ type: 'SET_DEFIB_STATE', payload: nextDefib });
                    changeRhythm(cur.rhythm, 'cardioversion', { energy: joules, sync: true, note: 'energy too low to cardiovert' });
                    return;
                }
                nextDefib.episodeShocks = (d.episodeShocks || 0) + 1;
                dispatch({ type: 'SET_DEFIB_STATE', payload: nextDefib });
                const required = shocksRequired(cur, false);
                if (required !== null && nextDefib.episodeShocks >= required) convertToSinus();
                else changeRhythm(cur.rhythm, 'cardioversion', { energy: joules, sync: true, note: 'unsuccessful — escalate energy, check sedation and synchronisation' });
                return;
            }

            dispatch({ type: 'SET_DEFIB_STATE', payload: nextDefib });
            // Success depends on the rhythm and on adequate energy.
            const baseSuccess = { 'SVT': 0.85, 'VT': 0.80, 'AF': 0.6, 'Atrial Flutter': 0.9 }[RG.canonical(cur.rhythm)] || 0.7;
            const expected = recommendedShockEnergy();
            const energyFactor = Math.max(0.5, Math.min(1.1, joules / Math.max(1, expected)));
            if (Math.random() < baseSuccess * energyFactor) {
                convertToSinus();
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
            // E2: adenosine's success probability escalates with the 6 → 12 → 18 mg sequence, so the
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
            if (stepsRunning(cur)) { customStepShock(cur, j, sync); return; }
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
            defibStepTrigger('analyse');
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

        // =====================================================================================
        // DEFIB SIM CUSTOM SCENARIOS. The facilitator's sequence of rhythms decides what happens:
        // each step moves on at its trigger (a rhythm analysis, a shock, pacing capture or a
        // timer). While a sequence runs, a shock never converts the rhythm by itself — only a
        // step whose trigger is "shock" moves on (and a shock on the LAST such step converts to
        // sinus rhythm), exactly as in the standalone Defib-sim.
        // =====================================================================================
        const DEFIB_TRIGGER_LABELS = { analyse: 'on analyse', shock: 'on shock', capture: 'on pacing capture', timer_30: 'after 30 s', timer_60: 'after 60 s', timer_120: 'after 2 min' };
        const defibSteps = (cur) => (cur.scenario && cur.scenario.defibSim && Array.isArray(cur.scenario.defibSim.steps)) ? cur.scenario.defibSim.steps : [];
        const stepsRunning = (cur) => !!(cur.defibStep && !cur.defibStep.done && defibSteps(cur).length);
        const goToDefibStep = (index, cause = 'facilitator') => {
            const cur = stateRef.current;
            const steps = defibSteps(cur);
            if (!steps.length) return;
            const i = Math.max(0, Math.floor(Number(index) || 0));
            if (i >= steps.length) {
                dispatch({ type: 'SET_DEFIB_STEP', payload: { index: steps.length, since: Number(cur.time) || 0, done: true } });
                addLogEntry(`Custom scenario complete (${cause}).`, 'success');
                return;
            }
            const step = steps[i];
            const to = RG.canonical(step.rhythm);
            dispatch({ type: 'SET_DEFIB_STEP', payload: { index: i, since: Number(cur.time) || 0, done: false } });
            addLogEntry(`Custom scenario: step ${i + 1}/${steps.length} — ${RG.labelFor(to)} (moves on ${DEFIB_TRIGGER_LABELS[step.trigger] || step.trigger}; ${cause})`, 'system');
            if (to === RG.canonical(cur.rhythm)) return;
            if (RG.isPulseless(to) && !RG.isPulseless(cur.rhythm)) triggerArrest(to, `custom scenario step ${i + 1}`);
            else if (!RG.isPulseless(to) && RG.isPulseless(cur.rhythm)) triggerROSC(to, `custom scenario step ${i + 1}`);
            else changeRhythm(to, `custom scenario step ${i + 1}`);
        };
        const defibStepTrigger = (kind) => {
            const cur = stateRef.current;
            if (!stepsRunning(cur)) return;
            const step = defibSteps(cur)[cur.defibStep.index];
            if (step && step.trigger === kind) goToDefibStep(cur.defibStep.index + 1, DEFIB_TRIGGER_LABELS[kind] || kind);
        };
        // A shock while a sequence runs: counted, logged, and it moves the sequence on only when the
        // current step says so.
        const customStepShock = (cur, joules, sync) => {
            const d = cur.defib || {};
            dispatch({ type: 'SET_DEFIB_STATE', payload: { shockCount: (d.shockCount || 0) + 1, totalEnergy: (d.totalEnergy || 0) + joules, lastEnergy: joules, lastShockAt: Date.now(), charged: false, chargeEnergy: null } });
            const steps = defibSteps(cur);
            const index = cur.defibStep.index;
            const step = steps[index];
            if (!step || step.trigger !== 'shock') {
                changeRhythm(cur.rhythm, 'defibrillation', { energy: joules, sync, note: 'no change (custom scenario step)' });
                return;
            }
            setTimeout(() => {
                const now = stateRef.current;
                if (!now.defibStep || now.defibStep.done || now.defibStep.index !== index) return;
                if (index + 1 >= steps.length) {
                    dispatch({ type: 'SET_DEFIB_STEP', payload: { index: steps.length, since: Number(now.time) || 0, done: true } });
                    if (RG.isPulseless(now.rhythm)) triggerROSC('Sinus Rhythm', 'defibrillation (custom scenario)', { energy: joules });
                    else changeRhythm('Sinus Rhythm', 'cardioversion (custom scenario)', { energy: joules, sync });
                    addLogEntry('Custom scenario complete: the final shock converted the rhythm.', 'success');
                    return;
                }
                goToDefibStep(index + 1, 'on shock');
            }, 1000);
        };
        // Timer steps run on the sim clock, so they pause with the scenario.
        useEffect(() => {
            if (isMonitorMode) return;
            const cur = stateRef.current;
            if (!stepsRunning(cur) || !cur.isRunning) return;
            const step = defibSteps(cur)[cur.defibStep.index];
            const m = /^timer_(\d+)$/.exec((step && step.trigger) || '');
            if (m && (Number(cur.time) || 0) - (Number(cur.defibStep.since) || 0) >= Number(m[1])) goToDefibStep(cur.defibStep.index + 1, DEFIB_TRIGGER_LABELS[step.trigger]);
        }, [isMonitorMode, state.time]);

        // =====================================================================================
        // TRANSCUTANEOUS PACING, AS THE DEVICE DELIVERS IT.
        // With the defibrillator in PACER mode, capture is re-evaluated whenever the output, rate,
        // threshold or underlying rhythm changes:
        //   * ELECTRICAL capture at the threshold: every spike is followed by a broad complex, the
        //     monitor rate becomes the paced rate — but the circulation has not improved yet.
        //   * MECHANICAL capture ~10 mA above it: a palpable pulse at the paced rate, BP and
        //     saturation improve.
        // Demand mode is inhibited while the patient's own rate is at or above the set rate.
        // Losing capture (or leaving PACER mode) restores the underlying rhythm and obs.
        // =====================================================================================
        const MECHANICAL_MARGIN_MA = 10;
        useEffect(() => {
            if (isMonitorMode) return;
            const cur = stateRef.current;
            const pacing = cur.pacing || {};
            const mode = cur.defib && cur.defib.mode;
            const pacer = cur.remotePacerState || {};
            const rate = Number(pacer.rate) || 0, output = Number(pacer.output) || 0;
            const demand = pacer.demand !== false;
            // The facilitator changed the rhythm under an established capture: that is the new
            // underlying rhythm, and the capture has to be earned again.
            if (pacing.electrical && RG.canonical(cur.rhythm) !== 'Paced') {
                dispatch({ type: 'SET_PACING', payload: { electrical: false, mechanical: false, underlying: null, pre: null } });
                return;
            }
            const underlying = pacing.electrical ? pacing.underlying : RG.canonical(cur.rhythm);
            const ownRate = pacing.electrical ? ((pacing.pre && pacing.pre.hr) || 0) : ((cur.vitals && cur.vitals.hr) || 0);
            const threshold = Number(cur.pacingThreshold) || 70;
            const on = mode === 'pacer' && rate > 0 && output > 0;
            const capable = RG.PACEABLE.indexOf(RG.canonical(underlying)) !== -1;
            const inhibited = demand && ownRate >= rate;
            const electrical = on && capable && !inhibited && output >= threshold;
            const mechanical = electrical && output >= threshold + MECHANICAL_MARGIN_MA;

            if (electrical && !pacing.electrical) {
                const v = cur.baseVitals || {};
                const pre = { hr: v.hr, bpSys: v.bpSys, bpDia: v.bpDia, spO2: v.spO2 };
                dispatch({ type: 'SET_PACING', payload: { electrical: true, mechanical: false, underlying: RG.canonical(underlying), pre } });
                changeRhythm('Paced', 'pacing', { note: `electrical capture at ${output}mA, ${rate}/min` });
                dispatch({ type: 'UPDATE_VITALS', payload: { hr: rate } });
                addLogEntry(`Pacing: ELECTRICAL capture at ${output}mA, ${rate}/min. Confirm MECHANICAL capture — a palpable pulse at the paced rate. Pacing hurts: give analgesia and sedation.`, 'success');
                // After this render, so the step's rhythm follows the capture rather than racing it.
                setTimeout(() => defibStepTrigger('capture'), 0);
                return;
            }
            if (!electrical && pacing.electrical) {
                const pre = pacing.pre || {};
                dispatch({ type: 'SET_PACING', payload: { electrical: false, mechanical: false, underlying: null, pre: null } });
                changeRhythm(pacing.underlying || 'Sinus Rhythm', 'pacing', { note: mode === 'pacer' ? 'capture lost' : 'pacing stopped' });
                const restore = {};
                ['hr', 'bpSys', 'bpDia', 'spO2'].forEach(k => { if (Number.isFinite(Number(pre[k]))) restore[k] = Number(pre[k]); });
                dispatch({ type: 'UPDATE_VITALS', payload: restore });
                addLogEntry(mode === 'pacer' ? `Pacing: capture LOST (${output}mA < threshold). Increase the output.` : 'Pacing stopped — back to the underlying rhythm.', 'warning', mode === 'pacer');
                return;
            }
            if (!electrical) return;
            const updates = {};
            if (Number((cur.baseVitals || {}).hr) !== rate) updates.hr = rate;
            if (mechanical && !pacing.mechanical) {
                const pre = pacing.pre || {};
                updates.bpSys = Math.max((Number(pre.bpSys) || 70) + 25, 95);
                updates.bpDia = Math.max((Number(pre.bpDia) || 40) + 15, 55);
                if (Number(pre.spO2) > 0) updates.spO2 = Math.max(Number(pre.spO2), 95);
                dispatch({ type: 'SET_PACING', payload: { mechanical: true } });
                addLogEntry(`Pacing: MECHANICAL capture at ${output}mA — pulse palpable at ${rate}/min, blood pressure improving.`, 'success');
            } else if (!mechanical && pacing.mechanical) {
                const pre = pacing.pre || {};
                ['bpSys', 'bpDia', 'spO2'].forEach(k => { if (Number.isFinite(Number(pre[k]))) updates[k] = Number(pre[k]); });
                dispatch({ type: 'SET_PACING', payload: { mechanical: false } });
                addLogEntry(`Pacing: mechanical capture lost at ${output}mA — electrical capture only, no pulse at the paced rate.`, 'warning', true);
            }
            if (Object.keys(updates).length) dispatch({ type: 'UPDATE_VITALS', payload: updates });
        }, [isMonitorMode, state.defib && state.defib.mode, state.remotePacerState, state.pacingThreshold, state.rhythm, state.pacing]);

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
                return;
            }
            // A custom sequence decides the rhythm itself.
            if (!stepsRunning(cur)) nonShockableRhythmCheck(cur);
        };

        // PEA and asystole have no shock to convert them: ROSC comes from good CPR, adrenaline and
        // treating the cause, and it is found at a RHYTHM CHECK.
        //   'model': a chance at each check — small on its own, better with CPR running, and much
        //            better with adrenaline on board (given in the last few minutes).
        //   'auto':  deterministic — ROSC at the SECOND rhythm check after adrenaline, provided
        //            compressions are running. Without adrenaline it does not happen.
        //   fixed shock numbers and 'never': the facilitator decides (ROSC button / override).
        const nonShockableRhythmCheck = (cur) => {
            const rid = RG.canonical(cur.rhythm);
            if (!RG.isPulseless(rid) || RG.isShockable(rid)) return;
            const pol = shockPolicy(cur);
            const adrenaline = drugOnBoard(cur, 'AdrenalineIV');
            if (pol === 'auto') {
                if (!adrenaline) {
                    addLogEntry(`Rhythm check: still ${RG.labelFor(rid)}. Adrenaline 1 mg is due as soon as possible in a non-shockable rhythm.`, 'warning');
                    return;
                }
                const checks = ((cur.defib && cur.defib.adrChecks) || 0) + 1;
                dispatch({ type: 'SET_DEFIB_STATE', payload: { adrChecks: checks } });
                if (checks >= 2 && cur.cprInProgress) {
                    triggerROSC(rid === 'PEA' ? 'Sinus Tachycardia' : 'Sinus Bradycardia', 'rhythm check', { agent: 'adrenaline and CPR' });
                } else {
                    addLogEntry(`Rhythm check: still ${RG.labelFor(rid)}${cur.cprInProgress ? '' : ' — and compressions are not running'}. Continue CPR, repeat adrenaline every 3-5 minutes, treat reversible causes.`, 'info');
                }
                return;
            }
            if (pol !== 'model') return;
            let chance = 0.03 + (cur.cprInProgress ? 0.04 : 0) + (adrenaline ? 0.14 : 0);
            if (rid === 'PEA') chance *= 1.5;
            if (rid === 'Asystole') chance *= 0.5;
            if (Math.random() < chance) {
                triggerROSC(rid === 'PEA' ? 'Sinus Tachycardia' : 'Sinus Bradycardia', 'rhythm check', { agent: adrenaline ? 'adrenaline and CPR' : 'CPR' });
            } else {
                addLogEntry(`Rhythm check: still ${RG.labelFor(rid)}.${adrenaline ? '' : ' Adrenaline improves the chance of ROSC at the next check.'}`, 'info');
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
        const stopNIBP = () => { if (!sendCommand({ type: 'STOP_NIBP' })) dispatch({ type: 'STOP_NIBP' }); };
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
        // =====================================================================================
        // WAVE 9 — EVERY BATCH ATTACH/DETACH IS ONE REDUCER ACTION.
        //
        // ROOT CAUSE of the "+ INVASIVE attaches the art line but not IV" bug: these helpers used
        // to make SEQUENTIAL applyIntervention() calls. React 18 batches everything a click handler
        // dispatches into ONE commit, and `stateRef.current` is only refreshed by an effect AFTER a
        // commit — so every call in the batch read the SAME pre-press snapshot and sent a
        // whole-replacement `activeInterventions` Set built from it. The last dispatch won and the
        // earlier attachment vanished, while BOTH log lines were still written (which is exactly
        // what the live event log showed at 00:39).
        //
        // Both halves are fixed: UPDATE_INTERVENTION_STATE is now a delta (so even sequential
        // dispatches compose), and every batch path below resolves to a SINGLE ATTACH_SENSORS /
        // DETACH_SENSORS action, decided from one snapshot and applied atomically in the reducer.
        // Each sensor is logged exactly once, only when it genuinely changed.
        // =====================================================================================
        const sensorDefFor = (idOrKey) => SENSOR_DEFS.filter(d => d.id === idOrKey || d.key === idOrKey)[0] || null;
        // 'Obs' is the long-standing SHORTHAND for the standard four (all 254 scenarios, saved
        // sessions and sync payloads use it), so it stays a first-class batch member.
        const sensorKeyOf = (idOrKey) => (idOrKey === 'Obs' ? 'Obs' : (sensorDefFor(idOrKey) || {}).key || null);
        const isSensorAttached = (s, key) => {
            if (key === 'Obs') return s.standard;
            const def = sensorDefFor(key);
            return def ? !!s[def.id] : false;
        };
        // The objective/stabiliser credit an intervention earns, factored out of applyIntervention so
        // a batched attach credits exactly what an individual press would.
        const creditIntervention = (key, scenario) => {
            const triggers = OBJECTIVE_TRIGGERS[key];
            const objList = (scenario.learningObjectives || []).concat(scenario.instructorBrief?.learningObjectives || []);
            if (triggers && objList.length) {
                objList.forEach(obj => {
                    const objLower = obj.toLowerCase();
                    if (triggers.some(kw => objLower.includes(kw))) dispatch({ type: 'COMPLETE_OBJECTIVE', payload: obj });
                });
            }
            if (scenario.stabilisers && scenario.stabilisers.includes(key)) { dispatch({ type: 'TRIGGER_IMPROVE' }); addLogEntry("Patient condition IMPROVING", "success"); }
        };
        const attachSensors = (keys) => {
            const cur = stateRef.current;
            if (!cur.scenario) {
                console.warn('attachSensors ignored: no scenario is loaded.');
                dispatch({ type: 'SET_NOTIFICATION', payload: { msg: 'No scenario loaded — load a scenario first.', type: 'danger', id: Date.now() } });
                return;
            }
            const list = (Array.isArray(keys) ? keys : [keys]).map(sensorKeyOf).filter(k => !!k);
            const s0 = getSensors(cur);
            const add = [], logs = [];
            let etco2 = null;
            list.forEach(key => {
                if (isSensorAttached(s0, key)) return;                  // already on: never logged twice
                if (add.indexOf(key) !== -1) return;                     // de-duplicated within the batch
                if (key === 'ToggleETCO2') { etco2 = true; logs.push('ETCO2 Connected'); return; }
                add.push(key);
                const def = INTERVENTIONS[key];
                logs.push((def && def.log) || `${key} attached.`);
            });
            if (!add.length && etco2 === null) {
                dispatch({ type: 'SET_NOTIFICATION', payload: { msg: 'Already attached — nothing to add.', type: 'info', id: Date.now() } });
                return;
            }
            // ONE action for the whole batch: sensor set, durations and capnography together.
            dispatch({ type: 'ATTACH_SENSORS', payload: { keys: add, etco2: etco2 === null ? undefined : etco2 } });
            logs.forEach(msg => addLogEntry(msg, 'action'));
            // Permissive as ever: an unmet expectation is FLAGGED, never blocking.
            add.forEach(key => {
                const def = INTERVENTIONS[key];
                if (!def) return;
                const missing = getUnmetExpectations(def, cur);
                if (missing.length) addLogEntry(`${def.label} performed WITHOUT: ${missing.join(', ')}`, 'warning', true, { action: key, label: def.label, missing });
                creditIntervention(key, cur.scenario);
            });
            const labels = add.map(k => (INTERVENTIONS[k] && INTERVENTIONS[k].label) || k).concat(etco2 ? ['Capnography'] : []);
            dispatch({ type: 'SET_NOTIFICATION', payload: { msg: `${labels.join(' + ')} attached`, type: 'success', id: Date.now() } });
        };
        const detachSensors = (keys) => {
            const cur = stateRef.current;
            const list = (Array.isArray(keys) ? keys : [keys]).map(sensorKeyOf).filter(k => !!k);
            const s0 = getSensors(cur);
            const remove = [];
            list.forEach(key => {
                if (!isSensorAttached(s0, key)) return;                  // already off: no phantom log
                if (remove.indexOf(key) === -1) remove.push(key);
            });
            if (!remove.length) return;
            dispatch({ type: 'DETACH_SENSORS', payload: { keys: remove } });
            remove.forEach(key => {
                const def = sensorDefFor(key);
                if (def) addLogEntry(`${def.label} removed \u2014 ${def.reveals} no longer visible to the team.`, 'action');
                else addLogEntry(`${(INTERVENTIONS[key] && INTERVENTIONS[key].label) || key} removed.`, 'action');
            });
            const labels = remove.map(k => (sensorDefFor(k) || INTERVENTIONS[k] || {}).label || k);
            dispatch({ type: 'SET_NOTIFICATION', payload: { msg: `${labels.join(' + ')} DETACHED (press again to re-attach)`, type: 'info', id: Date.now() } });
        };
        const toggleSensor = (id) => {
            const cur = stateRef.current;
            const def = SENSOR_DEFS.filter(d => d.id === id)[0];
            if (!def) { console.warn(`toggleSensor('${id}') ignored: no such sensor.`); return; }
            if (def.kind === 'poc') { applyIntervention(def.key); return; }
            const on = !!getSensors(cur)[def.id];
            if (on) detachSensors([def.key]); else attachSensors([def.key]);
        };
        // WAVE 8 / FINDING 4. The fast path attaches the STANDARD four and says so. The invasive
        // action is separate and explicitly labelled, because an arterial line, IV access and
        // capnography are deliberate clinical acts, not a default.
        // WAVE 9: both are single atomic actions.
        const attachStandardMonitoring = () => attachSensors(['Obs']);
        const attachInvasiveMonitoring = () => attachSensors(INVASIVE_SENSOR_KEYS);

        return { state, dispatch, start, pause, stop, reset, applyIntervention, addLogEntry, manualUpdateVital, triggerArrest, triggerROSC, revealInvestigation, clearInvestigation, nextCycle, enableAudio, speak, playSound, toggleAudioLoop, startTrend, triggerNIBP, stopNIBP, toggleNIBPMode, triggerAction, initCharge, deliverShock, playAlertTone,
        // Wave 3 surface
        changeRhythm, applyCardioversion: (o) => applyCardioversion(stateRef.current, o || {}),
        setDefibMode, setDefibEnergy, toggleDefibSync, analyseRhythm, setQueuedRhythm, toggleCPR,
        // Defib Sim controller
        goToDefibStep,
        setMetronome: (on) => { dispatch({ type: 'SET_METRONOME', payload: !!on }); addLogEntry(`CPR metronome ${on ? 'ON' : 'OFF'} (on the defib)`, 'system'); },
        setNoise: (patch) => {
            dispatch({ type: 'SET_NOISE', payload: patch });
            const names = { interference: 'mains interference', movement: 'movement artefact', leadoff: 'lead off' };
            Object.keys(patch || {}).forEach(k => { if (names[k]) addLogEntry(`Artefact: ${names[k]} ${patch[k] ? 'ON' : 'OFF'}`, 'system'); });
        },
        setDefibSettings: (patch) => { dispatch({ type: 'SET_DEFIB_SETTINGS', payload: patch }); addLogEntry(`Shock response settings: ${Object.keys(patch || {}).map(k => `${k} = ${patch[k]}`).join(', ')}`, 'system'); },
        sendDeviceEvent, recommendedShockEnergy,
        defibEnergySteps: () => RG.energySteps(defibWeight(), stateRef.current.scenario?.patientAge), audioContextState: audioCtxState, getUnmetExpectations: (action) => getUnmetExpectations(action, stateRef.current), setDeteriorationMode, toggleDeteriorationMode, describeDeterioration, getActiveDrugStatus,
        // Wave 8 surface: two-way sensor toggles, the honest fast paths and the derived obstruction.
        toggleSensor, attachStandardMonitoring, attachInvasiveMonitoring,
        // Wave 9 surface: the atomic batch primitives themselves, so any future multi-sensor button
        // is one action by construction rather than a sequence of presses.
        attachSensors, detachSensors,
        getObstruction: () => getObstruction(stateRef.current, stateRef.current.vitals, stateRef.current.scenario) };
    };
    window.useSimulation = useSimulation;
})();
