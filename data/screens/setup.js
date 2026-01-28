// data/screens/setup.js
(() => {
    const { useState, useEffect } = React;

    // --- SCREEN 1: SETUP ---
    const SetupScreen = ({ onGenerate, savedState, onResume, sessionID, onJoinClick }) => {
        const { ALL_SCENARIOS, HUMAN_FACTOR_CHALLENGES, Button, Lucide, generateHistory, estimateWeight, calculateWetflag, generateVbg, generateName } = window;
        
        const [mode, setMode] = useState('random'); 
        const [category, setCategory] = useState('Medical');
        const [age, setAge] = useState('Any');
        const [acuity, setAcuity] = useState('Any'); 
        const [hf, setHf] = useState('hf0');
        const [premadeCategory, setPremadeCategory] = useState(null);
        const [customScenarios, setCustomScenarios] = useState([]);
        
        // Builder state
        const [buildTitle, setBuildTitle] = useState("");
        const [buildAge, setBuildAge] = useState(40);
        const [buildCat, setBuildCat] = useState("Medical");
        const [buildDesc, setBuildDesc] = useState("A 40-year-old male with chest pain.");
        const [buildPC, setBuildPC] = useState("Chest Pain");
        const [buildPMH, setBuildPMH] = useState("Hypertension");
        const [buildVitals, setBuildVitals] = useState({ hr: 80, bpSys: 120, rr: 16, spO2: 98, gcs: 15, temp: 37 });
        
        // Template editing state (for editing premade scenarios)
        const [editingTemplate, setEditingTemplate] = useState(null);
        const [templateName, setTemplateName] = useState("");
        const [templateAge, setTemplateAge] = useState(40);
        const [templateVitals, setTemplateVitals] = useState({});
        const [templateInjuries, setTemplateInjuries] = useState("");

        const scenariosAvailable = ALL_SCENARIOS && ALL_SCENARIOS.length > 0;

        useEffect(() => {
            const saved = localStorage.getItem('wmebem_custom_scenarios');
            if (saved) {
                try { setCustomScenarios(JSON.parse(saved)); } 
                catch (e) { console.error("Failed to load custom scenarios", e); localStorage.removeItem('wmebem_custom_scenarios'); }
            }
        }, []);

        const saveCustomScenario = () => {
            if (!buildTitle) return alert("Please add a title");
            const safeVitals = {
                hr: parseInt(buildVitals.hr) || 80,
                bpSys: parseInt(buildVitals.bpSys) || 120,
                rr: parseInt(buildVitals.rr) || 16,
                spO2: parseInt(buildVitals.spO2) || 98,
                gcs: parseInt(buildVitals.gcs) || 15,
                temp: parseFloat(buildVitals.temp) || 37
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
                vitalsMod: { ...safeVitals, bpDia: Math.floor(safeVitals.bpSys * 0.65) },
                pmh: buildPMH.split(',').map(s => s.trim()).filter(s => s),
                dhx: ["As per history"],
                allergies: ["NKDA"],
                instructorBrief: { progression: "Custom Scenario", interventions: [], learningObjectives: ["Custom Objective"], debriefPoints: [] },
                vbgClinicalState: "normal",
                ecg: { type: buildVitals.rhythm || "Sinus Rhythm", findings: buildVitals.rhythm || "Normal" },
                chestXray: { findings: "Unremarkable" },
                recommendedActions: ['Obs', 'IV Access'],
                stabilisers: []
            };
            const updated = [...customScenarios, newScen];
            setCustomScenarios(updated);
            localStorage.setItem('wmebem_custom_scenarios', JSON.stringify(updated));
            setMode('custom'); 
            // Reset builder
            setBuildTitle("");
            setBuildDesc("A 40-year-old male with chest pain.");
        };

        // Start editing a template
        const startEditingTemplate = (scenario) => {
            setEditingTemplate(scenario);
            setTemplateName(generateName ? generateName(Math.random() > 0.5 ? 'Male' : 'Female') : scenario.title);
            setTemplateAge(scenario.ageGenerator ? scenario.ageGenerator() : 40);
            setTemplateVitals({ ...scenario.vitalsMod });
            setTemplateInjuries(scenario.patientProfileTemplate || "");
        };

        // Generate from edited template
        const generateFromTemplate = () => {
            if (!editingTemplate) return;
            
            const patientAge = parseInt(templateAge) || 40;
            let sex = Math.random() > 0.5 ? 'Male' : 'Female';
            const t = editingTemplate.title.toLowerCase();
            const forceFemale = ["ectopic", "ovarian", "pregnant", "labour", "birth", "gynae", "obstetric", "eclampsia"];
            const forceMale = ["testicular", "prostate"];
            if (forceFemale.some(k => t.includes(k)) || editingTemplate.category === 'Obstetrics & Gynae') sex = 'Female';
            else if (forceMale.some(k => t.includes(k))) sex = 'Male';
            
            const history = generateHistory ? generateHistory(patientAge, sex) : { pmh: ["Nil"], dhx: ["Nil"], allergies: ["NKDA"] };
            const weight = patientAge < 16 ? (estimateWeight ? estimateWeight(patientAge) : null) : null;
            const wetflag = weight ? (calculateWetflag ? calculateWetflag(patientAge, weight) : null) : null;

            let finalVitals = { hr: 80, bpSys: 120, bpDia: 80, rr: 16, spO2: 98, temp: 37, gcs: 15, bm: 5, pupils: 3, ...templateVitals };
            if (templateVitals.bpSys !== undefined && templateVitals.bpDia === undefined) { 
                finalVitals.bpDia = Math.floor(templateVitals.bpSys * 0.65); 
            }

            const generated = { 
                ...editingTemplate, 
                patientName: templateName, 
                patientAge, 
                sex,
                profile: templateInjuries.replace('{age}', patientAge).replace('{sex}', sex),
                patientProfileTemplate: templateInjuries,
                vitals: finalVitals, 
                pmh: history.pmh, 
                dhx: history.dhx, 
                allergies: history.allergies,
                vbg: generateVbg ? generateVbg(editingTemplate.vbgClinicalState || "normal") : null,
                hf: HUMAN_FACTOR_CHALLENGES ? HUMAN_FACTOR_CHALLENGES.find(h => h.id === hf) || HUMAN_FACTOR_CHALLENGES[0] : null,
                weight, 
                wetflag
            };

            setEditingTemplate(null);
            onGenerate(generated, {});
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

                const patientAge = selectedBase.ageGenerator ? selectedBase.ageGenerator() : 40;
                let sex = Math.random() > 0.5 ? 'Male' : 'Female';
                const t = selectedBase.title.toLowerCase();
                const p = selectedBase.patientProfileTemplate.toLowerCase();
                const forceFemale = ["ectopic", "ovarian", "pregnant", "labour", "birth", "gynae", "obstetric", "eclampsia", "uterus", "vaginal"];
                const forceMale = ["testicular", "prostate", "scrotal"];
                
                if (forceFemale.some(k => t.includes(k) || p.includes(k)) || selectedBase.category === 'Obstetrics & Gynae') sex = 'Female';
                else if (forceMale.some(k => t.includes(k) || p.includes(k))) sex = 'Male';
                
                const history = generateHistory ? generateHistory(patientAge, sex) : { pmh: ["Nil"], dhx: ["Nil"], allergies: ["NKDA"] };
                const weight = patientAge < 16 ? (estimateWeight ? estimateWeight(patientAge) : null) : null;
                const wetflag = weight ? (calculateWetflag ? calculateWetflag(patientAge, weight) : null) : null;
                const randomName = generateName ? generateName(sex) : `Patient ${Date.now()}`;

                let finalVitals = { hr: 80, bpSys: 120, bpDia: 80, rr: 16, spO2: 98, temp: 37, gcs: 15, bm: 5, pupils: 3, ...selectedBase.vitalsMod };
                if (selectedBase.vitalsMod && selectedBase.vitalsMod.bpSys !== undefined && selectedBase.vitalsMod.bpDia === undefined) { 
                    finalVitals.bpDia = Math.floor(selectedBase.vitalsMod.bpSys * 0.65); 
                }

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
                    vbg: generateVbg ? generateVbg(selectedBase.vbgClinicalState || "normal") : null,
                    hf: HUMAN_FACTOR_CHALLENGES ? HUMAN_FACTOR_CHALLENGES.find(h => h.id === hf) || HUMAN_FACTOR_CHALLENGES[0] : null,
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
        ];

        // Template editing modal
        if (editingTemplate) {
            return (
                <div className="max-w-2xl mx-auto p-4 h-full overflow-y-auto space-y-4 animate-fadeIn">
                    <div className="bg-slate-800 p-6 rounded-lg border border-sky-500">
                        <h2 className="text-xl font-bold text-sky-400 mb-4 flex items-center gap-2">
                            <Lucide icon="edit" className="w-5 h-5"/> Customise: {editingTemplate.title}
                        </h2>
                        
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs text-slate-500 uppercase block mb-1">Patient Name</label>
                                <input type="text" value={templateName} onChange={e => setTemplateName(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white"/>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-slate-500 uppercase block mb-1">Age</label>
                                    <input type="number" value={templateAge} onChange={e => setTemplateAge(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white"/>
                                </div>
                            </div>
                            
                            <div>
                                <label className="text-xs text-slate-500 uppercase block mb-1">Injury Description / Presentation</label>
                                <textarea value={templateInjuries} onChange={e => setTemplateInjuries(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white h-24" placeholder="Description of injuries or presentation..."/>
                            </div>
                            
                            <div className="border-t border-slate-700 pt-4">
                                <h4 className="text-sm font-bold text-slate-400 uppercase mb-2">Initial Observations</h4>
                                <div className="grid grid-cols-3 gap-2">
                                    <div><label className="text-[10px] text-slate-500 uppercase">HR</label><input type="number" value={templateVitals.hr || 80} onChange={e => setTemplateVitals({...templateVitals, hr: parseInt(e.target.value)})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"/></div>
                                    <div><label className="text-[10px] text-slate-500 uppercase">BP Sys</label><input type="number" value={templateVitals.bpSys || 120} onChange={e => setTemplateVitals({...templateVitals, bpSys: parseInt(e.target.value)})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"/></div>
                                    <div><label className="text-[10px] text-slate-500 uppercase">SpO2</label><input type="number" value={templateVitals.spO2 || 98} onChange={e => setTemplateVitals({...templateVitals, spO2: parseInt(e.target.value)})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"/></div>
                                    <div><label className="text-[10px] text-slate-500 uppercase">RR</label><input type="number" value={templateVitals.rr || 16} onChange={e => setTemplateVitals({...templateVitals, rr: parseInt(e.target.value)})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"/></div>
                                    <div><label className="text-[10px] text-slate-500 uppercase">GCS</label><input type="number" value={templateVitals.gcs || 15} onChange={e => setTemplateVitals({...templateVitals, gcs: parseInt(e.target.value)})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white" min={3} max={15}/></div>
                                    <div><label className="text-[10px] text-slate-500 uppercase">Temp</label><input type="number" value={templateVitals.temp || 37} onChange={e => setTemplateVitals({...templateVitals, temp: parseFloat(e.target.value)})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white" step={0.1}/></div>
                                </div>
                            </div>
                        </div>
                        
                        <div className="flex gap-2 mt-6">
                            <Button onClick={() => setEditingTemplate(null)} variant="outline" className="flex-1">Cancel</Button>
                            <Button onClick={generateFromTemplate} variant="success" className="flex-1">Start Scenario</Button>
                        </div>
                    </div>
                </div>
            );
        }

        return (
            <div className="max-w-4xl mx-auto p-4 h-full overflow-y-auto space-y-6">
                <div className="bg-slate-900 border border-slate-700 p-4 rounded-lg flex items-center justify-between">
                    <div>
                        <div className="text-[10px] uppercase text-sky-400 font-bold">Session Code</div>
                        <div className="text-2xl font-mono font-bold text-white tracking-widest">{sessionID}</div>
                    </div>
                    <Button onClick={onJoinClick} variant="outline" className="h-10 text-xs">Use as Monitor</Button>
                </div>

                {savedState && (
                    <div className="bg-amber-900/30 border border-amber-500/50 p-4 rounded-lg flex items-center justify-between">
                        <div><span className="text-amber-400 font-bold">Previous Session Found</span><span className="text-slate-400 text-sm ml-2">Continue where you left off?</span></div>
                        <Button onClick={onResume} variant="warning">Resume</Button>
                    </div>
                )}

                <div className="bg-slate-800 p-4 rounded border border-slate-600 text-sm text-slate-300">
                    <p className="font-bold text-sky-400 mb-1">Sim Setup Guide:</p>
                    <p>Select a mode below. <strong>Random</strong> generates a patient from filters. <strong>Premade</strong> lists specific conditions. <strong>Custom</strong> lets you use your saved scenarios or edit premade ones.</p>
                </div>

                <div className="flex gap-2 bg-slate-900 p-2 rounded-lg border border-slate-700">
                    {['random', 'premade', 'custom', 'builder'].map(m => (
                        <button key={m} onClick={() => setMode(m)} className={`flex-1 py-3 rounded font-bold uppercase text-sm transition-all ${mode === m ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                            {m === 'builder' ? 'Build New' : m}
                        </button>
                    ))}
                </div>

                {mode === 'random' && (
                    <div className="space-y-4 animate-fadeIn">
                        <div className="grid grid-cols-3 gap-4">
                            <div><label className="text-xs text-slate-500 uppercase font-bold block mb-1">Category</label><select value={category} onChange={e => setCategory(e.target.value)} className="w-full bg-slate-800 border border-slate-600 rounded p-3 text-white">{['Any', 'Medical', 'Trauma', 'Toxicology', 'Obstetrics & Gynae', 'Cardiac Arrest'].map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                            <div><label className="text-xs text-slate-500 uppercase font-bold block mb-1">Age Group</label><select value={age} onChange={e => setAge(e.target.value)} className="w-full bg-slate-800 border border-slate-600 rounded p-3 text-white">{['Any', 'Adult', 'Paediatric', 'Elderly'].map(a => <option key={a} value={a}>{a}</option>)}</select></div>
                            <div><label className="text-xs text-slate-500 uppercase font-bold block mb-1">Acuity</label><select value={acuity} onChange={e => setAcuity(e.target.value)} className="w-full bg-slate-800 border border-slate-600 rounded p-3 text-white">{['Any', 'Majors', 'Resus'].map(a => <option key={a} value={a}>{a}</option>)}</select></div>
                        </div>
                        <div><label className="text-xs text-slate-500 uppercase font-bold block mb-1">Human Factor Challenge</label><select value={hf} onChange={e => setHf(e.target.value)} className="w-full bg-slate-800 border border-slate-600 rounded p-3 text-white">{HUMAN_FACTOR_CHALLENGES && HUMAN_FACTOR_CHALLENGES.map(h => <option key={h.id} value={h.id}>{h.label}</option>)}</select></div>
                        <Button onClick={() => handleGenerate()} className="w-full h-14 text-xl">Generate Random Scenario</Button>
                    </div>
                )}

                {mode === 'premade' && (
                    <div className="space-y-4 animate-fadeIn">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            {premadeCategories.map(cat => (
                                <button key={cat.id} onClick={() => setPremadeCategory(premadeCategory === cat.id ? null : cat.id)} className={`p-4 rounded border text-center transition-all ${premadeCategory === cat.id ? 'bg-sky-600 border-sky-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'}`}>
                                    <Lucide icon={cat.icon} className="w-6 h-6 mx-auto mb-2"/>
                                    <span className="text-sm font-bold">{cat.label}</span>
                                </button>
                            ))}
                        </div>
                        {premadeCategory && scenariosAvailable && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[50vh] overflow-y-auto p-2 bg-slate-900 rounded border border-slate-700">
                                {ALL_SCENARIOS.filter(premadeCategories.find(c => c.id === premadeCategory)?.filter || (() => false)).map(s => (
                                    <div key={s.id} className="bg-slate-800 p-3 rounded border border-slate-600 hover:border-sky-500 transition-colors">
                                        <div className="flex justify-between items-start">
                                            <div className="flex-1">
                                                <div className="font-bold text-white">{s.title}</div>
                                                <div className="text-xs text-slate-400 mt-1">{s.presentingComplaint}</div>
                                            </div>
                                            <div className="flex gap-1">
                                                <Button onClick={() => startEditingTemplate(s)} variant="outline" className="h-8 text-xs px-2">
                                                    <Lucide icon="edit" className="w-3 h-3"/>
                                                </Button>
                                                <Button onClick={() => handleGenerate(s)} variant="success" className="h-8 text-xs">Run</Button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {mode === 'custom' && (
                    <div className="space-y-4 animate-fadeIn">
                        <div className="flex gap-2">
                            <Button onClick={handleExport} variant="outline" className="flex-1"><Lucide icon="download" className="w-4 h-4 mr-2"/> Export</Button>
                            <label className="flex-1">
                                <input type="file" accept=".json" onChange={handleImport} className="hidden"/>
                                <div className="flex items-center justify-center gap-2 px-4 py-2 rounded border font-bold text-sm bg-slate-700 hover:bg-slate-600 text-white border-slate-600 cursor-pointer h-full"><Lucide icon="upload" className="w-4 h-4"/> Import</div>
                            </label>
                        </div>
                        <div className="bg-slate-900 rounded border border-slate-700 p-4 max-h-[50vh] overflow-y-auto space-y-2">
                            <h3 className="text-sm font-bold text-slate-400 uppercase mb-2">Your Custom Scenarios</h3>
                            {customScenarios.length === 0 && <p className="text-slate-500 text-sm italic text-center py-4">No custom scenarios saved yet. Use 'Build New' to create one.</p>}
                            {customScenarios.map((s, i) => (
                                <div key={i} className="flex justify-between items-center bg-slate-700/50 p-3 rounded border border-slate-600">
                                    <div><div className="font-bold text-white">{s.title}</div><div className="text-xs text-slate-400">{s.patientProfileTemplate}</div></div>
                                    <div className="flex gap-2">
                                        <Button onClick={() => {
                                            const updated = customScenarios.filter((_, idx) => idx !== i);
                                            setCustomScenarios(updated);
                                            localStorage.setItem('wmebem_custom_scenarios', JSON.stringify(updated));
                                        }} variant="danger" className="h-8 text-xs px-2"><Lucide icon="trash" className="w-3 h-3"/></Button>
                                        <Button onClick={() => handleGenerate(s)} variant="success" className="h-8 text-xs">Load</Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        
                        {/* Premade templates for editing */}
                        <div className="border-t border-slate-700 pt-4">
                            <h3 className="text-sm font-bold text-slate-400 uppercase mb-2">Or customise a premade scenario:</h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                {premadeCategories.slice(0, 4).map(cat => (
                                    <button key={cat.id} onClick={() => setPremadeCategory(premadeCategory === cat.id ? null : cat.id)} className={`p-3 rounded border text-center text-xs ${premadeCategory === cat.id ? 'bg-sky-600 border-sky-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-400 hover:bg-slate-700'}`}>
                                        {cat.label}
                                    </button>
                                ))}
                            </div>
                            {premadeCategory && scenariosAvailable && (
                                <div className="grid grid-cols-1 gap-1 max-h-[30vh] overflow-y-auto p-2 mt-2 bg-slate-900 rounded border border-slate-700">
                                    {ALL_SCENARIOS.filter(premadeCategories.find(c => c.id === premadeCategory)?.filter || (() => false)).map(s => (
                                        <button key={s.id} onClick={() => startEditingTemplate(s)} className="bg-slate-800 p-2 rounded border border-slate-600 hover:border-sky-500 transition-colors text-left">
                                            <span className="font-bold text-white text-sm">{s.title}</span>
                                            <span className="text-xs text-slate-400 ml-2">- Click to customise</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {mode === 'builder' && (
                    <div className="space-y-4 animate-fadeIn">
                        <input type="text" placeholder="Scenario Title" value={buildTitle} onChange={e => setBuildTitle(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white placeholder-slate-500"/>
                        <div className="grid grid-cols-2 gap-2">
                            <input type="number" placeholder="Age" value={buildAge} onChange={e => setBuildAge(e.target.value)} className="bg-slate-900 border border-slate-600 rounded p-2 text-white placeholder-slate-500"/>
                            <select value={buildCat} onChange={e => setBuildCat(e.target.value)} className="bg-slate-900 border border-slate-600 rounded p-2 text-white">
                                <option>Medical</option><option>Trauma</option><option>Toxicology</option>
                            </select>
                        </div>
                        <textarea placeholder="Description (e.g. A 45-year-old male found collapsed...)" value={buildDesc} onChange={e => setBuildDesc(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white h-20 placeholder-slate-500"/>
                        <input type="text" placeholder="Presenting Complaint" value={buildPC} onChange={e => setBuildPC(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white placeholder-slate-500"/>
                        <input type="text" placeholder="PMH (comma separated)" value={buildPMH} onChange={e => setBuildPMH(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white placeholder-slate-500"/>
                        <div className="grid grid-cols-3 gap-2">
                            <div><label className="text-[10px] text-slate-500 uppercase">Heart Rate</label><input type="number" value={buildVitals.hr} onChange={e => setBuildVitals({...buildVitals, hr: e.target.value})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"/></div>
                            <div><label className="text-[10px] text-slate-500 uppercase">Sys BP</label><input type="number" value={buildVitals.bpSys} onChange={e => setBuildVitals({...buildVitals, bpSys: e.target.value})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"/></div>
                            <div><label className="text-[10px] text-slate-500 uppercase">Resp Rate</label><input type="number" value={buildVitals.rr} onChange={e => setBuildVitals({...buildVitals, rr: e.target.value})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"/></div>
                            <div><label className="text-[10px] text-slate-500 uppercase">SpO2 %</label><input type="number" value={buildVitals.spO2} onChange={e => setBuildVitals({...buildVitals, spO2: e.target.value})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"/></div>
                            <div><label className="text-[10px] text-slate-500 uppercase">GCS</label><input type="number" value={buildVitals.gcs || 15} onChange={e => setBuildVitals({...buildVitals, gcs: e.target.value})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white" max={15} min={3}/></div>
                            <div><label className="text-[10px] text-slate-500 uppercase">Temp °C</label><input type="number" value={buildVitals.temp || 37} onChange={e => setBuildVitals({...buildVitals, temp: e.target.value})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"/></div>
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-500 uppercase">Initial Rhythm</label>
                            <select onChange={(e) => setBuildVitals({...buildVitals, rhythm: e.target.value})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white" value={buildVitals.rhythm || "Sinus Rhythm"}>
                                {['Sinus Rhythm', 'Sinus Tachycardia', 'AF', 'VT', 'VF', 'Asystole', 'PEA', '3rd Deg Block'].map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                        </div>
                        <Button onClick={saveCustomScenario} variant="primary" className="w-full">Save Custom Scenario</Button>
                    </div>
                )}
            </div>
        );
    };

    // --- SCREEN 2: JOIN ---
    const JoinScreen = ({ onJoin }) => {
        const { Button } = window;
        const [code, setCode] = useState("");
        return (
            <div className="flex flex-col items-center justify-center h-full bg-slate-900 text-white p-4">
                <div className="w-full max-w-md space-y-6 text-center">
                    <div className="flex justify-center mb-4">
                        <img src="https://iili.io/KGQOvkl.md.png" alt="Logo" className="h-20 object-contain" />
                    </div>
                    <h1 className="text-3xl font-bold text-sky-400">Sim Monitor</h1>
                    <p className="text-slate-400">Enter the Session Code</p>
                    <input type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="e.g. A1B2" className="w-full bg-slate-800 border-2 border-slate-600 rounded-lg p-4 text-center text-3xl font-mono tracking-widest uppercase text-white outline-none" maxLength={4}/>
                    <Button onClick={() => onJoin(code)} disabled={code.length < 4} className="w-full py-4 text-xl">Connect</Button>
                </div>
            </div>
        );
    };

    // --- SCREEN 3: BRIEFING ---
    const BriefingScreen = ({ scenario, onStart, onBack }) => {
        const { Button, Lucide } = window;
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
                            <h3 className="text-sm font-bold text-purple-400 uppercase mb-2">WETFLAG Calculation ({scenario.wetflag.age !== undefined ? `Age: ${scenario.wetflag.age}y, ` : ''}Est. Weight: {scenario.wetflag.weight}kg)</h3>
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
                                <p className="text-lg leading-relaxed text-slate-200 mb-4">{scenario.profile || scenario.patientProfileTemplate.replace('{age}', scenario.patientAge).replace('{sex}', scenario.sex)}</p>
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
                                <p className="text-sm text-slate-300 leading-snug">{scenario.instructorBrief?.progression || 'Standard progression'}</p>
                            </div>
                            <div className="p-3 bg-emerald-900/20 rounded border border-emerald-600/30">
                                <h4 className="text-sm font-bold text-emerald-400 uppercase mb-1">Key Interventions</h4>
                                <ul className="list-disc pl-4 text-sm text-slate-300 space-y-1">
                                    {scenario.instructorBrief?.interventions && scenario.instructorBrief.interventions.map((l, i) => <li key={i}>{l}</li>)}
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

    window.SetupScreen = SetupScreen;
    window.JoinScreen = JoinScreen;
    window.BriefingScreen = BriefingScreen;
})();
