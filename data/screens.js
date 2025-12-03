// data/screens.js
(() => {
    const { useState, useEffect, useRef } = React;
    const { 
        ALL_SCENARIOS, INTERVENTIONS, HUMAN_FACTOR_CHALLENGES,
        Button, Lucide, Card, VitalDisplay, ECGMonitor, InvestigationButton,
        generateHistory, estimateWeight, calculateWetflag, generateVbg 
    } = window;

    // --- SCREEN 1: SETUP ---
    const SetupScreen = ({ onGenerate, savedState, onResume, sessionID, onJoinClick }) => {
        const [mode, setMode] = useState('quick'); 
        
        // Library State
        const [selectedCat, setSelectedCat] = useState('Medical');
        const [selectedScen, setSelectedScen] = useState(null);
        const [previewDetails, setPreviewDetails] = useState(null);

        // Random/Builder State
        const [age, setAge] = useState('Any');
        const [acuity, setAcuity] = useState('Any'); 
        const [hf, setHf] = useState('hf0');
        
        useEffect(() => {
            if (selectedScen) {
                const patientAge = selectedScen.ageGenerator();
                const history = generateHistory(patientAge, selectedScen.category === 'Obstetrics & Gynae' ? 'Female' : 'Male');
                setPreviewDetails({ patientAge, history });
            } else { setPreviewDetails(null); }
        }, [selectedScen]);

        const handleGenerate = (base) => {
             const patientAge = previewDetails ? previewDetails.patientAge : base.ageGenerator();
             const history = previewDetails ? previewDetails.history : generateHistory(patientAge, base.category === 'Obstetrics & Gynae' ? 'Female' : 'Male');
             const weight = patientAge < 16 ? estimateWeight(patientAge) : null;
             const wetflag = weight ? calculateWetflag(patientAge, weight) : null;
             let finalVitals = { hr: 80, bpSys: 120, bpDia: 80, rr: 16, spO2: 98, temp: 37, gcs: 15, bm: 5, pupils: '3mm', ...base.vitalsMod };
             if (base.vitalsMod && base.vitalsMod.bpSys !== undefined && base.vitalsMod.bpDia === undefined) { finalVitals.bpDia = Math.floor(base.vitalsMod.bpSys * 0.65); }
             
             const generated = { 
                ...base, patientAge, 
                profile: base.patientProfileTemplate.replace('{age}', patientAge).replace('{sex}', 'Male'),
                vitals: finalVitals, pmh: base.pmh || history.pmh, dhx: base.dhx || history.dhx, allergies: base.allergies || history.allergies,
                vbg: generateVbg(base.vbgClinicalState),
                hf: HUMAN_FACTOR_CHALLENGES.find(h => h.id === hf) || HUMAN_FACTOR_CHALLENGES[0],
                weight, wetflag
             };
             onGenerate(generated, {});
        };

        const filteredScenarios = ALL_SCENARIOS.filter(s => s.category === selectedCat);

        return (
            <div className="max-w-6xl mx-auto p-4 h-full overflow-y-auto space-y-6">
                <div className="bg-slate-900 border border-slate-700 p-4 rounded-lg flex flex-col md:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="bg-sky-900/30 p-2 rounded text-center border border-sky-500/50"><div className="text-[10px] uppercase text-sky-400 font-bold">Session Code</div><div className="text-2xl font-mono font-bold text-white tracking-widest">{sessionID}</div></div>
                        <div className="text-sm text-slate-400">Share code to connect monitors.</div>
                    </div>
                    <Button onClick={onJoinClick} variant="outline" className="h-10 text-xs">Use as Monitor</Button>
                </div>

                {savedState && (<div className="bg-emerald-900/30 border border-emerald-500 p-4 rounded-lg flex items-center justify-between"><div><h3 className="font-bold text-emerald-400">Previous Session Found</h3><p className="text-sm text-slate-300">Resume {savedState.scenario.title}?</p></div><Button onClick={onResume} variant="success">Resume</Button></div>)}
                
                <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-xl">
                    <div className="flex gap-4 mb-6 border-b border-slate-700 pb-2">
                        {['Quick Start', 'Library'].map(m => (
                            <button key={m} onClick={() => setMode(m === 'Quick Start' ? 'quick' : 'library')} className={`text-sm font-bold uppercase pb-2 ${mode === (m === 'Quick Start' ? 'quick' : 'library') ? 'text-sky-400 border-b-2 border-sky-400' : 'text-slate-500'}`}>{m}</button>
                        ))}
                    </div>

                    {mode === 'quick' && (
                        <div className="space-y-4 max-w-lg mx-auto">
                            <div className="grid grid-cols-1 gap-4">
                                <div><label className="text-xs uppercase text-slate-500 font-bold">Age Group</label><select value={age} onChange={e=>setAge(e.target.value)} className="w-full bg-slate-700 rounded p-3 text-sm text-white border border-slate-600"><option value="Any">Any</option><option value="Adult">Adult</option><option value="Paediatric">Paediatric</option><option value="Elderly">Elderly</option></select></div>
                                <div><label className="text-xs uppercase text-slate-500 font-bold">Acuity</label><select value={acuity} onChange={e=>setAcuity(e.target.value)} className="w-full bg-slate-700 rounded p-3 text-sm text-white border border-slate-600"><option value="Any">Any</option><option value="Majors">Majors</option><option value="Resus">Resus</option></select></div>
                                <Button onClick={() => {
                                    let pool = ALL_SCENARIOS.filter(s => (age === 'Any' || s.ageRange === age) && (acuity === 'Any' || s.acuity === acuity));
                                    if(pool.length===0) return alert("No match");
                                    handleGenerate(pool[Math.floor(Math.random()*pool.length)]);
                                }} className="w-full py-4 text-lg">Generate Random Sim</Button>
                            </div>
                        </div>
                    )}

                    {mode === 'library' && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[60vh]">
                            <div className="space-y-2 overflow-y-auto">
                                <h3 className="text-xs font-bold text-slate-500 uppercase">1. Category</h3>
                                {['Medical', 'Trauma', 'Cardiac Arrest', 'Paediatric', 'Obstetrics & Gynae', 'Toxicology', 'Psychiatric', 'Elderly'].map(cat => (
                                    <button key={cat} onClick={() => {setSelectedCat(cat); setSelectedScen(null);}} className={`w-full text-left px-4 py-3 rounded border transition-colors ${selectedCat === cat ? 'bg-sky-600 border-sky-500 text-white shadow-lg' : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'}`}>{cat}</button>
                                ))}
                            </div>
                            <div className="space-y-2 overflow-y-auto pr-2">
                                <h3 className="text-xs font-bold text-slate-500 uppercase">2. Select Scenario</h3>
                                {filteredScenarios.map(s => (
                                    <button key={s.id} onClick={() => setSelectedScen(s)} className={`w-full text-left px-4 py-3 rounded border transition-colors ${selectedScen?.id === s.id ? 'bg-emerald-600 border-emerald-500 text-white shadow-lg' : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'}`}>
                                        <div className="font-bold">{s.title}</div>
                                        <div className="text-xs opacity-70">{s.acuity} • {s.ageRange}</div>
                                    </button>
                                ))}
                            </div>
                            <div className="space-y-4 bg-slate-900/50 p-4 rounded border border-slate-700 overflow-y-auto">
                                <h3 className="text-xs font-bold text-slate-500 uppercase">3. Preview</h3>
                                {selectedScen && previewDetails ? (
                                    <div className="animate-fadeIn space-y-4">
                                        <div><h2 className="text-xl font-bold text-white">{selectedScen.title}</h2><p className="text-sm text-slate-400">{selectedScen.patientProfileTemplate}</p></div>
                                        <div className="bg-black/20 p-2 rounded text-xs space-y-1">
                                            <p><strong className="text-slate-500">Age:</strong> {previewDetails.patientAge}</p>
                                            <p><strong className="text-slate-500">PMH:</strong> {selectedScen.pmh ? selectedScen.pmh.join(", ") : previewDetails.history.pmh.join(", ")}</p>
                                            <p><strong className="text-slate-500">Meds:</strong> {selectedScen.dhx ? selectedScen.dhx.join(", ") : previewDetails.history.dhx.join(", ")}</p>
                                            <p><strong className="text-slate-500">Allergies:</strong> <span className="text-red-400">{selectedScen.allergies ? selectedScen.allergies.join(", ") : previewDetails.history.allergies.join(", ")}</span></p>
                                        </div>
                                        <div className="p-2 bg-slate-800 rounded border border-slate-600 text-xs text-slate-300">
                                            <strong className="text-sky-400 block mb-1">Progression</strong>
                                            {selectedScen.instructorBrief.progression}
                                        </div>
                                        <Button onClick={() => handleGenerate(selectedScen)} className="w-full py-3 text-lg shadow-sky-500/20">Review & Start</Button>
                                    </div>
                                ) : <div className="flex items-center justify-center h-40 text-slate-500 italic">Select a scenario to view details.</div>}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // --- SCREEN 2: JOIN ---
    const JoinScreen = ({ onJoin }) => {
        const [code, setCode] = useState("");
        return (<div className="flex flex-col items-center justify-center h-full bg-slate-900 text-white p-4"><div className="w-full max-w-md space-y-6 text-center"><div className="flex justify-center mb-4"><img src="https://iili.io/KGQOvkl.md.png" alt="Logo" className="h-20 object-contain" /></div><h1 className="text-3xl font-bold text-sky-400">Sim Monitor</h1><p className="text-slate-400">Enter the Session Code</p><input type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="e.g. A1B2" className="w-full bg-slate-800 border-2 border-slate-600 rounded-lg p-4 text-center text-3xl font-mono tracking-widest uppercase text-white outline-none" maxLength={4}/><Button onClick={() => onJoin(code)} disabled={code.length < 4} className="w-full py-4 text-xl">Connect</Button></div></div>);
    };

    // --- SCREEN 3: BRIEFING ---
    const BriefingScreen = ({ scenario, onStart, onBack }) => (
        <div className="max-w-5xl mx-auto space-y-6 animate-fadeIn p-4 overflow-y-auto h-full">
            <div className="bg-slate-800 border-l-4 border-sky-500 shadow-lg rounded-lg overflow-hidden">
                <div className="p-6 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
                    <div>
                        <h2 className="text-3xl font-bold text-white mb-2">{scenario.title}</h2>
                        <div className="flex gap-2">
                            <span className="bg-slate-700 text-sky-300 text-xs px-2 py-1 rounded border border-slate-600">{scenario.category}</span>
                            <span className="bg-slate-700 text-emerald-300 text-xs px-2 py-1 rounded border border-slate-600">{scenario.ageRange}</span>
                            <span className="bg-slate-700 text-amber-300 text-xs px-2 py-1 rounded border border-slate-600">{scenario.acuity}</span>
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="text-[10px] text-slate-500 uppercase font-bold">Initial GCS</div>
                        <div className="text-4xl font-mono font-bold text-white">{scenario.vitals.gcs}</div>
                    </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6">
                    <div className="space-y-6">
                        <div className="bg-slate-900/50 p-4 rounded border border-slate-700">
                            <h3 className="text-sm font-bold text-sky-400 uppercase mb-2 border-b border-slate-700 pb-1">Patient Brief</h3>
                            <p className="text-lg leading-relaxed text-slate-200 mb-4">{scenario.profile}</p>
                            <div className="space-y-2 text-sm">
                                <div className="flex"><span className="w-24 text-slate-500 font-bold">PMH:</span><span className="text-slate-300">{scenario.pmh ? scenario.pmh.join(", ") : 'Nil'}</span></div>
                                <div className="flex"><span className="w-24 text-slate-500 font-bold">Rx:</span><span className="text-slate-300">{scenario.dhx ? scenario.dhx.join(", ") : 'Nil'}</span></div>
                                <div className="flex"><span className="w-24 text-slate-500 font-bold">Allergies:</span><span className="text-red-400 font-bold">{scenario.allergies ? scenario.allergies.join(", ") : 'NKDA'}</span></div>
                            </div>
                        </div>
                        
                        <div className="bg-slate-900/50 p-4 rounded border border-slate-700">
                            <h3 className="text-sm font-bold text-purple-400 uppercase mb-2 border-b border-slate-700 pb-1">Required Equipment</h3>
                            <div className="flex flex-wrap gap-2">
                                {scenario.equipment && scenario.equipment.map((item, i) => (
                                    <span key={i} className="text-xs bg-slate-700 text-slate-200 px-2 py-1 rounded border border-slate-600">{item}</span>
                                ))}
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
                        <div className="p-3 bg-slate-900/50 rounded border border-slate-600">
                            <h4 className="text-sm font-bold text-slate-400 uppercase mb-1">Guidelines & Resources</h4>
                            <div className="flex flex-col gap-1">
                                {scenario.learningLinks && scenario.learningLinks.map((link, i) => (
                                    <a key={i} href={link.url} target="_blank" className="flex items-center gap-2 text-xs text-sky-400 hover:underline">
                                        <Lucide icon="external-link" className="w-3 h-3"/> {link.label}
                                    </a>
                                ))}
                            </div>
                        </div>
                        <div className="p-3 bg-indigo-900/20 rounded border border-indigo-600/30">
                            <h4 className="text-sm font-bold text-indigo-400 uppercase mb-1">Debrief Points</h4>
                            <ul className="list-disc pl-4 text-sm text-slate-300 space-y-1">
                                {scenario.instructorBrief.debriefPoints && scenario.instructorBrief.debriefPoints.map((l, i) => <li key={i}>{l}</li>)}
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

    // --- SCREEN 4: LIVE SIM CONTROLLER ---
    const LiveSimScreen = ({ sim, onFinish, onBack, sessionID }) => {
        const { state, start, pause, stop, applyIntervention, addLogEntry, manualUpdateVital, triggerArrest, triggerROSC, revealInvestigation, nextCycle, enableAudio, speak, startTrend } = sim;
        const { scenario, time, cycleTimer, isRunning, vitals, prevVitals, log, flash, activeInterventions, interventionCounts, activeDurations, isMuted, rhythm, etco2Enabled, queuedRhythm, cprInProgress, nibp, audioOutput } = state;
        
        const [activeTab, setActiveTab] = useState("Common");
        const [customLog, setCustomLog] = useState("");
        const [searchResults, setSearchResults] = useState([]);
        const [arrestMode, setArrestMode] = useState(false);
        const [expandRhythm, setExpandRhythm] = useState(false);
        const [customSpeech, setCustomSpeech] = useState("");
        const [showDrugCalc, setShowDrugCalc] = useState(false);
        const [drugCalc, setDrugCalc] = useState({ drug: 'Salbutamol', dose: '', weight: scenario.weight || 70 });
        
        // Modal State for Vital Control
        const [modalVital, setModalVital] = useState(null); // 'hr', 'bp', 'spO2', 'rr', 'temp', 'gcs', 'bm', 'pupils'
        const [modalTarget, setModalTarget] = useState("");
        const [modalTarget2, setModalTarget2] = useState(""); // For BP Dia

        // DRUG CATEGORIES
        const drugCats = {
            "Arrest": ['AdrenalineIV', 'Amiodarone', 'Calcium', 'MagSulph', 'SodiumBicarb', 'Atropine'],
            "Sedation": ['Midazolam', 'Lorazepam', 'Ketamine', 'Morphine', 'Fentanyl', 'Roc', 'Sux', 'Propofol'],
            "Trauma": ['TXA', 'Blood', 'Fluids'],
            "General": ['Paracetamol', 'Ibuprofen', 'Ondansetron', 'Antibiotics', 'Hydrocortisone', 'Dexamethasone', 'Nebs', 'Salbutamol']
        };

        const mapVoice = (txt) => {
            if (txt.includes('Cough')) return 'Cough, cough, cough';
            if (txt.includes('Scream')) return 'Ahhhhh! Help me!';
            if (txt.includes('Moan')) return 'Ohhhhhh...';
            return txt.replace(/\*/g, '');
        };

        useEffect(() => { if (customLog.length > 1) { const results = Object.keys(INTERVENTIONS).filter(key => (key + INTERVENTIONS[key].label).toLowerCase().includes(customLog.toLowerCase())); setSearchResults(results); } else { setSearchResults([]); } }, [customLog]);
        const handleSearchSelect = (key) => { applyIntervention(key); setCustomLog(""); setSearchResults([]); };
        
        const getInterventionsByCat = (cat) => {
            if (cat === 'Handover' || cat === 'Voice') return [];
            let keys = [];
            if (cat === 'Common') keys = ['Obs', 'Oxygen', 'IV Access', 'Fluids', 'Analgesia', 'Antiemetic', 'Antibiotics', 'Nebs', 'AdrenalineIM', 'Blood', 'TXA']; 
            else if (cat === 'Drugs') keys = Object.keys(INTERVENTIONS).filter(key => INTERVENTIONS[key].category === 'Drugs'); // Fallback
            else keys = Object.keys(INTERVENTIONS).filter(key => INTERVENTIONS[key].category === cat);
            return keys.sort((a, b) => INTERVENTIONS[a].label.localeCompare(INTERVENTIONS[b].label));
        };

        const formatTime = (s) => `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
        const toggleCPR = () => { sim.dispatch({ type: 'TOGGLE_CPR', payload: !cprInProgress }); addLogEntry(!cprInProgress ? 'CPR Started' : 'CPR Stopped', 'action'); };
        const handleShock = () => { applyIntervention('Defib'); if (!cprInProgress) toggleCPR(); };
        const hasMonitoring = activeInterventions.has('Obs'); const hasArtLine = activeInterventions.has('ArtLine');
        const generateSBAR = () => `S: ${scenario.title}.\nB: ${scenario.patientProfileTemplate.replace('{age}', scenario.patientAge)}.\nA: HR ${vitals.hr}, BP ${vitals.bpSys}/${vitals.bpDia}, SpO2 ${vitals.spO2}%.\nR: Review.`;
        const getCatColor = (cat) => { if (cat === 'Airway') return 'bg-sky-700 border-sky-500'; if (cat === 'Breathing') return 'bg-cyan-700 border-cyan-500'; if (cat === 'Circulation') return 'bg-red-700 border-red-500'; if (cat === 'Drugs') return 'bg-yellow-700 border-yellow-500'; if (cat === 'Procedures') return 'bg-emerald-700 border-emerald-500'; return 'bg-slate-700 border-slate-500'; };

        // --- CONTROL MODAL LOGIC ---
        const openVitalControl = (key) => {
            setModalVital(key);
            setModalTarget(vitals[key === 'bp' ? 'bpSys' : key]);
            if (key === 'bp') setModalTarget2(vitals.bpDia);
        };
        const applyVitalUpdate = (duration) => {
            const targets = {};
            if (modalVital === 'bp') { targets.bpSys = parseFloat(modalTarget); targets.bpDia = parseFloat(modalTarget2); }
            else { targets[modalVital] = (modalVital === 'pupils' || modalVital === 'gcs') ? modalTarget : parseFloat(modalTarget); }
            
            if (duration === 0) {
                // Immediate
                Object.keys(targets).forEach(k => manualUpdateVital(k, targets[k]));
            } else {
                // Trend
                startTrend(targets, duration);
            }
            setModalVital(null);
        };

        return (
            <div className={`h-full overflow-hidden flex flex-col p-2 bg-slate-900 relative ${flash === 'red' ? 'flash-red' : (flash === 'green' ? 'flash-green' : '')}`}>
                
                {/* --- HEADER --- */}
                <div className="flex justify-between items-center bg-slate-800 p-2 rounded mb-2 border border-slate-700">
                    <div className="flex gap-2">
                        <Button variant="secondary" onClick={onBack} className="h-8 px-2"><Lucide icon="arrow-left"/> Back</Button>
                        {!isRunning ? <Button variant="success" onClick={start} className="h-8 px-4 font-bold"><Lucide icon="play"/> START</Button> : <Button variant="danger" onClick={pause} className="h-8 px-4"><Lucide icon="pause"/> PAUSE</Button>}
                        <Button variant="outline" onClick={() => window.open(window.location.href.split('?')[0] + '?mode=monitor&session=' + sessionID, '_blank', 'popup=yes')} className="h-8 px-2 text-xs"><Lucide icon="external-link"/> Monitor</Button>
                        <Button variant="primary" onClick={onFinish} className="h-8 px-4"><Lucide icon="square"/> FINISH</Button>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex bg-slate-900 rounded p-1 border border-slate-600">
                            {['monitor', 'controller', 'both'].map(o => (
                                <button key={o} onClick={() => sim.dispatch({type: 'SET_AUDIO_OUTPUT', payload: o})} className={`px-2 py-1 text-[9px] uppercase font-bold rounded ${audioOutput === o ? 'bg-sky-600 text-white' : 'text-slate-500'}`}>{o}</button>
                            ))}
                        </div>
                        <div className="text-right"><div className="text-[10px] text-slate-400 uppercase">Sim Time</div><div className="font-mono text-xl font-bold text-emerald-400 leading-none">{formatTime(time)}</div></div>
                    </div>
                </div>

                {/* --- ARREST OVERLAY --- */}
                {arrestMode && (
                    <div className="lg:col-span-3 bg-red-900/20 border border-red-500 p-4 rounded-lg flex flex-col md:flex-row gap-4 animate-fadeIn mb-2 shadow-2xl">
                        <div className="flex-1 flex flex-col justify-center items-center bg-slate-900/80 p-4 rounded border border-red-500/50">
                            <h3 className="text-red-500 font-bold uppercase tracking-widest mb-1">Cycle Timer</h3>
                            <div className={`text-5xl font-mono font-bold ${cycleTimer > 120 ? 'text-red-500 animate-pulse' : 'text-white'}`}>{formatTime(cycleTimer)}</div>
                            <div className="flex gap-2 mt-2">
                                <Button variant="secondary" onClick={() => sim.dispatch({type: 'RESET_CYCLE_TIMER'})} className="h-8 text-xs">Reset</Button>
                                <Button variant="secondary" onClick={() => {
                                    const remaining = Math.max(0, 120 - cycleTimer);
                                    if(remaining > 0) sim.dispatch({type: 'FAST_FORWARD', payload: remaining});
                                    sim.dispatch({type: 'RESET_CYCLE_TIMER'});
                                    addLogEntry("Cycle Skipped / Finished", "system");
                                }} className="h-8 text-xs">Finish Cycle</Button>
                            </div>
                        </div>
                        <div className="flex-[3] grid grid-cols-2 md:grid-cols-4 gap-3">
                            <Button onClick={toggleCPR} variant={cprInProgress ? "warning" : "danger"} className="h-16 text-xl font-bold border-4 border-double">{cprInProgress ? "STOP CPR" : "START CPR"}</Button>
                            <Button onClick={handleShock} variant="warning" className="h-16 text-xl font-bold flex flex-col"><Lucide icon="zap" /> SHOCK</Button>
                            <Button onClick={() => applyIntervention('AdrenalineIV')} variant={interventionCounts['AdrenalineIV'] > 0 ? "success" : "outline"} className="h-16 font-bold flex flex-col"><span>Adrenaline</span><span className="text-[10px] opacity-70">1mg 1:10k</span>{interventionCounts['AdrenalineIV'] > 0 && <span className="absolute top-1 right-1 bg-white text-black text-[9px] px-1 rounded-full">x{interventionCounts['AdrenalineIV']}</span>}</Button>
                            <Button onClick={() => applyIntervention('Amiodarone')} variant={interventionCounts['Amiodarone'] > 0 ? "success" : "outline"} className="h-16 font-bold flex flex-col"><span>Amiodarone</span><span className="text-[10px] opacity-70">300mg</span>{interventionCounts['Amiodarone'] > 0 && <span className="absolute top-1 right-1 bg-white text-black text-[9px] px-1 rounded-full">x{interventionCounts['Amiodarone']}</span>}</Button>
                            <Button onClick={() => {applyIntervention('Lucas'); if(!cprInProgress) toggleCPR();}} variant={activeInterventions.has('Lucas') ? "success" : "secondary"} className="h-12 border border-slate-600">Mechanical CPR</Button>
                            <Button onClick={() => applyIntervention('Bagging')} variant={activeInterventions.has('Bagging') ? "success" : "secondary"} className="h-12 border border-slate-600">BVM Ventilation</Button>
                            <Button onClick={() => applyIntervention('RSI')} variant={activeInterventions.has('RSI') ? "success" : "secondary"} className="h-12 border border-slate-600">Secure Airway</Button>
                            <Button onClick={() => setShowDrugCalc(true)} variant="secondary" className="h-12 border border-slate-600">Drugs...</Button>
                        </div>
                        <div className="flex-1 flex flex-col gap-2"><h4 className="text-xs font-bold text-red-400 uppercase">4 H's & 4 T's</h4><div className="grid grid-cols-2 gap-1 text-[10px] text-slate-300"><div>Hypoxia</div><div>Thrombosis</div><div>Hypovolaemia</div><div>Tension #</div><div>Hyper/Hypo-K</div><div>Tamponade</div><div>Hypothermia</div><div>Toxins</div></div><Button onClick={() => setArrestMode(false)} variant="secondary" className="mt-auto">Exit Arrest Mode</Button></div>
                    </div>
                )}

                <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-2 overflow-hidden min-h-0">
                    {/* --- LEFT COLUMN: MONITOR & INFO --- */}
                    <div className="lg:col-span-4 flex flex-col gap-2 overflow-y-auto">
                        <Card className="bg-black border-slate-800 flex-shrink-0">
                             <ECGMonitor rhythmType={rhythm} hr={vitals.hr} rr={vitals.rr} spO2={vitals.spO2} isPaused={!isRunning} showEtco2={etco2Enabled} pathology={scenario?.deterioration?.type} showTraces={hasMonitoring} showArt={hasArtLine} isCPR={cprInProgress} className="h-32"/>
                             <div className="grid grid-cols-4 gap-1 p-1 bg-black">
                                 <VitalDisplay label="HR" value={vitals.hr} onClick={()=>openVitalControl('hr')} visible={hasMonitoring} />
                                 <VitalDisplay label="BP" value={vitals.bpSys} value2={vitals.bpDia} onClick={()=>openVitalControl('bp')} visible={hasMonitoring} />
                                 <VitalDisplay label="SpO2" value={vitals.spO2} onClick={()=>openVitalControl('spO2')} visible={hasMonitoring} />
                                 <VitalDisplay label="RR" value={vitals.rr} onClick={()=>openVitalControl('rr')} visible={hasMonitoring} />
                             </div>
                             <div className="grid grid-cols-4 gap-1 p-1 bg-black border-t border-slate-900">
                                 <VitalDisplay label="Temp" value={vitals.temp} unit="°C" onClick={()=>openVitalControl('temp')} visible={true} />
                                 <VitalDisplay label="BM" value={vitals.bm} unit="mmol" onClick={()=>openVitalControl('bm')} visible={true} />
                                 <VitalDisplay label="GCS" value={vitals.gcs} unit="" onClick={()=>openVitalControl('gcs')} visible={true} />
                                 <VitalDisplay label="Pupils" value={vitals.pupils} unit="" isText={true} onClick={()=>openVitalControl('pupils')} visible={true} />
                             </div>
                        </Card>
                        
                        <Card title="Patient Info" icon="user" collapsible={true} className="flex-shrink-0 bg-slate-800">
                            <div className="text-xs space-y-1 mb-2">
                                <p><strong className="text-slate-400">Name:</strong> {scenario.title}</p>
                                <p><strong className="text-slate-400">Details:</strong> {scenario.patientAge}y Male</p>
                                <p><strong className="text-slate-400">Allergies:</strong> <span className="text-red-400">{scenario.allergies ? scenario.allergies.join(", ") : 'NKDA'}</span></p>
                            </div>
                            <div className="grid grid-cols-3 gap-1">
                                {['ECG', 'VBG', 'X-ray', 'POCUS', 'CT', 'Urine'].map(t => (<InvestigationButton key={t} type={t} icon="activity" label={t} isRevealed={state.investigationsRevealed[t]} isLoading={state.loadingInvestigations[t]} revealInvestigation={revealInvestigation} isRunning={isRunning} scenario={scenario}/>))}
                            </div>
                        </Card>

                        <div className="bg-slate-800 p-2 rounded border border-slate-600 relative z-10">
                            <h4 className="text-[10px] font-bold text-green-400 uppercase mb-1">Rhythm & Arrest</h4>
                            <div className="grid grid-cols-2 gap-1 mb-2">
                                <Button onClick={triggerArrest} variant="danger" className="h-8 text-xs">VF Arrest</Button>
                                <Button onClick={triggerROSC} variant="success" className="h-8 text-xs">ROSC</Button>
                            </div>
                            <Button onClick={() => setExpandRhythm(!expandRhythm)} variant="secondary" className="w-full h-8 text-xs justify-between">{rhythm} <Lucide icon="chevron-down" className="w-3 h-3"/></Button>
                            {expandRhythm && (<div className="absolute top-full left-0 w-full bg-slate-800 border border-slate-500 rounded shadow-xl max-h-60 overflow-y-auto mt-1 z-50">{['Sinus Rhythm', 'Sinus Tachycardia', 'Sinus Bradycardia', 'AF', 'SVT', 'VT', 'VF', 'Asystole', 'PEA', 'STEMI', '1st Deg Block', '3rd Deg Block'].map(r => (<button key={r} onClick={() => {sim.dispatch({type: 'UPDATE_RHYTHM', payload: r}); setExpandRhythm(false);}} className="block w-full text-left px-3 py-2 text-xs text-white hover:bg-sky-600 border-b border-slate-700">{r}</button>))}</div>)}
                            <Button onClick={() => setArrestMode(!arrestMode)} variant={arrestMode ? "danger" : "outline"} className="w-full h-8 mt-2 text-xs">{arrestMode ? "Close Arrest Panel" : "Open Arrest Panel"}</Button>
                        </div>
                    </div>
                    
                    {/* --- RIGHT COLUMN: ACTIONS --- */}
                    <div className="lg:col-span-8 flex flex-col bg-slate-800 rounded border border-slate-700 overflow-hidden">
                        <div className="flex overflow-x-auto bg-slate-900 border-b border-slate-700 no-scrollbar">{['Common', 'Airway', 'Breathing', 'Circulation', 'Drugs', 'Procedures', 'Voice', 'Handover'].map(cat => (<button key={cat} onClick={() => setActiveTab(cat)} className={`px-4 py-3 text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${activeTab === cat ? 'bg-slate-800 text-sky-400 border-t-2 border-sky-400' : 'text-slate-500 hover:text-slate-300'}`}>{cat}</button>))}</div>
                        <div className="flex-1 p-2 overflow-y-auto bg-slate-800 relative">
                            
                            {/* Recommended Actions */}
                            {scenario.recommendedActions && (
                                <div className="mb-2 p-2 bg-sky-900/20 border border-sky-600/30 rounded">
                                    <h4 className="text-[10px] font-bold text-sky-400 uppercase mb-1">Recommended Actions</h4>
                                    <div className="flex flex-wrap gap-1">
                                        {scenario.recommendedActions.map(key => (
                                            <Button key={key} onClick={() => applyIntervention(key)} variant={activeInterventions.has(key) ? "success" : "outline"} className="h-6 text-[10px] px-2">{INTERVENTIONS[key]?.label || key}</Button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {activeTab === 'Handover' ? (
                                <div className="space-y-4 p-2"><div className="bg-slate-900 p-4 rounded border border-slate-600 font-mono text-sm text-green-400 whitespace-pre-wrap">{generateSBAR()}</div><div className="flex gap-2"><Button onClick={() => speak(generateSBAR())} variant="secondary">Read Aloud</Button><Button onClick={() => navigator.clipboard.writeText(generateSBAR())} variant="outline">Copy</Button></div></div>
                            ) : activeTab === 'Voice' ? (
                                <div className="space-y-4 p-4">
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">{["I can't breathe", "My chest hurts", "I feel sick", "My head hurts", "I'm scared", "Can I have some water?", "Yes", "No", "I don't know", "*Coughing*", "*Screaming*", "*Moaning*"].map(txt => (<Button key={txt} onClick={() => speak(mapVoice(txt))} variant="secondary" className="h-12 text-xs">{txt}</Button>))}</div>
                                    <div className="flex gap-2 pt-4 border-t border-slate-700"><input type="text" value={customSpeech} onChange={e => setCustomSpeech(e.target.value)} placeholder="Type custom phrase..." className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 text-white" /><Button onClick={() => { speak(customSpeech); setCustomSpeech(""); }}>Speak</Button></div>
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
                                                        <button key={key} onClick={() => applyIntervention(key)} className={`relative h-14 p-2 rounded text-left bg-slate-700 hover:bg-slate-600 border border-slate-600 flex flex-col justify-between overflow-hidden`}><span className="text-xs font-bold leading-tight">{action.label}</span>{count > 0 && <span className="absolute top-1 right-1 bg-white text-black text-[9px] font-bold px-1.5 rounded-full">x{count}</span>}</button>
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
                                        const isActive = activeInterventions.has(key);
                                        const count = interventionCounts[key] || 0;
                                        let btnClass = isActive ? "bg-emerald-900/40 border border-emerald-500 text-emerald-100" : `opacity-90 hover:opacity-100 ${getCatColor(activeTab)}`;
                                        return (
                                            <button key={key} onClick={() => applyIntervention(key)} disabled={!isRunning} className={`relative h-16 p-2 rounded text-left transition-all active:scale-95 flex flex-col justify-between overflow-hidden shadow-sm ${btnClass}`}><span className="text-xs font-bold leading-tight">{action.label}</span><div className="flex justify-between items-end w-full"><span className="text-[10px] opacity-70 italic truncate">{action.category}</span>{count > 0 && action.type !== 'continuous' && <span className="bg-white text-black text-[9px] font-bold px-1.5 rounded-full">x{count}</span>}</div>{activeDurations[key] && (<div className="absolute bottom-0 left-0 h-1 bg-emerald-400 transition-all duration-1000" style={{width: `${Math.max(0, 100 - ((time - activeDurations[key].startTime)/activeDurations[key].duration*100))}%`}}></div>)}</button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        <div className="bg-slate-900 p-2 border-t border-slate-700 flex gap-2"><input type="text" className="bg-slate-800 border border-slate-600 rounded px-3 text-xs flex-1 text-white" placeholder="Search..." value={customLog} onChange={e=>setCustomLog(e.target.value)} onKeyDown={e => e.key === 'Enter' && (addLogEntry(customLog, 'manual') || setCustomLog(""))} /><Button onClick={() => {sim.dispatch({type: 'TRIGGER_IMPROVE'}); addLogEntry("Patient Improving", "success")}} className="h-8 text-xs px-2 bg-emerald-900 border border-emerald-500 text-emerald-100">Improve</Button><Button onClick={() => {sim.dispatch({type: 'TRIGGER_DETERIORATE'}); addLogEntry("Patient Deteriorating", "danger")}} className="h-8 text-xs px-2 bg-red-900 border border-red-500 text-red-100">Worsen</Button></div>
                    </div>
                </div>

                {/* --- VITAL CONTROL MODAL --- */}
                {modalVital && (
                    <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn">
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-sm shadow-2xl">
                            <h3 className="text-lg font-bold text-white mb-4 uppercase tracking-wider">Control: {modalVital}</h3>
                            <div className="space-y-4">
                                <div><label className="text-xs text-slate-400 font-bold uppercase">Target Value</label><input type={modalVital === 'pupils' ? "text" : "number"} value={modalTarget} onChange={e=>setModalTarget(e.target.value)} className="w-full bg-slate-900 border border-slate-500 rounded p-3 text-xl font-mono text-white text-center font-bold" autoFocus /></div>
                                {modalVital === 'bp' && <div><label className="text-xs text-slate-400 font-bold uppercase">Diastolic</label><input type="number" value={modalTarget2} onChange={e=>setModalTarget2(e.target.value)} className="w-full bg-slate-900 border border-slate-500 rounded p-3 text-xl font-mono text-white text-center font-bold" /></div>}
                                
                                <div className="grid grid-cols-2 gap-2">
                                    <Button onClick={()=>applyVitalUpdate(0)} variant="danger">Instant</Button>
                                    <Button onClick={()=>applyVitalUpdate(30)} variant="secondary">30 Secs</Button>
                                    <Button onClick={()=>applyVitalUpdate(120)} variant="secondary">2 Mins</Button>
                                    <Button onClick={()=>applyVitalUpdate(300)} variant="secondary">5 Mins</Button>
                                </div>
                                <Button onClick={()=>setModalVital(null)} variant="outline" className="w-full mt-2">Cancel</Button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const MonitorScreen = ({ sim }) => {
        const { state, enableAudio, playNibp } = sim;
        const { vitals, prevVitals, rhythm, flash, activeInterventions, etco2Enabled, cprInProgress, scenario, nibp } = state;
        const hasMonitoring = activeInterventions.has('Obs'); const hasArtLine = activeInterventions.has('ArtLine');
        const [audioEnabled, setAudioEnabled] = useState(false);
        const wakeLockRef = useRef(null);

        useEffect(() => { const requestWakeLock = async () => { if ('wakeLock' in navigator) { try { wakeLockRef.current = await navigator.wakeLock.request('screen'); } catch (err) { console.log(err); } } }; requestWakeLock(); const handleVis = () => { if (document.visibilityState === 'visible') requestWakeLock(); }; document.addEventListener('visibilitychange', handleVis); return () => { if(wakeLockRef.current) wakeLockRef.current.release(); document.removeEventListener('visibilitychange', handleVis); }; }, []);
        useEffect(() => { if (nibp.lastTaken && audioEnabled) playNibp(); }, [nibp.lastTaken]);

        return (
            <div className={`h-full w-full flex flex-col bg-black text-white p-2 md:p-4 transition-colors duration-200 ${flash === 'red' ? 'flash-red' : (flash === 'green' ? 'flash-green' : '')}`}>
                {!audioEnabled && (<div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => { enableAudio(); setAudioEnabled(true); }}><div className="bg-slate-800 border border-sky-500 p-6 rounded-lg shadow-2xl animate-bounce cursor-pointer text-center"><Lucide icon="volume-2" className="w-12 h-12 text-sky-400 mx-auto mb-2"/><h2 className="text-xl font-bold text-white">Tap to Enable Sound</h2></div></div>)}
                <div className="flex-grow relative border border-slate-800 rounded mb-2 overflow-hidden flex flex-col"><ECGMonitor rhythmType={rhythm} hr={vitals.hr} rr={vitals.rr} spO2={vitals.spO2} isPaused={false} showEtco2={etco2Enabled} pathology={scenario?.deterioration?.type || 'normal'} showTraces={hasMonitoring} showArt={hasArtLine} isCPR={cprInProgress} className="h-full" rhythmLabel="ECG" /></div>
                <div className="flex-none grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 h-auto md:h-[30vh]">
                    <VitalDisplay label="Heart Rate" value={vitals.hr} prev={prevVitals.hr} unit="bpm" lowIsBad={false} onUpdate={() => {}} alert={vitals.hr > 140 || vitals.hr < 40} visible={hasMonitoring} isMonitor={true} hideTrends={true} />
                    {hasArtLine ? (<VitalDisplay label="ABP" value={vitals.bpSys} value2={vitals.bpDia} prev={prevVitals.bpSys} unit="mmHg" onUpdate={() => {}} alert={vitals.bpSys < 90} visible={true} isMonitor={true} hideTrends={true} />) : (<VitalDisplay label="NIBP" value={nibp.sys || '?'} value2={nibp.dia || '?'} unit="mmHg" onUpdate={() => {}} alert={nibp.sys && nibp.sys < 90} visible={hasMonitoring} isMonitor={true} isNIBP={true} lastNIBP={nibp.lastTaken} hideTrends={true} />)}
                    <VitalDisplay label="SpO2" value={vitals.spO2} prev={prevVitals.spO2} unit="%" onUpdate={() => {}} alert={vitals.spO2 < 90} visible={hasMonitoring} isMonitor={true} hideTrends={true} />
                    <div className="grid grid-rows-2 gap-2 md:gap-4"><VitalDisplay label="Resp Rate" value={vitals.rr} prev={prevVitals.rr} unit="/min" lowIsBad={false} onUpdate={() => {}} alert={vitals.rr > 30 || vitals.rr < 8} visible={hasMonitoring} isMonitor={true} hideTrends={true} />{etco2Enabled && hasMonitoring ? (<div className="flex flex-col items-center justify-center h-full bg-slate-900/40 rounded border border-yellow-500/50"><span className="text-sm font-bold text-yellow-500">ETCO2</span><span className="text-4xl font-mono font-bold text-yellow-500">{cprInProgress ? '2.5' : (vitals.hr > 0 ? '4.5' : '1.0')} <span className="text-sm">kPa</span></span></div>) : (<div className="flex items-center justify-center h-full bg-slate-900/20 rounded border border-slate-800 opacity-30"><span className="font-bold text-slate-600">ETCO2 OFF</span></div>)}</div>
                </div>
            </div>
        );
    };

    const DebriefScreen = ({ sim, onRestart }) => {
        const { state } = sim; const { log, scenario, history } = state; const chartRef = useRef(null);
        
        // Safety check for scenario data
        if (!scenario) return <div className="p-4 text-white">Error: No scenario data for debrief.</div>;

        useEffect(() => { 
            if (!chartRef.current || !history.length) return; 
            if (!window.Chart) { console.error("Chart.js not loaded"); return; }
            const ctx = chartRef.current.getContext('2d'); 
            if (window.myChart) window.myChart.destroy(); 
            
            window.myChart = new window.Chart(ctx, { 
                type: 'line', 
                data: { 
                    labels: history.map(h => `${Math.floor(h.time/60)}:${(h.time%60).toString().padStart(2,'0')}`), 
                    datasets: [ 
                        { label: 'HR', data: history.map(h => h.hr), borderColor: '#ef4444', borderWidth: 2, pointRadius: 0, tension: 0.1 }, 
                        { label: 'Sys BP', data: history.map(h => h.bp), borderColor: '#3b82f6', borderWidth: 2, pointRadius: 0, tension: 0.1 }, 
                        { label: 'SpO2', data: history.map(h => h.spo2), borderColor: '#10b981', borderWidth: 2, pointRadius: 0, tension: 0.1, yAxisID: 'y1' } 
                    ] 
                }, 
                options: { 
                    responsive: true, maintainAspectRatio: false, animation: false, 
                    scales: { y: { min: 0 }, y1: { position: 'right', min: 0, max: 100, grid: {drawOnChartArea: false} } } 
                } 
            }); 
            return () => { if (window.myChart) window.myChart.destroy(); }; 
        }, [history]);
        
        const handleExport = () => { 
            if (!window.jspdf) { alert("PDF export library not loaded"); return; }
            const doc = new window.jspdf.jsPDF(); 
            doc.setFontSize(16); doc.text(`Simulation Debrief: ${scenario.title}`, 10, 10); doc.setFontSize(10); 
            let y = 30; 
            log.forEach(l => { if (y > 280) { doc.addPage(); y = 10; } doc.text(`[${l.simTime}] ${l.msg}`, 10, y); y += 6; }); 
            doc.save("sim-debrief.pdf"); 
        };
        
        return (<div className="max-w-4xl mx-auto space-y-6 animate-fadeIn p-4 h-full overflow-y-auto"><div className="flex flex-col md:flex-row justify-between items-center bg-slate-800 p-4 rounded-lg border border-slate-700 gap-4"><h2 className="text-2xl font-bold text-white">Simulation Debrief</h2><div className="flex gap-2"><Button onClick={handleExport} variant="secondary"><Lucide icon="download"/> PDF</Button><Button onClick={onRestart} variant="primary"><Lucide icon="rotate-ccw"/> New Sim</Button></div></div><Card title="Physiological Trends" icon="activity"><div className="bg-slate-900 p-2 rounded h-64 md:h-96 relative"><canvas ref={chartRef}></canvas></div></Card><Card title="Action Timeline" icon="clock"><div className="space-y-1 max-h-64 overflow-y-auto font-mono text-xs">{log.map((l, i) => (<div key={i} className="flex gap-4 border-b border-slate-700 pb-1"><span className="text-sky-400 w-12 flex-shrink-0">{l.simTime}</span><span className="text-slate-300">{l.msg}</span></div>))}</div></Card></div>);
    };

    const MonitorContainer = ({ sessionID }) => { const sim = useSimulation(null, true, sessionID); if (!sessionID) return null; if (!sim.state.vitals || sim.state.vitals.hr === undefined) return (<div className="h-full flex flex-col items-center justify-center bg-black text-slate-500 gap-4 animate-fadeIn"><Lucide icon="wifi" className="w-12 h-12 animate-pulse text-sky-500" /><div className="text-xl font-mono tracking-widest">WAITING FOR CONTROLLER</div><div className="bg-slate-900 px-4 py-2 rounded border border-slate-800 font-bold text-sky-500">SESSION: {sessionID}</div></div>); return <MonitorScreen sim={sim} />; };   
    const LiveSimContainer = ({ sim, view, setView, resumeData, onRestart, sessionID }) => { const { state, stop, reset } = sim; const { scenario } = state; useEffect(() => { if (view === 'resume' && resumeData) { sim.dispatch({ type: 'RESTORE_SESSION', payload: resumeData }); } else if (!scenario) { setView('setup'); } }, []); if (!scenario) return <div className="flex flex-col items-center justify-center h-full text-slate-400 animate-pulse"><Lucide icon="loader-2" className="w-8 h-8 mb-4 animate-spin text-sky-500" /></div>; if (view === 'live' || view === 'resume') return <LiveSimScreen sim={sim} onFinish={() => { stop(); setView('debrief'); }} onBack={() => setView('briefing')} sessionID={sessionID} />; if (view === 'debrief') return <DebriefScreen sim={sim} onRestart={() => { reset(); setView('setup'); }} />; return null; };

    window.SetupScreen = SetupScreen; window.JoinScreen = JoinScreen; window.BriefingScreen = BriefingScreen; window.MonitorScreen = MonitorScreen; window.MonitorContainer = MonitorContainer; window.LiveSimContainer = LiveSimContainer; window.DebriefScreen = DebriefScreen;
})();
