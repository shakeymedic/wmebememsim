// data/engine.js
(() => {
    const { useState, useEffect, useRef, useReducer } = React;
    const { INTERVENTIONS, calculateDynamicVbg, getRandomInt, clamp } = window;

    const initialState = {
        scenario: null, time: 0, cycleTimer: 0, isRunning: false,
        vitals: { etco2: 4.5 }, prevVitals: {}, rhythm: "Sinus Rhythm", log: [], flash: null, history: [],
        investigationsRevealed: {}, loadingInvestigations: {}, activeInterventions: new Set(), interventionCounts: {}, activeDurations: {}, processedEvents: new Set(),
        isMuted: false, etco2Enabled: false, isParalysed: false, 
        queuedRhythm: null, // <--- THIS stores the next outcome
        cprInProgress: false,
        nibp: { sys: null, dia: null, lastTaken: null, mode: 'manual', timer: 0, interval: 3 * 60, inflating: false },
        trends: { active: false, targets: {}, duration: 0, elapsed: 0, startVitals: {} },
        speech: { text: null, timestamp: 0, source: null },
        soundEffect: { type: null, timestamp: 0 },
        audioOutput: 'monitor',
        arrestPanelOpen: false,
        isFinished: false,
        monitorPopup: { type: null, timestamp: 0 } 
    };

    const simReducer = (state, action) => {
       switch (action.type) {
            case 'START_SIM': return { ...state, isRunning: true, isFinished: false, log: [...state.log, { time: new Date().toLocaleTimeString(), simTime: '00:00', msg: "Simulation Started", type: 'system' }] };
            case 'PAUSE_SIM': return { ...state, isRunning: false, log: [...state.log, { time: new Date().toLocaleTimeString(), simTime: `${Math.floor(state.time/60)}:${(state.time%60).toString().padStart(2,'0')}`, msg: "Simulation Paused", type: 'system' }] };
            case 'STOP_SIM': return { ...state, isRunning: false, isFinished: true };
            case 'CLEAR_SESSION': return { ...initialState };
            case 'LOAD_SCENARIO':
                const initialRhythm = (action.payload.ecg && action.payload.ecg.type) ? action.payload.ecg.type : "Sinus Rhythm";
                const initialVitals = { etco2: 4.5, ...action.payload.vitals };
                return { ...initialState, scenario: action.payload, vitals: initialVitals, prevVitals: {...initialVitals}, rhythm: initialRhythm, nibp: { sys: null, dia: null, lastTaken: null, mode: 'manual', timer: 0, interval: 3 * 60, inflating: false }, processedEvents: new Set(), activeInterventions: new Set(), arrestPanelOpen: false };
            case 'RESTORE_SESSION': return { ...action.payload, activeInterventions: new Set(action.payload.activeInterventions || []), processedEvents: new Set(action.payload.processedEvents || []), isRunning: false };
            case 'TICK_TIME':
                const newDurations = { ...state.activeDurations }; let durChanged = false;
                Object.keys(newDurations).forEach(key => { const elapsed = state.time + 1 - newDurations[key].startTime; if (elapsed >= newDurations[key].duration) { delete newDurations[key]; durChanged = true; } });
                let newNibp = { ...state.nibp }; if (newNibp.mode === 'auto') { newNibp.timer -= 1; }
                return { ...state, time: state.time + 1, cycleTimer: state.cycleTimer + 1, activeDurations: durChanged ? newDurations : state.activeDurations, nibp: newNibp };
            case 'RESET_CYCLE_TIMER': return { ...state, cycleTimer: 0 };
            case 'UPDATE_VITALS': 
                if (!state.isRunning && action.payload.source !== 'manual') return state;
                const newHist = [...state.history, { time: state.time, hr: action.payload.hr, bp: action.payload.bpSys, spo2: action.payload.spO2, rr: action.payload.rr, actions: [] }];
                return { ...state, vitals: action.payload, history: newHist };
            case 'UPDATE_RHYTHM': 
                const isArrest = ['VF', 'VT', 'pVT', 'Asystole', 'PEA'].includes(action.payload);
                return { 
                    ...state, 
                    rhythm: action.payload,
                    arrestPanelOpen: isArrest ? true : state.arrestPanelOpen
                };
            
            case 'TRIGGER_IMPROVE':
                let impTargets = {}; 
                if (state.scenario.evolution && state.scenario.evolution.improved && state.scenario.evolution.improved.vitals) {
                     impTargets = { ...state.scenario.evolution.improved.vitals };
                } else {
                     impTargets.hr = Math.max(60, state.vitals.hr - 15);
                     impTargets.bpSys = Math.min(120, state.vitals.bpSys + 15);
                     impTargets.spO2 = Math.min(99, state.vitals.spO2 + 5);
                }
                return { ...state, trends: { active: true, targets: impTargets, duration: 30, elapsed: 0, startVitals: { ...state.vitals } }, flash: 'green' };
            
            case 'TRIGGER_DETERIORATE':
                 let detTargets = {};
                 if (state.scenario.evolution && state.scenario.evolution.deteriorated && state.scenario.evolution.deteriorated.vitals) {
                     detTargets = { ...state.scenario.evolution.deteriorated.vitals };
                 } else {
                     detTargets.hr = Math.min(170, state.vitals.hr + 20);
                     detTargets.bpSys = Math.max(60, state.vitals.bpSys - 20);
                     detTargets.spO2 = Math.max(80, state.vitals.spO2 - 10);
                 }
                 return { ...state, trends: { active: true, targets: detTargets, duration: 30, elapsed: 0, startVitals: { ...state.vitals } }, flash: 'red' };

            case 'START_NIBP': return { ...state, nibp: { ...state.nibp, inflating: true } };
            case 'COMMIT_NIBP': 
                const safeSys = (state.vitals.bpSys !== undefined && state.vitals.bpSys !== null) ? state.vitals.bpSys : 0;
                const safeDia = (state.vitals.bpDia !== undefined && state.vitals.bpDia !== null) ? state.vitals.bpDia : 0;
                return { ...state, nibp: { ...state.nibp, sys: safeSys, dia: safeDia, lastTaken: Date.now(), timer: state.nibp.interval, inflating: false } };
            case 'TOGGLE_NIBP_MODE': const newMode = state.nibp.mode === 'manual' ? 'auto' : 'manual'; return { ...state, nibp: { ...state.nibp, mode: newMode, timer: newMode === 'auto' ? state.nibp.interval : 0 } };
            
            case 'START_TREND': return { ...state, trends: { active: true, targets: action.payload.targets, duration: action.payload.duration, elapsed: 0, startVitals: { ...state.vitals } } };
            case 'ADVANCE_TREND': return { ...state, trends: { ...state.trends, elapsed: state.trends.elapsed + action.payload } };
            case 'STOP_TREND': return { ...state, trends: { ...state.trends, active: false, elapsed: 0 } };

            case 'TRIGGER_SPEAK': return { ...state, speech: { text: action.payload, timestamp: Date.now(), source: 'controller' } };
            case 'TRIGGER_SOUND': return { ...state, soundEffect: { type: action.payload, timestamp: Date.now() } };
            case 'SET_AUDIO_OUTPUT': return { ...state, audioOutput: action.payload };
            case 'SYNC_FROM_MASTER': 
                const syncedScenario = { 
                    ...state.scenario, 
                    title: action.payload.scenarioTitle, 
                    deterioration: { type: action.payload.pathology },
                    ...action.payload.investigations 
                };
                return { 
                    ...state, 
                    vitals: action.payload.vitals, 
                    rhythm: action.payload.rhythm, 
                    cprInProgress: action.payload.cprInProgress, 
                    etco2Enabled: action.payload.etco2Enabled, 
                    flash: action.payload.flash, 
                    cycleTimer: action.payload.cycleTimer, 
                    scenario: syncedScenario, 
                    activeInterventions: new Set(action.payload.activeInterventions || []), 
                    nibp: action.payload.nibp || state.nibp, 
                    speech: action.payload.speech || state.speech, 
                    soundEffect: action.payload.soundEffect || state.soundEffect, 
                    audioOutput: action.payload.audioOutput || 'monitor', 
                    trends: action.payload.trends || state.trends, 
                    arrestPanelOpen: action.payload.arrestPanelOpen || state.arrestPanelOpen, 
                    isFinished: action.payload.isFinished || false, 
                    monitorPopup: action.payload.monitorPopup || state.monitorPopup 
                };
            case 'ADD_LOG': const timestamp = new Date().toLocaleTimeString('en-GB'); const simTime = `${Math.floor(state.time/60).toString().padStart(2,'0')}:${(state.time%60).toString().padStart(2,'0')}`; return { ...state, log: [...state.log, { time: timestamp, simTime, msg: action.payload.msg, type: action.payload.type, timeSeconds: state.time }] };
            case 'SET_FLASH': return { ...state, flash: action.payload };
            case 'START_INTERVENTION_TIMER': return { ...state, activeDurations: { ...state.activeDurations, [action.payload.key]: { startTime: state.time, duration: action.payload.duration } } };
            case 'UPDATE_INTERVENTION_STATE': return { ...state, activeInterventions: action.payload.active, interventionCounts: action.payload.counts };
            case 'REMOVE_INTERVENTION':
                const removedActive = new Set(state.activeInterventions);
                removedActive.delete(action.payload);
                const removedDurations = { ...state.activeDurations };
                delete removedDurations[action.payload];
                return { ...state, activeInterventions: removedActive, activeDurations: removedDurations };
            case 'SET_PARALYSIS': return { ...state, isParalysed: action.payload };
            case 'REVEAL_INVESTIGATION': return { ...state, investigationsRevealed: { ...state.investigationsRevealed, [action.payload]: true }, loadingInvestigations: { ...state.loadingInvestigations, [action.payload]: false } };
            case 'SET_LOADING_INVESTIGATION': return { ...state, loadingInvestigations: { ...state.loadingInvestigations, [action.payload]: true } };
            case 'TRIGGER_POPUP': return { ...state, monitorPopup: { type: action.payload, timestamp: Date.now() } };
            case 'SET_MUTED': return { ...state, isMuted: action.payload };
            case 'TOGGLE_ETCO2': return { ...state, etco2Enabled: !state.etco2Enabled };
            case 'TOGGLE_CPR': return { ...state, cprInProgress: action.payload };
            case 'SET_QUEUED_RHYTHM': return { ...state, queuedRhythm: action.payload };
            case 'FAST_FORWARD': return { ...state, time: state.time + action.payload };
            case 'MANUAL_VITAL_UPDATE': return { ...state, vitals: { ...state.vitals, [action.payload.key]: action.payload.value }, prevVitals: { ...state.vitals } };
            case 'UPDATE_SCENARIO': return { ...state, scenario: action.payload };
            case 'MARK_EVENT_PROCESSED': const newEvents = new Set(state.processedEvents); newEvents.add(action.payload); return { ...state, processedEvents: newEvents };
            case 'SET_ARREST_PANEL': return { ...state, arrestPanelOpen: action.payload }; 
            default: return state;
        }
    };

    const useSimulation = (initialScenario, isMonitorMode = false, sessionID = null) => {
        const [state, dispatch] = useReducer(simReducer, initialState);
        const timerRef = useRef(null);
        const tickRef = useRef(null);
        const audioCtxRef = useRef(null);
        const stateRef = useRef(state);
        const lastCmdRef = useRef(0);
        
        useEffect(() => { stateRef.current = state; }, [state]);
        useEffect(() => {
            const db = window.db; 
            if (!db || !sessionID) return; 
            const sessionRef = db.ref(`sessions/${sessionID}`);
            if (isMonitorMode) {
                const handleUpdate = (snapshot) => { const data = snapshot.val(); if (data) { try { dispatch({ type: 'SYNC_FROM_MASTER', payload: data }); } catch (err) { console.error("Sync Error", err); } } };
                sessionRef.on('value', handleUpdate);
                return () => sessionRef.off('value', handleUpdate);
            } else {
                if (!state.scenario) return;
                const investigations = {
                    vbg: state.scenario.vbg || null,
                    ecg: state.scenario.ecg || null,
                    chestXray: state.scenario.chestXray || null,
                    urine: state.scenario.urine || null,
                    ct: state.scenario.ct || null,
                    pocus: state.scenario.pocus || null
                };

                const payload = { 
                    vitals: state.vitals, 
                    rhythm: state.rhythm, 
                    cprInProgress: state.cprInProgress, 
                    etco2Enabled: state.etco2Enabled, 
                    flash: state.flash, 
                    cycleTimer: state.cycleTimer, 
                    scenarioTitle: state.scenario.title, 
                    pathology: state.scenario.deterioration?.type || 'normal', 
                    investigations: investigations, 
                    activeInterventions: Array.from(state.activeInterventions), 
                    nibp: state.nibp, 
                    speech: state.speech, 
                    soundEffect: state.soundEffect, 
                    audioOutput: state.audioOutput, 
                    trends: state.trends, 
                    arrestPanelOpen: state.arrestPanelOpen, 
                    isFinished: state.isFinished, 
                    monitorPopup: state.monitorPopup 
                };
                sessionRef.set(payload).catch(e => console.error("Sync Write Error:", e));

                const cmdRef = db.ref(`sessions/${sessionID}/command`);
                cmdRef.on('value', (snap) => {
                    const val = snap.val();
                    if (val && val.ts > lastCmdRef.current) {
                        lastCmdRef.current = val.ts;
                        if (val.type === 'START_NIBP') dispatch({ type: 'START_NIBP' });
                        if (val.type === 'TRIGGER_ACTION') {
                            applyIntervention(val.payload);
                        }
                    }
                });
                return () => cmdRef.off();
            }
        }, [state, isMonitorMode, sessionID]);

        useEffect(() => { if (!isMonitorMode && state.scenario && state.log.length > 0) { const serializableState = { ...state, activeInterventions: Array.from(state.activeInterventions), processedEvents: Array.from(state.processedEvents) }; localStorage.setItem('wmebem_sim_state', JSON.stringify(serializableState)); } }, [state.vitals, state.log, isMonitorMode]);
        useEffect(() => { if (!audioCtxRef.current) { const AudioContext = window.AudioContext || window.webkitAudioContext; audioCtxRef.current = new AudioContext(); } }, []);
        
        useEffect(() => {
            let timerId;
            const ctx = audioCtxRef.current;
            const scheduleBeep = () => {
                const current = stateRef.current;
                const correctOutput = (isMonitorMode && (current.audioOutput === 'monitor' || current.audioOutput === 'both')) || (!isMonitorMode && (current.audioOutput === 'controller' || current.audioOutput === 'both'));
                
                if (!current.isRunning) return;
                if (current.vitals.hr <= 0 || current.rhythm === 'VF' || current.rhythm === 'Asystole' || current.rhythm === 'pVT' || current.rhythm === 'PEA') return;
                if (!current.activeInterventions.has('Obs')) { timerId = setTimeout(scheduleBeep, 1000); return; }
                
                if (!current.isMuted && ctx && correctOutput) {
                    const osc = ctx.createOscillator(); const gain = ctx.createGain();
                    osc.type = 'sine'; const freq = current.vitals.spO2 >= 95 ? 880 : current.vitals.spO2 >= 85 ? 600 : 400;
                    osc.frequency.value = freq; osc.connect(gain); gain.connect(ctx.destination);
                    const now = ctx.currentTime; gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(0.1, now + 0.01); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15); 
                    osc.start(now); osc.stop(now + 0.2);
                }
                const delay = 60000 / (Math.max(20, current.vitals.hr) || 60); timerId = setTimeout(scheduleBeep, delay);
            };

            const shouldStart = state.isRunning && state.vitals && state.vitals.hr > 0;
            if (shouldStart) { if (ctx && ctx.state === 'suspended') ctx.resume(); scheduleBeep(); }
            return () => clearTimeout(timerId);
        }, [state.isRunning, isMonitorMode, (state.vitals && state.vitals.hr > 0)]);

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
                    if(voices.length > 0) utterance.voice = voices[0]; 
                    window.speechSynthesis.speak(utterance); 
                } 
            } 
        }, [state.speech, isMonitorMode, state.audioOutput, state.isRunning]);

        const addLogEntry = (msg, type = 'info') => dispatch({ type: 'ADD_LOG', payload: { msg, type } });
        
        const applyIntervention = (key) => {
            if (key === 'ToggleETCO2') { dispatch({ type: 'TOGGLE_ETCO2' }); addLogEntry(state.etco2Enabled ? 'ETCO2 Disconnected' : 'ETCO2 Connected', 'action'); return; }
            const action = INTERVENTIONS[key]; if (!action) return;
            
            const isActive = state.activeInterventions.has(key);
            if (action.type === 'continuous' && isActive) {
                 dispatch({ type: 'REMOVE_INTERVENTION', payload: key });
                 addLogEntry(`${action.label} removed.`, 'action');
                 return;
            }

            let logMsg = action.log;
            if (key === 'Fluids') {
                if (state.scenario.ageRange === 'Paediatric' && state.scenario.wetflag) {
                    logMsg = `Fluid Bolus (${state.scenario.wetflag.fluids}ml) administered.`;
                } else {
                    logMsg = `Fluid Bolus (500ml) administered.`; 
                }
            }
            if (state.scenario.ageRange === 'Paediatric' && state.scenario.wetflag) {
                if (key === 'AdrenalineIV') logMsg = `IV Adrenaline (${state.scenario.wetflag.adrenaline}mcg) administered.`;
                if (key === 'Lorazepam') logMsg = `IV Lorazepam (${state.scenario.wetflag.lorazepam}mg) administered.`;
                if (key === 'InsulinDextrose') logMsg = `Glucose (${state.scenario.wetflag.glucose}ml) administered.`;
            }
            const newVitals = { ...state.vitals }; let newActive = new Set(state.activeInterventions); let newCounts = { ...state.interventionCounts }; const count = (newCounts[key] || 0) + 1;
            if (action.duration && !state.activeDurations[key]) dispatch({ type: 'START_INTERVENTION_TIMER', payload: { key, duration: action.duration } });
            if (action.type === 'continuous') { newActive.add(key); addLogEntry(logMsg, 'action'); } else { newCounts[key] = count; addLogEntry(logMsg, 'action'); }
            dispatch({ type: 'UPDATE_INTERVENTION_STATE', payload: { active: newActive, counts: newCounts } });
            if (state.scenario.stabilisers && state.scenario.stabilisers.includes(key)) { dispatch({ type: 'TRIGGER_IMPROVE' }); addLogEntry("Patient condition IMPROVING", "success"); }
            if (state.scenario.title.includes('Anaphylaxis') && key === 'Adrenaline' && count >= 2) { dispatch({ type: 'TRIGGER_IMPROVE' }); }
            if (key === 'Roc' || key === 'Sux') dispatch({ type: 'SET_PARALYSIS', payload: true });
            
            // --- UPDATED DEFIB LOGIC WITH QUEUED OUTCOME SUPPORT ---
            if (action.effect.changeRhythm === 'defib' && (state.rhythm === 'VF' || state.rhythm === 'VT' || state.rhythm === 'pVT')) { 
                if (state.queuedRhythm) { 
                    // Handle outcome selected by controller
                    if (state.queuedRhythm === 'ROSC') {
                        triggerROSC();
                    } else if (state.queuedRhythm === 'PEA') {
                        triggerArrest('PEA');
                        addLogEntry('Rhythm changed to PEA', 'warning');
                    } else if (state.queuedRhythm === 'Asystole') {
                        triggerArrest('Asystole');
                        addLogEntry('Rhythm changed to Asystole', 'warning');
                    } else if (state.queuedRhythm === 'VF') {
                        dispatch({ type: 'UPDATE_RHYTHM', payload: 'VF' });
                        addLogEntry('Refractory VF', 'warning');
                    } else {
                        // Direct rhythm set (e.g. Sinus Tachy)
                        dispatch({ type: 'UPDATE_RHYTHM', payload: state.queuedRhythm });
                        addLogEntry(`Rhythm changed to ${state.queuedRhythm}`, 'manual'); 
                    }
                    dispatch({ type: 'SET_QUEUED_RHYTHM', payload: null }); // Clear queue
                } else if (Math.random() < 0.6) { 
                    addLogEntry('Defib: No change in rhythm.', 'warning'); 
                } else { 
                    dispatch({ type: 'UPDATE_RHYTHM', payload: 'Asystole' }); 
                    addLogEntry('Rhythm changed to Asystole', 'warning'); 
                } 
            }
            // -------------------------------------------------------
            
            const isArrest = state.vitals.bpSys < 10 && (['VF','VT','Asystole','PEA','pVT'].includes(state.rhythm));
            if (!isArrest) { 
                if (action.effect.HR) { 
                    if (action.effect.HR === 'reset') newVitals.hr = 80; 
                    else if (action.effect.HR === 'pace') newVitals.hr = 80;
                    else newVitals.hr = clamp(newVitals.hr + action.effect.HR, 0, 250); 
                } 
                if (action.effect.BP) newVitals.bpSys = clamp(newVitals.bpSys + action.effect.BP, 0, 300); 
                
                // UPDATED: Handle Ventilation Logic ('vent' string vs number)
                if (action.effect.RR) {
                    if (action.effect.RR === 'vent') {
                        newVitals.rr = 14; // Take over ventilation
                    } else if (typeof action.effect.RR === 'number') {
                        newVitals.rr = clamp(newVitals.rr + action.effect.RR, 0, 60); 
                    }
                }
            }
            if (action.effect.SpO2) newVitals.spO2 = clamp(newVitals.spO2 + action.effect.SpO2, 0, 100); 
            
            if (action.effect.gcs) {
                if (typeof action.effect.gcs === 'string') {
                    if (action.effect.gcs === 'sedated') newVitals.gcs = 3;
                } else {
                    newVitals.gcs = clamp(newVitals.gcs + action.effect.gcs, 3, 15);
                }
            }

            const updatedScenario = { ...state.scenario }; let updateNeeded = false;
            if ((key === 'Needle' || key === 'FingerThoracostomy') && updatedScenario.chestXray && updatedScenario.chestXray.findings.includes('Pneumothorax')) { updatedScenario.chestXray.findings = "Lung re-expanded."; updateNeeded = true; }
            if (updateNeeded) dispatch({ type: 'UPDATE_SCENARIO', payload: updatedScenario });
            dispatch({ type: 'UPDATE_VITALS', payload: newVitals });
        };
        const manualUpdateVital = (key, value) => { dispatch({ type: 'MANUAL_VITAL_UPDATE', payload: { key, value } }); addLogEntry(`Manual: ${key} -> ${value}`, 'manual'); };
        const triggerArrest = (type = 'VF') => {
            const newRhythm = type;
            dispatch({ type: 'UPDATE_VITALS', payload: { ...state.vitals, hr: 0, bpSys: 0, bpDia: 0, spO2: 0, rr: 0, gcs: 3, pupils: 'Dilated' } });
            dispatch({ type: 'UPDATE_RHYTHM', payload: newRhythm });
            dispatch({ type: 'SET_ARREST_PANEL', payload: true }); 
            addLogEntry(`CARDIAC ARREST - ${newRhythm}`, 'manual');
            dispatch({ type: 'SET_FLASH', payload: 'red' });
        };
        const triggerROSC = () => { dispatch({ type: 'UPDATE_VITALS', payload: { ...state.vitals, hr: 90, bpSys: 110, bpDia: 70, spO2: 96, rr: 16, gcs: 6, pupils: 3 } }); dispatch({ type: 'UPDATE_RHYTHM', payload: 'Sinus Rhythm' }); const updatedScenario = { ...state.scenario, deterioration: { ...state.scenario.deterioration, active: false } }; dispatch({ type: 'UPDATE_SCENARIO', payload: updatedScenario }); addLogEntry('ROSC achieved.', 'success'); dispatch({ type: 'SET_FLASH', payload: 'green' }); };
        const revealInvestigation = (type) => { 
            dispatch({ type: 'SET_LOADING_INVESTIGATION', payload: type }); 
            setTimeout(() => { 
                dispatch({ type: 'REVEAL_INVESTIGATION', payload: type }); 
                dispatch({ type: 'TRIGGER_POPUP', payload: type });
                addLogEntry(`${type} Result Available`, 'success'); 
            }, 100); 
        };
        const nextCycle = () => { dispatch({ type: 'FAST_FORWARD', payload: 120 }); addLogEntry('Fast Forward: +2 Minutes (Next Cycle)', 'system'); if (state.queuedRhythm) { dispatch({ type: 'UPDATE_RHYTHM', payload: state.queuedRhythm }); if (state.queuedRhythm === 'Sinus Rhythm') triggerROSC(); else addLogEntry(`Rhythm Check: Changed to ${state.queuedRhythm}`, 'manual'); dispatch({ type: 'SET_QUEUED_RHYTHM', payload: null }); } };
        const speak = (text) => { dispatch({ type: 'TRIGGER_SPEAK', payload: text }); addLogEntry(`Patient: "${text}"`, 'manual'); }; 
        const playSound = (type) => { dispatch({ type: 'TRIGGER_SOUND', payload: type }); addLogEntry(`Sound: ${type}`, 'manual'); };
        const startTrend = (targets, durationSecs) => { dispatch({ type: 'START_TREND', payload: { targets, duration: durationSecs } }); addLogEntry(`Trending vitals over ${durationSecs}s`, 'system'); };
        const triggerNIBP = () => {
            if (isMonitorMode && sessionID) {
                window.db.ref(`sessions/${sessionID}/command`).set({ type: 'START_NIBP', ts: Date.now() });
            } else {
                dispatch({ type: 'START_NIBP' });
            }
        };
        
        const triggerAction = (action) => {
             if (isMonitorMode && sessionID) {
                 window.db.ref(`sessions/${sessionID}/command`).set({ type: 'TRIGGER_ACTION', payload: action, ts: Date.now() });
             } else {
                 applyIntervention(action);
             }
        }
        
        const playInflationSound = () => { if (audioCtxRef.current && audioCtxRef.current.state === 'running') { const ctx = audioCtxRef.current; const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(60, ctx.currentTime); osc.frequency.linearRampToValueAtTime(50, ctx.currentTime + 5); const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 150; osc.connect(filter); filter.connect(gain); gain.connect(ctx.destination); gain.gain.setValueAtTime(0.3, ctx.currentTime); gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 4.5); gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 5); osc.start(); osc.stop(ctx.currentTime + 5); } };
        const playMedicalSound = (type) => {
            if (!audioCtxRef.current) return; const ctx = audioCtxRef.current; if (ctx.state === 'suspended') ctx.resume(); const t = ctx.currentTime;
            if (type === 'Wheeze') { const osc = ctx.createOscillator(); const gain = ctx.createGain(); const lfo = ctx.createOscillator(); const lfoGain = ctx.createGain(); osc.type = 'triangle'; osc.frequency.value = 400; lfo.frequency.value = 0.4; lfoGain.gain.value = 150; lfo.connect(lfoGain); lfoGain.connect(osc.frequency); osc.connect(gain); gain.connect(ctx.destination); gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(0.1, t + 1); gain.gain.linearRampToValueAtTime(0, t + 3); osc.start(t); lfo.start(t); osc.stop(t+3); lfo.stop(t+3); }
            else if (type === 'Stridor') { const osc1 = ctx.createOscillator(); const osc2 = ctx.createOscillator(); const gain = ctx.createGain(); osc1.frequency.value = 600; osc2.frequency.value = 620; osc1.type = 'sawtooth'; osc2.type = 'sawtooth'; osc1.connect(gain); osc2.connect(gain); gain.connect(ctx.destination); gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(0.1, t + 0.5); gain.gain.linearRampToValueAtTime(0, t + 2); osc1.start(t); osc2.start(t); osc1.stop(t+2); osc2.stop(t+2); }
            else if (type === 'Vomit') { const bufferSize = ctx.sampleRate * 2; const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate); const data = buffer.getChannelData(0); for (let i = 0; i < bufferSize; i++) { data[i] = Math.random() * 2 - 1; } const bufferSource = ctx.createBufferSource(); bufferSource.buffer = buffer; const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 300; const gain = ctx.createGain(); bufferSource.connect(filter); filter.connect(gain); gain.connect(ctx.destination); gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(0.3, t + 0.2); gain.gain.exponentialRampToValueAtTime(0.01, t + 1.5); bufferSource.start(t); bufferSource.stop(t+1.5); }
            else if (type === 'Snoring') { const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.type = 'sawtooth'; osc.frequency.value = 40; osc.connect(gain); gain.connect(ctx.destination); gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(0.2, t + 0.5); gain.gain.linearRampToValueAtTime(0, t + 1.5); osc.start(t); osc.stop(t+1.5); }
        };
        
        const tick = () => {
            const current = stateRef.current; 
            let next = { ...current.vitals };

            if (next.hr === 0) { 
                next.bpSys = 0; next.bpDia = 0; next.spO2 = Math.max(0, next.spO2 - 2); 
                if (!['VF','Asystole','PEA','pVT'].includes(current.rhythm)) { dispatch({ type: 'UPDATE_RHYTHM', payload: 'Asystole' }); } 
            } else { 
                if (next.spO2 < 85 && next.hr > 0 && next.hr < 160 && current.rhythm.includes('Sinus')) next.hr += 1; 
                if (next.spO2 < 60 && next.hr > 60 && Math.random() > 0.7) { next.hr -= 2; } 
                if (next.rr < 8 && !current.activeInterventions.has('Bagging') && !current.activeInterventions.has('NIV')) { next.spO2 = Math.max(0, next.spO2 - 2); } 
            }
            if (next.hr > 0) { 
                next.hr += getRandomInt(-1, 1); 
                next.bpSys += getRandomInt(-1, 1); 
                let targetDia = Math.floor(next.bpSys * 0.65); 
                next.bpDia = targetDia + getRandomInt(-2, 2); 
                next.spO2 += Math.random() > 0.8 ? getRandomInt(-1, 1) : 0; 
            }

            if (current.trends.active) {
                const progress = Math.min(1, (current.trends.elapsed + 3) / current.trends.duration);
                Object.keys(current.trends.targets).forEach(key => {
                    const startVal = current.trends.startVitals[key] || 0;
                    const endVal = current.trends.targets[key];
                    next[key] = startVal + (endVal - startVal) * progress;
                });
                if (progress >= 1) {
                    dispatch({ type: 'STOP_TREND' });
                    Object.assign(next, current.trends.targets);
                } else {
                    dispatch({ type: 'ADVANCE_TREND', payload: 3 });
                }
            }

            next.hr = clamp(next.hr, 0, 250); 
            next.bpSys = clamp(next.bpSys, 0, 300); 
            next.spO2 = clamp(next.spO2, 0, 100);

            if (current.scenario.vbg) { 
                const newVbg = calculateDynamicVbg(current.scenario.vbg, next, current.activeInterventions, 3); 
                if (Math.abs(newVbg.pH - current.scenario.vbg.pH) > 0.001) { dispatch({ type: 'UPDATE_SCENARIO', payload: { ...current.scenario, vbg: newVbg } }); } 
            }

            dispatch({ type: 'UPDATE_VITALS', payload: next });
        };

        const enableAudio = () => { if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume(); };
        const start = () => { if (state.isRunning || isMonitorMode) return; dispatch({ type: 'START_SIM' }); timerRef.current = setInterval(() => dispatch({ type: 'TICK_TIME' }), 1000); tickRef.current = setInterval(tick, 3000); enableAudio(); };
        const pause = () => { dispatch({ type: 'PAUSE_SIM' }); clearInterval(timerRef.current); clearInterval(tickRef.current); };
        const stop = () => { pause(); dispatch({ type: 'STOP_SIM' }); addLogEntry("Simulation Ended", 'system'); };
        const reset = () => { stop(); dispatch({ type: 'CLEAR_SESSION' }); localStorage.removeItem('wmebem_sim_state'); };
        return { state, dispatch, start, pause, stop, reset, applyIntervention, addLogEntry, manualUpdateVital, triggerArrest, triggerROSC, revealInvestigation, nextCycle, enableAudio, speak, playSound, startTrend, triggerNIBP, triggerAction };
    };
    window.useSimulation = useSimulation;
})();
