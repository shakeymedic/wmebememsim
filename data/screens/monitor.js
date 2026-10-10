(() => {
    const { useState, useEffect, useRef } = React;

    const InvBtn = ({ label, icon, onClick, loading }) => {
        const { Lucide } = window;
        return (
            <button onClick={onClick} disabled={loading} className="flex flex-col items-center justify-center p-1 md:p-2 bg-slate-900 hover:bg-slate-800 border-r border-slate-800 last:border-0 text-slate-400 hover:text-sky-400 hover:bg-slate-800/50 transition-all flex-1 disabled:opacity-50 disabled:cursor-wait group">
                {loading ? <Lucide icon="loader-2" className="w-5 h-5 md:w-6 md:h-6 animate-spin mb-1"/> : <Lucide icon={icon} className="w-5 h-5 md:w-6 md:h-6 mb-1 text-slate-400 group-hover:text-sky-400 transition-colors"/>}
                <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-wider">{label}</span>
            </button>
        );
    };

    // The 12-lead renderer lives in data/rhythms.js (RHYTHMS.render12Lead) so this monitor and the
    // standalone defibrillator page draw the identical recording from the identical registry.
    const render12Lead = (canvas, rhythm, scenario, hr) => window.RHYTHMS.render12Lead(canvas, rhythm, scenario, hr);

    // =========================================================================================
    // THE DEFIBRILLATOR, HOSTED ON THE STUDENT MONITOR.
    //
    // WHY THIS EXISTS. defib/index.html has ZERO Firebase: it is BroadcastChannel-only, which only
    // works between tabs of the SAME browser on the SAME device. Opened on a second physical
    // device (the usual setup — controller on the facilitator's laptop, defib on a tablet by the
    // bed) it silently showed a healthy sinus patient at HR 75 and answered "NO SHOCK ADVISED" in
    // VF. This component is driven by the SAME Firebase session sync as the rest of the monitor,
    // so it is correct on any device.
    //
    // THE OBS STAY VISIBLE. This extends the existing arrest-view dual-trace pattern
    // (LEAD II + PADS) rather than inventing a new layout, and puts the live vitals column
    // alongside. It is a flex row on landscape tablets and stacks with its own scroll container
    // at narrow widths (no fixed min-widths, no horizontal overflow — the app has had a
    // mobile-overflow bug class before and this must not reintroduce it).
    //
    // Every student press is pushed to sessions/<CODE>/deviceEvents (PUSH semantics, its own
    // node) NOT to sessions/<CODE>/command, which is a single set() slot already owned by NIBP.
    // The controller converges them all on applyShockOutcome / deliverShock.
    // =========================================================================================
    // =========================================================================================
    // THE DEFIB AND THE VENTILATOR ON A PATIENT SCREEN. Each is the same device page a tablet
    // uses (defib/index.html, vent/index.html), embedded, so there is one of each to maintain and
    // the screen gets every feature the tablet has.
    //
    // A device that is in the room stays LOADED while the screen switches away from it: it is only
    // hidden, so the ventilator keeps ventilating and alarming, the defib keeps its charge, and
    // switching back is instant. The facilitator brings a device in (Defib / Ventilator on the
    // controller); a screen that can show it brings it to the front, and the candidate switches
    // with the buttons at the bottom left. Which screen shows what is set per screen
    // (window.SimScreens: all-in-one, monitor only, or defib and ventilator).
    // =========================================================================================
    const DEVICE_PAGES = {
        defib: { title: 'Defibrillator', src: 'defib/index.html', testId: 'monitor-defib' },
        vent: { title: 'Ventilator', src: 'vent/index.html', testId: 'monitor-vent' }
    };
    const DeviceLayer = ({ kind, sessionID, shown }) => {
        const d = DEVICE_PAGES[kind];
        return (
            <div className={`absolute inset-0 z-[110] bg-black flex flex-col ${shown ? 'animate-fadeIn' : 'invisible pointer-events-none'}`} data-testid={d.testId} aria-hidden={!shown}>
                <iframe title={d.title} src={`${d.src}?session=${encodeURIComponent(sessionID || '')}&embedded=1`}
                        className="w-full h-full border-0 bg-black" allow="screen-wake-lock; autoplay; fullscreen" />
            </div>
        );
    };
    const SWITCH_LABELS = { monitor: 'Monitor', defib: 'Defib', vent: 'Ventilator' };
    const SWITCH_ICONS = { monitor: 'activity', defib: 'zap', vent: 'wind' };
    const ScreenSwitcher = ({ options, value, onChange, extra }) => {
        const { Lucide } = window;
        return (
            <div role="group" aria-label="Show on this screen" data-testid="screen-switcher"
                 className="absolute left-2 bottom-2 z-[120] flex gap-1 p-1 rounded-xl bg-slate-900/90 border border-slate-600 shadow-lg">
                {options.map(k => (
                    <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={value === k} data-screen={k}
                            className={`min-h-[44px] px-3 rounded-lg flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider ${value === k ? 'bg-sky-600 text-white' : 'text-slate-200 hover:bg-slate-700'}`}>
                        <Lucide icon={SWITCH_ICONS[k]} className="w-4 h-4"/> {SWITCH_LABELS[k]}
                    </button>
                ))}
                {extra}
            </div>
        );
    };
    // Which view is in front. A device the facilitator brings in comes to the front; one taken
    // away hands the screen back. `avail` lists what this screen can show right now, in order.
    const useFrontView = (avail, opened, fallback) => {
        const [front, setFront] = useState(null);
        const prev = useRef({});
        useEffect(() => {
            const p = prev.current;
            const newly = ['defib', 'vent'].find(k => opened[k] && !p[k] && avail.includes(k));
            if (newly) setFront(newly);
            prev.current = { ...opened };
        }, [opened.defib, opened.vent, avail.join(',')]);
        const shown = avail.includes(front) ? front : fallback;
        return [shown, setFront];
    };
    // Keep a patient screen awake (the monitor has its own, fuller version).
    const useWakeLock = () => {
        useEffect(() => {
            if (!('wakeLock' in navigator)) return;
            let lock = null, gone = false;
            const req = async () => {
                if (gone || document.visibilityState !== 'visible' || (lock && !lock.released)) return;
                try { lock = await navigator.wakeLock.request('screen'); } catch (e) {}
            };
            req();
            const onVis = () => req();
            document.addEventListener('visibilitychange', onVis);
            document.addEventListener('pointerdown', onVis);
            return () => { gone = true; document.removeEventListener('visibilitychange', onVis); document.removeEventListener('pointerdown', onVis); try { if (lock) lock.release(); } catch (e) {} };
        }, []);
    };
    const toggleFullscreenDoc = () => {
        try {
            if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
            else { const el = document.documentElement; const p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el); if (p && p.catch) p.catch(() => {}); }
        } catch (e) {}
    };

    // The second screen of a two-screen set-up: the defib and the ventilator, both ready, with the
    // one the facilitator last brought in at the front.
    const DeviceScreen = ({ sim, sessionID }) => {
        const { Lucide } = window;
        const { state, dispatch } = sim;
        useWakeLock();
        const opened = { defib: !!state.defibPanelOpen, vent: !!state.ventPanelOpen };
        const [shown, setFront] = useFrontView(['defib', 'vent'], opened, opened.vent && !opened.defib ? 'vent' : 'defib');
        useEffect(() => { dispatch({ type: 'SET_LOCAL_SCREEN', payload: { role: 'devices', shows: shown } }); }, [shown]);
        if (state.isFinished) {
            return (
                <div className="h-full w-full bg-black text-white flex items-center justify-center p-6" role="status" aria-live="polite">
                    <div className="max-w-xl w-full bg-slate-900 border border-slate-700 rounded-lg p-8 text-center">
                        <Lucide icon="check-circle" className="w-14 h-14 text-emerald-500 mx-auto mb-4" />
                        <h1 className="text-3xl font-bold mb-2">Simulation complete</h1>
                        <p className="text-slate-300">Please turn to your facilitator for the debrief.</p>
                    </div>
                </div>
            );
        }
        const fsSupported = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
        return (
            <div className="h-full w-full relative bg-black overflow-hidden" data-testid="device-screen">
                <DeviceLayer kind="defib" sessionID={sessionID} shown={shown === 'defib'} />
                <DeviceLayer kind="vent" sessionID={sessionID} shown={shown === 'vent'} />
                <ScreenSwitcher options={['defib', 'vent']} value={shown} onChange={setFront}
                    extra={fsSupported && (
                        <button type="button" onClick={toggleFullscreenDoc} aria-label="Full screen" title="Full screen"
                                className="min-h-[44px] px-2 rounded-lg text-slate-300 hover:bg-slate-700"><Lucide icon="maximize" className="w-4 h-4"/></button>
                    )} />
            </div>
        );
    };

    const MonitorScreen = ({ sim, sessionID, screen }) => {
        const { VitalDisplay, ECGMonitor, Lucide, Button, Modal } = window;
        const { state, enableAudio, triggerNIBP, toggleNIBPMode, revealInvestigation } = sim;
        const { vitals, prevVitals, rhythm, flash, activeInterventions, etco2Enabled, etco2Pathology, cprInProgress, scenario, nibp, monitorPopup, notification, arrestPanelOpen, defibPanelOpen, loadingInvestigations, showWetflag } = state;
        // 'all': this screen also shows the defib and the ventilator when the facilitator brings them
        // in. 'monitor': they are on other screens, so this one never shows them.
        const allInOne = !window.SimScreens || window.SimScreens.roleOf(screen) === 'all';
        const defibHere = allInOne && !!defibPanelOpen;
        const ventHere = allInOne && !!state.ventPanelOpen;
        const [shownView, setFrontView] = useFrontView(['monitor'].concat(defibHere ? ['defib'] : [], ventHere ? ['vent'] : []),
            { defib: defibHere, vent: ventHere }, 'monitor');
        useEffect(() => { sim.dispatch({ type: 'SET_LOCAL_SCREEN', payload: { role: allInOne ? 'all' : 'monitor', shows: shownView } }); }, [allInOne, shownView]);
        const syncStatus = state.syncStatus || { state: 'connecting', message: 'Connecting to live session…' };
        const syncProblem = ['unavailable', 'disconnected', 'error', 'degraded'].includes(syncStatus.state);
        // Each sensor gates exactly its own value/trace. Derived from the shared
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
        // The shark-fin severity arrives as a plain top-level number on the wire
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
        const [viewImage, setViewImage] = useState(null);     // full-screen view of a result image
        const INV = window.INVESTIGATIONS;
        // The scenario's own real 12-lead, if it has one and it still fits the patient's rhythm. The
        // synced scenario carries its results at the top level (scenario.ecg); a locally loaded one
        // under scenario.investigations.
        const scenarioEcgImage = (() => {
            const ecg = scenario && ((scenario.ecg && scenario.ecg.image) ? scenario.ecg : (scenario.investigations && scenario.investigations.ecg));
            const key = ecg && ecg.image;
            return (INV && key && INV.ecgImageFits(key, state.rhythm)) ? key : null;
        })();
        // Fetch the scenario's own images when it loads, so they show at once when a result is sent
        // (the service worker stores each one; they are not stored in advance with the rest of the site).
        const scenarioImageKeys = (() => {
            if (!INV || !scenario) return '';
            const keys = [scenario.chestXray, scenario.ct, scenario.pocus, scenario.ecg, ...Object.values(scenario.investigations || {})]
                .map(r => r && typeof r === 'object' ? r.image : null).filter(k => k && INV.IMAGES[k]);
            return [...new Set(keys)].join(' ');
        })();
        useEffect(() => {
            scenarioImageKeys.split(' ').filter(Boolean).forEach(k => { const im = new Image(); im.src = INV.IMAGES[k].src; });
        }, [scenarioImageKeys]);
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
                setViewImage(null);
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
                        const labels = { leuks: 'Leucocytes', nitrites: 'Nitrites', blood: 'Blood', ketones: 'Ketones', protein: 'Protein', glucose: 'Glucose', bhcg: 'B-hCG' };
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
                // The image: one the facilitator chose with the result, or (for the scenario's own
                // result) the scenario's image. An ECG image only while the rhythm still fits it.
                const KEYS = { 'X-ray': 'chestXray', CT: 'ct', POCUS: 'pocus', ECG: 'ecg' };
                let image = monitorPopup.image || null;
                if (!image && !ct && scenario && KEYS[type]) {
                    // (On the room monitor the synced scenario carries the results at the top level.)
                    const top = scenario[KEYS[type]], gen = (scenario.investigations || {})[KEYS[type]];
                    const src = (gen && gen.image) ? gen : top;
                    image = (type === 'ECG' ? (src && src.image) : ((top && top.image) || (gen && gen.image))) || null;
                    if (type === 'ECG' && image && src.imageReport) content = src.imageReport;
                }
                if (image && type === 'ECG' && INV && !INV.ecgImageFits(image, state.rhythm)) image = null;
                if (image && !(INV && INV.imageFor(image))) image = null;
                setViewImage(null);
                setInvToast({ title, content, image, hideReport: !!monitorPopup.hideReport });
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
                        <div className="mt-6 pt-4 border-t border-slate-800 text-xs text-slate-400 font-mono uppercase tracking-widest">Monitor standby</div>
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
                
                {(() => {
                    // The result card. With an image it is wider (a 12-lead needs the width) and the
                    // image opens full screen when tapped; the credit sits under it in small print. If the
                    // image cannot load (offline before it was fetched), the card shows the written report.
                    const img = invToast && invToast.image && INV ? INV.imageFor(invToast.image) : null;
                    const wide = !!img;
                    return (
                        <div className={`absolute top-4 right-4 z-[70] transition-all duration-500 ${invToast ? 'translate-x-0 opacity-100' : 'translate-x-10 opacity-0 pointer-events-none'}`}>
                            <div className={`bg-slate-800 border-l-4 border-purple-500 rounded shadow-2xl p-4 max-w-[92vw] ${wide ? (img.modality === 'ECG' ? 'w-[760px]' : 'w-[520px]') : 'w-96'}`} data-testid="inv-result">
                                <div className="flex justify-between items-start mb-2">
                                    <h3 className="text-purple-400 font-bold uppercase text-sm flex items-center gap-2"><Lucide icon="activity" className="w-4 h-4"/> {invToast?.title} Result</h3>
                                    <button aria-label="Dismiss investigation result" onClick={()=>{ setInvToast(null); setViewImage(null); }} className="text-slate-400 hover:text-white pointer-events-auto"><Lucide icon="x" className="w-4 h-4"/></button>
                                </div>
                                {img && (
                                    <figure className="mb-2">
                                        <button type="button" onClick={() => setViewImage(invToast.image)} className="block w-full bg-black rounded overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400" aria-label={`Open the ${img.modality === 'ECG' ? '12-lead ECG' : invToast.title} image full screen`}>
                                            <img src={img.src} alt={img.modality === 'ECG' ? '12-lead ECG' : `${invToast.title} image`} className={`w-full object-contain ${img.modality === 'ECG' ? 'max-h-[42vh] bg-white' : 'max-h-[48vh]'}`} data-testid="inv-image"
                                                onError={() => setInvToast(t => (t && t.image === invToast.image) ? { ...t, image: null, hideReport: false } : t)} />
                                        </button>
                                        <figcaption className="text-[10px] text-slate-400 mt-1 leading-tight">Tap to enlarge. Image: {INV.creditText(img)}.</figcaption>
                                    </figure>
                                )}
                                {!(img && invToast.hideReport) && (
                                    <div className="text-white text-sm font-medium leading-relaxed whitespace-pre-line">
                                        {invToast?.content}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })()}

                {viewImage && INV && INV.imageFor(viewImage) && (
                    <Modal label="Investigation image" onClose={() => setViewImage(null)}>
                        <div className="bg-black/95 flex flex-col items-center justify-center p-3 w-[96vw] h-[94vh]" onClick={() => setViewImage(null)}>
                            <img src={INV.imageFor(viewImage).src} alt="Investigation image, full screen" className="max-w-full max-h-[86vh] object-contain bg-white" data-testid="inv-image-full" />
                            <div className="text-[11px] text-slate-400 mt-2">Tap to close. Image: {INV.creditText(INV.imageFor(viewImage))}.</div>
                        </div>
                    </Modal>
                )}

                {show12Lead && (
                    <Modal label="12-lead analysis" onClose={() => setShow12Lead(false)}>
                        <div className="bg-black/90 flex flex-col items-center justify-center p-4 animate-fadeIn">
                            <h2 className="text-white font-mono text-xl mb-2">12-LEAD ANALYSIS (Tap to Close)</h2>
                            {scenarioEcgImage ? (
                                <>
                                    <img src={INV.imageFor(scenarioEcgImage).src} alt="12-lead ECG" className="bg-white rounded shadow-lg max-w-full max-h-[78vh] cursor-pointer" onClick={() => setShow12Lead(false)} data-testid="ecg-12lead-image" />
                                    <div className="text-[11px] text-slate-400 mt-2">A real 12-lead ECG. Image: {INV.creditText(INV.imageFor(scenarioEcgImage))}.</div>
                                </>
                            ) : (
                                <canvas ref={canvasRef} width="1000" height="640" className="bg-white rounded shadow-lg max-w-full max-h-[80vh] cursor-pointer" onClick={() => setShow12Lead(false)} />
                            )}
                            {/* No printed interpretation: naming the rhythm here handed the team the answer. */}
                        </div>
                    </Modal>
                )}

                {/* A1-A3: the assessor's Defib toggle (state.defibPanelOpen, synced over Firebase
                    exactly like arrestPanelOpen) opens a WORKING defibrillator here, with the obs
                    still visible alongside it. */}
                {defibHere && <DeviceLayer kind="defib" sessionID={sessionID} shown={shownView === 'defib'} />}
                {ventHere && <DeviceLayer kind="vent" sessionID={sessionID} shown={shownView === 'vent'} />}
                {(defibHere || ventHere) && (
                    <ScreenSwitcher options={['monitor'].concat(defibHere ? ['defib'] : [], ventHere ? ['vent'] : [])} value={shownView} onChange={setFrontView} />
                )}

                {arrestPanelOpen && !defibHere && (
                    <div className="absolute inset-0 z-[100] bg-black flex flex-col animate-fadeIn">
                        <div className="bg-slate-900 border-b border-slate-700 p-2 flex justify-between items-center">
                            <div className="text-slate-300 font-bold uppercase tracking-wider flex items-center gap-2">
                                <Lucide icon="zap" className="text-red-500" /> Manual Defibrillator
                            </div>
                            <div className="text-red-500 font-mono font-bold animate-pulse text-xl">MANUAL DEFIBRILLATOR MODE</div>
                            <div className="text-slate-400">{new Date().toLocaleTimeString()}</div>
                        </div>

                        {/* Lead II and pads, plus the capnogram when capnography is attached: during
                            CPR it shows compression quality, and a sudden rise in ETCO2 is often
                            the first sign of ROSC. */}
                        <div className={`flex-grow min-h-0 relative bg-black grid ${etco2Enabled ? 'grid-rows-3' : 'grid-rows-2'}`}>
                             <div className="relative min-h-0 border-b border-slate-800">
                                <ECGMonitor rhythmType={rhythm} hr={vitals.hr} rr={0} spO2={0} isPaused={false} showTraces={true} showPleth={false} showResp={false} showEtco2={false} showArt={false} isCPR={cprInProgress} className="h-full" rhythmLabel="LEAD II" />
                             </div>
                             <div className={`relative min-h-0 ${etco2Enabled ? 'border-b border-slate-800' : ''}`}>
                                <ECGMonitor rhythmType={rhythm} hr={vitals.hr} rr={0} spO2={0} isPaused={false} showTraces={true} showPleth={false} showResp={false} showEtco2={false} showArt={false} isCPR={cprInProgress} className="h-full" rhythmLabel="PADS" />
                             </div>
                             {etco2Enabled && (
                                <div className="relative min-h-0" data-testid="arrest-capnogram">
                                    <ECGMonitor rhythmType={rhythm} hr={vitals.hr} rr={vitals.rr} etco2={vitals.etco2} isPaused={false} showTraces={true}
                                                showEcg={false} showPleth={false} showResp={false} showEtco2={true} showArt={false}
                                                isCPR={cprInProgress} cprBadge={false} co2Pathology={etco2Pathology || 'normal'} co2Severity={co2Severity}
                                                ventilating={capnoVentilating} className="h-full" />
                                    <div className="absolute bottom-1 right-2 z-20 font-mono text-purple-400 font-bold text-2xl">ETCO2 {Number.isFinite(vitals.etco2) ? vitals.etco2.toFixed(1) : '--'} <span className="text-xs text-purple-300/80">kPa</span></div>
                                </div>
                             )}
                        </div>

                        <div className="bg-slate-900 p-4 border-t border-slate-700 grid grid-cols-4 gap-4">
                             <div className="bg-black border border-slate-700 rounded p-2 text-center flex flex-col justify-center">
                                 <div className="text-slate-400 text-xs uppercase mb-1">Energy Select</div>
                                 <div className="text-3xl font-mono text-yellow-500 font-bold">{(state.defib && state.defib.energy) || window.RHYTHMS.recommendedEnergy(scenario?.wetflag?.weight, scenario?.patientAge)} J</div>
                             </div>
                             <div className="bg-black border border-slate-700 rounded p-2 text-center flex flex-col justify-center">
                                 <div className="text-slate-400 text-xs uppercase mb-1">Status</div>
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
                                  className={`hidden sm:flex items-center gap-1 px-1.5 py-1 rounded border text-[9px] font-bold uppercase tracking-wider ${wakeState === 'on' ? 'border-slate-700 text-slate-400' : 'border-amber-700 text-amber-400'}`}>
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
                                    <button onClick={(e) => { e.stopPropagation(); toggleNIBPMode(); }} className={`text-sm font-bold px-2 py-2 rounded border uppercase tracking-wide transition-colors shadow-lg h-12 flex-1 max-w-[80px] ${nibp.mode === 'auto' ? 'bg-emerald-900/80 border-emerald-500 text-emerald-400' : 'bg-slate-800 border-slate-600 text-slate-400'}`}>Auto</button>
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

                    {/* Temp / capillary glucose / pH are point-of-care measurements rather than
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
                                    <span className="text-[10px] md:text-xs uppercase tracking-widest text-slate-400 font-bold">{label}{sub ? <span className="ml-1 text-[9px] text-slate-400 normal-case tracking-normal">{sub}</span> : null}</span>
                                    <span className={`font-mono font-bold text-xl md:text-3xl ${value === null ? 'text-slate-700' : (alert ? 'text-amber-400' : 'text-sky-300')}`}>{value === null ? '--' : value}{value !== null && unit ? <span className="text-[10px] md:text-xs text-slate-400 ml-1">{unit}</span> : null}</span>
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
                                    {/* Serum potassium — hyperkalaemia and DKA finally have a
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
            <span className="text-[10px] text-slate-400 uppercase font-bold">{label}</span>
            <span className="font-mono text-lg font-bold text-white">{value}</span>
        </div>
    );

    const MonitorContainer = ({ sessionID, screen }) => { 
        const { Lucide } = window;
        const sim = useSimulation(null, true, sessionID); 
        // Console / test handle on the monitor's engine (read it, don't build on it).
        useEffect(() => { window.__monitorEngine = sim; });
        if (!sessionID) return null; 
        const syncStatus = sim.state.syncStatus || { state: 'connecting', message: 'Connecting to live session…' };
        const syncProblem = ['unavailable', 'disconnected', 'error', 'degraded'].includes(syncStatus.state);
        
        if (!sim.state.vitals || (!sim.state.vitals.hr && sim.state.vitals.hr !== 0)) {
            return (
                <div className="h-full flex flex-col items-center justify-center bg-black text-slate-400 gap-4 animate-fadeIn">
                    <Lucide icon="wifi" className="w-12 h-12 animate-pulse text-sky-500" />
                    <div className={`text-xl font-mono tracking-widest ${syncProblem ? 'text-red-300' : ''}`}>{syncProblem ? 'DISCONNECTED FROM LIVE SESSION' : 'WAITING FOR CONTROLLER'}</div>
                    <div className="bg-slate-900 px-4 py-2 rounded border border-slate-800 font-bold text-sky-500">SESSION: {sessionID}</div>
                    {window.SimScreens && <div className="text-sm text-slate-400" data-testid="waiting-screen-role">This screen: <b className="text-slate-200">{window.SimScreens.ROLES[window.SimScreens.roleOf(screen)].title}</b></div>}
                    {syncProblem && <div role="alert" className="max-w-md px-4 text-center text-sm text-red-300">{syncStatus.message || 'Check the Firebase connection and session permissions.'}</div>}
                </div>
            ); 
        }
        if (window.SimScreens && window.SimScreens.roleOf(screen) === 'devices') return <DeviceScreen sim={sim} sessionID={sessionID} />;
        return <MonitorScreen sim={sim} sessionID={sessionID} screen={screen} />; 
    };
    
    window.DeviceScreen = DeviceScreen;
    window.MonitorScreen = MonitorScreen;
    window.MonitorContainer = MonitorContainer;
})();
