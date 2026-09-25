(() => {
    const { useState, useEffect } = React;

    // `initialMode` / `initialPremadeCategory` are OPTIONAL. They exist so a particular panel can be
    // opened directly — used by the Node verification harness to render the locked Restricted section
    // without simulating clicks, and available for deep-linking a mode later. Both default to the
    // normal first-load state, so nothing changes for a real user.
    const SetupScreen = ({ onGenerate, savedState, onResume, sessionID, onJoinClick, onQuickSim, auth, initialMode, initialPremadeCategory }) => {
        const { ALL_SCENARIOS, HUMAN_FACTOR_CHALLENGES, Button, Lucide, generateHistory, estimateWeight, calculateWetflag, generateVbg, generateName,
                getScenarioPreviewText, formatProfileTemplate, validateBuilderField, BUILDER_LIMITS, HumanFactorBadge } = window;
        
        const [mode, setMode] = useState(initialMode || 'random'); 
        const [category, setCategory] = useState('Medical');
        const [age, setAge] = useState('Any');
        const [acuity, setAcuity] = useState('Any'); 
        const [hf, setHf] = useState('hf0');
        const [premadeCategory, setPremadeCategory] = useState(initialPremadeCategory || null);
        const [customScenarios, setCustomScenarios] = useState([]);
        const [showWetflag, setShowWetflag] = useState(true);

        // ---- WAVE 4b / PART A: QUICK SIM launch options -------------------------------------
        // A3: the facilitator may OPTIONALLY set age/weight/sex/name so WETFLAG and paediatric
        // energy/dosing still work; leaving everything alone gives a sensible adult (40y, 70 kg-ish
        // adult physiology, sinus rhythm). Blank strings mean "use the default", which is why these
        // are strings rather than numbers.
        const [qsAge, setQsAge] = useState('40');
        const [qsWeight, setQsWeight] = useState('');
        const [qsSex, setQsSex] = useState('Male');
        const [qsName, setQsName] = useState('');
        const [qsRhythm, setQsRhythm] = useState('Sinus Rhythm');

        // ---- WAVE 4b / PART C: restricted (RCUK) scenarios ----------------------------------
        // Loaded FROM FIREBASE at runtime, never bundled. Shipped empty but fully wired.
        const [restricted, setRestricted] = useState({ phase: 'idle', scenarios: [], reason: null });
        // WAVE 5 / ITEM 5: the locked panel used to tell a signed-out user to "request access below"
        // when the request-access button only renders once signed in, so it promised a control that was
        // not on screen. The panel now carries its OWN sign-in button, and the instructions for each of
        // the three states name only controls that are actually visible in that state.
        const [restrictedAuthOpen, setRestrictedAuthOpen] = useState(false);

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
        const [buildDifficulty, setBuildDifficulty] = useState("Intermediate");
        const [buildCxrUrl, setBuildCxrUrl] = useState("");
        const [buildCtUrl, setBuildCtUrl] = useState("");
        const [buildLearningObj, setBuildLearningObj] = useState("");
        const [buildCustomActions, setBuildCustomActions] = useState("");
        const [buildVitals, setBuildVitals] = useState({ hr: 80, bpSys: 120, rr: 16, spO2: 98, temp: 37, gcs: 15, rhythm: "Sinus Rhythm" });

        // The freetext brief used to be independent of the structured fields, so a scenario could read
        // "40-year-old male" while the age field said 7. Keep it derived until the user edits it, then
        // flag it as stale instead of silently overwriting their words.
        const [descDirty, setDescDirty] = useState(false);
        const autoDesc = (a, s, t) => `A ${a}-year-old ${String(s || 'patient').toLowerCase()} with ${(t || 'an undifferentiated presentation').toLowerCase()}.`;
        useEffect(() => {
            if (!descDirty) setBuildDesc(autoDesc(buildAge, buildSex, buildTitle));
        }, [buildAge, buildSex, buildTitle, descDirty]);
        const descStale = descDirty && !String(buildDesc).includes(String(buildAge));

        const builderErrors = {
            age: validateBuilderField('age', buildAge),
            hr: validateBuilderField('hr', buildVitals.hr),
            bpSys: validateBuilderField('bpSys', buildVitals.bpSys),
            rr: validateBuilderField('rr', buildVitals.rr),
            spO2: validateBuilderField('spO2', buildVitals.spO2),
            gcs: validateBuilderField('gcs', buildVitals.gcs),
            temp: validateBuilderField('temp', buildVitals.temp)
        };
        const builderInvalid = Object.values(builderErrors).some(Boolean);
        const FieldError = ({ msg }) => msg ? <div className="text-[10px] text-red-400 mt-0.5">{msg}</div> : null;
        const fieldClass = (msg) => `w-full bg-slate-900 border rounded p-2 text-white placeholder-slate-500 ${msg ? 'border-red-500' : 'border-slate-600'}`;

        const scenariosAvailable = ALL_SCENARIOS && ALL_SCENARIOS.length > 0;

        // JSON.parse succeeding says nothing about shape. A hand-edited localStorage entry or an
        // arbitrary .json file used to be accepted wholesale and then crashed the scenario list on
        // the first `.title.toLowerCase()`.
        const isValidScenarioShape = (s) => !!s && typeof s === 'object' && !Array.isArray(s)
            && typeof s.id === 'string' && s.id.length > 0
            && typeof s.title === 'string' && s.title.length > 0;

        const sanitiseScenarioList = (raw) => {
            const list = Array.isArray(raw) ? raw : [raw];
            return list.filter(isValidScenarioShape);
        };

        // localStorage itself throws in sandboxed/embedded frames and in some private modes, so every
        // access goes through these guards — a blocked store must never blank the app.
        const storeGet = (k) => { try { return localStorage.getItem(k); } catch (e) { console.warn('Storage unavailable', e); return null; } };
        const storeSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { console.warn('Storage write blocked', e); } };
        const storeDel = (k) => { try { localStorage.removeItem(k); } catch (e) {} };

        useEffect(() => {
            const saved = storeGet('wmebem_custom_scenarios');
            if (!saved) return;
            try {
                const clean = sanitiseScenarioList(JSON.parse(saved));
                setCustomScenarios(clean);
                // Rewrite so a partially-corrupt store isn't re-filtered on every load.
                storeSet('wmebem_custom_scenarios', JSON.stringify(clean));
            } catch (e) {
                console.error("Failed to load custom scenarios", e);
                storeDel('wmebem_custom_scenarios');
            }
        }, []);

        const loadIntoBuilder = (s) => {
            setBuildId(s.id || `CUST_${Date.now()}`);
            setBuildTitle(s.title);
            setBuildName(s.patientName || "");
            setBuildAge(s.patientAge || 40);
            setBuildSex(s.sex || "Male");
            setBuildCat(s.category);
            setBuildDesc(formatProfileTemplate(s.patientProfileTemplate || s.profile, s.patientAge || window.getPreviewAge(s), s.sex || 'Male'));
            setDescDirty(true);
            setBuildPMH(Array.isArray(s.pmh) ? s.pmh.join(", ") : (s.pmh || ""));
            setBuildDhx(Array.isArray(s.dhx) ? s.dhx.join(", ") : (s.dhx || "Nil"));
            setBuildAllergies(Array.isArray(s.allergies) ? s.allergies.join(", ") : (s.allergies || "NKDA"));
            setBuildDifficulty(s.difficulty || "Intermediate");
            setBuildCxrUrl(s.customImages?.xray || "");
            setBuildCtUrl(s.customImages?.ct || "");
            setBuildLearningObj(Array.isArray(s.learningObjectives) ? s.learningObjectives.join(', ') : (s.instructorBrief?.learningObjectives?.join(', ') || ''));
            setBuildCustomActions(Array.isArray(s.customActions) ? s.customActions.join(', ') : '');
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

        const exportCustomScenarios = () => {
            if (!customScenarios.length) return alert("No custom scenarios to export.");
            const blob = new Blob([JSON.stringify(customScenarios, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = `em_evidence_scenarios_${Date.now()}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
        };

        const importCustomScenariosFile = (e) => {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onerror = () => { alert('Could not read the selected scenario file. Please try another JSON export.'); e.target.value = ''; };
            reader.onload = (ev) => {
                try {
                    const parsed = JSON.parse(ev.target.result);
                    const rawCount = Array.isArray(parsed) ? parsed.length : 1;
                    const list = sanitiseScenarioList(parsed);
                    const rejected = rawCount - list.length;
                    if (list.length === 0) { alert('Import failed: no valid scenarios found (each needs an id and a title).'); return; }
                    const merged = [...customScenarios];
                    let added = 0;
                    list.forEach(s => { if (!merged.find(c => c.id === s.id)) { merged.push(s); added++; } });
                    setCustomScenarios(merged);
                    storeSet('wmebem_custom_scenarios', JSON.stringify(merged));
                    alert(`Imported ${added} new scenario(s).` + (rejected > 0 ? ` ${rejected} skipped (invalid shape).` : ''));
                } catch (err) { alert('Import failed: ' + err.message); }
            };
            reader.readAsText(file);
            e.target.value = '';
        };

        const DIFF_COLOURS = { Beginner: 'bg-emerald-900/50 text-emerald-400 border-emerald-800', Intermediate: 'bg-amber-900/50 text-amber-400 border-amber-800', Advanced: 'bg-red-900/50 text-red-400 border-red-800' };
        const DiffBadge = ({ d }) => d ? <span className={`text-[9px] px-1 rounded border ${DIFF_COLOURS[d] || DIFF_COLOURS.Intermediate}`}>{d.toUpperCase()}</span> : null;

        const saveCustomScenario = () => {
            if(!buildTitle) return alert("Please add a title");
            // Reject rather than clamp: a silently corrected age used to reclassify the scenario as
            // paediatric and produce WETFLAG doses for a patient the facilitator never described.
            const problems = Object.values(builderErrors).filter(Boolean);
            if (problems.length) return alert("Please correct the following before running:\n\n" + problems.join("\n"));

            const finalAge = Number(buildAge);
            const finalName = buildName.trim() || generateName(buildSex);
            const weight = finalAge < 16 ? estimateWeight(finalAge) : null;
            const wetflag = weight ? calculateWetflag(finalAge, weight) : null;

            const bpSys = Number(buildVitals.bpSys);
            const safeVitals = {
                hr: Number(buildVitals.hr),
                bpSys: bpSys,
                rr: Number(buildVitals.rr),
                spO2: Number(buildVitals.spO2),
                temp: Number(buildVitals.temp),
                gcs: Number(buildVitals.gcs),
                bpDia: Math.floor(bpSys * 0.65)
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
                difficulty: buildDifficulty,
                customImages: { xray: buildCxrUrl || null, ct: buildCtUrl || null },
                learningObjectives: buildLearningObj.split(',').map(s=>s.trim()).filter(Boolean).length ? buildLearningObj.split(',').map(s=>s.trim()).filter(Boolean) : ['Custom Objective'],
                customActions: buildCustomActions.split(',').map(s=>s.trim()).filter(Boolean),
                instructorBrief: { progression: "Custom Scenario", interventions: [], learningObjectives: buildLearningObj.split(',').map(s=>s.trim()).filter(Boolean).length ? buildLearningObj.split(',').map(s=>s.trim()).filter(Boolean) : ['Custom Objective'] },
                vbgClinicalState: "normal",
                ecg: { type: buildVitals.rhythm || "Sinus Rhythm", findings: buildVitals.rhythm || "Normal" },
                chestXray: { findings: "Unremarkable" },
                weight: weight,
                wetflag: wetflag,
                showWetflag: showWetflag,
                hf: HUMAN_FACTOR_CHALLENGES.find(h => h.id === hf) || HUMAN_FACTOR_CHALLENGES[0]
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
                storeSet('wmebem_custom_scenarios', JSON.stringify(updated));
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

                 const selectedHf = HUMAN_FACTOR_CHALLENGES.find(h => h.id === hf) || HUMAN_FACTOR_CHALLENGES[0];

                 if (selectedBase.id.startsWith('CUST_')) {
                     // Custom scenarios are built at runtime and never pass through processScenarios,
                     // so enrich them here. Without this the live observations screen loads with no
                     // equipment list, no guideline links, no investigations and no VBG result.
                     const enriched = window.enrichScenario ? window.enrichScenario(selectedBase) : selectedBase;
                     onGenerate({
                         ...enriched,
                         vbg: enriched.vbg || generateVbg(enriched.vbgClinicalState || "normal"),
                         showWetflag,
                         hf: selectedBase.hf || selectedHf
                     }, {});
                     return;
                 }

                 // WAVE 4b / C5: honour an AUTHORED patientAge before falling back to 40.
                 // Built-in scenarios all carry an `ageGenerator`, so this branch never mattered
                 // before. A restricted scenario pasted into Firebase (or a hand-written custom one)
                 // states its age directly as `patientAge` — and that age drives WETFLAG, the
                 // paediatric 4 J/kg defibrillation energy and every weight-based dose, so silently
                 // replacing a 5-year-old with a 40-year-old would have been a clinical error, not a
                 // cosmetic one.
                 const authoredAge = Number(selectedBase.patientAge);
                 const patientAge = selectedBase.ageGenerator ? selectedBase.ageGenerator()
                     : (Number.isFinite(authoredAge) && authoredAge > 0 ? authoredAge : 40);
                 let sex = Math.random() > 0.5 ? 'Male' : 'Female';
                 const t = selectedBase.title.toLowerCase();
                 const p = String(selectedBase.patientProfileTemplate || '').toLowerCase();
                 const forceFemale = ["ectopic", "ovarian", "pregnant", "labour", "birth", "gynae", "obstetric", "eclampsia", "uterus", "vaginal"];
                 const forceMale = ["testicular", "prostate", "scrotal"];
                 
                 if (forceFemale.some(k => t.includes(k) || p.includes(k)) || selectedBase.category === 'Obstetrics & Gynae') sex = 'Female';
                 else if (forceMale.some(k => t.includes(k) || p.includes(k))) sex = 'Male';
                 
                 const history = generateHistory(patientAge, sex);
                 // An authored weight wins over the age estimate, for the same reason.
                 const authoredWeight = Number(selectedBase.weight);
                 const weight = (Number.isFinite(authoredWeight) && authoredWeight > 0) ? authoredWeight
                     : (patientAge < 16 ? estimateWeight(patientAge) : null);
                 const wetflag = weight ? calculateWetflag(patientAge, weight) : null;
                 const randomName = generateName(sex);

                 let finalVitals = { hr: 80, bpSys: 120, bpDia: 80, rr: 16, spO2: 98, temp: 37, gcs: 15, bm: 5, pupils: 3, ...selectedBase.vitalsMod };
                 if (selectedBase.vitalsMod && selectedBase.vitalsMod.bpSys !== undefined && selectedBase.vitalsMod.bpDia === undefined) { 
                     finalVitals.bpDia = Math.floor(selectedBase.vitalsMod.bpSys * 0.65); 
                 }

                 const generated = { 
                    ...selectedBase, 
                    patientName: randomName, patientAge, sex,
                    profile: formatProfileTemplate(selectedBase.patientProfileTemplate, patientAge, sex),
                    vitals: finalVitals, 
                    pmh: selectedBase.pmh || history.pmh, 
                    dhx: selectedBase.dhx || history.dhx, 
                    allergies: selectedBase.allergies || history.allergies,
                    vbg: generateVbg(selectedBase.vbgClinicalState || "normal"),
                    hf: selectedHf,
                    weight, wetflag,
                    showWetflag
                 };

                 onGenerate(generated, {});
             } catch (err) { console.error("Generator Error:", err); alert("Error generating scenario: " + err.message); }
        };

        // ---- QUICK SIM validation + launch --------------------------------------------------
        // Reuses validateBuilderField (the SAME validator the Builder and the live vitals-control
        // modal use) so an out-of-range age or weight is rejected identically everywhere.
        const qsAgeError = qsAge === '' ? null : validateBuilderField('age', qsAge);
        const qsWeightError = qsWeight === '' ? null : validateBuilderField('weight', qsWeight);
        const qsInvalid = !!(qsAgeError || qsWeightError);
        const qsResolvedAge = qsAge === '' ? 40 : Number(qsAge);
        const qsAutoWeight = (!qsWeight && qsResolvedAge < 16) ? estimateWeight(qsResolvedAge) : null;

        const launchQuickSim = () => {
            if (qsInvalid) return;
            if (!onQuickSim) { alert('Quick Sim is unavailable in this build.'); return; }
            onQuickSim({
                age: qsAge === '' ? 40 : Number(qsAge),
                weight: qsWeight === '' ? null : Number(qsWeight),
                sex: qsSex,
                name: qsName,
                rhythm: qsRhythm,
                showWetflag
            });
        };

        // ---- RESTRICTED SECTION -------------------------------------------------------------
        // C1/C4: a clear locked state, a sign-in / request-access path, and NO errors or console
        // noise when Firebase Auth has never been enabled. The client-side check below controls the
        // UI ONLY — the real enforcement is the database rules (database.rules.json), which is why
        // we still attempt the read and treat PERMISSION_DENIED as a normal locked outcome.
        const restrictedUnlocked = !!(auth && auth.has && auth.has('rcuk'));
        useEffect(() => {
            if (!restrictedUnlocked) { setRestricted({ phase: 'locked', scenarios: [], reason: null }); return; }
            let cancelled = false;
            setRestricted({ phase: 'loading', scenarios: [], reason: null });
            (window.loadRestrictedScenarios ? window.loadRestrictedScenarios() : Promise.resolve({ ok: false, reason: 'unavailable', scenarios: [] }))
                .then(res => {
                    if (cancelled) return;
                    setRestricted({
                        phase: res.ok ? (res.scenarios.length ? 'ready' : 'empty') : 'locked',
                        scenarios: res.scenarios,
                        reason: res.reason
                    });
                });
            return () => { cancelled = true; };
        }, [restrictedUnlocked]);

        const RestrictedSection = () => {
            const signedIn = !!(auth && auth.phase === 'signedIn');
            const status = (auth && auth.profile && auth.profile.status) || null;
            // ITEM 5: the same modal the header's account button opens. Read off window so this screen
            // keeps working if data/auth.js never loaded (the no-accounts deployment).
            const AuthModalComponent = window.AuthModal || null;
            return (
                <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                        <Button variant="secondary" onClick={() => setPremadeCategory(null)} className="h-8 px-2 text-xs"><Lucide icon="arrow-left" /> Back</Button>
                        <h3 className="text-lg font-bold text-amber-400 flex items-center gap-2">
                            <Lucide icon={restrictedUnlocked ? 'unlock' : 'lock'} className="w-4 h-4"/> Restricted Scenarios
                        </h3>
                    </div>

                    {!restrictedUnlocked ? (
                        <div className="bg-slate-900 border border-amber-700/60 rounded-lg p-4 space-y-3">
                            <div className="flex items-start gap-3">
                                <Lucide icon="lock" className="w-6 h-6 text-amber-400 flex-none mt-0.5"/>
                                <div className="text-sm text-slate-300 space-y-2">
                                    <p className="font-bold text-amber-300">This section is locked.</p>
                                    <p>It holds copyrighted scenarios (for example RCUK course material) that cannot be distributed with the app. They are stored separately and released to individually approved accounts.</p>
                                    <p className="text-slate-400">Everything else in the simulator — all {ALL_SCENARIOS.length} built-in scenarios, Quick Sim, the monitor, the defibrillator and the debrief — needs no account at all.</p>
                                </div>
                            </div>

                            <div className="border-t border-slate-800 pt-3 text-xs space-y-2">
                                {!auth || !auth.available ? (
                                    <p className="text-slate-400">Accounts are not switched on for this deployment yet, so there is nothing to sign in to. Nothing is broken — this section will unlock once the owner enables it.</p>
                                ) : !signedIn ? (
                                    /* SIGNED OUT. Exactly one control is offered and it is right here; the
                                       request-access button is described as appearing AFTER sign-in, which
                                       is what actually happens. */
                                    <div className="space-y-2">
                                        <p className="text-slate-400">You are not signed in. Sign in first — the <b>Request access</b> button appears here once you are, and access is then granted by the owner.</p>
                                        <Button onClick={() => setRestrictedAuthOpen(true)} variant="outline" className="h-8 px-3 text-xs text-sky-300 border-sky-500/60">
                                            <Lucide icon="log-in" className="w-3 h-3 mr-1"/> Sign in or create an account
                                        </Button>
                                        <p className="text-slate-500">The account button in the header does the same thing.</p>
                                        {AuthModalComponent && restrictedAuthOpen && (
                                            <AuthModalComponent auth={auth} onClose={() => { if (auth.clearFeedback) auth.clearFeedback(); setRestrictedAuthOpen(false); }} context="restricted" />
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        <p className="text-slate-400">
                                            Signed in as <span className="text-slate-200 font-bold">{auth.user && auth.user.email}</span>.
                                            {status === 'approved'
                                                ? ' Your account is approved but does not hold the restricted-content entitlement yet.'
                                                : status === 'rejected'
                                                    ? ' Your access request was declined.'
                                                    : ' Your account is awaiting approval.'}
                                            {' '}Use the <b>Request access</b> button below — the owner grants it manually.
                                        </p>
                                        <Button onClick={() => auth.requestAccess('rcuk')} variant="outline" className="h-8 px-3 text-xs text-amber-400 border-amber-500/60">
                                            Request access
                                        </Button>
                                        {auth.notice && <div className="text-emerald-300">{auth.notice}</div>}
                                        {auth.error && <div className="text-red-300">{auth.error}</div>}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : restricted.phase === 'loading' ? (
                        <div className="text-center text-slate-500 py-8 text-sm">Loading restricted scenarios…</div>
                    ) : restricted.phase === 'empty' ? (
                        <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 text-sm text-slate-300 space-y-2">
                            <p className="font-bold text-emerald-400">Unlocked — but there is nothing here yet.</p>
                            <p className="text-slate-400">No scenarios have been added to <span className="font-mono text-slate-300">restrictedScenarios/</span> in the database. See the “Restricted scenarios” section of README.md for the JSON shape to paste in.</p>
                        </div>
                    ) : (
                        <div className="grid gap-2 max-h-[400px] overflow-y-auto pr-2">
                            {/* C5: these run through the EXACT same handleGenerate/loadIntoBuilder
                                path as a built-in scenario — no special-casing downstream. */}
                            {restricted.scenarios.map(s => (
                                <div key={s.id} className="flex justify-between items-center bg-amber-950/20 hover:bg-amber-900/20 p-3 rounded border border-amber-800/50 group">
                                    <div className="flex-1 min-w-0">
                                        <div className="font-bold text-slate-200 group-hover:text-white flex items-center gap-2">
                                            {s.title}
                                            <span className="text-[9px] bg-amber-900/50 text-amber-300 px-1 rounded border border-amber-700 uppercase font-bold">restricted</span>
                                            <DiffBadge d={s.difficulty}/>
                                        </div>
                                        <div className="text-xs text-slate-400 truncate">{getScenarioPreviewText(s)}</div>
                                    </div>
                                    <div className="flex gap-2 flex-none">
                                        <Button onClick={() => loadIntoBuilder(s)} variant="secondary" className="h-8 text-xs px-3">Edit</Button>
                                        <Button onClick={() => handleGenerate(s)} variant="primary" className="h-8 text-xs px-3">Load</Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            );
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
            // WAVE 4b / C1: the restricted category. `restricted: true` means it does NOT filter
            // ALL_SCENARIOS at all — its contents come from Firebase at runtime, or it shows locked.
            { id: 'Restricted', label: 'Restricted (RCUK)', icon: 'lock', restricted: true, filter: () => false },
        ];

        return (
            <div className="max-w-4xl mx-auto p-4 h-full overflow-y-auto space-y-6">
                <div className="bg-slate-900 border border-slate-700 p-4 rounded-lg flex items-center justify-between">
                    <div><div className="text-[10px] uppercase text-sky-400 font-bold">Session Code</div><div className="text-2xl font-mono font-bold text-white tracking-widest">{sessionID}</div></div>
                    <div className="flex gap-2">
                        {/* New tab, not same tab: the facilitator keeps the controller on this laptop and
                            drags the monitor window to the second screen. */}
                        <Button href={`?mode=monitor&session=${sessionID}`} variant="primary" className="h-10 text-xs flex items-center gap-1"><Lucide icon="monitor" className="w-3 h-3"/> Launch Monitor</Button>
                        <Button onClick={onJoinClick} variant="outline" className="h-10 text-xs">Join Another Session</Button>
                    </div>
                </div>
                <div className="bg-slate-800 p-4 rounded border border-slate-600 text-sm text-slate-300">
                    <p className="font-bold text-sky-400 mb-1">Sim Setup Guide:</p>
                    <p>Select a mode below. <strong>Quick Sim</strong> is a blank patient with just obs and a rhythm, for ad-hoc teaching. <strong>Random</strong> generates a patient from filters. <strong>Premade</strong> lists specific conditions. <strong>Builder</strong> lets you edit any scenario.</p>
                </div>
                {savedState && (
                    <div className="bg-emerald-900/30 border border-emerald-500 p-4 rounded-lg flex items-center justify-between animate-fadeIn">
                        <div><h3 className="font-bold text-emerald-400">Resume Previous?</h3><p className="text-sm text-slate-300">{(savedState.scenario && savedState.scenario.title) || 'Saved session'}</p></div>
                        <Button onClick={onResume} variant="success">Resume</Button>
                    </div>
                )}
                
                <div className="flex items-center gap-2 p-2 bg-slate-800 rounded border border-slate-600">
                    <input type="checkbox" checked={showWetflag} onChange={e => setShowWetflag(e.target.checked)} className="w-5 h-5 rounded border-slate-500 text-sky-500 focus:ring-sky-500" />
                    <span className="text-sm font-bold text-white">Show WETFLAG on Monitor (Paediatric Scenarios)</span>
                </div>

                <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 shadow-xl">
                    {/* Wraps rather than scrolls: `no-scrollbar` removed the only affordance that more tabs
                        existed, so Builder/Edit was effectively invisible at phone widths. */}
                    <div className="flex flex-wrap gap-x-2 gap-y-1 mb-6 border-b border-slate-700">
                        {/* WAVE 4b / A1: QUICK SIM sits first — it is the fastest route to a running
                            monitor and skips scenario generation entirely. */}
                        {['quick', 'random', 'premade', 'custom', 'builder'].map(m => (
                            <button key={m} onClick={() => { setMode(m); setPremadeCategory(null); }} className={`pb-2 px-2 sm:px-4 text-xs sm:text-sm font-bold uppercase whitespace-nowrap transition-colors ${mode === m ? 'text-sky-400 border-b-2 border-sky-400' : 'text-slate-500 hover:text-slate-300'}`}>{m === 'builder' ? 'Builder/Edit' : m === 'quick' ? 'Quick Sim' : m}</button>
                        ))}
                    </div>
                    {/* ============================ WAVE 4b / PART A: QUICK SIM ============================
                        No scenario, no brief, no drugs, no objectives. Just a blank patient whose obs and
                        rhythm the facilitator drives straight to the monitor. Everything on this panel is
                        optional — pressing the button with the defaults gives a 40-year-old in sinus rhythm. */}
                    {mode === 'quick' && (
                        <div className="space-y-4 animate-fadeIn">
                            <div className="bg-sky-950/30 border border-sky-700/50 rounded p-3 text-sm text-slate-300">
                                <p className="font-bold text-sky-300 mb-1 flex items-center gap-2"><Lucide icon="sliders" className="w-4 h-4"/> Quick Sim — obs and rhythm only</p>
                                <p className="text-xs text-slate-400">A blank patient with editable observations, the full rhythm list, arrest/ROSC, the defibrillator and the monitor. No scenario brief, no drug library, no learning objectives. You still get the timer, the event log and a debrief.</p>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                <div>
                                    <label className="text-[10px] text-slate-500 uppercase">Age (years)</label>
                                    <input type="number" min={BUILDER_LIMITS.age.min} max={BUILDER_LIMITS.age.max} value={qsAge} onChange={e => setQsAge(e.target.value)} placeholder="40" className={fieldClass(qsAgeError)}/>
                                    <FieldError msg={qsAgeError}/>
                                </div>
                                <div>
                                    <label className="text-[10px] text-slate-500 uppercase">Weight (kg)</label>
                                    <input type="number" min={BUILDER_LIMITS.weight.min} max={BUILDER_LIMITS.weight.max} step="0.1" value={qsWeight} onChange={e => setQsWeight(e.target.value)} placeholder={qsAutoWeight ? `auto ${qsAutoWeight}` : 'optional'} className={fieldClass(qsWeightError)}/>
                                    <FieldError msg={qsWeightError}/>
                                </div>
                                <div>
                                    <label className="text-[10px] text-slate-500 uppercase">Sex</label>
                                    <select value={qsSex} onChange={e => setQsSex(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"><option>Male</option><option>Female</option></select>
                                </div>
                                <div>
                                    <label className="text-[10px] text-slate-500 uppercase">Name</label>
                                    <input type="text" value={qsName} onChange={e => setQsName(e.target.value)} placeholder="Quick Sim Patient" className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white placeholder-slate-500"/>
                                </div>
                            </div>

                            <div>
                                <label className="text-[10px] text-slate-500 uppercase">Starting rhythm</label>
                                <select value={qsRhythm} onChange={e => setQsRhythm(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white">
                                    {(window.RHYTHMS ? window.RHYTHMS.SELECTABLE : ['Sinus Rhythm']).map(r => <option key={r} value={r}>{window.RHYTHMS ? window.RHYTHMS.labelFor(r) : r}</option>)}
                                </select>
                                <p className="text-[10px] text-slate-500 mt-1">Changeable at any time from the controller, including every arrest rhythm.</p>
                            </div>

                            {/* A3: paediatric maths is live in Quick Sim exactly as in a real scenario. */}
                            {qsResolvedAge < 16 && !qsInvalid && (() => {
                                const w = qsWeight === '' ? (qsAutoWeight === null ? null : parseFloat(qsAutoWeight)) : Number(qsWeight);
                                const wf = w ? calculateWetflag(qsResolvedAge, w) : null;
                                if (!wf) return null;
                                return (
                                    <div className="p-3 bg-purple-900/20 border border-purple-500/40 rounded">
                                        <h4 className="text-[10px] font-bold text-purple-300 uppercase tracking-widest mb-1">WETFLAG will be active ({wf.weight} kg)</h4>
                                        <div className="text-[11px] text-slate-300">Shock energy {wf.energy} J · Tube {wf.tube} · Fluids {wf.fluids} ml · Adrenaline {wf.adrenaline} mcg · Glucose {wf.glucose} ml</div>
                                    </div>
                                );
                            })()}

                            <Button onClick={launchQuickSim} disabled={qsInvalid} className={`w-full py-4 text-lg shadow-lg shadow-sky-900/20 ${qsInvalid ? 'opacity-40 cursor-not-allowed' : ''}`}>Start Quick Sim</Button>
                            {qsInvalid && <p className="text-xs text-red-400 text-center">Fix the highlighted fields to start.</p>}
                        </div>
                    )}
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
                                        <button key={cat.id} onClick={() => setPremadeCategory(cat)} className={`flex flex-col items-center justify-center p-4 border rounded-lg transition-all active:scale-95 group ${cat.restricted ? 'bg-amber-950/30 hover:bg-amber-900/30 border-amber-700/60' : 'bg-slate-700 hover:bg-slate-600 border-slate-600'}`}>
                                            <Lucide icon={cat.restricted && !restrictedUnlocked ? 'lock' : cat.icon} className={`w-8 h-8 mb-2 ${cat.restricted ? 'text-amber-400' : 'text-sky-400 group-hover:text-white'}`} />
                                            <span className="text-sm font-bold text-slate-200 group-hover:text-white text-center leading-tight">{cat.label}</span>
                                            {cat.restricted && <span className="text-[9px] uppercase tracking-wider font-bold text-amber-500/80 mt-1">{restrictedUnlocked ? 'unlocked' : 'locked'}</span>}
                                        </button>
                                    ))}
                                </div>
                            ) : premadeCategory.restricted ? (
                                <RestrictedSection />
                            ) : (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2 mb-4"><Button variant="secondary" onClick={() => setPremadeCategory(null)} className="h-8 px-2 text-xs"><Lucide icon="arrow-left" /> Back</Button><h3 className="text-lg font-bold text-sky-400">{premadeCategory.label} Scenarios</h3></div>
                                    <div className="grid gap-2 max-h-[400px] overflow-y-auto pr-2">
                                        {ALL_SCENARIOS.filter(premadeCategory.filter).map((s) => (
                                            <div key={s.id} className="flex justify-between items-center bg-slate-700/40 hover:bg-slate-700 p-3 rounded border border-slate-600 group">
                                                <div className="flex-1">
                                                    <div className="font-bold text-slate-200 group-hover:text-white flex items-center gap-2">{s.title} {s.acuity === 'Resus' && <span className="text-[9px] bg-red-900/50 text-red-400 px-1 rounded border border-red-800">RESUS</span>} <DiffBadge d={s.difficulty}/></div>
                                                    <div className="text-xs text-slate-400">{getScenarioPreviewText(s).substring(0, 60)}...</div>
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
                             <div className="flex gap-2 pb-2 border-b border-slate-700">
                                 <Button onClick={exportCustomScenarios} variant="secondary" className="h-8 text-xs flex items-center gap-1"><Lucide icon="download" className="w-3 h-3"/> Export JSON</Button>
                                 <label className="cursor-pointer flex items-center">
                                     <span className="inline-flex items-center gap-1 px-3 h-8 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded text-xs text-slate-200 font-bold"><Lucide icon="upload" className="w-3 h-3"/> Import JSON</span>
                                     <input type="file" accept=".json" onChange={importCustomScenariosFile} className="hidden"/>
                                 </label>
                             </div>
                             {customScenarios.length === 0 && <p className="text-slate-500 text-sm italic text-center py-4">No custom scenarios saved yet. Use Builder to create one.</p>}
                             {customScenarios.map((s, i) => (
                                 <div key={i} className="flex justify-between items-center bg-slate-700/50 p-3 rounded border border-slate-600">
                                     <div><div className="font-bold text-white flex items-center gap-2">{s.title} <DiffBadge d={s.difficulty}/></div><div className="text-xs text-slate-400">{getScenarioPreviewText(s)}</div></div>
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
                                <div><label className="text-[10px] text-slate-500 uppercase">Age</label><input type="number" min={BUILDER_LIMITS.age.min} max={BUILDER_LIMITS.age.max} placeholder="Age" value={buildAge} onChange={e=>setBuildAge(e.target.value)} className={fieldClass(builderErrors.age)}/><FieldError msg={builderErrors.age}/></div>
                                <div><label className="text-[10px] text-slate-500 uppercase">Sex</label><select value={buildSex} onChange={e=>setBuildSex(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"><option>Male</option><option>Female</option></select></div>
                                <div><label className="text-[10px] text-slate-500 uppercase">Category</label><select value={buildCat} onChange={e=>setBuildCat(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"><option>Medical</option><option>Trauma</option><option>Cardiac Arrest</option><option>Toxicology</option><option>Obstetrics &amp; Gynae</option><option>Psychiatric</option><option>Paediatric</option></select></div>
                            </div>
                            <div>
                                <textarea placeholder="Description" value={buildDesc} onChange={e=>{ setDescDirty(true); setBuildDesc(e.target.value); }} className={`w-full bg-slate-900 border rounded p-2 text-white h-20 placeholder-slate-500 ${descStale ? 'border-amber-500' : 'border-slate-600'}`}/>
                                {descStale ? (
                                    <div className="flex items-center justify-between gap-2 text-[11px] text-amber-400 mt-1">
                                        <span>This brief may be out of date — it does not mention age {buildAge}.</span>
                                        <button type="button" onClick={() => { setDescDirty(false); setBuildDesc(autoDesc(buildAge, buildSex, buildTitle)); }} className="underline font-bold whitespace-nowrap">Regenerate</button>
                                    </div>
                                ) : (
                                    !descDirty && <div className="text-[10px] text-slate-500 mt-1">Auto-generated from age, sex and title. Editing it stops auto-updates.</div>
                                )}
                            </div>
                            <input type="text" placeholder="PMH (comma separated)" value={buildPMH} onChange={e=>setBuildPMH(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm placeholder-slate-500"/>
                            <input type="text" placeholder="Drug History (comma separated)" value={buildDhx} onChange={e=>setBuildDhx(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm placeholder-slate-500"/>
                            <input type="text" placeholder="Allergies (comma separated)" value={buildAllergies} onChange={e=>setBuildAllergies(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm placeholder-slate-500"/>
                            <div className="grid grid-cols-2 gap-2">
                                <div><label className="text-[10px] text-slate-500 uppercase">Difficulty</label><select value={buildDifficulty} onChange={e=>setBuildDifficulty(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></div>
                                <div><label className="text-[10px] text-slate-500 uppercase">Learning Objectives (comma separated)</label><input type="text" placeholder="e.g. Give adrenaline, Secure airway" value={buildLearningObj} onChange={e=>setBuildLearningObj(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm placeholder-slate-500"/></div>
                            </div>
                            <input type="text" placeholder="Custom Scenario Actions (comma separated, e.g. Call Cardiology, Request MRI)" value={buildCustomActions} onChange={e=>setBuildCustomActions(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm placeholder-slate-500"/>
                            <div className="grid grid-cols-2 gap-2">
                                <input type="url" placeholder="Chest X-ray Image URL (optional)" value={buildCxrUrl} onChange={e=>setBuildCxrUrl(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm placeholder-slate-500"/>
                                <input type="url" placeholder="CT Scan Image URL (optional)" value={buildCtUrl} onChange={e=>setBuildCtUrl(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm placeholder-slate-500"/>
                            </div>
                            
                            <h4 className="text-xs font-bold text-slate-500 uppercase mt-2">Initial Observations</h4>
                            <div className="grid grid-cols-3 gap-2">
                                {[['hr','Heart Rate'],['bpSys','Sys BP'],['rr','Resp Rate'],['spO2','SpO2 %'],['gcs','GCS'],['temp','Temp °C']].map(([key, label]) => (
                                    <div key={key}>
                                        <label className="text-[10px] text-slate-500 uppercase">{label}</label>
                                        <input type="number" min={BUILDER_LIMITS[key].min} max={BUILDER_LIMITS[key].max} value={buildVitals[key]} onChange={e=>setBuildVitals({...buildVitals, [key]: e.target.value})} className={fieldClass(builderErrors[key])}/>
                                        <FieldError msg={builderErrors[key]}/>
                                    </div>
                                ))}
                            </div>
                            <div>
                                <label className="text-[10px] text-slate-500 uppercase">Initial Rhythm</label>
                                <select onChange={(e) => setBuildVitals({...buildVitals, rhythm: e.target.value})} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white" value={buildVitals.rhythm || "Sinus Rhythm"}>{(window.RHYTHMS ? window.RHYTHMS.SELECTABLE : ['Sinus Rhythm']).map(r => <option key={r} value={r}>{window.RHYTHMS ? window.RHYTHMS.labelFor(r) : r}</option>)}</select>
                            </div>
                            <div>
                                <label className="text-[10px] text-slate-500 uppercase">Human Factors</label>
                                <select value={hf} onChange={e=>setHf(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white">{HUMAN_FACTOR_CHALLENGES.map(h=><option key={h.id} value={h.id}>{h.type}</option>)}</select>
                            </div>
                            <Button onClick={saveCustomScenario} variant="primary" disabled={builderInvalid} className="w-full text-lg h-12">Run Scenario</Button>
                            {builderInvalid && <p className="text-xs text-red-400 text-center">Fix the highlighted fields above to run this scenario.</p>}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const JoinScreen = ({ onJoin }) => {
        const { Button } = window;
        const [code, setCode] = useState("");
        return (<div className="flex flex-col items-center justify-center h-full bg-slate-900 text-white p-4"><div className="w-full max-w-md space-y-6 text-center"><div className="flex justify-center mb-4"><img src="https://raw.githubusercontent.com/shakeymedic/wmem/main/emevidence_logo.png" alt="Logo" className="h-20 object-contain" /></div><h1 className="text-3xl font-bold text-sky-400">Sim Monitor</h1><p className="text-slate-400">Enter the Session Code</p><p className="text-xs text-slate-500">Quicker: tap <b>Join</b> on the controller and scan the QR code with this tablet's camera.</p><input type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} onKeyDown={e => { if (e.key === 'Enter' && code.length >= 4) onJoin(code); }} placeholder="e.g. K7PQ3M" autoCapitalize="characters" autoComplete="off" className="w-full bg-slate-800 border-2 border-slate-600 rounded-lg p-4 text-center text-3xl font-mono tracking-widest uppercase text-white outline-none" maxLength={6}/><Button onClick={() => onJoin(code)} disabled={code.length < 4} className="w-full py-4 text-xl">Connect</Button></div></div>);
    };

    const BriefingScreen = ({ scenario: rawScenario, onStart, onBack }) => {
        const { Button, Lucide, HumanFactorBadge } = window;
        const scenario = rawScenario || {};
        const brief = scenario.instructorBrief || {};
        return (
            <div className="max-w-5xl mx-auto space-y-6 animate-fadeIn p-4 overflow-y-auto h-full">
                <div className="bg-slate-800 border-l-4 border-sky-500 shadow-lg rounded-lg overflow-hidden">
                    <div className="p-6 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
                        <div>
                            <h2 className="text-3xl font-bold text-white mb-2">{scenario.title}</h2>
                            <div className="flex gap-2 mt-2"><span className="bg-slate-700 text-sky-300 text-xs px-2 py-1 rounded border border-slate-600">{scenario.category}</span><span className="bg-slate-700 text-emerald-300 text-xs px-2 py-1 rounded border border-slate-600">{scenario.ageRange}</span><span className="bg-slate-700 text-amber-300 text-xs px-2 py-1 rounded border border-slate-600">{scenario.acuity}</span><HumanFactorBadge hf={scenario.hf} /></div>
                            {scenario.hf && scenario.hf.id !== 'hf0' && <p className="text-xs text-fuchsia-300/80 mt-2 max-w-md">{scenario.hf.description}</p>}
                        </div>
                        <div className="text-right"><div className="text-[10px] text-slate-500 uppercase font-bold">Initial GCS</div><div className="text-4xl font-mono font-bold text-white">{scenario.vitals ? scenario.vitals.gcs : '-'}</div></div>
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
                            <div className="p-3 bg-amber-900/20 rounded border border-amber-600/30"><h4 className="text-sm font-bold text-amber-400 uppercase mb-1">Clinical Progression</h4><p className="text-sm text-slate-300 leading-snug">{brief.progression}</p></div>
                            <div className="p-3 bg-emerald-900/20 rounded border border-emerald-600/30"><h4 className="text-sm font-bold text-emerald-400 uppercase mb-1">Key Interventions</h4><ul className="list-disc pl-4 text-sm text-slate-300 space-y-1">{brief.interventions && brief.interventions.map((l, i) => <li key={i}>{l}</li>)}</ul></div>
                            <div className="p-3 bg-slate-900/50 rounded border border-slate-600"><h4 className="text-sm font-bold text-slate-400 uppercase mb-1">Guidelines & Resources</h4><div className="flex flex-col gap-1">{scenario.learningLinks && scenario.learningLinks.map((link, i) => (<a key={i} href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-sky-400 hover:underline"><Lucide icon="external-link" className="w-3 h-3"/> {link.label}</a>))}</div></div>
                            <div className="p-3 bg-indigo-900/20 rounded border border-indigo-600/30"><h4 className="text-sm font-bold text-indigo-400 uppercase mb-1">Learning Objectives</h4><ul className="list-disc pl-4 text-sm text-slate-300 space-y-1">{(brief.debriefPoints || brief.learningObjectives || []).map((l, i) => <li key={i}>{l}</li>)}</ul></div>
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
