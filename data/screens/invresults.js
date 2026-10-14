// WHAT THE INVESTIGATION BUTTONS RETURN: the facilitator's choice of result for each investigation
// (ECG, VBG, X-ray, Urine, POCUS, CT), before START or during the run, in every mode.
//
//   - ResultsPanel lists each investigation with the result its button on the room monitor gives now
//     (the scenario's own unless changed), with Change and Undo.
//   - ResultEditor is the chooser: library findings with real images, report-only findings, presets
//     (VBG, urine dipstick, POCUS), typed VBG values and a typed report.
//   - LiveResults wires the two to a running simulation (data/engine.js): a choice rewrites the
//     scenario's result fields through INVESTIGATIONS.setResult, so the sync payload carries it to the
//     room monitor and nothing new is synced or stored. Choosing sends nothing to the monitor.
//
// The Builder uses ResultsPanel and ResultEditor with its own list of choices (scenario.invResults),
// applied when the scenario runs (INVESTIGATIONS.applyResultSpecs).
(() => {
    const { useState } = React;
    const INV = () => window.INVESTIGATIONS;

    const SHORT = { ECG: '12-lead ECG', VBG: 'VBG', 'X-ray': 'X-ray', Urine: 'Urine', POCUS: 'POCUS', CT: 'CT' };

    function ResultsPanel({ rows, onEdit, onReset, intro, resetTitle }) {
        const { Lucide } = window;
        const I = INV();
        return (
            <div data-testid="inv-results-panel">
                {intro && <p className="text-[11px] text-slate-400 mb-2">{intro}</p>}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
                    {rows.map(r => {
                        const img = r.image && I ? I.imageFor(r.image) : null;
                        return (
                            <div key={r.type} data-testid={`inv-result-row-${r.type}`} className={`flex gap-2 items-center p-1.5 rounded border ${r.changed ? 'border-amber-500/70 bg-amber-950/20' : 'border-slate-700 bg-slate-900'}`}>
                                {img ? <img src={img.src} alt="" className="w-10 h-8 object-cover rounded flex-none bg-white" loading="lazy" />
                                     : <div className="w-10 h-8 rounded flex-none bg-slate-800 flex items-center justify-center"><Lucide icon="file-text" className="w-4 h-4 text-slate-500" /></div>}
                                <div className="min-w-0 flex-1">
                                    <div className="text-[11px] font-bold text-slate-100 flex items-center gap-1.5">
                                        {SHORT[r.type] || r.type}
                                        {r.changed && <span className="text-[9px] uppercase tracking-wide text-amber-300 font-bold" data-testid="inv-result-changed">Changed</span>}
                                    </div>
                                    <div className="text-[10px] text-slate-400 line-clamp-2" title={r.text || ''}>
                                        {r.changed && r.label ? <b className="text-amber-200">{r.label}: </b> : null}{r.text || 'Image only.'}
                                    </div>
                                    {r.ecgImageNotFitting && <div className="text-[10px] text-amber-300">The chosen ECG does not match the current rhythm, so the 12-lead is drawn from the rhythm.</div>}
                                </div>
                                <div className="flex flex-col gap-1 flex-none">
                                    <button type="button" onClick={() => onEdit(r.type)} aria-label={`Change the ${SHORT[r.type] || r.type} result`}
                                            className="text-[10px] uppercase font-bold px-2 py-1 rounded border border-sky-600 text-sky-300 hover:bg-sky-900/40">Change</button>
                                    {r.changed && onReset && (
                                        <button type="button" onClick={() => onReset(r.type)} aria-label={`Undo the ${SHORT[r.type] || r.type} change`} title={resetTitle || ''}
                                                className="text-[10px] uppercase font-bold px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700">Undo</button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    function ResultEditor({ type, current, currentVbg, onPick, onReset, onClose, resetLabel, rhythmLabel }) {
        const { Modal, Button, Lucide } = window;
        const I = INV();
        const [text, setText] = useState('');
        const startVbg = currentVbg || (window.generateVbg ? window.generateVbg('normal') : {});
        const toFields = (v) => {
            const o = {};
            I.VBG_FIELDS.forEach(f => { o[f.k] = (v && Number.isFinite(Number(v[f.k]))) ? String(v[f.k]) : ''; });
            return o;
        };
        const [vbg, setVbg] = useState(() => toFields(startVbg));
        const [vbgPreset, setVbgPreset] = useState(null);
        const vbgErrors = I.VBG_FIELDS.filter(f => {
            const raw = vbg[f.k];
            if (raw === '' || raw === undefined) return !f.optional;
            const n = Number(raw);
            return !Number.isFinite(n) || n < f.min || n > f.max;
        }).map(f => f.k);
        const findings = (I.FINDINGS[type] || []);
        const withImage = findings.filter(f => f.image), reportOnly = findings.filter(f => !f.image);
        const pick = (spec) => { onPick(spec); };
        const opt = 'text-left px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-xs text-slate-100 rounded border border-slate-600';
        const lbl = 'text-xs text-slate-400 font-bold uppercase mb-2 block';

        return (
            <Modal fixed label={`${type} result`} onClose={onClose}>
                <div className="bg-slate-800 p-5 rounded-lg border border-slate-600 w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col" data-testid="inv-result-editor">
                    <div className="flex justify-between items-start mb-3 gap-2">
                        <div className="min-w-0">
                            <h3 className="text-lg font-bold text-white uppercase tracking-wider">{type} result</h3>
                            <p className="text-[11px] text-slate-400">What the team gets when they press {type === 'ECG' ? '12-Lead' : type === 'X-ray' ? 'CXR' : type === 'CT' ? 'CT Head' : type} on the patient monitor. Choosing here sends nothing.</p>
                        </div>
                        <button aria-label="Close without changing" onClick={onClose} className="text-slate-400 hover:text-white flex-none"><Lucide icon="x" className="w-5 h-5"/></button>
                    </div>
                    {current && (
                        <div className="bg-slate-900 border border-slate-700 rounded p-2 mb-3 text-[11px] text-slate-300" data-testid="inv-editor-current">
                            <b className="text-slate-100">Now:</b> {current.changed && current.label ? `${current.label}. ` : ''}{current.text || 'Image only.'}
                        </div>
                    )}
                    <div className="space-y-4 overflow-y-auto flex-grow pr-1">
                        {type === 'ECG' && (
                            <div>
                                <button type="button" className={`${opt} w-full`} onClick={() => pick({ ecgLive: true })}>
                                    <b>Drawn from the live rhythm</b>{rhythmLabel ? ` (now ${rhythmLabel})` : ''}
                                </button>
                                <p className="text-[10px] text-slate-400 mt-1">A real 12-lead shows only while the patient is in a rhythm it fits (for example a STEMI tracing in sinus rhythm). Otherwise the 12-lead is drawn from the rhythm.</p>
                            </div>
                        )}
                        {type === 'VBG' && (
                            <div data-testid="inv-vbg-editor">
                                <label className={lbl}>Start from</label>
                                <div className="flex flex-wrap gap-1 mb-2">
                                    {I.VBG_PRESETS.map(p => (
                                        <button key={p.id} type="button" onClick={() => { setVbg(toFields(window.generateVbg ? window.generateVbg(p.id) : {})); setVbgPreset(p.id); }}
                                                className={`text-[11px] px-2 py-1 rounded border ${vbgPreset === p.id ? 'border-sky-400 bg-sky-900/40 text-white' : 'border-slate-600 bg-slate-700 text-slate-200 hover:bg-slate-600'}`}>{p.label}</button>
                                    ))}
                                </div>
                                <label className={lbl}>Values</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {I.VBG_FIELDS.map(f => (
                                        <label key={f.k} className="text-[11px] text-slate-300 flex flex-col gap-0.5">
                                            {f.label}
                                            <input type="number" inputMode="decimal" step={f.step} min={f.min} max={f.max} value={vbg[f.k]} aria-label={f.label}
                                                   data-testid={`vbg-${f.k}`}
                                                   onChange={e => { const v = e.target.value; setVbg(o => Object.assign({}, o, { [f.k]: v })); setVbgPreset(null); }}
                                                   className={`bg-slate-900 border rounded px-2 h-8 text-sm text-white ${vbgErrors.indexOf(f.k) !== -1 ? 'border-red-500' : 'border-slate-600'}`} />
                                        </label>
                                    ))}
                                </div>
                                {vbgErrors.length > 0 && <p className="text-[11px] text-red-300 mt-1">Check: {vbgErrors.map(k => (I.VBG_FIELDS.filter(f => f.k === k)[0] || {}).label).join(', ')}.</p>}
                                <p className="text-[10px] text-slate-400 mt-1">These are the values the team gets now. As before, the gas still changes with time and treatment (ventilation, shock, insulin).</p>
                                <Button onClick={() => pick({ vbg: I.cleanVbg(vbg, startVbg), preset: vbgPreset })} variant="primary" className="w-full mt-2" disabled={vbgErrors.length > 0}>Use these values</Button>
                            </div>
                        )}
                        {type === 'Urine' && (
                            <div>
                                <label className={lbl}>Dipstick</label>
                                <div className="grid grid-cols-1 gap-1.5">
                                    {I.URINE_PRESETS.map(p => <button key={p.id} type="button" className={opt} onClick={() => pick({ urine: p.id })}>{p.label}</button>)}
                                </div>
                            </div>
                        )}
                        {type === 'POCUS' && (
                            <div>
                                <label className={lbl}>Quick results</label>
                                <div className="grid grid-cols-1 gap-1.5">
                                    {I.POCUS_PRESETS.map(p => <button key={p.id} type="button" className={opt} onClick={() => pick({ pocus: p.id })}>{p.label}</button>)}
                                </div>
                            </div>
                        )}
                        {withImage.length > 0 && (
                            <div>
                                <label className={lbl}>Results with a real image</label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="inv-editor-library">
                                    {withImage.map(f => {
                                        const img = I.imageFor(f.image);
                                        return (
                                            <button key={f.id} type="button" onClick={() => pick({ findingId: f.id })} title={f.report}
                                                    className="text-left flex gap-2 items-center p-1.5 bg-slate-700 hover:bg-slate-600 rounded border border-slate-600">
                                                <img src={img.src} alt="" className="w-14 h-11 object-cover rounded flex-none bg-white" loading="lazy" />
                                                <span className="text-xs text-slate-100 leading-tight">{f.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                        {reportOnly.length > 0 && (
                            <div>
                                <label className={lbl}>More results (written report only)</label>
                                <div className="grid grid-cols-1 gap-1.5">
                                    {reportOnly.map(f => <button key={f.id} type="button" className={opt} title={f.report} onClick={() => pick({ findingId: f.id })}>{f.label}</button>)}
                                </div>
                            </div>
                        )}
                        {type !== 'VBG' && type !== 'ECG' && (
                            <div>
                                <label className={lbl}>Your own report</label>
                                <textarea value={text} onChange={e => setText(e.target.value)} aria-label={`Your own ${type} report`} data-testid="inv-editor-text"
                                          className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm h-20" placeholder="Type the report the team will see..."></textarea>
                                <Button onClick={() => pick({ text: text.trim() })} variant="primary" className="w-full mt-2" disabled={!text.trim()}>Use this report</Button>
                            </div>
                        )}
                    </div>
                    <div className="border-t border-slate-700 pt-3 mt-2 flex-shrink-0 grid grid-cols-2 gap-2">
                        <Button onClick={onClose} variant="outline" className="w-full">Cancel</Button>
                        <Button onClick={onReset} variant="secondary" className="w-full" disabled={!current || !current.changed}>{resetLabel || "Scenario's own result"}</Button>
                    </div>
                </div>
            </Modal>
        );
    }

    // The panel and chooser wired to a running simulation.
    function LiveResults({ sim, addLogEntry, intro }) {
        const I = INV();
        const [editing, setEditing] = useState(null);
        const state = sim.state;
        const scenario = state.scenario;
        if (!I || !scenario) return null;
        const RG = window.RHYTHMS;
        const rows = I.RESULT_TYPES.map(type => Object.assign({ type }, I.currentResult(scenario, type, state.rhythm)));
        const apply = (type, spec) => {
            const next = I.setResult(scenario, type, spec);
            sim.dispatch({ type: 'UPDATE_SCENARIO', payload: next });
            if (addLogEntry) addLogEntry(spec ? `${type} result set: ${I.specLabel(type, spec)}` : `${type} result back to the scenario's own`, 'system');
            setEditing(null);
        };
        const cur = editing ? rows.filter(r => r.type === editing)[0] : null;
        const scenarioVbg = scenario.vbg || (scenario.investigations || {}).vbg || null;
        return (
            <>
                <ResultsPanel rows={rows} onEdit={setEditing} onReset={(t) => apply(t, null)} resetTitle="Back to the scenario's own result"
                              intro={intro === undefined ? "What each investigation button on the patient monitor gives. Change any of them before START or during the run; nothing is sent until the team (or you) asks for the result." : intro} />
                {editing && (
                    <ResultEditor type={editing} current={cur} currentVbg={scenarioVbg}
                                  rhythmLabel={RG ? RG.labelFor(state.rhythm) : state.rhythm}
                                  onPick={(spec) => apply(editing, spec)} onReset={() => apply(editing, null)} onClose={() => setEditing(null)} />
                )}
            </>
        );
    }

    window.InvResults = { ResultsPanel, ResultEditor, LiveResults };
})();
