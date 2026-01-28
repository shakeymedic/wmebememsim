// data/engine.js
(() => {
    const { useReducer, useEffect, useRef, useCallback } = React;

    const RHYTHMS = ['Sinus Rhythm', 'Sinus Tachycardia', 'Sinus Bradycardia', 'AF', 'Atrial Flutter', 'SVT', 'VT', 'VF', 'Coarse VF', 'Fine VF', 'Asystole', 'PEA', '1st Deg Block', '3rd Deg Block', 'pVT', 'Agonal Rhythm'];
    window.RHYTHMS = RHYTHMS;

    const initialState = {
        scenario: null,
        vitals: { hr: 80, bpSys: 120, bpDia: 80, rr: 16, spO2: 98, temp: 37, gcs: 15, bm: 5, pupils: 3, etco2: 4.5 },
        prevVitals: {},
        rhythm: 'Sinus Rhythm',
        time: 0,
        cycleTimer: 0,
        isRunning: false,
        isFinished: false,
        log: [],
        activeInterventions: new Set(),
        activeDurations: {},
        interventionCounts: {},
        cprInProgress: false,
        etco2Enabled: false,
        flash: null,
        arrestPanelOpen: false,
        nibp: { sys: null, dia: null, lastTaken: null, mode: 'manual', timer: 0, interval: 180, inflating: false, history: [] },
        trends: { active: false, targets: {}, duration: 0, elapsed: 0, startVitals: {} },
        speech: null,
        soundEffect: null,
        audioOutput: 'monitor',
        isMuted: false,
        processedEvents: new Set(),
        completedObjectives: new Set(),
        monitorPopup: null,
        waveformGain: 1.0,
        noise: {},
        notification: null,
        notifications: { investigation: null },
        remotePacerState: null,
        pacingThreshold: 70,
        icp: 10,
        hypoxiaTimer: 0,
        assessments: {},
        showWetflag: true,
        showTimerOnMonitor: true,
        isOffline: false
    };

    const reducer = (state, action) => {
        switch (action.type) {
            case 'INIT_SCENARIO':
                const initialRhythm = action.payload.ecg && action.payload.ecg.type ? action.payload.ecg.type : "Sinus Rhythm";
                const initialVitals = { etco2: 4.5, temp: 36.5, bm: 5.5, ...action.payload.vitals };
                let startICP = 10;
                if (action.payload.category === 'Trauma' && action.payload.title && action.payload.title.includes('Head')) startICP = 25;
                return { 
                    ...initialState, 
                    scenario: action.payload, 
                    vitals: initialVitals, 
                    prevVitals: {...initialVitals}, 
                    rhythm: initialRhythm, 
                    nibp: { sys: null, dia: null, lastTaken: null, mode: 'manual', timer: 0, interval: 180, inflating: false, history: [] }, 
                    processedEvents: new Set(), 
                    activeInterventions: new Set(), 
                    arrestPanelOpen: false, 
                    pacingThreshold: window.getRandomInt ? window.getRandomInt(40, 95) : 70, 
                    icp: startICP,
                    isOffline: state.isOffline,
                    showWetflag: true,
                    showTimerOnMonitor: true
                };
                
            case 'RESTORE_SESSION': 
                return { 
                    ...action.payload, 
                    activeInterventions: new Set(action.payload.activeInterventions || []), 
                    processedEvents: new Set(action.payload.processedEvents || []), 
                    completedObjectives: new Set(action.payload.completedObjectives || []), 
                    isRunning: false 
                };
            
            case 'START': return { ...state, isRunning: true, isFinished: false };
            case 'STOP': return { ...state, isRunning: false };
            case 'FINISH': return { ...state, isRunning: false, isFinished: true };
            case 'RESET': return { ...initialState, isOffline: state.isOffline };
            
            case 'TICK_TIME':
                const newDurations = { ...state.activeDurations }; 
                let durChanged = false;
                Object.keys(newDurations).forEach(key => { 
                    const elapsed = state.time + 1 - newDurations[key].startTime; 
                    if (elapsed >= newDurations[key].duration) { 
                        delete newDurations[key]; 
                        durChanged = true; 
                    } 
                });
                
                let newNibp = { ...state.nibp }; 
                if (newNibp.mode === 'auto') { 
                    newNibp.timer -= 1; 
                }

                let newTrends = { ...state.trends };
                let currentVitals = { ...state.vitals };
                let vitalsChanged = false;
                let currentICP = state.icp;
                let currentHypoxiaTimer = state.hypoxiaTimer;

                // --- PHYSIOLOGY ENGINE ---
                if (currentVitals.rr < 8 && currentVitals.rr > 0 && !state.activeInterventions.has('Bagging')) {
                    currentHypoxiaTimer++;
                    if (currentHypoxiaTimer > 30) {
                        currentVitals.spO2 = Math.max(40, currentVitals.spO2 - 0.5); 
                        vitalsChanged = true;
                    }
                } else {
                    currentHypoxiaTimer = 0;
                    if (state.activeInterventions.has('Oxygen') && currentVitals.spO2 < 95) {
                        currentVitals.spO2 += 0.2;
                        vitalsChanged = true;
                    }
                }

                if (state.scenario && state.scenario.deterioration && state.scenario.deterioration.type === 'neuro' && state.isRunning) {
                    if (state.time % 10 === 0) currentICP += 0.1; 
                    if (currentICP > 25) {
                        currentVitals.bpSys = Math.min(220, currentVitals.bpSys + 0.2);
                        currentVitals.hr = Math.max(30, currentVitals.hr - 0.1);
                        vitalsChanged = true;
                    }
                }

                if (currentVitals.rr > 30) {
                    currentVitals.etco2 = Math.max(2.5, currentVitals.etco2 - 0.01); 
                    vitalsChanged = true;
                }
                if (currentVitals.rr < 10 && currentVitals.rr > 0) {
                    currentVitals.etco2 = Math.min(9.0, currentVitals.etco2 + 0.02); 
                    vitalsChanged = true;
                }

                // --- TREND PROCESSING (Goal Obs Over Time) ---
                if (newTrends.active && newTrends.duration > 0) {
                    newTrends.elapsed += 1;
                    const progress = Math.min(newTrends.elapsed / newTrends.duration, 1);
                    
                    Object.keys(newTrends.targets).forEach(key => {
                        const start = newTrends.startVitals[key];
                        const target = newTrends.targets[key];
                        if (start !== undefined && target !== undefined) {
                            // Use easing function for smoother transitions
                            const easeProgress = 1 - Math.pow(1 - progress, 2); // Ease out quad
                            currentVitals[key] = Math.round((start + (target - start) * easeProgress) * 10) / 10;
                            vitalsChanged = true;
                        }
                    });

                    if (progress >= 1) {
                        // Ensure final values match targets exactly
                        Object.keys(newTrends.targets).forEach(key => {
                            if (newTrends.targets[key] !== undefined) {
                                currentVitals[key] = newTrends.targets[key];
                            }
                        });
                        newTrends = { ...newTrends, active: false, elapsed: 0 };
                    }
                }

                return { 
                    ...state, 
                    time: state.time + 1, 
                    cycleTimer: state.cprInProgress ? state.cycleTimer + 1 : 0, 
                    activeDurations: newDurations, 
                    nibp: newNibp, 
                    trends: newTrends, 
                    vitals: currentVitals, 
                    icp: currentICP, 
                    hypoxiaTimer: currentHypoxiaTimer 
                };

            case 'UPDATE_VITALS':
                return { ...state, prevVitals: { ...state.vitals }, vitals: { ...state.vitals, ...action.payload } };
            
            case 'UPDATE_RHYTHM':
                return { ...state, rhythm: action.payload };
            
            case 'ADD_LOG':
                const formatTime = (s) => `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
                return { ...state, log: [...state.log, { simTime: formatTime(state.time), realTime: new Date().toLocaleTimeString(), msg: action.payload.msg, type: action.payload.type || 'info', flagged: action.payload.flagged || false }] };
            
            case 'ADD_INTERVENTION':
                const newActive = new Set(state.activeInterventions);
                newActive.add(action.payload.key);
                const newCounts = { ...state.interventionCounts };
                newCounts[action.payload.key] = (newCounts[action.payload.key] || 0) + 1;
                const newDur = { ...state.activeDurations };
                if (action.payload.duration > 0) {
                    newDur[action.payload.key] = { startTime: state.time, duration: action.payload.duration };
                }
                return { ...state, activeInterventions: newActive, interventionCounts: newCounts, activeDurations: newDur };
            
            case 'REMOVE_INTERVENTION':
                const rmActive = new Set(state.activeInterventions);
                rmActive.delete(action.payload);
                const rmDur = { ...state.activeDurations };
                delete rmDur[action.payload];
                return { ...state, activeInterventions: rmActive, activeDurations: rmDur };
            
            case 'DECREMENT_INTERVENTION':
                const decCounts = { ...state.interventionCounts };
                if (decCounts[action.payload] > 0) decCounts[action.payload] -= 1;
                return { ...state, interventionCounts: decCounts };

            case 'TOGGLE_CPR': return { ...state, cprInProgress: !state.cprInProgress, cycleTimer: 0 };
            case 'TOGGLE_ETCO2': return { ...state, etco2Enabled: !state.etco2Enabled };
            case 'SET_FLASH': return { ...state, flash: action.payload };
            case 'SET_MUTED': return { ...state, isMuted: action.payload };
            case 'SET_ARREST_PANEL': return { ...state, arrestPanelOpen: action.payload };
            case 'TOGGLE_WETFLAG': return { ...state, showWetflag: !state.showWetflag };
            case 'TOGGLE_MONITOR_TIMER': return { ...state, showTimerOnMonitor: !state.showTimerOnMonitor };

            case 'REQUEST_12LEAD':
                return { ...state, monitorPopup: { type: '12lead', timestamp: Date.now() } };
            
            case 'SEND_INVESTIGATION':
                return { ...state, notifications: { ...state.notifications, investigation: { id: Date.now(), title: action.payload.title, content: action.payload.content } } };
            
            case 'CLOSE_INVESTIGATION':
                return { ...state, notifications: { ...state.notifications, investigation: null } };

            case 'TRIGGER_IMPROVE':
                let impTargets = {}; 
                if (state.scenario && state.scenario.evolution && state.scenario.evolution.improved && state.scenario.evolution.improved.vitals) {
                    impTargets = { ...state.scenario.evolution.improved.vitals };
                } else {
                    impTargets.hr = Math.max(60, state.vitals.hr - 15);
                    impTargets.bpSys = Math.min(120, state.vitals.bpSys + 15);
                    impTargets.spO2 = Math.min(99, state.vitals.spO2 + 5);
                }
                return { ...state, trends: { active: true, targets: impTargets, duration: 30, elapsed: 0, startVitals: { ...state.vitals } }, flash: 'green' };
            
            case 'TRIGGER_DETERIORATE':
                let detTargets = {};
                if (state.scenario && state.scenario.evolution && state.scenario.evolution.deteriorated && state.scenario.evolution.deteriorated.vitals) {
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
                const now = new Date();
                const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
                const newEntry = { sys: safeSys, dia: safeDia, time: timeStr };
                const newHistoryArr = [newEntry, ...(state.nibp.history || [])].slice(0, 3);
                return { ...state, nibp: { ...state.nibp, sys: safeSys, dia: safeDia, lastTaken: Date.now(), timer: state.nibp.interval, inflating: false, history: newHistoryArr } };
            
            case 'TOGGLE_NIBP_MODE': 
                const newMode = state.nibp.mode === 'manual' ? 'auto' : 'manual'; 
                return { ...state, nibp: { ...state.nibp, mode: newMode, timer: newMode === 'auto' ? state.nibp.interval : 0 } };

            case 'START_TREND': 
                return { ...state, trends: { active: true, targets: action.payload.targets, duration: action.payload.duration, elapsed: 0, startVitals: { ...state.vitals } } };
            case 'STOP_TREND': 
                return { ...state, trends: { ...state.trends, active: false, elapsed: 0 } };

            case 'TRIGGER_SPEAK': 
                return { ...state, speech: { text: action.payload, timestamp: Date.now(), source: 'controller' } };
            case 'TRIGGER_SOUND': 
                return { ...state, soundEffect: { type: action.payload, timestamp: Date.now() } };
            case 'SET_AUDIO_OUTPUT': 
                return { ...state, audioOutput: action.payload };
            
            case 'SYNC_FROM_MASTER': 
                const syncedScenario = { 
                    ...state.scenario, 
                    title: action.payload.scenarioTitle, 
                    ageRange: action.payload.ageRange,
                    wetflag: action.payload.wetflag,
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
                    arrestPanelOpen: action.payload.arrestPanelOpen !== undefined ? action.payload.arrestPanelOpen : state.arrestPanelOpen,
                    isFinished: action.payload.isFinished !== undefined ? action.payload.isFinished : state.isFinished,
                    monitorPopup: action.payload.monitorPopup || state.monitorPopup,
                    waveformGain: action.payload.waveformGain || state.waveformGain,
                    noise: action.payload.noise || state.noise,
                    notification: action.payload.notification || state.notification,
                    notifications: action.payload.notifications || state.notifications,
                    remotePacerState: action.payload.remotePacerState || state.remotePacerState,
                    pacingThreshold: action.payload.pacingThreshold || state.pacingThreshold,
                    showWetflag: action.payload.showWetflag !== undefined ? action.payload.showWetflag : state.showWetflag,
                    showTimerOnMonitor: action.payload.showTimerOnMonitor !== undefined ? action.payload.showTimerOnMonitor : state.showTimerOnMonitor,
                    time: action.payload.time !== undefined ? action.payload.time : state.time
                };

            case 'UPDATE_ASSESSMENT':
                return { ...state, assessments: action.payload };

            case 'COMPLETE_OBJECTIVE':
                const newCompleted = new Set(state.completedObjectives);
                newCompleted.add(action.payload);
                return { ...state, completedObjectives: newCompleted };

            case 'SET_OFFLINE':
                return { ...state, isOffline: action.payload };

            default: return state;
        }
    };

    const useSimulation = (initialScenario = null, isMonitorMode = false, sessionID = null) => {
        const [state, dispatch] = useReducer(reducer, initialState);
        const tickRef = useRef(null);
        const audioCtxRef = useRef(null);
        const lastCmdRef = useRef(0);

        // Initialize audio context
        useEffect(() => {
            const initAudio = () => {
                if (!audioCtxRef.current) {
                    const AudioCtx = window.AudioContext || window.webkitAudioContext;
                    if (AudioCtx) audioCtxRef.current = new AudioCtx();
                }
            };
            document.addEventListener('click', initAudio, { once: true });
            return () => document.removeEventListener('click', initAudio);
        }, []);

        // Main timer tick
        useEffect(() => {
            if (state.isRunning && !isMonitorMode) {
                tickRef.current = setInterval(() => dispatch({ type: 'TICK_TIME' }), 1000);
            }
            return () => { if (tickRef.current) clearInterval(tickRef.current); };
        }, [state.isRunning, isMonitorMode]);

        // Clear flash
        useEffect(() => {
            if (state.flash) {
                const timer = setTimeout(() => dispatch({ type: 'SET_FLASH', payload: null }), 2000);
                return () => clearTimeout(timer);
            }
        }, [state.flash]);

        // Firebase sync for controller
        useEffect(() => {
            if (!isMonitorMode && sessionID && window.db) {
                const sessionRef = window.db.ref(`sessions/${sessionID}`);
                
                const investigations = {
                    vbg: state.scenario?.vbg || null,
                    ecg: state.scenario?.ecg || null,
                    chestXray: state.scenario?.chestXray || null,
                    urine: state.scenario?.urine || null,
                    ct: state.scenario?.ct || null,
                    pocus: state.scenario?.pocus || null
                };

                const payload = { 
                    vitals: state.vitals, 
                    rhythm: state.rhythm, 
                    cprInProgress: state.cprInProgress, 
                    etco2Enabled: state.etco2Enabled, 
                    flash: state.flash, 
                    cycleTimer: state.cycleTimer, 
                    scenarioTitle: state.scenario?.title || '', 
                    ageRange: state.scenario?.ageRange || 'Adult',
                    wetflag: state.scenario?.wetflag || null,
                    pathology: state.scenario?.deterioration?.type || 'normal', 
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
                    notifications: state.notifications,
                    remotePacerState: state.remotePacerState,
                    pacingThreshold: state.pacingThreshold,
                    showWetflag: state.showWetflag,
                    showTimerOnMonitor: state.showTimerOnMonitor,
                    time: state.time
                };
                sessionRef.set(payload).catch(e => console.error("Sync Write Error:", e));

                const cmdRef = window.db.ref(`sessions/${sessionID}/command`);
                cmdRef.on('value', (snap) => {
                    const val = snap.val();
                    if (val && val.ts > lastCmdRef.current) {
                        lastCmdRef.current = val.ts;
                        if (val.type === 'START_NIBP') dispatch({ type: 'START_NIBP' });
                        if (val.type === 'TOGGLE_NIBP_MODE') dispatch({ type: 'TOGGLE_NIBP_MODE' });
                    }
                });
                return () => cmdRef.off();
            }
        }, [state, isMonitorMode, sessionID]);

        // Firebase sync for monitor
        useEffect(() => {
            if (isMonitorMode && sessionID && window.db) {
                const sessionRef = window.db.ref(`sessions/${sessionID}`);
                sessionRef.on('value', (snap) => {
                    const val = snap.val();
                    if (val) {
                        dispatch({ type: 'SYNC_FROM_MASTER', payload: val });
                    }
                });
                return () => sessionRef.off();
            }
        }, [isMonitorMode, sessionID]);

        // Auto NIBP cycling
        useEffect(() => {
            if (state.nibp.timer <= 0 && state.nibp.mode === 'auto' && state.isRunning && !state.nibp.inflating) {
                dispatch({ type: 'START_NIBP' });
            }
            if (state.nibp.inflating) {
                const timeout = setTimeout(() => dispatch({ type: 'COMMIT_NIBP' }), 5000);
                return () => clearTimeout(timeout);
            }
        }, [state.nibp.timer, state.isRunning, state.nibp.inflating, state.nibp.mode]);

        // Play medical sounds
        const playMedicalSound = useCallback((type) => {
            if (!audioCtxRef.current || state.isMuted) return;
            const ctx = audioCtxRef.current;
            if (ctx.state === 'suspended') ctx.resume();
            
            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);
            const now = ctx.currentTime;
            
            switch(type) {
                case 'beep':
                    oscillator.frequency.setValueAtTime(1000, now);
                    gainNode.gain.setValueAtTime(0.3, now);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
                    oscillator.start(now);
                    oscillator.stop(now + 0.1);
                    break;
                case 'alarm':
                    oscillator.frequency.setValueAtTime(800, now);
                    oscillator.frequency.setValueAtTime(600, now + 0.2);
                    oscillator.frequency.setValueAtTime(800, now + 0.4);
                    gainNode.gain.setValueAtTime(0.4, now);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
                    oscillator.start(now);
                    oscillator.stop(now + 0.6);
                    break;
                case 'charge':
                    oscillator.frequency.setValueAtTime(400, now);
                    oscillator.frequency.linearRampToValueAtTime(800, now + 2);
                    gainNode.gain.setValueAtTime(0.3, now);
                    oscillator.start(now);
                    oscillator.stop(now + 2);
                    break;
                case 'shock':
                    oscillator.frequency.setValueAtTime(100, now);
                    gainNode.gain.setValueAtTime(0.5, now);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
                    oscillator.start(now);
                    oscillator.stop(now + 0.3);
                    break;
            }
        }, [state.isMuted]);

        // Sound effect handling
        const lastSoundRef = useRef(0);
        useEffect(() => { 
            if (state.soundEffect && state.soundEffect.timestamp > lastSoundRef.current) { 
                lastSoundRef.current = state.soundEffect.timestamp; 
                if (!state.isRunning) return;
                const shouldPlay = (isMonitorMode && (state.audioOutput === 'monitor' || state.audioOutput === 'both')) || (!isMonitorMode && (state.audioOutput === 'controller' || state.audioOutput === 'both')); 
                if (shouldPlay && audioCtxRef.current) playMedicalSound(state.soundEffect.type);
            } 
        }, [state.soundEffect, isMonitorMode, state.audioOutput, state.isRunning, playMedicalSound]);

        // Speech synthesis handling
        const lastSpeechRef = useRef(0);
        useEffect(() => { 
            if (state.speech && state.speech.timestamp > lastSpeechRef.current) { 
                if (Date.now() - state.speech.timestamp > 8000) { 
                    lastSpeechRef.current = state.speech.timestamp; 
                    return; 
                } 
                lastSpeechRef.current = state.speech.timestamp; 
                if (!state.isRunning) return;
                const shouldPlay = (isMonitorMode && (state.audioOutput === 'monitor' || state.audioOutput === 'both')) || (!isMonitorMode && (state.audioOutput === 'controller' || state.audioOutput === 'both')); 
                if (shouldPlay && 'speechSynthesis' in window) { 
                    window.speechSynthesis.cancel(); 
                    if (window.speechSynthesis.paused) window.speechSynthesis.resume(); 
                    const utterance = new SpeechSynthesisUtterance(state.speech.text); 
                    const voices = window.speechSynthesis.getVoices(); 
                    if (voices.length > 0) utterance.voice = voices[0]; 
                    window.speechSynthesis.speak(utterance); 
                } 
            } 
        }, [state.speech, isMonitorMode, state.audioOutput, state.isRunning]);

        // Session persistence
        useEffect(() => { 
            if (!isMonitorMode && state.scenario && state.log.length > 0) { 
                const serializableState = { 
                    ...state, 
                    activeInterventions: Array.from(state.activeInterventions), 
                    processedEvents: Array.from(state.processedEvents),
                    completedObjectives: Array.from(state.completedObjectives)
                };
                try {
                    localStorage.setItem('wmebem_sim_state', JSON.stringify(serializableState));
                } catch (e) {
                    console.warn('Failed to save state:', e);
                }
            }
        }, [state, isMonitorMode]);

        const start = () => dispatch({ type: 'START' });
        const stop = () => dispatch({ type: 'STOP' });
        const finish = () => dispatch({ type: 'FINISH' });
        const reset = () => {
            dispatch({ type: 'RESET' });
            try {
                localStorage.removeItem('wmebem_sim_state');
            } catch (e) {
                console.warn('Failed to clear state:', e);
            }
        };
        const loadScenario = (scenario) => dispatch({ type: 'INIT_SCENARIO', payload: scenario });

        return { 
            state, 
            dispatch, 
            start, 
            stop, 
            finish,
            reset, 
            loadScenario, 
            playSound: playMedicalSound 
        };
    };

    window.useSimulation = useSimulation;
    window.RHYTHMS = RHYTHMS;
})();
