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
                if (saved) {
                    setCustomScenarios(JSON.parse(saved));
                }
            } catch (e) {
                console.warn("Storage access blocked - Custom scenarios disabled");
            }
        }, []);

        const saveCustomScenario = () => {
            if(!buildTitle) return alert("Please add a title");
            const safeVitals = {
                hr: parseInt(buildVitals.hr) || 80,
                bpSys: parseInt(buildVitals.bpSys) || 120,
                rr: parseInt(buildVitals.rr) || 16,
                spO2: parseInt(buildVitals.spO2) || 98
            };
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
            try {
                localStorage.setItem('wmebem_custom_scenarios', JSON.stringify(updated));
            } catch (e) {
                console.warn("Could not save custom scenario to storage");
                alert("Scenario active, but could not be saved permanently due to browser privacy settings.");
            }
            setMode('custom'); 
        };

        const handleExport = () => {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(customScenarios));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", "scenarios.json");
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
        };

        const handleImport = (event) => {
            const fileReader = new FileReader();
            fileReader.readAsText(event.target.files[0], "UTF-8");
            fileReader.onload = e => {
                try {
                    const imported = JSON.parse(e.target.result);
                    const merged = [...customScenarios, ...imported];
                    setCustomScenarios(merged);
                    localStorage.setItem('wmebem_custom_scenarios', JSON.stringify(merged));
                    alert("Import successful!");
                } catch(err) { alert("Invalid JSON file"); }
            };
        };

        const handleGenerate = (base) => {
             if (!scenariosAvailable) {
                 alert("Scenarios failed to load. Please refresh the page.");
                 return;
             }
             try {
                 let selectedBase = base;
                 if (!base && mode === 'random') {
                     let pool = ALL_SCENARIOS.filter(s => 
                        (category === 'Any' || s.category === category) && 
                        (age === 'Any' || s.ageRange === age) &&
                        (acuity === 'Any' || s.acuity === acuity)
                     );
                     if (pool.length === 0) { alert("No scenarios match filters."); return; }
                     selectedBase = pool[Math.floor(Math.random() * pool.length)];
                 }

                 const patientAge = selectedBase.ageGenerator ? selectedBase.ageGenerator() : 40;
                 
                 let sex = Math.random() > 0.5 ? 'Male' : 'Female';
                 const t = selectedBase.title.toLowerCase();
                 const p = selectedBase.patientProfileTemplate.toLowerCase();
                 const forceFemale = ["ectopic", "ovarian", "pregnant", "labour", "birth", "gynae", "obstetric", "eclampsia", "uterus", "vaginal"];
                 const forceMale = ["testicular", "prostate", "scrotal"];
                 
                 if (forceFemale.some(k => t.includes(k) || p.includes(k)) || selectedBase.category === 'Obstetrics & Gynae') sex = 'Female';
                 else if (forceMale.some(k => t.includes(k) || p.includes(k))) sex = 'Male';
                 
                 const history = generateHistory(patientAge, sex);
                 const weight = patientAge < 16 ? estimateWeight(patientAge) : null;
                 const wetflag = weight ? calculateWetflag(patientAge, weight) : null;
                 const randomName = generateName(sex);

                 let finalVitals = { 
                     hr: 80, bpSys: 120, bpDia: 80, rr: 16, spO2: 98, temp: 37, gcs: 15, bm: 5, pupils: 3, 
                     ...selectedBase.vitalsMod 
                 };
                 if (selectedBase.vitalsMod && selectedBase.vitalsMod.bpSys !== undefined && selectedBase.vitalsMod.bpDia === undefined) { 
                     finalVitals.bpDia = Math.floor(selectedBase.vitalsMod.bpSys * 0.65); 
                 }

                 const generated = { 
                    ...selectedBase, 
                    patientName: randomName,
                    patientAge, 
                    sex,
                    profile: selectedBase.patientProfileTemplate
                        .replace('{age}', patientAge)
                        .replace('{sex}', sex),
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

             } catch (err) {
                 console.error("Generator Error:", err);
                 alert("Error generating scenario: " + err.message);
             }
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
                    <div>
                        <div className="text-[10px] uppercase text-sky-400 font-bold">Session Code</div>
                        <div className="text-2xl font-mono font-bold text-white tracking-widest">{sessionID}</div>
                    </div>
                    <Button onClick={onJoinClick} variant="outline" className="h-10 text-xs">Use as Monitor</Button>
                </div>

                <div className="bg-slate-800 p-4 rounded border border-slate-600 text-sm text-slate-300">
                    <p className="font-bold text-sky-400 mb-1">Sim Setup Guide:</p>
                    <p>Select a mode below. <strong>Random</strong> generates a patient from filters. <strong>Premade</strong> lists specific conditions. <strong>Builder</strong> lets you craft on the fly.</p>
                </div>

                {savedState && (
                    <div className="bg-emerald-900/30 border border-emerald-500 p-4 rounded-lg flex items-center justify-between animate-fadeIn">
                        <div>
                            <h3 className="font-bold text-emerald-400">Resume Previous?</h3>
                            <p className="text-sm text-slate-300">{savedState.scenario.title}</p>
                        </div>
                        <Button onClick={onResume} variant="success">Resume</Button>
                    </div>
                )}
                
                <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-xl">
                    <div className="flex gap-2 mb-6 border-b border-slate-700 overflow-x-auto no-scrollbar">
                        {['random', 'premade', 'custom', 'builder'].map(m => (
                            <button 
                                key={m} 
                                onClick={() => { setMode(m); setPremadeCategory(null); }} 
                                className={`pb-2 px-4 text-sm font-bold uppercase whitespace-nowrap transition-colors ${mode === m ? 'text-sky-400 border-b-2 border-sky-400' : 'text-slate-500 hover:text-slate-300'}`}
                            >
                                {m}
                            </button>
                        ))}
                    </div>

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
                                    {premadeCategories.map(cat => (
                                        <button 
                                            key={cat.id} 
                                            onClick={() => setPremadeCategory(cat)}
                                            className="flex flex-col items-center justify-center p-4 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-lg transition-all active:scale-95 group"
                                        >
                                            <Lucide icon={cat.icon} className="w-8 h-8 text-sky-400 group-hover:text-white mb-2" />
                                            <span className="text-sm font-bold text-slate-200 group-hover:text-white">{cat.label}</span>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2 mb-4">
                                        <Button variant="secondary" onClick={() => setPremadeCategory(null)} className="h-8 px-2 text-xs"><Lucide icon="arrow-left" /> Back</Button>
                                        <h3 className="text-lg font-bold text-sky-400">{premadeCategory.label} Scenarios</h3>
                                    </div>
                                    <div className="grid gap-2 max-h-[400px] overflow-y-auto pr-2">
                                        {ALL_SCENARIOS.filter(premadeCategory.filter).map((s) => (
                                            <div key={s.id} className="flex justify-between items-center bg-slate-700/40 hover:bg-slate-700 p-3 rounded border border-slate-600 group">
                                                <div>
                                                    <div className="font-bold text-slate-200 group-hover:text-white flex items-center gap-2">
                                                        {s.title} 
                                                        {s.acuity === 'Resus' && <span className="text-[9px] bg-red-900/50 text-red-400 px-1 rounded border border-red-800">RESUS</span>}
                                                    </div>
                                                    <div className="text-xs text-slate-400">{s.patientProfileTemplate.substring(0, 60)}...</div>
                                                </div>
                                                <Button onClick={() => handleGenerate(s)} variant="primary" className="h-8 text-xs px-3">Load</Button>
                                            </div>
                                        ))}
                                        {ALL_SCENARIOS.filter(premadeCategory.filter).length === 0 && (
                                            <div className="text-center text-slate-500 py-8">No scenarios found in this category.</div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {mode === 'custom' && (
                        <div className="space-y-2 animate-fadeIn">
                             <div className="flex gap-2 mb-4">
                                <Button onClick={handleExport} variant="outline" className="h-8 text-xs flex-1">Export JSON</Button>
                                <label className="flex-1">
                                    <span className="flex items-center justify-center h-8 px-2 rounded bg-slate-700 text-white text-xs border border-slate-600 cursor-pointer hover:bg-slate-600">Import JSON</span>
                                    <input type="file" className="hidden" onChange={handleImport} accept=".json"/>
                                </label>
                             </div>
                             {customScenarios.length === 0 && <p className="text-slate-500 text-sm italic text-center py-4">No custom scenarios saved yet.</p>}
                             {customScenarios.map((s, i) => (
                                 <div key={i} className="flex justify-between items-center bg-slate-700/50 p-3 rounded border border-slate-600">
                                     <div><div className="font-bold text-white">{s.title}</div><div className="text-xs text-slate-400">{s.patientProfileTemplate}</div></div>
                                     <Button onClick={() => handleGenerate(s)} variant="success" className="h-8 text-xs">Load</Button>
                                 </div>
                             ))}
                        </div>
                    )}

                    {mode === 'builder' && (
                        <div className="space-y-4 animate-fadeIn">
                            <input type="text" placeholder="Scenario Title" value={buildTitle} onChange={e=>setBuildTitle(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white placeholder-slate-500"/>
                            <div className="grid grid-cols-2 gap-2">
                                <input type="number" placeholder="Age" value={buildAge} onChange={e=>setBuildAge(e.target.value)} className="bg-slate-900 border border-slate-600 rounded p-2 text-white placeholder-slate-500"/>
                                <select value={buildCat} onChange={e=>setBuildCat(e.target.value)} className="bg-slate-900 border border-slate-600 rounded p-2 text-white"><option>Medical</option><option>Trauma</option></select>
                            </div>
                            <textarea placeholder="Description (e.g. A 45-year-old male found collapsed...)" value={buildDesc} onChange={e=>setBuildDesc(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white h-20 placeholder-slate-500"/>
                            
                            <div className="grid grid-cols-3 gap-2">
                                <div><label className="text-[10px] text-slate-500 uppercase">Heart Rate</label><input type="number" value={buildVitals.hr} onChange={e=>setBuildVitals({...buildVitals, hr: e.target.value})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"/></div>
                                <div><label className="text-[10px] text-slate-500 uppercase">Sys BP</label><input type="number" value={buildVitals.bpSys} onChange={e=>setBuildVitals({...buildVitals, bpSys: e.target.value})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"/></div>
                                <div><label className="text-[10px] text-slate-500 uppercase">Resp Rate</label><input type="number" value={buildVitals.rr} onChange={e=>setBuildVitals({...buildVitals, rr: e.target.value})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"/></div>
                                <div><label className="text-[10px] text-slate-500 uppercase">SpO2 %</label><input type="number" value={buildVitals.spO2} onChange={e=>setBuildVitals({...buildVitals, spO2: e.target.value})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"/></div>
                                <div><label className="text-[10px] text-slate-500 uppercase">GCS</label><input type="number" value={buildVitals.gcs || 15} onChange={e=>setBuildVitals({...buildVitals, gcs: e.target.value})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white" max={15} min={3}/></div>
                                <div><label className="text-[10px] text-slate-500 uppercase">Temp °C</label><input type="number" value={buildVitals.temp || 37} onChange={e=>setBuildVitals({...buildVitals, temp: e.target.value})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"/></div>
                            </div>

                            <div>
                                <label className="text-[10px] text-slate-500 uppercase">Initial Rhythm</label>
                                <select 
                                    onChange={(e) => setBuildVitals({...buildVitals, rhythm: e.target.value})} 
                                    className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"
                                    value={buildVitals.rhythm || "Sinus Rhythm"}
                                >
                                    {['Sinus Rhythm', 'Sinus Tachycardia', 'AF', 'VT', 'VF', 'Asystole', 'PEA', '3rd Deg Block'].map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                            </div>

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
                        <div>
                            <h2 className="text-3xl font-bold text-white mb-2">{scenario.title}</h2>
                            <div className="flex gap-2 mt-2">
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
                    {scenario.ageRange === 'Paediatric' && scenario.wetflag && (
                        <div className="mx-6 mt-4 p-4 bg-purple-900/20 border border-purple-500/50 rounded-lg">
                            <h3 className="text-sm font-bold text-purple-400 uppercase mb-2">WETFLAG Calculation (Est. Weight: {scenario.wetflag.weight}kg)</h3>
                            <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-center">
                                <div className="bg-slate-900 p-2 rounded"><div className="text-[9px] text-slate-500 uppercase">Energy (4J)</div><div className="font-bold text-white">{scenario.wetflag.energy} J</div></div>
                                <div className="bg-slate-900 p-2 rounded"><div className="text-[9px] text-slate-500 uppercase">Tube</div><div className="font-bold text-white">{scenario.wetflag.tube}</div></div>
                                <div className="bg-slate-900 p-2 rounded"><div className="text-[9px] text-slate-500 uppercase">Fluids (10ml)</div><div className="font-bold text-white">{scenario.wetflag.fluids} ml</div></div>
                                <div className="bg-slate-900 p-2 rounded"><div className="text-[9px] text-slate-500 uppercase">Lorazepam</div><div className="font-bold text-white">{scenario.wetflag.lorazepam} mg</div></div>
                                <div className="bg-slate-900 p-2 rounded"><div className="text-[9px] text-slate-500 uppercase">Adrenaline</div><div className="font-bold text-white">{scenario.wetflag.adrenaline} mcg</div></div>
                                <div className="bg-slate-900 p-2 rounded"><div className="text-[9px] text-slate-500 uppercase">Glucose (2ml)</div><div className="font-bold text-white">{scenario.wetflag.glucose} ml</div></div>
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
    };

    // --- SCREEN 4: LIVE SIM CONTROLLER ---
    const LiveSimScreen = ({ sim, onFinish, onBack, sessionID }) => {
        const { INTERVENTIONS, Button, Lucide, Card, VitalDisplay, ECGMonitor, InvestigationButton } = window;
        const { state, start, pause, stop, applyIntervention, addLogEntry, manualUpdateVital, triggerArrest, triggerROSC, revealInvestigation, nextCycle, enableAudio, speak, startTrend, toggleAudioLoop, playSound } = sim;
        const { scenario, time, cycleTimer, isRunning, vitals, prevVitals, log, flash, activeInterventions, interventionCounts, activeDurations, isMuted, rhythm, etco2Enabled, queuedRhythm, cprInProgress, nibp, audioOutput, trends, arrestPanelOpen, waveformGain, noise, remotePacerState, notification, activeLoops, isOffline } = state;
        
        const [activeTab, setActiveTab] = useState("Common");
        const [customLog, setCustomLog] = useState("");
        const [searchResults, setSearchResults] = useState([]);
        const [expandRhythm, setExpandRhythm] = useState(false);
        const [expandArrest, setExpandArrest] = useState(false); 
        const [customSpeech, setCustomSpeech] = useState("");
        const [showLogModal, setShowLogModal] = useState(false);
        const [modalVital, setModalVital] = useState(null); 
        const [modalTarget, setModalTarget] = useState("");
        const [modalTarget2, setModalTarget2] = useState(""); 
        const [trendDuration, setTrendDuration] = useState(30);
        const [gainVal, setGainVal] = useState(waveformGain || 1.0);
        const [showEcg, setShowEcg] = useState(true);

        const tabs = [
            { id: 'Common', icon: 'star' },
            { id: 'Airway', icon: 'wind' },
            { id: 'Breathing', icon: 'activity' }, 
            { id: 'Circulation', icon: 'heart' },
            { id: 'Drugs', icon: 'pill' },
            { id: 'Procedures', icon: 'syringe' },
            { id: 'Voice', icon: 'mic' },
            { id: 'Handover', icon: 'clipboard' }
        ];

        useEffect(() => {
            window.waveformGain = waveformGain;
        }, [waveformGain]);
        
        // Toast Local State
        const [showToast, setShowToast] = useState(false);
        useEffect(() => {
            if(notification && notification.id) {
                setShowToast(true);
                const timer = setTimeout(() => setShowToast(false), 3000);
                return () => clearTimeout(timer);
            }
        }, [notification]);

        // Keyboard Shortcuts
        useEffect(() => {
            const handleKey = (e) => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                if (e.code === 'Space') { e.preventDefault(); }
                if (e.key === 'm') sim.dispatch({ type: 'SET_MUTED', payload: !isMuted });
                if (e.key === 'l') setShowLogModal(true);
            };
            window.addEventListener('keydown', handleKey);
            return () => window.removeEventListener('keydown', handleKey);
        }, [isMuted]);

        const handleGhost = (btnId) => {
            const channel = new BroadcastChannel('sim_channel');
            channel.postMessage({ type: 'GHOST_PRESS', payload: btnId });
        };

        const updateGain = (e) => {
            const v = parseFloat(e.target.value);
            setGainVal(v);
            sim.dispatch({ type: 'SET_GAIN', payload: v });
        };

        const drugCats = {
            "Arrest": ['AdrenalineIV', 'Amiodarone', 'Calcium', 'MagSulph', 'SodiumBicarb', 'Atropine'],
            "Sedation": ['Midazolam', 'Lorazepam', 'Ketamine', 'Morphine', 'Fentanyl', 'Roc', 'Sux', 'Propofol'],
            "Trauma": ['TXA', 'Blood', 'Fluids'],
            "Infusions": ['FluidInfusion', 'InsulinInfusion', 'GTNInfusion', 'Noradrenaline'], 
            "General": ['Paracetamol', 'Ondansetron', 'Antibiotics', 'Hydrocortisone', 'Dexamethasone', 'Nebs', 'AdrenalineIM']
        };
        const mapVoice = (txt) => {
            if (txt.includes('Cough')) return 'Cough, cough, cough';
            if (txt.includes('Scream')) return 'Ahhhhh! Help me!';
            if (txt.includes('Moan')) return 'Ohhhhhh...';
            return txt.replace(/\*/g, '');
        };
        useEffect(() => { if (customLog.length > 1) { const results = Object.keys(INTERVENTIONS).filter(key => (key + INTERVENTIONS[key].label).toLowerCase().includes(customLog.toLowerCase())); setSearchResults(results); } else { setSearchResults([]); } }, [customLog]);
        
        const getInterventionsByCat = (cat) => {
            if (cat === 'Handover' || cat === 'Voice') return [];
            let keys = [];
            if (cat === 'Common') keys = ['Obs', 'Oxygen', 'IV Access', 'Fluids', 'Analgesia', 'Antiemetic', 'Antibiotics', 'Nebs', 'AdrenalineIM', 'Blood', 'TXA', 'ArtLine']; 
            else if (cat === 'Drugs') keys = Object.keys(INTERVENTIONS).filter(key => INTERVENTIONS[key].category === 'Drugs'); 
            else keys = Object.keys(INTERVENTIONS).filter(key => INTERVENTIONS[key].category === cat);
            return keys.sort((a, b) => INTERVENTIONS[a].label.localeCompare(INTERVENTIONS[b].label));
        };
        
        const formatTime = (s) => `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
        const toggleCPR = () => { sim.dispatch({ type: 'TOGGLE_CPR', payload: !cprInProgress }); addLogEntry(!cprInProgress ? 'CPR Started' : 'CPR Stopped', 'action'); };
        const handleShock = () => { applyIntervention('Defib'); if (!cprInProgress) toggleCPR(); };
        const hasMonitoring = activeInterventions.has('Obs'); const hasArtLine = activeInterventions.has('ArtLine');
        const generateSBAR = () => `S: ${scenario.title}.\nB: ${scenario.patientProfileTemplate.replace('{age}', scenario.patientAge)}.\nA: HR ${vitals.hr}, BP ${vitals.bpSys}/${vitals.bpDia}, SpO2 ${vitals.spO2}%.\nR: Review.`;
        const openVitalControl = (key) => { setModalVital(key); setModalTarget(vitals[key === 'bp' ? 'bpSys' : key]); if (key === 'bp') setModalTarget2(vitals.bpDia); setTrendDuration(30); };
        
        const quickAdjust = (amt) => { let current = parseFloat(modalTarget) || 0; setModalTarget(current + amt); if (modalVital === 'bp') { let currentDia = parseFloat(modalTarget2) || 0; setModalTarget2(currentDia + (amt * 0.6)); } };
        
        const confirmVitalUpdate = () => { 
            const targets = {}; 
            const isFloat = ['temp', 'bm', 'etco2', 'pH', 'K', 'Lac'].includes(modalVital);
            
            if (modalVital === 'bp') { 
                targets.bpSys = Math.round(parseFloat(modalTarget)); 
                targets.bpDia = Math.round(parseFloat(modalTarget2)); 
            } else if (modalVital === 'pupils' || modalVital === 'gcs') {
                targets[modalVital] = modalTarget; 
            } else { 
                const raw = parseFloat(modalTarget);
                targets[modalVital] = isFloat ? parseFloat(raw.toFixed(1)) : Math.round(raw); 
            } 
            
            if (trendDuration === 0) { 
                Object.keys(targets).forEach(k => manualUpdateVital(k, targets[k])); 
            } else { 
                startTrend(targets, trendDuration); 
            } 
            setModalVital(null); 
        };
        
        const [annotationText, setAnnotationText] = useState("");
        const addAnnotation = () => { if(annotationText) { addLogEntry(`[NOTE] ${annotationText}`, 'manual'); setAnnotationText(""); } };

        return (
            <div className={`h-full overflow-hidden flex flex-col p-2 bg-slate-900 relative ${flash === 'red' ? 'flash-red' : (flash === 'green' ? 'flash-green' : '')}`}>
                
                {/* --- TOAST NOTIFICATION --- */}
                <div className={`absolute top-24 left-1/2 -translate-x-1/2 z-50 pointer-events-none transition-all duration-300 ${showToast ? 'translate-y-0 opacity-100 scale-100' : '-translate-y-10 opacity-0 scale-90'}`}>
                    {notification && (
                        <div className={`
                            px-8 py-4 rounded-xl shadow-2xl flex items-center gap-4 border-2
                            ${notification.type === 'danger' ? 'bg-red-900/90 border-red-500 text-red-100' : 
                              notification.type === 'success' ? 'bg-emerald-900/90 border-emerald-400 text-emerald-100' : 
                              'bg-slate-800/90 border-sky-500 text-sky-100'}
                        `}>
                            {notification.type === 'success' && <Lucide icon="check-circle" className="w-10 h-10 text-emerald-400" />}
                            {notification.type === 'danger' && <Lucide icon="alert-triangle" className="w-10 h-10 text-red-500" />}
                            <div>
                                <div className="text-[10px] uppercase font-bold opacity-80 tracking-widest">System Notification</div>
                                <div className="text-3xl font-bold font-mono tracking-tight">{notification.msg}</div>
                            </div>
                        </div>
                    )}
                </div>

                {/* --- HEADER --- */}
                <div className="flex justify-between items-center bg-slate-800 p-2 rounded mb-2 border border-slate-700">
                    <div className="flex gap-2 items-center">
                        <Button variant="secondary" onClick={onBack} className="h-8 px-2"><Lucide icon="arrow-left"/> Back</Button>
                        {!isRunning ? ( <Button variant="success" onClick={start} className="h-8 px-4 font-bold"><Lucide icon="play"/> START</Button> ) : ( <Button variant="warning" onClick={pause} className="h-8 px-4"><Lucide icon="pause"/> PAUSE</Button> )}
                        <Button variant="danger" onClick={() => { if(window.confirm("End scenario and go to debrief?")) onFinish(); }} className="h-8 px-4 font-bold border border-red-500 bg-red-900/50 hover:bg-red-800"><Lucide icon="square" className="fill-current"/> FINISH</Button>
                        
                        <div className="h-8 w-px bg-slate-600 mx-1"></div>
                        
                        <Button onClick={() => sim.dispatch({ type: 'SET_MUTED', payload: !isMuted })} variant={isMuted ? "danger" : "secondary"} className="h-8 px-2" title="Toggle Mute (M)">
                            <Lucide icon={isMuted ? "volume-x" : "volume-2"} />
                        </Button>

                        <Button onClick={() => {
                            const modes = ['monitor', 'controller', 'both'];
                            const next = modes[(modes.indexOf(audioOutput || 'monitor') + 1) % modes.length];
                            sim.dispatch({ type: 'SET_AUDIO_OUTPUT', payload: next });
                        }} variant="outline" className="h-8 px-2 text-[10px] w-24" title="Audio Output Source">
                            <span className="truncate">{audioOutput === 'both' ? 'Sound: ALL' : audioOutput === 'controller' ? 'Sound: PAD' : 'Sound: MON'}</span>
                        </Button>

                        <Button onClick={() => setShowLogModal(true)} variant="secondary" className="h-8 px-2" title="View Log (L)">
                            <Lucide icon="scroll-text" />
                        </Button>

                        <Button variant="outline" onClick={() => window.open(window.location.href.split('?')[0] + '?mode=monitor&session=' + sessionID, '_blank', 'width=1280,height=720')} className="h-8 px-2 text-xs"><Lucide icon="external-link"/> Monitor</Button>
                        
                        {/* Offline Indicator */}
                        {isOffline && (
                            <div className="flex items-center gap-1 bg-red-500/20 text-red-400 px-2 py-1 rounded border border-red-500/50 text-[10px] font-bold uppercase animate-pulse">
                                <Lucide icon="wifi-off" className="w-3 h-3" /> OFFLINE
                            </div>
                        )}
                    </div>
                    <div className="hidden md:flex flex-col ml-4 px-3 border-l border-slate-600"><span className="text-[10px] text-slate-400 uppercase font-bold">Patient</span><span className="text-white font-bold">{scenario.patientAge}y {scenario.sex}</span></div>
                </div>

                {/* --- ARREST OVERLAY --- */}
                {arrestPanelOpen && (
                    <div className="lg:col-span-3 bg-red-900/20 border border-red-500 p-4 rounded-lg flex flex-col md:flex-row gap-4 animate-fadeIn mb-2 shadow-2xl">
                        <div className="flex-1 flex flex-col justify-center items-center bg-slate-900/80 p-4 rounded border border-red-500/50">
                            <h3 className="text-red-500 font-bold uppercase tracking-widest mb-1">Cycle Timer</h3>
                            <div className={`text-5xl font-mono font-bold ${cycleTimer > 120 ? 'text-red-500 animate-pulse' : 'text-white'}`}>{formatTime(cycleTimer)}</div>
                            <div className="flex gap-2 mt-2">
                                <Button variant="secondary" onClick={() => sim.dispatch({type: 'RESET_CYCLE_TIMER'})} className="h-8 text-xs">Reset</Button>
                                <Button variant="secondary" onClick={() => { const remaining = Math.max(0, 120 - cycleTimer); if(remaining > 0) sim.dispatch({type: 'FAST_FORWARD', payload: remaining}); sim.dispatch({type: 'RESET_CYCLE_TIMER'}); addLogEntry("Cycle Skipped / Finished", "system"); }} className="h-8 text-xs">Finish Cycle</Button>
                            </div>
                        </div>
                        <div className="flex-[3] grid grid-cols-2 md:grid-cols-4 gap-3">
                            <Button onClick={toggleCPR} variant={cprInProgress ? "warning" : "danger"} className="h-16 text-xl font-bold border-4 border-double">{cprInProgress ? "STOP CPR" : "START CPR"}</Button>
                            <Button onClick={handleShock} variant="warning" className="h-16 text-xl font-bold flex flex-col"><Lucide icon="zap" /> SHOCK</Button>
                            <Button onClick={() => applyIntervention('AdrenalineIV')} variant={interventionCounts['AdrenalineIV'] > 0 ? "success" : "outline"} className="h-16 font-bold flex flex-col"><span>Adrenaline</span><span className="text-[10px] opacity-70">1mg 1:10k</span>{interventionCounts['AdrenalineIV'] > 0 && <span className="absolute top-1 right-1 bg-white text-black text-[9px] px-1 rounded-full">x{interventionCounts['AdrenalineIV']}</span>}</Button>
                            <Button onClick={() => applyIntervention('Amiodarone')} variant={interventionCounts['Amiodarone'] > 0 ? "success" : "outline"} className="h-16 font-bold flex flex-col"><span>Amiodarone</span><span className="text-[10px] opacity-70">300mg</span>{interventionCounts['Amiodarone'] > 0 && <span className="absolute top-1 right-1 bg-white text-black text-[9px] px-1 rounded-full">x{interventionCounts['Amiodarone']}</span>}</Button>
                        </div>
                        <div className="flex-1 flex flex-col gap-2">
                            <h4 className="text-xs font-bold text-red-400 uppercase">4 H's & 4 T's</h4>
                            <div className="grid grid-cols-2 gap-1 text-[10px] text-slate-300"><div>Hypoxia</div><div>Thrombosis</div><div>Hypovolaemia</div><div>Tension #</div><div>Hyper/Hypo-K</div><div>Tamponade</div><div>Hypothermia</div><div>Toxins</div></div>
                            <Button onClick={() => sim.dispatch({type: 'SET_ARREST_PANEL', payload: false})} variant="secondary" className="mt-auto">Exit Arrest Mode</Button>
                        </div>
                    </div>
                )}

                <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-2 overflow-hidden min-h-0">
                    <div className="lg:col-span-4 flex flex-col gap-2 overflow-y-auto">
                        
                        {/* --- PATIENT INFO CARD --- */}
                        <div className="bg-slate-800 p-2 rounded border border-slate-600 flex-shrink-0">
                            <h4 className="text-[10px] font-bold text-sky-400 uppercase mb-1 flex items-center gap-2"><Lucide icon="user" className="w-3 h-3"/> {scenario.patientName} ({scenario.patientAge} {scenario.sex})</h4>
                            <div className="grid grid-cols-1 gap-1 text-[10px] text-slate-300">
                                <div className="truncate"><span className="text-slate-500 font-bold">PMH:</span> {scenario.pmh ? scenario.pmh.join(', ') : 'Nil'}</div>
                                <div className="truncate"><span className="text-slate-500 font-bold">Rx:</span> {scenario.dhx ? scenario.dhx.join(', ') : 'Nil'}</div>
                                <div className="truncate"><span className="text-slate-500 font-bold">All:</span> <span className="text-red-400 font-bold">{scenario.allergies ? scenario.allergies.join(', ') : 'NKDA'}</span></div>
                            </div>
                        </div>

                        {/* --- MONITOR CARD (Collapsible) --- */}
                        <div className="bg-slate-800 p-2 rounded border border-slate-600 relative z-10 flex-shrink-0">
                            <div className="flex justify-between items-center mb-1">
                                <h4 className="text-[10px] font-bold text-sky-400 uppercase flex items-center gap-2">
                                    <Lucide icon="activity" className="w-3 h-3"/> Monitor
                                </h4>
                                <button onClick={() => setShowEcg(!showEcg)} className="text-slate-400 hover:text-white">
                                    <Lucide icon={showEcg ? "minimize-2" : "maximize-2"} className="w-3 h-3" />
                                </button>
                            </div>
                            
                            <div className={`transition-all duration-300 overflow-hidden ${showEcg ? 'h-32 opacity-100' : 'h-0 opacity-0'}`}>
                                <ECGMonitor rhythmType={rhythm} hr={vitals.hr} rr={vitals.rr} spO2={vitals.spO2} isPaused={!isRunning} showEtco2={etco2Enabled} pathology={scenario?.deterioration?.type} showTraces={hasMonitoring} showArt={hasArtLine} isCPR={cprInProgress} className="h-full"/>
                            </div>

                            <div className="grid grid-cols-4 gap-1 p-1 bg-black rounded mt-1">
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
                        </div>
                        
                        {/* --- WETFLAG HELPER (If Paediatric) --- */}
                        {scenario.ageRange === 'Paediatric' && scenario.wetflag && (
                            <div className="bg-purple-900/30 p-2 rounded border border-purple-500/50">
                                <h4 className="text-[10px] font-bold text-purple-400 uppercase mb-1">WETFLAG Safety (Wt: {scenario.wetflag.weight}kg)</h4>
                                <div className="grid grid-cols-3 gap-1 text-[10px] text-slate-300">
                                    <div className="bg-slate-900 px-2 py-1 rounded flex justify-between"><span>Energy</span><span className="font-bold text-white">{scenario.wetflag.energy}J</span></div>
                                    <div className="bg-slate-900 px-2 py-1 rounded flex justify-between"><span>Fluid</span><span className="font-bold text-white">{scenario.wetflag.fluids}ml</span></div>
                                    <div className="bg-slate-900 px-2 py-1 rounded flex justify-between"><span>Adren</span><span className="font-bold text-white">{scenario.wetflag.adrenaline}mcg</span></div>
                                </div>
                            </div>
                        )}

                        {/* --- NEW: WAVEFORM CONTROLS --- */}
                        <div className="bg-slate-800 p-2 rounded border border-slate-600">
                            <h4 className="text-[10px] font-bold text-sky-400 uppercase mb-2">Waveform Control</h4>
                            <div className="flex items-center gap-2 mb-2">
                                <span className="text-xs w-12 text-slate-400">Gain: {gainVal}x</span>
                                <input type="range" min="0.5" max="2.0" step="0.1" value={gainVal} onChange={updateGain} className="flex-1 h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer" />
                            </div>
                            <label className="flex items-center gap-2 text-xs cursor-pointer select-none text-slate-300 hover:text-white">
                                <input type="checkbox" checked={noise?.interference || false} onChange={() => sim.dispatch({ type: 'TOGGLE_INTERFERENCE' })} className="rounded bg-slate-700 border-slate-500" />
                                60Hz Interference (Buzz)
                            </label>
                        </div>

                        {/* --- NEW: CONTINUOUS SOUNDS --- */}
                        <div className="bg-slate-800 p-2 rounded border border-slate-600">
                            <h4 className="text-[10px] font-bold text-sky-400 uppercase mb-2">Continuous Sounds</h4>
                            <div className="flex gap-2">
                                <Button onClick={() => toggleAudioLoop('Wheeze')} variant={activeLoops['Wheeze'] ? "warning" : "outline"} className="flex-1 h-8 text-xs">
                                    Wheeze {activeLoops['Wheeze'] && <Lucide icon="activity" className="animate-pulse w-3 h-3 ml-2"/>}
                                </Button>
                                <Button onClick={() => toggleAudioLoop('Stridor')} variant={activeLoops['Stridor'] ? "warning" : "outline"} className="flex-1 h-8 text-xs">
                                    Stridor {activeLoops['Stridor'] && <Lucide icon="activity" className="animate-pulse w-3 h-3 ml-2"/>}
                                </Button>
                            </div>
                        </div>

                        {/* --- NEW: REMOTE DEMO ACTIONS --- */}
                        <div className="bg-slate-800 p-2 rounded border border-slate-600">
                            <h4 className="text-[10px] font-bold text-purple-400 uppercase mb-2">Remote Demo (Ghost)</h4>
                            <div className="grid grid-cols-2 gap-2">
                                <button onClick={() => handleGhost('chargeBtn')} className="bg-slate-700 hover:bg-slate-600 text-xs py-1 rounded border border-slate-500 transition-colors">Press Charge</button>
                                <button onClick={() => handleGhost('shockBtn')} className="bg-slate-700 hover:bg-slate-600 text-xs py-1 rounded border border-slate-500 transition-colors">Press Shock</button>
                                <button onClick={() => handleGhost('syncBtn')} className="bg-slate-700 hover:bg-slate-600 text-xs py-1 rounded border border-slate-500 transition-colors">Toggle Sync</button>
                                <button onClick={() => handleGhost('analyseBtn')} className="bg-slate-700 hover:bg-slate-600 text-xs py-1 rounded border border-slate-500 transition-colors">Press Analyse</button>
                            </div>
                        </div>

                        {/* --- NEW: PACER FEEDBACK --- */}
                        <div className="bg-slate-900/50 p-2 rounded border border-slate-700">
                            <h4 className="text-[10px] font-bold text-slate-500 uppercase">Remote Pacer State</h4>
                            <div className="flex justify-between text-xs font-mono text-green-400 mt-1">
                                <span>Rate: {remotePacerState?.rate || 0} ppm</span>
                                <span>Output: {remotePacerState?.output || 0} mA</span>
                            </div>
                        </div>

                        <div className="bg-slate-800 p-2 rounded border border-slate-600 relative z-10">
                            <h4 className="text-[10px] font-bold text-green-400 uppercase mb-1">Rhythm & Arrest</h4>
                            <div className="grid grid-cols-2 gap-1 mb-2">
                                <div className="relative">
                                     <Button onClick={() => setExpandArrest(!expandArrest)} variant="danger" className="h-8 text-xs w-full justify-between">Trigger Arrest... <Lucide icon="chevron-down" className="w-3 h-3"/></Button>
                                     {expandArrest && (
                                         <div className="absolute top-full left-0 w-full bg-slate-800 border border-slate-500 rounded shadow-xl mt-1 z-50">
                                             {['VF', 'PEA', 'pVT', 'Asystole'].map(type => (
                                                 <button key={type} onClick={() => { triggerArrest(type); setExpandArrest(false); }} className="block w-full text-left px-3 py-2 text-xs text-white hover:bg-red-900 border-b border-slate-700">{type}</button>
                                             ))}
                                         </div>
                                     )}
                                </div>
                                <Button onClick={triggerROSC} variant="success" className="h-8 text-xs">ROSC</Button>
                            </div>
                            
                            {/* --- NEXT SHOCK OUTCOME --- */}
                            <div className="bg-slate-900/50 p-2 rounded border border-slate-700 mb-2">
                                <h5 className="text-[9px] font-bold text-slate-400 uppercase mb-1">Next Shock Outcome</h5>
                                <div className="grid grid-cols-2 gap-1">
                                    <button onClick={() => sim.dispatch({type: 'SET_QUEUED_RHYTHM', payload: 'ROSC'})} className={`text-[10px] p-1 rounded border ${queuedRhythm === 'ROSC' ? 'bg-green-700 border-green-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-400'}`}>Convert (ROSC)</button>
                                    <button onClick={() => sim.dispatch({type: 'SET_QUEUED_RHYTHM', payload: 'VF'})} className={`text-[10px] p-1 rounded border ${queuedRhythm === 'VF' ? 'bg-red-700 border-red-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-400'}`}>Fail (Refractory)</button>
                                    <button onClick={() => sim.dispatch({type: 'SET_QUEUED_RHYTHM', payload: 'Asystole'})} className={`text-[10px] p-1 rounded border ${queuedRhythm === 'Asystole' ? 'bg-slate-700 border-slate-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-400'}`}>To Asystole</button>
                                    <button onClick={() => sim.dispatch({type: 'SET_QUEUED_RHYTHM', payload: 'PEA'})} className={`text-[10px] p-1 rounded border ${queuedRhythm === 'PEA' ? 'bg-amber-700 border-amber-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-400'}`}>To PEA</button>
                                </div>
                                {queuedRhythm && <div className="text-[9px] text-sky-400 text-center mt-1">Pending: {queuedRhythm}</div>}
                            </div>

                            <div className="relative">
                                <Button onClick={() => setExpandRhythm(!expandRhythm)} variant="secondary" className="w-full h-8 text-xs justify-between">{rhythm} <Lucide icon="chevron-down" className="w-3 h-3"/></Button>
                                {expandRhythm && (<div className="absolute top-full left-0 w-full bg-slate-800 border border-slate-500 rounded shadow-xl max-h-60 overflow-y-auto mt-1 z-50">{['Sinus Rhythm', 'Sinus Tachycardia', 'Sinus Bradycardia', 'AF', 'SVT', 'VT', 'VF', 'Asystole', 'PEA', '1st Deg Block', '3rd Deg Block'].map(r => (<button key={r} onClick={() => {sim.dispatch({type: 'UPDATE_RHYTHM', payload: r}); setExpandRhythm(false);}} className="block w-full text-left px-3 py-2 text-xs text-white hover:bg-sky-600 border-b border-slate-700">{r}</button>))}</div>)}
                            </div>
                            <Button onClick={() => sim.dispatch({type: 'SET_ARREST_PANEL', payload: !arrestPanelOpen})} variant={arrestPanelOpen ? "danger" : "outline"} className="w-full h-8 mt-2 text-xs">{arrestPanelOpen ? "Close Arrest Panel" : "Open Arrest Panel"}</Button>
                        </div>
                    </div>
                    
                    <div className="lg:col-span-8 flex flex-col bg-slate-800 rounded border border-slate-700 overflow-hidden">
                        {/* --- NEW TAB BAR --- */}
                        <div className="flex overflow-x-auto bg-slate-900 border-b border-slate-700 no-scrollbar">
                            {tabs.map(tab => (
                                <button 
                                    key={tab.id} 
                                    onClick={() => setActiveTab(tab.id)} 
                                    className={`flex-1 min-w-[80px] py-3 flex flex-col items-center justify-center gap-1 transition-colors ${activeTab === tab.id ? 'bg-slate-800 text-sky-400 border-t-4 border-sky-400' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'}`}
                                >
                                    <Lucide icon={tab.icon} className={`w-5 h-5 ${activeTab === tab.id ? 'stroke-2' : 'stroke-1'}`} />
                                    <span className="text-[10px] font-bold uppercase tracking-wider">{tab.id}</span>
                                </button>
                            ))}
                        </div>
                        
                        <div className="flex-1 p-2 overflow-y-auto bg-slate-800 relative">
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
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                        {["I can't breathe", "My chest hurts", "I feel sick", "My head hurts", "I'm scared", "Can I have some water?", "Yes", "No", "I don't know", "*Coughing*", "*Screaming*", "*Moaning*"].map(txt => (<Button key={txt} onClick={() => speak(mapVoice(txt))} variant="secondary" className="h-12 text-xs">{txt}</Button>))}
                                    </div>
                                    <div className="flex gap-2 pt-4 border-t border-slate-700 mt-4"><input type="text" value={customSpeech} onChange={e => setCustomSpeech(e.target.value)} placeholder="Type custom phrase..." className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 text-white" /><Button onClick={() => { speak(customSpeech); setCustomSpeech(""); }}>Speak</Button></div>
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
                                                    const isActive = activeInterventions.has(key);
                                                    return (
                                                        <button key={key} onClick={() => applyIntervention(key)} className={`relative h-14 p-2 rounded text-left bg-slate-700 hover:bg-slate-600 border border-slate-600 flex flex-col justify-between overflow-hidden`}>
                                                            <span className="text-xs font-bold leading-tight">{action.label}</span>
                                                            {/* REMOVE BUTTON for Drugs */}
                                                            {isActive && action.type === 'continuous' && <div className="absolute top-1 right-1 text-red-400 bg-slate-900 rounded-full p-0.5"><Lucide icon="x" className="w-3 h-3"/></div>}
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
                                                {/* REMOVE BUTTON INDICATOR */}
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
                        <div className="bg-slate-900 p-2 border-t border-slate-700 flex gap-2">
                            <input type="text" className="bg-slate-800 border border-slate-600 rounded px-3 text-xs flex-1 text-white" placeholder="Search..." value={customLog} onChange={e=>setCustomLog(e.target.value)} onKeyDown={e => e.key === 'Enter' && (addLogEntry(customLog, 'manual') || setCustomLog(""))} />
                            <Button onClick={() => {sim.dispatch({type: 'TRIGGER_IMPROVE'}); addLogEntry("Patient Improving (Trend)", "success")}} className="h-8 text-xs px-2 bg-emerald-900 border border-emerald-500 text-emerald-100 relative overflow-hidden">{trends.active && flash === 'green' && (<div className="absolute inset-0 bg-emerald-500/30 z-0 transition-all duration-1000" style={{ width: `${Math.min(100, (trends.elapsed / trends.duration) * 100)}%` }}></div>)}<span className="relative z-10">Improve</span></Button>
                            <Button onClick={() => {sim.dispatch({type: 'TRIGGER_DETERIORATE'}); addLogEntry("Patient Deteriorating (Trend)", "danger")}} className="h-8 text-xs px-2 bg-red-900 border border-red-500 text-red-100 relative overflow-hidden">{trends.active && flash === 'red' && (<div className="absolute inset-0 bg-red-500/30 z-0 transition-all duration-1000" style={{ width: `${Math.min(100, (trends.elapsed / trends.duration) * 100)}%` }}></div>)}<span className="relative z-10">Worsen</span></Button>
                        </div>
                    </div>
                </div>

                {/* --- MODAL VITAL CONTROL --- */}
                {modalVital && (
                    <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn">
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-sm shadow-2xl">
                            <h3 className="text-lg font-bold text-white mb-4 uppercase tracking-wider">Control: {modalVital}</h3>
                            <div className="space-y-4">
                                <div className="flex gap-2 justify-center mb-4">
                                    {(() => {
                                        let steps = [-20, -10, 10, 20];
                                        if (['temp', 'bm', 'etco2', 'pH', 'K', 'Lac'].includes(modalVital)) steps = [-1, -0.5, 0.5, 1];
                                        if (['gcs', 'rr', 'pupils'].includes(modalVital)) steps = [-2, -1, 1, 2];
                                        if (modalVital === 'spO2') steps = [-5, -2, 2, 5];
                                        return steps.map(step => (
                                            <Button key={step} onClick={()=>quickAdjust(step)} variant="secondary" className="w-12 text-sm font-bold">{step > 0 ? `+${step}` : step}</Button>
                                        ));
                                    })()}
                                </div>
                                <div><label className="text-xs text-slate-400 font-bold uppercase">Target Value</label><input type={modalVital === 'pupils' ? "text" : "number"} value={modalTarget} onChange={e=>setModalTarget(e.target.value)} className="w-full bg-slate-900 border border-slate-500 rounded p-3 text-xl font-mono text-white text-center font-bold" autoFocus /></div>
                                {modalVital === 'bp' && <div><label className="text-xs text-slate-400 font-bold uppercase">Diastolic</label><input type="number" value={modalTarget2} onChange={e=>setModalTarget2(e.target.value)} className="w-full bg-slate-900 border border-slate-500 rounded p-3 text-xl font-mono text-white text-center font-bold" /></div>}
                                <div className="grid grid-cols-4 gap-1 mt-2">
                                    <button onClick={()=>setTrendDuration(0)} className={`p-2 rounded text-[10px] font-bold border ${trendDuration===0 ? 'bg-sky-600 text-white border-sky-400' : 'bg-slate-700 text-slate-400 border-slate-600'}`}>Instant</button>
                                    <button onClick={()=>setTrendDuration(30)} className={`p-2 rounded text-[10px] font-bold border ${trendDuration===30 ? 'bg-sky-600 text-white border-sky-400' : 'bg-slate-700 text-slate-400 border-slate-600'}`}>30s</button>
                                    <button onClick={()=>setTrendDuration(120)} className={`p-2 rounded text-[10px] font-bold border ${trendDuration===120 ? 'bg-sky-600 text-white border-sky-400' : 'bg-slate-700 text-slate-400 border-slate-600'}`}>2m</button>
                                    <button onClick={()=>setTrendDuration(300)} className={`p-2 rounded text-[10px] font-bold border ${trendDuration===300 ? 'bg-sky-600 text-white border-sky-400' : 'bg-slate-700 text-slate-400 border-slate-600'}`}>5m</button>
                                </div>
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

    // --- SCREEN 5: MONITOR ---
    const MonitorScreen = ({ sim }) => {
        const { Card, VitalDisplay, ECGMonitor, Lucide } = window;
        const { state } = sim;
        const { 
            scenario, rhythm, vitals, isRunning, etco2Enabled, cprInProgress, 
            activeInterventions, time, notification, waveformGain, noise,
            monitorPopup, investigationsRevealed, isMuted, lastUpdate 
        } = state;
        
        const [showToast, setShowToast] = useState(false);
        const [showPopup, setShowPopup] = useState(null);
        const [isConnected, setIsConnected] = useState(true);

        useEffect(() => {
            window.waveformGain = waveformGain || 1.0;
            window.noise = noise || {};
        }, [waveformGain, noise]);

        useEffect(() => {
            if(notification && notification.id) {
                setShowToast(true);
                const timer = setTimeout(() => setShowToast(false), 4000);
                return () => clearTimeout(timer);
            }
        }, [notification]);

        useEffect(() => {
            if (monitorPopup && monitorPopup.timestamp) {
                if (Date.now() - monitorPopup.timestamp < 10000) {
                    setShowPopup(monitorPopup.type);
                    const timer = setTimeout(() => setShowPopup(null), 15000);
                    return () => clearTimeout(timer);
                }
            }
        }, [monitorPopup]);

        useEffect(() => {
            const interval = setInterval(() => {
                const connected = Date.now() - (lastUpdate || 0) < 5000;
                setIsConnected(connected);
            }, 1000);
            return () => clearInterval(interval);
        }, [lastUpdate]);

        const hasMonitoring = activeInterventions.has('Obs');
        const hasArtLine = activeInterventions.has('ArtLine');

        const getResultContent = (type) => {
            if (!scenario) return "No Data";
            if (type === 'VBG' && scenario.vbg) {
                const v = scenario.vbg;
                return (
                    <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-2xl font-mono text-emerald-400">
                        <div>pH: <span className="text-white">{v.pH.toFixed(2)}</span></div>
                        <div>pCO2: <span className="text-white">{v.pCO2.toFixed(1)}</span></div>
                        <div>HCO3: <span className="text-white">{v.HCO3.toFixed(1)}</span></div>
                        <div>Lac: <span className="text-red-400">{v.Lac.toFixed(1)}</span></div>
                        <div>K+: <span className={v.K > 5.5 || v.K < 3.5 ? "text-red-400" : "text-white"}>{v.K.toFixed(1)}</span></div>
                        <div>Glu: <span className="text-white">{v.Glu.toFixed(1)}</span></div>
                    </div>
                );
            }
            if (type === 'X-ray') return <div className="text-xl text-white">{scenario.chestXray?.findings || "Normal"}</div>;
            if (type === 'CT') return <div className="text-xl text-white">{scenario.ct?.findings || "No acute abnormality"}</div>;
            return <div className="text-xl text-slate-300">Result Available on Controller</div>;
        };

        const formatSimTime = (s) => {
            const m = Math.floor(s / 60).toString().padStart(2, '0');
            const sec = (s % 60).toString().padStart(2, '0');
            return `${m}:${sec}`;
        };

        return (
            <div className="h-full bg-black p-2 md:p-4 flex flex-col gap-2 relative overflow-hidden font-sans select-none">
                
                {/* --- TOAST --- */}
                <div className={`absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-slate-800 border-l-4 rounded shadow-2xl px-6 py-4 flex items-center gap-4 transition-all duration-500 transform ${showToast ? 'translate-y-0 opacity-100 scale-100' : '-translate-y-10 opacity-0 scale-90 pointer-events-none'} ${notification?.type === 'danger' ? 'border-red-500' : 'border-sky-500'}`}>
                    <Lucide icon={notification?.type === 'danger' ? 'alert-circle' : 'info'} className={`w-8 h-8 ${notification?.type === 'danger' ? 'text-red-500' : 'text-sky-500'}`} />
                    <span className="font-bold text-white text-2xl tracking-wide">{notification?.msg}</span>
                </div>

                {/* --- POPUP --- */}
                {showPopup && (
                    <div className="absolute inset-0 z-40 bg-black/80 flex items-center justify-center p-8 backdrop-blur-sm animate-fadeIn" onClick={() => setShowPopup(null)}>
                        <div className="bg-slate-900 border-2 border-slate-600 rounded-xl p-6 max-w-3xl w-full shadow-2xl relative">
                            <div className="flex justify-between items-center mb-6 border-b border-slate-700 pb-4">
                                <h2 className="text-3xl font-bold text-sky-400 flex items-center gap-3"><Lucide icon="file-text" className="w-8 h-8" /> New Result: {showPopup}</h2>
                                <div className="text-slate-500 text-sm uppercase font-bold tracking-widest">Tap to Dismiss</div>
                            </div>
                            <div className="p-4 bg-black/50 rounded border border-slate-800 min-h-[150px] flex items-center justify-center">{getResultContent(showPopup)}</div>
                        </div>
                    </div>
                )}

                {/* --- HEADER --- */}
                <div className="flex justify-between items-center bg-slate-900/50 px-4 py-2 rounded border border-slate-800 flex-shrink-0">
                    <div className="flex items-center gap-6">
                        <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-emerald-500 shadow-[0_0_10px_#10b981]' : 'bg-red-500 animate-pulse'}`} title={isConnected ? "Connected" : "Disconnected"}></div>
                        
                        {scenario && (
                            <div className="flex flex-col">
                                <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Patient</span>
                                <span className="text-slate-300 font-bold text-lg leading-none">{scenario.patientName || "Unknown"}</span>
                            </div>
                        )}
                        {scenario && (
                            <div className="flex flex-col">
                                <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Age/Sex</span>
                                <span className="text-slate-300 font-bold text-lg leading-none">{scenario.patientAge} {scenario.sex === 'Male' ? 'M' : 'F'}</span>
                            </div>
                        )}
                    </div>
                    
                    <div className="flex items-center gap-4">
                        {cprInProgress && <div className="bg-red-600 text-white px-6 py-1 rounded font-bold animate-pulse tracking-widest text-xl shadow-[0_0_15px_rgba(220,38,38,0.7)]">CPR IN PROGRESS</div>}
                        {isMuted && <div className="text-red-500 flex items-center gap-1 font-bold bg-red-900/20 px-2 rounded"><Lucide icon="volume-x" className="w-4 h-4"/> MUTED</div>}
                        <div className="bg-black/40 px-3 py-1 rounded text-sky-500 font-mono text-xl font-bold border border-slate-700">{formatSimTime(time)}</div>
                    </div>
                </div>

                {/* --- MAIN DISPLAY --- */}
                <div className="flex-grow flex flex-col min-h-0 bg-black rounded border border-slate-800 overflow-hidden relative">
                     <ECGMonitor 
                        rhythmType={rhythm} hr={vitals.hr} rr={vitals.rr} spO2={vitals.spO2} isPaused={!isRunning} 
                        showEtco2={etco2Enabled} pathology={scenario?.deterioration?.type} showTraces={hasMonitoring} 
                        showArt={hasArtLine} isCPR={cprInProgress} className="flex-grow" 
                    />
                     
                     <div className="grid grid-cols-4 gap-1 md:gap-2 p-1 md:p-2 bg-black h-36 md:h-48 flex-shrink-0 border-t border-slate-900 z-10">
                         <VitalDisplay label="Heart Rate" value={vitals.hr} unit="bpm" isMonitor={true} visible={hasMonitoring} alert={vitals.hr < 40 || vitals.hr > 140} />
                         <VitalDisplay 
                            label="NIBP" value={vitals.bpSys} value2={vitals.bpDia} unit="mmHg" 
                            isMonitor={true} visible={hasMonitoring} isNIBP={true} 
                            lastNIBP={sim.state.nibp?.lastTaken} 
                            history={sim.state.nibp?.history}
                            alert={vitals.bpSys < 90 && vitals.bpSys > 0} 
                         />
                         <VitalDisplay label="SpO2" value={vitals.spO2} unit="%" isMonitor={true} visible={hasMonitoring} alert={vitals.spO2 < 90} />
                         {etco2Enabled ? 
                            <VitalDisplay label="ETCO2" value={vitals.etco2} unit="kPa" isMonitor={true} visible={true} /> : 
                            <VitalDisplay label="Resp Rate" value={vitals.rr} unit="rpm" isMonitor={true} visible={hasMonitoring} alert={vitals.rr < 8 || vitals.rr > 30} />
                         }
                     </div>
                </div>

                {/* --- SECONDARY VITALS --- */}
                <div className="flex gap-2 h-16 flex-shrink-0">
                    <div className="flex-1 bg-slate-900/80 rounded border border-slate-700 flex items-center justify-between px-4">
                        <span className="text-slate-500 text-xs font-bold uppercase tracking-wider">Temp</span>
                        <div className="flex items-baseline gap-1"><span className={`text-3xl font-mono font-bold ${vitals.temp > 38 || vitals.temp < 36 ? 'text-red-400' : 'text-white'}`}>{vitals.temp}</span><span className="text-slate-500 text-sm">°C</span></div>
                    </div>
                    <div className="flex-1 bg-slate-900/80 rounded border border-slate-700 flex items-center justify-between px-4">
                        <span className="text-slate-500 text-xs font-bold uppercase tracking-wider">Glucose</span>
                        <div className="flex items-baseline gap-1"><span className={`text-3xl font-mono font-bold ${vitals.bm < 4 || vitals.bm > 20 ? 'text-red-400' : 'text-white'}`}>{vitals.bm}</span><span className="text-slate-500 text-sm">mmol/L</span></div>
                    </div>
                    <div className="flex-1 bg-slate-900/80 rounded border border-slate-700 flex items-center justify-between px-4">
                        <span className="text-slate-500 text-xs font-bold uppercase tracking-wider">GCS</span>
                        <div className="flex items-baseline gap-1"><span className={`text-3xl font-mono font-bold ${vitals.gcs < 15 ? 'text-amber-400' : 'text-white'}`}>{vitals.gcs}</span><span className="text-slate-500 text-sm">/15</span></div>
                    </div>
                </div>
            </div>
        );
    };
    // --- SCREEN 6: DEBRIEF ---
    const DebriefScreen = ({ sim, onRestart }) => {
        const { Button, Lucide, Card } = window;
        const { state } = sim; const { log, scenario, history, completedObjectives } = state; const chartRef = useRef(null);
        
        const defaultObjectives = ["Airway Assessment", "Breathing Assessment", "Circulation Assessment", "Disability Assessment", "Exposure"];
        const scenarioObjectives = scenario?.instructorBrief?.learningObjectives || defaultObjectives;

        useEffect(() => { 
            if (!chartRef.current || !history.length) return; 
            if (!window.Chart) return;
            const ctx = chartRef.current.getContext('2d'); 
            if (window.myChart) window.myChart.destroy(); 
            
            const eventPoints = history.map(h => {
                const event = log.find(l => l.type === 'action' && Math.abs(l.timeSeconds - h.time) < 2);
                return event ? 10 : null;
            });

            window.myChart = new window.Chart(ctx, { 
                type: 'line', 
                data: { 
                    labels: history.map(h => `${Math.floor(h.time/60)}:${(h.time%60).toString().padStart(2,'0')}`), 
                    datasets: [ 
                        { label: 'HR', data: history.map(h => h.hr), borderColor: '#ef4444', borderWidth: 2, pointRadius: 0, tension: 0.1 }, 
                        { label: 'Sys BP', data: history.map(h => h.bp), borderColor: '#3b82f6', borderWidth: 2, pointRadius: 0, tension: 0.1 },
                        { label: 'SpO2', data: history.map(h => h.spo2), borderColor: '#22d3ee', borderWidth: 2, pointRadius: 0, tension: 0.1 },
                        { label: 'RR', data: history.map(h => h.rr), borderColor: '#fbbf24', borderWidth: 2, pointRadius: 0, tension: 0.1 },
                        { 
                            label: 'Interventions', 
                            data: history.map(h => {
                                const e = log.find(l => l.type === 'action' && Math.abs(l.timeSeconds - h.time) < 3);
                                return e ? 5 : null; 
                            }),
                            borderColor: '#ffffff',
                            backgroundColor: '#ffffff',
                            pointRadius: 4,
                            pointHoverRadius: 6,
                            showLine: false,
                            pointStyle: 'triangle'
                        }
                    ] 
                }, 
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    scales: { y: { min: 0 } },
                    plugins: {
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    if (context.dataset.label === 'Interventions') {
                                        const idx = context.dataIndex;
                                        const time = history[idx].time;
                                        const e = log.find(l => l.type === 'action' && Math.abs(l.timeSeconds - time) < 3);
                                        return e ? e.msg : '';
                                    }
                                    return context.dataset.label + ': ' + context.raw;
                                }
                            }
                        }
                    }
                } 
            }); 
            return () => { if (window.myChart) window.myChart.destroy(); }; 
        }, [history]);
        
        const handleExport = () => { if (!window.jspdf) return; const doc = new window.jspdf.jsPDF(); doc.setFontSize(16); doc.text(`Simulation Debrief: ${scenario.title}`, 10, 10); doc.setFontSize(10); let y = 30; log.forEach(l => { if (y > 280) { doc.addPage(); y = 10; } doc.text(`[${l.simTime}] ${l.msg}`, 10, y); y += 6; }); doc.save("sim-debrief.pdf"); };
        
        return (
            <div className="max-w-6xl mx-auto space-y-6 animate-fadeIn p-4 h-full overflow-y-auto">
                <div className="flex justify-between bg-slate-800 p-4 rounded-lg border border-slate-700">
                    <h2 className="text-2xl font-bold text-white">Simulation Debrief</h2>
                    <div className="flex gap-2"><Button onClick={handleExport} variant="secondary"><Lucide icon="download"/> PDF</Button><Button onClick={onRestart} variant="primary"><Lucide icon="rotate-ccw"/> New Sim</Button></div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card title="Performance Checklist" icon="check-square" className="border-emerald-500/50">
                        <div className="p-2 space-y-2">
                            {scenarioObjectives.map((obj, i) => {
                                const isDone = completedObjectives.has(obj) || (obj.includes('Fluid') && completedObjectives.has('Fluids')) || (obj.includes('Antibiotic') && completedObjectives.has('Antibiotics')); 
                                return (
                                    <div key={i} className="flex items-center gap-2 text-sm text-slate-300">
                                        <div className={`w-4 h-4 border rounded flex items-center justify-center ${isDone ? 'bg-emerald-500 border-emerald-500' : 'border-slate-500'}`}>{isDone && <Lucide icon="check" className="w-3 h-3 text-white"/>}</div>
                                        <span>{obj}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </Card>
                    <Card title="Analysis" icon="activity" className="border-amber-500/50"><div className="p-2"><textarea className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white h-24 text-sm" placeholder="Why did it happen? (CRM/Human Factors)" /></div></Card>
                    <Card title="Application" icon="arrow-right-circle" className="border-sky-500/50"><div className="p-2"><textarea className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white h-24 text-sm" placeholder="What will we do differently?" /></div></Card>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><Card title="Physiological Trends" icon="activity"><div className="bg-slate-900 p-2 rounded h-64 relative"><canvas ref={chartRef}></canvas></div></Card><Card title="Action Timeline" icon="clock"><div className="space-y-1 max-h-80 overflow-y-auto font-mono text-xs p-2">{log.map((l, i) => (<div key={i} className="flex gap-4 border-b border-slate-700 pb-1"><span className="text-sky-400 w-12 flex-shrink-0">{l.simTime}</span><span className="text-slate-300">{l.msg}</span></div>))}</div></Card></div>
            </div>
        );
    };

    const MonitorContainer = ({ sessionID }) => { 
        const { Lucide } = window;
        const sim = useSimulation(null, true, sessionID); 
        if (!sessionID) return null; 
        if (!sim.state.vitals || sim.state.vitals.hr === undefined || sim.state.isFinished) {
            return (
                <div className="h-full flex flex-col items-center justify-center bg-black text-slate-500 gap-4 animate-fadeIn">
                    <Lucide icon="wifi" className="w-12 h-12 animate-pulse text-sky-500" />
                    <div className="text-xl font-mono tracking-widest">WAITING FOR CONTROLLER</div>
                    <div className="bg-slate-900 px-4 py-2 rounded border border-slate-800 font-bold text-sky-500">SESSION: {sessionID}</div>
                </div>
            ); 
        }
        return <MonitorScreen sim={sim} />; 
    };   
    const LiveSimContainer = ({ sim, view, setView, resumeData, onRestart, sessionID }) => { const { state, stop, reset } = sim; const { scenario } = state; const { Lucide } = window; useEffect(() => { if (view === 'resume' && resumeData) { sim.dispatch({ type: 'RESTORE_SESSION', payload: resumeData }); } else if (!scenario) { setView('setup'); } }, []); if (!scenario) return <div className="flex flex-col items-center justify-center h-full text-slate-400 animate-pulse"><Lucide icon="loader-2" className="w-8 h-8 mb-4 animate-spin text-sky-500" /></div>; if (view === 'live' || view === 'resume') return <LiveSimScreen sim={sim} onFinish={() => { stop(); setView('debrief'); }} onBack={() => setView('briefing')} sessionID={sessionID} />; if (view === 'debrief') return <DebriefScreen sim={sim} onRestart={() => { reset(); setView('setup'); }} />; return null; };

    window.SetupScreen = SetupScreen; window.JoinScreen = JoinScreen; window.BriefingScreen = BriefingScreen; window.MonitorScreen = MonitorScreen; window.MonitorContainer = MonitorContainer; window.LiveSimContainer = LiveSimContainer; window.DebriefScreen = DebriefScreen;
})();
