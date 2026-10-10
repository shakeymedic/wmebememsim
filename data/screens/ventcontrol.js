// THE FACILITATOR'S VENTILATOR CONTROLS (phase 3 of the ventilator plan), used by the controller's
// Ventilator section (data/screens/livesim.js).
//
//   VentPatientPanel  the patient side, shared by every ventilator in the session (live.vent): the
//                     lung adjustments (the trainer's Lungs panel), the injected problems, and
//                     Education / Assessment.
//   VentRemotePanel   one ventilator's remote control (sessions/<CODE>/ventCmd): power, start and
//                     standby, mode, every setting and alarm limit of the current mode, silence,
//                     O2 enrichment, screen lock and a fresh ventilator. Changes appear on the T1 as a
//                     colleague's would and are logged as the facilitator's.
(() => {
    const { useState } = React;
    const VP = window.VENT_PROFILES;

    const Step = ({ label, onDown, onUp, disabled, children }) => (
        <div className="flex items-center gap-1">
            <button type="button" aria-label={`${label} down`} disabled={disabled} onClick={onDown}
                    className="w-6 h-6 rounded bg-slate-700 text-white font-bold disabled:opacity-30">{'−'}</button>
            {children}
            <button type="button" aria-label={`${label} up`} disabled={disabled} onClick={onUp}
                    className="w-6 h-6 rounded bg-slate-700 text-white font-bold disabled:opacity-30">+</button>
        </div>
    );
    const Seg = ({ label, options, value, onChange }) => (
        <div className="flex gap-1" role="group" aria-label={label}>
            {options.map(([v, text]) => (
                <button key={text} type="button" aria-pressed={value === v} onClick={() => { if (value !== v) onChange(v); }}
                        className={`px-2 py-0.5 rounded border text-[10px] font-bold ${value === v ? 'bg-cyan-700 border-cyan-400 text-white' : 'bg-slate-900 border-slate-600 text-slate-300'}`}>{text}</button>
            ))}
        </div>
    );
    const fmtNum = (v) => Math.round(v * 10) / 10;

    // ---- the patient: lungs, problems, Education / Assessment ---------------------------------
    const VentPatientPanel = ({ sim, cfg, addLogEntry }) => {
        if (!VP) return null;
        const base = VP.profiles[cfg.profile] || VP.profiles.normal;
        const lung = VP.lungFor({ profile: cfg.profile, breathing: cfg.breathing });
        const adj = cfg.lung || {};
        const probs = VP.probList(cfg.probs);
        const setCfg = (payload) => sim.dispatch({ type: 'SET_VENT_CONFIG', payload });
        const stepLung = (k, dir) => {
            const d = VP.LUNG_ADJ[k];
            const cur = adj[k] !== undefined && adj[k] !== null ? adj[k] : d.def(base);
            const v = Math.min(d.max, Math.max(d.min, Math.round((cur + dir * d.step) * 10) / 10));
            if (v === cur) return;
            setCfg({ lung: { [k]: v } });
            addLogEntry(`Ventilator lungs: ${d.name.toLowerCase()} ${fmtNum(v)}${d.unit === '%' ? '%' : ' ' + d.unit} (facilitator)`, 'system');
        };
        const toggleProb = (p) => {
            const on = probs.indexOf(p.id) === -1;
            setCfg({ probs: on ? probs.concat(p.id) : probs.filter(id => id !== p.id) });
            addLogEntry(on ? `Ventilator problem injected: ${p.label} (facilitator)` : `Ventilator problem fixed: ${p.label} (facilitator)`, on ? 'warning' : 'system');
        };
        return (
            <div className="flex flex-col gap-2" data-testid="vent-patient">
                <div className="flex items-center justify-between gap-2">
                    <span className="whitespace-nowrap text-slate-400 uppercase font-bold text-[10px]">On the T1</span>
                    <Seg label="Education or Assessment" value={cfg.assess === true}
                         options={[[false, 'Education'], [true, 'Assessment']]}
                         onChange={(v) => { setCfg({ assess: v }); addLogEntry(v ? 'Ventilator: Assessment (no alarm help on the screen) (facilitator)' : 'Ventilator: Education (alarm help on the screen) (facilitator)', 'system'); }} />
                </div>
                <details>
                    <summary className="cursor-pointer text-slate-300 font-bold">Lungs{Object.keys(adj).length ? ' (adjusted)' : ''}</summary>
                    <div className="flex flex-col gap-1 mt-1">
                        {VP.LUNG_ORDER.map(k => {
                            const d = VP.LUNG_ADJ[k];
                            const v = adj[k] !== undefined && adj[k] !== null ? adj[k] : d.def(base);
                            const off = k === 'e' && lung.sedated;
                            return (
                                <div key={k} className="flex items-center justify-between gap-2">
                                    <span className={off ? 'text-slate-500' : ''}>{d.name}</span>
                                    <Step label={d.name} disabled={off} onDown={() => stepLung(k, -1)} onUp={() => stepLung(k, 1)}>
                                        <span className="w-20 text-center font-mono text-white" data-testid={`vent-lung-${k}`}>{fmtNum(v)}<span className="text-[9px] text-slate-400 ml-0.5">{d.unit}</span></span>
                                    </Step>
                                </div>
                            );
                        })}
                        {Object.keys(adj).length > 0 && (
                            <button type="button" className="self-start px-2 py-0.5 rounded bg-slate-700 text-white text-[10px] font-bold"
                                    onClick={() => { setCfg({ lung: null }); addLogEntry('Ventilator lungs reset to this patient (facilitator)', 'system'); }}>Reset lungs to this patient</button>
                        )}
                    </div>
                </details>
                <div>
                    <div className="flex items-center justify-between">
                        <span className="text-slate-400 uppercase font-bold text-[10px]">Problems (press again to fix)</span>
                        {probs.length > 0 && <button type="button" className="px-2 py-0.5 rounded bg-emerald-700 text-white text-[10px] font-bold"
                                onClick={() => { setCfg({ probs: [] }); addLogEntry('Ventilator problems: all fixed (facilitator)', 'system'); }}>Fix all</button>}
                    </div>
                    <div className="grid grid-cols-2 gap-1 mt-1">
                        {VP.PROBLEMS.map(p => {
                            const on = probs.indexOf(p.id) !== -1;
                            return (
                                <button key={p.id} type="button" aria-pressed={on} onClick={() => toggleProb(p)}
                                        className={`text-left px-1.5 py-1 rounded border text-[10px] leading-tight ${on ? 'bg-red-800 border-red-400 text-white font-bold' : 'bg-slate-900 border-slate-600 text-slate-200'}`}>
                                    {on ? 'Fix: ' : ''}{p.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    };

    // ---- one ventilator: remote control ------------------------------------------------------
    const parseRows = (s) => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
    const ValueRow = ({ row, kind, send }) => {
        const [k, label, value, shown, unit] = row;
        const [draft, setDraft] = useState(null);
        const commit = () => {
            if (draft === null) return;
            const n = Number(draft);
            setDraft(null);
            if (draft.trim() !== '' && Number.isFinite(n) && n !== value) send(kind, k, n);
        };
        const typed = k !== 'ie';
        return (
            <div className="flex items-center justify-between gap-2">
                <span>{label}</span>
                <Step label={label} onDown={() => send(kind + 'step', k, -1)} onUp={() => send(kind + 'step', k, 1)}>
                    {typed
                        ? <input aria-label={`${label} value`} inputMode="decimal" value={draft !== null ? draft : shown}
                                 onFocus={() => setDraft(String(value >= 99999 ? '' : value))} onChange={e => setDraft(e.target.value)}
                                 onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); } }}
                                 className="w-16 text-center font-mono bg-slate-900 border border-slate-600 rounded text-white" />
                        : <span className="w-16 text-center font-mono text-white">{shown}</span>}
                    <span className="w-12 text-[9px] text-slate-400">{unit}</span>
                </Step>
            </div>
        );
    };
    const VentRemotePanel = ({ sim, m }) => {
        if (!VP || !sim.sendVentCommand) return null;
        const send = (type, key, val) => sim.sendVentCommand(m.id, type, key, val);
        const on = m.state !== 'off';
        const ready = m.state === 'standby' || m.state === 'ambient';
        const sv = parseRows(m.sv), lv = parseRows(m.lv);
        const btn = 'px-2 py-0.5 rounded bg-slate-700 text-white text-[10px] font-bold disabled:opacity-30';
        return (
            <details className="border-t border-slate-700 pt-1" data-testid="vent-remote">
                <summary className="cursor-pointer text-cyan-300 font-bold">Control this ventilator</summary>
                <div className="flex flex-col gap-1.5 mt-1">
                    <div className="flex flex-wrap gap-1">
                        <button type="button" className={btn} onClick={() => send('power', null, on ? 0 : 1)}>{on ? 'Switch off' : 'Switch on'}</button>
                        {m.state === 'ventilating'
                            ? <button type="button" className={btn} onClick={() => send('standby')}>Standby</button>
                            : <button type="button" className={btn} disabled={!ready} onClick={() => send('start')}>Start ventilation</button>}
                        <button type="button" className={btn} disabled={!on} onClick={() => send('silence')}>Silence alarms</button>
                        <button type="button" className={btn} disabled={!on} onClick={() => send('o2')}>O2 enrichment</button>
                        <button type="button" className={btn} disabled={!on} onClick={() => send('lock', null, m.locked ? 0 : 1)}>{m.locked ? 'Unlock screen' : 'Lock screen'}</button>
                        <button type="button" className={btn} onClick={() => send('fresh')}>Fresh ventilator</button>
                    </div>
                    {on && (
                        <label className="flex items-center justify-between gap-2">
                            <span>Mode</span>
                            <select aria-label="Ventilator mode" value={m.mode === 'CPR' ? '' : m.mode} onChange={e => { if (e.target.value) send('mode', e.target.value); }}
                                    className="min-w-0 bg-slate-900 border border-slate-600 rounded px-1 py-0.5 text-[11px] text-white">
                                {m.mode === 'CPR' && <option value="">CPR</option>}
                                {VP.MODES.map(([k, name]) => <option key={k} value={k}>{name}</option>)}
                            </select>
                        </label>
                    )}
                    {on && sv.map(r => <ValueRow key={r[0]} row={r} kind="set" send={send} />)}
                    {on && lv.length > 0 && (
                        <details>
                            <summary className="cursor-pointer text-slate-400">Alarm limits</summary>
                            <div className="flex flex-col gap-1 mt-1">{lv.map(r => <ValueRow key={r[0]} row={r} kind="lim" send={send} />)}</div>
                        </details>
                    )}
                    <div className="text-[10px] text-slate-500">Changes show on the ventilator as a colleague's would, and are logged as yours. Set it up before the candidate arrives to hand over deliberate errors.</div>
                </div>
            </details>
        );
    };

    window.VentControls = { VentPatientPanel, VentRemotePanel };
})();
