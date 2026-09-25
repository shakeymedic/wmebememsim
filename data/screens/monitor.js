(() => {
    const { useState, useEffect, useRef } = React;

    const InvBtn = ({ label, icon, onClick, loading }) => {
        const { Lucide } = window;
        return (
            <button onClick={onClick} disabled={loading} className="flex flex-col items-center justify-center p-1 md:p-2 bg-slate-900 hover:bg-slate-800 border-r border-slate-800 last:border-0 text-slate-400 hover:text-sky-400 hover:bg-slate-800/50 transition-all flex-1 disabled:opacity-50 disabled:cursor-wait group">
                {loading ? <Lucide icon="loader-2" className="w-5 h-5 md:w-6 md:h-6 animate-spin mb-1"/> : <Lucide icon={icon} className="w-5 h-5 md:w-6 md:h-6 mb-1 text-slate-500 group-hover:text-sky-400 transition-colors"/>}
                <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-wider">{label}</span>
            </button>
        );
    };

    // The 12-lead renderer lives in data/rhythms.js (RHYTHMS.render12Lead) so this monitor and the
    // standalone defibrillator page draw the identical recording from the identical registry.
    const render12Lead = (canvas, rhythm, scenario, hr) => window.RHYTHMS.render12Lead(canvas, rhythm, scenario, hr);

    // =========================================================================================
    // A1/A2: THE DEFIBRILLATOR, HOSTED ON THE STUDENT MONITOR.
    //
    // WHY THIS EXISTS. defib/index.html has ZERO Firebase: it is BroadcastChannel-only, which only
    // works between tabs of the SAME browser on the SAME device. Opened on a second physical
    // device (the usual setup — controller on the facilitator's laptop, defib on a tablet by the
    // bed) it silently showed a healthy sinus patient at HR 75 and answered "NO SHOCK ADVISED" in
    // VF. This component is driven by the SAME Firebase session sync as the rest of the monitor,
    // so it is correct on any device.
    //
    // A2: THE OBS STAY VISIBLE. This extends the existing arrest-view dual-trace pattern
    // (LEAD II + PADS) rather than inventing a new layout, and puts the live vitals column
    // alongside. It is a flex row on landscape tablets and stacks with its own scroll container
    // at narrow widths (no fixed min-widths, no horizontal overflow — the app has had a
    // mobile-overflow bug class before and this must not reintroduce it).
    //
    // A6: every student press is pushed to sessions/<CODE>/deviceEvents (PUSH semantics, its own
    // node) NOT to sessions/<CODE>/command, which is a single set() slot already owned by NIBP.
    // The controller converges them all on applyShockOutcome / deliverShock.
    // =========================================================================================
    const MonitorDefib = ({ sim }) => {
        const { ECGMonitor, Lucide } = window;
        const RG = window.RHYTHMS;
        const { state } = sim;
        const { rhythm, vitals, cprInProgress, scenario, flash, nibp, etco2Enabled } = state;
        const defib = state.defib || {};

        // C4: the energy ladder is weight-based and comes from the shared registry, so a 3.5 kg
        // neonate is offered 14 J (4 J/kg) and not a hardcoded 120 J.
        const weight = Number(scenario?.wetflag?.weight);
        const age = scenario?.patientAge;
        const steps = RG.energySteps(Number.isFinite(weight) && weight > 0 ? weight : null, age);
        const recommended = RG.recommendedEnergy(Number.isFinite(weight) && weight > 0 ? weight : null, age);

        const mode = defib.mode || 'monitor';
        const selected = Number.isFinite(Number(defib.energy)) && Number(defib.energy) > 0 ? Math.round(Number(defib.energy)) : recommended;
        const charged = !!defib.charged;
        const syncOn = !!defib.syncMode;

        const [analysing, setAnalysing] = useState(false);
        const [message, setMessage] = useState('DEFIBRILLATOR READY');
        const [pacer, setPacer] = useState({ rate: 70, output: 0 });

        const send = (type, payload) => {
            const ok = sim.sendDeviceEvent && sim.sendDeviceEvent(type, payload || {});
            if (!ok) setMessage('NOT LINKED — CONTROLLER UNREACHABLE');
            return ok;
        };

        const stepEnergy = (dir) => {
            const i = steps.indexOf(selected);
            const idx = i === -1 ? steps.findIndex(v => v >= selected) : i;
            const next = steps[Math.max(0, Math.min(steps.length - 1, (idx === -1 ? 0 : idx) + dir))];
            if (next !== undefined) { send('ENERGY_SELECT', { energy: next }); setMessage(`${next} J SELECTED`); }
        };

        const doCharge = () => {
            if (mode !== 'defib') { setMessage('TURN THE DIAL TO DEFIB FIRST'); return; }
            send('CHARGE_INIT', { energy: selected });
            setMessage(`CHARGING ${selected} J...`);
        };
        const doShock = () => {
            if (!charged) { setMessage('CHARGE FIRST'); return; }
            send('SHOCK_DELIVERED', { energy: selected, sync: syncOn });
            setMessage(`SHOCK DELIVERED ${selected} J${syncOn ? ' (SYNC)' : ''}`);
        };
        const doAnalyse = () => {
            setAnalysing(true);
            setMessage('ANALYSING — DO NOT TOUCH THE PATIENT');
            // The ANSWER comes from the engine's shared registry-backed analysis, not from a
            // second private shockability list on this screen.
            setTimeout(() => {
                setAnalysing(false);
                send('ANALYSE', {});
                setMessage(RG.isShockable(sim.state.rhythm) ? 'SHOCK ADVISED' : 'NO SHOCK ADVISED');
            }, 2500);
        };
        const adjustPacer = (key, delta) => {
            const next = { ...pacer, [key]: Math.max(0, Math.min(key === 'rate' ? 180 : 140, pacer[key] + delta)) };
            setPacer(next);
            send('PACER_UPDATE', { rate: next.rate, output: next.output });
        };

        const captured = mode === 'pacer' && pacer.output > 0 && pacer.output >= (state.pacingThreshold || 70);
        const ecgRhythm = (mode === 'pacer' && captured) ? 'Paced' : rhythm;

        const Soft = ({ children, onClick, tone = 'slate', disabled }) => (
            <button onClick={onClick} disabled={disabled}
                className={`min-w-0 rounded border font-bold uppercase tracking-wide text-[11px] sm:text-xs px-2 py-3 transition-colors disabled:opacity-40 ${
                    tone === 'red' ? 'bg-red-800 border-red-500 text-white hover:bg-red-700'
                    : tone === 'amber' ? 'bg-amber-700 border-amber-500 text-white hover:bg-amber-600'
                    : tone === 'active' ? 'bg-sky-700 border-sky-400 text-white'
                    : 'bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700'}`}>
                {children}
            </button>
        );

        return (
            <div className="absolute inset-0 z-[110] bg-black flex flex-col animate-fadeIn">
                <div className="flex-none bg-slate-900 border-b border-slate-700 px-2 py-1 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-slate-200 font-bold uppercase tracking-wider flex items-center gap-2 text-sm">
                        <Lucide icon="zap" className="text-red-500 w-4 h-4" /> Manual Defibrillator
                    </div>
                    <div className="font-mono font-bold text-xs sm:text-sm text-amber-300">{mode.toUpperCase()} MODE{syncOn ? ' \u00b7 SYNC' : ''}</div>
                    <div className="text-slate-500 font-mono text-xs">{new Date().toLocaleTimeString()}</div>
                </div>

                {/* A2: defib on the left, OBS ALONGSIDE on the right. Column at narrow widths. */}
                <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
                    {/* ---- DEFIB SIDE ---- */}
                    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
                        {/* Dual trace, exactly the arrest-view pattern. */}
                        <div className="flex-none lg:flex-1 min-h-0 grid grid-rows-2 bg-black" style={{ minHeight: '180px' }}>
                            <div className="relative border-b border-slate-800">
                                <ECGMonitor rhythmType={ecgRhythm} hr={vitals.hr} rr={0} spO2={0} isPaused={false} showTraces={false} showEtco2={false} showArt={false} isCPR={cprInProgress} className="h-full" rhythmLabel="LEAD II" showSyncMarkers={syncOn} />
                            </div>
                            <div className="relative">
                                <ECGMonitor rhythmType={ecgRhythm} hr={vitals.hr} rr={0} spO2={0} isPaused={false} showTraces={false} showEtco2={false} showArt={false} isCPR={cprInProgress} className="h-full" rhythmLabel="PADS" showSyncMarkers={syncOn} />
                            </div>
                        </div>

                        <div className={`flex-none mx-2 my-1 rounded px-3 py-2 text-center font-mono font-bold text-sm border ${charged ? 'bg-red-950 border-red-500 text-red-300 animate-pulse' : 'bg-slate-950 border-slate-700 text-emerald-300'}`}>
                            {charged ? `${defib.chargeEnergy || selected} J READY \u2014 STAND CLEAR` : (analysing ? 'ANALYSING...' : message)}
                        </div>

                        <div className="flex-none p-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {['monitor', 'defib', 'pacer', 'aed'].map(m => (
                                <Soft key={m} tone={mode === m ? 'active' : 'slate'} onClick={() => { send('DEVICE_MODE', { mode: m }); setMessage(`${m.toUpperCase()} MODE`); }}>{m}</Soft>
                            ))}
                        </div>

                        <div className="flex-none px-2 pb-2 grid grid-cols-3 gap-2 items-stretch">
                            <div className="bg-slate-950 border border-slate-700 rounded p-2 text-center flex flex-col justify-center min-w-0">
                                <div className="text-slate-500 text-[10px] uppercase font-bold">Energy</div>
                                <div className="text-2xl sm:text-3xl font-mono font-bold text-yellow-400">{selected} J</div>
                                <div className={`text-[9px] font-bold ${selected === recommended ? 'text-emerald-500' : 'text-amber-500'}`}>rec. {recommended} J</div>
                                <div className="mt-1 grid grid-cols-2 gap-1">
                                    <button aria-label="Lower energy" onClick={() => stepEnergy(-1)} className="bg-slate-800 border border-slate-600 rounded py-1 text-white font-bold">&minus;</button>
                                    <button aria-label="Raise energy" onClick={() => stepEnergy(1)} className="bg-slate-800 border border-slate-600 rounded py-1 text-white font-bold">+</button>
                                </div>
                            </div>
                            <Soft tone="amber" onClick={doCharge}>Charge</Soft>
                            <Soft tone="red" onClick={doShock} disabled={!charged}>Shock</Soft>
                        </div>

                        <div className="flex-none px-2 pb-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <Soft tone={syncOn ? 'active' : 'slate'} onClick={() => { send('SYNC_TOGGLE', { sync: !syncOn }); setMessage(!syncOn ? 'SYNC ON' : 'SYNC OFF'); }}>Sync</Soft>
                            <Soft onClick={doAnalyse}>Analyse</Soft>
                            <Soft tone={cprInProgress ? 'active' : 'slate'} onClick={() => send('CPR_TOGGLE', { on: !cprInProgress })}>{cprInProgress ? 'CPR on' : 'CPR'}</Soft>
                            <Soft onClick={() => { send('CHECK_PULSE', {}); setMessage('CHECK PULSE'); }}>Pulse check</Soft>
                        </div>

                        {mode === 'pacer' && (
                            <div className="flex-none px-2 pb-3 grid grid-cols-2 gap-2">
                                {[['rate', 'ppm', 5], ['output', 'mA', 5]].map(([k, unit, d]) => (
                                    <div key={k} className="bg-slate-950 border border-slate-700 rounded p-2 text-center min-w-0">
                                        <div className="text-slate-500 text-[10px] uppercase font-bold">{k}</div>
                                        <div className="text-2xl font-mono font-bold text-sky-300">{pacer[k]}<span className="text-[10px] text-slate-500 ml-1">{unit}</span></div>
                                        <div className="mt-1 grid grid-cols-2 gap-1">
                                            <button onClick={() => adjustPacer(k, -d)} className="bg-slate-800 border border-slate-600 rounded py-1 text-white font-bold">&minus;</button>
                                            <button onClick={() => adjustPacer(k, d)} className="bg-slate-800 border border-slate-600 rounded py-1 text-white font-bold">+</button>
                                        </div>
                                    </div>
                                ))}
                                <div className={`col-span-2 rounded border px-2 py-1 text-center font-mono text-xs font-bold ${captured ? 'border-emerald-600 bg-emerald-950/40 text-emerald-300' : 'border-amber-600 bg-amber-950/30 text-amber-300'}`}>
                                    {pacer.output === 0 ? 'PACING OFF \u2014 INCREASE OUTPUT' : (captured ? `PACING \u2014 CAPTURE @ ${pacer.output} mA` : `PACING \u2014 NO CAPTURE (${pacer.output} mA)`)}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ---- A2: OBS ALONGSIDE. "Let them see the obs as well." ---- */}
                    <div className="flex-none lg:w-72 xl:w-80 border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-950 p-2 flex flex-col gap-2 lg:overflow-y-auto">
                        <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Patient observations</div>
                        <div className="grid grid-cols-2 lg:grid-cols-1 gap-2">
                            {[
                                ['HR', vitals.hr, 'bpm', 'text-emerald-400'],
                                ['NIBP', (nibp && nibp.sys) ? `${nibp.sys}/${nibp.dia}` : '--/--', 'mmHg', 'text-red-400'],
                                ['SpO2', vitals.spO2, '%', 'text-cyan-400'],
                                ['RR', vitals.rr, '/min', 'text-yellow-400'],
                                ...(etco2Enabled ? [['ETCO2', Number.isFinite(vitals.etco2) ? vitals.etco2.toFixed(1) : '--', 'kPa', 'text-purple-400']] : []),
                                ['Temp', Number.isFinite(vitals.temp) ? vitals.temp.toFixed(1) : '--', '\u00b0C', 'text-sky-300'],
                                ['Glucose', Number.isFinite(vitals.bm) ? vitals.bm.toFixed(1) : '--', 'mmol/L', 'text-sky-300'],
                                // WAVE 4a / E8: serum K+ is a modelled vital, so the team can see
                                // whether the hyperkalaemia treatment actually worked.
                                ['K+', Number.isFinite(vitals.k) ? vitals.k.toFixed(1) : '--', 'mmol/L', (Number.isFinite(vitals.k) && (vitals.k < 3.0 || vitals.k > 5.5)) ? 'text-amber-400' : 'text-sky-300']
                            ].map(([label, value, unit, cls]) => (
                                <div key={label} className="bg-black border border-slate-800 rounded px-2 py-1 flex items-baseline justify-between min-w-0">
                                    <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold truncate">{label}</span>
                                    <span className={`font-mono font-bold text-xl sm:text-2xl ${cls}`}>{value === null || value === undefined ? '--' : value}<span className="text-[9px] text-slate-600 ml-1">{unit}</span></span>
                                </div>
                            ))}
                        </div>
                        <div className="bg-black border border-slate-800 rounded p-2">
                            <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Shocks this arrest</div>
                            <div className="flex items-baseline justify-between">
                                <span className="font-mono text-3xl font-bold text-white">{defib.shockCount || 0}</span>
                                <span className="font-mono text-xs text-slate-400">{defib.totalEnergy || 0} J total</span>
                            </div>
                            {cprInProgress && <div className="mt-1 text-[10px] font-bold uppercase text-red-400 animate-pulse">CPR in progress</div>}
                        </div>
                        {scenario?.wetflag && (
                            <div className="bg-purple-950/40 border border-purple-700 rounded p-2">
                                <div className="text-[10px] uppercase tracking-widest text-purple-300 font-bold">Paediatric</div>
                                <div className="font-mono text-sm text-white">{scenario.wetflag.weight} kg &middot; shock {scenario.wetflag.energy} J</div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    const MonitorScreen = ({ sim }) => {
        const { VitalDisplay, ECGMonitor, Lucide, Button, Modal } = window;
        const { state, enableAudio, triggerNIBP, toggleNIBPMode, revealInvestigation } = sim;
        const { vitals, prevVitals, rhythm, flash, activeInterventions, etco2Enabled, etco2Pathology, cprInProgress, scenario, nibp, monitorPopup, notification, arrestPanelOpen, defibPanelOpen, loadingInvestigations, showWetflag } = state;
        const syncStatus = state.syncStatus || { state: 'connecting', message: 'Connecting to live session…' };
        const syncProblem = ['unavailable', 'disconnected', 'error', 'degraded'].includes(syncStatus.state);
        // WAVE 7 / ITEM 4: each sensor gates exactly its own value/trace. Derived from the shared
        // engine helper (window.getSensors) off activeInterventions, which is already on the wire, so
        // the student monitor needs no new sync key and can never disagree with the controller.
        // 'Obs' (Attach Monitoring) still implies every continuous sensor, so all 254 premade
        // scenarios and resumed sessions behave exactly as before. Quick Sim starts with nothing
        // attached, like every other mode.
        const sensors = window.getSensors ? window.getSensors(state) : null;
        const hasMonitoring = sensors ? sensors.any : activeInterventions.has('Obs');
        const sEcg = sensors ? sensors.ecg : hasMonitoring;
        const sSpo2 = sensors ? sensors.spo2 : hasMonitoring;
        const sNibp = sensors ? sensors.nibp : hasMonitoring;
        const sTemp = sensors ? sensors.temp : hasMonitoring;
        const hasArtLine = activeInterventions.has('ArtLine');
        // Point-of-care readings: revealed AT THE MOMENT THEY WERE TAKEN, with a timestamp, rather
        // than tracking live (the clinically important distinction, and what NIBP already does).
        const poc = state.pocReadings || {};
        const capnoVentilating = window.isCapnoVentilating ? window.isCapnoVentilating(state, vitals) : true;
        // WAVE 8 / FINDING 1: the shark-fin severity arrives as a plain top-level number on the wire
        // (`co2Severity`), computed once from the authoritative controller state, so the student
        // monitor and the facilitator strip draw the identical capnogram shape and can never disagree.
        const co2Severity = Number.isFinite(state.co2Severity) ? state.co2Severity : 0;
        
        const [audioEnabled, setAudioEnabled] = useState(false);

        // ---- KEEP THE ROOM MONITOR AWAKE ------------------------------------------------------
        // A tablet on the wall used to dim and lock mid-scenario, because nothing asked it not to.
        // The Screen Wake Lock API holds the screen on while this page is visible. The browser
        // drops the lock whenever the tab is hidden, so it is re-requested on every return to
        // visible, and again inside the "Tap to Enable Sound" gesture (some browsers want one).
        // Unsupported browsers (older iOS) simply carry on as before; the chip below says so.
        const wakeLockRef = useRef(null);
        const [wakeState, setWakeState] = useState(('wakeLock' in navigator) ? 'pending' : 'unsupported');
        const requestWakeLock = async () => {
            if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
            if (wakeLockRef.current && !wakeLockRef.current.released) return;
            try {
                const lock = await navigator.wakeLock.request('screen');
                wakeLockRef.current = lock;
                setWakeState('on');
                lock.addEventListener('release', () => { if (wakeLockRef.current === lock) setWakeState('released'); });
            } catch (e) { setWakeState('denied'); }
        };
        useEffect(() => {
            requestWakeLock();
            const onVis = () => { if (document.visibilityState === 'visible') requestWakeLock(); };
            document.addEventListener('visibilitychange', onVis);
            return () => {
                document.removeEventListener('visibilitychange', onVis);
                try { if (wakeLockRef.current) wakeLockRef.current.release(); } catch (e) {}
                wakeLockRef.current = null;
            };
        }, []);
        // Full screen: hides the browser chrome on the room screen. Prefixed for older Safari.
        const [isFullscreen, setIsFullscreen] = useState(!!(document.fullscreenElement || document.webkitFullscreenElement));
        useEffect(() => {
            const onFs = () => setIsFullscreen(!!(document.fullscreenElement || document.webkitFullscreenElement));
            document.addEventListener('fullscreenchange', onFs);
            document.addEventListener('webkitfullscreenchange', onFs);
            return () => { document.removeEventListener('fullscreenchange', onFs); document.removeEventListener('webkitfullscreenchange', onFs); };
        }, []);
        const fsSupported = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
        const toggleFullscreen = () => {
            try {
                if (document.fullscreenElement || document.webkitFullscreenElement) {
                    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
                } else {
                    const el = document.documentElement;
                    const p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
                    if (p && p.catch) p.catch(() => {});
                }
            } catch (e) { /* not allowed here: nothing to do */ }
            requestWakeLock();
        };
        // The overlay must be able to come BACK: iOS and tab-backgrounding re-suspend the
        // AudioContext, and a one-way flag left the monitor permanently silent with no way to fix it.
        const audioContextState = sim.audioContextState;
        useEffect(() => {
            if (audioEnabled && audioContextState === 'suspended') setAudioEnabled(false);
        }, [audioContextState, audioEnabled]);
        const [invToast, setInvToast] = useState(null); 
        const [show12Lead, setShow12Lead] = useState(false);
        const canvasRef = useRef(null);
        
        const lastPopupTime = useRef(0);
        const simChannel = useRef(null);

        useEffect(() => {
            if (show12Lead && canvasRef.current) {
                render12Lead(canvasRef.current, state.rhythm, state.scenario, state.vitals?.hr);
            }
        }, [show12Lead, state.rhythm, state.vitals?.hr]);

        useEffect(() => {
            // The 12-lead bridge is a local nicety; everything clinical arrives over Firebase. Older iOS
            // Safari has no BroadcastChannel and throwing here would blank the student monitor entirely.
            if (simChannel.current === null) {
                try { simChannel.current = ('BroadcastChannel' in window) ? new BroadcastChannel('sim_channel') : null; }
                catch (e) { console.warn('BroadcastChannel unavailable on monitor', e); simChannel.current = null; }
            }
            if (!simChannel.current) return;
            simChannel.current.onmessage = (event) => {
                if (event.data.type === 'SHOW_12LEAD') {
                    setShow12Lead(true);
                }
            };
            return () => {
                if (simChannel.current) {
                    simChannel.current.close();
                    simChannel.current = null;
                }
            };
        }, []);

        useEffect(() => {
            if (monitorPopup && monitorPopup.type === null) {
                if (invToast) setInvToast(null);
                if (show12Lead) setShow12Lead(false);
                return;
            }

            if (monitorPopup && monitorPopup.type && monitorPopup.timestamp > lastPopupTime.current) {
                lastPopupTime.current = monitorPopup.timestamp;
                const type = monitorPopup.type;
                let title = type;
                let content = "No findings recorded.";

                const ct = monitorPopup.customText;
                // Structured VBG payload from revealInvestigation('VBG')
                if (ct && typeof ct === 'object' && ct.__vbg) {
                    const v = ct;
                    content = (
                        <div className="grid grid-cols-4 gap-2 text-xs font-mono">
                            <span>pH: <b className={v.pH < 7.35 || v.pH > 7.45 ? "text-red-400" : "text-emerald-400"}>{v.pH.toFixed(2)}</b></span>
                            <span>pCO2: <b className={v.pCO2 > 6.0 || v.pCO2 < 4.5 ? "text-red-400" : "text-emerald-400"}>{v.pCO2.toFixed(1)}</b></span>
                            <span>pO2: <b className={v.pO2 < 8.0 ? "text-red-400" : "text-emerald-400"}>{Number.isFinite(v.pO2) ? v.pO2.toFixed(1) : '--'}</b></span>
                            <span>Lac: <b className={v.Lac > 2 ? "text-red-400" : "text-emerald-400"}>{v.Lac.toFixed(1)}</b></span>
                            <span>K+: <b className={v.K > 5.5 ? "text-red-400" : "text-emerald-400"}>{v.K.toFixed(1)}</b></span>
                            <span>Glu: <b className={v.Glu > 11 ? "text-red-400" : "text-emerald-400"}>{v.Glu.toFixed(1)}</b></span>
                            <span>BE: <b>{v.BE.toFixed(1)}</b></span>
                            <span>HCO3: <b>{v.HCO3.toFixed(1)}</b></span>
                            {v.Na !== undefined && <span>Na+: <b className={v.Na < 135 || v.Na > 145 ? "text-red-400" : "text-emerald-400"}>{v.Na.toFixed(0)}</b></span>}
                            {v.Ca !== undefined && <span>Ca²⁺: <b className={v.Ca > 2.6 ? "text-red-400" : "text-emerald-400"}>{v.Ca.toFixed(2)}</b></span>}
                        </div>
                    );
                } else if (ct) {
                    content = ct;
                } else if (scenario) {
                    // Read the generated investigations block as well as the top-level fields. The
                    // payload now carries scenario.investigations.* (where enrichScenario actually
                    // writes the generated CXR/CT/urine/POCUS reports), so students finally see the
                    // scenario's own findings instead of the generic defaults.
                    const inv = scenario.investigations || {};
                    // generateUrine() returns a dipstick object and generatePocus() a per-window object;
                    // neither has a `.findings` string, which is why every student saw the generic
                    // default text. Render the structured reports properly instead.
                    const fmtUrine = (u) => {
                        const labels = { leuks: 'Leukocytes', nitrites: 'Nitrites', blood: 'Blood', ketones: 'Ketones', protein: 'Protein', glucose: 'Glucose', bhcg: 'B-hCG' };
                        const parts = Object.keys(labels).filter(k => u[k] !== undefined).map(k => `${labels[k]}: ${u[k]}`);
                        return parts.length ? parts.join('  \u00b7  ') : null;
                    };
                    const fmtPocus = (p) => {
                        const labels = { heart: 'Cardiac', lungs: 'Lung', abdo: 'Abdominal/FAST', aorta: 'Aorta', ivc: 'IVC' };
                        const parts = Object.keys(labels).filter(k => p[k]).map(k => `${labels[k]}: ${p[k]}`);
                        return parts.length ? parts.join('\n') : null;
                    };
                    const resolve = (key) => {
                        const top = scenario[key];
                        const gen = inv[key];
                        if (top && (top.findings || Object.keys(top).length)) return top;
                        return gen || null;
                    };
                    const findings = (key, fallback) => {
                        const src = resolve(key);
                        if (!src) return fallback;
                        if (typeof src === 'string') return src;
                        if (src.findings) return src.findings;
                        if (key === 'urine') return fmtUrine(src) || fallback;
                        if (key === 'pocus') return fmtPocus(src) || fallback;
                        return fallback;
                    };
                    if (type === 'ECG') content = findings('ecg', "Normal Sinus Rhythm");
                    else if (type === 'X-ray') content = findings('chestXray', "Lung fields clear.");
                    else if (type === 'CT') content = findings('ct', "No acute intracranial pathology.");
                    else if (type === 'Urine') content = findings('urine', "Urinalysis Normal.");
                    else if (type === 'POCUS') content = findings('pocus', "No free fluid seen.");
                    else if (type === 'VBG' && scenario.vbg) {
                        const v = scenario.vbg;
                        content = (
                            <div className="grid grid-cols-4 gap-2 text-xs font-mono">
                                <span>pH: <b className={v.pH < 7.35 || v.pH > 7.45 ? "text-red-400" : "text-emerald-400"}>{v.pH.toFixed(2)}</b></span>
                                <span>pCO2: <b className={v.pCO2 > 6.0 || v.pCO2 < 4.5 ? "text-red-400" : "text-emerald-400"}>{v.pCO2.toFixed(1)}</b></span>
                                <span>pO2: <b className={v.pO2 < 8.0 ? "text-red-400" : "text-emerald-400"}>{Number.isFinite(v.pO2) ? v.pO2.toFixed(1) : '--'}</b></span>
                                <span>Lac: <b className={v.Lac > 2 ? "text-red-400" : "text-emerald-400"}>{v.Lac.toFixed(1)}</b></span>
                                <span>K+: <b className={v.K > 5.5 ? "text-red-400" : "text-emerald-400"}>{v.K.toFixed(1)}</b></span>
                                <span>Glu: <b className={v.Glu > 11 ? "text-red-400" : "text-emerald-400"}>{v.Glu.toFixed(1)}</b></span>
                                <span>BE: <b>{v.BE.toFixed(1)}</b></span>
                                <span>HCO3: <b>{v.HCO3.toFixed(1)}</b></span>
                                {v.Na !== undefined && <span>Na+: <b className={v.Na < 135 || v.Na > 145 ? "text-red-400" : "text-emerald-400"}>{v.Na.toFixed(0)}</b></span>}
                                {v.Ca !== undefined && <span>Ca²⁺: <b className={v.Ca > 2.6 ? "text-red-400" : "text-emerald-400"}>{v.Ca.toFixed(2)}</b></span>}
                            </div>
                        );
                    }
                }
                setInvToast({ title, content });
            }
        }, [monitorPopup, scenario]);

        // ---- WAVE 5 / ITEM 1: SESSION-COMPLETE STATE -----------------------------------------
        // The monitor used to render a bare black div when the facilitator pressed Finish, so the
        // trainees' screen simply went blank with no explanation — no crash, no console error, just
        // nothing. `isFinished` already travels in the sync payload (set by STOP_SIM, carried by
        // SYNC_FROM_MASTER), so this state is reused rather than invented.
        //
        // ASSESSOR-ONLY BOUNDARY (Wave 3 / B4). This card is PATIENT-FACING. It deliberately shows
        // no outcome, no diagnosis, no score, no rhythm and no conversion history — exactly like the
        // rest of the monitor, which never receives rhythmEvent/lastConversion at all. It says only
        // that the session has ended and to turn to the facilitator for the debrief.
        if (state.isFinished) {
            return (
                <div className="h-full w-full bg-black text-white flex items-center justify-center p-6" role="status" aria-live="polite">
                    <div className="max-w-xl w-full bg-slate-900 border border-slate-700 rounded-lg shadow-2xl p-8 text-center animate-fadeIn">
                        <Lucide icon="check-circle" className="w-14 h-14 text-emerald-500 mx-auto mb-4" />
                        <h1 className="text-3xl font-bold tracking-wide mb-2">Simulation complete</h1>
                        <p className="text-slate-300 text-lg mb-4">This session has ended. The monitor is no longer live.</p>
                        <p className="text-slate-400 text-sm">Please turn to your facilitator — the debrief happens with them, not on this screen.</p>
                        <div className="mt-6 pt-4 border-t border-slate-800 text-xs text-slate-500 font-mono uppercase tracking-widest">Monitor standby</div>
                    </div>
                </div>
            );
        }

        const handleEnableAudio = () => {
            requestWakeLock();
            const result = enableAudio();
            if (result && typeof result.then === 'function') result.then(() => setAudioEnabled(true)).catch(() => setAudioEnabled(true));
            else setAudioEnabled(true);
        };
        const isPaeds = scenario && (scenario.ageRange === 'Paediatric' || scenario.wetflag);
        const thresholds = (window.getAlarmThresholds && window.getAlarmThresholds(scenario?.patientAge ?? 40)) || { hr: {low:40,high:130}, rr:{low:8,high:30}, spO2:90 };

        const getGridCols = () => {
            let count = 4;
            if (hasArtLine) count++;
            if (etco2Enabled) count++;
            if (count === 4) return 'md:grid-cols-4';
            if (count === 5) return 'md:grid-cols-5';
            return 'md:grid-cols-6';
        };

        return (
            <div className={`h-full w-full flex flex-col bg-black text-white transition-colors duration-200 ${flash === 'red' ? 'flash-red' : (flash === 'green' ? 'flash-green' : '')} relative overflow-hidden`}>
                {syncProblem && (
                    <div role="alert" className="absolute top-0 inset-x-0 z-[130] bg-red-950/95 border-b border-red-500 px-4 py-2 text-center text-sm font-bold text-red-100 shadow-lg">
                        <span>Disconnected from live session.</span>
                        {syncStatus.message && <span className="ml-2 font-normal text-red-200">{syncStatus.message}</span>}
                    </div>
                )}
                {!audioEnabled && (<div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={handleEnableAudio}><div className="bg-slate-800 border border-sky-500 p-6 rounded-lg shadow-2xl animate-bounce cursor-pointer text-center"><Lucide icon="volume-2" className="w-12 h-12 text-sky-400 mx-auto mb-2"/><h2 className="text-xl font-bold text-white">Tap to Enable Sound</h2></div></div>)}
                
                <div className={`absolute top-4 right-4 z-[70] transition-all duration-500 ${invToast ? 'translate-x-0 opacity-100' : 'translate-x-10 opacity-0 pointer-events-none'}`}>
                    <div className="bg-slate-800 border-l-4 border-purple-500 rounded shadow-2xl p-4 w-96 max-w-[90vw]">
                        <div className="flex justify-between items-start mb-2">
                            <h3 className="text-purple-400 font-bold uppercase text-sm flex items-center gap-2"><Lucide icon="activity" className="w-4 h-4"/> {invToast?.title} Result</h3>
                            <button aria-label="Dismiss investigation result" onClick={()=>setInvToast(null)} className="text-slate-500 hover:text-white pointer-events-auto"><Lucide icon="x" className="w-4 h-4"/></button>
                        </div>
                        <div className="text-white text-sm font-medium leading-relaxed whitespace-pre-line">
                            {invToast?.content}
                        </div>
                    </div>
                </div>

                {show12Lead && (
                    <Modal label="12-lead analysis" onClose={() => setShow12Lead(false)}>
                        <div className="bg-black/90 flex flex-col items-center justify-center p-4 animate-fadeIn">
                            <h2 className="text-white font-mono text-xl mb-2">12-LEAD ANALYSIS (Tap to Close)</h2>
                            <canvas ref={canvasRef} width="1000" height="640" className="bg-white rounded shadow-lg max-w-full max-h-[80vh] cursor-pointer" onClick={() => setShow12Lead(false)} />
                            {/* No printed interpretation: naming the rhythm here handed the team the answer. */}
                        </div>
                    </Modal>
                )}

                {/* A1-A3: the assessor's Defib toggle (state.defibPanelOpen, synced over Firebase
                    exactly like arrestPanelOpen) opens a WORKING defibrillator here, with the obs
                    still visible alongside it. */}
                {defibPanelOpen && <MonitorDefib sim={sim} />}

                {arrestPanelOpen && !defibPanelOpen && (
                    <div className="absolute inset-0 z-[100] bg-black flex flex-col animate-fadeIn">
                        <div className="bg-slate-900 border-b border-slate-700 p-2 flex justify-between items-center">
                            <div className="text-slate-300 font-bold uppercase tracking-wider flex items-center gap-2">
                                <Lucide icon="zap" className="text-red-500" /> Manual Defibrillator
                            </div>
                            <div className="text-red-500 font-mono font-bold animate-pulse text-xl">MANUAL DEFIBRILLATOR MODE</div>
                            <div className="text-slate-500">{new Date().toLocaleTimeString()}</div>
                        </div>

                        <div className="flex-grow relative bg-black grid grid-rows-2">
                             <div className="relative border-b border-slate-800">
                                <ECGMonitor rhythmType={rhythm} hr={vitals.hr} rr={0} spO2={0} isPaused={false} showTraces={true} showEtco2={false} showArt={false} isCPR={cprInProgress} className="h-full" rhythmLabel="LEAD II" />
                             </div>
                             <div className="relative">
                                <ECGMonitor rhythmType={rhythm} hr={vitals.hr} rr={0} spO2={0} isPaused={false} showTraces={true} showEtco2={false} showArt={false} isCPR={cprInProgress} className="h-full" rhythmLabel="PADS" />
                             </div>
                        </div>

                        <div className="bg-slate-900 p-4 border-t border-slate-700 grid grid-cols-4 gap-4">
                             <div className="bg-black border border-slate-700 rounded p-2 text-center flex flex-col justify-center">
                                 <div className="text-slate-500 text-xs uppercase mb-1">Energy Select</div>
                                 <div className="text-3xl font-mono text-yellow-500 font-bold">{(state.defib && state.defib.energy) || window.RHYTHMS.recommendedEnergy(scenario?.wetflag?.weight, scenario?.patientAge)} J</div>
                             </div>
                             <div className="bg-black border border-slate-700 rounded p-2 text-center flex flex-col justify-center">
                                 <div className="text-slate-500 text-xs uppercase mb-1">Status</div>
                                 <div className="text-xl font-mono text-white font-bold">{flash === 'yellow' ? 'CHARGING...' : (flash === 'red' ? 'SHOCK DELIVERED' : 'READY')}</div>
                             </div>
                             
                             <div className="col-span-2 flex items-center justify-end gap-4">
                                 <div className="text-slate-400 text-sm uppercase font-bold mr-4">CPR Timer: <span className="text-white text-xl font-mono">{Math.floor(state.cycleTimer/60)}:{(state.cycleTimer%60).toString().padStart(2,'0')}</span></div>
                             </div>
                        </div>
                    </div>
                )}

                <div className={`flex-grow flex flex-col p-2 md:p-3 gap-2 h-full relative z-10 ${isPaeds && showWetflag && scenario?.wetflag ? 'md:pr-52' : ''}`}>
                    <div className="flex-grow relative border border-slate-800 rounded overflow-hidden flex flex-col min-h-0 bg-black">
                        {hasMonitoring ? (
                            <ECGMonitor rhythmType={rhythm} hr={vitals.hr} rr={vitals.rr} spO2={vitals.spO2} etco2={vitals.etco2}
                                        isPaused={false} showTraces={true}
                                        showEcg={sEcg} showPleth={sSpo2} showResp={sEcg}
                                        // A removed ECG/SpO2 sensor leaves its lane in place and
                                        // BLANK ("leads off" / "no probe"), matching the numeric
                                        // tiles, which also stay put and read "Off".
                                        reserveLanes={['ecg', 'pleth', 'resp']}
                                        showEtco2={etco2Enabled} showArt={hasArtLine}
                                        isCPR={cprInProgress} co2Pathology={etco2Pathology || 'normal'}
                                        co2Severity={co2Severity}
                                        ventilating={capnoVentilating} className="h-full" rhythmLabel="ECG" />
                        ) : (
                            <div className="flex items-center justify-center h-full text-slate-700 font-mono text-xl animate-pulse">NO SENSOR DETECTED</div>
                        )}
                        {/* Screen controls, deliberately small and dim so they never compete with
                            the patient's data. The chip says whether the screen will stay awake. */}
                        <div className="absolute bottom-2 right-2 z-20 flex items-center gap-1 opacity-60 hover:opacity-100 transition-opacity">
                            <span title={wakeState === 'on' ? 'This screen will stay on while the monitor is open.' : wakeState === 'unsupported' ? 'This browser cannot keep the screen awake. Set the tablet\'s auto-lock to Never for the session.' : 'Screen may sleep. Tap the screen (or Full screen) to try again, or set auto-lock to Never.'}
                                  className={`hidden sm:flex items-center gap-1 px-1.5 py-1 rounded border text-[9px] font-bold uppercase tracking-wider ${wakeState === 'on' ? 'border-slate-700 text-slate-500' : 'border-amber-700 text-amber-400'}`}>
                                <Lucide icon="sun" className="w-3 h-3" /> {wakeState === 'on' ? 'Awake' : 'May sleep'}
                            </span>
                            {fsSupported && (
                                <button onClick={toggleFullscreen} aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'} title={isFullscreen ? 'Exit full screen' : 'Full screen'}
                                        className="p-1.5 rounded border border-slate-700 bg-black/60 text-slate-400 hover:text-white">
                                    <Lucide icon={isFullscreen ? 'minimize' : 'maximize'} className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                        {state.monitorTimer?.visible && (
                            <div className="absolute top-2 right-2 bg-black/50 text-slate-300 font-mono font-bold text-4xl md:text-6xl px-4 py-2 rounded border border-slate-700 shadow-2xl">
                                {Math.floor(state.monitorTimer.time/60).toString().padStart(2,'0')}:{(state.monitorTimer.time%60).toString().padStart(2,'0')}
                            </div>
                        )}
                    </div>

                    <div className={`flex-none grid grid-cols-2 ${getGridCols()} gap-2 h-[25vh] md:h-[28vh]`}>
                        <VitalDisplay label="Heart Rate" value={vitals.hr} prev={prevVitals.hr} unit="bpm" alert={vitals.hr > thresholds.hr.high || vitals.hr < thresholds.hr.low} visible={sEcg} isMonitor={true} hideTrends={true} />
                        
                        <div className="relative h-full">
                            {/* NIBP is the one sensor that does NOT blank when removed: like a real
                                monitor, the last measured reading stays up with its time, marked
                                CUFF OFF, and no new reading can be taken until the cuff is back on. */}
                            <VitalDisplay label="NIBP" value={nibp.sys} value2={nibp.dia} unit="mmHg" alert={nibp.sys && nibp.sys < 90} visible={sNibp || !!nibp.sys} isMonitor={true} hideTrends={true} isNIBP={true} lastNIBP={nibp.lastTaken} onClick={sNibp ? triggerNIBP : undefined} note={sNibp ? null : 'cuff off'} />
                            {sNibp && (
                                <div className="absolute bottom-1 right-1 left-1 flex gap-2 z-20 px-1">
                                    <button onClick={(e) => { e.stopPropagation(); (nibp.inflating && sim.stopNIBP) ? sim.stopNIBP() : triggerNIBP(); }} className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-bold px-2 py-2 rounded border border-slate-600 uppercase tracking-wide transition-colors shadow-lg flex-1 h-12">{nibp.inflating ? 'Stop' : 'Cycle'}</button>
                                    <button onClick={(e) => { e.stopPropagation(); toggleNIBPMode(); }} className={`text-sm font-bold px-2 py-2 rounded border uppercase tracking-wide transition-colors shadow-lg h-12 flex-1 max-w-[80px] ${nibp.mode === 'auto' ? 'bg-emerald-900/80 border-emerald-500 text-emerald-400' : 'bg-slate-800 border-slate-600 text-slate-500'}`}>Auto</button>
                                </div>
                            )}
                        </div>

                        <VitalDisplay label="SpO2" value={vitals.spO2} prev={prevVitals.spO2} unit="%" alert={vitals.spO2 < thresholds.spO2} visible={sSpo2} isMonitor={true} hideTrends={true} />

                        {hasArtLine && (
                            <VitalDisplay label="ABP" value={vitals.bpSys} value2={vitals.bpDia} unit="mmHg" alert={vitals.bpSys < 90} visible={true} isMonitor={true} hideTrends={true} />
                        )}

                        <VitalDisplay label="Resp Rate" value={vitals.rr} prev={prevVitals.rr} unit="/min" alert={vitals.rr > thresholds.rr.high || vitals.rr < thresholds.rr.low} visible={sEcg} isMonitor={true} hideTrends={true} />

                        {etco2Enabled && (
                            <VitalDisplay label="ETCO2" value={vitals.etco2} prev={prevVitals.etco2} unit="kPa" alert={vitals.etco2 < 4.0 || vitals.etco2 > 6.5} visible={etco2Enabled} isMonitor={true} hideTrends={true} />
                        )}
                    </div>

                    {/* B2: Temp / capillary glucose / pH are point-of-care measurements rather than
                        continuous monitored channels, so they get their own slim strip instead of
                        shrinking the HR/BP/SpO2 tiles. They are modelled vitals from Wave 2 onwards
                        (active warming, IV dextrose, bicarbonate) and must be readable by the team. */}
                    {/* B2 / WAVE 7 — POINT-OF-CARE STRIP.
                        Temp is a CONTINUOUS channel: it needs its probe attached and then tracks live.
                        Glucose, pH and K+ are INTERMITTENT: they show the value from the moment the
                        sample was taken, with its timestamp, and do NOT follow the live model. An
                        unattached sensor / untaken sample reads NO SENSOR / NO SAMPLE in the same
                        styling as the main trace, so the team can see what is missing. */}
                    <div className="flex-none grid grid-cols-2 md:grid-cols-4 gap-2 mt-1">
                        {(() => {
                            const tempOn = sTemp && Number.isFinite(vitals.temp);
                            const bm = poc.bm || null;
                            const vbg = poc.vbg || null;
                            const cell = (label, value, unit, sub, alert) => (
                                <div className={`bg-slate-950 border rounded px-2 py-1 flex items-baseline justify-between ${alert ? 'border-amber-600' : 'border-slate-800'}`}>
                                    <span className="text-[10px] md:text-xs uppercase tracking-widest text-slate-400 font-bold">{label}{sub ? <span className="ml-1 text-[9px] text-slate-500 normal-case tracking-normal">{sub}</span> : null}</span>
                                    <span className={`font-mono font-bold text-xl md:text-3xl ${value === null ? 'text-slate-700' : (alert ? 'text-amber-400' : 'text-sky-300')}`}>{value === null ? '--' : value}{value !== null && unit ? <span className="text-[10px] md:text-xs text-slate-500 ml-1">{unit}</span> : null}</span>
                                </div>
                            );
                            return (
                                <>
                                    {cell('Temp', tempOn ? vitals.temp.toFixed(1) : null, '\u00b0C', sTemp ? null : 'no probe',
                                          tempOn && (vitals.temp < 35 || vitals.temp >= 38.5))}
                                    {cell('Glucose', (bm && Number.isFinite(bm.value)) ? bm.value.toFixed(1) : null, 'mmol/L',
                                          bm ? bm.clock : 'no sample',
                                          !!(bm && Number.isFinite(bm.value) && (bm.value < 4 || bm.value > 11)))}
                                    {cell('pH', (vbg && Number.isFinite(vbg.value)) ? vbg.value.toFixed(2) : null, '',
                                          vbg ? vbg.clock : 'no gas',
                                          !!(vbg && Number.isFinite(vbg.value) && (vbg.value < 7.30 || vbg.value > 7.50)))}
                                    {/* WAVE 4a / E8: serum potassium — hyperkalaemia and DKA finally have a
                                        measurable endpoint. Reported from the VBG sample, like the real thing. */}
                                    {cell('K+', (vbg && Number.isFinite(vbg.value2)) ? vbg.value2.toFixed(1) : null, 'mmol/L',
                                          vbg ? vbg.clock : 'no gas',
                                          !!(vbg && Number.isFinite(vbg.value2) && (vbg.value2 < 3.0 || vbg.value2 > 5.5)))}
                                </>
                            );
                        })()}
                    </div>

                    <div className="flex-none h-14 md:h-16 bg-slate-950 border border-slate-800 rounded flex overflow-hidden shadow-lg mt-1">
                        {/* D2 ROOT CAUSE: this dispatched {type:'REQUEST_12LEAD'}, for which NO reducer case
                            exists in any of the four reducers. Nothing changed, so the button highlighted
                            while the previously-shown result card (e.g. URINE) stayed on screen. It now
                            opens the 12-lead canvas directly, clears the stale result card, and tells the
                            assessor the team asked for it. */}
                        <InvBtn label="12-Lead" icon="activity" onClick={() => { setInvToast(null); setShow12Lead(true); if (sim.sendDeviceEvent) sim.sendDeviceEvent('REQUEST_12LEAD', {}); }} loading={loadingInvestigations?.['ECG']} />
                        <InvBtn label="VBG" icon="droplet" onClick={() => { setShow12Lead(false); revealInvestigation('VBG'); }} loading={loadingInvestigations?.['VBG']} />
                        <InvBtn label="CXR" icon="image" onClick={() => { setShow12Lead(false); revealInvestigation('X-ray'); }} loading={loadingInvestigations?.['X-ray']} />
                        <InvBtn label="Urine" icon="flask-conical" onClick={() => { setShow12Lead(false); revealInvestigation('Urine'); }} loading={loadingInvestigations?.['Urine']} />
                        <InvBtn label="POCUS" icon="waves" onClick={() => { setShow12Lead(false); revealInvestigation('POCUS'); }} loading={loadingInvestigations?.['POCUS']} />
                        <InvBtn label="CT Head" icon="scan" onClick={() => { setShow12Lead(false); revealInvestigation('CT'); }} loading={loadingInvestigations?.['CT']} />
                    </div>
                </div>

                {isPaeds && showWetflag && scenario.wetflag && (
                    <div className="absolute top-0 right-0 h-full w-48 bg-slate-900/95 backdrop-blur border-l border-slate-700 p-2 flex flex-col gap-2 shadow-2xl z-40">
                         <div className="bg-purple-900/40 border border-purple-500/50 p-2 rounded mb-2">
                             <h3 className="text-purple-400 font-bold text-center text-sm">WETFLAG</h3>
                             <div className="text-center text-white font-mono text-xl font-bold">{scenario.wetflag.weight}kg</div>
                             <div className="text-center bg-slate-800 text-white font-bold text-sm mt-1 py-1 rounded">Age: {scenario.patientAge} yrs</div>
                         </div>
                         <div className="flex-1 flex flex-col gap-1 overflow-y-auto">
                             <WetFlagItem label="Energy" value={`${scenario.wetflag.energy}J`} />
                             <WetFlagItem label="Tube" value={scenario.wetflag.tube} />
                             <WetFlagItem label="Fluids" value={`${scenario.wetflag.fluids}ml`} />
                             <WetFlagItem label="Loraz" value={`${scenario.wetflag.lorazepam}mg`} />
                             <WetFlagItem label="Adren" value={`${scenario.wetflag.adrenaline}mcg`} />
                             <WetFlagItem label="Gluc" value={`${scenario.wetflag.glucose}ml`} />
                         </div>
                    </div>
                )}
            </div>
        );
    };

    const WetFlagItem = ({label, value}) => (
        <div className="bg-slate-800 p-2 rounded flex flex-col items-center justify-center">
            <span className="text-[10px] text-slate-500 uppercase font-bold">{label}</span>
            <span className="font-mono text-lg font-bold text-white">{value}</span>
        </div>
    );

    const MonitorContainer = ({ sessionID }) => { 
        const { Lucide } = window;
        const sim = useSimulation(null, true, sessionID); 
        if (!sessionID) return null; 
        const syncStatus = sim.state.syncStatus || { state: 'connecting', message: 'Connecting to live session…' };
        const syncProblem = ['unavailable', 'disconnected', 'error', 'degraded'].includes(syncStatus.state);
        
        if (!sim.state.vitals || (!sim.state.vitals.hr && sim.state.vitals.hr !== 0)) {
            return (
                <div className="h-full flex flex-col items-center justify-center bg-black text-slate-500 gap-4 animate-fadeIn">
                    <Lucide icon="wifi" className="w-12 h-12 animate-pulse text-sky-500" />
                    <div className={`text-xl font-mono tracking-widest ${syncProblem ? 'text-red-300' : ''}`}>{syncProblem ? 'DISCONNECTED FROM LIVE SESSION' : 'WAITING FOR CONTROLLER'}</div>
                    <div className="bg-slate-900 px-4 py-2 rounded border border-slate-800 font-bold text-sky-500">SESSION: {sessionID}</div>
                    {syncProblem && <div role="alert" className="max-w-md px-4 text-center text-sm text-red-300">{syncStatus.message || 'Check the Firebase connection and session permissions.'}</div>}
                </div>
            ); 
        }
        return <MonitorScreen sim={sim} />; 
    };
    
    window.MonitorDefib = MonitorDefib;
    window.MonitorScreen = MonitorScreen;
    window.MonitorContainer = MonitorContainer;
})();
