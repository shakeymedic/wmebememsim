// data/screens.js
(() => {
    const { useState, useEffect, useRef } = React;
    const { 
        ALL_SCENARIOS, INTERVENTIONS, HUMAN_FACTOR_CHALLENGES,
        Button, Lucide, Card, VitalDisplay, ECGMonitor, InvestigationButton,
        generateHistory, estimateWeight, calculateWetflag, generateVbg 
    } = window;

    const playNibpSound = () => {
        const ctx = window.AudioContext || window.webkitAudioContext;
        if (!ctx) return;
        const audioCtx = new ctx();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.setValueAtTime(150, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(100, audioCtx.currentTime + 1);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 1);
        osc.start();
        osc.stop(audioCtx.currentTime + 1);
    };

    // --- SCREEN 1: SETUP ---
    const SetupScreen = ({ onGenerate, savedState, onResume }) => {
        const [mode, setMode] = useState('random'); 
        const [category, setCategory] = useState('Any');
        const [age, setAge] = useState('Any');
        const [acuity, setAcuity] = useState('Any'); 
        const [hf, setHf] = useState('hf0');
        const [buildTitle, setBuildTitle] = useState("");
        const [buildAge, setBuildAge] = useState(40);
        const [buildCat, setBuildCat] = useState("Medical");
        const [buildDesc, setBuildDesc] = useState("A 40-year-old male...");
        const [buildPC, setBuildPC] = useState("Chest Pain");
        const [buildVitals, setBuildVitals] = useState({ hr: 80, bpSys: 120, rr: 16, spO2: 98, temp: 37, gcs: 15, glucose: 5.0 });
        const [buildRhythm, setBuildRhythm] = useState("Sinus Rhythm");
        const [customScenarios, setCustomScenarios] = useState([]);

        useEffect(() => {
            const saved = localStorage.getItem('wmebem_custom_scenarios');
            if (saved) setCustomScenarios(JSON.parse(saved));
        }, []);

        const saveCustomScenario = () => {
            const newScen = {
                id: `CUST_${Date.now()}`,
                title: buildTitle || "Untitled Scenario",
                category: buildCat,
                ageRange: buildAge < 18 ? "Paediatric" : "Adult",
                acuity: 'Majors',
                ageGenerator: () => buildAge,
                patientProfileTemplate: buildDesc,
                presentingComplaint: buildPC,
                vitalsMod: { ...buildVitals, bpDia: Math.floor(buildVitals.bpSys * 0.65) },
                pmh: ["Custom PMH"], dhx: ["Nil"], allergies: ["NKDA"],
                instructorBrief: { progression: "Custom Scenario", interventions: [] },
                vbgClinicalState: "normal",
                ecg: { type: buildRhythm, findings: buildRhythm },
                chestXray: { findings: "Unremarkable" }
            };
            const updated = [...customScenarios, newScen];
            setCustomScenarios(updated);
            localStorage.setItem('wmebem_custom_scenarios', JSON.stringify(updated));
            alert("Scenario Saved!");
            setMode('custom'); 
        };

        const handleGenerate = () => {
             let pool = ALL_SCENARIOS.filter(s => 
                (category === 'Any' || s.category === category || (category === 'Medical' && (s.category === 'Toxicology' || s.category === 'Psychiatric'))) && 
                (age === 'Any' || s.ageRange === age) && (acuity === 'Any' || s.acuity === acuity)
             );
             if (pool.length === 0) { alert("No scenarios found matching this combination."); return; }
             const base = pool[Math.floor(Math.random() * pool.length)];
             const patientAge = base.ageGenerator();
             const history = generateHistory(patientAge, base.category === 'Obstetrics & Gynae' ? 'Female' : 'Male');
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

        const loadCustom = (scen) => {
             const patientAge = scen.ageGenerator();
             const generated = { 
                ...scen, patientAge, profile: scen.patientProfileTemplate,
                vitals: { hr: 80, bpSys: 120, bpDia: 80, rr: 16, spO2: 98, temp: 37, gcs: 15, bm: 5, pupils: '3mm', ...scen.vitalsMod },
                vbg: generateVbg("normal"), hf: HUMAN_FACTOR_CHALLENGES[0], weight: null, wetflag: null
             };
             onGenerate(generated, {});
        };

        return (
            <div className="max-w-4xl mx-auto p-4 h-full overflow-y-auto space-y-6">
                {savedState && (
                    <div className="bg-emerald-900/30 border border-emerald-500 p-4 rounded-lg flex items-center justify-between">
                        <div><h3 className="font-bold text-emerald-400">Previous Session Found</h3><p className="text-sm text-slate-300">Resume {savedState.scenario.title}?</p></div>
                        <Button onClick={onResume} variant="success">Resume</Button>
                    </div>
                )}
                <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-xl">
                    <h2 className="text-xl font-bold text-sky-400 mb-4 flex items-center gap-2"><Lucide icon="settings"/> Simulation Setup</h2>
                    <div className="flex gap-2 mb-6 border-b border-slate-700">
                        <button onClick={() => setMode('random')} className={`pb-2 px-4 text-sm font-bold uppercase ${mode === 'random' ? 'text-sky-400 border-b-2 border-sky-400' : 'text-slate-500'}`}>Random</button>
                        <button onClick={() => setMode('custom')} className={`pb-2 px-4 text-sm font-bold uppercase ${mode === 'custom' ? 'text-sky-400 border-b-2 border-sky-400' : 'text-slate-500'}`}>Saved</button>
                        <button onClick={() => setMode('builder')} className={`pb-2 px-4 text-sm font-bold uppercase ${mode === 'builder' ? 'text-emerald-400 border-b-2 border-emerald-400' : 'text-slate-500'}`}>Builder</button>
                    </div>
                    {mode === 'random' && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div><label className="text-xs uppercase text-slate-500 font-bold">Category</label><select value={category} onChange={e=>setCategory(e.target.value)} className="w-full bg-slate-700 rounded p-3 text-sm text-white border border-slate-600"><option value="Any">Any</option><option value="Medical">Medical</option><option value="Trauma">Trauma</option><option value="Obstetrics & Gynae">Obstetrics & Gynae</option><option value="Toxicology">Toxicology</option><option value="Psychiatric">Psychiatric</option><option value="Cardiac Arrest">Cardiac Arrest</option></select></div>
                                <div><label className="text-xs uppercase text-slate-500 font-bold">Age Group</label><select value={age} onChange={e=>setAge(e.target.value)} className="w-full bg-slate-700 rounded p-3 text-sm text-white border border-slate-600"><option value="Any">Any</option><option value="Adult">Adult</option><option value="Paediatric">Paediatric</option><option value="Elderly">Elderly</option></select></div>
                                <div><label className="text-xs uppercase text-slate-500 font-bold">Acuity</label><select value={acuity} onChange={e=>setAcuity(e.target.value)} className="w-full bg-slate-700 rounded p-3 text-sm text-white border border-slate-600"><option value="Any">Any</option><option value="Majors">Majors (Stable-ish)</option><option value="Resus">Resus (Unstable)</option></select></div>
                                <div><label className="text-xs uppercase text-slate-500 font-bold">Human Factor</label><select value={hf} onChange={e=>setHf(e.target.value)} className="w-full bg-slate-700 rounded p-3 text-sm text-white border border-slate-600">{HUMAN_FACTOR_CHALLENGES.map(h => <option key={h.id} value={h.id}>{h.type}</option>)}</select></div>
                            </div>
                            <Button onClick={handleGenerate} className="w-full py-4 text-lg shadow-sky-500/20">Generate Scenario</Button>
                        </div>
                    )}
                    {mode === 'custom' && (
                        <div className="space-y-2">
                             {customScenarios.length === 0 && <p className="text-slate-500 text-sm italic">No custom scenarios yet.</p>}
                             {customScenarios.map((s, i) => (<div key={i} className="flex justify-between items-center bg-slate-700/50 p-3 rounded border border-slate-600"><div><div className="font-bold text-white">{s.title}</div></div><Button onClick={() => loadCustom(s)} variant="success" className="h-8 text-xs">Load</Button></div>))}
                        </div>
                    )}
                    {mode === 'builder' && (
                        <div className="space-y-4 animate-fadeIn">
                            <input type="text" placeholder="Title" value={buildTitle} onChange={e=>setBuildTitle(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white"/>
                            <div className="grid grid-cols-2 gap-2">
                                <input type="number" placeholder="Age" value={buildAge} onChange={e=>setBuildAge(e.target.value)} className="bg-slate-900 border border-slate-600 rounded p-3 text-white"/>
                                <select value={buildCat} onChange={e=>setBuildCat(e.target.value)} className="bg-slate-900 border border-slate-600 rounded p-3 text-white"><option>Medical</option><option>Trauma</option><option>Toxicology</option></select>
                            </div>
                            <div className="grid grid-cols-4 gap-2">
                                <input type="number" placeholder="HR" value={buildVitals.hr} onChange={e=>setBuildVitals({...buildVitals, hr: parseInt(e.target.value)})} className="bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm"/>
                                <input type="number" placeholder="BP Sys" value={buildVitals.bpSys} onChange={e=>setBuildVitals({...buildVitals, bpSys: parseInt(e.target.value)})} className="bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm"/>
                                <input type="number" placeholder="RR" value={buildVitals.rr} onChange={e=>setBuildVitals({...buildVitals, rr: parseInt(e.target.value)})} className="bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm"/>
                                <input type="number" placeholder="SpO2" value={buildVitals.spO2} onChange={e=>setBuildVitals({...buildVitals, spO2: parseInt(e.target.value)})} className="bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm"/>
                            </div>
                             <select value={buildRhythm} onChange={e=>setBuildRhythm(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white"><option>Sinus Rhythm</option><option>Sinus Tachycardia</option><option>AF</option><option>VT</option><option>VF</option><option>Asystole</option></select>
                             <Button onClick={saveCustomScenario} variant="primary" className="w-full">Save Custom Scenario</Button>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // --- SCREEN 2: JOIN ---
    const JoinScreen = ({ onJoin }) => {
        const [code, setCode] = useState("");
        return (
            <div className="flex flex-col items-center justify-center h-full bg-slate-900 text-white p-4">
                <div className="w-full max-w-md space-y-6 text-center">
                    <div className="flex justify-center mb-4"><img src="https://iili.io/KGQOvkl.md.png" alt="Logo" className="h-20 object-contain" /></div>
                    <h1 className="text-3xl font-bold text-sky-400">Sim Monitor</h1>
                    <p className="text-slate-400">Enter the Session Code</p>
                    <input type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="e.g. A1B2" className="w-full bg-slate-800 border-2 border-slate-600 rounded-lg p-4 text-center text-3xl font-mono tracking-widest uppercase text-white outline-none" maxLength={4}/>
                    <Button onClick={() => onJoin(code)} disabled={code.length < 4} className="w-full py-4 text-xl">Connect</Button>
                </div>
            </div>
        );
    };

    // --- SCREEN 3: BRIEFING ---
    const BriefingScreen = ({ scenario, onStart, onBack, onNewScenario }) => (
        <div className="max-w-4xl mx-auto space-y-6 animate-fadeIn p-4 overflow-y-auto h-full">
            <div className="bg-slate-800 p-6 rounded-lg border-l-4 border-sky-500 shadow-lg">
                <div className="flex justify-between items-start mb-4">
                    <div><h2 className="text-3xl font-bold text-white">{scenario.title}</h2><span className="inline-block bg-slate-700 text-sky-300 text-xs px-2 py-1 rounded mt-2">{scenario.category}</span></div>
                    <div className="text-right"><p className="text-2xl font-mono font-bold text-emerald-400">GCS {scenario.vitals.gcs}</p></div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div><h3 className="text-sm font-bold text-slate-500 uppercase mb-1">Patient Profile</h3><p className="text-lg leading-relaxed mb-4">{scenario.profile}</p></div>
                    <div className="space-y-4">
                         <div className="bg-slate-900/50 p-3 rounded border border-slate-600"><h4 className="text-sm font-bold text-amber-400 uppercase mb-2">Progression</h4><p className="text-sm text-slate-300">{scenario.instructorBrief.progression}</p></div>
                    </div>
                </div>
            </div>
            <div className="flex flex-col md:flex-row gap-4">
                <Button onClick={onBack} variant="secondary" className="flex-1">Back</Button>
                <Button onClick={onNewScenario} variant="secondary" className="flex-1">New Scenario</Button>
                <Button onClick={onStart} className="flex-1 shadow-sky-900/20 shadow-xl">Start Simulation</Button>
            </div>
        </div>
    );

    // --- SCREEN 4: LIVE SIM CONTROLLER ---
    const LiveSimScreen = ({ sim, onFinish, onBack }) => {
        const { state, start, pause, stop, applyIntervention, addLogEntry, manualUpdateVital, triggerArrest, triggerROSC, revealInvestigation, nextCycle, enableAudio, speak, startTrend } = sim;
        const { scenario, time, cycleTimer, isRunning, vitals, prevVitals, log, flash, activeInterventions, interventionCounts, activeDurations, isMuted, rhythm, etco2Enabled, queuedRhythm, cprInProgress, nibp } = state;
        const [activeTab, setActiveTab] = useState("Common");
        const [customLog, setCustomLog] = useState("");
        const [searchResults, setSearchResults] = useState([]);
        const [showTrends, setShowTrends] = useState(false);
        const [expandRhythm, setExpandRhythm] = useState(false);
        const [trendParams, setTrendParams] = useState({ hr: vitals.hr, bpSys: vitals.bpSys, duration: 60 });

        useEffect(() => {
            if (customLog.length > 1) {
                const results = Object.keys(INTERVENTIONS).filter(key => (key + INTERVENTIONS[key].label).toLowerCase().includes(customLog.toLowerCase()));
                setSearchResults(results);
            } else { setSearchResults([]); }
        }, [customLog]);
        const handleSearchSelect = (key) => { applyIntervention(key); setCustomLog(""); setSearchResults([]); };
        const getInterventionsByCat = (cat) => {
            if (cat === 'Handover') return [];
            let keys = [];
            if (cat === 'Common') keys = ['Obs', 'Oxygen', 'IV Access', 'Fluids', 'Analgesia', 'Antiemetic', 'Antibiotics', 'Nebs', 'AdrenalineIM', 'Blood', 'TXA']; 
            else keys = Object.keys(INTERVENTIONS).filter(key => INTERVENTIONS[key].category === cat);
            return keys.sort((a, b) => INTERVENTIONS[a].label.localeCompare(INTERVENTIONS[b].label));
        };
        const formatTime = (s) => `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
        const hasMonitoring = activeInterventions.has('Obs');
        const hasArtLine = activeInterventions.has('ArtLine');
        const generateSBAR = () => `S: ${scenario.title}. ${scenario.ageRange} patient.\nB: ${scenario.patientProfileTemplate.replace('{age}', scenario.patientAge)}.\nA: Stats: HR ${vitals.hr}, BP ${vitals.bpSys}/${vitals.bpDia}, SpO2 ${vitals.spO2}%. Interventions: ${Array.from(activeInterventions).join(', ') || 'None'}.\nR: Request urgent review / transfer.`;
        const getCatColor = (cat) => {
            if (cat === 'Airway') return 'bg-sky-700 border-sky-500';
            if (cat === 'Breathing') return 'bg-cyan-700 border-cyan-500';
            if (cat === 'Circulation') return 'bg-red-700 border-red-500';
            if (cat === 'Drugs') return 'bg-yellow-700 border-yellow-500';
            if (cat === 'Procedures') return 'bg-emerald-700 border-emerald-500';
            return 'bg-slate-700 border-slate-500';
        };

        return (
            <div className={`h-full overflow-hidden flex flex-col p-2 bg-slate-900 relative ${flash === 'red' ? 'flash-red' : (flash === 'green' ? 'flash-green' : '')}`}>
                <div className="flex justify-between items-center bg-slate-800 p-2 rounded mb-2 border border-slate-700">
                    <div className="flex gap-2">
                        <Button variant="secondary" onClick={onBack} className="h-8 px-2"><Lucide icon="arrow-left"/> Back</Button>
                        {!isRunning ? <Button variant="success" onClick={start} className="h-8 px-4 font-bold"><Lucide icon="play"/> START</Button> : <Button variant="danger" onClick={stop} className="h-8 px-4"><Lucide icon="square"/> STOP</Button>}
                        <Button variant="outline" onClick={() => window.open(window.location.href.split('?')[0] + '?mode=monitor&session=' + (new URLSearchParams(window.location.search).get('session') || ''), '_blank', 'popup=yes')} className="h-8 px-2 text-xs"><Lucide icon="external-link"/> Monitor</Button>
                    </div>
                    <div className="text-right hidden md:block"><div className="text-[10px] text-slate-400 uppercase">Sim Time</div><div className="font-mono text-xl font-bold text-emerald-400 leading-none">{formatTime(time)}</div></div>
                </div>
                <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-2 overflow-hidden min-h-0">
                    <div className="lg:col-span-4 flex flex-col gap-2 overflow-y-auto">
                        <Card className="bg-black border-slate-800 flex-shrink-0">
                             <ECGMonitor rhythmType={rhythm} hr={vitals.hr} rr={vitals.rr} spO2={vitals.spO2} isPaused={!isRunning} showEtco2={etco2Enabled} pathology={scenario?.deterioration?.type} showTraces={hasMonitoring} showArt={hasArtLine} isCPR={cprInProgress} className="h-32"/>
                             <div className="grid grid-cols-4 gap-1 p-1 bg-black">
                                <VitalDisplay label="HR" value={vitals.hr} onUpdate={v=>manualUpdateVital('hr', v)} visible={hasMonitoring} />
                                <VitalDisplay label="BP" value={vitals.bpSys} value2={vitals.bpDia} onUpdate={v=>manualUpdateVital('bpSys', v)} visible={hasMonitoring} />
                                <VitalDisplay label="SpO2" value={vitals.spO2} onUpdate={v=>manualUpdateVital('spO2', v)} visible={hasMonitoring} />
                                <VitalDisplay label="RR" value={vitals.rr} onUpdate={v=>manualUpdateVital('rr', v)} visible={hasMonitoring} />
                             </div>
                        </Card>
                        <div className="grid grid-cols-2 gap-2">
                             <div className="bg-slate-800 p-2 rounded border border-slate-600">
                                 <h4 className="text-[10px] font-bold text-red-400 uppercase mb-1">NIBP Control</h4>
                                 <div className="flex gap-1">
                                     <Button onClick={() => sim.dispatch({type: 'TRIGGER_NIBP_MEASURE'})} className="h-8 text-[10px] flex-1">Measure Now</Button>
                                     <Button onClick={() => sim.dispatch({type: 'TOGGLE_NIBP_MODE'})} variant={nibp.mode === 'auto' ? "success" : "secondary"} className="h-8 text-[10px] flex-1">{nibp.mode === 'auto' ? `Auto (${Math.ceil(nibp.timer/60)}m)` : 'Auto Off'}</Button>
                                 </div>
                             </div>
                             <div className="bg-slate-800 p-2 rounded border border-slate-600">
                                 <h4 className="text-[10px] font-bold text-purple-400 uppercase mb-1">Time Travel</h4>
                                 <Button onClick={() => setShowTrends(true)} variant="outline" className="h-8 text-[10px] w-full">Set Trends...</Button>
                             </div>
                        </div>
                        <div className="bg-slate-800 p-2 rounded border border-slate-600 relative z-10">
                             <h4 className="text-[10px] font-bold text-green-400 uppercase mb-1">Cardiac Rhythm</h4>
                             <Button onClick={() => setExpandRhythm(!expandRhythm)} variant="secondary" className="w-full h-8 text-xs justify-between">{rhythm} <Lucide icon="chevron-down" className="w-3 h-3"/></Button>
                             {expandRhythm && (<div className="absolute top-full left-0 w-full bg-slate-800 border border-slate-500 rounded shadow-xl max-h-60 overflow-y-auto mt-1">{['Sinus Rhythm', 'Sinus Tachycardia', 'Sinus Bradycardia', 'AF', 'SVT', 'VT', 'VF', 'Asystole', 'PEA', 'STEMI', '1st Deg Block', '3rd Deg Block'].map(r => (<button key={r} onClick={() => {sim.dispatch({type: 'UPDATE_RHYTHM', payload: r}); setExpandRhythm(false);}} className="block w-full text-left px-3 py-2 text-xs text-white hover:bg-sky-600 border-b border-slate-700">{r}</button>))}</div>)}
                             <div className="flex gap-1 mt-2"><Button onClick={triggerArrest} variant="danger" className="flex-1 h-8 text-[10px]">Arrest</Button><Button onClick={triggerROSC} variant="success" className="flex-1 h-8 text-[10px]">ROSC</Button></div>
                        </div>
                    </div>
                    <div className="lg:col-span-8 flex flex-col bg-slate-800 rounded border border-slate-700 overflow-hidden">
                        <div className="flex overflow-x-auto bg-slate-900 border-b border-slate-700 no-scrollbar">{['Common', 'Airway', 'Breathing', 'Circulation', 'Drugs', 'Procedures', 'Handover'].map(cat => (<button key={cat} onClick={() => setActiveTab(cat)} className={`px-4 py-3 text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${activeTab === cat ? 'bg-slate-800 text-sky-400 border-t-2 border-sky-400' : 'text-slate-500 hover:text-slate-300'}`}>{cat}</button>))}</div>
                        <div className="flex-1 p-2 overflow-y-auto bg-slate-800 relative">
                            {activeTab === 'Handover' ? (
                                <div className="space-y-4 p-2">
                                    <div className="bg-slate-900 p-4 rounded border border-slate-600 font-mono text-sm text-green-400 whitespace-pre-wrap">{generateSBAR()}</div>
                                    <div className="flex gap-2"><Button onClick={() => speak(generateSBAR())} variant="secondary">Read Aloud</Button><Button onClick={() => navigator.clipboard.writeText(generateSBAR())} variant="outline">Copy</Button></div>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                                    {getInterventionsByCat(activeTab).map(key => {
                                        const action = INTERVENTIONS[key];
                                        const isActive = activeInterventions.has(key);
                                        const count = interventionCounts[key] || 0;
                                        let btnClass = isActive ? "bg-emerald-900/40 border border-emerald-500 text-emerald-100" : `opacity-90 hover:opacity-100 ${getCatColor(activeTab)}`;
                                        return (
                                            <button key={key} onClick={() => applyIntervention(key)} disabled={!isRunning} className={`relative h-16 p-2 rounded text-left transition-all active:scale-95 flex flex-col justify-between overflow-hidden shadow-sm ${btnClass}`}>
                                                <span className="text-xs font-bold leading-tight">{action.label}</span>
                                                <div className="flex justify-between items-end w-full"><span className="text-[10px] opacity-70 italic truncate">{action.category}</span>{count > 0 && action.type !== 'continuous' && <span className="bg-white text-black text-[9px] font-bold px-1.5 rounded-full">x{count}</span>}</div>
                                                {activeDurations[key] && (<div className="absolute bottom-0 left-0 h-1 bg-emerald-400 transition-all duration-1000" style={{width: `${Math.max(0, 100 - ((time - activeDurations[key].startTime)/activeDurations[key].duration*100))}%`}}></div>)}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        <div className="bg-slate-900 p-2 border-t border-slate-700 flex gap-2">
                             <input type="text" className="bg-slate-800 border border-slate-600 rounded px-3 text-xs flex-1 text-white" placeholder="Search..." value={customLog} onChange={e=>setCustomLog(e.target.value)} onKeyDown={e => e.key === 'Enter' && (addLogEntry(customLog, 'manual') || setCustomLog(""))} />
                             <Button onClick={() => {sim.dispatch({type: 'TRIGGER_IMPROVE'}); addLogEntry("Patient Improving", "success")}} className="h-8 text-xs px-2 bg-emerald-900 border border-emerald-500 text-emerald-100">Improve</Button>
                             <Button onClick={() => {sim.dispatch({type: 'TRIGGER_DETERIORATE'}); addLogEntry("Patient Deteriorating", "danger")}} className="h-8 text-xs px-2 bg-red-900 border border-red-500 text-red-100">Worsen</Button>
                        </div>
                    </div>
                </div>
                {showTrends && (
                    <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-sm">
                            <h3 className="text-lg font-bold text-white mb-4">Set Vitals Trend</h3>
                            <div className="space-y-3">
                                <div><label className="text-xs text-slate-400">Target HR</label><input type="number" value={trendParams.hr} onChange={e=>setTrendParams({...trendParams, hr: parseInt(e.target.value)})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"/></div>
                                <div><label className="text-xs text-slate-400">Target BP Sys</label><input type="number" value={trendParams.bpSys} onChange={e=>setTrendParams({...trendParams, bpSys: parseInt(e.target.value)})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"/></div>
                                <div><label className="text-xs text-slate-400">Duration (seconds)</label><input type="number" value={trendParams.duration} onChange={e=>setTrendParams({...trendParams, duration: parseInt(e.target.value)})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"/></div>
                                <div className="flex gap-2 mt-4"><Button onClick={()=>setShowTrends(false)} variant="secondary" className="flex-1">Cancel</Button><Button onClick={()=>{startTrend({hr: trendParams.hr, bpSys: trendParams.bpSys}, trendParams.duration); setShowTrends(false);}} variant="primary" className="flex-1">Start Trend</Button></div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    // --- SCREEN 5: MONITOR ---
    const MonitorScreen = ({ sim }) => {
        const { state, enableAudio } = sim;
        const { vitals, prevVitals, rhythm, flash, activeInterventions, etco2Enabled, cprInProgress, scenario, nibp } = state;
        const hasMonitoring = activeInterventions.has('Obs');
        const hasArtLine = activeInterventions.has('ArtLine');
        const [audioEnabled, setAudioEnabled] = useState(false);
        const wakeLockRef = useRef(null);

        // Wake Lock
        useEffect(() => {
            const requestWakeLock = async () => {
                if ('wakeLock' in navigator) {
                    try { wakeLockRef.current = await navigator.wakeLock.request('screen'); } 
                    catch (err) { console.log(err); }
                }
            };
            requestWakeLock();
            const handleVis = () => { if (document.visibilityState === 'visible') requestWakeLock(); };
            document.addEventListener('visibilitychange', handleVis);
            return () => { if(wakeLockRef.current) wakeLockRef.current.release(); document.removeEventListener('visibilitychange', handleVis); };
        }, []);

        useEffect(() => { if (nibp.lastTaken && audioEnabled) playNibpSound(); }, [nibp.lastTaken]);

        return (
            <div className={`h-full w-full flex flex-col bg-black text-white p-2 md:p-4 transition-colors duration-200 ${flash === 'red' ? 'flash-red' : (flash === 'green' ? 'flash-green' : '')}`}>
                {!audioEnabled && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => { enableAudio(); setAudioEnabled(true); }}>
                        <div className="bg-slate-800 border border-sky-500 p-6 rounded-lg shadow-2xl animate-bounce cursor-pointer text-center">
                            <Lucide icon="volume-2" className="w-12 h-12 text-sky-400 mx-auto mb-2"/><h2 className="text-xl font-bold text-white">Tap to Enable Sound</h2>
                        </div>
                    </div>
                )}
                <div className="flex-grow relative border border-slate-800 rounded mb-2 overflow-hidden flex flex-col">
                    <ECGMonitor rhythmType={rhythm} hr={vitals.hr} rr={vitals.rr} spO2={vitals.spO2} isPaused={false} showEtco2={etco2Enabled} pathology={scenario?.deterioration?.type || 'normal'} showTraces={hasMonitoring} showArt={hasArtLine} isCPR={cprInProgress} className="h-full" rhythmLabel="ECG" />
                </div>
                <div className="flex-none grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 h-auto md:h-[30vh]">
                    <VitalDisplay label="Heart Rate" value={vitals.hr} prev={prevVitals.hr} unit="bpm" lowIsBad={false} onUpdate={() => {}} alert={vitals.hr > 140 || vitals.hr < 40} visible={hasMonitoring} isMonitor={true} hideTrends={true} />
                    {hasArtLine ? (<VitalDisplay label="ABP" value={vitals.bpSys} value2={vitals.bpDia} prev={prevVitals.bpSys} unit="mmHg" onUpdate={() => {}} alert={vitals.bpSys < 90} visible={true} isMonitor={true} hideTrends={true} />) : (<VitalDisplay label="NIBP" value={nibp.sys || '?'} value2={nibp.dia || '?'} unit="mmHg" onUpdate={() => {}} alert={nibp.sys && nibp.sys < 90} visible={hasMonitoring} isMonitor={true} isNIBP={true} lastNIBP={nibp.lastTaken} hideTrends={true} />)}
                    <VitalDisplay label="SpO2" value={vitals.spO2} prev={prevVitals.spO2} unit="%" onUpdate={() => {}} alert={vitals.spO2 < 90} visible={hasMonitoring} isMonitor={true} hideTrends={true} />
                    <div className="grid grid-rows-2 gap-2 md:gap-4">
                        <VitalDisplay label="Resp Rate" value={vitals.rr} prev={prevVitals.rr} unit="/min" lowIsBad={false} onUpdate={() => {}} alert={vitals.rr > 30 || vitals.rr < 8} visible={hasMonitoring} isMonitor={true} hideTrends={true} />
                        {etco2Enabled && hasMonitoring ? (<div className="flex flex-col items-center justify-center h-full bg-slate-900/40 rounded border border-yellow-500/50"><span className="text-sm font-bold text-yellow-500">ETCO2</span><span className="text-4xl font-mono font-bold text-yellow-500">{cprInProgress ? '2.5' : (vitals.hr > 0 ? '4.5' : '1.0')} <span className="text-sm">kPa</span></span></div>) : (<div className="flex items-center justify-center h-full bg-slate-900/20 rounded border border-slate-800 opacity-30"><span className="font-bold text-slate-600">ETCO2 OFF</span></div>)}
                    </div>
                </div>
            </div>
        );
    };

    // --- SCREEN 6: DEBRIEF ---
    const DebriefScreen = ({ sim, onRestart }) => {
        const { state } = sim;
        const { log, scenario, history } = state; 
        const chartRef = useRef(null);
        useEffect(() => {
            if (!chartRef.current || !history.length) return;
            const ctx = chartRef.current.getContext('2d');
            if (window.myChart) window.myChart.destroy();
            window.myChart = new window.Chart(ctx, { type: 'line', data: { labels: history.map(h => `${Math.floor(h.time/60)}:${(h.time%60).toString().padStart(2,'0')}`), datasets: [ { label: 'HR', data: history.map(h => h.hr), borderColor: '#ef4444', borderWidth: 2, pointRadius: 0, tension: 0.1 }, { label: 'Sys BP', data: history.map(h => h.bp), borderColor: '#3b82f6', borderWidth: 2, pointRadius: 0, tension: 0.1 }, { label: 'SpO2', data: history.map(h => h.spo2), borderColor: '#10b981', borderWidth: 2, pointRadius: 0, tension: 0.1, yAxisID: 'y1' } ] }, options: { responsive: true, maintainAspectRatio: false, animation: false, scales: { y: { min: 0 }, y1: { position: 'right', min: 0, max: 100, grid: {drawOnChartArea: false} } } } });
            return () => { if (window.myChart) window.myChart.destroy(); };
        }, [history]);
        const handleExport = () => {
            const doc = new window.jspdf.jsPDF(); doc.setFontSize(16); doc.text(`Simulation Debrief: ${scenario.title}`, 10, 10); doc.setFontSize(10); let y = 30;
            log.forEach(l => { if (y > 280) { doc.addPage(); y = 10; } doc.text(`[${l.simTime}] ${l.msg}`, 10, y); y += 6; }); doc.save("sim-debrief.pdf");
        };
        return (
            <div className="max-w-4xl mx-auto space-y-6 animate-fadeIn p-4 h-full overflow-y-auto">
                <div className="flex flex-col md:flex-row justify-between items-center bg-slate-800 p-4 rounded-lg border border-slate-700 gap-4"><h2 className="text-2xl font-bold text-white">Simulation Debrief</h2><div className="flex gap-2"><Button onClick={handleExport} variant="secondary"><Lucide icon="download"/> PDF</Button><Button onClick={onRestart} variant="primary"><Lucide icon="rotate-ccw"/> New Sim</Button></div></div>
                <Card title="Physiological Trends" icon="activity"><div className="bg-slate-900 p-2 rounded h-64 md:h-96 relative"><canvas ref={chartRef}></canvas></div></Card>
                <Card title="Action Timeline" icon="clock"><div className="space-y-1 max-h-64 overflow-y-auto font-mono text-xs">{log.map((l, i) => (<div key={i} className="flex gap-4 border-b border-slate-700 pb-1"><span className="text-sky-400 w-12 flex-shrink-0">{l.simTime}</span><span className="text-slate-300">{l.msg}</span></div>))}</div></Card>
            </div>
        );
    };

    const MonitorContainer = ({ sessionID }) => {
        const sim = useSimulation(null, true, sessionID);
        if (!sessionID) return null;
        if (!sim.state.vitals || sim.state.vitals.hr === undefined) return (<div className="h-full flex flex-col items-center justify-center bg-black text-slate-500 gap-4 animate-fadeIn"><Lucide icon="wifi" className="w-12 h-12 animate-pulse text-sky-500" /><div className="text-xl font-mono tracking-widest">WAITING FOR CONTROLLER</div><div className="bg-slate-900 px-4 py-2 rounded border border-slate-800 font-bold text-sky-500">SESSION: {sessionID}</div></div>);
        return <MonitorScreen sim={sim} />;
    };   

    const LiveSimContainer = ({ sim, view, setView, resumeData, onRestart }) => {
        const { state, stop } = sim;
        const { scenario } = state;
        useEffect(() => { if (view === 'resume' && resumeData) { sim.dispatch({ type: 'RESTORE_SESSION', payload: resumeData }); } else if (!scenario) { setView('setup'); } }, []);
        if (!scenario) return <div className="flex flex-col items-center justify-center h-full text-slate-400 animate-pulse"><Lucide icon="loader-2" className="w-8 h-8 mb-4 animate-spin text-sky-500" /></div>;
        if (view === 'live' || view === 'resume') return <LiveSimScreen sim={sim} onFinish={() => { stop(); setView('debrief'); }} onBack={() => setView('briefing')} />;
        if (view === 'debrief') return <DebriefScreen sim={sim} onRestart={onRestart} />;
        return null;
    };

    window.SetupScreen = SetupScreen; window.JoinScreen = JoinScreen; window.BriefingScreen = BriefingScreen; window.MonitorScreen = MonitorScreen; window.MonitorContainer = MonitorContainer; window.LiveSimContainer = LiveSimContainer; window.DebriefScreen = DebriefScreen;
})();
                                                                                                                                                                                                                                                   
