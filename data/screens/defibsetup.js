(() => {
    const { useState } = React;

    // =============================================================================================
    // DEFIB SIM — the start-screen tab. Pick a scenario (or free play, or a custom stepped scenario),
    // Education or Assessment, and optionally the patient's age/weight so paediatric energies apply.
    // The learner runs the defibrillator on a tablet (Join -> Defibrillator QR code); the
    // facilitator gets the Defib controller. Everything else (engine, session, debrief) is shared.
    // =============================================================================================
    const DefibSimSetup = ({ onStart }) => {
        const { Button, Lucide, validateBuilderField, BUILDER_LIMITS } = window;
        const D = window.DefibSim;
        const RG = window.RHYTHMS;

        const [mode, setMode] = useState('education');
        const [choice, setChoice] = useState('vf-arrest');
        const [age, setAge] = useState('40');
        const [weight, setWeight] = useState('');
        const [sex, setSex] = useState('Male');
        const [steps, setSteps] = useState([{ rhythm: 'VF', trigger: 'shock' }, { rhythm: 'Sinus Rhythm', trigger: 'analyse' }]);
        const [saved, setSaved] = useState(() => D.savedNames());
        const [savedSel, setSavedSel] = useState('');
        const [note, setNote] = useState(null);
        const fileRef = React.useRef(null);

        const ageError = age === '' ? null : validateBuilderField('age', age);
        const weightError = weight === '' ? null : validateBuilderField('weight', weight);
        const stepsValid = choice !== 'custom' || !!D.normaliseSteps(steps);
        const invalid = !!(ageError || weightError) || !stepsValid;
        const fieldClass = (err) => `w-full bg-slate-900 border rounded p-2 text-white ${err ? 'border-red-500' : 'border-slate-600'}`;

        const groups = [];
        D.SCENARIOS.forEach(s => {
            let g = groups.find(x => x.name === s.group);
            if (!g) { g = { name: s.group, items: [] }; groups.push(g); }
            g.items.push(s);
        });

        const setStep = (i, key, value) => setSteps(steps.map((s, j) => j === i ? { ...s, [key]: value } : s));
        const flash = (text, kind = 'ok') => { setNote({ text, kind }); setTimeout(() => setNote(null), 4000); };

        const saveSteps = () => {
            const clean = D.normaliseSteps(steps);
            if (!clean) { flash('Add at least one step first.', 'err'); return; }
            const name = (window.prompt('Name for this scenario:') || '').trim();
            if (!name) return;
            if (D.savedNames().indexOf(name) !== -1 && !window.confirm(`Replace the saved scenario "${name}"?`)) return;
            if (D.save(name, clean)) { setSaved(D.savedNames()); setSavedSel(name); flash(`Saved "${name}" in this browser.`); }
            else flash('Could not save in this browser (storage unavailable). Use Export instead.', 'err');
        };
        const loadSteps = () => {
            const s = savedSel && D.loadSaved(savedSel);
            if (s) { setSteps(s); flash(`Loaded "${savedSel}".`); }
        };
        const deleteSteps = () => {
            if (!savedSel || !window.confirm(`Delete the saved scenario "${savedSel}"?`)) return;
            D.remove(savedSel); setSaved(D.savedNames()); setSavedSel('');
        };
        const exportSteps = () => {
            if (!D.normaliseSteps(steps)) { flash('Add at least one step first.', 'err'); return; }
            const blob = new Blob([D.exportText(steps)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'defib-scenario.json';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        };
        const importSteps = (e) => {
            const file = e.target.files && e.target.files[0];
            e.target.value = '';
            if (!file) return;
            file.text().then(text => {
                const s = D.parseFile(text);
                if (!s) throw new Error('invalid');
                setSteps(s); flash('Scenario imported.');
            }).catch(() => flash('That file is not a valid Defib Sim scenario.', 'err'));
        };

        const start = () => {
            if (invalid) return;
            onStart({ scenario: choice, mode, steps, age: age === '' ? 40 : Number(age), weight: weight === '' ? null : Number(weight), sex });
        };

        const optionClass = (on) => `text-left p-3 rounded border transition-colors ${on ? 'bg-sky-900/40 border-sky-400 text-white' : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'}`;

        return (
            <div className="space-y-4 animate-fadeIn" data-testid="defib-setup">
                <div className="bg-amber-950/30 border border-amber-700/50 rounded p-3 text-sm text-slate-300">
                    <p className="font-bold text-amber-300 mb-1 flex items-center gap-2"><Lucide icon="zap" className="w-4 h-4"/> Defib Sim — defibrillator skills</p>
                    <p className="text-xs text-slate-400">The learner uses a ZOLL-style defibrillator on a tablet (<b>Join</b> → Defibrillator QR code, or open <span className="font-mono">defib/</span> with this session code). You run the scenario from the Defib controller: rhythm, shock response, CPR, drugs and the event log. Works on the same computer or remotely.</p>
                </div>

                <div>
                    <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Mode</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button type="button" onClick={() => setMode('education')} className={optionClass(mode === 'education')} aria-pressed={mode === 'education'}>
                            <div className="font-bold">Education</div>
                            <div className="text-xs text-slate-400">Pulse-check results and RCUK hint cards on the defib.</div>
                        </button>
                        <button type="button" onClick={() => setMode('assessment')} className={optionClass(mode === 'assessment')} aria-pressed={mode === 'assessment'}>
                            <div className="font-bold">Assessment</div>
                            <div className="text-xs text-slate-400">No pulse-check results or hint cards on the defib. Feedback in the debrief.</div>
                        </button>
                    </div>
                </div>

                <div>
                    <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Scenario</div>
                    <div className="space-y-3">
                        {groups.map(g => (
                            <div key={g.name}>
                                <div className="text-xs font-bold text-slate-400 mb-1">{g.name}</div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    {g.items.map(s => (
                                        <button key={s.id} type="button" data-defib-scenario={s.id} onClick={() => setChoice(s.id)} className={optionClass(choice === s.id)} aria-pressed={choice === s.id}>
                                            <div className="font-bold text-sm">{s.name}</div>
                                            <div className="text-[11px] text-slate-400 line-clamp-2">{s.description}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <button type="button" data-defib-scenario="free" onClick={() => setChoice('free')} className={optionClass(choice === 'free')} aria-pressed={choice === 'free'}>
                                <div className="font-bold text-sm">Free play</div>
                                <div className="text-[11px] text-slate-400">Starts in sinus rhythm; you change the rhythm as you go.</div>
                            </button>
                            <button type="button" data-defib-scenario="custom" onClick={() => setChoice('custom')} className={optionClass(choice === 'custom')} aria-pressed={choice === 'custom'}>
                                <div className="font-bold text-sm">Custom scenario</div>
                                <div className="text-[11px] text-slate-400">Up to {D.MAX_STEPS} rhythm steps, each moving on at a trigger you choose.</div>
                            </button>
                        </div>
                    </div>
                </div>

                {choice === 'custom' && (
                    <div className="bg-slate-900 border border-slate-700 rounded p-3 space-y-2" data-testid="defib-steps">
                        {steps.map((s, i) => (
                            <div key={i} className="grid grid-cols-[auto_1fr_1fr_auto] gap-2 items-center">
                                <span className="text-xs font-bold text-sky-300 w-12">Step {i + 1}</span>
                                <select aria-label={`Step ${i + 1} rhythm`} value={s.rhythm} onChange={e => setStep(i, 'rhythm', e.target.value)} className="bg-slate-800 border border-slate-600 rounded p-1.5 text-sm text-white">
                                    {RG.SELECTABLE.map(r => <option key={r} value={r}>{RG.labelFor(r)}</option>)}
                                </select>
                                <select aria-label={`Step ${i + 1} trigger`} value={s.trigger} onChange={e => setStep(i, 'trigger', e.target.value)} className="bg-slate-800 border border-slate-600 rounded p-1.5 text-sm text-white">
                                    {Object.keys(D.TRIGGERS).map(t => <option key={t} value={t}>{D.TRIGGERS[t]}</option>)}
                                </select>
                                <button type="button" aria-label={`Remove step ${i + 1}`} onClick={() => setSteps(steps.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-200 px-2"><Lucide icon="x" className="w-4 h-4"/></button>
                            </div>
                        ))}
                        {!steps.length && <div className="text-xs text-slate-500">No steps yet.</div>}
                        <div className="flex flex-wrap gap-2 pt-1">
                            <Button variant="outline" disabled={steps.length >= D.MAX_STEPS} onClick={() => setSteps(steps.concat([{ rhythm: 'Sinus Rhythm', trigger: 'analyse' }]))} className="h-8 text-xs">{steps.length >= D.MAX_STEPS ? `Maximum ${D.MAX_STEPS} steps` : '+ Add step'}</Button>
                            <select aria-label="Saved scenarios" value={savedSel} onChange={e => setSavedSel(e.target.value)} className="bg-slate-800 border border-slate-600 rounded px-2 text-xs text-white h-8">
                                <option value="">{saved.length ? '- Saved scenarios -' : '- None saved -'}</option>
                                {saved.map(n => <option key={n} value={n}>{n}</option>)}
                            </select>
                            <Button variant="outline" onClick={loadSteps} disabled={!savedSel} className="h-8 text-xs">Load</Button>
                            <Button variant="outline" onClick={saveSteps} className="h-8 text-xs">Save</Button>
                            <Button variant="outline" onClick={deleteSteps} disabled={!savedSel} className="h-8 text-xs">Delete</Button>
                            <Button variant="outline" onClick={exportSteps} className="h-8 text-xs">Export file</Button>
                            <Button variant="outline" onClick={() => fileRef.current && fileRef.current.click()} className="h-8 text-xs">Import file</Button>
                            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importSteps} data-testid="defib-import" />
                        </div>
                        <p className="text-[10px] text-slate-500">Saved scenarios stay in this browser. Files exported from the standalone Defib-sim import here too.</p>
                    </div>
                )}

                <div className="grid grid-cols-3 gap-2">
                    <div>
                        <label className="text-[10px] text-slate-500 uppercase" htmlFor="defibAge">Age (years)</label>
                        <input id="defibAge" type="number" min={BUILDER_LIMITS.age.min} max={BUILDER_LIMITS.age.max} value={age} onChange={e => setAge(e.target.value)} className={fieldClass(ageError)} />
                    </div>
                    <div>
                        <label className="text-[10px] text-slate-500 uppercase" htmlFor="defibWeight">Weight (kg)</label>
                        <input id="defibWeight" type="number" min={BUILDER_LIMITS.weight.min} max={BUILDER_LIMITS.weight.max} step="0.1" value={weight} onChange={e => setWeight(e.target.value)} placeholder="optional" className={fieldClass(weightError)} />
                    </div>
                    <div>
                        <label className="text-[10px] text-slate-500 uppercase" htmlFor="defibSex">Sex</label>
                        <select id="defibSex" value={sex} onChange={e => setSex(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white"><option>Male</option><option>Female</option></select>
                    </div>
                </div>
                {(ageError || weightError) && <p className="text-xs text-red-400">{ageError || weightError}</p>}

                {note && <div role="status" className={`text-xs ${note.kind === 'err' ? 'text-red-300' : 'text-emerald-300'}`}>{note.text}</div>}

                <Button onClick={start} disabled={invalid} className={`w-full py-4 text-lg ${invalid ? 'opacity-40 cursor-not-allowed' : ''}`}>Start Defib Sim</Button>
            </div>
        );
    };

    window.DefibSimSetup = DefibSimSetup;
})();
