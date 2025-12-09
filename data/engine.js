// data/engine.js
(() => {
    const { useState, useEffect, useRef, useReducer } = React;
    const { INTERVENTIONS, calculateDynamicVbg, getRandomInt, clamp } = window;

    const initialState = {
        scenario: null, time: 0, cycleTimer: 0, isRunning: false,
        vitals: { etco2: 4.5 }, rhythm: "Sinus Rhythm", log: [], flash: null, 
        activeInterventions: new Set(), interventionCounts: {}, activeDurations: {},
        isMuted: false, etco2Enabled: false, isParalysed: false, queuedRhythm: null, cprInProgress: false,
        nibp: { sys: null, dia: null, lastTaken: null, mode: 'manual', timer: 0, interval: 3 * 60, inflating: false },
        trends: { active: false, targets: {}, duration: 0, elapsed: 0, startVitals: {} },
        speech: { text: null, timestamp: 0, source: null },
        soundEffect: { type: null, timestamp: 0 },
        audioOutput: 'monitor', arrestPanelOpen: false, monitorPopup: { type: null, timestamp: 0 },
        // NEW STATE
        waveformGain: 1.0,
        noise: { interference: false },
        remotePacerState: { rate: 0, output: 0 }
    };

    const simReducer = (state, action) => {
       switch (action.type) {
            case 'START_SIM': return { ...state, isRunning: true, log: [...state.log, { time: new Date().toLocaleTimeString(), simTime: '00:00', msg: "Simulation Started", type: 'system' }] };
            case 'PAUSE_SIM': return { ...state, isRunning: false };
            case 'LOAD_SCENARIO': return { ...initialState, scenario: action.payload, vitals: { etco2: 4.5, ...action.payload.vitals }, rhythm: action.payload.ecg?.type || "Sinus Rhythm" };
            case 'TICK_TIME': return { ...state, time: state.time + 1, cycleTimer: state.cycleTimer + 1 };
            case 'UPDATE_VITALS': return { ...state, vitals: action.payload };
            case 'UPDATE_RHYTHM': return { ...state, rhythm: action.payload };
            case 'ADD_LOG': return { ...state, log: [...state.log, { time: new Date().toLocaleTimeString(), simTime: 'XX:XX', msg: action.payload.msg, type: action.payload.type }] };
            case 'SET_FLASH': return { ...state, flash: action.payload };
            
            // NEW ACTIONS
            case 'SET_GAIN': return { ...state, waveformGain: action.payload };
            case 'TOGGLE_INTERFERENCE': return { ...state, noise: { ...state.noise, interference: !state.noise.interference } };
            case 'UPDATE_PACER_STATE': return { ...state, remotePacerState: action.payload };
            
            // ... existing cases (SYNC_FROM_MASTER, etc) ...
            case 'SYNC_FROM_MASTER': return { ...state, ...action.payload }; // simplified for brevity
            default: return state;
        }
    };

    const useSimulation = (initialScenario, isMonitorMode = false, sessionID = null) => {
        const [state, dispatch] = useReducer(simReducer, initialState);
        const timerRef = useRef(null);
        const simChannel = useRef(new BroadcastChannel('sim_channel'));

        // --- TELEMETRY LISTENER ---
        useEffect(() => {
            simChannel.current.onmessage = (event) => {
                const data = event.data;
                if (!state.isRunning) return;

                if (data.type === 'PACER_UPDATE') {
                    dispatch({ type: 'UPDATE_PACER_STATE', payload: data.payload });
                    // Optional: Log significant changes?
                } else if (data.type === 'CHARGE_INIT') {
                    dispatch({ type: 'SET_FLASH', payload: 'yellow' }); // Visual alert
                    dispatch({ type: 'ADD_LOG', payload: { msg: `Defib Charging (${data.payload.energy}J)`, type: 'warning' } });
                    setTimeout(() => dispatch({ type: 'SET_FLASH', payload: null }), 1000);
                } else if (data.type === 'SHOCK_DELIVERED') {
                    dispatch({ type: 'SET_FLASH', payload: 'red' });
                    dispatch({ type: 'ADD_LOG', payload: { msg: `Shock Delivered ${data.payload.energy}J`, type: 'danger' } });
                    setTimeout(() => dispatch({ type: 'SET_FLASH', payload: null }), 500);
                } else if (data.type === 'ALARM_SILENCE') {
                    dispatch({ type: 'ADD_LOG', payload: { msg: 'Alarm Silenced by Student', type: 'info' } });
                } else if (data.type === 'MARKER_EVENT') {
                    dispatch({ type: 'ADD_LOG', payload: { msg: 'Student Marked Event', type: 'manual' } });
                } else if (data.type === 'REQUEST_12LEAD') {
                    dispatch({ type: 'ADD_LOG', payload: { msg: 'Student Requested 12-Lead', type: 'action' } });
                    // Push if available
                    if (state.scenario && state.scenario.investigations && state.scenario.investigations.ecg) {
                        // Assuming ecg.image is a URL. If not, use a placeholder or handle accordingly.
                        // Ideally your scenario data has an image URL.
                        const imgUrl = state.scenario.investigations.ecg.image || "https://placeholder.com/ecg.png"; 
                        simChannel.current.postMessage({ type: 'SHOW_12LEAD', payload: imgUrl });
                    }
                }
            };
        }, [state.isRunning, state.scenario]);

        // --- SYNC OUT ---
        useEffect(() => {
            if (!isMonitorMode) {
                // Broadcast vital/waveform updates to Defib
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
                        interference: state.noise.interference
                    }
                });
            }
        }, [state.vitals, state.rhythm, state.waveformGain, state.noise]);

        // ... start/stop/tick functions ...
        const start = () => { if (state.isRunning) return; dispatch({ type: 'START_SIM' }); timerRef.current = setInterval(() => dispatch({ type: 'TICK_TIME' }), 1000); };
        const pause = () => { dispatch({ type: 'PAUSE_SIM' }); clearInterval(timerRef.current); };
        
        // ... expose utils ...
        const triggerAction = (act) => dispatch({type: 'TRIGGER_ACTION', payload: act}); // Generic handler

        return { state, dispatch, start, pause, triggerAction };
    };
    window.useSimulation = useSimulation;
})();
