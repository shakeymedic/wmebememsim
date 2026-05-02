(() => {
    const { useState, useEffect, useRef } = React;

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
        const { INTERVENTIONS, Button, Lucide, Card, VitalDisplay, ECGMonitor } = window;
        const { state, start, pause, applyIntervention, addLogEntry, manualUpdateVital, triggerArrest, triggerROSC, startTrend, speak, revealInvestigation, clearInvestigation, triggerNIBP } = sim; 

        const { scenario, time, isRunning, vitals, activeInterventions, interventionCounts, activeDurations, arrestPanelOpen, cprInProgress, flash, notification, trends, audioOutput, isMuted, etco2Enabled, showWetflag } = state;
        
        const [activeTab, setActiveTab] = useState("Common");
        const [customLog, setCustomLog] = useState("");
        const [searchTerm, setSearchTerm] = useState("");
        const [speechText, setSpeechText] = useState(""); 
        const [modalVital, setModalVital] = useState(null); 
        const [modalTarget, setModalTarget] = useState("");
        const [modalTarget2, setModalTarget2] = useState(""); 
        const [trendDuration, setTrendDuration] = useState(30);
        const [showLogModal, setShowLogModal] = useState(false);
        const [etco2Shape, setEtco2Shape] = useState("normal");
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
        const [drugCalcWeight, setDrugCalcWeight] = useState(scenario.weight || 70);
        const [showTimerModal, setShowTimerModal] = useState(false);
        const [timerAlerts, setTimerAlerts] = useState([]);
        const [newAlertMins, setNewAlertMins] = useState('5');
        const [newAlertMsg, setNewAlertMsg] = useState('');
        const [firedAlerts, setFiredAlerts] = useState(new Set());
        const [showKeyHelp, setShowKeyHelp] = useState(false);
        const audioCtxRef = useRef(null);
        const lastAlertRef = useRef({});

        const [assessments, setAssessments] = useState({
            "Safe Approach": null,
            "Team Leadership": null,
            "Communication": null,
            "CPR Quality": null,
            "Defib Safety": null,
            "Re-evaluation": null
        });

        const RHYTHMS = ["Sinus Rhythm", "Sinus Tachycardia", "Sinus Bradycardia", "AF", "Atrial Flutter", "SVT", "VT", "VF", "PEA", "Asystole", "1st Deg Heart Block", "Complete Heart Block"];
        const ARREST_RHYTHMS = ["VF", "pVT", "PEA", "Asystole"];
        const ROSC_RHYTHMS = ["Sinus Rhythm", "Sinus Tachycardia", "Sinus Bradycardia", "AF", "SVT"];
        const VOICE_PHRASES = ["My chest hurts", "I can't breathe", "I feel sick", "Who are you?", "My tummy hurts", "I feel dizzy", "Am I going to die?", "Yes", "No", "I'm thirsty", "Where am I?", "Please help me"];
        
        const DRUG_GROUPS = {
            "Resus / Cardiac": ["AdrenalineIV", "Amiodarone", "Atropine", "Adenosine", "MagSulph", "Calcium", "CalciumChloride", "SodiumBicarb", "AdrenalineIM"],
            "Sedation / Analgesia": ["Morphine", "Fentanyl", "Ketamine", "Midazolam", "Lorazepam", "Propofol", "Roc", "Sux", "Paracetamol", "Analgesia"],
            "Vasoactive": ["Metaraminol", "Noradrenaline", "Labetalol", "Phentolamine"],
            "Antibiotics": ["Antibiotics", "Ceftriaxone", "Tazocin", "Gentamicin"],
            "Other": [] 
        };
        const KNOWN_DRUGS = new Set(Object.values(DRUG_GROUPS).flat());

        useEffect(() => {
            if (!searchTerm) { setSearchResults([]); return; }
            const term = searchTerm.toLowerCase();
            const matches = Object.keys(INTERVENTIONS).filter(key => {
                const item = INTERVENTIONS[key];
                return item.label.toLowerCase().includes(term) || key.toLowerCase().includes(term);
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

        const playAlertTone = (type) => {
            try {
                if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
                const ctx = audioCtxRef.current;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = type === 'critical' ? 880 : 660;
                osc.type = 'sine';
                gain.gain.setValueAtTime(0.3, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.5);
            } catch(e) {}
        };

        useEffect(() => {
            if (isMuted || !isRunning) return;
            const now = Date.now();
            if (vitals.hr > 130 || vitals.hr < 40) { if (now - (lastAlertRef.current.hr || 0) > 10000) { playAlertTone('critical'); lastAlertRef.current.hr = now; } }
            if (vitals.spO2 < 90) { if (now - (lastAlertRef.current.spO2 || 0) > 10000) { playAlertTone('critical'); lastAlertRef.current.spO2 = now; } }
            if (vitals.rr < 8 || vitals.rr > 30) { if (now - (lastAlertRef.current.rr || 0) > 10000) { playAlertTone('alert'); lastAlertRef.current.rr = now; } }
        }, [vitals.hr, vitals.spO2, vitals.rr, isMuted, isRunning]);

        useEffect(() => {
            if (!isRunning) return;
            timerAlerts.forEach(alert => {
                const alertTimeS = alert.mins * 60;
                if (time >= alertTimeS && !firedAlerts.has(alert.id)) {
                    setFiredAlerts(prev => new Set([...prev, alert.id]));
                    addLogEntry(`Timer Alert: ${alert.msg}`, 'danger');
                    playAlertTone('critical');
                }
            });
        }, [time, isRunning, timerAlerts, firedAlerts]);

        useEffect(() => {
            const handler = (e) => {
                const tag = document.activeElement?.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA') return;
                if (e.key === ' ') { e.preventDefault(); isRunning ? pause() : start(); }
                if (e.key === 'f' || e.key === 'F') onFinish();
                if (e.key === 'd' || e.key === 'D') setShowDrugCalc(v => !v);
                if (e.key === 't' || e.key === 'T') setShowTimerModal(v => !v);
                if (e.key === '?') setShowKeyHelp(v => !v);
            };
            window.addEventListener('keydown', handler);
            return () => window.removeEventListener('keydown', handler);
        }, [isRunning]);

        const formatTime = (s) => `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
        const isMonitoringApplied = activeInterventions.has('Obs'); 
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

        const renderActionBtn = (key) => {
             const action = INTERVENTIONS[key];
             if (!action) return null;
             const count = interventionCounts[key] || 0;
             const isActive = activeInterventions.has(key);
             const variant = (count > 0 || isActive) ? "success" : "outline";
             return (
                 <button key={key} onClick={() => applyIntervention(key)} className={`relative h-14 p-2 rounded text-left bg-slate-700 hover:bg-slate-600 border border-slate-600 flex flex-col justify-between overflow-hidden group/btn`}>
                     <span className={`text-xs font-bold leading-tight ${variant === 'success' ? 'text-emerald-400' : 'text-slate-200'}`}>{action.label}</span>
                     <div className="flex justify-between items-end w-full">
                        <span className="text-[10px] opacity-70 italic truncate">{action.category}</span>
                        {count > 0 && action.type !== 'continuous' && <span className="bg-emerald-500 text-white text-[9px] font-bold px-1.5 rounded-full shadow-md">x{count}</span>}
                     </div>
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
        const confirmVitalUpdate = () => { 
            const targets = {}; 
            if (modalVital === 'bp') { targets.bpSys = parseFloat(modalTarget); targets.bpDia = parseFloat(modalTarget2); } 
            else { targets[modalVital] = (modalVital === 'pupils' || modalVital === 'gcs') ? modalTarget : parseFloat(modalTarget); } 
            if (trendDuration === 0) Object.keys(targets).forEach(k => manualUpdateVital(k, targets[k]));
            else startTrend(targets, trendDuration); 
            setModalVital(null); 
        };

        const getTrend = (key) => trends.active && trends.targets[key] !== undefined ? { active: true, progress: trends.elapsed / trends.duration } : null;

        const handleInvClick = (type) => { setInvModal(type); setInvCustomText(""); };
        const sendInv = (type, text) => { revealInvestigation(type, text); setInvModal(null); };
        const closeInv = () => { clearInvestigation(); setInvModal(null); };

        return (
            <div className={`h-full overflow-hidden flex flex-col p-2 bg-slate-900 relative ${flash === 'red' ? 'flash-red' : (flash === 'green' ? 'flash-green' : '')}`}>
                <div className={`absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-slate-800 border-l-4 rounded shadow-2xl px-6 py-3 transition-all duration-300 ${showToast ? 'translate-y-0 opacity-100' : '-translate-y-10 opacity-0 pointer-events-none'} ${notification?.type === 'danger' ? 'border-red-500' : notification?.type === 'success' ? 'border-emerald-500' : 'border-sky-500'}`}>
                    <div className="flex items-center gap-3">
                        <Lucide icon={notification?.type === 'danger' ? 'alert-triangle' : notification?.type === 'success' ? 'check-circle' : 'info'} className={`w-5 h-5 ${notification?.type === 'danger' ? 'text-red-500' : notification?.type === 'success' ? 'text-emerald-500' : 'text-sky-500'}`} />
                        <span className="font-bold text-white">{notification?.msg}</span>
                    </div>
                </div>

                <div className="flex justify-between items-center bg-slate-800 p-2 rounded mb-2 border border-slate-700">
                    <div className="flex gap-2 items-center relative z-20">
                        <Button variant="secondary" onClick={onBack} className="h-8 px-2"><Lucide icon="arrow-left"/> Back</Button>
                        <Button variant="danger" onClick={onFinish} className="h-8 px-2 font-bold"><Lucide icon="square"/> Finish</Button>
                        {!isRunning ? ( <Button variant="success" onClick={start} className="h-8 px-4 font-bold"><Lucide icon="play"/> START</Button> ) : ( <Button variant="warning" onClick={pause} className="h-8 px-4"><Lucide icon="pause"/> PAUSE</Button> )}
                    </div>

                    <div className="flex items-center gap-2">
                        <Button variant="secondary" onClick={cycleAudioOutput} className="h-8 px-2 text-[10px] uppercase font-bold w-32 justify-between">
                            <Lucide icon="monitor" className="w-4 h-4"/> {audioOutput === 'both' ? 'Audio: Both' : (audioOutput === 'controller' ? 'Audio: Ctrl' : 'Audio: Mon')}
                        </Button>
                        <Button variant={isMuted ? "danger" : "secondary"} onClick={() => sim.dispatch({type: 'SET_MUTED', payload: !isMuted})} className="h-8 px-2">
                            <Lucide icon={isMuted ? "volume-x" : "volume-2"} className="w-4 h-4"/>
                        </Button>
                        <Button variant="secondary" onClick={() => setShowLogModal(true)} className="h-8 px-2 relative">
                            <Lucide icon="list" className="w-4 h-4"/>
                            {state.log.some(l => l.flagged) && <span className="absolute top-0 right-0 w-2 h-2 bg-amber-500 rounded-full"></span>}
                        </Button>
                        <div className="w-px h-6 bg-slate-600 mx-1"></div>
                        <Button variant="outline" onClick={() => window.open(`?mode=monitor&session=${sessionID}`, '_blank')} className="h-8 px-3 text-sky-400 border-sky-500/50 hover:bg-sky-900/30"><Lucide icon="monitor" className="w-4 h-4 mr-1"/> Launch Monitor</Button>
                        <Button variant="outline" onClick={() => window.open('defib/index.html', '_blank')} className="h-8 px-3 text-amber-400 border-amber-500/50 hover:bg-amber-900/30"><Lucide icon="zap" className="w-4 h-4 mr-1"/> Defib Sim</Button>
                        <Button variant="outline" onClick={() => setShowDrugCalc(true)} className="h-8 px-3 text-violet-400 border-violet-500/50 hover:bg-violet-900/30"><Lucide icon="pill" className="w-4 h-4 mr-1"/> Drug Calc</Button>
                        <Button variant="outline" onClick={() => setShowTimerModal(true)} className="h-8 px-3 text-orange-400 border-orange-500/50 hover:bg-orange-900/30"><Lucide icon="bell" className="w-4 h-4 mr-1"/> Alerts</Button>
                        <Button variant="outline" onClick={() => setShowKeyHelp(true)} className="h-8 px-2 text-slate-400 border-slate-600 font-bold">?</Button>
                        <div className="font-mono text-2xl font-bold text-white ml-2">{formatTime(time)}</div>
                    </div>
                </div>

                <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-2 overflow-hidden min-h-0">
                    <div className="lg:col-span-4 flex flex-col gap-2 overflow-y-auto h-full pr-1">
                         <div className="flex-none bg-slate-800 p-3 rounded border-l-4 border-sky-500 shadow-md">
                            <h3 className="text-xs font-bold text-sky-400 uppercase mb-1 flex items-center gap-2"><Lucide icon="user" className="w-3 h-3"/> Patient Details</h3>
                            <div className="text-sm text-white font-bold">{scenario.patientName} ({scenario.patientAge}y {scenario.sex})</div>
                            {scenario.title && <div className="text-xs text-emerald-400 font-bold uppercase mt-0.5">{scenario.title}</div>}
                            {scenario.deterioration && scenario.deterioration.type && <div className="text-[10px] text-slate-400 uppercase tracking-widest mt-0.5">Dx: {scenario.deterioration.type}</div>}
                            <div className="text-xs text-slate-300 mt-1 line-clamp-2">{scenario.patientProfileTemplate.replace('{age}', scenario.patientAge).replace('{sex}', scenario.sex)}</div>
                         </div>

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
                             </div>
                        </div>
                        
                        <div className="flex-none grid grid-cols-2 gap-2">
                            <div className="relative">
                                <Button variant="danger" onClick={()=>setShowArrestMenu(!showArrestMenu)} className="w-full font-bold animate-pulse"><Lucide icon="activity" className="w-4 h-4"/> ARREST</Button>
                                {showArrestMenu && (
                                    <div className="absolute bottom-12 left-0 bg-slate-800 border border-slate-600 rounded shadow-xl w-full flex flex-col p-1 z-50">
                                        {ARREST_RHYTHMS.map(r => (
                                            <button key={r} onClick={() => { triggerArrest(r); setShowArrestMenu(false); }} className="text-left px-3 py-2 text-sm text-red-300 hover:bg-slate-700 hover:text-white rounded">{r}</button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="relative">
                                <Button variant="success" onClick={()=>setShowROSCMenu(!showROSCMenu)} className="w-full font-bold"><Lucide icon="heart" className="w-4 h-4"/> ROSC</Button>
                                {showROSCMenu && (
                                    <div className="absolute bottom-12 right-0 bg-slate-800 border border-slate-600 rounded shadow-xl w-full flex flex-col p-1 z-50">
                                        {ROSC_RHYTHMS.map(r => (
                                            <button key={r} onClick={() => { triggerROSC(r); setShowROSCMenu(false); }} className="text-left px-3 py-2 text-sm text-emerald-300 hover:bg-slate-700 hover:text-white rounded">{r}</button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        
                        <Button variant="outline" onClick={() => sim.dispatch({type: 'SET_ARREST_PANEL', payload: !arrestPanelOpen})} className={`w-full flex-none ${arrestPanelOpen ? 'bg-red-900/30 border-red-500 text-red-400' : ''}`}>
                             <Lucide icon="zap" className="w-4 h-4"/> {arrestPanelOpen ? "Close Defib on Monitor" : "Open Defib on Monitor"}
                        </Button>
                        <Button variant="outline" onClick={triggerNIBP} className="w-full flex-none text-sky-400 border-sky-500/50 hover:bg-sky-900/30">
                             <Lucide icon="activity" className="w-4 h-4"/> Cycle NIBP Now
                        </Button>

                        {isPaeds && (
                            <Button variant="outline" onClick={() => sim.dispatch({type: 'SET_WETFLAG_VISIBILITY', payload: !showWetflag})} className={`w-full flex-none mt-1 ${!showWetflag ? 'text-slate-500 border-slate-600' : 'text-purple-400 border-purple-500/50 bg-purple-900/20'}`}>
                                <Lucide icon="baby" className="w-4 h-4 mr-1"/> {showWetflag ? 'Hide WETFLAG on Monitor' : 'Show WETFLAG on Monitor'}
                            </Button>
                        )}

                        {arrestPanelOpen && (
                             <div className="flex-none bg-red-900/20 border-2 border-red-500 p-2 rounded-lg animate-fadeIn shadow-2xl shadow-red-900/50">
                                 <div className="flex justify-between items-center mb-2">
                                     <h3 className="text-red-400 font-bold uppercase text-xs flex items-center gap-1"><Lucide icon="zap" className="w-3 h-3"/> Defibrillator Active</h3>
                                     <button onClick={() => sim.dispatch({type: 'SET_ARREST_PANEL', payload: false})} className="text-red-400 hover:text-white"><Lucide icon="x" className="w-4 h-4"/></button>
                                 </div>
                                 <div className="grid grid-cols-2 gap-2">
                                     <Button onClick={() => { sim.dispatch({type: 'CHARGE_INIT', payload: {energy: 150}}); sim.playSound('charge'); }} variant="warning" className="h-10 text-xs">Charge</Button>
                                     <Button onClick={() => { sim.dispatch({type: 'SHOCK_DELIVERED', payload: {energy: 150}}); sim.playSound('shock'); }} variant="danger" className="h-10 text-xs font-bold">SHOCK</Button>
                                 </div>
                                 <div className="mt-2 flex items-center justify-between bg-black/50 p-2 rounded">
                                     <span className="text-slate-400 text-[10px] uppercase">CPR Timer</span>
                                     <span className="font-mono text-xl font-bold text-white">{formatTime(state.cycleTimer)}</span>
                                 </div>
                             </div>
                        )}
                    </div>
                    
                    <div className="lg:col-span-8 flex flex-col bg-slate-800 rounded border border-slate-700 overflow-hidden relative">
                        {searchTerm.length > 0 && searchResults.length > 0 && (
                            <div className="absolute top-[100px] left-2 right-2 bg-slate-800 border border-slate-600 rounded shadow-2xl z-40 max-h-64 overflow-y-auto">
                                {searchResults.map(key => (
                                    <button key={key} onClick={() => { applyIntervention(key); setSearchTerm(""); setSearchResults([]); }} className="w-full text-left p-3 hover:bg-slate-700 border-b border-slate-700 last:border-0 flex justify-between items-center group">
                                        <span className="font-bold text-sky-400">{INTERVENTIONS[key].label}</span>
                                        <span className="text-xs text-slate-500 uppercase">{INTERVENTIONS[key].category}</span>
                                    </button>
                                ))}
                            </div>
                        )}

                        <div className="bg-slate-900 p-3 border-b border-slate-700 flex flex-col gap-2">
                            <div className="flex gap-2">
                                <input type="text" className="bg-slate-800 border border-slate-600 rounded px-4 h-12 text-lg flex-1 text-white focus:border-sky-500 outline-none" placeholder="Search Interventions..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} />
                                <div className="w-px h-12 bg-slate-700 mx-1"></div>
                                <Button onClick={() => {sim.dispatch({type: 'TRIGGER_IMPROVE'}); addLogEntry("Patient Improving (Trend)", "success")}} className="h-12 w-20 text-xs px-2 bg-emerald-900 border border-emerald-500 text-emerald-100 flex-col gap-0 leading-tight"><span>Trend</span><span className="font-bold">Better</span></Button>
                                <Button onClick={() => {sim.dispatch({type: 'TRIGGER_DETERIORATE'}); addLogEntry("Patient Deteriorating (Trend)", "danger")}} className="h-12 w-20 text-xs px-2 bg-red-900 border border-red-500 text-red-100 flex-col gap-0 leading-tight"><span>Trend</span><span className="font-bold">Worse</span></Button>
                            </div>
                            <div className="flex gap-2">
                                <input type="text" className="bg-slate-800 border border-slate-600 rounded px-4 h-10 text-sm flex-1 text-white focus:border-amber-500 outline-none" placeholder="Type Custom Log Entry..." value={customLog} onChange={e=>setCustomLog(e.target.value)} onKeyDown={e => e.key === 'Enter' && (addLogEntry(customLog, 'manual') || setCustomLog(""))} />
                                <Button onClick={() => {addLogEntry(customLog, 'manual', true); setCustomLog("");}} variant="secondary" className="h-10 w-24 text-amber-500 border-amber-500/30"><Lucide icon="flag" className="w-4 h-4 mr-1"/> Flag</Button>
                                <Button onClick={() => {addLogEntry(customLog, 'manual'); setCustomLog("");}} variant="secondary" className="h-10 w-24">Add Log</Button>
                            </div>
                        </div>

                        <div className="flex overflow-x-auto bg-slate-900 border-b border-slate-700 no-scrollbar">
                             {['Common', 'Drugs', 'Airway', 'Breathing', 'Circulation', 'Procedures', 'Investigations', 'Voice', 'Assessment'].map(cat => (
                                 <button key={cat} onClick={() => setActiveTab(cat)} className={`px-4 py-3 text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${activeTab === cat ? 'bg-slate-800 text-sky-400 border-t-2 border-sky-400' : 'text-slate-500 hover:text-slate-300'} ${cat === 'Assessment' ? 'ml-auto border-l border-slate-700 text-amber-400' : ''}`}>{cat}</button>
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
                                                        <button onClick={()=>setAssessments({...assessments, [skill]: false})} className={`p-2 rounded border ${assessments[skill] === false ? 'bg-red-600 border-red-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-500'}`}><Lucide icon="x" className="w-4 h-4"/></button>
                                                        <button onClick={()=>setAssessments({...assessments, [skill]: true})} className={`p-2 rounded border ${assessments[skill] === true ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-500'}`}><Lucide icon="check" className="w-4 h-4"/></button>
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
                                    {scenario.recommendedActions && activeTab === 'Common' && (
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
                </div>

                {showLogModal && (
                    <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm">
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-2xl shadow-2xl h-[80vh] flex flex-col">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-bold text-white uppercase tracking-wider">Simulation Log</h3>
                                <Button onClick={()=>setShowLogModal(false)} size="sm" variant="outline">Close</Button>
                            </div>
                            <div className="flex-1 overflow-y-auto bg-slate-900 p-4 rounded border border-slate-700 font-mono text-sm space-y-2">
                                {state.log.map((entry, i) => (
                                    <div key={i} className={`flex gap-4 border-b border-slate-800 pb-1 items-center ${entry.flagged ? 'bg-amber-900/20 -mx-2 px-2' : ''}`}>
                                        <button onClick={() => sim.dispatch({type: 'TOGGLE_FLAG', payload: i})} className={`text-slate-500 hover:text-amber-500 transition-colors ${entry.flagged ? 'text-amber-500' : ''}`}><Lucide icon="flag" className="w-4 h-4"/></button>
                                        <span className="text-slate-500 w-20 flex-shrink-0">{entry.simTime}</span>
                                        <span className={`flex-grow ${entry.type==='danger' ? 'text-red-400 font-bold' : entry.type==='success' ? 'text-emerald-400 font-bold' : 'text-slate-300'}`}>{entry.msg}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
                
                {showNIBPModal && (
                    <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm">
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-sm shadow-2xl">
                             <h3 className="text-lg font-bold text-white mb-4 uppercase tracking-wider">NIBP Control</h3>
                             <div className="space-y-4">
                                <div><label className="text-xs text-slate-400 font-bold uppercase">Systolic</label><input type="number" value={nibpSys} onChange={e=>setNibpSys(e.target.value)} className="w-full bg-slate-900 border border-slate-500 rounded p-3 text-xl font-mono text-white text-center font-bold" /></div>
                                <div><label className="text-xs text-slate-400 font-bold uppercase">Diastolic</label><input type="number" value={nibpDia} onChange={e=>setNibpDia(e.target.value)} className="w-full bg-slate-900 border border-slate-500 rounded p-3 text-xl font-mono text-white text-center font-bold" /></div>
                                <div className="grid grid-cols-2 gap-2">
                                    <Button onClick={() => { sim.dispatch({type: 'SET_NIBP', payload: {sys: nibpSys, dia: nibpDia}}); setShowNIBPModal(false); addLogEntry(`NIBP Manual: ${nibpSys}/${nibpDia}`, 'manual'); }} variant="primary" className="h-12 text-sm">Send Value</Button>
                                    <Button onClick={() => { triggerNIBP(); setShowNIBPModal(false); }} variant="warning" className="h-12 text-sm">Cycle Cuff</Button>
                                </div>
                                <Button onClick={()=>setShowNIBPModal(false)} variant="outline" className="w-full">Cancel</Button>
                             </div>
                        </div>
                    </div>
                )}

                {invModal && (
                    <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm">
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-lg shadow-2xl h-[90vh] flex flex-col">
                             <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-bold text-white uppercase tracking-wider flex-shrink-0">Send {invModal} Result</h3>
                                <button onClick={()=>setInvModal(null)} className="text-slate-400 hover:text-white"><Lucide icon="x" className="w-5 h-5"/></button>
                             </div>
                             
                             <div className="space-y-4 overflow-y-auto flex-grow pr-2">
                                 <div className="grid grid-cols-2 gap-2">
                                     <Button onClick={()=>sendInv(invModal, "Normal / Unremarkable")} variant="secondary">Normal</Button>
                                     <Button onClick={()=>sendInv(invModal, "Abnormal (See scenario)")} variant="secondary">Scenario Default</Button>
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
                             <div className="border-t border-slate-700 pt-4 mt-2 flex-shrink-0">
                                 <Button onClick={closeInv} variant="danger" className="w-full">Clear/Close Result on Monitor</Button>
                             </div>
                        </div>
                    </div>
                )}
                
                {modalVital && (
                    <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm">
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-sm shadow-2xl">
                            <h3 className="text-lg font-bold text-white mb-4 uppercase tracking-wider">Control: {modalVital}</h3>
                            <div className="space-y-4">
                                <div><label className="text-xs text-slate-400 font-bold uppercase">Target</label><input type="number" value={modalTarget} onChange={e=>setModalTarget(e.target.value)} className="w-full bg-slate-900 border border-slate-500 rounded p-3 text-xl font-mono text-white text-center font-bold" autoFocus /></div>
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
                                <Button onClick={confirmVitalUpdate} variant="success" className="w-full mt-4 h-12 text-lg font-bold">CONFIRM</Button>
                                <Button onClick={()=>setModalVital(null)} variant="outline" className="w-full">Cancel</Button>
                            </div>
                        </div>
                    </div>
                )}

                {showRhythmModal && (
                    <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm">
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-2xl shadow-2xl">
                            <h3 className="text-lg font-bold text-white mb-4 uppercase tracking-wider">Select Rhythm</h3>
                            <div className="grid grid-cols-3 gap-2">
                                {RHYTHMS.map(r => (
                                    <button key={r} onClick={() => { sim.dispatch({type: 'UPDATE_RHYTHM', payload: r}); addLogEntry(`Rhythm changed to ${r}`, 'manual'); setShowRhythmModal(false); }} className={`p-3 text-sm font-bold rounded border ${state.rhythm === r ? 'bg-sky-600 border-sky-400 text-white' : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'}`}>
                                        {r}
                                    </button>
                                ))}
                            </div>
                            <Button onClick={()=>setShowRhythmModal(false)} variant="outline" className="w-full mt-4">Cancel</Button>
                        </div>
                    </div>
                )}

                {showDrugCalc && (
                    <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm">
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-lg shadow-2xl h-[90vh] flex flex-col">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-bold text-white uppercase tracking-wider">Drug Dosing Calculator</h3>
                                <button onClick={() => setShowDrugCalc(false)} className="text-slate-400 hover:text-white"><Lucide icon="x" className="w-5 h-5"/></button>
                            </div>
                            <div className="mb-4">
                                <label className="text-xs text-slate-400 font-bold uppercase">Patient Weight (kg)</label>
                                <input type="number" value={drugCalcWeight} onChange={e => setDrugCalcWeight(parseFloat(e.target.value) || 70)} className="w-full bg-slate-900 border border-slate-500 rounded p-2 text-xl font-mono text-white text-center font-bold mt-1" />
                            </div>
                            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                                {DRUG_CALC_LIST.map((drug, idx) => {
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
                    </div>
                )}

                {showTimerModal && (
                    <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm">
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-md shadow-2xl">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-bold text-white uppercase tracking-wider">Timer Alerts</h3>
                                <button onClick={() => setShowTimerModal(false)} className="text-slate-400 hover:text-white"><Lucide icon="x" className="w-5 h-5"/></button>
                            </div>
                            <div className="space-y-3 mb-4">
                                <div className="flex gap-2">
                                    <input type="number" value={newAlertMins} onChange={e => setNewAlertMins(e.target.value)} placeholder="Mins" className="w-20 bg-slate-900 border border-slate-600 rounded p-2 text-white text-center" />
                                    <input type="text" value={newAlertMsg} onChange={e => setNewAlertMsg(e.target.value)} placeholder="Alert message..." className="flex-1 bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm" />
                                    <Button onClick={() => { if (!newAlertMsg || !newAlertMins) return; setTimerAlerts(prev => [...prev, {id: Date.now(), mins: parseFloat(newAlertMins), msg: newAlertMsg}]); setNewAlertMsg(''); setNewAlertMins('5'); }} variant="primary" className="h-10 px-3">Add</Button>
                                </div>
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
                                        <button onClick={() => setTimerAlerts(prev => prev.filter(a => a.id !== alert.id))} className="text-slate-500 hover:text-red-400"><Lucide icon="x" className="w-4 h-4"/></button>
                                    </div>
                                ))}
                            </div>
                            <Button onClick={() => setShowTimerModal(false)} variant="outline" className="w-full mt-4">Close</Button>
                        </div>
                    </div>
                )}

                {showKeyHelp && (
                    <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm">
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-sm shadow-2xl">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-bold text-white uppercase tracking-wider">Keyboard Shortcuts</h3>
                                <button onClick={() => setShowKeyHelp(false)} className="text-slate-400 hover:text-white"><Lucide icon="x" className="w-5 h-5"/></button>
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
                    </div>
                )}
            </div>
        );
    };
    window.LiveSimScreen = LiveSimScreen;
})();
