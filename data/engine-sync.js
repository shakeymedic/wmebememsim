(() => {
    // THE SIMULATION ENGINE: LIVE SESSION SYNC. Learner device presses, publishing the patient to
    // sessions/<CODE>/live, the room monitor's listener, presence, the defib mirror and the resume
    // snapshot in this browser.
    // Called by useSimulation (data/engine.js) at a fixed point on every render, so its hooks keep
    // their order. It receives what it uses from the rest of the engine and returns what the rest
    // of the engine uses (both lists generated from a scope analysis of the original code).
    const { useState, useEffect, useRef } = React;
    const RG = window.RHYTHMS;
    const {
        DEFAULT_VITALS, getObstruction, sanitizeForRealtimeDatabase
    } = window.__EngineModel;

    const useSessionSync = (ctx) => {
        const {
            addLogEntry, analyseRhythm, deliverShock, dispatch, initCharge, isAudioLive, isMonitorMode,
            lastPayloadRef, postToChannel, sessionID, setDefibEnergy, setDefibMode, simChannel, start, state,
            stateRef, toggleCPR
        } = ctx;

        // Defib Sim: the clock starts itself at the learner's first action, so a forgotten START
        // does not leave every event in the log at 00:00. Not after a deliberate facilitator pause
        // (pausedAt is set only by PAUSE_SIM), and not for display-only presses.
        const PASSIVE_DEVICE_EVENTS = ['LEAD_CHANGE', 'SIZE_CHANGE', 'ALARM_SILENCE', 'REQUEST_SYNC'];
        const autoStartClock = (type, p) => {
            const cur = stateRef.current;
            if (!cur || !cur.scenario || !cur.scenario.defibSim) return;
            if (cur.isRunning || cur.isFinished) return;
            if (cur.pausedAt !== null && cur.pausedAt !== undefined) return;
            if (PASSIVE_DEVICE_EVENTS.indexOf(type) !== -1) return;
            if (type === 'DEVICE_MODE' && p && p.mode === 'off') return;
            addLogEntry('Clock started automatically at the learner\'s first action on the defibrillator.', 'system');
            start();
        };

        // ONE handler for every press on a learner's defibrillator, however it arrived: over the
        // live session (a tablet anywhere) or the same-browser channel (a defib in another tab).
        // Presses are acted on whether or not the clock is running, so a forgotten START never
        // silently drops a learner's shock.
        const handleDeviceEvent = (type, p, where) => {
            const cur = stateRef.current;
            p = p || {};
            const src = `student (${where})`;
            autoStartClock(type, p);
            switch (type) {
                case 'DEVICE_MODE': setDefibMode(p.mode, src); break;
                case 'ENERGY_SELECT': setDefibEnergy(p.energy, src); break;
                case 'SYNC_TOGGLE': dispatch({ type: 'SET_DEFIB_STATE', payload: { syncMode: !!p.sync } });
                    addLogEntry(`SYNC ${p.sync ? 'ON' : 'OFF'} (${src})${p.sync && RG.isPulseless(cur.rhythm) ? ' — armed in a pulseless rhythm; the device will not discharge. Flagged.' : ''}`,
                        p.sync && RG.isPulseless(cur.rhythm) ? 'warning' : 'action', !!(p.sync && RG.isPulseless(cur.rhythm)));
                    break;
                case 'CHARGE_INIT': initCharge(p.energy); break;
                case 'SHOCK_DELIVERED': deliverShock(p.energy, src, { sync: !!p.sync }); break;
                case 'ANALYSE':
                case 'ANALYSIS_RESULT': analyseRhythm(src); break;       // judged here, from the controller's rhythm
                case 'PACER_UPDATE': dispatch({ type: 'UPDATE_PACER_STATE', payload: { rate: Number(p.rate) || 0, output: Number(p.output) || 0, demand: p.demand !== false } }); break;
                case 'CHECK_PULSE': addLogEntry(`Student checked pulse (${where})`, 'action'); break;
                case 'CPR_TOGGLE': toggleCPR(!!p.on, src); break;
                case 'MARKER_EVENT': addLogEntry(`Student marked event (${where})`, 'manual', true); break;
                case 'ALARM_SILENCE': addLogEntry(`Alarm silenced by student (${where})`, 'info'); break;
                case 'REQUEST_12LEAD': addLogEntry(`Student requested 12-lead (${where})`, 'action'); break;
                case 'LEAD_CHANGE': addLogEntry(`Monitoring lead changed to ${String(p.lead || '?').slice(0, 8)} (${where})`, 'action'); break;
                case 'SIZE_CHANGE': addLogEntry(`ECG size x${Number(p.gain) || 1} (${where})`, 'info'); break;
                default: addLogEntry(`Unhandled student device event: ${String(type).slice(0, 40)}`, 'system'); break;
            }
        };

        // The same-browser channel: registered once; everything is read live through stateRef.
        useEffect(() => {
            if (isMonitorMode || !simChannel.current) return;
            simChannel.current.onmessage = (event) => {
                const data = event.data || {};
                // A defib opened mid-scenario asks for the patient straight away.
                if (data.type === 'REQUEST_SYNC') {
                    postToChannel({ type: 'SYNC_VITALS', payload: buildDefibSyncPayloadRef.current() });
                    return;
                }
                if (data.type === 'SYNC_VITALS' || typeof data.type !== 'string') return;
                handleDeviceEvent(data.type, data.payload, 'standalone defib');
            };
            return () => { if (simChannel.current) simChannel.current.onmessage = null; };
        }, [isMonitorMode]);

        // The standalone defib page previously received rhythm + 5 numbers and NOTHING
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
                defibView: defibViewFor(cur),
                // Capnography for the tablet's CO2 trace: attached or not, whether gas is moving,
                // the breath rate and the same shape (pattern + obstruction severity) the monitor draws.
                capno: (() => {
                    const obstruction = cur.scenario ? getObstruction(cur, cur.vitals, cur.scenario) : null;
                    return {
                        on: !!cur.etco2Enabled,
                        ventilating: RG.capnoVentilating(cur.activeInterventions, cur.vitals.rr, !!cur.cprInProgress),
                        rr: Number(cur.vitals.rr) || 0,
                        pattern: cur.etco2Pathology || 'normal',
                        severity: obstruction && Number.isFinite(obstruction.severity) ? obstruction.severity : 0
                    };
                })()
            };
        };
        const buildDefibSyncPayloadRef = useRef(buildDefibSyncPayload);
        buildDefibSyncPayloadRef.current = buildDefibSyncPayload;

        useEffect(() => {
            if (!isMonitorMode) {
                postToChannel({ type: 'SYNC_VITALS', payload: buildDefibSyncPayload() });
            }
        }, [state.vitals, state.rhythm, state.waveformGain, state.noise, state.pacingThreshold, state.audioOutput,
            state.cprInProgress, state.isRunning, state.isFinished, state.scenario, state.defib, state.pacing, state.metronomeOn,
            state.etco2Enabled, state.etco2Pathology, state.activeInterventions]);

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
                // The obstruction severity behind the shark fin is computed HERE,
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
                    // The assessor's Defib open/close toggle, and the defib device state the
                    // student's monitor-hosted defibrillator renders (mode, selected energy, charge
                    // state, SYNC, running shock tally).
                    //
                    // B4 LEAK BARRIER — DO NOT ADD `rhythmEvent`, `lastConversion` OR ANY
                    // CONVERSION ANNOUNCEMENT TO THIS PAYLOAD. `notification` below is rendered on
                    // the STUDENT monitor; conversion announcements are assessor-only by design and
                    // The rules test (tests/specs/rules.spec.js) lists every key this object may carry.
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
                    // BM / Temp / pH ride inside `vitals` (verified by the sync payload test);
                    // activeDrugs and deteriorationMode are top-level, primitives only, never undefined,
                    // so sanitizeForRealtimeDatabase passes them through untouched.
                    activeDrugs: Array.isArray(cur.activeDrugs) ? cur.activeDrugs : [],
                    deteriorationMode: cur.deteriorationMode || 'manual',
                    // K+ rides inside `vitals` like temp/bm/ph AND is published as its
                    // own TOP-LEVEL key, because the write diff is shallow and per-key: a lab value
                    // the student monitor renders must never be undefined or NaN on the wire.
                    potassium: (cur.vitals && Number.isFinite(cur.vitals.k)) ? cur.vitals.k : DEFAULT_VITALS.k,
                    // Which sensors are attached already rides on the wire inside
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
        // PRESENCE / CONNECTION INDICATOR.
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
        // STUDENT DEVICE EVENTS.
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
                handleDeviceEvent(ev.type, ev.payload, ev.device === 'standalone-defib' ? 'standalone defib' : 'monitor defib');
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
                        // The per-run id travels with the snapshot so a resumed session reopens
                        // the same instructor notes instead of a blank set.
                        runId: cur.runId || null,
                        rhythm: cur.rhythm, time: cur.time, cycleTimer: cur.cycleTimer,
                        activeInterventions: Array.from(cur.activeInterventions),
                        interventionCounts: cur.interventionCounts, activeDurations: cur.activeDurations,
                        completedObjectives: Array.from(cur.completedObjectives),
                        log: cur.log.slice(-200), // recent log only
                        nibp: cur.nibp, etco2Enabled: cur.etco2Enabled, isParalysed: cur.isParalysed, paralysis: cur.paralysis,
                        showWetflag: cur.showWetflag, icp: cur.icp,
                        // Shock count / cumulative energy must survive a resume.
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

        return {
            sendDeviceEvent
        };
    };

    window.__EngineSync = { useSessionSync };
})();
