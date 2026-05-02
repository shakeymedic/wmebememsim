(() => {
    const { useState, useEffect } = React;

    const SetupScreen = ({ onGenerate, savedState, onResume, sessionID, onJoinClick }) => {
        const { ALL_SCENARIOS, HUMAN_FACTOR_CHALLENGES, Button, Lucide, generateHistory, estimateWeight, calculateWetflag, generateVbg, generateName } = window;
        
        const [mode, setMode] = useState('random'); 
        const [category, setCategory] = useState('Medical');
        const [age, setAge] = useState('Any');
        const [acuity, setAcuity] = useState('Any'); 
        const [hf, setHf] = useState('hf0');
        const [premadeCategory, setPremadeCategory] = useState(null);
        const [customScenarios, setCustomScenarios] = useState([]);
        const [showWetflag, setShowWetflag] = useState(true);

        const [buildId, setBuildId] = useState(null);
        const [buildTitle, setBuildTitle] = useState("");
        const [buildName, setBuildName] = useState("");
        const [buildAge, setBuildAge] = useState(40);
        const [buildSex, setBuildSex] = useState("Male");
        const [buildCat, setBuildCat] = useState("Medical");
        const [buildDesc, setBuildDesc] = useState("A 40-year-old male with chest pain.");
        const [buildPMH, setBuildPMH] = useState("Hypertension");
        const [buildDhx, setBuildDhx] = useState("Nil");
        const [buildAllergies, setBuildAllergies] = useState("NKDA");
        const [buildVitals, setBuildVitals] = useState({ hr: 80, bpSys: 120, rr: 16, spO2: 98, temp: 37, gcs: 15, rhythm: "Sinus Rhythm" });

        const scenariosAvailable = ALL_SCENARIOS && ALL_SCENARIOS.length > 0;

        useEffect(() => {
            const saved = localStorage.getItem('wmebem_custom_scenarios');
            if (saved) {
                try { setCustomScenarios(JSON.parse(saved)); } 
                catch (e) { console.error("Failed to load custom scenarios", e); localStorage.removeItem('wmebem_custom_scenarios'); }
            }
        }, []);

        const loadIntoBuilder = (s) => {
            setBuildId(s.id || `CUST_${Date.now()}`);
            setBuildTitle(s.title);
            setBuildName(s.patientName || "");
            setBuildAge(s.patientAge || 40);
            setBuildSex(s.sex || "Male");
            setBuildCat(s.category);
            setBuildDesc(s.patientProfileTemplate.replace('{age}', s.patientAge || 40).replace('{sex}', s.sex || 'Male'));
            setBuildPMH(Array.isArray(s.pmh) ? s.pmh.join(", ") : (s.pmh || ""));
            setBuildDhx(Array.isArray(s.dhx) ? s.dhx.join(", ") : (s.dhx || "Nil"));
            setBuildAllergies(Array.isArray(s.allergies) ? s.allergies.join(", ") : (s.allergies || "NKDA"));
            setBuildVitals({
                hr: s.vitalsMod?.hr || s.vitals?.hr || 80,
                bpSys: s.vitalsMod?.bpSys || s.vitals?.bpSys || 120,
                rr: s.vitalsMod?.rr || s.vitals?.rr || 16,
                spO2: s.vitalsMod?.spO2 || s.vitals?.spO2 || 98,
                temp: s.vitalsMod?.temp || s.vitals?.temp || 37,
                gcs: s.vitalsMod?.gcs || s.vitals?.gcs || 15,
                rhythm: s.ecg?.type || "Sinus Rhythm"
            });
            setMode('builder');
        };

        const saveCustomScenario = () => {
            if(!buildTitle) return alert("Please add a title");
            
            const finalAge = parseInt(buildAge) || 40;
            const finalName = buildName.trim() || generateName(buildSex);
            const weight = finalAge < 16 ? estimateWeight(finalAge) : null;
            const wetflag = weight ? calculateWetflag(finalAge, weight) : null;

            const safeVitals = {
                hr: parseInt(buildVitals.hr) || 80,
                bpSys: parseInt(buildVitals.bpSys) || 120,
                rr: parseInt(buildVitals.rr) || 16,
                spO2: parseInt(buildVitals.spO2) || 98,
                temp: parseFloat(buildVitals.temp) || 37,
                gcs: parseInt(buildVitals.gcs) || 15,
                bpDia: Math.floor((parseInt(buildVitals.bpSys)||120) * 0.65)
            };

            const newScen = {
                id: buildId && buildId.startsWith('CUST_') ? buildId : `CUST_${Date.now()}`,
                title: buildTitle,
                category: buildCat,
                ageRange: finalAge < 18 ? "Paediatric" : "Adult",
                acuity: 'Majors',
                patientAge: finalAge,
                patientName: finalName,
                sex: buildSex,
                patientProfileTemplate: buildDesc,
                profile: buildDesc,
                presentingComplaint: buildTitle,
                vitalsMod: safeVitals,
                vitals: safeVitals,
                pmh: buildPMH.split(',').map(s=>s.trim()),
                dhx: buildDhx.split(',').map(s=>s.trim()),
                allergies: buildAllergies.split(',').map(s=>s.trim()),
                instructorBrief: { progression: "Custom Scenario", interventions: [], learningObjectives: ["Custom Objective"] },
                vbgClinicalState: "normal",
                ecg: { type: buildVitals.rhythm || "Sinus Rhythm", findings: buildVitals.rhythm || "Normal" },
                chestXray: { findings: "Unremarkable" },
                weight: weight,
                wetflag: wetflag,
                showWetflag: showWetflag
            };

            if(newScen.id.startsWith('CUST_')) {
                const existingIdx = customScenarios.findIndex(c => c.id === newScen.id);
                let updated;
                if(existingIdx >= 0) {
                     updated = [...customScenarios];
                     updated[existingIdx] = newScen;
                } else {
                     updated = [...customScenarios, newScen];
                }
                setCustomScenarios(updated);
                localStorage.setItem('wmebem_custom_scenarios', JSON.stringify(updated));
            }
            
            handleGenerate(newScen);
        };

        const handleGenerate = (base) => {
             if (!scenariosAvailable) { alert("Scenarios failed to load. Please refresh the page."); return; }
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

                 if (selectedBase.id.startsWith('CUST_')) {
                     onGenerate({ ...selectedBase, showWetflag }, {});
                     return;
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

                 let finalVitals = { hr: 80, bpSys: 120, bpDia: 80, rr: 16, spO2: 98, temp: 37, gcs: 15, bm: 5, pupils: 3, ...selectedBase.vitalsMod };
                 if (selectedBase.vitalsMod && selectedBase.vitalsMod.bpSys !== undefined && selectedBase.vitalsMod.bpDia === undefined) { 
                     finalVitals.bpDia = Math.floor(selectedBase.vitalsMod.bpSys * 0.65); 
                 }

                 const generated = { 
                    ...selectedBase, 
                    patientName: randomName, patientAge, sex,
                    profile: selectedBase.patientProfileTemplate.replace('{age}', patientAge).replace('{sex}', sex),
                    vitals: finalVitals, 
                    pmh: selectedBase.pmh || history.pmh, 
                    dhx: selectedBase.dhx || history.dhx, 
                    allergies: selectedBase.allergies || history.allergies,
                    vbg: generateVbg(selectedBase.vbgClinicalState || "normal"),
                    hf: HUMAN_FACTOR_CHALLENGES.find(h => h.id === hf) || HUMAN_FACTOR_CHALLENGES[0],
                    weight, wetflag,
                    showWetflag
                 };

                 onGenerate(generated, {});
             } catch (err) { console.error("Generator Error:", err); alert("Error generating scenario: " + err.message); }
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
                <div className="bg-slate-800 p-4 rounded border border-slate-600 text-sm text-slate-300">
                    <p className="font-bold text-sky-400 mb-1">Sim Setup Guide:</p>
                    <p>Select a mode below. <strong>Random</strong> generates a patient from filters. <strong>Premade</strong> lists specific conditions. <strong>Builder</strong> lets you edit any scenario.</p>
                </div>
                {savedState && (
                    <div className="bg-emerald-900/30 border border-emerald-500 p-4 rounded-lg flex items-center justify-between animate-fadeIn">
                        <div><h3 className="font-bold text-emerald-400">Resume Previous?</h3><p className="text-sm text-slate-300">{savedState.scenario.title}</p></div>
                        <Button onClick={onResume} variant="success">Resume</Button>
                    </div>
                )}
                
                <div className="flex items-center gap-2 p-2 bg-slate-800 rounded border border-slate-600">
                    <input type="checkbox" checked={showWetflag} onChange={e => setShowWetflag(e.target.checked)} className="w-5 h-5 rounded border-slate-500 text-sky-500 focus:ring-sky-500" />
                    <span className="text-sm font-bold text-white">Show WETFLAG on Monitor (Paediatric Scenarios)</span>
                </div>

                <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-xl">
                    <div className="flex gap-2 mb-6 border-b border-slate-700 overflow-x-auto no-scrollbar">
                        {['random', 'premade', 'custom', 'builder'].map(m => (
                            <button key={m} onClick={() => { setMode(m); setPremadeCategory(null); }} className={`pb-2 px-4 text-sm font-bold uppercase whitespace-nowrap transition-colors ${mode === m ? 'text-sky-400 border-b-2 border-sky-400' : 'text-slate-500 hover:text-slate-300'}`}>{m === 'builder' ? 'Builder/Edit' : m}</button>
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
                                        <button key={cat.id} onClick={() => setPremadeCategory(cat)} className="flex flex-col items-center justify-center p-4 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-lg transition-all active:scale-95 group">
                                            <Lucide icon={cat.icon} className="w-8 h-8 text-sky-400 group-hover:text-white mb-2" />
                                            <span className="text-sm font-bold text-slate-200 group-hover:text-white">{cat.label}</span>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2 mb-4"><Button variant="secondary" onClick={() => setPremadeCategory(null)} className="h-8 px-2 text-xs"><Lucide icon="arrow-left" /> Back</Button><h3 className="text-lg font-bold text-sky-400">{premadeCategory.label} Scenarios</h3></div>
                                    <div className="grid gap-2 max-h-[400px] overflow-y-auto pr-2">
                                        {ALL_SCENARIOS.filter(premadeCategory.filter).map((s) => (
                                            <div key={s.id} className="flex justify-between items-center bg-slate-700/40 hover:bg-slate-700 p-3 rounded border border-slate-600 group">
                                                <div className="flex-1">
                                                    <div className="font-bold text-slate-200 group-hover:text-white flex items-center gap-2">{s.title} {s.acuity === 'Resus' && <span className="text-[9px] bg-red-900/50 text-red-400 px-1 rounded border border-red-800">RESUS</span>}</div>
                                                    <div className="text-xs text-slate-400">{s.patientProfileTemplate.substring(0, 60)}...</div>
                                                </div>
                                                <div className="flex gap-2">
                                                    <Button onClick={() => loadIntoBuilder(s)} variant="secondary" className="h-8 text-xs px-3">Edit</Button>
                                                    <Button onClick={() => handleGenerate(s)} variant="primary" className="h-8 text-xs px-3">Load</Button>
                                                </div>
                                            </div>
                                        ))}
                                        {ALL_SCENARIOS.filter(premadeCategory.filter).length === 0 && (<div className="text-center text-slate-500 py-8">No scenarios found in this category.</div>)}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    {mode === 'custom' && (
                        <div className="space-y-2 animate-fadeIn">
                             {customScenarios.length === 0 && <p className="text-slate-500 text-sm italic text-center py-4">No custom scenarios saved yet. Use Builder to create one.</p>}
                             {customScenarios.map((s, i) => (
                                 <div key={i} className="flex justify-between items-center bg-slate-700/50 p-3 rounded border border-slate-600">
                                     <div><div className="font-bold text-white">{s.title}</div><div className="text-xs text-slate-400">{s.patientProfileTemplate}</div></div>
                                     <div className="flex gap-2">
                                        <Button onClick={() => loadIntoBuilder(s)} variant="secondary" className="h-8 text-xs">Edit</Button>
                                        <Button onClick={() => handleGenerate(s)} variant="success" className="h-8 text-xs">Load</Button>
                                     </div>
                                 </div>
                             ))}
                        </div>
                    )}
                    {mode === 'builder' && (
                        <div className="space-y-4 animate-fadeIn">
                            <input type="text" placeholder="Scenario Title" value={buildTitle} onChange={e=>setBuildTitle(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white placeholder-slate-500 font-bold"/>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                <div><label className="text-[10px] text-slate-500 uppercase">Patient Name</label><input type="text" placeholder="Auto-generate if blank" value={buildName} onChange={e=>setBuildName(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white placeholder-slate-500"/></div>
                                <div><label className="text-[10px] text-slate-500 uppercase">Age</label><input type="number" placeholder="Age" value={buildAge} onChange={e=>setBuildAge(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white placeholder-slate-500"/></div>
                                <div><label className="text-[10px] text-slate-500 uppercase">Sex</label><select value={buildSex} onChange={e=>setBuildSex(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"><option>Male</option><option>Female</option></select></div>
                                <div><label className="text-[10px] text-slate-500 uppercase">Category</label><select value={buildCat} onChange={e=>setBuildCat(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"><option>Medical</option><option>Trauma</option><option>Cardiac Arrest</option><option>Toxicology</option><option>Obstetrics &amp; Gynae</option><option>Psychiatric</option><option>Paediatric</option></select></div>
                            </div>
                            <textarea placeholder="Description" value={buildDesc} onChange={e=>setBuildDesc(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white h-20 placeholder-slate-500"/>
                            <input type="text" placeholder="PMH (comma separated)" value={buildPMH} onChange={e=>setBuildPMH(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm placeholder-slate-500"/>
                            <input type="text" placeholder="Drug History (comma separated)" value={buildDhx} onChange={e=>setBuildDhx(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm placeholder-slate-500"/>
                            <input type="text" placeholder="Allergies (comma separated)" value={buildAllergies} onChange={e=>setBuildAllergies(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm placeholder-slate-500"/>
                            
                            <h4 className="text-xs font-bold text-slate-500 uppercase mt-2">Initial Observations</h4>
                            <div className="grid grid-cols-3 gap-2">
                                <div><label className="text-[10px] text-slate-500 uppercase">Heart Rate</label><input type="number" value={buildVitals.hr} onChange={e=>setBuildVitals({...buildVitals, hr: e.target.value})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"/></div>
                                <div><label className="text-[10px] text-slate-500 uppercase">Sys BP</label><input type="number" value={buildVitals.bpSys} onChange={e=>setBuildVitals({...buildVitals, bpSys: e.target.value})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"/></div>
                                <div><label className="text-[10px] text-slate-500 uppercase">Resp Rate</label><input type="number" value={buildVitals.rr} onChange={e=>setBuildVitals({...buildVitals, rr: e.target.value})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"/></div>
                                <div><label className="text-[10px] text-slate-500 uppercase">SpO2 %</label><input type="number" value={buildVitals.spO2} onChange={e=>setBuildVitals({...buildVitals, spO2: e.target.value})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"/></div>
                                <div><label className="text-[10px] text-slate-500 uppercase">GCS</label><input type="number" value={buildVitals.gcs} onChange={e=>setBuildVitals({...buildVitals, gcs: e.target.value})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white" max={15} min={3}/></div>
                                <div><label className="text-[10px] text-slate-500 uppercase">Temp °C</label><input type="number" value={buildVitals.temp} onChange={e=>setBuildVitals({...buildVitals, temp: e.target.value})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"/></div>
                            </div>
                            <div>
                                <label className="text-[10px] text-slate-500 uppercase">Initial Rhythm</label>
                                <select onChange={(e) => setBuildVitals({...buildVitals, rhythm: e.target.value})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white" value={buildVitals.rhythm || "Sinus Rhythm"}>{['Sinus Rhythm', 'Sinus Tachycardia', 'AF', 'VT', 'VF', 'Asystole', 'PEA', '3rd Deg Block'].map(r => <option key={r} value={r}>{r}</option>)}</select>
                            </div>
                            <Button onClick={saveCustomScenario} variant="primary" className="w-full text-lg h-12">Run Scenario</Button>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const JoinScreen = ({ onJoin }) => {
        const { Button } = window;
        const [code, setCode] = useState("");
        return (<div className="flex flex-col items-center justify-center h-full bg-slate-900 text-white p-4"><div className="w-full max-w-md space-y-6 text-center"><div className="flex justify-center mb-4"><img src="https://iili.io/KGQOvkl.md.png" alt="Logo" className="h-20 object-contain" /></div><h1 className="text-3xl font-bold text-sky-400">Sim Monitor</h1><p className="text-slate-400">Enter the Session Code</p><input type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="e.g. A1B2" className="w-full bg-slate-800 border-2 border-slate-600 rounded-lg p-4 text-center text-3xl font-mono tracking-widest uppercase text-white outline-none" maxLength={4}/><Button onClick={() => onJoin(code)} disabled={code.length < 4} className="w-full py-4 text-xl">Connect</Button></div></div>);
    };

    const BriefingScreen = ({ scenario, onStart, onBack }) => {
        const { Button, Lucide } = window;
        return (
            <div className="max-w-5xl mx-auto space-y-6 animate-fadeIn p-4 overflow-y-auto h-full">
                <div className="bg-slate-800 border-l-4 border-sky-500 shadow-lg rounded-lg overflow-hidden">
                    <div className="p-6 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
                        <div>
                            <h2 className="text-3xl font-bold text-white mb-2">{scenario.title}</h2>
                            <div className="flex gap-2 mt-2"><span className="bg-slate-700 text-sky-300 text-xs px-2 py-1 rounded border border-slate-600">{scenario.category}</span><span className="bg-slate-700 text-emerald-300 text-xs px-2 py-1 rounded border border-slate-600">{scenario.ageRange}</span><span className="bg-slate-700 text-amber-300 text-xs px-2 py-1 rounded border border-slate-600">{scenario.acuity}</span></div>
                        </div>
                        <div className="text-right"><div className="text-[10px] text-slate-500 uppercase font-bold">Initial GCS</div><div className="text-4xl font-mono font-bold text-white">{scenario.vitals.gcs}</div></div>
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
                                <div className="flex flex-wrap gap-2">{scenario.equipment && scenario.equipment.map((item, i) => (<span key={i} className="text-xs bg-slate-700 text-slate-200 px-2 py-1 rounded border border-slate-600">{item}</span>))}</div>
                            </div>
                        </div>
                        <div className="space-y-4">
                            <div className="p-3 bg-amber-900/20 rounded border border-amber-600/30"><h4 className="text-sm font-bold text-amber-400 uppercase mb-1">Clinical Progression</h4><p className="text-sm text-slate-300 leading-snug">{scenario.instructorBrief.progression}</p></div>
                            <div className="p-3 bg-emerald-900/20 rounded border border-emerald-600/30"><h4 className="text-sm font-bold text-emerald-400 uppercase mb-1">Key Interventions</h4><ul className="list-disc pl-4 text-sm text-slate-300 space-y-1">{scenario.instructorBrief.interventions && scenario.instructorBrief.interventions.map((l, i) => <li key={i}>{l}</li>)}</ul></div>
                            <div className="p-3 bg-slate-900/50 rounded border border-slate-600"><h4 className="text-sm font-bold text-slate-400 uppercase mb-1">Guidelines & Resources</h4><div className="flex flex-col gap-1">{scenario.learningLinks && scenario.learningLinks.map((link, i) => (<a key={i} href={link.url} target="_blank" className="flex items-center gap-2 text-xs text-sky-400 hover:underline"><Lucide icon="external-link" className="w-3 h-3"/> {link.label}</a>))}</div></div>
                            <div className="p-3 bg-indigo-900/20 rounded border border-indigo-600/30"><h4 className="text-sm font-bold text-indigo-400 uppercase mb-1">Debrief Points</h4><ul className="list-disc pl-4 text-sm text-slate-300 space-y-1">{scenario.instructorBrief.debriefPoints && scenario.instructorBrief.debriefPoints.map((l, i) => <li key={i}>{l}</li>)}</ul></div>
                        </div>
                    </div>
                </div>
                <div className="flex flex-col md:flex-row gap-4"><Button onClick={onBack} variant="secondary" className="flex-1">Back to Setup</Button><Button onClick={onStart} className="flex-1 shadow-sky-900/20 shadow-xl h-14 text-xl">Start Scenario</Button></div>
            </div>
        );
    };

    window.SetupScreen = SetupScreen;
    window.JoinScreen = JoinScreen;
    window.BriefingScreen = BriefingScreen;
})();
