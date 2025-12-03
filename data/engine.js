// data/engine.js
(() => {
    const { useState, useEffect, useRef, useReducer } = React;
    const { INTERVENTIONS, calculateDynamicVbg, getRandomInt, clamp } = window;

    const initialState = {
        scenario: null, time: 0, cycleTimer: 0, isRunning: false,
        vitals: {}, prevVitals: {}, rhythm: "Sinus Rhythm", log: [], flash: null, history: [],
        investigationsRevealed: {}, loadingInvestigations: {}, activeInterventions: new Set(), interventionCounts: {}, activeDurations: {}, processedEvents: new Set(),
        isMuted: false, etco2Enabled: false, isParalysed: false, queuedRhythm: null, cprInProgress: false,
        nibp: { sys: null, dia: null, lastTaken: null, mode: 'manual', timer: 0, interval: 3 * 60 },
        trends: { active: false, targets: {}, duration: 0, elapsed: 0, startVitals: {} },
        speech: { text: null, timestamp: 0, source: null },
        audioOutput: 'monitor' 
    };

    const simReducer = (state, action) => {
        switch (action.type) {
            case 'START_SIM': return { ...state, isRunning: true, log: [...state.log, { time: new Date().toLocaleTimeString(), simTime: '00:00', msg: "Simulation Started", type: 'system' }] };
            case 'PAUSE_SIM': return { ...state, isRunning: false, log: [...state.log, { time: new Date().toLocaleTimeString(), simTime: `${Math.floor(state.time/60)}:${(state.time%60).toString().padStart(2,'0')}`, msg: "Simulation Paused", type: 'system' }] };
            case 'STOP_SIM': return { ...state, isRunning: false };
            case 'CLEAR_SESSION': return { ...initialState };
            case 'LOAD_SCENARIO':
                const initialRhythm = (action.payload.ecg && action.payload.ecg.type) ? action.payload.ecg.type : "Sinus Rhythm";
                return { ...initialState, scenario: action.payload, vitals: {...action.payload.vitals}, prevVitals: {...action.payload.vitals}, rhythm: initialRhythm, nibp: { sys: null, dia: null, lastTaken: null, mode: 'manual', timer: 0, interval: 3 * 60 }, processedEvents: new Set(), activeInterventions: new Set() };
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
            case 'UPDATE_RHYTHM': return { ...state, rhythm: action.payload };
            case 'TRIGGER_IMPROVE':
                let impTargets = { ...state.vitals };
                if (state.scenario.evolution && state.scenario.evolution.improved && state.scenario.evolution.improved.vitals) {
                     impTargets = { ...impTargets, ...state.scenario.evolution.improved.vitals };
                } else {
                     impTargets.hr = Math.max(60, impTargets.hr - 15);
                     impTargets.bpSys = Math.min(120, impTargets.bpSys + 15);
                     impTargets.spO2 = Math.min(99, impTargets.spO2 + 5);
                }
                return { ...state, trends: { active: true, targets: impTargets, duration: 30, elapsed: 0, startVitals: { ...state.vitals } }, flash: 'green' };
            case 'TRIGGER_DETERIORATE':
                 let detTargets = { ...state.vitals };
                 if (state.scenario.evolution && state.scenario.evolution.deteriorated && state.scenario.evolution.deteriorated.vitals) {
                     detTargets = { ...detTargets, ...state.scenario.evolution.deteriorated.vitals };
                 } else {
                     detTargets.hr = Math.min(170, detTargets.hr + 20);
                     detTargets.bpSys = Math.max(60, detTargets.bpSys - 20);
                     detTargets.spO2 = Math.max(80, detTargets.spO2 - 10);
                 }
                 return { ...state, trends: { active: true, targets: detTargets, duration: 30, elapsed: 0, startVitals: { ...state.vitals } }, flash: 'red' };
            case 'TRIGGER_NIBP_MEASURE': return { ...state, nibp: { ...state.nibp, sys: state.vitals.bpSys, dia: state.vitals.bpDia, lastTaken: Date.now(), timer: state.nibp.interval } };
            case 'TOGGLE_NIBP_MODE': const newMode = state.nibp.mode === 'manual' ? 'auto' : 'manual'; return { ...state, nibp: { ...state.nibp, mode: newMode, timer: newMode === 'auto' ? state.nibp.interval : 0 } };
            case 'START_TREND': return { ...state, trends: { active: true, targets: action.payload.targets, duration: action.payload.duration, elapsed: 0, startVitals: { ...state.vitals } } };
            case 'UPDATE_TREND_PROGRESS':
                const progress = Math.min(1, (state.trends.elapsed + 3) / state.trends.duration);
                if (progress >= 1) return { ...state, trends: { ...state.trends, active: false } };
                const interpolated = { ...state.vitals };
                Object.keys(state.trends.targets).forEach(key => { const startVal = state.trends.startVitals[key] || 0; const endVal = state.trends.targets[key]; interpolated[key] = startVal + (endVal - startVal) * progress; });
                return { ...state, vitals: interpolated, trends: { ...state.trends, elapsed: state.trends.elapsed + 3 } };
            case 'TRIGGER_SPEAK': return { ...state, speech: { text: action.payload, timestamp: Date.now(), source: 'controller' } };
            case 'SET_AUDIO_OUTPUT': return { ...state, audioOutput: action.payload };
            case 'SYNC_FROM_MASTER': return { ...state, vitals: action.payload.vitals, rhythm: action.payload.rhythm, cprInProgress: action.payload.cprInProgress, etco2Enabled: action.payload.etco2Enabled, flash: action.payload.flash, cycleTimer: action.payload.cycleTimer, scenario: { ...state.scenario, title: action.payload.scenarioTitle, deterioration: { type: action.payload.pathology } }, activeInterventions: new Set(action.payload.activeInterventions || []), nibp: action.payload.nibp || state.nibp, speech: action.payload.speech || state.speech, audioOutput: action.payload.audioOutput || 'monitor' };
            case 'ADD_LOG': const timestamp = new Date().toLocaleTimeString('en-GB'); const simTime = `${Math.floor(state.time/60).toString().padStart(2,'0')}:${(state.time%60).toString().padStart(2,'0')}`; return { ...state, log: [...state.log, { time: timestamp, simTime, msg: action.payload.msg, type: action.payload.type, timeSeconds: state.time }] };
            case 'SET_FLASH': return { ...state, flash: action.payload };
            case 'START_INTERVENTION_TIMER': return { ...state, activeDurations: { ...state.activeDurations, [action.payload.key]: { startTime: state.time, duration: action.payload.duration } } };
            case 'UPDATE_INTERVENTION_STATE': return { ...state, activeInterventions: action.payload.active, interventionCounts: action.payload.counts };
            case 'SET_PARALYSIS': return { ...state, isParalysed: action.payload };
            case 'REVEAL_INVESTIGATION': return { ...state, investigationsRevealed: { ...state.investigationsRevealed, [action.payload]: true }, loadingInvestigations: { ...state.loadingInvestigations, [action.payload]: false } };
            case 'SET_LOADING_INVESTIGATION': return { ...state, loadingInvestigations: { ...state.loadingInvestigations, [action.payload]: true } };
            case 'SET_MUTED': return { ...state, isMuted: action.payload };
            case 'TOGGLE_ETCO2': return { ...state, etco2Enabled: !state.etco2Enabled };
            case 'TOGGLE_CPR': return { ...state, cprInProgress: action.payload };
            case 'SET_QUEUED_RHYTHM': return { ...state, queuedRhythm: action.payload };
            case 'FAST_FORWARD': return { ...state, time: state.time + action.payload };
            case 'MANUAL_VITAL_UPDATE': return { ...state, vitals: { ...state.vitals, [action.payload.key]: action.payload.value }, prevVitals: { ...state.vitals } };
            case 'UPDATE_SCENARIO': return { ...state, scenario: action.payload };
            case 'MARK_EVENT_PROCESSED': const newEvents = new Set(state.processedEvents); newEvents.add(action.payload); return { ...state, processedEvents: newEvents };
            default: return state;
        }
    };

    const useSimulation = (initialScenario, isMonitorMode = false, sessionID = null) => {
        const [state, dispatch] = useReducer(simReducer, initialState);
        const timerRef = useRef(null);
        const tickRef = useRef(null);
        const audioCtxRef = useRef(null);
        const stateRef = useRef(state);
        
        useEffect(() => { stateRef.current = state; }, [state]);
        
        // --- FIREBASE SYNC ---
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
                const payload = { vitals: state.vitals, rhythm: state.rhythm, cprInProgress: state.cprInProgress, etco2Enabled: state.etco2Enabled, flash: state.flash, cycleTimer: state.cycleTimer, scenarioTitle: state.scenario.title, pathology: state.scenario.deterioration?.type || 'normal', activeInterventions: Array.from(state.activeInterventions), nibp: state.nibp, speech: state.speech, audioOutput: state.audioOutput };
                sessionRef.set(payload).catch(e => console.error("Sync Write Error:", e));
            }
        }, [state, isMonitorMode, sessionID]);

        useEffect(() => { if (!isMonitorMode && state.scenario && state.log.length > 0) { const serializableState = { ...state, activeInterventions: Array.from(state.activeInterventions), processedEvents: Array.from(state.processedEvents) }; localStorage.setItem('wmebem_sim_state', JSON.stringify(serializableState)); } }, [state.vitals, state.log, isMonitorMode]);
        useEffect(() => { if (!audioCtxRef.current) { const AudioContext = window.AudioContext || window.webkitAudioContext; audioCtxRef.current = new AudioContext(); } }, []);
        
        // --- AUDIO ENGINE ---
        useEffect(() => {
            let timerId;
            const ctx = audioCtxRef.current;
            const scheduleBeep = () => {
                const current = stateRef.current;
                
                // Logic: Only play if current mode matches audio output setting
                const shouldPlay = (isMonitorMode && (current.audioOutput === 'monitor' || current.audioOutput === 'both')) || 
                                   (!isMonitorMode && (current.audioOutput === 'controller' || current.audioOutput === 'both'));

                if (!current.isRunning && !isMonitorMode) return; 
                if (current.vitals.hr <= 0 || current.rhythm === 'VF' || current.rhythm === 'Asystole' || current.rhythm === 'pVT' || current.rhythm === 'PEA') return;
                
                if (!current.activeInterventions.has('Obs')) { timerId = setTimeout(scheduleBeep, 1000); return; }

                if (!current.isMuted && ctx && shouldPlay) {
                    const osc = ctx.createOscillator(); const gain = ctx.createGain();
                    osc.type = 'sine'; const freq = current.vitals.spO2 >= 95 ? 880 : current.vitals.spO2 >= 85 ? 600 : 400;
                    osc.frequency.value = freq; osc.connect(gain); gain.connect(ctx.destination);
                    const now = ctx.currentTime; gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(0.1, now + 0.01); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15); 
                    osc.start(now); osc.stop(now + 0.2);
                }
                const delay = 60000 / (Math.max(20, current.vitals.hr) || 60); timerId = setTimeout(scheduleBeep, delay);
            };
            if (state.isRunning || (isMonitorMode && state.vitals.hr > 0)) { if (ctx && ctx.state === 'suspended') ctx.resume(); scheduleBeep(); }
            return () => clearTimeout(timerId);
        }, [state.isRunning, isMonitorMode]); 

        useEffect(() => { if (state.nibp.mode === 'auto' && state.nibp.timer <= 0 && state.isRunning) { dispatch({ type: 'TRIGGER_NIBP_MEASURE' }); } }, [state.nibp.timer, state.isRunning]);

        // --- SPEECH ENGINE ---
        const lastSpeechRef = useRef(0);
        useEffect(() => {
            if (state.speech && state.speech.timestamp > lastSpeechRef.current) {
                // Prevent playing old messages on load
                if (Date.now() - state.speech.timestamp > 5000) {
                    lastSpeechRef.current = state.speech.timestamp;
                    return;
                }

                lastSpeechRef.current = state.speech.timestamp;
                const shouldPlay = (isMonitorMode && (state.audioOutput === 'monitor' || state.audioOutput === 'both')) || (!isMonitorMode && (state.audioOutput === 'controller' || state.audioOutput === 'both'));
                
                if (shouldPlay && 'speechSynthesis' in window) {
                    window.speechSynthesis.cancel(); // Prevent overlap/double speak
                    const utterance = new SpeechSynthesisUtterance(state.speech.text);
                    window.speechSynthesis.speak(utterance);
                }
            }
        }, [state.speech, isMonitorMode, state.audioOutput]);

        const addLogEntry = (msg, type = 'info') => dispatch({ type: 'ADD_LOG', payload: { msg, type } });
        const applyIntervention = (key) => {
            if (key === 'ToggleETCO2') {
                dispatch({ type: 'TOGGLE_ETCO2' });
                addLogEntry(state.etco2Enabled ? 'ETCO2 Disconnected' : 'ETCO2 Connected', 'action');
                return;
            }

            const action = INTERVENTIONS[key]; if (!action) return;
            const newVitals = { ...state.vitals }; let newActive = new Set(state.activeInterventions); let newCounts = { ...state.interventionCounts }; const count = (newCounts[key] || 0) + 1;
            if (action.duration && !state.activeDurations[key]) dispatch({ type: 'START_INTERVENTION_TIMER', payload: { key, duration: action.duration } });
            
            // Logic for continuous items (toggle on/off without counts)
            if (action.type === 'continuous') { 
                if (newActive.has(key)) { 
                    newActive.delete(key); 
                    addLogEntry(`${key} removed/stopped.`, 'action'); 
                } else { 
                    newActive.add(key); 
                    addLogEntry(action.log, 'action'); 
                } 
            } else { 
                newCounts[key] = count; 
                addLogEntry(action.log, 'action'); 
            }

            dispatch({ type: 'UPDATE_INTERVENTION_STATE', payload: { active: newActive, counts: newCounts } });
            if (state.scenario.stabilisers && state.scenario.stabilisers.includes(key)) { dispatch({ type: 'TRIGGER_IMPROVE' }); addLogEntry("Patient condition IMPROVING", "success"); }
            if (state.scenario.title.includes('Anaphylaxis') && key === 'Adrenaline' && count >= 2) { dispatch({ type: 'TRIGGER_IMPROVE' }); }
            if (key === 'Roc' || key === 'Sux') dispatch({ type: 'SET_PARALYSIS', payload: true });
            if (action.effect.changeRhythm === 'defib' && (state.rhythm === 'VF' || state.rhythm === 'VT' || state.rhythm === 'pVT')) { if (state.queuedRhythm) { dispatch({ type: 'UPDATE_RHYTHM', payload: state.queuedRhythm }); if (state.queuedRhythm === 'Sinus Rhythm') triggerROSC(); else addLogEntry(`Rhythm changed to ${state.queuedRhythm}`, 'manual'); dispatch({ type: 'SET_QUEUED_RHYTHM', payload: null }); } else if (Math.random() < 0.6) { addLogEntry('Defib: No change in rhythm.', 'warning'); } else { dispatch({ type: 'UPDATE_RHYTHM', payload: 'Asystole' }); addLogEntry('Rhythm changed to Asystole', 'warning'); } }
            
            const isArrest = state.vitals.bpSys < 10 && (['VF','VT','Asystole','PEA','pVT'].includes(state.rhythm));
            if (!isArrest) { if (action.effect.HR) { if (action.effect.HR === 'reset') newVitals.hr = 80; else newVitals.hr = clamp(newVitals.hr + action.effect.HR, 0, 250); } if (action.effect.BP) newVitals.bpSys = clamp(newVitals.bpSys + action.effect.BP, 0, 300); if (action.effect.RR && action.effect.RR !== 'vent') newVitals.rr = clamp(newVitals.rr + action.effect.RR, 0, 60); }
            if (action.effect.SpO2) newVitals.spO2 = clamp(newVitals.spO2 + action.effect.SpO2, 0, 100); if (action.effect.gcs) newVitals.gcs = clamp(newVitals.gcs + action.effect.gcs, 3, 15);
            
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
            addLogEntry(`CARDIAC ARREST - ${newRhythm}`, 'manual');
            dispatch({ type: 'SET_FLASH', payload: 'red' });
        };

        const triggerROSC = () => { dispatch({ type: 'UPDATE_VITALS', payload: { ...state.vitals, hr: 90, bpSys: 110, bpDia: 70, spO2: 96, rr: 16, gcs: 6, pupils: 3 } }); dispatch({ type: 'UPDATE_RHYTHM', payload: 'Sinus Rhythm' }); const updatedScenario = { ...state.scenario, deterioration: { ...state.scenario.deterioration, active: false } }; dispatch({ type: 'UPDATE_SCENARIO', payload: updatedScenario }); addLogEntry('ROSC achieved.', 'success'); dispatch({ type: 'SET_FLASH', payload: 'green' }); };
        const revealInvestigation = (type) => { if (state.investigationsRevealed[type] || state.loadingInvestigations[type]) return; dispatch({ type: 'SET_LOADING_INVESTIGATION', payload: type }); setTimeout(() => { dispatch({ type: 'REVEAL_INVESTIGATION', payload: type }); addLogEntry(`${type} Result Available`, 'success'); }, 2000); };
        const nextCycle = () => { dispatch({ type: 'FAST_FORWARD', payload: 120 }); addLogEntry('Fast Forward: +2 Minutes (Next Cycle)', 'system'); if (state.queuedRhythm) { dispatch({ type: 'UPDATE_RHYTHM', payload: state.queuedRhythm }); if (state.queuedRhythm === 'Sinus Rhythm') triggerROSC(); else addLogEntry(`Rhythm Check: Changed to ${state.queuedRhythm}`, 'manual'); dispatch({ type: 'SET_QUEUED_RHYTHM', payload: null }); } };
        const speak = (text) => { dispatch({ type: 'TRIGGER_SPEAK', payload: text }); addLogEntry(`Patient: "${text}"`, 'manual'); }; 
        const startTrend = (targets, durationSecs) => { dispatch({ type: 'START_TREND', payload: { targets, duration: durationSecs } }); addLogEntry(`Trending vitals over ${durationSecs}s`, 'system'); };
        const playNibp = () => { if (audioCtxRef.current) { const ctx = audioCtxRef.current; const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.connect(gain); gain.connect(ctx.destination); osc.frequency.setValueAtTime(150, ctx.currentTime); osc.frequency.linearRampToValueAtTime(100, ctx.currentTime + 1); gain.gain.setValueAtTime(0.1, ctx.currentTime); gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1); osc.start(); osc.stop(ctx.currentTime + 1); } };

        const tick = () => {
            const current = stateRef.current; let next = { ...current.vitals };
            if (current.trends.active) { dispatch({ type: 'UPDATE_TREND_PROGRESS' }); return; }
            if (next.hr === 0) { next.bpSys = 0; next.bpDia = 0; next.spO2 = Math.max(0, next.spO2 - 2); if (!['VF','Asystole','PEA','pVT'].includes(current.rhythm)) { dispatch({ type: 'UPDATE_RHYTHM', payload: 'Asystole' }); } } 
            else { 
                 if (next.spO2 < 85 && next.hr > 0 && next.hr < 160 && current.rhythm.includes('Sinus')) next.hr += 1; 
                 if (next.spO2 < 60 && next.hr > 60 && Math.random() > 0.7) { next.hr -= 2; }
                 if (next.rr < 8 && !current.activeInterventions.has('Bagging') && !current.activeInterventions.has('NIV')) { next.spO2 = Math.max(0, next.spO2 - 2); }
            }
            if (current.scenario.vbg) { const newVbg = calculateDynamicVbg(current.scenario.vbg, next, current.activeInterventions, 3); if (Math.abs(newVbg.pH - current.scenario.vbg.pH) > 0.001) { dispatch({ type: 'UPDATE_SCENARIO', payload: { ...current.scenario, vbg: newVbg } }); } }
            if (next.hr > 0) { next.hr += getRandomInt(-1, 1); next.bpSys += getRandomInt(-1, 1); let targetDia = Math.floor(next.bpSys * 0.65); next.bpDia = targetDia + getRandomInt(-2, 2); next.spO2 += Math.random() > 0.8 ? getRandomInt(-1, 1) : 0; }
            next.hr = clamp(next.hr, 0, 250); next.bpSys = clamp(next.bpSys, 0, 300); next.spO2 = clamp(next.spO2, 0, 100);
            
            // Rounding for whole numbers
            next.hr = Math.round(next.hr);
            next.bpSys = Math.round(next.bpSys);
            next.bpDia = Math.round(next.bpDia);
            next.spO2 = Math.round(next.spO2);
            next.rr = Math.round(next.rr);

            dispatch({ type: 'UPDATE_VITALS', payload: next });
        };
        const enableAudio = () => { if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume(); };

        const start = () => { if (state.isRunning || isMonitorMode) return; dispatch({ type: 'START_SIM' }); timerRef.current = setInterval(() => dispatch({ type: 'TICK_TIME' }), 1000); tickRef.current = setInterval(tick, 3000); enableAudio(); };
        const pause = () => { dispatch({ type: 'PAUSE_SIM' }); clearInterval(timerRef.current); clearInterval(tickRef.current); };
        const stop = () => { pause(); dispatch({ type: 'STOP_SIM' }); addLogEntry("Simulation Ended", 'system'); };
        const reset = () => { stop(); dispatch({ type: 'CLEAR_SESSION' }); localStorage.removeItem('wmebem_sim_state'); };

        return { state, dispatch, start, pause, stop, reset, applyIntervention, addLogEntry, manualUpdateVital, triggerArrest, triggerROSC, revealInvestigation, nextCycle, enableAudio, speak, startTrend, playNibp };
    };

    window.useSimulation = useSimulation;
})();
