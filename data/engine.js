(() => {
    const { useState, useEffect, useRef, useReducer } = React;
    const { INTERVENTIONS, calculateDynamicVbg, getRandomInt, clamp } = window;

    const initialVitalsState = {
        vitals: { etco2: 4.5, temp: 36.5, bm: 5.5, hr: 80, bpSys: 120, bpDia: 80, spO2: 98, rr: 16 },
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
        nibp: { sys: null, dia: null, lastTaken: null, mode: 'manual', timer: 0, interval: 3 * 60, inflating: false, history: [] },
        speech: { text: null, timestamp: 0, source: null }, soundEffect: { type: null, timestamp: 0 },
        audioOutput: 'monitor', arrestPanelOpen: false, isFinished: false,
        monitorPopup: { type: null, timestamp: 0, customText: null },
        waveformGain: 1.0, noise: { interference: false },
        remotePacerState: { rate: 0, output: 0 }, notification: null, pacingThreshold: 70,
        icp: 10, activeLoops: {}, completedObjectives: new Set(), assessments: {},
        lastUpdate: 0, isOffline: false, showWetflag: true
    };

    const formatVital = (key, val) => {
        if (['temp', 'bm', 'etco2'].includes(key)) return Math.round(val * 10) / 10;
        return Math.round(val);
    };

    const vitalsReducer = (state, action) => {
        const cs = action.currentState;
        switch (action.type) {
            case 'CLEAR_SESSION': return { ...initialVitalsState };
            case 'LOAD_SCENARIO': 
                if(!action.payload) return { ...initialVitalsState };
                const initialVitals = { ...initialVitalsState.vitals, ...action.payload.vitals };
                return { ...initialVitalsState, vitals: initialVitals, prevVitals: { ...initialVitals } };
            case 'RESTORE_SESSION': return { ...state, vitals: action.payload.vitals, prevVitals: action.payload.prevVitals || action.payload.vitals, trends: action.payload.trends || state.trends, hypoxiaTimer: action.payload.hypoxiaTimer || 0 };
            case 'SYNC_FROM_MASTER': return { ...state, vitals: action.payload.vitals, trends: action.payload.trends || state.trends };
            case 'UPDATE_VITALS': return { ...state, vitals: action.payload };
            case 'MANUAL_VITAL_UPDATE': return { ...state, vitals: { ...state.vitals, [action.payload.key]: action.payload.value }, prevVitals: { ...state.vitals } };
            case 'START_TREND': return { ...state, trends: { active: true, targets: action.payload.targets, duration: action.payload.duration, elapsed: 0, startVitals: { ...state.vitals } } };
            case 'STOP_TREND': return { ...state, trends: { ...state.trends, active: false, elapsed: 0 } };
            case 'TRIGGER_IMPROVE':
            case 'TRIGGER_DETERIORATE': return { ...state, trends: action.payload.trends };
            case 'TICK_TIME':
                let currentVitals = { ...state.vitals };
                let vitalsChanged = false;
                let newTrends = { ...state.trends };
                let currentHypoxiaTimer = state.hypoxiaTimer;
                const isRunning = cs ? cs.isRunning : false;
                const activeInt = cs ? cs.activeInterventions : new Set();
                const icp = cs ? cs.icp : 10;
                const scen = cs ? cs.scenario : null;

                if (currentVitals.rr < 8 && currentVitals.rr > 0 && !activeInt.has('Bagging')) {
                    currentHypoxiaTimer++;
                    if (currentHypoxiaTimer > 30) { currentVitals.spO2 = Math.max(40, formatVital('spO2', currentVitals.spO2 - 0.5)); vitalsChanged = true; }
                } else {
                    currentHypoxiaTimer = 0;
                    if (activeInt.has('Oxygen') && currentVitals.spO2 < 95) { currentVitals.spO2 = formatVital('spO2', currentVitals.spO2 + 0.2); vitalsChanged = true; }
                }

                if (scen && scen.deterioration && scen.deterioration.type === 'neuro' && isRunning) {
                    if (icp > 25) { currentVitals.bpSys = Math.min(220, formatVital('bpSys', currentVitals.bpSys + 0.2)); currentVitals.hr = Math.max(30, formatVital('hr', currentVitals.hr - 0.1)); vitalsChanged = true; }
                }

                if (currentVitals.rr > 30) { currentVitals.etco2 = Math.max(2.5, formatVital('etco2', currentVitals.etco2 - 0.01)); vitalsChanged = true; }
                if (currentVitals.rr < 10 && currentVitals.rr > 0) { currentVitals.etco2 = Math.min(8.0, formatVital('etco2', currentVitals.etco2 + 0.01)); vitalsChanged = true; }

                if (newTrends.active) {
                    newTrends.elapsed += 1;
                    const progress = Math.min(1, newTrends.elapsed / newTrends.duration);
                    Object.keys(newTrends.targets).forEach(key => {
                        const startVal = newTrends.startVitals[key];
                        const targetVal = newTrends.targets[key];
                        if (startVal !== undefined && targetVal !== undefined) { currentVitals[key] = formatVital(key, startVal + ((targetVal - startVal) * progress)); }
                    });
                    if (newTrends.elapsed >= newTrends.duration) {
                        Object.keys(newTrends.targets).forEach(key => currentVitals[key] = formatVital(key, newTrends.targets[key]));
                        newTrends.active = false;
                    }
                    vitalsChanged = true;
                }

                return { ...state, vitals: vitalsChanged ? currentVitals : state.vitals, trends: newTrends, hypoxiaTimer: currentHypoxiaTimer };
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
                return { ...state, log: [...state.log, { time: timestamp, simTime, msg: action.payload.msg, type: action.payload.type, flagged: action.payload.flagged || false, timeSeconds: cs ? cs.time : 0 }] };
            case 'TOGGLE_FLAG':
                const newLog = [...state.log];
                if(newLog[action.payload]) { newLog[action.payload] = { ...newLog[action.payload], flagged: !newLog[action.payload].flagged }; }
                return { ...state, log: newLog };
            case 'TICK_TIME':
                const time = cs ? cs.time : 0;
                const vitals = cs ? cs.vitals : {};
                if (time % 5 === 0) {
                    return { ...state, history: [...state.history, { time: time, hr: vitals.hr, bp: vitals.bpSys, spo2: vitals.spO2, rr: vitals.rr }] };
                }
                return state;
            default: return state;
        }
    };

    const scenarioReducer = (state, action) => {
        switch (action.type) {
            case 'CLEAR_SESSION': return { ...initialScenarioState };
            case 'LOAD_SCENARIO': return { ...initialScenarioState, scenario: action.payload };
            case 'RESTORE_SESSION': return { scenario: action.payload.scenario, investigationsRevealed: action.payload.investigationsRevealed || {}, loadingInvestigations: action.payload.loadingInvestigations || {} };
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
            case 'CLEAR_SESSION': return { ...initialCoreState, isOffline: state.isOffline };
            case 'LOAD_SCENARIO': 
                if(!action.payload) return { ...initialCoreState, isOffline: state.isOffline };
                const initialRhythm = (action.payload.ecg && action.payload.ecg.type) ? action.payload.ecg.type : "Sinus Rhythm";
                let startICP = 10;
                if(action.payload.category === 'Trauma' && action.payload.title.includes('Head')) startICP = 25;
                return { ...initialCoreState, rhythm: initialRhythm, icp: startICP, isOffline: state.isOffline, showWetflag: action.payload.showWetflag !== false };
            case 'RESTORE_SESSION': return { ...state, ...action.payload, activeInterventions: new Set(action.payload.activeInterventions || []), processedEvents: new Set(action.payload.processedEvents || []), completedObjectives: new Set(action.payload.completedObjectives || []), isRunning: false };
            case 'START_SIM': return { ...state, isRunning: true, isFinished: false };
            case 'PAUSE_SIM': return { ...state, isRunning: false };
            case 'STOP_SIM': return { ...state, isRunning: false, isFinished: true };
            case 'SET_OFFLINE': return { ...state, isOffline: action.payload };
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

                return { ...state, time: state.time + 1, cycleTimer: state.cycleTimer + 1, activeDurations: durChanged ? newDurations : state.activeDurations, nibp: newNibp, icp: currentICP, monitorTimer: newMonitorTimer };
            
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
            case 'SYNC_FROM_MASTER': return { ...state, rhythm: action.payload.rhythm, cprInProgress: action.payload.cprInProgress, etco2Enabled: action.payload.etco2Enabled, flash: action.payload.flash, cycleTimer: action.payload.cycleTimer, activeInterventions: new Set(action.payload.activeInterventions || []), nibp: action.payload.nibp || state.nibp, speech: action.payload.speech || state.speech, soundEffect: action.payload.soundEffect || state.soundEffect, audioOutput: action.payload.audioOutput || 'monitor', arrestPanelOpen: action.payload.arrestPanelOpen !== undefined ? action.payload.arrestPanelOpen : state.arrestPanelOpen, isFinished: action.payload.isFinished || false, monitorPopup: action.payload.monitorPopup || state.monitorPopup, waveformGain: action.payload.waveformGain || 1.0, noise: action.payload.noise || { interference: false }, notification: action.payload.notification || null, remotePacerState: action.payload.remotePacerState || {rate: 0, output: 0}, pacingThreshold: action.payload.pacingThreshold || 70, lastUpdate: Date.now(), showWetflag: action.payload.showWetflag !== undefined ? action.payload.showWetflag : true, monitorTimer: action.payload.monitorTimer || state.monitorTimer };
            case 'UPDATE_ASSESSMENT': return { ...state, assessments: action.payload };
            case 'SET_FLASH': return { ...state, flash: action.payload };
            case 'START_INTERVENTION_TIMER': return { ...state, activeDurations: { ...state.activeDurations, [action.payload.key]: { startTime: state.time, duration: action.payload.duration } } };
            case 'UPDATE_INTERVENTION_STATE': return { ...state, activeInterventions: action.payload.active, interventionCounts: action.payload.counts };
            case 'REMOVE_INTERVENTION': const removedActive = new Set(state.activeInterventions); removedActive.delete(action.payload); const removedDurations = { ...state.activeDurations }; delete removedDurations[action.payload]; return { ...state, activeInterventions: removedActive, activeDurations: removedDurations };
            case 'DECREMENT_INTERVENTION': const decKey = action.payload; const decCounts = { ...state.interventionCounts }; if (decCounts[decKey] > 0) decCounts[decKey]--; return { ...state, interventionCounts: decCounts };
            case 'SET_PARALYSIS': return { ...state, isParalysed: action.payload };
            case 'TRIGGER_POPUP': return { ...state, monitorPopup: { type: action.payload, timestamp: Date.now(), customText: action.customText || null } };
            case 'CLEAR_POPUP': return { ...state, monitorPopup: { type: null, timestamp: Date.now(), customText: null } };
            case 'SET_MUTED': return { ...state, isMuted: action.payload };
            case 'TOGGLE_ETCO2': return { ...state, etco2Enabled: !state.etco2Enabled };
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
        
        const simChannel = useRef(null);
        if (simChannel.current === null) {
            simChannel.current = new BroadcastChannel('sim_channel');
        }

        useEffect(() => { stateRef.current = state; }, [state]);

        const dispatch = (action) => {
            let enhancedAction = { ...action, currentState: stateRef.current };
            
            if (action.type === 'TRIGGER_IMPROVE') {
                let impTargets = {}; 
                const scen = stateRef.current.scenario;
                const vits = stateRef.current.vitals;
                if (scen && scen.evolution && scen.evolution.improved && scen.evolution.improved.vitals) { impTargets = { ...scen.evolution.improved.vitals }; } 
                else { impTargets.hr = Math.max(60, vits.hr - 15); impTargets.bpSys = Math.min(120, vits.bpSys + 15); impTargets.spO2 = Math.min(99, vits.spO2 + 5); }
                enhancedAction = { ...enhancedAction, payload: { trends: { active: true, targets: impTargets, duration: 30, elapsed: 0, startVitals: { ...vits } } } };
                dispatchCore({ type: 'SET_FLASH', payload: 'green', currentState: stateRef.current });
            }
            if (action.type === 'TRIGGER_DETERIORATE') {
                 let detTargets = {};
                 const scen = stateRef.current.scenario;
                 const vits = stateRef.current.vitals;
                 if (scen && scen.evolution && scen.evolution.deteriorated && scen.evolution.deteriorated.vitals) { detTargets = { ...scen.evolution.deteriorated.vitals }; } 
                 else { detTargets.hr = Math.min(170, vits.hr + 20); detTargets.bpSys = Math.max(60, vits.bpSys - 20); detTargets.spO2 = Math.max(80, vits.spO2 - 10); }
                 enhancedAction = { ...enhancedAction, payload: { trends: { active: true, targets: detTargets, duration: 30, elapsed: 0, startVitals: { ...vits } } } };
                 dispatchCore({ type: 'SET_FLASH', payload: 'red', currentState: stateRef.current });
            }

            if (action.type === 'UPDATE_RHYTHM') {
                const newRhythm = action.payload;
                const isArrest = ['VF', 'VT', 'pVT', 'Asystole', 'PEA'].includes(newRhythm);
                let rhythmVitals = { ...stateRef.current.vitals };
                if (!stateRef.current.arrestPanelOpen && !isArrest) {
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

        useEffect(() => {
            simChannel.current.onmessage = (event) => {
                const data = event.data;
                if (!state.isRunning) return;

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
                    dispatch({ type: 'ADD_LOG', payload: { msg: 'Student Marked Event', type: 'manual', flagged: true } });
                } else if (data.type === 'REQUEST_12LEAD') {
                    dispatch({ type: 'ADD_LOG', payload: { msg: 'Student Requested 12-Lead', type: 'action' } });
                    simChannel.current.postMessage({ type: 'SHOW_12LEAD', payload: { rhythm: state.rhythm, scenario: state.scenario } });
                } else if (data.type === 'DEVICE_MODE') {
                    if (data.payload.mode === 'defib' || data.payload.mode === 'pacer') {
                        dispatch({ type: 'SET_ARREST_PANEL', payload: true });
                    }
                }
            };
        }, [state.isRunning, state.scenario]);

        useEffect(() => {
            if (!isMonitorMode) {
                simChannel.current.postMessage({
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
            try {
                if (window.firebase && !window.db) {
                    window.db = firebase.database();
                    window.db.ref('.info/connected').on('value', (snap) => {
                        if (snap.val() === false) dispatch({ type: 'SET_OFFLINE', payload: true });
                        else dispatch({ type: 'SET_OFFLINE', payload: false });
                    });
                }
            } catch (e) {
                console.warn("Firebase failed to load - Offline Mode Active");
                dispatch({ type: 'SET_OFFLINE', payload: true });
            }
        }, []);

        useEffect(() => {
            const db = window.db; 
            if (!db || !sessionID || isMonitorMode || !state.scenario) return; 
            const sessionRef = db.ref(`sessions/${sessionID}`);

            const payload = { 
                vitals: state.vitals, rhythm: state.rhythm, cprInProgress: state.cprInProgress, 
                etco2Enabled: state.etco2Enabled, flash: state.flash, cycleTimer: state.cycleTimer, 
                monitorTimer: state.monitorTimer,
                scenarioTitle: state.scenario.title, patientName: state.scenario.patientName,
                patientAge: state.scenario.patientAge, sex: state.scenario.sex,
                ageRange: state.scenario.ageRange, wetflag: state.scenario.wetflag || null,
                pathology: state.scenario.deterioration?.type || 'normal', 
                investigations: {
                    vbg: state.scenario.vbg || null, ecg: state.scenario.ecg || null,
                    chestXray: state.scenario.chestXray || null, urine: state.scenario.urine || null,
                    ct: state.scenario.ct || null, pocus: state.scenario.pocus || null
                }, 
                activeInterventions: Array.from(state.activeInterventions), 
                nibp: state.nibp, speech: state.speech, soundEffect: state.soundEffect, 
                audioOutput: state.audioOutput, trends: state.trends, 
                arrestPanelOpen: state.arrestPanelOpen, isFinished: state.isFinished, 
                monitorPopup: state.monitorPopup, waveformGain: state.waveformGain,
                noise: state.noise, notification: state.notification,
                remotePacerState: state.remotePacerState, pacingThreshold: state.pacingThreshold,
                showWetflag: state.showWetflag
            };

            const diff = {};
            for (const key in payload) {
                if (JSON.stringify(payload[key]) !== JSON.stringify(lastPayloadRef.current[key])) {
                    diff[key] = payload[key];
                }
            }

            if (Object.keys(diff).length > 0) {
                sessionRef.update(diff).catch(e => console.error("Sync Write Error:", e));
                lastPayloadRef.current = payload;
            }
        }, [state, isMonitorMode, sessionID]);

        useEffect(() => {
            const db = window.db; 
            if (!db || !sessionID || !isMonitorMode) return; 
            const sessionRef = db.ref(`sessions/${sessionID}`);
            const handleUpdate = (snapshot) => { 
                const data = snapshot.val(); 
                if (data) { 
                    try { dispatch({ type: 'SYNC_FROM_MASTER', payload: data }); } 
                    catch (err) { console.error("Sync Error", err); } 
                } 
            };
            sessionRef.on('value', handleUpdate);
            return () => sessionRef.off('value', handleUpdate);
        }, [isMonitorMode, sessionID]);

        useEffect(() => { if (!isMonitorMode && state.scenario && state.log.length > 0) { const serializableState = { ...state, activeInterventions: Array.from(state.activeInterventions), processedEvents: Array.from(state.processedEvents), completedObjectives: Array.from(state.completedObjectives) }; localStorage.setItem('wmebem_sim_state', JSON.stringify(serializableState)); } }, [state.vitals, state.log, isMonitorMode]);
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
                    osc.type = 'sine'; 
                    const spO2 = current.vitals.spO2;
                    let freq = 800;
                    if (spO2 < 100) { freq = Math.max(400, 400 + ((spO2 - 85) * (400/15))); }
                    osc.frequency.value = freq; 
                    osc.connect(gain); gain.connect(ctx.destination);
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

        const addLogEntry = (msg, type = 'info', flagged = false) => dispatch({ type: 'ADD_LOG', payload: { msg, type, flagged } });
        
        const applyIntervention = (key) => {
            if (key === 'ToggleETCO2') { dispatch({ type: 'TOGGLE_ETCO2' }); addLogEntry(state.etco2Enabled ? 'ETCO2 Disconnected' : 'ETCO2 Connected', 'action'); return; }
            const action = INTERVENTIONS[key]; if (!action) return;
            
            if (action.requires) {
                const missing = action.requires.filter(req => !state.activeInterventions.has(req));
                if (missing.length > 0) {
                    const reqLabel = INTERVENTIONS[missing[0]] ? INTERVENTIONS[missing[0]].label : missing[0];
                    dispatch({ type: 'SET_NOTIFICATION', payload: { msg: `Requires ${reqLabel}`, type: 'danger', id: Date.now() } });
                    return; 
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
            
            dispatch({ type: 'SET_NOTIFICATION', payload: { msg: action.label + " Administered", type: 'success', id: Date.now() } });

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
                    if (action.effect.RR === 'vent') { newVitals.rr = 14; } 
                    else if (typeof action.effect.RR === 'number') { newVitals.rr = clamp(newVitals.rr + action.effect.RR, 0, 60); }
                }
            }
            if (action.effect.SpO2) newVitals.spO2 = clamp(newVitals.spO2 + action.effect.SpO2, 0, 100); 
            
            if (action.effect.gcs) {
                if (typeof action.effect.gcs === 'string') { if (action.effect.gcs === 'sedated') newVitals.gcs = 3; } 
                else { newVitals.gcs = clamp(newVitals.gcs + action.effect.gcs, 3, 15); }
            }

            const updatedScenario = { ...state.scenario }; let updateNeeded = false;
            if ((key === 'Needle' || key === 'FingerThoracostomy') && updatedScenario.chestXray && updatedScenario.chestXray.findings.includes('Pneumothorax')) { updatedScenario.chestXray.findings = "Lung re-expanded."; updateNeeded = true; }
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
            cmdRef.on('value', handleCmd);
            return () => cmdRef.off('value', handleCmd);
        }, [isMonitorMode, sessionID]);

        const manualUpdateVital = (key, value) => { dispatch({ type: 'MANUAL_VITAL_UPDATE', payload: { key, value } }); addLogEntry(`Manual: ${key} -> ${value}`, 'manual'); };
        
        const triggerArrest = (type = 'VF') => {
            const newRhythm = type;
            dispatch({ type: 'UPDATE_VITALS', payload: { ...state.vitals, hr: 0, bpSys: 0, bpDia: 0, spO2: 0, rr: 0, gcs: 3, pupils: 'Dilated', etco2: 1.5 } });
            dispatch({ type: 'UPDATE_RHYTHM', payload: newRhythm });
            addLogEntry(`CARDIAC ARREST - ${newRhythm}`, 'manual');
            dispatch({ type: 'SET_FLASH', payload: 'red' });
        };
        
        const triggerROSC = (rhythm = 'Sinus Rhythm') => { 
            const newEtco2 = 5.5 + (Math.random() * 1.5); 
            dispatch({ type: 'UPDATE_VITALS', payload: { ...state.vitals, hr: 80, bpSys: 110, bpDia: 70, spO2: 96, rr: 16, gcs: 8, pupils: 3, etco2: newEtco2 } }); 
            dispatch({ type: 'UPDATE_RHYTHM', payload: rhythm }); 
            const updatedScenario = { ...state.scenario, deterioration: { ...state.scenario.deterioration, active: false } }; 
            dispatch({ type: 'UPDATE_SCENARIO', payload: updatedScenario }); 
            addLogEntry(`ROSC achieved (${rhythm}).`, 'success'); 
            dispatch({ type: 'SET_FLASH', payload: 'green' }); 
        };
        const revealInvestigation = (type, customText = null) => { 
            dispatch({ type: 'SET_LOADING_INVESTIGATION', payload: type }); 
            setTimeout(() => { 
                dispatch({ type: 'REVEAL_INVESTIGATION', payload: type }); 
                dispatch({ type: 'TRIGGER_POPUP', payload: type, customText: customText });
                addLogEntry(`${type} Result Available`, 'success'); 
            }, 100); 
        };
        const clearInvestigation = () => { dispatch({ type: 'CLEAR_POPUP' }); };
        const nextCycle = () => { dispatch({ type: 'FAST_FORWARD', payload: 120 }); addLogEntry('Fast Forward: +2 Minutes (Next Cycle)', 'system'); if (state.queuedRhythm) { dispatch({ type: 'UPDATE_RHYTHM', payload: state.queuedRhythm }); if (state.queuedRhythm === 'Sinus Rhythm') triggerROSC(); else addLogEntry(`Rhythm Check: Changed to ${state.queuedRhythm}`, 'manual'); dispatch({ type: 'SET_QUEUED_RHYTHM', payload: null }); } };
        const speak = (text) => { dispatch({ type: 'TRIGGER_SPEAK', payload: text }); addLogEntry(`Patient: "${text}"`, 'manual'); }; 
        const playSound = (type) => { dispatch({ type: 'TRIGGER_SOUND', payload: type }); addLogEntry(`Sound: ${type}`, 'manual'); };
        const startTrend = (targets, durationSecs) => { dispatch({ type: 'START_TREND', payload: { targets, duration: durationSecs } }); addLogEntry(`Trending vitals over ${durationSecs}s`, 'system'); };
        const triggerNIBP = () => {
            if (isMonitorMode && sessionID) { window.db.ref(`sessions/${sessionID}/command`).set({ type: 'START_NIBP', ts: Date.now() }); } 
            else { dispatch({ type: 'START_NIBP' }); }
        };
        const toggleNIBPMode = () => {
             if (isMonitorMode && sessionID) { window.db.ref(`sessions/${sessionID}/command`).set({ type: 'TOGGLE_NIBP_MODE', ts: Date.now() }); } 
             else { dispatch({ type: 'TOGGLE_NIBP_MODE' }); }
        };
        const triggerAction = (action) => {
             if (isMonitorMode && sessionID) { window.db.ref(`sessions/${sessionID}/command`).set({ type: 'TRIGGER_ACTION', payload: action, ts: Date.now() }); } 
             else { applyIntervention(action); }
        }
        
        const playInflationSound = () => { if (audioCtxRef.current && audioCtxRef.current.state === 'running') { const ctx = audioCtxRef.current; const osc = ctx.createOscillator(); const gain = ctx.createGain(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(60, ctx.currentTime); osc.frequency.linearRampToValueAtTime(50, ctx.currentTime + 5); const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 150; osc.connect(filter); filter.connect(gain); gain.connect(ctx.destination); gain.gain.setValueAtTime(0.3, ctx.currentTime); gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 4.5); gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 5); osc.start(); osc.stop(ctx.currentTime + 5); } };
        
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
        
        const toggleAudioLoop = (type) => {
            if (!audioCtxRef.current) return;
            const ctx = audioCtxRef.current;
            if (ctx.state === 'suspended') ctx.resume();
            
            if (loopNodesRef.current[type]) {
                loopNodesRef.current[type].stop(); delete loopNodesRef.current[type];
                const newLoops = {...state.activeLoops}; delete newLoops[type];
                dispatch({type: 'UPDATE_AUDIO_LOOPS', payload: newLoops});
                addLogEntry(`Audio Loop Stopped: ${type}`, 'manual');
            } else {
                const osc = ctx.createOscillator(); const gain = ctx.createGain(); const lfo = ctx.createOscillator(); const lfoGain = ctx.createGain();
                if (type === 'Wheeze') { osc.type = 'triangle'; osc.frequency.value = 400; lfo.frequency.value = 0.25; lfoGain.gain.value = 200; } 
                else if (type === 'Stridor') { osc.type = 'sawtooth'; osc.frequency.value = 600; lfo.frequency.value = 0.3; lfoGain.gain.value = 100; }
                lfo.connect(lfoGain); lfoGain.connect(osc.frequency); osc.connect(gain); gain.connect(ctx.destination);
                const now = ctx.currentTime; gain.gain.setValueAtTime(0, now); gain.gain.value = 0.05; 
                osc.start(); lfo.start();
                loopNodesRef.current[type] = { stop: () => { gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5); setTimeout(() => { osc.stop(); lfo.stop(); }, 500); } };
                dispatch({type: 'UPDATE_AUDIO_LOOPS', payload: {...state.activeLoops, [type]: true}});
                addLogEntry(`Audio Loop Started: ${type}`, 'manual');
            }
        };

        const start = () => { if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') { audioCtxRef.current.resume(); } dispatch({ type: 'START_SIM' }); };
        const pause = () => { dispatch({ type: 'PAUSE_SIM' }); };
        const stop = () => { dispatch({ type: 'STOP_SIM' }); };
        const reset = () => { dispatch({ type: 'CLEAR_SESSION' }); };
        const enableAudio = () => { if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') { audioCtxRef.current.resume(); } if (window.speechSynthesis && window.speechSynthesis.paused) { window.speechSynthesis.resume(); } };

        useEffect(() => {
            if (state.isRunning) {
                timerRef.current = setInterval(() => {
                    tickRef.current = Date.now();
                    dispatch({ type: 'TICK_TIME' }); 
                }, 1000);
            } else {
                if (timerRef.current) clearInterval(timerRef.current);
            }
            return () => { if (timerRef.current) clearInterval(timerRef.current); };
        }, [state.isRunning]);

        return { state, dispatch, start, pause, stop, reset, applyIntervention, addLogEntry, manualUpdateVital, triggerArrest, triggerROSC, revealInvestigation, clearInvestigation, nextCycle, enableAudio, speak, playSound, toggleAudioLoop, startTrend, triggerNIBP, toggleNIBPMode, triggerAction };
    };
    window.useSimulation = useSimulation;
})();
