// data/screens/setup.js
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
        
        // Builder State
        const [buildTitle, setBuildTitle] = useState("");
        const [buildAge, setBuildAge] = useState(40);
        const [buildCat, setBuildCat] = useState("Medical");
        const [buildDesc, setBuildDesc] = useState("A 40-year-old male with chest pain.");
        const [buildVitals, setBuildVitals] = useState({ hr: 80, bpSys: 120, rr: 16, spO2: 98 });
        const [customScenarios, setCustomScenarios] = useState([]);

        // Load custom scenarios
        useEffect(() => {
            const saved = localStorage.getItem('wmebem_custom_scenarios');
            if (saved) {
                try { setCustomScenarios(JSON.parse(saved)); } catch (e) { console.error(e); }
            }
        }, []);

        const saveCustomScenario = () => {
            if(!buildTitle) return alert("Please add a title");
            const newScen = {
                id: `CUST_${Date.now()}`,
                title: buildTitle,
                category: buildCat,
                ageRange: buildAge < 18 ? "Paediatric" : "Adult",
                acuity: 'Majors',
                ageGenerator: () => parseInt(buildAge),
                patientProfileTemplate: buildDesc,
                presentingComplaint: "Custom Complaint",
                vitalsMod: { ...buildVitals, bpDia: Math.floor(buildVitals.bpSys * 0.65), gcs: 15, temp: 37 },
                pmh: ["Custom PMH"], dhx: ["As per history"], allergies: ["NKDA"],
                instructorBrief: { progression: "Custom Scenario", interventions: [], learningObjectives: ["Custom Objective"] },
                vbgClinicalState: "normal",
                ecg: { type: buildVitals.rhythm || "Sinus Rhythm", findings: "Normal" },
                chestXray: { findings: "Unremarkable" }
            };
            const updated = [...customScenarios, newScen];
            setCustomScenarios(updated);
            localStorage.setItem('wmebem_custom_scenarios', JSON.stringify(updated));
            setMode('custom'); 
        };

        const handleGenerate = (base) => {
             // ... [Logic kept identical to original for brevity, just extracted] ...
             // Logic handles selecting base scenario, randomizing age/sex, calculating weight/wetflag
             try {
                 let selectedBase = base;
                 if (!base && mode === 'random') {
                     let pool = ALL_SCENARIOS.filter(s => (category === 'Any' || s.category === category) && (age === 'Any' || s.ageRange === age) && (acuity === 'Any' || s.acuity === acuity));
                     if (pool.length === 0) { alert("No scenarios match filters."); return; }
                     selectedBase = pool[Math.floor(Math.random() * pool.length)];
                 }

                 const patientAge = selectedBase.ageGenerator ? selectedBase.ageGenerator() : 40;
                 let sex = Math.random() > 0.5 ? 'Male' : 'Female';
                 // Force sex logic...
                 const forceFemale = ["ectopic", "ovarian", "pregnant", "labour", "birth", "gynae", "obstetric"];
                 const forceMale = ["testicular", "prostate"];
                 if (forceFemale.some(k => selectedBase.title.toLowerCase().includes(k) || selectedBase.category === 'Obstetrics & Gynae')) sex = 'Female';
                 else if (forceMale.some(k => selectedBase.title.toLowerCase().includes(k))) sex = 'Male';

                 const history = generateHistory(patientAge, sex);
                 const weight = patientAge < 16 ? estimateWeight(patientAge) : null;
                 const wetflag = weight ? calculateWetflag(patientAge, weight) : null;
                 const randomName = generateName(sex);

                 let finalVitals = { hr: 80, bpSys: 120, bpDia: 80, rr: 16, spO2: 98, temp: 37, gcs: 15, bm: 5, pupils: 3, ...selectedBase.vitalsMod };
                 if (selectedBase.vitalsMod && selectedBase.vitalsMod.bpSys !== undefined && selectedBase.vitalsMod.bpDia === undefined) { 
                     finalVitals.bpDia = Math.floor(selectedBase.vitalsMod.bpSys * 0.65); 
                 }

                 const generated = { 
                    ...selectedBase, patientName: randomName, patientAge, sex,
                    profile: selectedBase.patientProfileTemplate.replace('{age}', patientAge).replace('{sex}', sex),
                    vitals: finalVitals, pmh: selectedBase.pmh || history.pmh, dhx: selectedBase.dhx || history.dhx, allergies: selectedBase.allergies || history.allergies,
                    vbg: generateVbg(selectedBase.vbgClinicalState || "normal"),
                    hf: HUMAN_FACTOR_CHALLENGES.find(h => h.id === hf) || HUMAN_FACTOR_CHALLENGES[0],
                    weight, wetflag
                 };
                 onGenerate(generated, {});
             } catch (err) { console.error(err); alert("Error: " + err.message); }
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
                {savedState && (<div className="bg-emerald-900/30 border border-emerald-500 p-4 rounded-lg flex justify-between"><div><h3 className="font-bold text-emerald-400">Resume Previous?</h3><p className="text-sm text-slate-300">{savedState.scenario.title}</p></div><Button onClick={onResume} variant="success">Resume</Button></div>)}
                <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-xl">
                    <div className="flex gap-2 mb-6 border-b border-slate-700 overflow-x-auto no-scrollbar">
                        {['random', 'premade', 'custom', 'builder'].map(m => (
                            <button key={m} onClick={() => { setMode(m); setPremadeCategory(null); }} className={`pb-2 px-4 text-sm font-bold uppercase whitespace-nowrap transition-colors ${mode === m ? 'text-sky-400 border-b-2 border-sky-400' : 'text-slate-500 hover:text-slate-300'}`}>{m}</button>
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
                            <h3 className="text-sm font-bold text-white mb-2">Saved Custom Scenarios</h3>
                             {customScenarios.length === 0 && <p className="text-slate-500 text-sm italic">No custom scenarios saved yet.</p>}
                             {customScenarios.map((s, i) => (
                                 <div key={i} className="flex justify-between items-center bg-slate-700/50 p-3 rounded border border-slate-600">
                                     <div><div className="font-bold text-white">{s.title}</div></div>
                                     <Button onClick={() => handleGenerate(s)} variant="success" className="h-8 text-xs">Load</Button>
                                 </div>
                             ))}
                        </div>
                    )}
                    {mode === 'builder' && (
                         <div className="space-y-4 animate-fadeIn">
                             <p className="text-xs text-slate-400">Quickly build a scenario on the fly.</p>
                             <input type="text" placeholder="Scenario Title" value={buildTitle} onChange={e=>setBuildTitle(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white placeholder-slate-500"/>
                             <Button onClick={saveCustomScenario} variant="primary" className="w-full">Save & View in Custom</Button>
                         </div>
                    )}
                </div>
            </div>
        );
    };

    window.SetupScreen = SetupScreen;
})();
