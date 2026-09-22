(() => {
    const { useState, useEffect, useRef } = React;
    // WAVE 4a: the pk helpers are the engine's own (window.__pkInternals), never a reimplementation,
    // so the Active Drugs panel always agrees with the physiology.
    const PKI = window.__pkInternals || {};

    const PREDEFINED_FINDINGS = {
        'CT': [
            'Normal Head CT',
            'Large Subdural Haematoma with midline shift',
            'Epidural Haematoma',
            'Subarachnoid Haemorrhage (Fisher Grade 3)',
            'Large MCA Territory Infarct',
            'Dense MCA Sign',
            'Intraparenchymal Haemorrhage',
            'Basal Skull Fracture',
            'C-Spine: No acute fracture',
            'CTPA: Large saddle embolus',
            'CTPA: Segmental PE',
            'CT Abdo: Free gas (perforation)',
            'CT Abdo: Ruptured AAA',
            'CT Abdo: Acute appendicitis'
        ],
        'X-ray': [
            'Normal CXR',
            'Large right-sided pneumothorax',
            'Tension pneumothorax (tracheal deviation)',
            'Left lower lobe consolidation',
            'Right upper lobe consolidation',
            'Bilateral diffuse infiltrates (Pulmonary Oedema)',
            'Widened mediastinum',
            'Right neck of femur fracture',
            'Pelvic ring fracture (open book)',
            'Distal radius fracture'
        ],
        'ECG': [
            'Normal Sinus Rhythm',
            'Anterior STEMI (V1-V4 ST elevation)',
            'Inferior STEMI (II, III, aVF ST elevation)',
            'Lateral STEMI (I, aVL, V5-V6)',
            'Atrial Fibrillation (Rapid Ventricular Response)',
            'SVT (Narrow complex tachycardia)',
            'Complete Heart Block (3rd Degree)',
            '1st Degree AV Block',
            'LBBB (New onset)',
            'RBBB',
            'Prolonged QT interval',
            'Peaked T waves (Hyperkalaemia)',
            'VT (Broad complex tachycardia)'
        ],
        'VBG': [
            'Normal (pH 7.4, pCO2 5.0, Lactate 1.0)',
            'Severe Metabolic Acidosis (pH 7.1, Lac 8.0, HCO3 12)',
            'Respiratory Acidosis (pH 7.2, pCO2 9.0)',
            'Hyperkalaemia (K+ 7.2)',
            'Severe DKA (pH 7.0, Glu >30, Ketones 6.0)',
            'Sepsis pattern (Lac 5.5, BE -8)'
        ],
        'Urine': [
            'Normal',
            'Leukocytes +++, Nitrites +, Blood + (UTI)',
            'Blood +++ (Haematuria)',
            'Ketones +++, Glucose +++ (DKA)',
            'Protein +++ (Pre-eclampsia/Renal)',
            'B-hCG Positive (Pregnancy)'
        ],
        'POCUS': [
            'Normal / No free fluid',
            'FAST: Free fluid in Morison\'s pouch',
            'FAST: Free fluid in Splenorenal recess',
            'FAST: Pelvic free fluid',
            'ECHO: Large Pericardial Effusion / Tamponade',
            'ECHO: Poor LV function',
            'ECHO: Dilated Right Ventricle',
            'LUNG: Absent lung sliding (Pneumothorax)',
            'LUNG: B-lines bilaterally (Pulmonary Oedema)',
            'AORTA: AAA > 5.5cm'
        ]
    };

    const DRUG_CALC_LIST = [
        { name: 'Adrenaline IM (Anaphylaxis)', perKg: 0.01, unit: 'mg', max: 0.5, info: '1:1000 (1 mg/ml) IM' },
        { name: 'Adrenaline IV (Arrest)', perKg: 0.01, unit: 'mg', max: 1, info: '1:10 000 (0.1 mg/ml) IV' },
        { name: 'Lorazepam (Seizure)', perKg: 0.1, unit: 'mg', max: 4, info: '4 mg/ml IV/IO' },
        { name: 'Midazolam Buccal (Seizure)', perKg: 0.2, unit: 'mg', max: 10, info: '10 mg/ml Buccal' },
        { name: 'Morphine IV', perKg: 0.1, unit: 'mg', max: 10, info: '10 mg/ml IV slow' },
        { name: 'Ketamine (RSI/Anaesthesia)', perKg: 1.5, unit: 'mg', max: 200, info: '50 mg/ml IV' },
        { name: 'Rocuronium (RSI)', perKg: 1.2, unit: 'mg', max: 200, info: '10 mg/ml IV' },
        { name: 'Suxamethonium (RSI)', perKg: 2, unit: 'mg', max: 200, info: '50 mg/ml IV' },
        { name: 'Amiodarone (Arrest)', perKg: 5, unit: 'mg', max: 300, info: '50 mg/ml IV rapid' },
        { name: 'Atropine (Bradycardia)', perKg: 0.02, unit: 'mg', min: 0.1, max: 3, info: '0.6 mg/ml IV/IO' },
        { name: 'Paracetamol IV', perKg: 15, unit: 'mg', max: 1000, info: '10 mg/ml IV' },
        { name: 'Glucose 10%', perKg: 5, unit: 'ml', max: 500, info: 'IV bolus' },
        { name: 'Sodium Bicarb 8.4%', perKg: 1, unit: 'mmol', max: 50, info: '1 mmol/ml IV slow' },
        { name: 'TXA (Trauma Haemorrhage)', perKg: 15, unit: 'mg', max: 1000, info: '100 mg/ml IV slow over 10 min' },
        { name: 'Ceftriaxone (Sepsis)', perKg: 50, unit: 'mg', max: 2000, info: '250 mg/ml IV' },
        { name: 'IV Fluid Bolus', perKg: 10, unit: 'ml', max: 500, info: "NS or Hartmann's IV" },
        { name: 'MgSO4 (Asthma / Seizure)', perKg: 40, unit: 'mg', max: 2000, info: '500 mg/ml IV slow 20 min' },
    ];

    const LiveSimScreen = ({ sim, onFinish, onBack, sessionID }) => {
        const { INTERVENTIONS, Button, Lucide, Card, VitalDisplay, ECGMonitor, HumanFactorBadge, formatProfileTemplate, Modal } = window;
        const { state, start, pause, applyIntervention, addLogEntry, manualUpdateVital, triggerArrest, triggerROSC, startTrend, speak, revealInvestigation, clearInvestigation, triggerNIBP, initCharge, deliverShock } = sim;
        // WAVE 3 defibrillator + rhythm surface.
        const RG = window.RHYTHMS;
        const changeRhythm = sim.changeRhythm;
        const nextCycle = sim.nextCycle;

        const { scenario: rawScenario, time, isRunning, vitals, activeInterventions, interventionCounts, activeDurations, arrestPanelOpen, cprInProgress, flash, notification, trends, audioOutput, isMuted, etco2Enabled, etco2Pathology, showWetflag } = state;
        // WAVE 3: defibPanelOpen (the monitor-hosted defib), the defib device/metrics block and the
        // ASSESSOR-LOCAL conversion announcements. rhythmEvent/lastConversion never reach Firebase.
        const defibPanelOpen = !!state.defibPanelOpen;
        const defib = state.defib || {};
        const rhythmEvent = state.rhythmEvent;
        const lastConversion = state.lastConversion;
        const remoteClients = (state.remotePresence && state.remotePresence.clients) || [];
        // WAVE 2: deterioration mode + live drug timing.
        const deteriorationMode = state.deteriorationMode || 'manual';
        const detInfo = sim.describeDeterioration ? sim.describeDeterioration() : { declared: false, type: null, rate: 0 };
        // Recomputed on every render; `time` changes at 1 Hz so the panel counts down live.
        const activeDrugRows = sim.getActiveDrugStatus ? sim.getActiveDrugStatus() : [];
        const fmtRemaining = (s) => {
            if (s === null || s === undefined) return '\u2014';
            if (s >= 60) return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
            return `${Math.max(0, Math.round(s))}s`;
        };
        const PHASE_STYLE = {
            onset: { cls: 'text-sky-300 border-sky-500/50 bg-sky-950/40', label: 'ONSET' },
            rising: { cls: 'text-amber-300 border-amber-500/50 bg-amber-950/40', label: 'RISING' },
            peak: { cls: 'text-emerald-300 border-emerald-500/50 bg-emerald-950/40', label: 'PEAK' },
            running: { cls: 'text-emerald-300 border-emerald-500/50 bg-emerald-950/40', label: 'RUNNING' },
            'wearing off': { cls: 'text-orange-300 border-orange-500/50 bg-orange-950/40', label: 'WEARING OFF' }
        };
        const syncStatus = state.syncStatus || { state: 'connecting', message: 'Connecting to live session…' };
        const syncProblem = ['unavailable', 'disconnected', 'error', 'degraded'].includes(syncStatus.state);
        // A restored or partially-synced session can arrive without a scenario; every field read below
        // must degrade to blank rather than take down the whole render tree.
        const scenario = rawScenario || {};
        // ======================= WAVE 4b / PART A: QUICK SIM =======================================
        // `quickSim` is a single boolean read off the SAME scenario object every other screen reads.
        // This is NOT a parallel controller (requirement A4): it is this controller with the
        // scenario-dependent panels omitted. Everything that stays — the vitals tiles, the
        // vitals-control modal and its validation, the trend-over-time control, the rhythm selector,
        // ARREST/ROSC, Launch Monitor, the Defib and Arrest View toggles, the timer, start/pause/
        // finish and the event log — is the existing code path, unchanged and unduplicated.
        //
        // What is omitted, and why:
        //   * intervention library / tabs / search  — nothing to give; there is no scenario.
        //   * drug panel + Active Drugs/pk panels   — no drugs can be given, so they'd be dead UI.
        //   * scenario brief / patient details card — there is no brief.
        //   * learning objectives                   — none exist.
        //   * safety-flag chip + expectation hints  — expectations are properties of interventions;
        //                                             with no interventions there is nothing to flag.
        //   * investigations / voice / assessment   — all scenario-content driven.
        // What is explicitly KEPT in Quick Sim despite being "extra": the AUTO/MANUAL deterioration
        // toggle (requirement A6 — defaults to MANUAL because the synthetic patient declares no rate,
        // but the facilitator can still switch to AUTO), Trend Better/Worse (they fall back to
        // relative adjustments when no scenario evolution exists), the custom log entry with its Flag
        // button, NIBP, the drug-dose calculator and the timer alerts — all facilitator tools that
        // are useful without a scenario.
        const quickSim = !!scenario.quickSim;
        const etco2Shape = etco2Pathology || 'normal';
        const setEtco2Shape = (shape) => sim.dispatch({ type: 'SET_ETCO2_PATHOLOGY', payload: shape });
        
        const [activeTab, setActiveTab] = useState("Common");
        const [customLog, setCustomLog] = useState("");
        const [searchTerm, setSearchTerm] = useState("");
        const [speechText, setSpeechText] = useState(""); 
        const [modalVital, setModalVital] = useState(null); 
        const [modalTarget, setModalTarget] = useState("");
        const [modalTarget2, setModalTarget2] = useState(""); 
        const [trendDuration, setTrendDuration] = useState(30);
        const [showLogModal, setShowLogModal] = useState(false);
        const [showRhythmModal, setShowRhythmModal] = useState(false);
        const [showArrestMenu, setShowArrestMenu] = useState(false);
        const [showROSCMenu, setShowROSCMenu] = useState(false);
        const [searchResults, setSearchResults] = useState([]);

        const [invModal, setInvModal] = useState(null);
        const [invCustomText, setInvCustomText] = useState("");

        const [showNIBPModal, setShowNIBPModal] = useState(false);
        const [nibpSys, setNibpSys] = useState(vitals.bpSys);
        const [nibpDia, setNibpDia] = useState(vitals.bpDia);

        const [showDrugCalc, setShowDrugCalc] = useState(false);
        const [drugCalcWeightStr, setDrugCalcWeightStr] = useState(String(scenario.wetflag?.weight || scenario.weight || 70));
        // A weight of 0 or a typo silently produced 0 mg doses and 0 J energies — every derived number in
        // the calculator is a multiple of it, so an invalid weight must block the whole table, not coerce.
        const drugCalcWeightError = window.validateBuilderField ? window.validateBuilderField('weight', drugCalcWeightStr) : null;
        const drugCalcWeight = drugCalcWeightError ? 0 : parseFloat(drugCalcWeightStr);
        const [showTimerModal, setShowTimerModal] = useState(false);
        const [timerAlerts, setTimerAlerts] = useState([]);
        const [newAlertMins, setNewAlertMins] = useState('5');
        const [newAlertMsg, setNewAlertMsg] = useState('');
        const [timerAlertError, setTimerAlertError] = useState('');
        const [firedAlerts, setFiredAlerts] = useState(new Set());
        const firedAlertsRef = useRef(new Set());
        const [showKeyHelp, setShowKeyHelp] = useState(false);
        const [showFlagsModal, setShowFlagsModal] = useState(false);
        // Alarm tones now live in the shared engine (so the STUDENT monitor alarms too) and are routed
        // by `audioOutput`. This screen no longer owns an AudioContext, which also removes the risk of
        // the controller double-playing every alarm.
        const playAlertTone = sim.playAlertTone || (() => {});

        // Reset fired-alerts when sim resets to T=0
        useEffect(() => {
            if (time === 0) {
                firedAlertsRef.current = new Set();
                setFiredAlerts(new Set());
            }
        }, [time === 0]);

        // Alarm thresholds are applied in the shared engine now (so students hear alarms too); kept
        // here only for on-screen reference by future panels.
        const thresholds = (window.getAlarmThresholds && window.getAlarmThresholds(scenario?.patientAge ?? 40)) || { hr: {low:40,high:130}, rr:{low:8,high:30}, spO2:90 };

        const [assessments, setAssessments] = useState({
            "Safe Approach": null,
            "Team Leadership": null,
            "Communication": null,
            "CPR Quality": null,
            "Defib Safety": null,
            "Re-evaluation": null
        });

        // C1/C3: every rhythm menu is now derived from the shared registry, so the arrest menu can
        // no longer offer a rhythm no scenario uses, and the ROSC menu can no longer omit Atrial
        // Flutter or Complete Heart Block.
        const RHYTHMS = RG.SELECTABLE;
        const ARREST_RHYTHMS = RG.ARREST;
        const ROSC_RHYTHMS = RG.ROSC;
        const VOICE_PHRASES = ["My chest hurts", "I can't breathe", "I feel sick", "Who are you?", "My tummy hurts", "I feel dizzy", "Am I going to die?", "Yes", "No", "I'm thirsty", "Where am I?", "Please help me"];
        
        // WAVE 4a: the 28 new route-specific keys are grouped here so they are reachable in two taps
        // and sit beside their IV equivalents (the route is printed on every button).
        const DRUG_GROUPS = {
            "Resus / Cardiac": ["AdrenalineIV", "AdrenalinePush", "AdrenalineInfusion", "Amiodarone", "AmiodaroneInfusion", "Atropine", "Adenosine", "Digoxin", "MagSulph", "MagnesiumInfusion", "Calcium", "CalciumChloride", "SodiumBicarb", "AdrenalineIM"],
            // 'Morphine' was a dead slot here: the intervention key is 'Analgesia' (label "Morphine"),
            // so the group rendered one permanently missing button.
            "RSI / Induction": ["Propofol", "Ketamine", "KetamineIM", "Etomidate", "Thiopentone", "Midazolam", "Alfentanil", "Fentanyl", "Roc", "Sux", "Sugammadex"],
            "Sedation / Analgesia": ["Analgesia", "MorphineIM", "MorphineOral", "Paracetamol", "ParacetamolOral", "Metoclopramide", "Naloxone", "NaloxoneIM", "NaloxoneIN", "Flumazenil"],
            // NICE NG217 / APLS: buccal midazolam is step 1 when there is no IV/IO access, and PR
            // diazepam is the community alternative. Neither existed before Wave 4a.
            "Seizures (by route)": ["MidazolamBuccal", "MidazolamIN", "MidazolamIM", "Lorazepam", "LorazepamIM", "DiazepamIV", "DiazepamPR", "Levetiracetam", "Phenytoin"],
            "Vasoactive": ["Metaraminol", "Noradrenaline", "Labetalol", "LabetalolInfusion", "Phentolamine"],
            "Antibiotics": ["Antibiotics", "Ceftriaxone", "Tazocin", "Gentamicin", "Benzylpenicillin", "BenzylpenicillinIM"],
            "Glucose / Insulin": ["InsulinInfusion", "InsulinDextrose", "InsulinSubcut", "Dextrose", "GlucoseOral", "Glucagon"],
            "Other": [] 
        };
        const KNOWN_DRUGS = new Set(Object.values(DRUG_GROUPS).flat());

        useEffect(() => {
            if (!searchTerm) { setSearchResults([]); return; }
            const term = searchTerm.toLowerCase();
            const matches = Object.keys(INTERVENTIONS).filter(key => {
                const item = INTERVENTIONS[key];
                // WAVE 4a: route is searchable too, so "IM", "buccal", "PR" or "intranasal" finds the
                // right key without knowing the label.
                return item.label.toLowerCase().includes(term) || key.toLowerCase().includes(term)
                    || (item.route || '').toLowerCase().includes(term);
            });
            setSearchResults(matches);
        }, [searchTerm]);

        const getInterventionsByCat = (cat) => {
            let keys = [];
            if (cat === 'Common') keys = ['Obs', 'Oxygen', 'IV Access', 'Fluids', 'Analgesia', 'Antiemetic', 'Antibiotics', 'Nebs', 'AdrenalineIM', 'Blood', 'TXA', 'ArtLine', 'ChestSeal']; 
            else keys = Object.keys(INTERVENTIONS).filter(key => INTERVENTIONS[key].category === cat);
            return keys.sort((a, b) => INTERVENTIONS[a].label.localeCompare(INTERVENTIONS[b].label));
        };

        const [showToast, setShowToast] = useState(false);
        useEffect(() => {
            if(notification && notification.id) {
                setShowToast(true);
                const timer = setTimeout(() => setShowToast(false), 3000);
                return () => clearTimeout(timer);
            }
        }, [notification]);

        useEffect(() => {
            sim.dispatch({type: 'UPDATE_ASSESSMENT', payload: assessments});
        }, [assessments]);

        useEffect(() => {
            if (!isRunning) return;
            timerAlerts.forEach(alert => {
                const alertTimeS = alert.mins * 60;
                if (time >= alertTimeS && !firedAlertsRef.current.has(alert.id)) {
                    firedAlertsRef.current.add(alert.id);
                    setFiredAlerts(new Set(firedAlertsRef.current));
                    addLogEntry(`Timer Alert: ${alert.msg}`, 'danger');
                    playAlertTone('critical');
                }
            });
        }, [time, isRunning, timerAlerts]);

        useEffect(() => {
            const handler = (e) => {
                const modalOpen = modalVital || showDrugCalc || showTimerModal || invModal || showNIBPModal || showLogModal || showRhythmModal || showKeyHelp || showFlagsModal || showArrestMenu || showROSCMenu || arrestPanelOpen;
                if (modalOpen) return;
                const active = document.activeElement;
                if (active?.matches?.('button, a, input, select, textarea, [role="button"], [contenteditable="true"]')) return;
                if (e.key === ' ') { e.preventDefault(); isRunning ? pause() : start(); }
                if (e.key === 'f' || e.key === 'F') { if (window.confirm('End the simulation and go to debrief?')) onFinish(); }
                if (e.key === 'd' || e.key === 'D') setShowDrugCalc(v => !v);
                if (e.key === 't' || e.key === 'T') setShowTimerModal(v => !v);
                if (e.key === '?') setShowKeyHelp(v => !v);
            };
            window.addEventListener('keydown', handler);
            return () => window.removeEventListener('keydown', handler);
        }, [isRunning, modalVital, showDrugCalc, showTimerModal, invModal, showNIBPModal, showLogModal, showRhythmModal, showKeyHelp, showFlagsModal, showArrestMenu, showROSCMenu, arrestPanelOpen]);

        const formatTime = (s) => `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
        // In Quick Sim the engine seeds the real 'Obs' key at LOAD_SCENARIO, so this is already true;
        // the explicit `|| quickSim` is a belt-and-braces guard so a resumed or synced Quick Sim can
        // never show "No Monitoring" over a screen whose entire purpose is the monitor.
        const isMonitoringApplied = activeInterventions.has('Obs') || quickSim; 
        const showEtco2 = etco2Enabled;
        const showArt = activeInterventions.has('ArtLine');
        const isPaeds = scenario.ageRange === 'Paediatric' || scenario.wetflag;

        const cycleAudioOutput = () => {
             const next = audioOutput === 'controller' ? 'monitor' : (audioOutput === 'monitor' ? 'both' : 'controller');
             sim.dispatch({type: 'SET_AUDIO_OUTPUT', payload: next});
        };

        const handleRemove = (e, key, type) => {
            e.stopPropagation(); 
            if (type === 'continuous') sim.dispatch({ type: 'REMOVE_INTERVENTION', payload: key });
            else sim.dispatch({ type: 'DECREMENT_INTERVENTION', payload: key });
        };

        // Nothing is ever disabled. An amber corner marker simply SHOWS what is not in place yet, so
        // the facilitator can see a sequence deviation before clicking without being prevented.
        const unmetFor = (action) => (window.getUnmetExpectations ? window.getUnmetExpectations(action, state) : []);

        const renderActionBtn = (key) => {
             const action = INTERVENTIONS[key];
             if (!action) return null;
             const count = interventionCounts[key] || 0;
             const isActive = activeInterventions.has(key);
             const variant = (count > 0 || isActive) ? "success" : "outline";
             const missing = unmetFor(action);
             const isContinuous = action.type === 'continuous';
             const btnTitle = missing.length
                 ? `Not in place yet: ${missing.join(', ')} \u2014 you can still do this, it will be flagged for the debrief.`
                 : (isActive && isContinuous ? `${action.label} is ACTIVE \u2014 pressing again STOPS it.` : action.label);
             return (
                 <button key={key} title={btnTitle} onClick={() => applyIntervention(key)} className={`relative h-14 p-2 rounded text-left bg-slate-700 hover:bg-slate-600 border flex flex-col justify-between overflow-hidden group/btn ${isActive && isContinuous ? 'border-emerald-500 ring-1 ring-emerald-500/40' : (missing.length ? 'border-amber-500/60' : 'border-slate-600')}`}>
                     <span className={`text-xs font-bold leading-tight ${variant === 'success' ? 'text-emerald-400' : 'text-slate-200'}`}>{action.label}</span>
                     <div className="flex justify-between items-end w-full">
                        {/* WAVE 4a / E1: the ROUTE is shown on every button, because IM vs IV vs buccal
                            is the whole point of the new route-specific keys and a facilitator must be
                            able to tell them apart at a glance mid-resus. */}
                        <span className={`text-[10px] truncate ${isActive && isContinuous ? 'text-emerald-400 font-bold uppercase not-italic' : 'opacity-70 italic'}`}>{isActive && isContinuous ? 'Active \u00b7 tap to stop' : (action.route && action.route !== 'n/a' ? action.route : action.category)}</span>
                        {count > 0 && action.type !== 'continuous' && <span className="bg-emerald-500 text-white text-[9px] font-bold px-1.5 rounded-full shadow-md">x{count}</span>}
                     </div>
                     {missing.length > 0 && (
                         <span aria-hidden="true" className="absolute top-0 left-0 w-0 h-0 border-t-[14px] border-l-[14px] border-t-amber-500 border-l-transparent"></span>
                     )}
                     {isActive && action.type === 'continuous' && (
                         <div className="absolute top-1 right-1 text-red-400 bg-slate-900/80 hover:bg-red-600 hover:text-white rounded-full p-1 cursor-pointer transition-colors z-10" onClick={(e) => handleRemove(e, key, 'continuous')}>
                             <Lucide icon="x" className="w-3 h-3"/>
                         </div>
                     )}
                     {!isActive && count > 0 && action.type !== 'continuous' && (
                         <div className="absolute top-1 right-1 text-red-400 bg-slate-900/80 hover:bg-red-600 hover:text-white rounded-full p-1 cursor-pointer transition-colors z-10" onClick={(e) => handleRemove(e, key, 'bolus')}>
                             <Lucide icon="minus" className="w-3 h-3"/>
                         </div>
                     )}
                     {activeDurations[key] && (<div className="absolute bottom-0 left-0 h-1 bg-emerald-400 transition-all duration-1000" style={{width: `${Math.max(0, 100 - ((time - activeDurations[key].startTime)/activeDurations[key].duration*100))}%`}}></div>)}
                 </button>
             );
        };
        
        const renderDrugsTab = () => {
             const allDrugs = Object.keys(INTERVENTIONS).filter(k => INTERVENTIONS[k].category === 'Drugs').sort();
             const groups = { ...DRUG_GROUPS, "Other": allDrugs.filter(d => !KNOWN_DRUGS.has(d)) };
             return (
                 <div className="space-y-4">
                     {Object.keys(groups).map(group => {
                         if (groups[group].length === 0) return null;
                         return (
                             <div key={group}>
                                 <h4 className="text-xs font-bold text-slate-500 uppercase mb-1 border-b border-slate-700 pb-1">{group}</h4>
                                 <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                                     {groups[group].map(key => renderActionBtn(key))}
                                 </div>
                             </div>
                         );
                     })}
                 </div>
             );
        };

        const openVitalControl = (key) => { setModalVital(key); setModalTarget(vitals[key === 'bp' ? 'bpSys' : key]); if (key === 'bp') setModalTarget2(vitals.bpDia); setTrendDuration(30); };
        // A blank or non-numeric field used to reach the reducer as NaN, which then poisoned the Firebase
        // diff (RTDB rejects NaN) and froze the student monitor for the rest of the session.
        const validateVitalModal = () => {
            if (modalVital === 'pupils') return modalTarget === '' || modalTarget === null ? 'Pupils is required.' : null;
            const field = modalVital === 'bp' ? 'bpSys' : modalVital;
            const err = window.validateBuilderField ? window.validateBuilderField(field, modalTarget) : null;
            if (err) return err;
            if (!Number.isFinite(parseFloat(modalTarget))) return 'Target must be a number.';
            if (modalVital === 'bp') {
                const err2 = window.validateBuilderField ? window.validateBuilderField('bpDia', modalTarget2) : null;
                if (err2) return err2;
                if (!Number.isFinite(parseFloat(modalTarget2))) return 'Diastolic must be a number.';
                if (parseFloat(modalTarget) <= parseFloat(modalTarget2)) return 'Systolic must be greater than diastolic.';
            }
            return null;
        };
        const vitalModalError = modalVital ? validateVitalModal() : null;

        // Same NaN-into-Firebase hazard as the vitals modal — the NIBP reading is synced too.
        const nibpError = (() => {
            if (!showNIBPModal) return null;
            const e1 = window.validateBuilderField ? window.validateBuilderField('bpSys', nibpSys) : null;
            if (e1) return e1;
            const e2 = window.validateBuilderField ? window.validateBuilderField('bpDia', nibpDia) : null;
            if (e2) return e2;
            if (parseFloat(nibpSys) <= parseFloat(nibpDia)) return 'Systolic must be greater than diastolic.';
            return null;
        })();

        const confirmVitalUpdate = () => {
            if (vitalModalError) return;
            const targets = {};
            if (modalVital === 'bp') { targets.bpSys = parseFloat(modalTarget); targets.bpDia = parseFloat(modalTarget2); }
            else if (modalVital === 'pupils') { targets.pupils = modalTarget; }
            else { targets[modalVital] = parseFloat(modalTarget); }
            if (trendDuration === 0) Object.keys(targets).forEach(k => manualUpdateVital(k, targets[k]));
            else startTrend(targets, trendDuration);
            setModalVital(null);
        };

        // C4: paediatric arrests are weight-based (4 J/kg). The energy ladder and the recommended
        // dose both come from the registry, so the controller, the monitor-hosted defib and the
        // standalone defib page cannot disagree about what 3.5 kg or 10 kg needs.
        const energySteps = sim.defibEnergySteps ? sim.defibEnergySteps() : RG.ADULT_ENERGY_STEPS;
        const recommendedEnergy = sim.recommendedShockEnergy ? sim.recommendedShockEnergy() : RG.ADULT_DEFAULT_ENERGY;
        const shockEnergy = Number.isFinite(Number(defib.energy)) && Number(defib.energy) > 0
            ? Math.round(Number(defib.energy)) : recommendedEnergy;

        const getTrend = (key) => trends.active && trends.targets[key] !== undefined ? { active: true, progress: trends.elapsed / trends.duration, target: trends.targets[key] } : null;
        const addTimerAlert = () => {
            const mins = Number(newAlertMins);
            if (!newAlertMsg.trim()) { setTimerAlertError('Enter an alert message.'); return; }
            if (!Number.isFinite(mins) || mins < 0.5 || mins > 180) { setTimerAlertError('Alert time must be between 0.5 and 180 minutes.'); return; }
            setTimerAlerts(prev => [...prev, { id: Date.now(), mins, msg: newAlertMsg.trim() }]);
            setNewAlertMsg(''); setNewAlertMins('5'); setTimerAlertError('');
        };

        // Flagged entries are the debrief's teaching artefacts: sequence deviations recorded by the
        // permissive gating, plus shocks and anything the facilitator flagged by hand.
        const flaggedEntries = state.log.filter(l => l.flagged);
        const deviationEntries = flaggedEntries.filter(l => l.deviation);

        // D3: the flow is now CHOOSE / CUSTOMISE, then SEND. Opening the chooser sends nothing, and
        // dismissing it sends nothing and does not wipe a result already on the student monitor.
        // "Clear result on monitor" is a separate, explicitly-labelled destructive action.
        const handleInvClick = (type) => { setInvModal(type); setInvCustomText(""); };
        const sendInv = (type, text) => { revealInvestigation(type, text); setInvModal(null); };
        // Passing null makes the engine/monitor resolve the scenario's OWN authored finding.
        // The previous "Scenario Default" button sent the literal placeholder string
        // "Abnormal (See scenario)" to the students' screen.
        const sendScenarioDefault = (type) => { revealInvestigation(type, null); setInvModal(null); };
        const dismissInv = () => setInvModal(null);
        const clearInvOnMonitor = () => { clearInvestigation(); setInvModal(null); };

        return (
            <div className={`h-full overflow-hidden flex flex-col p-2 bg-slate-900 relative ${flash === 'red' ? 'flash-red' : (flash === 'green' ? 'flash-green' : '')}`}>
                <div className={`absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-slate-800 border-l-4 rounded shadow-2xl px-6 py-3 transition-all duration-300 ${showToast ? 'translate-y-0 opacity-100' : '-translate-y-10 opacity-0 pointer-events-none'} ${notification?.type === 'danger' ? 'border-red-500' : notification?.type === 'success' ? 'border-emerald-500' : notification?.type === 'warning' ? 'border-amber-500' : 'border-sky-500'}`}>
                    <div className="flex items-center gap-3">
                        <Lucide icon={notification?.type === 'danger' || notification?.type === 'warning' ? 'alert-triangle' : notification?.type === 'success' ? 'check-circle' : 'info'} className={`w-5 h-5 ${notification?.type === 'danger' ? 'text-red-500' : notification?.type === 'warning' ? 'text-amber-500' : notification?.type === 'success' ? 'text-emerald-500' : 'text-sky-500'}`} />
                        <span className="font-bold text-white">{notification?.msg}</span>
                    </div>
                </div>

                {/* B3 RHYTHM CONVERSION TOAST — ASSESSOR ONLY.
                    Driven by state.rhythmEvent, which is deliberately NOT part of the Firebase sync
                    payload (unlike `notification`, which IS synced and IS rendered on the student
                    monitor). Nothing about a conversion can therefore reach the team's screen. */}
                {rhythmEvent && (
                    <div role="status" className={`absolute top-32 left-1/2 -translate-x-1/2 z-50 rounded shadow-2xl px-6 py-3 border-l-4 animate-fadeIn ${rhythmEvent.converted ? 'bg-slate-800 border-amber-400' : 'bg-slate-800/90 border-slate-500'}`}>
                        <div className="flex items-center gap-3">
                            <Lucide icon="activity" className={`w-5 h-5 ${rhythmEvent.converted ? 'text-amber-400' : 'text-slate-400'}`} />
                            <div>
                                <div className="text-[9px] uppercase tracking-widest text-slate-400 font-bold">{rhythmEvent.converted ? 'Rhythm converted' : 'Rhythm unchanged'}</div>
                                <div className="font-bold text-white text-sm">
                                    {RG.labelFor(rhythmEvent.from)} <span className="text-slate-500">&rarr;</span> {RG.labelFor(rhythmEvent.to)}
                                </div>
                                <div className="text-[10px] text-amber-300/80">{rhythmEvent.detail || rhythmEvent.cause}</div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Wraps instead of overflowing: at ~375px this was one non-scrolling row and Back/Finish/
                    START plus every tool button sat off-screen, i.e. unreachable on a phone. */}
                <div className="flex flex-wrap justify-between items-center gap-y-2 bg-slate-800 p-2 rounded mb-2 border border-slate-700">
                    <div className="flex flex-wrap gap-2 items-center relative z-20">
                        <Button variant="secondary" onClick={onBack} className="h-8 px-2"><Lucide icon="arrow-left"/> Back</Button>
                        <Button variant="danger" onClick={onFinish} className="h-8 px-2 font-bold"><Lucide icon="square"/> Finish</Button>
                        {!isRunning ? ( <Button variant="success" onClick={start} className="h-8 px-4 font-bold"><Lucide icon="play"/> START</Button> ) : ( <Button variant="warning" onClick={pause} className="h-8 px-4"><Lucide icon="pause"/> PAUSE</Button> )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <div role={syncProblem ? 'alert' : 'status'} title={syncStatus.message || (syncStatus.state === 'connected' ? 'Live monitor sync is active.' : 'Connecting to Firebase Realtime Database.')} className={`h-8 px-2 flex items-center gap-1 rounded border text-[10px] uppercase font-bold ${syncProblem ? 'border-red-500 bg-red-950/60 text-red-300' : syncStatus.state === 'connected' ? 'border-emerald-700 bg-emerald-950/40 text-emerald-300' : 'border-amber-600 bg-amber-950/40 text-amber-300'}`}>
                            <Lucide icon={syncProblem ? 'wifi-off' : 'wifi'} className="w-3 h-3" />
                            {syncProblem ? 'Sync error' : syncStatus.state === 'connected' ? 'Monitor live' : 'Syncing'}
                        </div>
                        {/* A5 PRESENCE BADGE. Deliberately the same markup, sizing and colour logic as
                            the sync badge above, but it answers a different question: is a remote
                            monitor actually THERE, and what is it showing? Driven by Firebase
                            onDisconnect() presence plus a 10s heartbeat (engine.js). */}
                        {(() => {
                            const n = remoteClients.length;
                            const shows = Array.from(new Set(remoteClients.map(c => c.display || 'patient monitor')));
                            const label = n === 0 ? 'No remote' : (n === 1 ? shows[0] : `${n} remotes`);
                            const tip = n === 0
                                ? 'No student monitor is connected to this session. Open Launch Monitor on the room screen or tablet.'
                                : remoteClients.map(c => `${c.display || 'patient monitor'} (last seen ${Math.max(0, Math.round((Date.now() - Number(c.ts)) / 1000))}s ago)`).join('\n');
                            return (
                                <div role="status" title={tip} className={`h-8 px-2 flex items-center gap-1 rounded border text-[10px] uppercase font-bold ${n === 0 ? 'border-slate-600 bg-slate-900 text-slate-400' : shows.includes('defib') ? 'border-amber-500 bg-amber-950/40 text-amber-300' : 'border-sky-700 bg-sky-950/40 text-sky-300'}`}>
                                    <Lucide icon={n === 0 ? 'monitor-off' : (shows.includes('defib') ? 'zap' : 'monitor')} className="w-3 h-3" />
                                    {label}
                                </div>
                            );
                        })()}
                        <Button variant="secondary" onClick={cycleAudioOutput} className="h-8 px-2 text-[10px] uppercase font-bold w-32 justify-between">
                            <Lucide icon="monitor" className="w-4 h-4"/> {audioOutput === 'both' ? 'Audio: Both' : (audioOutput === 'controller' ? 'Audio: Ctrl' : 'Audio: Mon')}
                        </Button>
                        <Button ariaLabel={isMuted ? "Unmute alarms" : "Mute alarms"} variant={isMuted ? "danger" : "secondary"} onClick={() => sim.dispatch({type: 'SET_MUTED', payload: !isMuted})} className="h-8 px-2">
                            <Lucide icon={isMuted ? "volume-x" : "volume-2"} className="w-4 h-4"/>
                        </Button>
                        <Button ariaLabel="Open simulation log" variant="secondary" onClick={() => setShowLogModal(true)} className="h-8 px-2 relative">
                            <Lucide icon="list" className="w-4 h-4"/>
                            {state.log.some(l => l.flagged) && <span className="absolute top-0 right-0 w-2 h-2 bg-amber-500 rounded-full"></span>}
                        </Button>
                        {/* Safety flags: a running count of flagged deviations (actions performed out of
                            sequence, shocks, manual flags). Teaching artefact, facilitator-only.
                            A2: suppressed in Quick Sim — there are no interventions to flag. */}
                        {!quickSim && flaggedEntries.length > 0 && (
                            <Button ariaLabel={`Review ${flaggedEntries.length} safety flags`} variant="outline" onClick={() => setShowFlagsModal(true)} className="h-8 px-2 text-amber-400 border-amber-500/60 bg-amber-950/30 text-[10px] uppercase font-bold">
                                <Lucide icon="flag" className="w-3 h-3 mr-1"/> Safety flags ({flaggedEntries.length})
                            </Button>
                        )}
                        <div className="w-px h-6 bg-slate-600 mx-1"></div>
                        <Button variant="outline" href={`?mode=monitor&session=${sessionID}`} className="h-8 px-3 text-sky-400 border-sky-500/50 hover:bg-sky-900/30"><Lucide icon="monitor" className="w-4 h-4 mr-1"/> Launch Monitor</Button>
                        {!quickSim && <Button variant="outline" href="defib/index.html" className="h-8 px-3 text-amber-400 border-amber-500/50 hover:bg-amber-900/30"><Lucide icon="zap" className="w-4 h-4 mr-1"/> Defib Sim</Button>}
                        <Button variant="outline" onClick={() => setShowDrugCalc(true)} className="h-8 px-3 text-violet-400 border-violet-500/50 hover:bg-violet-900/30"><Lucide icon="pill" className="w-4 h-4 mr-1"/> Drug Calc</Button>
                        <Button variant="outline" onClick={() => setShowTimerModal(true)} className="h-8 px-3 text-orange-400 border-orange-500/50 hover:bg-orange-900/30"><Lucide icon="bell" className="w-4 h-4 mr-1"/> Alerts</Button>
                        <Button ariaLabel="Open keyboard shortcuts" variant="outline" onClick={() => setShowKeyHelp(true)} className="h-8 px-2 text-slate-400 border-slate-600 font-bold">?</Button>
                        <div className="font-mono text-2xl font-bold text-white ml-2">{formatTime(time)}</div>
                    </div>
                </div>

                <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-2 overflow-hidden min-h-0">
                    <div className="md:col-span-5 lg:col-span-4 flex flex-col gap-2 overflow-y-auto h-full pr-1">
                         {/* A2: the scenario brief card is replaced in Quick Sim by a one-line factual
                             patient strip. No brief, no diagnosis, no human-factors challenge — none
                             of those exist without a scenario. */}
                         {quickSim ? (
                         <div className="flex-none bg-slate-800 p-2 rounded border-l-4 border-sky-500 shadow-md flex items-center justify-between gap-2">
                            <div className="min-w-0">
                                <div className="text-[9px] font-bold text-sky-400 uppercase tracking-widest flex items-center gap-1"><Lucide icon="sliders" className="w-3 h-3"/> Quick Sim — no scenario</div>
                                <div className="text-sm text-white font-bold truncate">{scenario.patientName} ({scenario.patientAge}y {scenario.sex}{scenario.wetflag?.weight ? `, ${scenario.wetflag.weight} kg` : ''})</div>
                            </div>
                            {isPaeds && <span className="flex-none text-[9px] px-1.5 py-0.5 rounded bg-purple-950/60 border border-purple-600 text-purple-300 uppercase font-bold tracking-wider">paeds · wetflag</span>}
                         </div>
                         ) : (
                         <div className="flex-none bg-slate-800 p-3 rounded border-l-4 border-sky-500 shadow-md">
                            <h3 className="text-xs font-bold text-sky-400 uppercase mb-1 flex items-center gap-2"><Lucide icon="user" className="w-3 h-3"/> Patient Details</h3>
                            <div className="text-sm text-white font-bold">{scenario.patientName} ({scenario.patientAge}y {scenario.sex})</div>
                            {scenario.title && <div className="text-xs text-emerald-400 font-bold uppercase mt-0.5">{scenario.title}</div>}
                            {scenario.deterioration && scenario.deterioration.type && <div className="text-[10px] text-slate-400 uppercase tracking-widest mt-0.5">Dx: {scenario.deterioration.type}</div>}
                            <div className="text-xs text-slate-300 mt-1 line-clamp-2">{formatProfileTemplate(scenario.patientProfileTemplate || scenario.profile, scenario.patientAge, scenario.sex)}</div>
                            <HumanFactorBadge hf={scenario.hf} className="mt-2" />
                         </div>
                         )}

                        <div className="flex-none bg-black border border-slate-800 rounded relative overflow-hidden">
                             <div className="relative">
                                 <ECGMonitor rhythmType={state.rhythm} hr={vitals.hr} rr={vitals.rr} spO2={vitals.spO2} isPaused={!isRunning} showTraces={isMonitoringApplied} showEtco2={showEtco2} showArt={showArt} co2Pathology={etco2Shape} className="h-64"/>
                                 {!isMonitoringApplied && (
                                     <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-slate-500 text-xs font-mono uppercase tracking-widest z-10 pointer-events-none">No Monitoring</div>
                                 )}
                                 <button onClick={()=>setShowRhythmModal(true)} className="absolute top-1 right-1 bg-slate-800/80 hover:bg-slate-700 border border-slate-600 px-2 py-1 text-[10px] text-white rounded z-30 font-bold uppercase tracking-wider backdrop-blur-sm">Change Rhythm</button>
                                 <div className="absolute top-1 left-1 flex gap-1 z-30">
                                     <button onClick={() => sim.dispatch({type: 'TOGGLE_MONITOR_TIMER'})} className={`bg-slate-800/80 hover:bg-slate-700 border ${state.monitorTimer?.visible ? 'border-sky-500 text-sky-400' : 'border-slate-600 text-white'} px-2 py-1 text-[10px] rounded font-bold uppercase tracking-wider backdrop-blur-sm`}>
                                         <Lucide icon="clock" className="w-3 h-3 inline mr-1"/>{state.monitorTimer?.visible ? 'Hide Timer' : 'Show Timer'}
                                     </button>
                                     {state.monitorTimer?.visible && (
                                         <>
                                             <button onClick={() => sim.dispatch({type: state.monitorTimer?.active ? 'PAUSE_MONITOR_TIMER' : 'START_MONITOR_TIMER'})} className="bg-slate-800/80 border border-slate-600 px-2 py-1 text-[10px] rounded text-white font-bold uppercase hover:bg-slate-700 backdrop-blur-sm">
                                                 {state.monitorTimer?.active ? 'Pause' : 'Start'}
                                             </button>
                                             <button onClick={() => sim.dispatch({type: 'RESET_MONITOR_TIMER'})} className="bg-slate-800/80 border border-slate-600 px-2 py-1 text-[10px] rounded text-white font-bold uppercase hover:bg-slate-700 backdrop-blur-sm">
                                                 Reset
                                             </button>
                                         </>
                                     )}
                                 </div>
                             </div>

                             <div className="grid grid-cols-2 gap-1 p-1 bg-black">
                                 <VitalDisplay label="HR" value={vitals.hr} onClick={()=>openVitalControl('hr')} visible={true} trend={getTrend('hr')} />
                                 <VitalDisplay label="BP" value={vitals.bpSys} value2={vitals.bpDia} onClick={()=>setShowNIBPModal(true)} visible={true} trend={getTrend('bpSys')} />
                                 <VitalDisplay label="SpO2" value={vitals.spO2} onClick={()=>openVitalControl('spO2')} visible={true} trend={getTrend('spO2')} />
                                 <VitalDisplay label="RR" value={vitals.rr} onClick={()=>openVitalControl('rr')} visible={true} trend={getTrend('rr')} />
                                 <VitalDisplay label="Temp" value={vitals.temp} unit="°C" onClick={()=>openVitalControl('temp')} visible={true} trend={getTrend('temp')} />
                                 <VitalDisplay label="Glucose" value={vitals.bm} unit="mmol" onClick={()=>openVitalControl('bm')} visible={true} trend={getTrend('bm')} />
                                 <VitalDisplay label="ETCO2" value={vitals.etco2} unit="kPa" onClick={()=>openVitalControl('etco2')} visible={true} trend={getTrend('etco2')} />
                                 <VitalDisplay label="GCS" value={vitals.gcs} onClick={()=>openVitalControl('gcs')} visible={true} trend={getTrend('gcs')} />
                                 {/* pH is a modelled vital now (SodiumBicarb finally does something). */}
                                 <VitalDisplay label="pH" value={vitals.ph} onClick={()=>openVitalControl('ph')} visible={true} trend={getTrend('ph')} />
                                 {/* WAVE 4a / E8: serum K+. Hyperkalaemia and DKA finally have a
                                     measurable endpoint the facilitator can steer and the team can read. */}
                                 <VitalDisplay label="K+" value={vitals.k} unit="mmol" onClick={()=>openVitalControl('k')} visible={true} trend={getTrend('k')} />
                             </div>
                        </div>

                        {/* ---- WAVE 4a: ACTIVE DRUGS / PHARMACOKINETICS.
                             The pk envelope has existed since Wave 2 but was completely invisible, so a
                             facilitator could not tell whether a drug was still in its onset phase, at
                             peak, or already worn off - which is exactly the information needed to decide
                             whether a repeat dose is due (IM adrenaline at 5 min) or futile. The ROUTE is
                             printed per entry so IM/IV/buccal are distinguishable at a glance. ---- */}
                        {!quickSim && (state.activeDrugs || []).length > 0 && (
                            <div className="flex-none rounded border border-slate-700 bg-slate-900/70 p-2">
                                <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-1">Active drugs / pharmacokinetics</div>
                                <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                                    {(state.activeDrugs || []).map((d, i) => {
                                        const phase = PKI.pkPhase ? PKI.pkPhase(d, time) : '';
                                        const remaining = PKI.pkRemaining ? PKI.pkRemaining(d, time) : null;
                                        const f = PKI.pkFactor ? PKI.pkFactor(d, time) : 0;
                                        if (!(f > 0) && phase === 'gone') return null;
                                        const colour = phase === 'onset' ? 'text-slate-400' : (phase === 'rising' ? 'text-amber-300' : (phase === 'wearing off' ? 'text-orange-300' : 'text-emerald-300'));
                                        return (
                                            <div key={`${d.key}-${d.startTime}-${i}`} className="flex items-center justify-between gap-2 text-[11px] border-b border-slate-800 last:border-0 pb-0.5">
                                                <span className="text-slate-200 truncate">{d.label || d.key}{d.route ? <span className="text-slate-500"> &middot; {d.route}</span> : null}</span>
                                                <span className={`font-mono font-bold uppercase shrink-0 ${colour}`}>{phase}{(remaining !== null && remaining !== undefined) ? ` ${Math.round(remaining / 60)}m` : ''} {Math.round(Math.min(1, f) * 100)}%</span>
                                                {/* E13: TITRATION. A running infusion can be turned up or down
                                                    while it runs - the defining skill of vasoactive infusions. */}
                                                {d.sustained && d.stopTime < 0 && (
                                                    <span className="flex items-center gap-1 shrink-0">
                                                        <button title="Turn the infusion DOWN" onClick={() => sim.dispatch({ type: 'SET_DRUG_DOSE', payload: { key: d.key, dose: (Number(d.dose) || 1) - 0.25 } })} className="w-5 h-5 rounded bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-200 leading-none font-bold">-</button>
                                                        <span className="font-mono text-sky-300 w-10 text-center">x{(Number(d.dose) || 1).toFixed(2)}</span>
                                                        <button title="Turn the infusion UP" onClick={() => sim.dispatch({ type: 'SET_DRUG_DOSE', payload: { key: d.key, dose: (Number(d.dose) || 1) + 0.25 } })} className="w-5 h-5 rounded bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-200 leading-none font-bold">+</button>
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* ---- GROUP C2: AUTO / MANUAL deterioration toggle. Sits directly under the obs
                             panel so it is impossible to miss during a running sim, and the current mode
                             is spelled out rather than implied by a colour. ---- */}
                        <div title="Switching either way leaves the obs exactly where they are — there is no jump in either direction." className={`flex-none rounded border-l-4 p-2 ${deteriorationMode === 'auto' ? 'bg-amber-950/30 border-amber-500' : 'bg-slate-800 border-slate-500'}`}>
                            <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">Patient deterioration</div>
                                    <div className={`text-sm font-bold ${deteriorationMode === 'auto' ? 'text-amber-300' : 'text-slate-200'}`}>
                                        {deteriorationMode === 'auto' ? 'AUTO — deteriorating on its own' : 'MANUAL — obs only change when you change them'}
                                    </div>
                                    <div className="text-[10px] text-slate-400 mt-0.5">
                                        {/* A6: Quick Sim has no scenario and therefore no declared
                                            deterioration rate, so it starts in MANUAL and the toggle
                                            says so plainly rather than implying AUTO will do something.
                                            Use the vitals tiles' trend control to drive a decline. */}
                                        {detInfo.declared
                                            ? `Scenario: ${detInfo.type} at rate ${detInfo.rate}. Treating the cause slows, then reverses it.`
                                            : quickSim
                                                ? 'Quick Sim has no declared deterioration rate, so AUTO would change nothing on its own. Ramp the obs with the trend control on any tile instead.'
                                                : 'This scenario declares no deterioration rate — AUTO would change nothing.'}
                                    </div>
                                </div>
                                <Button
                                    ariaLabel={deteriorationMode === 'auto' ? 'Switch deterioration to MANUAL' : 'Switch deterioration to AUTO'}
                                    variant={deteriorationMode === 'auto' ? 'warning' : 'secondary'}
                                    onClick={() => sim.toggleDeteriorationMode && sim.toggleDeteriorationMode()}
                                    className="h-9 px-3 flex-none font-bold text-[11px] uppercase">
                                    {/* Only icons present in the Lucide shim render; 'pause'/'play' read
                                        correctly here anyway (stop vs resume the autonomous decline). */}
                                    <Lucide icon={deteriorationMode === 'auto' ? 'pause' : 'play'} className="w-4 h-4 mr-1"/>
                                    {deteriorationMode === 'auto' ? 'Go MANUAL' : 'Go AUTO'}
                                </Button>
                            </div>
                        </div>

                        {/* ---- A5: live drug timing. The facilitator needs to know WHY the obs are still
                             moving, which is exactly what the pk envelope makes invisible otherwise. ---- */}
                        {!quickSim && activeDrugRows.length > 0 && (
                            <div className="flex-none bg-slate-800 rounded border-l-4 border-violet-500 p-2">
                                <h3 className="text-[10px] font-bold text-violet-300 uppercase tracking-widest mb-1 flex items-center gap-1">
                                    <Lucide icon="pill" className="w-3 h-3"/> Active drugs ({activeDrugRows.length})
                                </h3>
                                <div className="flex flex-col gap-1">
                                    {activeDrugRows.map(d => {
                                        const style = PHASE_STYLE[d.phase] || { cls: 'text-slate-300 border-slate-600 bg-slate-900', label: String(d.phase).toUpperCase() };
                                        return (
                                            <div key={d.key} className="flex items-center gap-2 text-[11px]">
                                                <span className="text-white font-bold truncate flex-1 min-w-0">{d.label}{d.doses > 1 ? ` x${d.doses}` : ''}</span>
                                                <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wider flex-none ${style.cls}`}>{style.label}</span>
                                                <span className="font-mono text-slate-400 w-10 text-right flex-none">{d.intensity}%</span>
                                                <span className="font-mono text-slate-400 w-16 text-right flex-none" title={d.sustained && !d.stopped ? 'Runs until you stop it' : 'Time until the effect is gone'}>{d.sustained && !d.stopped ? 'running' : fmtRemaining(d.remaining)}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="text-[9px] text-slate-500 mt-1">Effects are added on top of the underlying physiology and wear off on their own.</div>
                            </div>
                        )}
                        
                        <div className="flex-none grid grid-cols-2 gap-2">
                            <div className="relative">
                                <Button variant="danger" onClick={()=>setShowArrestMenu(!showArrestMenu)} className="w-full font-bold animate-pulse"><Lucide icon="activity" className="w-4 h-4"/> ARREST</Button>
                                {showArrestMenu && (
                                    <div className="absolute bottom-12 left-0 bg-slate-800 border border-slate-600 rounded shadow-xl w-full flex flex-col p-1 z-50">
                                        {ARREST_RHYTHMS.map(r => (
                                            <button key={r} onClick={() => { triggerArrest(r); setShowArrestMenu(false); }} className="text-left px-3 py-2 text-sm text-red-300 hover:bg-slate-700 hover:text-white rounded">{RG.labelFor(r)}</button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="relative">
                                <Button variant="success" onClick={()=>setShowROSCMenu(!showROSCMenu)} className="w-full font-bold"><Lucide icon="heart" className="w-4 h-4"/> ROSC</Button>
                                {showROSCMenu && (
                                    <div className="absolute bottom-12 right-0 bg-slate-800 border border-slate-600 rounded shadow-xl w-full flex flex-col p-1 z-50">
                                        {ROSC_RHYTHMS.map(r => (
                                            <button key={r} onClick={() => { triggerROSC(r); setShowROSCMenu(false); }} className="text-left px-3 py-2 text-sm text-emerald-300 hover:bg-slate-700 hover:text-white rounded">{RG.labelFor(r)}</button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        
                        {/* A4 NAMING COLLISION FIX. This button has ALWAYS toggled arrestPanelOpen —
                            the dual-trace LEAD II / PADS arrest layout on the student monitor — and
                            has never opened a defibrillator. It is now called what it is. The button
                            below it is the actual defibrillator (A1-A3). */}
                        <div className="flex-none grid grid-cols-2 gap-2">
                            <Button variant="outline" onClick={() => sim.dispatch({type: 'SET_ARREST_PANEL', payload: !arrestPanelOpen})} className={`w-full ${arrestPanelOpen ? 'bg-red-900/30 border-red-500 text-red-400' : ''}`}
                                title="Dual-trace LEAD II / PADS arrest layout on the student monitor. Does not open the defibrillator.">
                                 <Lucide icon="activity" className="w-4 h-4"/> {arrestPanelOpen ? "Close Arrest View" : "Arrest View"}
                            </Button>
                            <Button variant="outline" onClick={() => sim.dispatch({type: 'SET_DEFIB_PANEL', payload: !defibPanelOpen})} className={`w-full ${defibPanelOpen ? 'bg-amber-900/30 border-amber-500 text-amber-300' : 'text-amber-400 border-amber-500/50'}`}
                                title="Opens a working defibrillator ON the student monitor, with the obs still visible alongside it.">
                                 <Lucide icon="zap" className="w-4 h-4"/> {defibPanelOpen ? "Close Defib" : "Defib"}
                            </Button>
                        </div>
                        <Button variant="outline" onClick={triggerNIBP} className="w-full flex-none text-sky-400 border-sky-500/50 hover:bg-sky-900/30">
                             <Lucide icon="activity" className="w-4 h-4"/> Cycle NIBP Now
                        </Button>

                        {isPaeds && (
                            <Button variant="outline" onClick={() => sim.dispatch({type: 'SET_WETFLAG_VISIBILITY', payload: !showWetflag})} className={`w-full flex-none mt-1 ${!showWetflag ? 'text-slate-500 border-slate-600' : 'text-purple-400 border-purple-500/50 bg-purple-900/20'}`}>
                                <Lucide icon="baby" className="w-4 h-4 mr-1"/> {showWetflag ? 'Hide WETFLAG on Monitor' : 'Show WETFLAG on Monitor'}
                            </Button>
                        )}

                        {/* ================= B3 / B5: PERSISTENT RHYTHM + DEFIB STRIP =================
                            Always visible while the sim runs, styled to match the CPR-timer row it
                            sits above. The facilitator can read the current rhythm, the last
                            conversion and the running shock tally without opening anything.
                            ASSESSOR-LOCAL: lastConversion is never synced. */}
                        <div className="flex-none rounded border-l-4 border-amber-500 bg-slate-800 p-2">
                            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                                <div className="min-w-0">
                                    <div className="text-[9px] uppercase tracking-widest text-slate-400 font-bold">Current rhythm</div>
                                    <div className={`font-bold text-sm ${RG.isPulseless(state.rhythm) ? 'text-red-300' : 'text-white'}`}>
                                        {RG.labelFor(state.rhythm)}
                                        {RG.isShockable(state.rhythm) && <span className="ml-2 px-1.5 py-0.5 rounded bg-red-900/60 border border-red-500 text-red-200 text-[9px] uppercase font-bold tracking-wider">shockable</span>}
                                        {RG.isSyncCardiovertible(state.rhythm) && <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-900/50 border border-amber-500 text-amber-200 text-[9px] uppercase font-bold tracking-wider">sync cardiovert</span>}
                                        {RG.isPulseless(state.rhythm) && <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-500 text-slate-300 text-[9px] uppercase font-bold tracking-wider">pulseless</span>}
                                    </div>
                                </div>
                                <div className="min-w-0 text-right">
                                    <div className="text-[9px] uppercase tracking-widest text-slate-400 font-bold">Last conversion</div>
                                    <div className="text-xs font-bold text-amber-300 truncate">
                                        {lastConversion
                                            ? `${RG.labelFor(lastConversion.from)} \u2192 ${RG.labelFor(lastConversion.to)}`
                                            : <span className="text-slate-500">none yet</span>}
                                    </div>
                                    {lastConversion && <div className="text-[10px] text-slate-400 truncate">{lastConversion.detail || lastConversion.cause}</div>}
                                </div>
                            </div>
                            <div className="mt-1 grid grid-cols-4 gap-1 text-center bg-black/40 rounded p-1">
                                <div><div className="text-[9px] uppercase text-slate-500 font-bold">Shocks</div><div className="font-mono font-bold text-white">{defib.shockCount || 0}</div></div>
                                <div><div className="text-[9px] uppercase text-slate-500 font-bold">Total J</div><div className="font-mono font-bold text-white">{defib.totalEnergy || 0}</div></div>
                                <div><div className="text-[9px] uppercase text-slate-500 font-bold">Last J</div><div className="font-mono font-bold text-white">{defib.lastEnergy ?? '\u2014'}</div></div>
                                <div><div className="text-[9px] uppercase text-slate-500 font-bold">CPR</div><div className={`font-mono font-bold ${cprInProgress ? 'text-red-400 animate-pulse' : 'text-slate-500'}`}>{cprInProgress ? 'ON' : 'off'}</div></div>
                            </div>
                        </div>

                        {(arrestPanelOpen || defibPanelOpen) && (
                             <div className="flex-none bg-red-900/20 border-2 border-red-500 p-2 rounded-lg animate-fadeIn shadow-2xl shadow-red-900/50">
                                 <div className="flex justify-between items-center mb-2">
                                     <h3 className="text-red-400 font-bold uppercase text-xs flex items-center gap-1"><Lucide icon="zap" className="w-3 h-3"/> Defibrillator {defibPanelOpen ? '(on monitor)' : '(arrest view)'}</h3>
                                     <button aria-label="Close defibrillator panel" onClick={() => { sim.dispatch({type: 'SET_ARREST_PANEL', payload: false}); sim.dispatch({type: 'SET_DEFIB_PANEL', payload: false}); }} className="text-red-400 hover:text-white"><Lucide icon="x" className="w-4 h-4"/></button>
                                 </div>

                                 {/* C4: weight-based energy ladder. 4 J/kg is highlighted as recommended;
                                     anything else is permitted and flagged, never blocked. */}
                                 <div className="mb-2">
                                     <div className="flex items-center justify-between mb-1">
                                        <span className="text-slate-400 text-[10px] uppercase font-bold">Energy</span>
                                        <span className="text-[10px] text-slate-400">Recommended <b className="text-emerald-400">{recommendedEnergy}J</b>{scenario.wetflag?.weight ? ` (4 J/kg, ${scenario.wetflag.weight}kg)` : ''}</span>
                                     </div>
                                     <div className="flex flex-wrap gap-1">
                                        {energySteps.map(j => (
                                            <button key={j} onClick={() => sim.setDefibEnergy(j)} className={`px-2 py-1 rounded border text-[11px] font-mono font-bold ${shockEnergy === j ? 'bg-amber-600 border-amber-400 text-white' : (j === recommendedEnergy ? 'bg-emerald-950/50 border-emerald-600 text-emerald-300' : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700')}`}>{j}J</button>
                                        ))}
                                     </div>
                                 </div>

                                 <div className="grid grid-cols-2 gap-2">
                                     <Button onClick={() => { initCharge(shockEnergy); sim.playSound('charge'); }} variant="warning" className="h-10 text-xs">{defib.charged ? `CHARGED ${defib.chargeEnergy}J` : `Charge ${shockEnergy}J`}</Button>
                                     <Button onClick={() => { deliverShock(shockEnergy, 'facilitator'); sim.playSound('shock'); }} variant="danger" className="h-10 text-xs font-bold">{defib.syncMode ? 'SYNC SHOCK' : 'SHOCK'} {shockEnergy}J</Button>
                                 </div>

                                 <div className="grid grid-cols-3 gap-2 mt-2">
                                     <Button onClick={() => sim.toggleDefibSync()} variant="outline" className={`h-9 text-[10px] uppercase font-bold ${defib.syncMode ? 'bg-amber-900/40 border-amber-500 text-amber-300' : ''}`}>
                                        SYNC {defib.syncMode ? 'ON' : 'OFF'}
                                     </Button>
                                     <Button onClick={() => sim.toggleCPR()} variant="outline" className={`h-9 text-[10px] uppercase font-bold ${cprInProgress ? 'bg-red-900/40 border-red-500 text-red-300' : ''}`}>
                                        CPR {cprInProgress ? 'stop' : 'start'}
                                     </Button>
                                     <Button onClick={() => nextCycle && nextCycle()} variant="outline" className="h-9 text-[10px] uppercase font-bold">Rhythm check +2m</Button>
                                 </div>

                                 {/* C7 FACILITATOR OVERRIDE. This drives the previously unreachable
                                     queuedRhythm / SET_QUEUED_RHYTHM code: the next shock converts to
                                     exactly what the facilitator chose, instead of rolling the model. */}
                                 <div className="mt-2 bg-black/50 p-2 rounded">
                                     <div className="flex items-center justify-between mb-1">
                                        <span className="text-slate-400 text-[10px] uppercase font-bold">Next shock converts to</span>
                                        {state.queuedRhythm && <button onClick={() => sim.setQueuedRhythm(null)} className="text-[10px] text-sky-400 hover:text-sky-200 underline">clear</button>}
                                     </div>
                                     <div className="flex flex-wrap gap-1">
                                        {RG.SELECTABLE.filter(r => RG.isRoscEligible(r) || RG.inArrest(r)).map(r => (
                                            <button key={r} onClick={() => sim.setQueuedRhythm(r)} className={`px-2 py-1 rounded border text-[10px] font-bold ${state.queuedRhythm === r ? 'bg-sky-600 border-sky-400 text-white' : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'}`}>{RG.shortFor(r)}</button>
                                        ))}
                                     </div>
                                     <div className="text-[9px] text-slate-500 mt-1">Leave unset to let the outcome model decide (energy, rhythm, CPR and drugs all count).</div>
                                 </div>

                                 <div className="mt-2 flex items-center justify-between bg-black/50 p-2 rounded">
                                     <span className="text-slate-400 text-[10px] uppercase">CPR / cycle timer</span>
                                     <span className={`font-mono text-xl font-bold ${cprInProgress ? 'text-red-300' : 'text-white'}`}>{formatTime(state.cycleTimer)}</span>
                                 </div>
                             </div>
                        )}
                    </div>
                    
                    {/* =================== WAVE 4b / A2: THE QUICK SIM RIGHT-HAND PANE ===================
                        Replaces the intervention library entirely. Everything here is scenario-free:
                        the full rhythm registry (including every arrest rhythm), the two relative trend
                        buttons, the custom/flagged log entry row, and the live event log. There is no
                        search, no tabs, no drug groups, no investigations, no voice and no assessment
                        checklist, because none of those mean anything without a scenario. */}
                    {quickSim ? (
                    <div className="md:col-span-7 lg:col-span-8 flex flex-col bg-slate-800 rounded border border-slate-700 overflow-hidden relative">
                        <div className="bg-slate-900 p-3 border-b border-slate-700 flex flex-wrap gap-2 items-center">
                            <div className="flex-1 min-w-[12rem]">
                                <div className="text-[9px] uppercase tracking-widest text-slate-500 font-bold">Rhythm</div>
                                <div className="text-sm font-bold text-white">{RG.labelFor(state.rhythm)}</div>
                            </div>
                            <Button onClick={() => {sim.dispatch({type: 'TRIGGER_IMPROVE'}); addLogEntry("Patient Improving (Trend)", "success")}} className="h-11 w-24 shrink-0 text-xs px-2 bg-emerald-900 border border-emerald-500 text-emerald-100 flex-col gap-0 leading-tight"><span>Trend</span><span className="font-bold">Better</span></Button>
                            <Button onClick={() => {sim.dispatch({type: 'TRIGGER_DETERIORATE'}); addLogEntry("Patient Deteriorating (Trend)", "danger")}} className="h-11 w-24 shrink-0 text-xs px-2 bg-red-900 border border-red-500 text-red-100 flex-col gap-0 leading-tight"><span>Trend</span><span className="font-bold">Worse</span></Button>
                            {/* The ETCO2 tile is always present, but the capnography TRACE is only
                                meaningful once the facilitator says the patient is on capnography.
                                Same TOGGLE_ETCO2 action the 'ToggleETCO2' intervention dispatches. */}
                            <Button onClick={() => sim.dispatch({ type: 'TOGGLE_ETCO2' })} variant="outline"
                                className={`h-11 px-3 shrink-0 text-[10px] uppercase font-bold ${etco2Enabled ? 'bg-purple-950/40 border-purple-500 text-purple-300' : ''}`}>
                                ETCO2 {etco2Enabled ? 'on' : 'off'}
                            </Button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-3 space-y-3">
                            {/* FULL RHYTHM REGISTRY. RG.SELECTABLE is the single shared registry from
                                data/rhythms.js, so this list can never disagree with the monitor, the
                                defibrillator's shockability logic or the arrest model. Arrest rhythms
                                are marked so the facilitator can see what will zero the obs. */}
                            <div>
                                <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-2">Select rhythm ({RG.SELECTABLE.length})</div>
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                                    {RG.SELECTABLE.map(r => {
                                        const isCur = state.rhythm === r;
                                        const arrest = RG.inArrest(r);
                                        return (
                                            <button key={r} onClick={() => changeRhythm(r, 'manual selection')}
                                                title={`${RG.labelFor(r)}${RG.isShockable(r) ? ' — shockable' : ''}${RG.isPulseless(r) ? ' — pulseless' : ''}`}
                                                className={`p-2 rounded border text-left text-[11px] font-bold leading-tight min-h-[3rem] ${isCur ? 'bg-sky-600 border-sky-400 text-white' : arrest ? 'bg-red-950/40 border-red-800/70 text-red-200 hover:bg-red-900/40' : 'bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600'}`}>
                                                {RG.labelFor(r)}
                                                <div className="mt-0.5 flex gap-1 flex-wrap">
                                                    {RG.isShockable(r) && <span className="text-[8px] uppercase tracking-wider px-1 rounded bg-red-900/70 border border-red-600 text-red-200">shock</span>}
                                                    {RG.isSyncCardiovertible(r) && <span className="text-[8px] uppercase tracking-wider px-1 rounded bg-amber-900/60 border border-amber-600 text-amber-200">sync</span>}
                                                    {RG.isPulseless(r) && <span className="text-[8px] uppercase tracking-wider px-1 rounded bg-slate-900 border border-slate-500 text-slate-300">pulseless</span>}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* EVENT LOG, inline rather than behind the log modal: with nothing else
                                competing for this pane there is room to keep it permanently visible. */}
                            <div>
                                <div className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-2">Event log ({state.log.length})</div>
                                <div className="bg-slate-900 border border-slate-700 rounded p-2 font-mono text-[11px] space-y-1 max-h-72 overflow-y-auto">
                                    {state.log.length === 0 && <div className="text-slate-500 text-center py-4">Nothing logged yet. Press START, then change the obs or the rhythm.</div>}
                                    {state.log.slice().reverse().map((entry, i) => (
                                        <div key={i} className={`flex gap-3 border-b border-slate-800 last:border-0 pb-0.5 ${entry.flagged ? 'bg-amber-900/20 -mx-1 px-1 rounded' : ''}`}>
                                            <span className="text-slate-500 w-12 flex-shrink-0">{entry.simTime}</span>
                                            <span className={`flex-grow ${entry.type==='danger' ? 'text-red-400 font-bold' : entry.type==='warning' ? 'text-amber-300 font-bold' : entry.type==='success' ? 'text-emerald-400 font-bold' : 'text-slate-300'}`}>{entry.msg}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="bg-slate-900 p-3 border-t border-slate-700 flex flex-wrap gap-2">
                            <input type="text" className="bg-slate-800 border border-slate-600 rounded px-4 h-10 text-sm flex-1 min-w-[10rem] text-white focus:border-amber-500 outline-none" placeholder="Type Custom Log Entry..." value={customLog} onChange={e=>setCustomLog(e.target.value)} onKeyDown={e => e.key === 'Enter' && (addLogEntry(customLog, 'manual') || setCustomLog(""))} />
                            <Button onClick={() => {addLogEntry(customLog, 'manual', true); setCustomLog("");}} variant="secondary" className="h-10 w-24 shrink-0 text-amber-500 border-amber-500/30"><Lucide icon="flag" className="w-4 h-4 mr-1"/> Flag</Button>
                            <Button onClick={() => {addLogEntry(customLog, 'manual'); setCustomLog("");}} variant="secondary" className="h-10 w-24 shrink-0">Add Log</Button>
                        </div>
                    </div>
                    ) : (
                    <div className="md:col-span-7 lg:col-span-8 flex flex-col bg-slate-800 rounded border border-slate-700 overflow-hidden relative">
                        {searchTerm.length > 0 && searchResults.length > 0 && (
                            <div className="absolute top-[100px] left-2 right-2 bg-slate-800 border border-slate-600 rounded shadow-2xl z-40 max-h-64 overflow-y-auto">
                                {searchResults.map(key => (
                                    <button key={key} onClick={() => { applyIntervention(key); setSearchTerm(""); setSearchResults([]); }} className="w-full text-left p-3 hover:bg-slate-700 border-b border-slate-700 last:border-0 flex justify-between items-center group">
                                        <span className="font-bold text-sky-400">{INTERVENTIONS[key].label}{INTERVENTIONS[key].route && INTERVENTIONS[key].route !== 'n/a' ? <span className="ml-2 text-[10px] font-normal text-slate-400 uppercase tracking-wide">{INTERVENTIONS[key].route}</span> : null}</span>
                                        <span className="text-xs text-slate-500 uppercase">{INTERVENTIONS[key].category}</span>
                                    </button>
                                ))}
                            </div>
                        )}

                        <div className="bg-slate-900 p-3 border-b border-slate-700 flex flex-col gap-2">
                            {/* min-w-0 on the inputs + wrapping rows: fixed-width buttons alongside a flex-1
                                input clipped the labels on narrow screens. */}
                            <div className="flex flex-wrap gap-2">
                                <input type="text" className="bg-slate-800 border border-slate-600 rounded px-4 h-12 text-lg flex-1 min-w-[10rem] text-white focus:border-sky-500 outline-none" placeholder="Search Interventions..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} />
                                <div className="hidden sm:block w-px h-12 bg-slate-700 mx-1"></div>
                                <Button onClick={() => {sim.dispatch({type: 'TRIGGER_IMPROVE'}); addLogEntry("Patient Improving (Trend)", "success")}} className="h-12 w-20 shrink-0 text-xs px-2 bg-emerald-900 border border-emerald-500 text-emerald-100 flex-col gap-0 leading-tight"><span>Trend</span><span className="font-bold">Better</span></Button>
                                <Button onClick={() => {sim.dispatch({type: 'TRIGGER_DETERIORATE'}); addLogEntry("Patient Deteriorating (Trend)", "danger")}} className="h-12 w-20 shrink-0 text-xs px-2 bg-red-900 border border-red-500 text-red-100 flex-col gap-0 leading-tight"><span>Trend</span><span className="font-bold">Worse</span></Button>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <input type="text" className="bg-slate-800 border border-slate-600 rounded px-4 h-10 text-sm flex-1 min-w-[10rem] text-white focus:border-amber-500 outline-none" placeholder="Type Custom Log Entry..." value={customLog} onChange={e=>setCustomLog(e.target.value)} onKeyDown={e => e.key === 'Enter' && (addLogEntry(customLog, 'manual') || setCustomLog(""))} />
                                <Button onClick={() => {addLogEntry(customLog, 'manual', true); setCustomLog("");}} variant="secondary" className="h-10 w-24 shrink-0 text-amber-500 border-amber-500/30"><Lucide icon="flag" className="w-4 h-4 mr-1"/> Flag</Button>
                                <Button onClick={() => {addLogEntry(customLog, 'manual'); setCustomLog("");}} variant="secondary" className="h-10 w-24 shrink-0">Add Log</Button>
                            </div>
                        </div>

                        {/* Nine categories won't fit on a phone, so this one stays a scroller — but the
                            scrollbar is left visible, otherwise there is no cue the later tabs exist. */}
                        <div className="flex flex-wrap md:flex-nowrap md:overflow-x-auto bg-slate-900 border-b border-slate-700">
                             {['Common', 'Drugs', 'Airway', 'Breathing', 'Circulation', 'Procedures', 'Investigations', 'Voice', 'Assessment'].map(cat => (
                                 <button key={cat} onClick={() => setActiveTab(cat)} className={`px-2 md:px-4 py-2 md:py-3 text-[10px] md:text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${activeTab === cat ? 'bg-slate-800 text-sky-400 border-t-2 border-sky-400' : 'text-slate-500 hover:text-slate-300'} ${cat === 'Assessment' ? 'md:ml-auto border-l border-slate-700 text-amber-400' : ''}`}>{cat}</button>
                             ))}
                        </div>
                        
                        <div className="flex-1 p-3 overflow-y-auto bg-slate-800 relative">
                            {activeTab === 'Assessment' ? (
                                <div className="space-y-4 p-2">
                                    <div className="bg-sky-900/20 border border-sky-500/30 p-4 rounded-lg">
                                        <h3 className="text-sm font-bold text-sky-400 uppercase mb-2 flex items-center gap-2"><Lucide icon="clipboard-check" className="w-4 h-4"/> Live Skills Checklist</h3>
                                        <p className="text-xs text-slate-400 mb-4">Mark skills as observed (Green) or needs improvement (Red). This data will appear in the debrief.</p>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            {Object.keys(assessments).map(skill => (
                                                <div key={skill} className="flex items-center justify-between bg-slate-900 p-3 rounded border border-slate-700">
                                                    <span className="text-sm font-bold text-slate-200">{skill}</span>
                                                    <div className="flex gap-2">
                                                        <button aria-label={`Mark ${skill} as needing improvement`} onClick={()=>setAssessments({...assessments, [skill]: false})} className={`p-2 rounded border ${assessments[skill] === false ? 'bg-red-600 border-red-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-500'}`}><Lucide icon="x" className="w-4 h-4"/></button>
                                                        <button aria-label={`Mark ${skill} as achieved`} onClick={()=>setAssessments({...assessments, [skill]: true})} className={`p-2 rounded border ${assessments[skill] === true ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-500'}`}><Lucide icon="check" className="w-4 h-4"/></button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ) : activeTab === 'Voice' ? (
                                <div className="space-y-4">
                                    <div className="bg-slate-900 p-3 rounded border border-slate-700">
                                        <h3 className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-2"><Lucide icon="mic" className="w-3 h-3"/> Text to Speech</h3>
                                        <div className="flex gap-2">
                                            <input type="text" value={speechText} onChange={(e) => setSpeechText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (speak(speechText) || setSpeechText(""))} className="flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white text-sm" placeholder="Type what the patient says..."/>
                                            <Button onClick={() => {speak(speechText); setSpeechText("");}} variant="primary" className="h-10">Speak</Button>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                        {VOICE_PHRASES.map(phrase => (
                                            <Button key={phrase} onClick={() => speak(phrase)} variant="secondary" className="h-12 text-sm normal-case justify-start px-4 text-left border border-slate-600 bg-slate-800">
                                                <Lucide icon="message-square" className="w-4 h-4 mr-2 opacity-50"/> "{phrase}"
                                            </Button>
                                        ))}
                                    </div>
                                </div>
                            ) : activeTab === 'Investigations' ? (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                                    {['ECG', 'VBG', 'X-ray', 'Urine', 'POCUS', 'CT'].map(type => (
                                        <Button key={type} onClick={() => handleInvClick(type)} variant="outline" className="h-14 flex flex-col items-center justify-center gap-1">
                                            <Lucide icon="activity" className="w-4 h-4 text-sky-400"/>
                                            <span className="text-xs font-bold">Send {type}</span>
                                        </Button>
                                    ))}
                                </div>
                            ) : activeTab === 'Drugs' ? (
                                renderDrugsTab()
                            ) : (
                                <>
                                    {scenario.recommendedActions && scenario.recommendedActions.length > 0 && activeTab === 'Common' && (
                                        <div className="mb-4 p-4 bg-amber-900/20 border-2 border-amber-500 rounded-lg shadow-lg">
                                            <h4 className="text-sm font-bold text-amber-400 uppercase mb-3 flex items-center gap-2"><Lucide icon="check-circle" className="w-4 h-4"/> Recommended Actions</h4>
                                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                                {scenario.recommendedActions.map(key => {
                                                    if (!INTERVENTIONS[key]) return null;
                                                    return renderActionBtn(key);
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                                        {getInterventionsByCat(activeTab).map(key => renderActionBtn(key))}
                                    </div>
                                    {scenario.customActions && scenario.customActions.length > 0 && activeTab === 'Common' && (
                                        <div className="mt-4 p-4 bg-sky-900/20 border-2 border-sky-500 rounded-lg shadow-lg">
                                            <h4 className="text-sm font-bold text-sky-400 uppercase mb-3 flex items-center gap-2"><Lucide icon="settings" className="w-4 h-4"/> Scenario Actions</h4>
                                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                                {scenario.customActions.map((action, idx) => (
                                                    <button key={idx} onClick={() => addLogEntry(action, 'action')} className="h-14 p-2 rounded text-left bg-sky-900/30 hover:bg-sky-800/50 border border-sky-600 flex items-center text-xs font-bold text-sky-300">{action}</button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                    )}
                </div>

                {showLogModal && (
                    <Modal label="Simulation log" onClose={()=>setShowLogModal(false)}>
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-2xl shadow-2xl h-[80vh] flex flex-col">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-bold text-white uppercase tracking-wider">Simulation Log</h3>
                                <Button onClick={()=>setShowLogModal(false)} size="sm" variant="outline">Close</Button>
                            </div>
                            <div className="flex-1 overflow-y-auto bg-slate-900 p-4 rounded border border-slate-700 font-mono text-sm space-y-2">
                                {state.log.map((entry, i) => (
                                    <div key={i} className={`flex gap-4 border-b border-slate-800 pb-1 items-center ${entry.flagged ? 'bg-amber-900/20 -mx-2 px-2' : ''}`}>
                                        <button aria-label={`${entry.flagged ? 'Unflag' : 'Flag'} log entry at ${entry.simTime}`} onClick={() => sim.dispatch({type: 'TOGGLE_FLAG', payload: i})} className={`text-slate-500 hover:text-amber-500 transition-colors ${entry.flagged ? 'text-amber-500' : ''}`}><Lucide icon="flag" className="w-4 h-4"/></button>
                                        <span className="text-slate-500 w-20 flex-shrink-0">{entry.simTime}</span>
                                        <span className={`flex-grow ${entry.type==='danger' ? 'text-red-400 font-bold' : entry.type==='warning' ? 'text-amber-300 font-bold' : entry.type==='success' ? 'text-emerald-400 font-bold' : 'text-slate-300'}`}>{entry.msg}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </Modal>
                )}
                
                {showNIBPModal && (
                    <Modal label="NIBP control" onClose={()=>setShowNIBPModal(false)}>
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-sm shadow-2xl">
                             <h3 className="text-lg font-bold text-white mb-4 uppercase tracking-wider">NIBP Control</h3>
                             <div className="space-y-4">
                                <div><label className="text-xs text-slate-400 font-bold uppercase">Systolic</label><input type="number" value={nibpSys} onChange={e=>setNibpSys(e.target.value)} className="w-full bg-slate-900 border border-slate-500 rounded p-3 text-xl font-mono text-white text-center font-bold" /></div>
                                <div><label className="text-xs text-slate-400 font-bold uppercase">Diastolic</label><input type="number" value={nibpDia} onChange={e=>setNibpDia(e.target.value)} className="w-full bg-slate-900 border border-slate-500 rounded p-3 text-xl font-mono text-white text-center font-bold" /></div>
                                {nibpError && <div className="bg-red-900/30 border border-red-600 rounded p-2 text-red-200 text-xs font-bold text-center">{nibpError}</div>}
                                <div className="grid grid-cols-2 gap-2">
                                    <Button onClick={() => { if (nibpError) return; sim.dispatch({type: 'SET_NIBP', payload: {sys: parseFloat(nibpSys), dia: parseFloat(nibpDia)}}); setShowNIBPModal(false); addLogEntry(`NIBP Manual: ${nibpSys}/${nibpDia}`, 'manual'); }} variant="primary" disabled={!!nibpError} className={`h-12 text-sm ${nibpError ? 'opacity-40 cursor-not-allowed' : ''}`}>Send Value</Button>
                                    <Button onClick={() => { triggerNIBP(); setShowNIBPModal(false); }} variant="warning" className="h-12 text-sm">Cycle Cuff</Button>
                                </div>
                                <Button onClick={()=>setShowNIBPModal(false)} variant="outline" className="w-full">Cancel</Button>
                             </div>
                        </div>
                    </Modal>
                )}

                {invModal && (
                    <Modal label="Investigation result" onClose={dismissInv}>
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-lg shadow-2xl h-[90vh] flex flex-col">
                             <div className="flex justify-between items-center mb-4">
                                <div className="min-w-0">
                                    <h3 className="text-lg font-bold text-white uppercase tracking-wider">Choose {invModal} result</h3>
                                    <p className="text-[11px] text-slate-400">Nothing has been sent yet. Pick a finding (or type one) and it goes to the student monitor.</p>
                                </div>
                                <button aria-label="Dismiss without sending" onClick={dismissInv} className="text-slate-400 hover:text-white"><Lucide icon="x" className="w-5 h-5"/></button>
                             </div>
                             
                             <div className="space-y-4 overflow-y-auto flex-grow pr-2">
                                 <div className="grid grid-cols-2 gap-2">
                                     <Button onClick={()=>sendInv(invModal, "Normal / Unremarkable")} variant="secondary">Normal</Button>
                                     <Button onClick={()=>sendScenarioDefault(invModal)} variant="secondary" title="Sends this scenario's own authored finding.">Scenario Finding</Button>
                                 </div>
                                 
                                 {PREDEFINED_FINDINGS[invModal] && (
                                     <div>
                                        <label className="text-xs text-slate-400 font-bold uppercase mb-2 block">Quick Select Findings</label>
                                        <div className="grid grid-cols-1 gap-2">
                                            {PREDEFINED_FINDINGS[invModal].map(finding => (
                                                <button key={finding} onClick={()=>sendInv(invModal, finding)} className="text-left px-3 py-2 bg-slate-700 hover:bg-slate-600 text-sm text-slate-200 rounded border border-slate-600 transition-colors">{finding}</button>
                                            ))}
                                        </div>
                                     </div>
                                 )}

                                 {(invModal === 'X-ray' || invModal === 'CT') && scenario.customImages && scenario.customImages[invModal === 'X-ray' ? 'xray' : 'ct'] && (
                                     <div>
                                         <label className="text-xs text-slate-400 font-bold uppercase mb-1 block">Scenario Image</label>
                                         <a href={scenario.customImages[invModal === 'X-ray' ? 'xray' : 'ct']} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300 underline text-sm break-all">{scenario.customImages[invModal === 'X-ray' ? 'xray' : 'ct']}</a>
                                     </div>
                                 )}

                                 <div>
                                    <label className="text-xs text-slate-400 font-bold uppercase mb-1 block">Custom Finding</label>
                                    <textarea value={invCustomText} onChange={e=>setInvCustomText(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm h-20" placeholder="Type custom finding here..."></textarea>
                                    <Button onClick={()=>sendInv(invModal, invCustomText)} variant="primary" className="w-full mt-2" disabled={!invCustomText}>Send Custom</Button>
                                 </div>
                             </div>
                             <div className="border-t border-slate-700 pt-4 mt-2 flex-shrink-0 grid grid-cols-2 gap-2">
                                 <Button onClick={dismissInv} variant="outline" className="w-full">Cancel (send nothing)</Button>
                                 <Button onClick={clearInvOnMonitor} variant="danger" className="w-full">Clear result on monitor</Button>
                             </div>
                        </div>
                    </Modal>
                )}
                
                {modalVital && (
                    <Modal label="Vital control" onClose={()=>setModalVital(null)}>
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-sm shadow-2xl">
                            <h3 className="text-lg font-bold text-white mb-4 uppercase tracking-wider">Control: {modalVital}</h3>
                            <div className="space-y-4">
                                <div><label className="text-xs text-slate-400 font-bold uppercase">Target</label><input type="number" step={modalVital === 'ph' ? 0.01 : (modalVital === 'temp' || modalVital === 'etco2' || modalVital === 'bm') ? 0.1 : 1} value={modalTarget} onChange={e=>setModalTarget(e.target.value)} className="w-full bg-slate-900 border border-slate-500 rounded p-3 text-xl font-mono text-white text-center font-bold" autoFocus /></div>
                                {modalVital === 'bp' && <div><label className="text-xs text-slate-400 font-bold uppercase">Diastolic</label><input type="number" value={modalTarget2} onChange={e=>setModalTarget2(e.target.value)} className="w-full bg-slate-900 border border-slate-500 rounded p-3 text-xl font-mono text-white text-center font-bold" /></div>}
                                
                                {modalVital === 'etco2' && (
                                    <div>
                                        <label className="text-xs text-slate-400 font-bold uppercase mb-2 block">Waveform Shape</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button onClick={()=>setEtco2Shape('normal')} className={`p-2 rounded border text-xs font-bold ${etco2Shape==='normal' ? 'bg-sky-600 border-sky-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}`}>Normal</button>
                                            <button onClick={()=>setEtco2Shape('bronchospastic')} className={`p-2 rounded border text-xs font-bold ${etco2Shape==='bronchospastic' ? 'bg-sky-600 border-sky-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}`}>Obstructive</button>
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-4 gap-1 mt-2">
                                    {[0, 30, 120, 300].map(d => <button key={d} onClick={()=>setTrendDuration(d)} className={`p-2 rounded text-[10px] font-bold border ${trendDuration===d ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-400'}`}>{d}s</button>)}
                                </div>
                                {vitalModalError && <div className="bg-red-900/30 border border-red-600 rounded p-2 text-red-200 text-xs font-bold text-center">{vitalModalError}</div>}
                                <Button onClick={confirmVitalUpdate} variant="success" disabled={!!vitalModalError} className={`w-full mt-4 h-12 text-lg font-bold ${vitalModalError ? 'opacity-40 cursor-not-allowed' : ''}`}>CONFIRM</Button>
                                <Button onClick={()=>setModalVital(null)} variant="outline" className="w-full">Cancel</Button>
                            </div>
                        </div>
                    </Modal>
                )}

                {showRhythmModal && (
                    <Modal label="Select rhythm" onClose={()=>setShowRhythmModal(false)}>
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-2xl shadow-2xl">
                            <h3 className="text-lg font-bold text-white mb-4 uppercase tracking-wider">Select Rhythm</h3>
                            <div className="grid grid-cols-3 gap-2">
                                {RHYTHMS.map(r => (
                                    <button key={r} onClick={() => { changeRhythm(r, 'manual selection'); setShowRhythmModal(false); }} className={`p-3 text-sm font-bold rounded border ${state.rhythm === r ? 'bg-sky-600 border-sky-400 text-white' : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'}`}>
                                        {RG.labelFor(r)}
                                    </button>
                                ))}
                            </div>
                            <Button onClick={()=>setShowRhythmModal(false)} variant="outline" className="w-full mt-4">Cancel</Button>
                        </div>
                    </Modal>
                )}

                {showDrugCalc && (
                    <Modal label="Drug dosing calculator" onClose={()=>setShowDrugCalc(false)}>
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-lg shadow-2xl h-[90vh] flex flex-col">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-bold text-white uppercase tracking-wider">Drug Dosing Calculator</h3>
                                <button aria-label="Close drug calculator" onClick={() => setShowDrugCalc(false)} className="text-slate-400 hover:text-white"><Lucide icon="x" className="w-5 h-5"/></button>
                            </div>
                            <div className="mb-4">
                                <label className="text-xs text-slate-400 font-bold uppercase">Patient Weight (kg)</label>
                                <input type="number" min="0.5" max="300" step="0.1" value={drugCalcWeightStr} onChange={e => setDrugCalcWeightStr(e.target.value)} className={`w-full bg-slate-900 border rounded p-2 text-xl font-mono text-white text-center font-bold mt-1 ${drugCalcWeightError ? 'border-red-500' : 'border-slate-500'}`} />
                                {drugCalcWeightError && <div className="text-red-400 text-xs font-bold mt-1">{drugCalcWeightError}</div>}
                            </div>
                            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                                {drugCalcWeightError && (
                                    <div className="bg-red-900/30 border border-red-600 rounded p-4 text-center text-red-200 text-sm">
                                        Doses hidden until a valid weight is entered.
                                    </div>
                                )}
                                {!drugCalcWeightError && DRUG_CALC_LIST.map((drug, idx) => {
                                    const rawDose = drug.perKg * drugCalcWeight;
                                    const minDose = drug.min ? Math.max(rawDose, drug.min) : rawDose;
                                    const finalDose = Math.min(minDose, drug.max);
                                    return (
                                        <div key={idx} className="bg-slate-900 border border-slate-700 rounded p-3 flex justify-between items-center">
                                            <div>
                                                <div className="text-sm font-bold text-white">{drug.name}</div>
                                                <div className="text-xs text-slate-400">{drug.info}</div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-lg font-bold text-sky-400 font-mono">{finalDose.toFixed(1)} {drug.unit}</div>
                                                <div className="text-[10px] text-slate-500">max {drug.max}{drug.unit}</div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </Modal>
                )}

                {showTimerModal && (
                    <Modal label="Timer alerts" onClose={()=>setShowTimerModal(false)}>
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-md shadow-2xl">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-bold text-white uppercase tracking-wider">Timer Alerts</h3>
                                <button aria-label="Close timer alerts" onClick={() => setShowTimerModal(false)} className="text-slate-400 hover:text-white"><Lucide icon="x" className="w-5 h-5"/></button>
                            </div>
                            <div className="space-y-3 mb-4">
                                <div className="flex gap-2">
                                    <input type="number" min="0.5" max="180" step="0.5" value={newAlertMins} onChange={e => { setNewAlertMins(e.target.value); setTimerAlertError(''); }} placeholder="Mins" className="w-20 bg-slate-900 border border-slate-600 rounded p-2 text-white text-center" />
                                    <input type="text" value={newAlertMsg} onChange={e => setNewAlertMsg(e.target.value)} placeholder="Alert message..." className="flex-1 bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm" />
                                    <Button onClick={addTimerAlert} variant="primary" className="h-10 px-3">Add</Button>
                                </div>
                                {timerAlertError && <div className="text-red-400 text-xs font-bold">{timerAlertError}</div>}
                                <div className="text-xs text-slate-500">Alerts fire automatically at the set sim time and play a tone.</div>
                            </div>
                            <div className="space-y-2 max-h-64 overflow-y-auto">
                                {timerAlerts.length === 0 && <div className="text-slate-500 text-sm text-center py-4">No alerts set</div>}
                                {timerAlerts.map(alert => (
                                    <div key={alert.id} className={`flex items-center justify-between p-3 rounded border ${firedAlerts.has(alert.id) ? 'bg-red-900/30 border-red-600' : 'bg-slate-900 border-slate-700'}`}>
                                        <div>
                                            <span className="text-white font-bold text-sm">{alert.msg}</span>
                                            <span className="text-slate-400 text-xs ml-2">@ {alert.mins}min</span>
                                            {firedAlerts.has(alert.id) && <span className="text-red-400 text-xs ml-2 font-bold">FIRED</span>}
                                        </div>
                                        <button aria-label={`Remove alert: ${alert.msg}`} onClick={() => setTimerAlerts(prev => prev.filter(a => a.id !== alert.id))} className="text-slate-500 hover:text-red-400"><Lucide icon="x" className="w-4 h-4"/></button>
                                    </div>
                                ))}
                            </div>
                            <Button onClick={() => setShowTimerModal(false)} variant="outline" className="w-full mt-4">Close</Button>
                        </div>
                    </Modal>
                )}

                {showFlagsModal && (
                    <Modal label="Safety flags" onClose={()=>setShowFlagsModal(false)}>
                        <div className="bg-slate-800 p-6 rounded-lg border border-amber-600/60 w-full max-w-2xl shadow-2xl max-h-[80vh] flex flex-col">
                            <div className="flex justify-between items-center mb-3">
                                <h3 className="text-lg font-bold text-amber-400 uppercase tracking-wider flex items-center gap-2"><Lucide icon="flag" className="w-4 h-4"/> Safety flags ({flaggedEntries.length})</h3>
                                <button aria-label="Close safety flags" onClick={()=>setShowFlagsModal(false)} className="text-slate-400 hover:text-white"><Lucide icon="x" className="w-5 h-5"/></button>
                            </div>
                            <p className="text-xs text-slate-400 mb-3">Nothing was blocked. These are recorded deviations for the debrief conversation.</p>
                            {deviationEntries.length > 0 && (
                                <div className="mb-4">
                                    <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">Sequence deviations</h4>
                                    <div className="space-y-2">
                                        {deviationEntries.map((entry, i) => (
                                            <div key={i} className="bg-amber-950/30 border border-amber-700/50 rounded p-2">
                                                <div className="flex justify-between gap-2">
                                                    <span className="text-sm font-bold text-amber-200">{entry.deviation.label || entry.deviation.action}</span>
                                                    <span className="font-mono text-xs text-slate-400">{entry.simTime}</span>
                                                </div>
                                                <div className="text-xs text-slate-300 mt-0.5">Not in place: {entry.deviation.missing.join(', ')}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div className="flex-1 overflow-y-auto bg-slate-900 p-3 rounded border border-slate-700 font-mono text-xs space-y-1">
                                {flaggedEntries.length === 0 && <div className="text-slate-500 text-center py-4">No flags recorded.</div>}
                                {flaggedEntries.map((entry, i) => (
                                    <div key={i} className="flex gap-3">
                                        <span className="text-slate-500 w-14 flex-shrink-0">{entry.simTime}</span>
                                        <span className="text-slate-200">{entry.msg}</span>
                                    </div>
                                ))}
                            </div>
                            <Button onClick={() => setShowFlagsModal(false)} variant="outline" className="w-full mt-4">Close</Button>
                        </div>
                    </Modal>
                )}

                {showKeyHelp && (
                    <Modal label="Keyboard shortcuts" onClose={()=>setShowKeyHelp(false)}>
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-sm shadow-2xl">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-bold text-white uppercase tracking-wider">Keyboard Shortcuts</h3>
                                <button aria-label="Close keyboard shortcuts" onClick={() => setShowKeyHelp(false)} className="text-slate-400 hover:text-white"><Lucide icon="x" className="w-5 h-5"/></button>
                            </div>
                            <div className="space-y-2">
                                {[['Space', 'Play / Pause sim'], ['F', 'Finish sim'], ['D', 'Toggle Drug Calculator'], ['T', 'Toggle Timer Alerts'], ['?', 'Show this help']].map(([key, desc]) => (
                                    <div key={key} className="flex items-center justify-between p-2 bg-slate-900 rounded border border-slate-700">
                                        <kbd className="bg-slate-700 border border-slate-500 text-white text-xs font-mono px-3 py-1 rounded">{key}</kbd>
                                        <span className="text-slate-300 text-sm">{desc}</span>
                                    </div>
                                ))}
                            </div>
                            <Button onClick={() => setShowKeyHelp(false)} variant="outline" className="w-full mt-4">Close</Button>
                        </div>
                    </Modal>
                )}
            </div>
        );
    };
    window.LiveSimScreen = LiveSimScreen;
})();
