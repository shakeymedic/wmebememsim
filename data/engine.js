const { useState, useEffect, useRef, useReducer } = React;

    const initialState = {
        scenario: null,
        time: 0,
        cycleTimer: 0, // 2 min cycle timer
        isRunning: false,
        vitals: {},
        prevVitals: {},
        rhythm: "Sinus Rhythm", 
        log: [],
        flash: null,
        history: [],
        investigationsRevealed: {},
        loadingInvestigations: {},
        activeInterventions: new Set(),
        interventionCounts: {},
        activeDurations: {},
        processedEvents: new Set(),
        isMuted: false,
        etco2Enabled: false,
        isParalysed: false,
        queuedRhythm: null,
        cprInProgress: false,
    };

    const simReducer = (state, action) => {
        switch (action.type) {
            case 'START_SIM': return { ...state, isRunning: true, log: [...state.log, { time: new Date().toLocaleTimeString(), simTime: '00:00', msg: "Simulation Started", type: 'system' }] };
            case 'PAUSE_SIM': return { ...state, isRunning: false, log: [...state.log, { time: new Date().toLocaleTimeString(), simTime: `${Math.floor(state.time/60)}:${(state.time%60).toString().padStart(2,'0')}`, msg: "Simulation Paused", type: 'system' }] };
            case 'LOAD_SCENARIO':
                const initialRhythm = (action.payload.ecg && action.payload.ecg.type) ? action.payload.ecg.type : "Sinus Rhythm";
                return { ...initialState, scenario: action.payload, vitals: {...action.payload.vitals}, prevVitals: {...action.payload.vitals}, rhythm: initialRhythm, processedEvents: new Set(), activeInterventions: new Set() };
            case 'RESTORE_SESSION': return { ...action.payload, activeInterventions: new Set(action.payload.activeInterventions || []), processedEvents: new Set(action.payload.processedEvents || []), isRunning: false };
            case 'TICK_TIME':
                const newDurations = { ...state.activeDurations };
                let durChanged = false;
                Object.keys(newDurations).forEach(key => {
                    const elapsed = state.time + 1 - newDurations[key].startTime;
                    if (elapsed >= newDurations[key].duration) { delete newDurations[key]; durChanged = true; }
                });
                return { ...state, time: state.time + 1, cycleTimer: state.cycleTimer + 1, activeDurations: durChanged ? newDurations : state.activeDurations };
            case 'RESET_CYCLE_TIMER': return { ...state, cycleTimer: 0 };
            case 'UPDATE_VITALS': 
                const newHist = [...state.history, { time: state.time, hr: action.payload.hr, bp: action.payload.bpSys, spo2: action.payload.spO2, rr: action.payload.rr, actions: [] }];
                return { ...state, vitals: action.payload, history: newHist };
            case 'UPDATE_RHYTHM': return { ...state, rhythm: action.payload };
            case 'TRIGGER_IMPROVE':
                if (!state.scenario.evolution) return state;
                const improvedScen = { ...state.scenario, ...state.scenario.evolution.improved, deterioration: { ...state.scenario.deterioration, active: false } };
                return { ...state, scenario: improvedScen, flash: 'green' };
            case 'TRIGGER_DETERIORATE':
                 if (!state.scenario.evolution) return state;
                 const detScen = { ...state.scenario, ...state.scenario.evolution.deteriorated, deterioration: { ...state.scenario.deterioration, active: true, rate: 0.3 } };
                 return { ...state, scenario: detScen, flash: 'red' };
            
            // --- NEW: SYNC ACTION FOR MONITOR ---
            case 'SYNC_FROM_MASTER':
                return {
                    ...state,
                    vitals: action.payload.vitals,
                    rhythm: action.payload.rhythm,
                    cprInProgress: action.payload.cprInProgress,
                    etco2Enabled: action.payload.etco2Enabled,
                    flash: action.payload.flash,
                    cycleTimer: action.payload.cycleTimer,
                    scenario: {
                        ...state.scenario,
                        title: action.payload.scenarioTitle,
                        deterioration: { type: action.payload.pathology }
                    },
                    // SAFEGUARD: Ensure we handle undefined/null cleanly
                    activeInterventions: new Set(action.payload.activeInterventions || [])
                };

            case 'ADD_LOG':
                const timestamp = new Date().toLocaleTimeString('en-GB');
                const simTime = `${Math.floor(state.time/60).toString().padStart(2,'0')}:${(state.time%60).toString().padStart(2,'0')}`;
                return { ...state, log: [...state.log, { time: timestamp, simTime, msg: action.payload.msg, type: action.payload.type, timeSeconds: state.time }] };
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
        
        // Update ref
        useEffect(() => { stateRef.current = state; }, [state]);
        
        // --- DATA SYNC (Firebase with Session ID) ---
        useEffect(() => {
            // If no DB or no Session ID yet, do not attempt sync
            if (!db || !sessionID) return; 
            
            // Connect to a SPECIFIC session ID path (e.g., sessions/ABCD)
            const sessionRef = db.ref(`sessions/${sessionID}`);

            if (isMonitorMode) {
                // MONITOR MODE: Listen
                const handleUpdate = (snapshot) => {
                    const data = snapshot.val();
                    if (data) {
                        try { dispatch({ type: 'SYNC_FROM_MASTER', payload: data }); } 
                        catch (err) { console.error("Sync Error", err); }
                    }
                };
                sessionRef.on('value', handleUpdate);
                return () => sessionRef.off('value', handleUpdate);
            } else {
                // CONTROLLER MODE: Broadcast
                if (!state.scenario) return;

                const payload = {
                    vitals: state.vitals,
                    rhythm: state.rhythm,
                    cprInProgress: state.cprInProgress,
                    etco2Enabled: state.etco2Enabled,
                    flash: state.flash,
                    cycleTimer: state.cycleTimer,
                    scenarioTitle: state.scenario.title,
                    pathology: state.scenario.deterioration?.type || 'normal',
                    activeInterventions: Array.from(state.activeInterventions)
                };
                // Write to specific session path
                sessionRef.set(payload).catch(e => console.error("Sync Write Error:", e));
            }
        }, [state, isMonitorMode, sessionID]);

        useEffect(() => {
            if (!isMonitorMode && state.scenario && state.log.length > 0) {
                const serializableState = { ...state, activeInterventions: Array.from(state.activeInterventions), processedEvents: Array.from(state.processedEvents) };
                localStorage.setItem('wmebem_sim_state', JSON.stringify(serializableState));
            }
        }, [state.vitals, state.log, isMonitorMode]);

        useEffect(() => { if (!audioCtxRef.current) { const AudioContext = window.AudioContext || window.webkitAudioContext; audioCtxRef.current = new AudioContext(); } }, []);

        // AUDIO LOOP
        useEffect(() => {
            let timerId;
            const ctx = audioCtxRef.current;

            const scheduleBeep = () => {
                const current = stateRef.current;
                if (!current.isRunning && !isMonitorMode) return; 
                if (current.vitals.hr <= 0 || current.rhythm === 'VF' || current.rhythm === 'Asystole') return;

                if (!current.isMuted && ctx) {
                    const osc = ctx.createOscillator(); 
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    const freq = current.vitals.spO2 >= 95 ? 880 : current.vitals.spO2 >= 85 ? 600 : 400;
                    osc.frequency.value = freq;
                    osc.connect(gain); 
                    gain.connect(ctx.destination);
                    const now = ctx.currentTime;
                    gain.gain.setValueAtTime(0, now); 
                    gain.gain.linearRampToValueAtTime(0.1, now + 0.01); 
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15); 
                    osc.start(now); 
                    osc.stop(now + 0.2);
                }
                const delay = 60000 / (Math.max(20, current.vitals.hr) || 60);
                timerId = setTimeout(scheduleBeep, delay);
            };

            if (state.isRunning || (isMonitorMode && state.vitals.hr > 0)) {
                if (ctx && ctx.state === 'suspended') ctx.resume();
                scheduleBeep();
            }
            return () => clearTimeout(timerId);
        }, [state.isRunning, isMonitorMode]); 

        const addLogEntry = (msg, type = 'info') => dispatch({ type: 'ADD_LOG', payload: { msg, type } });

        const applyIntervention = (key) => {
            const action = INTERVENTIONS[key];
            if (!action) return;
            const newVitals = { ...state.vitals };
            let newActive = new Set(state.activeInterventions);
            let newCounts = { ...state.interventionCounts };
            const count = (newCounts[key] || 0) + 1;
            
            if (action.duration && !state.activeDurations[key]) dispatch({ type: 'START_INTERVENTION_TIMER', payload: { key, duration: action.duration } });

            if (action.type === 'continuous') {
                if (newActive.has(key)) { newActive.delete(key); addLogEntry(`${key} removed/stopped.`, 'action'); } 
                else { newActive.add(key); addLogEntry(action.log, 'action'); }
            } else {
                newCounts[key] = count;
                addLogEntry(action.log, 'action');
            }
            dispatch({ type: 'UPDATE_INTERVENTION_STATE', payload: { active: newActive, counts: newCounts } });

            // Auto-progression & Logic
            if (state.scenario.stabilisers && state.scenario.stabilisers.includes(key)) { dispatch({ type: 'TRIGGER_IMPROVE' }); addLogEntry("Patient condition IMPROVING", "success"); }
            
            // ... (Keep your existing detailed clinical logic here if customized, otherwise standard logic below) ...
            if (state.scenario.title.includes('Anaphylaxis') && key === 'Adrenaline' && count >= 2) { dispatch({ type: 'TRIGGER_IMPROVE' }); }
            if (key === 'Roc' || key === 'Sux') dispatch({ type: 'SET_PARALYSIS', payload: true });

            // Physiological Effects
            if (action.effect.changeRhythm === 'defib' && (state.rhythm === 'VF' || state.rhythm === 'VT')) {
                if (state.queuedRhythm) {
                    dispatch({ type: 'UPDATE_RHYTHM', payload: state.queuedRhythm });
                    if (state.queuedRhythm === 'Sinus Rhythm') triggerROSC();
                    else addLogEntry(`Rhythm changed to ${state.queuedRhythm}`, 'manual');
                    dispatch({ type: 'SET_QUEUED_RHYTHM', payload: null });
                } else if (Math.random() < 0.6) { addLogEntry('Defib: No change in rhythm.', 'warning'); } 
                else { dispatch({ type: 'UPDATE_RHYTHM', payload: 'Asystole' }); addLogEntry('Rhythm changed to Asystole', 'warning'); }
            }
            
            const isArrest = state.vitals.bpSys < 10 && (state.rhythm === 'VF' || state.rhythm === 'VT' || state.rhythm === 'Asystole');
            if (!isArrest) {
                if (action.effect.HR) { if (action.effect.HR === 'reset') newVitals.hr = 80; else newVitals.hr = clamp(newVitals.hr + action.effect.HR, 0, 250); }
                if (action.effect.BP) newVitals.bpSys = clamp(newVitals.bpSys + action.effect.BP, 0, 300);
                if (action.effect.RR && action.effect.RR !== 'vent') newVitals.rr = clamp(newVitals.rr + action.effect.RR, 0, 60);
            }
            if (action.effect.SpO2) newVitals.spO2 = clamp(newVitals.spO2 + action.effect.SpO2, 0, 100);
            if (action.effect.gcs) newVitals.gcs = clamp(newVitals.gcs + action.effect.gcs, 3, 15);

            // Dynamic Investigations
            const updatedScenario = { ...state.scenario };
            let updateNeeded = false;
            if ((key === 'Needle' || key === 'FingerThoracostomy') && updatedScenario.chestXray?.findings.includes('Pneumothorax')) { updatedScenario.chestXray.findings = "Lung re-expanded."; updateNeeded = true; }
            if (updateNeeded) dispatch({ type: 'UPDATE_SCENARIO', payload: updatedScenario });

            dispatch({ type: 'UPDATE_VITALS', payload: newVitals });
        };

        const manualUpdateVital = (key, value) => { dispatch({ type: 'MANUAL_VITAL_UPDATE', payload: { key, value } }); addLogEntry(`Manual: ${key} -> ${value}`, 'manual'); };
        const triggerArrest = () => { dispatch({ type: 'UPDATE_VITALS', payload: { ...state.vitals, hr: 0, bpSys: 0, bpDia: 0, spO2: 0, rr: 0, gcs: 3, pupils: 'Dilated' } }); dispatch({ type: 'UPDATE_RHYTHM', payload: 'VF' }); addLogEntry('CARDIAC ARREST - VF', 'manual'); dispatch({ type: 'SET_FLASH', payload: 'red' }); };
        const triggerROSC = () => { dispatch({ type: 'UPDATE_VITALS', payload: { ...state.vitals, hr: 90, bpSys: 110, bpDia: 70, spO2: 96, rr: 16, gcs: 6, pupils: '3mm' } }); dispatch({ type: 'UPDATE_RHYTHM', payload: 'Sinus Rhythm' }); const updatedScenario = { ...state.scenario, deterioration: { ...state.scenario.deterioration, active: false } }; dispatch({ type: 'UPDATE_SCENARIO', payload: updatedScenario }); addLogEntry('ROSC achieved.', 'success'); dispatch({ type: 'SET_FLASH', payload: 'green' }); };
        const revealInvestigation = (type) => { if (state.investigationsRevealed[type] || state.loadingInvestigations[type]) return; dispatch({ type: 'SET_LOADING_INVESTIGATION', payload: type }); setTimeout(() => { dispatch({ type: 'REVEAL_INVESTIGATION', payload: type }); addLogEntry(`${type} Result Available`, 'success'); }, 2000); };
        
        const nextCycle = () => {
            dispatch({ type: 'FAST_FORWARD', payload: 120 });
            addLogEntry('Fast Forward: +2 Minutes (Next Cycle)', 'system');
            if (state.queuedRhythm) {
                dispatch({ type: 'UPDATE_RHYTHM', payload: state.queuedRhythm });
                if (state.queuedRhythm === 'Sinus Rhythm') triggerROSC();
                else addLogEntry(`Rhythm Check: Changed to ${state.queuedRhythm}`, 'manual');
                dispatch({ type: 'SET_QUEUED_RHYTHM', payload: null });
            }
        };

        const tick = () => {
            const current = stateRef.current;
            let next = { ...current.vitals };
            
            // Physiology
            if (next.spO2 < 85 && next.hr > 0 && next.hr < 160 && current.rhythm.includes('Sinus')) next.hr += 1; 
            if (next.spO2 < 60 && next.hr > 60 && Math.random() > 0.7) { next.hr -= 2; addLogEntry("Bradycardia (Hypoxia)", 'danger'); }
            
            // Dynamic VBG
            if (current.scenario.vbg) {
                const newVbg = calculateDynamicVbg(current.scenario.vbg, next, current.activeInterventions, 3);
                if (Math.abs(newVbg.pH - current.scenario.vbg.pH) > 0.001) {
                     dispatch({ type: 'UPDATE_SCENARIO', payload: { ...current.scenario, vbg: newVbg } });
                }
            }

            // Jitter
            if (['Asystole', 'VF', 'Coarse VF', 'Fine VF'].includes(current.rhythm)) { 
                next.hr = 0; next.bpSys = 0; next.bpDia = 0; 
                if(!current.cprInProgress) next.spO2 = Math.max(0, next.spO2 - 2); 
            } else {
                next.hr += getRandomInt(-1, 1); 
                next.bpSys += getRandomInt(-1, 1); 
                let targetDia = Math.floor(next.bpSys * 0.65);
                next.bpDia = targetDia + getRandomInt(-2, 2);
                next.spO2 += Math.random() > 0.8 ? getRandomInt(-1, 1) : 0;
            }
            
            next.hr = clamp(next.hr, 0, 250);
            next.bpSys = clamp(next.bpSys, 0, 300);
            next.spO2 = clamp(next.spO2, 0, 100);
            
            dispatch({ type: 'UPDATE_VITALS', payload: next });
        };

        const start = () => { 
            if (state.isRunning || isMonitorMode) return; 
            dispatch({ type: 'START_SIM' }); 
            timerRef.current = setInterval(() => dispatch({ type: 'TICK_TIME' }), 1000); 
            tickRef.current = setInterval(tick, 3000); 
            if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume(); 
        };
        
        const pause = () => { dispatch({ type: 'PAUSE_SIM' }); clearInterval(timerRef.current); clearInterval(tickRef.current); };
        const stop = () => { pause(); addLogEntry("Simulation Ended", 'system'); localStorage.removeItem('wmebem_sim_state'); };

        return { state, dispatch, start, pause, stop, applyIntervention, addLogEntry, manualUpdateVital, triggerArrest, triggerROSC, revealInvestigation, nextCycle };
    };
