(() => {
    // THE SIMULATION ENGINE, PART 3 OF 3: useSimulation, the hook every screen runs. The model
    // (engine-model.js) and reducers (engine-reducers.js) load first.
    const { useState, useEffect, useRef, useReducer } = React;
    const { INTERVENTIONS, calculateDynamicVbg, getRandomInt, clamp } = window;

    // The single shared rhythm registry. Every shockability, pulseless and
    // "is this an arrest?" decision in this file now goes through RG. The previous hardcoded
    // arrays (two shockability lists, seven arrest lists) are gone.
    const RG = window.RHYTHMS;
    if (!RG) throw new Error('data/rhythms.js must load before data/engine.js');
    const {
        DEFAULT_VITALS, INVASIVE_SENSOR_KEYS, OBJECTIVE_TRIGGERS, SENSOR_DEFS, STANDARD_SENSOR_KEYS,
        VENTILATOR_RATE, VOLUME_KEYS, ageBandOf, applyRhythmHrBand, buildDrugEntry, clampVital,
        fluidResponsiveness, getObstruction, getSensors, getUnmetExpectations, initialCoreState,
        initialLogState, initialScenarioState, initialVitalsState, isDrugSpent, isVentilated,
        normaliseDeteriorationType, isAnaphylaxisScenario, paediatricAdenosineDose, paediatricDoseNotes, paediatricFieldScale, pkFactor, pkPhase, pkRemaining,
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
                // ONE definition. `pulseless` and `isArrest` are the SAME registry predicate —
                // the pre-Wave-3 code had two different lists here that disagreed about VT, so
                // VT-with-a-pulse got arrest physiology while also being excluded from zeroing.
                const isArrest = RG.inArrest(newRhythm);
                const cur = stateRef.current;
                // Rhythm-driven vitals are a facilitator-level write: they target the BASE.
                let rhythmVitals = { ...cur.baseVitals };

                // Does the facilitator hold HR? A pulseless/organised transition
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
                // FACILITATOR SUPREMACY. The band is applied only when the
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
        // THE SIMULATION ENGINE: LIVE SESSION SYNC (data/engine-sync.js).
        const {
            sendDeviceEvent
        } = window.__EngineSync.useSessionSync({
            addLogEntry: (...a) => addLogEntry(...a), analyseRhythm: (...a) => analyseRhythm(...a),
            deliverShock: (...a) => deliverShock(...a), dispatch, initCharge: (...a) => initCharge(...a),
            isAudioLive: (...a) => isAudioLive(...a), isMonitorMode,
            lastPayloadRef, postToChannel, sessionID, setDefibEnergy: (...a) => setDefibEnergy(...a),
            setDefibMode: (...a) => setDefibMode(...a), simChannel, start: (...a) => start(...a), state, stateRef,
            toggleCPR: (...a) => toggleCPR(...a)
        });
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
            // No pulse means no beep. Registry-derived, so it cannot drift from the
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
            const pulseless = RG.isPulseless(current.rhythm);   // Registry
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

            // POINT-OF-CARE CHECKS. These are INTERMITTENT: they publish the value
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
                 // Monitoring keys take the sensor-aware removal, which expands the
                 // 'Obs' shorthand. Without this the PROCEDURES card and the chip could disagree about
                 // what is attached; both now resolve through getSensors() over the same set.
                 if (key === 'Obs' || STANDARD_SENSOR_KEYS.indexOf(key) !== -1) dispatch({ type: 'DETACH_SENSOR', payload: key });
                 else dispatch({ type: 'REMOVE_INTERVENTION', payload: key });
                 // Stopping compressions clears the flag as well as starting the drug's offset tail.
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
            // PART 5 — PAEDIATRIC DOSING NOTES (RCUK 2025). These are COACHING LINES, never blocks:
            // the facilitator always gets to give the drug. The dose actually logged is the
            // paediatric one where the weight or age is known.
            if (scenario.ageRange === 'Paediatric' || ageBandOf(scenario) !== 'adult') {
                const wt = scenario.wetflag && scenario.wetflag.weight;
                const paeds = paediatricDoseNotes(key, scenario, { count: ((cur.interventionCounts || {})[key] || 0) + 1, inArrest: RG.inArrest(cur.rhythm) });
                if (paeds.log) logMsg = paeds.log;
                paeds.notes.forEach(n => addLogEntry(n, 'info'));
                if (key === 'KetamineIM') addLogEntry(`Paediatric IM ketamine for procedural sedation: 4 mg/kg${wt ? ` = ${Math.round(4 * wt)} mg` : ''}. Peak dissociation ~5 min, 15-30 min of usable sedation — do NOT stack doses while waiting.`, 'info');
                if (key === 'Sux') addLogEntry('Suxamethonium in a child: bradycardia is common (and marked with a second dose) — have atropine drawn up.', 'warning');
            }
            // RCUK anaphylaxis (adults and children): no improvement in breathing or circulation
            // despite TWO doses of IM adrenaline is refractory anaphylaxis.
            if (key === 'AdrenalineIM' && ((cur.interventionCounts || {})[key] || 0) + 1 === 2) {
                addLogEntry('Second IM adrenaline dose. If breathing or circulation problems persist, this is REFRACTORY anaphylaxis (RCUK): seek expert help early, give a rapid IV fluid bolus and start a low-dose IV adrenaline infusion; give IM adrenaline every 5 min until the infusion is running.', 'warning');
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
                // A declared REBOUND phase is pushed as a second, delayed entry (late
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

            // The trigger table now lives at module scope (see OBJECTIVE_TRIGGERS
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
            const looksAnaphylactic = isAnaphylaxisScenario(scenario);
            if (looksAnaphylactic && ANAPHYLAXIS_ADRENALINE.indexOf(key) !== -1) {
                // RCUK: improvement after the FIRST correct dose of IM adrenaline is the expected
                // clinical course, and the 5-minute repeat is the next step if it does not come.
                dispatch({ type: 'TRIGGER_IMPROVE' });
                addLogEntry(`${action.label} in anaphylaxis — patient condition IMPROVING. Reassess at 5 minutes and repeat IM adrenaline if the improvement is incomplete.`, 'success');
                if (key === 'AdrenalineIM' && count === 1) addLogEntry('After initial treatment (RCUK 2021): mast cell tryptase, first sample as soon as feasible without delaying treatment, second 1-2 h (no later than 4 h) after onset. Observation: fast-track discharge after 2 h only if one dose worked within 5-10 min, symptoms fully resolved and the patient has auto-injectors and supervision; at least 6 h after resolution if 2 doses were needed; at least 12 h for more than 2 doses, severe asthma or respiratory compromise, or a previous biphasic reaction.', 'info');
                if (key === 'AdrenalineInfusion') addLogEntry('RCUK peripheral low-dose adrenaline infusion (refractory anaphylaxis): 1 mg in 100 ml 0.9% sodium chloride via a dedicated line, start at 0.5-1 ml/kg/h and titrate to response; continuous ECG and SpO2, BP at least every 5 min. Not on the same side as a BP cuff.', 'info');
            }
            // RCUK Emergency treatment of anaphylaxis (2021): steroids are not advised routinely;
            // antihistamines are third-line and have no role in A, B or C problems.
            if (looksAnaphylactic && (key === 'Hydrocortisone' || key === 'Dexamethasone' || key === 'Chlorphenamine')) {
                const adrenalineGiven = ANAPHYLAXIS_ADRENALINE.some(k => ((cur.interventionCounts || {})[k] || 0) > 0 || (cur.activeInterventions && cur.activeInterventions.has(k)));
                if (!adrenalineGiven) addLogEntry(`${action.label} given before any adrenaline in anaphylaxis. Adrenaline is the first-line treatment; ${key === 'Chlorphenamine' ? 'antihistamines' : 'steroids'} must never be given in preference to it (RCUK 2021).`, 'warning', true,
                    { action: 'AdrenalineIM', label: 'IM Adrenaline', missing: ['adrenaline before other drugs'] });
                addLogEntry(key === 'Chlorphenamine'
                    ? 'Antihistamines are third-line in anaphylaxis (RCUK 2021) and do not treat airway, breathing or circulation problems. After stabilisation, for skin symptoms, a non-sedating oral antihistamine (e.g. cetirizine) is preferred to chlorphenamine; IV chlorphenamine can cause hypotension if given rapidly.'
                    : 'Corticosteroids are no longer advised for the routine emergency treatment of anaphylaxis (RCUK 2021). Consider them only after initial resuscitation, for refractory reactions or ongoing asthma or shock, and never in preference to adrenaline or fluids.', 'info');
            }
            // --- PARALYSIS (roc vs sux genuinely differ) ---
            // Folded into the pk envelope. The blockade window is derived from the SAME
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
                // REVERSAL IS NOT INSTANT. Sugammadex restores a train-of-four ratio > 0.9 in
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
            // ADENOSINE: a SCRIPTED, TRANSIENT sequence, not a jump to HR 80.
            // Half-life is under 10 s. What the team must see is: flush → a few seconds of AV block
            // or sinus pause (the frightening bit) → either conversion to sinus at ~15 s or the SVT
            // simply carrying on, in which case you escalate 6 → 12 → 18 mg (RCUK). Everything is resolved
            // inside ~45 s, and nothing lingers (pk offset 40 s).
            // =====================================================================================
            if (action.avBlock && !isArrest) {
                const ab = action.avBlock;
                const doseNo = count;                    // RCUK: 6 mg, then 12 mg, then 18 mg
                // A child's dose is weight-based (RCUK 2025): 0.1-0.2 mg/kg, then 0.3 mg/kg (max
                // 12-18 mg); a neonate's 150 mcg/kg rising to 300 mcg/kg.
                const paedsDose = paediatricAdenosineDose(scenario, doseNo);
                const doseMg = doseNo === 1 ? 6 : (doseNo === 2 ? 12 : 18);
                const doseText = paedsDose || `${doseMg} mg`;
                addLogEntry(`Adenosine ${doseText} given as a RAPID push into a large proximal vein with an immediate saline flush. Warn the patient: flushing, chest tightness and a feeling of doom are expected and last seconds.`, 'action');
                dispatch({ type: 'TRIGGER_SPEAK', payload: 'Oh — that feels horrible. My chest is tight. I feel like something awful is happening.' });
                addLogEntry(`Transient AV block / sinus pause for ~${ab.pause || 8}s — run a rhythm strip NOW: this is the diagnostic window.`, 'warning');
                const chances = Array.isArray(ab.chanceByDose) ? ab.chanceByDose : [0.55, 0.75, 0.8];
                const chance = chances[Math.min(doseNo, chances.length) - 1];
                setTimeout(() => {
                    const now = stateRef.current;
                    if (!now || !now.isRunning || now.isFinished) return;
                    if (RG.inArrest(now.rhythm)) return;
                    applyDrugConversion(now, 'Adenosine', `Adenosine ${doseText}`, { chance });
                }, Math.max(1, Number(ab.convertAt) || 12) * 1000);
            }

            // All three changeRhythm modes are handled now. 'sync' and 'chance' were silently
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
            const isArrest = RG.inArrest(cur.rhythm);   // Registry. The old literal also required bpSys<10 AND wrongly included VT-with-a-pulse.
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
                            // Electrical capture without mechanical capture is worthless, and a
                            // rate number alone taught trainees not to feel for a pulse.
                            addLogEntry(`Pacing: ELECTRICAL capture at ${pacer.output}mA, rate ${pacer.rate}. Now CONFIRM MECHANICAL CAPTURE — feel a central pulse / check the SpO2 trace. Give analgesia and sedation: pacing hurts.`, 'success');
                        } else {
                            addLogEntry(`Pacing: no capture (output ${pacer.output}mA < threshold ${cur.pacingThreshold}mA) — increase the output until every pacing spike is followed by a QRS AND a pulse.`, 'warning');
                        }
                    }
                    else if (!pkOwned('HR')) newVitals.hr = clampVital('hr', newVitals.hr + action.effect.HR);
                }
                // Perfusion only improves if the pacer actually captured.
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
        // THE SINGLE CHOKE POINT FOR EVERY RHYTHM TRANSITION.
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

            // One consistent, assessor-readable line for EVERY transition, converted or not.
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
        // The vitals an arrest / ROSC write owns outright. Writing them releases the
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
            // ROSC is no longer always exactly Sinus Rhythm. Honour the rhythm we were given,
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
        // THE SIMULATION ENGINE: DEFIBRILLATION AND PACING (data/engine-defib.js).
        const {
            analyseRhythm, applyCardioversion, applyDrugConversion, applyShockOutcome, defibWeight,
            deliverShock, drugOnBoard, goToDefibStep, initCharge, recommendedShockEnergy, refibTimerRef,
            setDefibEnergy, setDefibMode, setQueuedRhythm, shockPolicy, stepsRunning, toggleCPR,
            toggleDefibSync
        } = window.__EngineDefib.useDefib({
            RESET_HOLD_KEYS, addLogEntry, arrestVitals, changeRhythm, dispatch, isMonitorMode, state,
            stateRef, triggerArrest, triggerROSC
        });

        const revealInvestigation = (type, customText = null) => {
            dispatch({ type: 'SET_LOADING_INVESTIGATION', payload: type });
            setTimeout(() => {
                const cur = stateRef.current;
                let finalCustomText = customText;

                // VBG: if no manual override supplied, derive from current state
                // The AUTHORED VBG is authoritative for the baseline. It used to be bypassed
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

        // What the facilitator needs to see — which drugs are live, the phase they are in and how
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
            // State the mode explicitly at scenario start so an untouched toggle is never a surprise.
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
            // The decision of WHAT to tick is tickActionFor's, not this effect's. A stopped
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
        // EVERY MONITORING CHIP IS A TRUE TWO-WAY TOGGLE.
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
        // EVERY BATCH ATTACH/DETACH IS ONE REDUCER ACTION.
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
        // The fast path attaches the STANDARD four and says so. The invasive
        // action is separate and explicitly labelled, because an arterial line, IV access and
        // capnography are deliberate clinical acts, not a default.
        // Both are single atomic actions.
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
        setDefibSettings: (patch) => {
            dispatch({ type: 'SET_DEFIB_SETTINGS', payload: patch });
            const say = (k, v) => k === 'cvEnergy' ? `cardioversion succeeds at ${v === 'default' ? 'the default energy' : `${v} J or more`}` : `${k} = ${v}`;
            addLogEntry(`Shock response settings: ${Object.keys(patch || {}).map(k => say(k, patch[k])).join(', ')}`, 'system');
        },
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
