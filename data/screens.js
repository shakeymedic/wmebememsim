// data/screens.js
(() => {
    const { useState, useEffect, useRef } = React;

    // --- SCREEN 1: SETUP ---
    const SetupScreen = ({ onGenerate, savedState, onResume, sessionID, onJoinClick }) => {
        const { ALL_SCENARIOS, HUMAN_FACTOR_CHALLENGES, Button, Lucide, generateHistory, estimateWeight, calculateWetflag, generateVbg, generateName, getRandomInt } = window;
        
        const [mode, setMode] = useState('random'); 
        const [category, setCategory] = useState('Medical');
        const [age, setAge] = useState('Any');
        const [acuity, setAcuity] = useState('Any'); 
        const [hf, setHf] = useState('hf0');
        const [premadeCategory, setPremadeCategory] = useState(null);
        const [buildTitle, setBuildTitle] = useState("");
        const [buildAge, setBuildAge] = useState(40);
        const [buildCat, setBuildCat] = useState("Medical");
        const [buildDesc, setBuildDesc] = useState("A 40-year-old male with chest pain.");
        const [buildPC, setBuildPC] = useState("Chest Pain");
        const [buildPMH, setBuildPMH] = useState("Hypertension");
        const [buildVitals, setBuildVitals] = useState({ hr: 80, bpSys: 120, rr: 16, spO2: 98 });
        const [customScenarios, setCustomScenarios] = useState([]);

        const scenariosAvailable = ALL_SCENARIOS && ALL_SCENARIOS.length > 0;

        useEffect(() => {
            try {
                const saved = localStorage.getItem('wmebem_custom_scenarios');
                if (saved) { setCustomScenarios(JSON.parse(saved)); }
            } catch (e) {}
        }, []);

        const saveCustomScenario = () => {
            if(!buildTitle) return alert("Please add a title");
            const safeVitals = { hr: parseInt(buildVitals.hr) || 80, bpSys: parseInt(buildVitals.bpSys) || 120, rr: parseInt(buildVitals.rr) || 16, spO2: parseInt(buildVitals.spO2) || 98 };
            const newScen = {
                id: `CUST_${Date.now()}`,
                title: buildTitle,
                category: buildCat,
                ageRange: buildAge < 18 ? "Paediatric" : "Adult",
                acuity: 'Majors',
                ageGenerator: () => parseInt(buildAge),
                patientProfileTemplate: buildDesc,
                presentingComplaint: buildPC,
                vitalsMod: { ...safeVitals, bpDia: Math.floor(safeVitals.bpSys * 0.65), gcs: 15, temp: 37 },
                pmh: buildPMH.split(','),
                dhx: ["As per history"],
                allergies: ["NKDA"],
                instructorBrief: { progression: "Custom Scenario", interventions: [], learningObjectives: ["Custom Objective"] },
                vbgClinicalState: "normal",
                ecg: { type: buildVitals.rhythm || "Sinus Rhythm", findings: buildVitals.rhythm || "Normal" },
                chestXray: { findings: "Unremarkable" }
            };
            const updated = [...customScenarios, newScen];
            setCustomScenarios(updated);
            try { localStorage.setItem('wmebem_custom_scenarios', JSON.stringify(updated)); } catch (e) {}
            setMode('custom'); 
        };

        const handleGenerate = (base) => {
             if (!scenariosAvailable) return alert("Scenarios failed to load.");
             try {
                 let selectedBase = base;
                 if (!base && mode === 'random') {
                     let pool = ALL_SCENARIOS.filter(s => (category === 'Any' || s.category === category) && (age === 'Any' || s.ageRange === age) && (acuity === 'Any' || s.acuity === acuity));
                     if (pool.length === 0) { alert("No scenarios match filters."); return; }
                     selectedBase = pool[Math.floor(Math.random() * pool.length)];
                 }
                 const patientAge = selectedBase.ageGenerator ? selectedBase.ageGenerator() : 40;
                 let sex = Math.random() > 0.5 ? 'Male' : 'Female';
                 if (selectedBase.category === 'Obstetrics & Gynae') sex = 'Female';
                 
                 const history = generateHistory(patientAge, sex);
                 const weight = patientAge < 16 ? estimateWeight(patientAge) : null;
                 const wetflag = weight ? calculateWetflag(patientAge, weight) : null;
                 const randomName = generateName(sex);

                 let finalVitals = { hr: 80, bpSys: 120, bpDia: 80, rr: 16, spO2: 98, temp: 37, gcs: 15, bm: 5, pupils: 3, ...selectedBase.vitalsMod };
                 if (selectedBase.vitalsMod && selectedBase.vitalsMod.bpSys !== undefined && selectedBase.vitalsMod.bpDia === undefined) { finalVitals.bpDia = Math.floor(selectedBase.vitalsMod.bpSys * 0.65); }

                 const generated = { 
                    ...selectedBase, 
                    patientName: randomName,
                    patientAge, 
                    sex,
                    profile: selectedBase.patientProfileTemplate.replace('{age}', patientAge).replace('{sex}', sex),
                    vitals: finalVitals, 
                    pmh: selectedBase.pmh || history.pmh, 
                    dhx: selectedBase.dhx || history.dhx, 
                    allergies: selectedBase.allergies || history.allergies,
                    vbg: generateVbg(selectedBase.vbgClinicalState || "normal"),
                    hf: HUMAN_FACTOR_CHALLENGES.find(h => h.id === hf) || HUMAN_FACTOR_CHALLENGES[0],
                    weight, 
                    wetflag
                 };
                 onGenerate(generated, {});
             } catch (err) { alert("Error generating scenario: " + err.message); }
        };

        const premadeCategories = [
            { id: 'Medical', label: 'Adult Medical', icon: 'stethoscope', filter: s => s.category === 'Medical' && s.ageRange === 'Adult' },
            { id: 'Trauma', label: 'Trauma', icon: 'ambulance', filter: s => s.category === 'Trauma' },
            { id: 'Paediatric', label: 'Paediatric', icon: 'baby', filter: s => s.ageRange === 'Paediatric' },
            { id: 'Resus', label: 'Cardiac Arrest', icon: 'heart-pulse', filter: s => s.category === 'Cardiac Arrest' },
            { id: 'Toxicology', label: 'Toxicology', icon: 'skull', filter: s => s.category === 'Toxicology' },
            { id: 'ObsGyn', label: 'Obs & Gynae', icon: 'baby', filter: s => s.category === 'Obstetrics & Gynae' },
            { id: 'Elderly', label: 'Geriatrics', icon: 'user', filter: s => s.ageRange === 'Elderly' },
            { id: 'Psychiatric', label: 'Psychiatric', icon: 'brain', filter: s => s.category === 'Psychiatric' },
        ];

        return (
            <div className="max-w-4xl mx-auto p-4 h-full overflow-y-auto space-y-6">
                <div className="bg-slate-900 border border-slate-700 p-4 rounded-lg flex items-center justify-between">
                    <div><div className="text-[10px] uppercase text-sky-400 font-bold">Session Code</div><div className="text-2xl font-mono font-bold text-white tracking-widest">{sessionID}</div></div>
                    <Button onClick={onJoinClick} variant="outline" className="h-10 text-xs">Use as Monitor</Button>
                </div>
                {savedState && (<div className="bg-emerald-900/30 border border-emerald-500 p-4 rounded-lg flex items-center justify-between animate-fadeIn"><div><h3 className="font-bold text-emerald-400">Resume Previous?</h3><p className="text-sm text-slate-300">{savedState.scenario.title}</p></div><Button onClick={onResume} variant="success">Resume</Button></div>)}
                <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-xl">
                    <div className="flex gap-2 mb-6 border-b border-slate-700 overflow-x-auto no-scrollbar">{['random', 'premade', 'custom', 'builder'].map(m => (<button key={m} onClick={() => { setMode(m); setPremadeCategory(null); }} className={`pb-2 px-4 text-sm font-bold uppercase whitespace-nowrap transition-colors ${mode === m ? 'text-sky-400 border-b-2 border-sky-400' : 'text-slate-500 hover:text-slate-300'}`}>{m}</button>))}</div>
                    {mode === 'random' && (
                        <div className="space-y-4 animate-fadeIn">
                            <div className="grid grid-cols-2 gap-4">
                                <div><label className="text-xs font-bold text-slate-500">Category</label><select value={category} onChange={e=>setCategory(e.target.value)} className="w-full bg-slate-700 rounded p-2 text-sm text-white border border-slate-600"><option value="Any">Any</option><option value="Medical">Medical</option><option value="Trauma">Trauma</option><option value="Obstetrics & Gynae">Obs & Gynae</option><option value="Cardiac Arrest">Cardiac Arrest</option></select></div>
                                <div><label className="text-xs font-bold text-slate-500">Age</label><select value={age} onChange={e=>setAge(e.target.value)} className="w-full bg-slate-700 rounded p-2 text-sm text-white border border-slate-600"><option value="Any">Any</option><option value="Adult">Adult</option><option value="Paediatric">Paediatric</option><option value="Elderly">Elderly</option></select></div>
                                <div><label className="text-xs font-bold text-slate-500">Acuity</label><select value={acuity} onChange={e=>setAcuity(e.target.value)} className="w-full bg-slate-700 rounded p-2 text-sm text-white border border-slate-600"><option value="Any">Any</option><option value="Majors">Majors</option><option value="Resus">Resus</option></select></div>
                                <div><label className="text-xs font-bold text-slate-500">Human Factors</label><select value={hf} onChange={e=>setHf(e.target.value)} className="w-full bg-slate-700 rounded p-2 text-sm text-white border border-slate-600">{HUMAN_FACTOR_CHALLENGES.map(h=><option key={h.id} value={h.id}>{h.type}</option>)}</select></div>
                            </div>
                            <Button onClick={() => handleGenerate(null)} className="w-full py-4 text-lg shadow-lg shadow-sky-900/20">Generate Scenario</Button>
                        </div>
                    )}
                    {mode === 'premade' && (
                        <div className="animate-fadeIn min-h-[300px]">
                            {!premadeCategory ? (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                    {premadeCategories.map(cat => (<button key={cat.id} onClick={() => setPremadeCategory(cat)} className="flex flex-col items-center justify-center p-4 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-lg transition-all active:scale-95 group"><Lucide icon={cat.icon} className="w-8 h-8 text-sky-400 group-hover:text-white mb-2" /><span className="text-sm font-bold text-slate-200 group-hover:text-white">{cat.label}</span></button>))}
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2 mb-4"><Button variant="secondary" onClick={() => setPremadeCategory(null)} className="h-8 px-2 text-xs"><Lucide icon="arrow-left" /> Back</Button><h3 className="text-lg font-bold text-sky-400">{premadeCategory.label} Scenarios</h3></div>
                                    <div className="grid gap-2 max-h-[400px] overflow-y-auto pr-2">
                                        {ALL_SCENARIOS.filter(premadeCategory.filter).map((s) => (
                                            <div key={s.id} className="flex justify-between items-center bg-slate-700/40 hover:bg-slate-700 p-3 rounded border border-slate-600 group">
                                                <div><div className="font-bold text-slate-200 group-hover:text-white flex items-center gap-2">{s.title} {s.acuity === 'Resus' && <span className="text-[9px] bg-red-900/50 text-red-400 px-1 rounded border border-red-800">RESUS</span>}</div><div className="text-xs text-slate-400">{s.patientProfileTemplate.substring(0, 60)}...</div></div>
                                                <Button onClick={() => handleGenerate(s)} variant="primary" className="h-8 text-xs px-3">Load</Button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    {mode === 'custom' && (
                        <div className="space-y-2 animate-fadeIn">
                             {customScenarios.length === 0 && <p className="text-slate-500 text-sm italic text-center py-4">No custom scenarios saved yet.</p>}
                             {customScenarios.map((s, i) => (<div key={i} className="flex justify-between items-center bg-slate-700/50 p-3 rounded border border-slate-600"><div><div className="font-bold text-white">{s.title}</div></div><Button onClick={() => handleGenerate(s)} variant="success" className="h-8 text-xs">Load</Button></div>))}
                        </div>
                    )}
                    {mode === 'builder' && (
                        <div className="space-y-4 animate-fadeIn">
                            <input type="text" placeholder="Scenario Title" value={buildTitle} onChange={e=>setBuildTitle(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white placeholder-slate-500"/>
                            <textarea placeholder="Description" value={buildDesc} onChange={e=>setBuildDesc(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white h-20 placeholder-slate-500"/>
                            <Button onClick={saveCustomScenario} variant="primary" className="w-full">Save Custom Scenario</Button>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // --- SCREEN 2: JOIN ---
    const JoinScreen = ({ onJoin }) => {
        const { Button, Lucide } = window;
        const [code, setCode] = useState("");
        return (<div className="flex flex-col items-center justify-center h-full bg-slate-900 text-white p-4"><div className="w-full max-w-md space-y-6 text-center"><div className="flex justify-center mb-4"><img src="https://iili.io/KGQOvkl.md.png" alt="Logo" className="h-20 object-contain" /></div><h1 className="text-3xl font-bold text-sky-400">Sim Monitor</h1><p className="text-slate-400">Enter the Session Code</p><input type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="e.g. A1B2" className="w-full bg-slate-800 border-2 border-slate-600 rounded-lg p-4 text-center text-3xl font-mono tracking-widest uppercase text-white outline-none" maxLength={4}/><Button onClick={() => onJoin(code)} disabled={code.length < 4} className="w-full py-4 text-xl">Connect</Button></div></div>);
    };

    // --- SCREEN 3: BRIEFING ---
    const BriefingScreen = ({ scenario, onStart, onBack }) => {
        const { Button, Lucide, InvestigationButton } = window;
        return (
            <div className="max-w-5xl mx-auto space-y-6 animate-fadeIn p-4 overflow-y-auto h-full">
                <div className="bg-slate-800 border-l-4 border-sky-500 shadow-lg rounded-lg overflow-hidden">
                    <div className="p-6 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
                        <div><h2 className="text-3xl font-bold text-white mb-2">{scenario.title}</h2><div className="flex gap-2 mt-2"><span className="bg-slate-700 text-sky-300 text-xs px-2 py-1 rounded border border-slate-600">{scenario.category}</span><span className="bg-slate-700 text-emerald-300 text-xs px-2 py-1 rounded border border-slate-600">{scenario.ageRange}</span></div></div>
                        <div className="text-right"><div className="text-[10px] text-slate-500 uppercase font-bold">Initial GCS</div><div className="text-4xl font-mono font-bold text-white">{scenario.vitals.gcs}</div></div>
                    </div>
                    {scenario.ageRange === 'Paediatric' && scenario.wetflag && (
                        <div className="mx-6 mt-4 p-4 bg-purple-900/20 border border-purple-500/50 rounded-lg">
                            <h3 className="text-sm font-bold text-purple-400 uppercase mb-2">WETFLAG (Est. Weight: {scenario.wetflag.weight}kg)</h3>
                            <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-center">
                                <div className="bg-slate-900 p-2 rounded"><div className="text-[9px] text-slate-500 uppercase">Energy</div><div className="font-bold text-white">{scenario.wetflag.energy} J</div></div>
                                <div className="bg-slate-900 p-2 rounded"><div className="text-[9px] text-slate-500 uppercase">Tube</div><div className="font-bold text-white">{scenario.wetflag.tube}</div></div>
                                <div className="bg-slate-900 p-2 rounded"><div className="text-[9px] text-slate-500 uppercase">Fluids</div><div className="font-bold text-white">{scenario.wetflag.fluids} ml</div></div>
                                <div className="bg-slate-900 p-2 rounded"><div className="text-[9px] text-slate-500 uppercase">Lorazepam</div><div className="font-bold text-white">{scenario.wetflag.lorazepam} mg</div></div>
                                <div className="bg-slate-900 p-2 rounded"><div className="text-[9px] text-slate-500 uppercase">Adrenaline</div><div className="font-bold text-white">{scenario.wetflag.adrenaline} mcg</div></div>
                                <div className="bg-slate-900 p-2 rounded"><div className="text-[9px] text-slate-500 uppercase">Glucose</div><div className="font-bold text-white">{scenario.wetflag.glucose} ml</div></div>
                            </div>
                        </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6">
                        <div className="space-y-6">
                            <div className="bg-slate-900/50 p-4 rounded border border-slate-700">
                                <h3 className="text-sm font-bold text-sky-400 uppercase mb-2 border-b border-slate-700 pb-1">Patient Brief</h3>
                                <p className="text-sm text-slate-400 mb-2"><strong className="text-slate-300 uppercase text-xs">Patient Name:</strong> {scenario.patientName}</p>
                                <p className="text-lg leading-relaxed text-slate-200 mb-4">{scenario.profile}</p>
                                <div className="space-y-2 text-sm">
                                    <div className="flex"><span className="w-24 text-slate-500 font-bold">PMH:</span><span className="text-slate-300">{scenario.pmh ? scenario.pmh.join(", ") : 'Nil'}</span></div>
                                    <div className="flex"><span className="w-24 text-slate-500 font-bold">Rx:</span><span className="text-slate-300">{scenario.dhx ? scenario.dhx.join(", ") : 'Nil'}</span></div>
                                    <div className="flex"><span className="w-24 text-slate-500 font-bold">Allergies:</span><span className="text-red-400 font-bold">{scenario.allergies ? scenario.allergies.join(", ") : 'NKDA'}</span></div>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-4">
                            <div className="p-3 bg-amber-900/20 rounded border border-amber-600/30">
                                <h4 className="text-sm font-bold text-amber-400 uppercase mb-1">Clinical Progression</h4>
                                <p className="text-sm text-slate-300 leading-snug">{scenario.instructorBrief.progression}</p>
                            </div>
                            <div className="p-3 bg-emerald-900/20 rounded border border-emerald-600/30">
                                <h4 className="text-sm font-bold text-emerald-400 uppercase mb-1">Key Interventions</h4>
                                <ul className="list-disc pl-4 text-sm text-slate-300 space-y-1">
                                    {scenario.instructorBrief.interventions && scenario.instructorBrief.interventions.map((l, i) => <li key={i}>{l}</li>)}
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="flex flex-col md:flex-row gap-4">
                    <Button onClick={onBack} variant="secondary" className="flex-1">Back to Setup</Button>
                    <Button onClick={onStart} className="flex-1 shadow-sky-900/20 shadow-xl h-14 text-xl">Start Scenario</Button>
                </div>
            </div>
        );
    };

    // --- SCREEN 4: LIVE SIM CONTROLLER ---
    const LiveSimScreen = ({ sim, onFinish, onBack, sessionID }) => {
        const { INTERVENTIONS, Button, Lucide, Card, VitalDisplay, ECGMonitor, InvestigationButton } = window;
        const { state, start, pause, stop, applyIntervention, addLogEntry, manualUpdateVital, triggerArrest, triggerROSC, revealInvestigation, nextCycle, enableAudio, speak, startTrend, toggleAudioLoop, playSound } = sim;
        const { scenario, time, cycleTimer, isRunning, vitals, prevVitals, log, flash, activeInterventions, interventionCounts, activeDurations, isMuted, rhythm, etco2Enabled, queuedRhythm, cprInProgress, nibp, audioOutput, trends, arrestPanelOpen, waveformGain, noise, remotePacerState, notification, activeLoops, investigationsRevealed, loadingInvestigations } = state;
        
        const [activeTab, setActiveTab] = useState("Common");
        const [customLog, setCustomLog] = useState("");
        const [searchResults, setSearchResults] = useState([]);
        const [showMonitorControls, setShowMonitorControls] = useState(false); 
        const [expandArrest, setExpandArrest] = useState(false); 
        const [customSpeech, setCustomSpeech] = useState("");
        const [showLogModal, setShowLogModal] = useState(false);
        const [modalVital, setModalVital] = useState(null); 
        const [modalTarget, setModalTarget] = useState("");
        const [modalTarget2, setModalTarget2] = useState(""); 
        const [trendDuration, setTrendDuration] = useState(30);
        const [gainVal, setGainVal] = useState(waveformGain || 1.0);
        
        // Search Logic Fix
        useEffect(() => { 
            if (customLog.length > 1) { 
                const results = Object.keys(INTERVENTIONS).filter(key => (INTERVENTIONS[key].label).toLowerCase().includes(customLog.toLowerCase())); 
                setSearchResults(results); 
            } else { 
                setSearchResults([]); 
            } 
        }, [customLog]);

        const handleGhost = (btnId) => { const channel = new BroadcastChannel('sim_channel'); channel.postMessage({ type: 'GHOST_PRESS', payload: btnId }); };
        const updateGain = (e) => { const v = parseFloat(e.target.value); setGainVal(v); sim.dispatch({ type: 'SET_GAIN', payload: v }); };

        const drugCats = { "Arrest": ['AdrenalineIV', 'Amiodarone', 'Calcium', 'MagSulph', 'SodiumBicarb', 'Atropine'], "Sedation": ['Midazolam', 'Lorazepam', 'Ketamine', 'Morphine', 'Fentanyl', 'Roc', 'Sux', 'Propofol'], "Trauma": ['TXA', 'Blood', 'Fluids'], "Infusions": ['FluidInfusion', 'InsulinInfusion', 'GTNInfusion', 'Noradrenaline'], "General": ['Paracetamol', 'Ondansetron', 'Antibiotics', 'Hydrocortisone', 'Dexamethasone', 'Nebs', 'AdrenalineIM'] };
        const mapVoice = (txt) => { if (txt.includes('Cough')) return 'Cough, cough, cough'; if (txt.includes('Scream')) return 'Ahhhhh! Help me!'; if (txt.includes('Moan')) return 'Ohhhhhh...'; return txt.replace(/\*/g, ''); };
        
        const getInterventionsByCat = (cat) => {
            if (cat === 'Handover' || cat === 'Voice' || cat === 'Investigations') return [];
            let keys = [];
            if (cat === 'Common') keys = ['Obs', 'Oxygen', 'IV Access', 'Fluids', 'Analgesia', 'Antiemetic', 'Antibiotics', 'Nebs', 'AdrenalineIM', 'Blood', 'TXA', 'ArtLine']; 
            else if (cat === 'Drugs') keys = Object.keys(INTERVENTIONS).filter(key => INTERVENTIONS[key].category === 'Drugs'); 
            else keys = Object.keys(INTERVENTIONS).filter(key => INTERVENTIONS[key].category === cat);
            return keys.sort((a, b) => INTERVENTIONS[a].label.localeCompare(INTERVENTIONS[b].label));
        };
        
        const formatTime = (s) => `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
        const toggleCPR = () => { sim.dispatch({ type: 'TOGGLE_CPR', payload: !cprInProgress }); addLogEntry(!cprInProgress ? 'CPR Started' : 'CPR Stopped', 'action'); };
        const handleShock = () => { applyIntervention('Defib'); if (!cprInProgress) toggleCPR(); };
        const generateSBAR = () => `S: ${scenario.title}.\nB: ${scenario.patientProfileTemplate.replace('{age}', scenario.patientAge)}.\nA: HR ${vitals.hr}, BP ${vitals.bpSys}/${vitals.bpDia}, SpO2 ${vitals.spO2}%.\nR: Review.`;
        const openVitalControl = (key) => { setModalVital(key); setModalTarget(vitals[key === 'bp' ? 'bpSys' : key]); if (key === 'bp') setModalTarget2(vitals.bpDia); setTrendDuration(30); };
        const quickAdjust = (amt) => { let current = parseFloat(modalTarget) || 0; setModalTarget(current + amt); if (modalVital === 'bp') { let currentDia = parseFloat(modalTarget2) || 0; setModalTarget2(currentDia + (amt * 0.6)); } };
        const confirmVitalUpdate = () => { const targets = {}; if (modalVital === 'bp') { targets.bpSys = parseFloat(modalTarget); targets.bpDia = parseFloat(modalTarget2); } else { targets[modalVital] = (modalVital === 'pupils' || modalVital === 'gcs') ? modalTarget : parseFloat(modalTarget); } if (trendDuration === 0) { Object.keys(targets).forEach(k => manualUpdateVital(k, targets[k])); } else { startTrend(targets, trendDuration); } setModalVital(null); };
        const [annotationText, setAnnotationText] = useState("");
        const addAnnotation = () => { if(annotationText) { addLogEntry(`[NOTE] ${annotationText}`, 'manual'); setAnnotationText(""); } };

        return (
            <div className={`h-full overflow-hidden flex flex-col p-2 bg-slate-900 relative ${flash === 'red' ? 'flash-red' : (flash === 'green' ? 'flash-green' : '')}`}>
                
                {/* --- TOAST NOTIFICATION --- */}
                <div className={`absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-slate-800 border-l-4 rounded shadow-2xl px-6 py-3 transition-all duration-300 ${notification ? 'translate-y-0 opacity-100' : '-translate-y-10 opacity-0 pointer-events-none'} ${notification?.type === 'danger' ? 'border-red-500' : notification?.type === 'success' ? 'border-emerald-500' : 'border-sky-500'}`}>
                    <div className="flex items-center gap-3">
                        <Lucide icon={notification?.type === 'danger' ? 'alert-triangle' : notification?.type === 'success' ? 'check-circle' : 'info'} className={`w-5 h-5 ${notification?.type === 'danger' ? 'text-red-500' : notification?.type === 'success' ? 'text-emerald-500' : 'text-sky-500'}`} />
                        <span className="font-bold text-white">{notification?.msg}</span>
                    </div>
                </div>

                {/* --- HEADER --- */}
                <div className="flex justify-between items-center bg-slate-800 p-2 rounded mb-2 border border-slate-700">
                    <div className="flex gap-2 items-center">
                        <Button variant="secondary" onClick={onBack} className="h-8 px-2"><Lucide icon="arrow-left"/> Back</Button>
                        {!isRunning ? ( <Button variant="success" onClick={start} className="h-8 px-4 font-bold"><Lucide icon="play"/> START</Button> ) : ( <Button variant="warning" onClick={pause} className="h-8 px-4"><Lucide icon="pause"/> PAUSE</Button> )}
                        <Button variant="danger" onClick={() => { if(window.confirm("End scenario and go to debrief?")) onFinish(); }} className="h-8 px-4 font-bold border border-red-500 bg-red-900/50 hover:bg-red-800"><Lucide icon="square" className="fill-current"/> FINISH</Button>
                        <div className="h-8 w-px bg-slate-600 mx-1"></div>
                        <Button onClick={() => sim.dispatch({ type: 'SET_MUTED', payload: !isMuted })} variant={isMuted ? "danger" : "secondary"} className="h-8 px-2"><Lucide icon={isMuted ? "volume-x" : "volume-2"} /></Button>
                    </div>
                    <div className="hidden md:flex flex-col ml-4 px-3 border-l border-slate-600"><span className="text-[10px] text-slate-400 uppercase font-bold">Patient</span><span className="text-white font-bold">{scenario.patientAge}y {scenario.sex}</span></div>
                </div>

                <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-2 overflow-hidden min-h-0">
                    <div className="lg:col-span-4 flex flex-col gap-2 overflow-y-auto">
                        <Card className="bg-black border-slate-800 flex-shrink-0">
                             <ECGMonitor rhythmType={rhythm} hr={vitals.hr} rr={vitals.rr} spO2={vitals.spO2} isPaused={!isRunning} showEtco2={etco2Enabled} pathology={scenario?.deterioration?.type} showTraces={activeInterventions.has('Obs')} showArt={activeInterventions.has('ArtLine')} isCPR={cprInProgress} className="h-32"/>
                             <div className="grid grid-cols-4 gap-1 p-1 bg-black">
                                 <VitalDisplay label="HR" value={vitals.hr} onClick={()=>openVitalControl('hr')} visible={true} />
                                 <VitalDisplay label="BP" value={vitals.bpSys} value2={vitals.bpDia} onClick={()=>openVitalControl('bp')} visible={true} />
                                 <VitalDisplay label="SpO2" value={vitals.spO2} onClick={()=>openVitalControl('spO2')} visible={true} />
                                 <VitalDisplay label="RR" value={vitals.rr} onClick={()=>openVitalControl('rr')} visible={true} />
                             </div>
                             <div className="grid grid-cols-4 gap-1 p-1 bg-black border-t border-slate-900">
                                 <VitalDisplay label="Temp" value={vitals.temp} unit="°C" onClick={()=>openVitalControl('temp')} visible={true} />
                                 <VitalDisplay label="BM" value={vitals.bm} unit="mmol" onClick={()=>openVitalControl('bm')} visible={true} />
                                 <VitalDisplay label="GCS" value={vitals.gcs} unit="" onClick={()=>openVitalControl('gcs')} visible={true} />
                                 {etco2Enabled ? (<VitalDisplay label="ETCO2" value={vitals.etco2} unit="kPa" onClick={()=>openVitalControl('etco2')} visible={true} />) : (<VitalDisplay label="Pupils" value={vitals.pupils} unit="" isText={true} onClick={()=>openVitalControl('pupils')} visible={true} />)}
                             </div>
                        </Card>
                        
                        {/* --- COLLAPSIBLE MONITOR CONTROLS --- */}
                        <div className="bg-slate-800 rounded border border-slate-600">
                            <button onClick={() => setShowMonitorControls(!showMonitorControls)} className="w-full p-2 flex justify-between items-center bg-slate-700 hover:bg-slate-600 text-xs font-bold text-white transition-colors">
                                <span>Monitor Controls (ECG / Pacing)</span>
                                <Lucide icon={showMonitorControls ? "chevron-up" : "chevron-down"} className="w-4 h-4"/>
                            </button>
                            
                            {showMonitorControls && (
                                <div className="p-2 space-y-2 border-t border-slate-600 animate-fadeIn">
                                    <div className="p-2 bg-slate-900/50 rounded border border-slate-700">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-[10px] text-slate-400">Gain: {gainVal}x</span>
                                            <input type="range" min="0.5" max="2.0" step="0.1" value={gainVal} onChange={updateGain} className="flex-1 h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer" />
                                        </div>
                                        <label className="flex items-center gap-2 text-[10px] cursor-pointer text-slate-300">
                                            <input type="checkbox" checked={noise?.interference || false} onChange={() => sim.dispatch({ type: 'TOGGLE_INTERFERENCE' })} className="rounded bg-slate-700" />
                                            60Hz Interference
                                        </label>
                                    </div>

                                    <div className="p-2 bg-slate-900/50 rounded border border-slate-700">
                                        <div className="grid grid-cols-2 gap-1 mb-2">
                                            <Button onClick={() => setExpandArrest(!expandArrest)} variant="danger" className="h-8 text-xs w-full">Arrest...</Button>
                                            <Button onClick={triggerROSC} variant="success" className="h-8 text-xs">ROSC</Button>
                                        </div>
                                        {expandArrest && (
                                            <div className="grid grid-cols-2 gap-1 mb-2">
                                                {['VF', 'PEA', 'pVT', 'Asystole'].map(t => <button key={t} onClick={() => { triggerArrest(t); setExpandArrest(false); }} className="bg-red-900/50 hover:bg-red-800 text-white text-[10px] py-1 rounded border border-red-700">{t}</button>)}
                                            </div>
                                        )}
                                        <select className="w-full bg-slate-800 border border-slate-600 text-white text-xs p-1 rounded" value={rhythm} onChange={(e) => sim.dispatch({type: 'UPDATE_RHYTHM', payload: e.target.value})}>
                                            {['Sinus Rhythm', 'Sinus Tachycardia', 'Sinus Bradycardia', 'AF', 'SVT', 'VT', 'VF', 'Asystole', 'PEA', '1st Deg Block', '3rd Deg Block'].map(r => <option key={r} value={r}>{r}</option>)}
                                        </select>
                                    </div>

                                    <div className="p-2 bg-slate-900/50 rounded border border-slate-700 flex justify-between items-center">
                                        <span className="text-[10px] text-slate-400 font-bold uppercase">Pacer Status</span>
                                        <div className="text-right">
                                            <div className="text-xs text-green-400 font-mono">{remotePacerState?.rate || 0} ppm</div>
                                            <div className="text-[10px] text-slate-500">{remotePacerState?.output || 0} mA</div>
                                        </div>
                                    </div>
                                    
                                    <div className="grid grid-cols-4 gap-1">
                                        <button onClick={() => handleGhost('chargeBtn')} className="bg-slate-700 text-[9px] text-white py-1 rounded">Chg</button>
                                        <button onClick={() => handleGhost('shockBtn')} className="bg-slate-700 text-[9px] text-white py-1 rounded">Shk</button>
                                        <button onClick={() => handleGhost('syncBtn')} className="bg-slate-700 text-[9px] text-white py-1 rounded">Sync</button>
                                        <button onClick={() => handleGhost('analyseBtn')} className="bg-slate-700 text-[9px] text-white py-1 rounded">Alz</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                    
                    <div className="lg:col-span-8 flex flex-col bg-slate-800 rounded border border-slate-700 overflow-hidden">
                        <div className="flex overflow-x-auto bg-slate-900 border-b border-slate-700 no-scrollbar">
                            {['Common', 'Investigations', 'Airway', 'Breathing', 'Circulation', 'Drugs', 'Procedures', 'Voice', 'Handover'].map(cat => (
                                <button key={cat} onClick={() => setActiveTab(cat)} className={`px-4 py-3 text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${activeTab === cat ? 'bg-slate-800 text-sky-400 border-t-2 border-sky-400' : 'text-slate-500 hover:text-slate-300'}`}>{cat}</button>
                            ))}
                        </div>
                        
                        <div className="flex-1 p-2 overflow-y-auto bg-slate-800 relative">
                            {scenario.recommendedActions && (
                                <div className="mb-2 p-2 bg-sky-900/20 border border-sky-600/30 rounded flex flex-wrap gap-1">
                                    {scenario.recommendedActions.map(key => (
                                        <Button key={key} onClick={() => applyIntervention(key)} variant={activeInterventions.has(key) ? "success" : "outline"} className="h-6 text-[10px] px-2">{INTERVENTIONS[key]?.label || key}</Button>
                                    ))}
                                </div>
                            )}

                            {activeTab === 'Investigations' ? (
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                    <InvestigationButton type="VBG" icon="test-tube" label="VBG" isRevealed={investigationsRevealed['VBG']} isLoading={loadingInvestigations['VBG']} revealInvestigation={revealInvestigation} isRunning={isRunning} scenario={scenario} />
                                    <InvestigationButton type="ECG" icon="activity" label="12-Lead ECG" isRevealed={investigationsRevealed['ECG']} isLoading={loadingInvestigations['ECG']} revealInvestigation={revealInvestigation} isRunning={isRunning} scenario={scenario} />
                                    <InvestigationButton type="X-ray" icon="file-image" label="Chest X-Ray" isRevealed={investigationsRevealed['X-ray']} isLoading={loadingInvestigations['X-ray']} revealInvestigation={revealInvestigation} isRunning={isRunning} scenario={scenario} />
                                    <InvestigationButton type="CT" icon="scan" label="CT Scan" isRevealed={investigationsRevealed['CT']} isLoading={loadingInvestigations['CT']} revealInvestigation={revealInvestigation} isRunning={isRunning} scenario={scenario} />
                                    <InvestigationButton type="Urine" icon="droplet" label="Urinalysis" isRevealed={investigationsRevealed['Urine']} isLoading={loadingInvestigations['Urine']} revealInvestigation={revealInvestigation} isRunning={isRunning} scenario={scenario} />
                                    <InvestigationButton type="POCUS" icon="wifi" label="POCUS" isRevealed={investigationsRevealed['POCUS']} isLoading={loadingInvestigations['POCUS']} revealInvestigation={revealInvestigation} isRunning={isRunning} scenario={scenario} />
                                </div>
                            ) : activeTab === 'Drugs' ? (
                                <div className="space-y-4">
                                    {Object.keys(drugCats).map(subCat => (
                                        <div key={subCat}>
                                            <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-1 px-1">{subCat}</h4>
                                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                                {drugCats[subCat].map(key => {
                                                    const action = INTERVENTIONS[key];
                                                    if(!action) return null;
                                                    const count = interventionCounts[key] || 0;
                                                    return (
                                                        <button key={key} onClick={() => applyIntervention(key)} className={`relative h-14 p-2 rounded text-left bg-slate-700 hover:bg-slate-600 border border-slate-600 flex flex-col justify-between overflow-hidden`}>
                                                            <span className="text-xs font-bold leading-tight">{action.label}</span>
                                                            {count > 0 && <span className="absolute bottom-1 right-1 bg-white text-black text-[9px] font-bold px-1.5 rounded-full">x{count}</span>}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                                    {getInterventionsByCat(activeTab).map(key => {
                                        const action = INTERVENTIONS[key];
                                        if (!action) return null;
                                        const count = interventionCounts[key] || 0;
                                        const isActive = activeInterventions.has(key);
                                        return (
                                            <button key={key} onClick={() => applyIntervention(key)} className={`relative h-14 p-2 rounded text-left bg-slate-700 hover:bg-slate-600 border border-slate-600 flex flex-col justify-between overflow-hidden`}>
                                                <span className="text-xs font-bold leading-tight">{action.label}</span>
                                                <div className="flex justify-between items-end w-full"><span className="text-[10px] opacity-70 italic truncate">{action.category}</span>{count > 0 && action.type !== 'continuous' && <span className="bg-white text-black text-[9px] font-bold px-1.5 rounded-full">x{count}</span>}</div>
                                                {isActive && action.type === 'continuous' && (
                                                    <div className="absolute top-1 right-1 text-red-500 bg-black/50 rounded-full w-5 h-5 flex items-center justify-center border border-red-500 hover:bg-red-500 hover:text-white transition-colors" title="Remove">
                                                        <Lucide icon="x" className="w-3 h-3" />
                                                    </div>
                                                )}
                                                {activeDurations[key] && (<div className="absolute bottom-0 left-0 h-1 bg-emerald-400 transition-all duration-1000" style={{width: `${Math.max(0, 100 - ((time - activeDurations[key].startTime)/activeDurations[key].duration*100))}%`}}></div>)}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        
                        <div className="bg-slate-900 p-2 border-t border-slate-700 flex gap-2 relative">
                            <div className="flex-1 relative">
                                <input type="text" className="w-full bg-slate-800 border border-slate-600 rounded px-3 h-8 text-xs text-white" placeholder="Search interventions..." value={customLog} onChange={e=>setCustomLog(e.target.value)} />
                                {searchResults.length > 0 && (
                                    <div className="absolute bottom-full mb-1 left-0 w-full bg-slate-800 border border-slate-600 rounded max-h-48 overflow-y-auto shadow-2xl z-50">
                                        {searchResults.map(key => (
                                            <button key={key} onClick={() => { applyIntervention(key); setCustomLog(""); setSearchResults([]); }} className="w-full text-left px-3 py-2 text-xs text-white hover:bg-slate-700 border-b border-slate-700">
                                                {INTERVENTIONS[key].label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <Button onClick={() => {sim.dispatch({type: 'TRIGGER_IMPROVE'}); addLogEntry("Patient Improving (Trend)", "success")}} className="h-8 text-xs px-2 bg-emerald-900 border border-emerald-500 text-emerald-100">Improve</Button>
                            <Button onClick={() => {sim.dispatch({type: 'TRIGGER_DETERIORATE'}); addLogEntry("Patient Deteriorating (Trend)", "danger")}} className="h-8 text-xs px-2 bg-red-900 border border-red-500 text-red-100">Worsen</Button>
                        </div>
                    </div>
                </div>

                {modalVital && (
                    <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn">
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-sm shadow-2xl">
                            <h3 className="text-lg font-bold text-white mb-4 uppercase tracking-wider">Control: {modalVital}</h3>
                            <div className="space-y-4">
                                <div className="flex gap-2 justify-center mb-4">
                                    {[-10, -5, 5, 10].map(step => (
                                        <Button key={step} onClick={()=>quickAdjust(step)} variant="secondary" className="w-12 text-sm font-bold">{step > 0 ? `+${step}` : step}</Button>
                                    ))}
                                </div>
                                <div><input type={modalVital === 'pupils' ? "text" : "number"} value={modalTarget} onChange={e=>setModalTarget(e.target.value)} className="w-full bg-slate-900 border border-slate-500 rounded p-3 text-xl font-mono text-white text-center font-bold" autoFocus /></div>
                                {modalVital === 'bp' && <div><input type="number" value={modalTarget2} onChange={e=>setModalTarget2(e.target.value)} className="w-full bg-slate-900 border border-slate-500 rounded p-3 text-xl font-mono text-white text-center font-bold mt-2" placeholder="Diastolic" /></div>}
                                <Button onClick={confirmVitalUpdate} variant="success" className="w-full mt-4 h-12 text-lg font-bold">CONFIRM & SEND</Button>
                                <Button onClick={()=>setModalVital(null)} variant="outline" className="w-full">Cancel</Button>
                            </div>
                        </div>
                    </div>
                )}
                {showLogModal && (
                    <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn">
                        <div className="bg-slate-800 rounded-lg border border-slate-600 w-full max-w-2xl h-[80vh] flex flex-col shadow-2xl">
                            <div className="p-4 border-b border-slate-700 flex justify-between items-center"><h3 className="text-lg font-bold text-white">Simulation Log</h3><Button onClick={()=>setShowLogModal(false)} variant="secondary" className="h-8 w-8 p-0"><Lucide icon="x" className="w-4 h-4" /></Button></div>
                            <div className="p-2 border-b border-slate-700 flex gap-2">
                                <input type="text" value={annotationText} onChange={e=>setAnnotationText(e.target.value)} placeholder="Add annotation..." className="flex-1 bg-slate-900 border border-slate-600 rounded px-2 text-white" />
                                <Button onClick={addAnnotation} variant="primary" className="h-8 text-xs">Add Note</Button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-sm">{log.map((l, i) => (<div key={i} className="flex gap-4 border-b border-slate-700/50 pb-1"><span className="text-sky-400 w-16 flex-shrink-0">{l.simTime}</span><span className={`${l.type === 'action' ? 'text-emerald-300' : l.type === 'manual' ? 'text-amber-300' : 'text-slate-300'}`}>{l.msg}</span></div>))}</div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    // --- SCREEN 5: MONITOR (Original with minimal updates if needed) ---
    const MonitorScreen = ({ sim }) => {
        const { Button, Lucide, VitalDisplay, ECGMonitor } = window;
        const { state, enableAudio } = sim;
        const { vitals, prevVitals, rhythm, flash, activeInterventions, etco2Enabled, cprInProgress, scenario, nibp, monitorPopup, notification } = state;
        const hasMonitoring = activeInterventions.has('Obs'); const hasArtLine = activeInterventions.has('ArtLine');
        const [audioEnabled, setAudioEnabled] = useState(false);
        const [defibOpen, setDefibOpen] = useState(false);
        const wakeLockRef = useRef(null);
        
        const [showToast, setShowToast] = useState(false);
        useEffect(() => {
            if(notification && notification.id) {
                setShowToast(true);
                const timer = setTimeout(() => setShowToast(false), 3000);
                return () => clearTimeout(timer);
            }
        }, [notification]);

        const handleEnableAudio = () => { enableAudio(); setAudioEnabled(true); };
        
        useEffect(() => { 
            const requestWakeLock = async () => { if ('wakeLock' in navigator) { try { wakeLockRef.current = await navigator.wakeLock.request('screen'); } catch (err) { console.log(err); } } }; 
            requestWakeLock(); 
            const handleVis = () => { if (document.visibilityState === 'visible') requestWakeLock(); }; 
            document.addEventListener('visibilitychange', handleVis); 
            return () => { if(wakeLockRef.current) wakeLockRef.current.release(); document.removeEventListener('visibilitychange', handleVis); }; 
        }, []);

        const getPopupContent = (type, scenario) => {
            if (!scenario) return null;
            const inv = scenario.investigations || scenario;
            if (type === 'ECG') return { title: '12 Lead ECG', body: <div className="text-xl">{inv.ecg ? inv.ecg.findings : "Normal"}</div> };
            if (type === 'VBG') {
                const v = inv.vbg || {};
                return {
                    title: 'Venous Blood Gas',
                    body: (
                        <div className="font-mono text-xl space-y-1">
                            <div>pH: <span className={v.pH < 7.35 || v.pH > 7.45 ? 'text-red-400 font-bold' : 'text-green-400'}>{v.pH?.toFixed(2)}</span></div>
                            <div>pCO2: <span className={v.pCO2 < 4.5 || v.pCO2 > 6.0 ? 'text-red-400 font-bold' : 'text-green-400'}>{v.pCO2?.toFixed(1)}</span> kPa</div>
                            <div>HCO3: <span className={v.HCO3 < 22 || v.HCO3 > 26 ? 'text-red-400 font-bold' : 'text-green-400'}>{v.HCO3?.toFixed(1)}</span></div>
                            <div>Lac: <span className={v.Lac > 2 ? 'text-red-400 font-bold' : 'text-green-400'}>{v.Lac?.toFixed(1)}</span></div>
                            <div>K+: <span className={v.K < 3.5 || v.K > 5.5 ? 'text-red-400 font-bold' : 'text-green-400'}>{v.K?.toFixed(1)}</span></div>
                            <div>Glu: {v.Glu?.toFixed(1)}</div>
                        </div>
                    )
                };
            }
            let text = "Normal";
            if (type === 'X-ray') text = inv.chestXray ? inv.chestXray.findings : "Normal";
            if (type === 'Urine') text = inv.urine ? inv.urine.findings : "Normal";
            if (type === 'CT') text = inv.ct ? inv.ct.findings : "No acute intracranial abnormality.";
            if (type === 'POCUS') text = inv.pocus ? inv.pocus.findings : "No free fluid.";
            return { title: type, body: <div className="text-xl">{text}</div> };
        };

        const showPopup = monitorPopup && monitorPopup.type && (Date.now() - monitorPopup.timestamp < 20000);

        return (
            <div className={`h-full w-full flex flex-col bg-black text-white p-2 md:p-4 transition-colors duration-200 ${flash === 'red' ? 'flash-red' : (flash === 'green' ? 'flash-green' : '')} relative`}>
                {!audioEnabled && (<div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={handleEnableAudio} onTouchStart={handleEnableAudio}><div className="bg-slate-800 border border-sky-500 p-6 rounded-lg shadow-2xl animate-bounce cursor-pointer text-center"><Lucide icon="volume-2" className="w-12 h-12 text-sky-400 mx-auto mb-2"/><h2 className="text-xl font-bold text-white">Tap to Enable Sound</h2></div></div>)}
                <div className={`absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-slate-900/90 border-l-8 rounded shadow-2xl px-8 py-4 transition-all duration-300 scale-150 origin-top ${showToast ? 'translate-y-0 opacity-100' : '-translate-y-10 opacity-0 pointer-events-none'} ${notification?.type === 'danger' ? 'border-red-500' : notification?.type === 'success' ? 'border-emerald-500' : 'border-sky-500'}`}>
                    <div className="flex items-center gap-4">
                        <Lucide icon={notification?.type === 'danger' ? 'alert-triangle' : notification?.type === 'success' ? 'check-circle' : 'info'} className={`w-8 h-8 ${notification?.type === 'danger' ? 'text-red-500' : notification?.type === 'success' ? 'text-emerald-500' : 'text-sky-500'}`} />
                        <span className="font-bold text-white text-2xl tracking-wide">{notification?.msg}</span>
                    </div>
                </div>
                {defibOpen && (<div className="absolute inset-0 z-[100] bg-black flex flex-col"><div className="absolute top-4 right-4 z-[110]"><Button onClick={() => setDefibOpen(false)} variant="destructive" className="h-10 text-sm uppercase font-bold shadow-xl border border-white/20">Close Defib</Button></div><iframe id="defib-frame" src="defib/index.html" className="w-full h-full border-0 bg-slate-900" title="Defibrillator"/></div>)}
                {showPopup && !defibOpen && (<div className="absolute right-4 top-1/2 -translate-y-1/2 z-40 bg-slate-900/95 border-2 border-sky-500 rounded-lg p-6 shadow-2xl max-w-md animate-fadeIn">{(() => { const content = getPopupContent(monitorPopup.type, scenario); if (!content) return null; const progress = Math.max(0, 100 - ((Date.now() - monitorPopup.timestamp) / 20000 * 100)); return (<div><h3 className="text-2xl font-bold text-sky-400 mb-4 border-b border-slate-700 pb-2">{content.title}</h3><div className="text-white mb-4">{content.body}</div><div className="h-1 bg-slate-800 rounded overflow-hidden"><div className="h-full bg-sky-500 transition-all duration-1000 ease-linear" style={{width: `${progress}%`}}></div></div></div>); })()}</div>)}
                <div className="flex-grow relative border border-slate-800 rounded mb-2 overflow-hidden flex flex-col">
                    <div className="absolute top-2 right-2 z-30"><Button onClick={() => setDefibOpen(true)} variant="destructive" className="h-8 text-[10px] uppercase font-bold shadow-xl border border-white/20 opacity-60 hover:opacity-100 transition-opacity">Open Defib</Button></div>
                    {hasMonitoring ? (<ECGMonitor rhythmType={rhythm} hr={vitals.hr} rr={vitals.rr} spO2={vitals.spO2} isPaused={false} showEtco2={etco2Enabled} pathology={scenario?.deterioration?.type || 'normal'} showTraces={true} showArt={hasArtLine} isCPR={cprInProgress} className="h-full" rhythmLabel="ECG" />) : (<div className="flex items-center justify-center h-full text-slate-600 font-mono text-xl">NO SENSOR DETECTED</div>)}
                </div>
                <div className="flex-none grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 h-auto md:h-[30vh]">
                    <VitalDisplay label="Heart Rate" value={vitals.hr} prev={prevVitals.hr} unit="bpm" lowIsBad={false} onUpdate={() => {}} alert={vitals.hr > 140 || vitals.hr < 40} visible={hasMonitoring} isMonitor={true} hideTrends={true} />
                    {hasArtLine ? (<VitalDisplay label="ABP" value={vitals.bpSys} value2={vitals.bpDia} prev={prevVitals.bpSys} unit="mmHg" onUpdate={() => {}} alert={vitals.bpSys < 90} visible={true} isMonitor={true} hideTrends={true} />) : (<div className="flex gap-2"><div className="flex-grow"><VitalDisplay label="NIBP" value={nibp.inflating ? '---' : (nibp.sys || '?')} value2={nibp.inflating ? '---' : (nibp.dia || '?')} unit="mmHg" onUpdate={() => {}} alert={!nibp.inflating && nibp.sys && nibp.sys < 90} visible={hasMonitoring} isMonitor={true} isNIBP={false} lastNIBP={nibp.lastTaken} hideTrends={true} /></div>{hasMonitoring && (<button onClick={() => sim.triggerNIBP()} disabled={nibp.inflating} className={`w-24 md:w-32 rounded flex flex-col items-center justify-center border-2 ${nibp.inflating ? 'bg-sky-900/50 border-sky-500/50 text-white' : 'bg-slate-800 border-slate-600 text-slate-400 hover:bg-slate-700'}`}>{nibp.inflating ? (<Lucide icon="loader-2" className="w-8 h-8 mb-1 animate-spin text-sky-400" />) : (<Lucide icon="activity" className="w-8 h-8 mb-1" />)}<span className="text-xs font-bold uppercase">{nibp.inflating ? 'INFLATING' : 'START'}</span></button>)}</div>)}
                    <VitalDisplay label="SpO2" value={vitals.spO2} prev={prevVitals.spO2} unit="%" onUpdate={() => {}} alert={vitals.spO2 < 90} visible={hasMonitoring} isMonitor={true} hideTrends={true} />
                    <div className="grid grid-rows-2 gap-2 md:gap-4">
                        <VitalDisplay label="Resp Rate" value={vitals.rr} prev={prevVitals.rr} unit="/min" lowIsBad={false} onUpdate={() => {}} alert={vitals.rr > 30 || vitals.rr < 8} visible={hasMonitoring} isMonitor={true} hideTrends={true} />
                        {etco2Enabled && hasMonitoring ? (<div className="flex flex-col items-center justify-center h-full bg-slate-900/40 rounded border border-yellow-500/50"><span className="text-sm font-bold text-yellow-500">ETCO2</span><span className="text-4xl font-mono font-bold text-yellow-500">{vitals.etco2 ? vitals.etco2.toFixed(1) : (cprInProgress ? '2.5' : '4.5')} <span className="text-sm">kPa</span></span></div>) : (<div className="flex items-center justify-center h-full bg-slate-900/20 rounded border border-slate-800 opacity-30"><span className="font-bold text-slate-600">ETCO2 OFF</span></div>)}
                    </div>
                </div>
            </div>
        );
    };

    // --- SCREEN 6: DEBRIEF (UPDATED GRAPH) ---
    const DebriefScreen = ({ sim, onRestart }) => {
        const { Button, Lucide, Card } = window;
        const { state } = sim; const { log, scenario, history, completedObjectives } = state; const chartRef = useRef(null);
        
        useEffect(() => { 
            if (!chartRef.current || !history.length) return; 
            if (!window.Chart) return;
            const ctx = chartRef.current.getContext('2d'); 
            if (window.myChart) window.myChart.destroy(); 
            
            const vitalData = {
                hr: history.map(h => ({x: h.time, y: h.hr})),
                bp: history.map(h => ({x: h.time, y: h.bp})),
                spo2: history.map(h => ({x: h.time, y: h.spo2})),
                etco2: history.map(h => ({x: h.time, y: h.etco2})),
                rr: history.map(h => ({x: h.time, y: h.rr}))
            };
            const interventionData = log.filter(l => l.type === 'action' || l.type === 'manual').map(l => ({ x: l.timeSeconds, y: 10, label: l.msg })); 

            window.myChart = new window.Chart(ctx, { 
                type: 'line', 
                data: { 
                    datasets: [ 
                        { label: 'HR', data: vitalData.hr, borderColor: '#ef4444', borderWidth: 2, pointRadius: 0, tension: 0.1, yAxisID: 'y' }, 
                        { label: 'Sys BP', data: vitalData.bp, borderColor: '#3b82f6', borderWidth: 2, pointRadius: 0, tension: 0.1, yAxisID: 'y' },
                        { label: 'SpO2', data: vitalData.spo2, borderColor: '#22d3ee', borderWidth: 2, pointRadius: 0, tension: 0.1, yAxisID: 'y' },
                        { label: 'RR', data: vitalData.rr, borderColor: '#facc15', borderWidth: 2, pointRadius: 0, tension: 0.1, yAxisID: 'y1' },
                        { label: 'ETCO2', data: vitalData.etco2, borderColor: '#fbbf24', borderWidth: 2, borderDash: [5, 5], pointRadius: 0, tension: 0.1, yAxisID: 'y1' },
                        { label: 'Interventions', data: interventionData, showLine: false, pointStyle: 'triangle', pointRadius: 6, backgroundColor: 'white', yAxisID: 'y' }
                    ] 
                }, 
                options: { 
                    responsive: true, maintainAspectRatio: false, interaction: { mode: 'nearest', intersect: false },
                    scales: { 
                        x: { type: 'linear', position: 'bottom', ticks: { callback: function(value) { return `${Math.floor(value/60).toString().padStart(2,'0')}:${(value%60).toString().padStart(2,'0')}`; } } },
                        y: { type: 'linear', display: true, position: 'left', min: 0, max: 220 },
                        y1: { type: 'linear', display: true, position: 'right', min: 0, max: 60, grid: { drawOnChartArea: false } }
                    },
                    plugins: { tooltip: { callbacks: { label: function(context) { if (context.dataset.label === 'Interventions') { return context.raw.label; } return `${context.dataset.label}: ${context.raw.y}`; } } } }
                } 
            }); 
            return () => { if (window.myChart) window.myChart.destroy(); }; 
        }, [history]);
        
        return (
            <div className="max-w-6xl mx-auto space-y-6 animate-fadeIn p-4 h-full overflow-y-auto">
                <div className="flex justify-between bg-slate-800 p-4 rounded-lg border border-slate-700">
                    <h2 className="text-2xl font-bold text-white">Simulation Debrief</h2>
                    <div className="flex gap-2"><Button onClick={onRestart} variant="primary"><Lucide icon="rotate-ccw"/> New Sim</Button></div>
                </div>
                <Card title="Physiological Trends & Interventions" icon="activity"><div className="bg-slate-900 p-2 rounded h-80 relative"><canvas ref={chartRef}></canvas></div></Card>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card title="Action Log" icon="clock"><div className="space-y-1 max-h-80 overflow-y-auto font-mono text-xs p-2">{log.map((l, i) => (<div key={i} className="flex gap-4 border-b border-slate-700 pb-1"><span className="text-sky-400 w-12 flex-shrink-0">{l.simTime}</span><span className={`${l.type==='action'?'text-emerald-400':l.type==='danger'?'text-red-400':'text-slate-300'}`}>{l.msg}</span></div>))}</div></Card>
                    <Card title="Learning Objectives" icon="check-square"><div className="p-2 space-y-2">{scenario?.instructorBrief?.learningObjectives?.map((obj, i) => (<div key={i} className="flex items-center gap-2 text-sm text-slate-300"><div className="w-4 h-4 border rounded border-slate-500 bg-slate-800"></div><span>{obj}</span></div>))}</div></Card>
                </div>
            </div>
        );
    };

    const MonitorContainer = ({ sessionID }) => { 
        const { Lucide } = window;
        const sim = useSimulation(null, true, sessionID); 
        if (!sessionID) return null; 
        if (!sim.state.vitals || sim.state.vitals.hr === undefined || sim.state.isFinished) {
            return (<div className="h-full flex flex-col items-center justify-center bg-black text-slate-500 gap-4 animate-fadeIn"><Lucide icon="wifi" className="w-12 h-12 animate-pulse text-sky-500" /><div className="text-xl font-mono tracking-widest">WAITING FOR CONTROLLER</div><div className="bg-slate-900 px-4 py-2 rounded border border-slate-800 font-bold text-sky-500">SESSION: {sessionID}</div></div>); 
        }
        return <MonitorScreen sim={sim} />; 
    };   
    const LiveSimContainer = ({ sim, view, setView, resumeData, onRestart, sessionID }) => { const { state, stop, reset } = sim; const { scenario } = state; useEffect(() => { if (view === 'resume' && resumeData) { sim.dispatch({ type: 'RESTORE_SESSION', payload: resumeData }); } else if (!scenario) { setView('setup'); } }, []); if (!scenario) return <div className="flex flex-col items-center justify-center h-full text-slate-400 animate-pulse">Loading...</div>; if (view === 'live' || view === 'resume') return <LiveSimScreen sim={sim} onFinish={() => { stop(); setView('debrief'); }} onBack={() => setView('briefing')} sessionID={sessionID} />; if (view === 'debrief') return <DebriefScreen sim={sim} onRestart={() => { reset(); setView('setup'); }} />; return null; };

    window.SetupScreen = SetupScreen; window.JoinScreen = JoinScreen; window.BriefingScreen = BriefingScreen; window.MonitorScreen = MonitorScreen; window.MonitorContainer = MonitorContainer; window.LiveSimContainer = LiveSimContainer; window.DebriefScreen = DebriefScreen;
})();
