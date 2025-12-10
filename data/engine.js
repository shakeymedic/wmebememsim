// data/engine.js
(() => {
    const { useState, useEffect, useRef, useReducer } = React;
    const { INTERVENTIONS, calculateDynamicVbg, getRandomInt, clamp } = window;

    const initialState = {
        scenario: null, time: 0, cycleTimer: 0, isRunning: false,
        vitals: { etco2: 4.5 }, prevVitals: {}, rhythm: "Sinus Rhythm", log: [], flash: null, history: [],
        investigationsRevealed: {}, loadingInvestigations: {}, activeInterventions: new Set(), interventionCounts: {}, activeDurations: {}, processedEvents: new Set(),
        isMuted: false, etco2Enabled: false, isParalysed: false, 
        queuedRhythm: null,
        cprInProgress: false,
        nibp: { sys: null, dia: null, lastTaken: null, mode: 'manual', timer: 0, interval: 3 * 60, inflating: false },
        trends: { active: false, targets: {}, duration: 0, elapsed: 0, startVitals: {} },
        speech: { text: null, timestamp: 0, source: null },
        soundEffect: { type: null, timestamp: 0 },
        audioOutput: 'monitor',
        arrestPanelOpen: false,
        isFinished: false,
        monitorPopup: { type: null, timestamp: 0 },
        waveformGain: 1.0,
        noise: { interference: false },
        remotePacerState: { rate: 0, output: 0 },
        notification: null,
        pacingThreshold: 70, 
        activeLoops: {}, 
        completedObjectives: new Set()
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
                return { ...initialState, scenario: action.payload, vitals: initialVitals, prevVitals: {...initialVitals}, rhythm: initialRhythm, nibp: { sys: null, dia: null, lastTaken: null, mode: 'manual', timer: 0, interval: 3 * 60, inflating: false }, processedEvents: new Set(), activeInterventions: new Set(), arrestPanelOpen: false, pacingThreshold: getRandomInt(60, 100) };
            case 'RESTORE_SESSION': return { ...action.payload, activeInterventions: new Set(action.payload.activeInterventions || []), processedEvents: new Set(action.payload.processedEvents || []), completedObjectives: new Set(action.payload.completedObjectives || []), isRunning: false };
            case 'TICK_TIME':
                const newDurations = { ...state.activeDurations }; let durChanged = false;
                Object.keys(newDurations).forEach(key => { const elapsed = state.time + 1 - newDurations[key].startTime; if (elapsed >= newDurations[key].duration) { delete newDurations[key]; durChanged = true; } });
                let newNibp = { ...state.nibp }; if (newNibp.mode === 'auto') { newNibp.timer -= 1; }
                return { ...state, time: state.time + 1, cycleTimer: state.cycleTimer + 1, activeDurations: durChanged ? newDurations : state.activeDurations, nibp: newNibp };
            case 'RESET_CYCLE_TIMER': return { ...state, cycleTimer: 0 };
            case 'UPDATE_VITALS': 
                if (!state.isRunning && action.payload.source !== 'manual') return state;
                const newHist = [...state.history, { 
                    time: state.time, 
                    hr: action.payload.hr, 
                    bp: action.payload.bpSys, 
                    spo2: action.payload.spO2, 
                    rr: action.payload.rr, 
                    etco2: action.payload.etco2, // Added ETCO2 tracking
                    actions: [] 
                }];
                return { ...state, vitals: action.payload, history: newHist };
            case 'UPDATE_RHYTHM': 
                const isArrest = ['VF', 'VT', 'pVT', 'Asystole', 'PEA'].includes(action.payload);
                return { ...state, rhythm: action.payload, arrestPanelOpen: isArrest ? true : state.arrestPanelOpen };
            
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
                    monitorPopup: action.payload.monitorPopup || state.monitorPopup,
                    waveformGain: action.payload.waveformGain || 1.0,
                    noise: action.payload.noise || { interference: false },
                    notification: action.payload.notification || null,
                    remotePacerState: action.payload.remotePacerState || {rate: 0, output: 0}
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
            case 'SET_GAIN': return { ...state, waveformGain: action.payload };
            case 'TOGGLE_INTERFERENCE': return { ...state, noise: { ...state.noise, interference: !state.noise.interference } };
            case 'UPDATE_PACER_STATE': return { ...state, remotePacerState: action.payload };
            case 'SET_NOTIFICATION': return { ...state, notification: action.payload };
            case 'UPDATE_AUDIO_LOOPS': return { ...state, activeLoops: action.payload };
            case 'COMPLETE_OBJECTIVE': const newObjs = new Set(state.completedObjectives); newObjs.add(action.payload); return { ...state, completedObjectives: newObjs };
            
            default: return state;
        }
    };

    const useSimulation = (initialScenario, isMonitorMode = false, sessionID = null) => {
        const [state, dispatch] = useReducer(simReducer, initialState);
        const timerRef = useRef(null);
        const tickRef = useRef(null);
        const audioCtxRef = useRef(null);
        const loopNodesRef = useRef({}); 
        const stateRef = useRef(state);
        const lastCmdRef = useRef(0);
        
        const simChannel = useRef(new BroadcastChannel('sim_channel'));

        useEffect(() => { stateRef.current = state; }, [state]);

        // LINK CONTROLLER TO DEFIB
        useEffect(() => {
            simChannel.current.onmessage = (event) => {
                const data = event.data;
                // Removed !state.isRunning check so defib can connect anytime
                
                if (data.type === 'PACER_UPDATE') {
                    dispatch({ type: 'UPDATE_PACER_STATE', payload: data.payload });
                } else if (data.type === 'CHARGE_INIT') {
                    dispatch({ type: 'SET_FLASH', payload: 'yellow' });
                    dispatch({ type: 'ADD_LOG', payload: { msg: `Defib Charging (${data.payload.energy}J)`, type: 'warning' } });
                    dispatch({ type: 'SET_NOTIFICATION', payload: { msg: "Charging...", type: "warning", id: Date.now() } });
                    setTimeout(() => dispatch({ type: 'SET_FLASH', payload: null }), 1000);
                } else if (data.type === 'SHOCK_DELIVERED') {
                    dispatch({ type: 'SET_FLASH', payload: 'red' });
                    dispatch({ type: 'ADD_LOG', payload: { msg: `Shock Delivered ${data.payload.energy}J`, type: 'danger' } });
                    dispatch({ type: 'SET_NOTIFICATION', payload: { msg: `Shock Delivered ${data.payload.energy}J`, type: "danger", id: Date.now() } });
                    setTimeout(() => dispatch({ type: 'SET_FLASH', payload: null }), 500);
                } else if (data.type === 'ALARM_SILENCE') {
                    dispatch({ type: 'ADD_LOG', payload: { msg: 'Alarm Silenced by Student', type: 'info' } });
                } else if (data.type === 'MARKER_EVENT') {
                    dispatch({ type: 'ADD_LOG', payload: { msg: 'Student Marked Event', type: 'manual' } });
                } else if (data.type === 'REQUEST_12LEAD') {
                    dispatch({ type: 'ADD_LOG', payload: { msg: 'Student Requested 12-Lead', type: 'action' } });
                    if (state.scenario && state.scenario.investigations && state.scenario.investigations.ecg) {
                        const imgUrl = state.scenario.investigations.ecg.image || ""; 
                        simChannel.current.postMessage({ type: 'SHOW_12LEAD', payload: imgUrl });
                    }
                }
            };
        }, [state.scenario]); 

        useEffect(() => {
            if (!isMonitorMode) {
                simChannel.current.postMessage({
                    type: 'SYNC_VITALS',
                    payload: {
                        rhythm: state.rhythm,
                        hr: state.vitals.hr,
                        spO2: state.vitals.spO2,
                        etco2: state.vitals.etco2,
                        bpSys: state.vitals.bpSys,
                        bpDia: state.vitals.bpDia,
                        gain: state.waveformGain,
                        interference: state.noise.interference,
                        cpr: state.cprInProgress
                    }
                });
            }
        }, [state.vitals, state.rhythm, state.waveformGain, state.noise, state.cprInProgress]);

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
                    monitorPopup: state.monitorPopup,
                    waveformGain: state.waveformGain,
                    noise: state.noise,
                    notification: state.notification,
                    remotePacerState: state.remotePacerState
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

        useEffect(() => { 
            if (!isMonitorMode && state.scenario && state.log.length > 0) { 
                const serializableState = { ...state, activeInterventions: Array.from(state.activeInterventions), processedEvents: Array.from(state.processedEvents), completedObjectives: Array.from(state.completedObjectives) }; 
                try {
                    localStorage.setItem('wmebem_sim_state', JSON.stringify(serializableState)); 
                } catch (e) {}
            } 
        }, [state.vitals, state.log, isMonitorMode]);

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
            
            if (action.requires) {
                const missing = action.requires.filter(req => !state.activeInterventions.has(req));
                if (missing.length > 0) {
                    const reqLabel = INTERVENTIONS[missing[0]] ? INTERVENTIONS[missing[0]].label : missing[0];
                    dispatch({ type: 'SET_NOTIFICATION', payload: { msg: `Requires ${reqLabel}`, type: 'danger', id: Date.now() } });
                    return; // Block the action
                }
            }

            const isActive = state.activeInterventions.has(key);
            if (action.type === 'continuous' && isActive) {
                 dispatch({ type: 'REMOVE_INTERVENTION', payload: key });
                 addLogEntry(`${action.label} removed.`, 'action');
                 dispatch({ type: 'SET_NOTIFICATION', payload: { msg: `${action.label} Removed`, type: 'info', id: Date.now() } });
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
            
            // --- NOTIFICATION ---
            dispatch({ type: 'SET_NOTIFICATION', payload: { msg: action.label + " Administered", type: 'success', id: Date.now() } });

            // --- CHECKLIST LOGIC ---
            if(state.scenario.title.includes('Sepsis') && key === 'Antibiotics') dispatch({ type: 'COMPLETE_OBJECTIVE', payload: 'Antibiotics' });
            if(state.scenario.title.includes('Sepsis') && key === 'Fluids') dispatch({ type: 'COMPLETE_OBJECTIVE', payload: 'Fluids' });
            if(state.scenario.title.includes('Anaphylaxis') && key === 'Adrenaline') dispatch({ type: 'COMPLETE_OBJECTIVE', payload: 'Adrenaline' });

            if (state.scenario.stabilisers && state.scenario.stabilisers.includes(key)) { dispatch({ type: 'TRIGGER_IMPROVE' }); addLogEntry("Patient condition IMPROVING", "success"); }
            if (state.scenario.title.includes('Anaphylaxis') && key === 'Adrenaline' && count >= 2) { dispatch({ type: 'TRIGGER_IMPROVE' }); }
            if (key === 'Roc' || key === 'Sux') dispatch({ type: 'SET_PARALYSIS', payload: true });
            
            if (action.effect.changeRhythm === 'defib' && (state.rhythm === 'VF' || state.rhythm === 'VT' || state.rhythm === 'pVT')) { if (state.queuedRhythm) { dispatch({ type: 'UPDATE_RHYTHM', payload: state.queuedRhythm }); if (state.queuedRhythm === 'Sinus Rhythm') triggerROSC(); else addLogEntry(`Rhythm changed to ${state.queuedRhythm}`, 'manual'); dispatch({ type: 'SET_QUEUED_RHYTHM', payload: null }); } else if (Math.random() < 0.6) { addLogEntry('Defib: No change in rhythm.', 'warning'); } else { dispatch({ type: 'UPDATE_RHYTHM', payload: 'Asystole' }); addLogEntry('Rhythm changed to Asystole', 'warning'); } }
            
            const isArrest = state.vitals.bpSys < 10 && (['VF','VT','Asystole','PEA','pVT'].includes(state.rhythm));
            if (!isArrest) { 
                if (action.effect.HR) { 
                    if (action.effect.HR === 'reset') newVitals.hr = 80; 
                    else if (action.effect.HR === 'pace') newVitals.hr = 80;
                    else newVitals.hr = clamp(newVitals.hr + action.effect.HR, 0, 250); 
                } 
                if (action.effect.BP) newVitals.bpSys = clamp(newVitals.bpSys + action.effect.BP, 0, 300); 
                if (action.effect.RR) {
                    if (action.effect.RR === 'vent') {
                        newVitals.rr = 14; 
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
        
        // --- LOOPING AUDIO (Wheeze/Stridor) ---
        const toggleAudioLoop = (type) => {
            if (!audioCtxRef.current) return;
            const ctx = audioCtxRef.current;
            if (ctx.state === 'suspended') ctx.resume();
            
            // Check if playing
            if (loopNodesRef.current[type]) {
                // Stop it
                loopNodesRef.current[type].stop();
                delete loopNodesRef.current[type];
                const newLoops = {...state.activeLoops};
                delete newLoops[type];
                dispatch({type: 'UPDATE_AUDIO_LOOPS', payload: newLoops});
                addLogEntry(`Audio Loop Stopped: ${type}`, 'manual');
            } else {
                // Start it (Simple Synthesis for robustness)
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                const lfo = ctx.createOscillator(); // LFO for breathing pattern
                const lfoGain = ctx.createGain();
                
                if (type === 'Wheeze') {
                    osc.type = 'triangle';
                    osc.frequency.value = 400;
                    lfo.frequency.value = 0.25; // 15 breaths/min
                    lfoGain.gain.value = 200; // Modulate pitch
                } else if (type === 'Stridor') {
                    osc.type = 'sawtooth';
                    osc.frequency.value = 600;
                    lfo.frequency.value = 0.3; 
                    lfoGain.gain.value = 100;
                }
                
                lfo.connect(lfoGain);
                lfoGain.connect(osc.frequency);
                osc.connect(gain);
                gain.connect(ctx.destination);
                
                // Breath envelope
                const now = ctx.currentTime;
                gain.gain.setValueAtTime(0, now);
                // Simple looping ramp logic isn't native, so we use LFO for amplitude in a real mixer, 
                // but here we just let it drone with pitch modulation to simulate breath sounds
                gain.gain.value = 0.05; 
                
                osc.start();
                lfo.start();
                
                loopNodesRef.current[type] = { 
                    stop: () => { 
                        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5); 
                        setTimeout(() => { osc.stop(); lfo.stop(); }, 500); 
                    } 
                };
                
                dispatch({type: 'UPDATE_AUDIO_LOOPS', payload: {...state.activeLoops, [type]: true}});
                addLogEntry(`Audio Loop Started: ${type}`, 'manual');
            }
        };

        const tick = () => {
            const current = stateRef.current; 
            let next = { ...current.vitals };
            
            // 1. Automatic Deterioration (Physiological Drift)
            if (current.isRunning && current.scenario.deterioration && current.scenario.deterioration.active && !current.trends.active) {
                const rate = current.scenario.deterioration.rate || 0.05; 
                const type = current.scenario.deterioration.type;
                if (type === 'shock' || type === 'haemorrhagic_shock') {
                    if (Math.random() < rate) next.hr += 1;
                    if (Math.random() < rate) next.bpSys -= 1;
                } else if (type === 'respiratory') {
                    if (Math.random() < rate) next.spO2 -= 1;
                    if (next.rr < 35 && Math.random() < rate) next.rr += 1;
                } else if (type === 'neuro') {
                    if (Math.random() < (rate/2) && next.gcs > 3) next.gcs -= 1;
                    if (Math.random() < rate) next.bpSys += 1;
                    if (Math.random() < rate) next.hr -= 1;
                }
            }

            // 2. Physiological Constraints (Compensatory Mechanisms)
            if (next.hr === 0) { 
                next.bpSys = 0; next.bpDia = 0; next.spO2 = Math.max(0, next.spO2 - 2); 
                if (!['VF','Asystole','PEA','pVT'].includes(current.rhythm)) { dispatch({ type: 'UPDATE_RHYTHM', payload: 'Asystole' }); } 
            } else {
                if (next.spO2 < 88 && next.hr < 130 && current.rhythm.includes('Sinus')) {
                    if (Math.random() > 0.5) next.hr += 1; // Hypoxic Tachycardia
                }
                if (next.spO2 < 50 && next.hr > 40) {
                    if (Math.random() > 0.6) next.hr -= 2; // Terminal Bradycardia
                }
            }

            // --- ADVANCED PACING LOGIC ---
            if (current.remotePacerState.output > current.pacingThreshold && current.remotePacerState.rate > 0) {
                // Capture achieved
                if (current.rhythm !== 'paced') {
                    dispatch({ type: 'UPDATE_RHYTHM', payload: '1st Deg Block' }); // Defib shows 'Paced' beats visually
                }
                next.hr = current.remotePacerState.rate;
            } else if (current.remotePacerState.output > 0) {
                // Pacing but no capture - maintain native rhythm
            }

            // 3. Noise & Flux
            if (next.hr > 0 && next.hr !== current.remotePacerState.rate) { 
                next.hr += getRandomInt(-1, 1); 
                next.bpSys += getRandomInt(-1, 1); 
                let targetDia = Math.floor(next.bpSys * 0.60); 
                next.bpDia = next.bpDia + (targetDia - next.bpDia) * 0.1 + getRandomInt(-1, 1);
                next.spO2 += Math.random() > 0.8 ? getRandomInt(-1, 1) : 0; 
            }

            // 4. Trend Application
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
            next.rr = clamp(next.rr, 0, 60);

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
        return { state, dispatch, start, pause, stop, reset, applyIntervention, addLogEntry, manualUpdateVital, triggerArrest, triggerROSC, revealInvestigation, nextCycle, enableAudio, speak, playSound, toggleAudioLoop, startTrend, triggerNIBP, triggerAction };
    };
    window.useSimulation = useSimulation;
})();
