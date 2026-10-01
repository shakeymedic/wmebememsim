(() => {
    // =============================================================================================
    // DEFIB SIM CONTROLLER. The facilitator's screen for a Defib Sim scenario (scenario.defibSim).
    // The learner works the ZOLL-style defibrillator on a tablet (defib/index.html); everything
    // they press arrives here through the same session as the rest of the simulator, and every
    // control on this screen goes through the same engine (useSimulation) as the main controller,
    // so shocks, pacing, drugs and rhythm changes behave identically in both.
    // =============================================================================================
    const { useState, useEffect } = React;

    const fmt = (s) => {
        const n = Math.max(0, Math.floor(Number(s) || 0));
        return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
    };
    const TRIGGER_LABELS = { analyse: 'On analyse', shock: 'On shock', capture: 'On pacing capture', timer_30: 'After 30 s', timer_60: 'After 60 s', timer_120: 'After 2 min' };
    // The rhythms a defib scenario usually needs, first; the rest of the registry after them.
    const COMMON = ['VF', 'Fine VF', 'pVT', 'VT', 'PEA', 'Asystole', 'Sinus Rhythm', 'Sinus Tachycardia', 'Sinus Bradycardia', 'SVT', 'AF', 'Atrial Flutter',
        'Complete Heart Block', '2nd Deg Heart Block', 'Junctional', 'Idioventricular'];

    // RCUK ALS drug timing (the same rules as the standalone Defib-sim): adrenaline as soon as
    // possible in a non-shockable rhythm, after the 3rd shock in a shockable one, then every 3-5
    // minutes; amiodarone after the 3rd shock and a further dose after the 5th. Sim seconds.
    function drugPrompts(state, adult, weight) {
        const a = state.arrest || {};
        if (a.since === null || a.since === undefined) return [];
        const RG = window.RHYTHMS;
        const shockable = RG.isShockable(state.rhythm);
        const adr = a.adrenaline || [], amio = a.amiodarone || [];
        const mg = (perKg, cap, unit) => (weight ? ` = ${Math.min(cap, Math.round(perKg * weight))} ${unit}` : '');
        const adrDose = adult ? 'Adrenaline 1 mg IV' : `Adrenaline 10 micrograms/kg IV/IO${mg(10, 1000, 'mcg')} (max 1 mg)`;
        const out = [];
        if (!adr.length) {
            if (!shockable) out.push(`${adrDose} due now (non-shockable rhythm)`);
            else if (a.shocks >= 3) out.push(`${adrDose} due (after the 3rd shock)`);
        } else if ((Number(state.time) || 0) - adr[adr.length - 1] >= 180) {
            out.push(`${adrDose} due (3-5 min since the last dose)`);
        }
        if (shockable) {
            if (a.shocks >= 3 && amio.length === 0) out.push(adult ? 'Amiodarone 300 mg IV due (after the 3rd shock)' : `Amiodarone 5 mg/kg IV/IO${mg(5, 300, 'mg')} due (after the 3rd shock, max 300 mg)`);
            if (a.shocks >= 5 && amio.length === 1) out.push(adult ? 'Amiodarone 150 mg IV due (after the 5th shock)' : `Amiodarone 5 mg/kg IV/IO${mg(5, 150, 'mg')} due (after the 5th shock, max 150 mg)`);
            if (a.shocks >= 3 && adult) out.push('Refractory VF/pVT: consider changing the pad position (antero-posterior)');
            if (a.shocks >= 4 && !adult) out.push(`Refractory VF/pVT: from the 5th shock, escalate stepwise towards 8 J/kg${weight ? ` (${Math.min(360, Math.round(8 * weight))} J; this device's maximum is 200 J)` : ''}`);
        }
        return out;
    }

    const DefibSimScreen = ({ sim, onFinish, onBack, sessionID }) => {
        const { Button, Lucide, Modal, ECGMonitor, INTERVENTIONS } = window;
        const RG = window.RHYTHMS;
        const { state, start, pause, applyIntervention, addLogEntry, triggerArrest, triggerROSC, nextCycle, changeRhythm } = sim;
        const scenario = state.scenario || {};
        const ds = scenario.defibSim || {};
        const vitals = state.vitals || {};
        const defib = state.defib || {};
        const arrest = state.arrest || { since: null, shocks: 0, adrenaline: [], amiodarone: [] };
        const steps = Array.isArray(ds.steps) ? ds.steps : [];
        const step = state.defibStep;
        const weight = Number(scenario.wetflag && scenario.wetflag.weight) || null;
        // Energies follow the device's adult threshold (40 kg or 16 years); drug doses follow the
        // RCUK paediatric chart for anyone under 18.
        const adult = RG.isAdult(weight, scenario.patientAge);
        const adultDrugs = adult && !(Number(scenario.patientAge) < 18);
        const education = ds.mode !== 'assessment';
        const [showJoin, setShowJoin] = useState(false);
        const [showAllRhythms, setShowAllRhythms] = useState(false);
        const [note, setNote] = useState('');

        // Space starts/pauses, as on the main controller (never while typing).
        useEffect(() => {
            const onKey = (e) => {
                if (e.target && e.target.closest && e.target.closest('input, select, textarea, button')) return;
                if (e.key === ' ') { e.preventDefault(); if (sim.state.isRunning) pause(); else start(); }
            };
            window.addEventListener('keydown', onKey);
            return () => window.removeEventListener('keydown', onKey);
        });

        const confirmFinish = () => { if (window.confirm('End the Defib Sim and go to the debrief?')) onFinish(); };

        // One rhythm change with the right obs: into arrest, out of arrest, or organised to organised.
        const setRhythm = (r) => {
            const to = RG.canonical(r);
            if (to === RG.canonical(state.rhythm)) return;
            if (RG.isPulseless(to) && !RG.isPulseless(state.rhythm)) triggerArrest(to, 'facilitator');
            else if (!RG.isPulseless(to) && RG.isPulseless(state.rhythm)) triggerROSC(to, 'facilitator');
            else changeRhythm(to, 'facilitator');
        };

        // ---- Devices in the session
        const clients = (state.remotePresence && state.remotePresence.clients) || [];
        const defibClients = clients.filter(c => c.display === 'defib' || c.role === 'defib');
        const mirrors = Object.values(state.deviceMirror || {});
        const mirror = mirrors.length ? mirrors.sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0))[0] : null;
        const pacer = state.remotePacerState || {};
        const syncStatus = state.syncStatus || { state: 'connecting' };
        const syncProblem = ['unavailable', 'disconnected', 'error', 'degraded'].includes(syncStatus.state);
        const defibUrl = new URL(`defib/index.html?session=${sessionID}`, window.location.href).toString();

        // ---- Drugs
        const counts = state.interventionCounts || {};
        const active = state.activeInterventions || new Set();
        const lastGiven = (list) => list.length ? `${fmt((Number(state.time) || 0) - list[list.length - 1])} ago` : null;
        const drug = (key, label, extra) => {
            const def = INTERVENTIONS && INTERVENTIONS[key];
            if (!def) return null;
            const running = def.type === 'continuous' && active.has(key);
            const n = counts[key] || 0;
            return (
                <button key={key} type="button" data-drug={key} onClick={() => { applyIntervention(key); if (extra) extra(); }}
                        title={def.type === 'continuous' ? (running ? 'Running: press again to stop' : 'Start the infusion') : def.label}
                        className={`text-left px-2 py-1.5 rounded border text-xs font-bold ${running ? 'bg-emerald-900/50 border-emerald-500 text-emerald-200' : 'bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700'}`}>
                    <div>{label || def.label}{running ? ' — RUNNING' : ''}</div>
                    {def.type !== 'continuous' && n > 0 && <div className="text-[10px] font-normal text-slate-400">{n} given</div>}
                </button>
            );
        };
        const prompts = drugPrompts(state, adultDrugs, weight);

        // ---- Log (newest first)
        const log = (state.log || []).slice(-80).map((entry, i, arr) => ({ entry, index: (state.log.length - arr.length) + i })).reverse();
        const logClass = (t) => t === 'danger' ? 'text-red-300 font-bold' : t === 'warning' ? 'text-amber-300' : t === 'success' ? 'text-emerald-300 font-bold' : t === 'system' ? 'text-slate-400' : 'text-slate-300';

        const card = 'bg-slate-800 border border-slate-700 rounded p-3';
        const h = 'text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-2 flex items-center gap-1';
        const chip = (on, onCls) => `px-2 py-1.5 rounded border text-xs font-bold ${on ? onCls : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'}`;
        const pulseless = RG.isPulseless(state.rhythm);
        const noise = state.noise || {};
        const { Section } = window;

        // One-line summaries for the sections that start closed.
        const dset = state.defibSettings || {};
        const sr = dset.shockResponse || 'model';
        const shockSummary = [
            steps.length > 0 && step && !step.done ? 'custom sequence decides' : (sr === 'model' ? 'Realistic model' : sr === 'auto' ? 'Auto' : sr === 'never' ? 'Never converts' : `Converts on shock ${sr}`),
            dset.cvEnergy && dset.cvEnergy !== 'default' ? `cardioversion at ${dset.cvEnergy} J` : null,
            state.queuedRhythm ? `next shock \u2192 ${RG.shortFor(state.queuedRhythm)}` : null
        ].filter(Boolean).join(' \u00b7 ');
        const artefactsOn = [['movement', 'movement'], ['interference', 'mains'], ['leadoff', 'lead off']].filter(([k]) => noise[k]).map(([, l]) => l);
        const pacingSummary = `Threshold ${state.pacingThreshold} mA \u00b7 ${artefactsOn.length ? artefactsOn.join(', ') : 'no artefacts'}`;
        const drugsSummary = `Adrenaline ${arrest.adrenaline.length} \u00b7 Amiodarone ${arrest.amiodarone.length}`;

        return (
            <div className="flex flex-col gap-2 p-2 max-w-[1600px] mx-auto w-full" data-testid="defib-controller">
                {/* ---------------- Header ---------------- */}
                <div className="flex flex-wrap justify-between items-center gap-2 bg-slate-800 p-2 rounded border border-slate-700">
                    <div className="flex flex-wrap gap-2 items-center">
                        <Button variant="secondary" onClick={onBack} className="h-8 px-2"><Lucide icon="arrow-left"/> Back</Button>
                        <Button variant="danger" onClick={confirmFinish} className="h-8 px-2 font-bold"><Lucide icon="square"/> Finish</Button>
                        {!state.isRunning
                            ? <Button variant="success" onClick={start} className="h-8 px-4 font-bold"><Lucide icon="play"/> START</Button>
                            : <Button variant="warning" onClick={pause} className="h-8 px-4"><Lucide icon="pause"/> PAUSE</Button>}
                        <div className="min-w-0">
                            <div className="text-[10px] uppercase tracking-widest font-bold text-amber-400 flex items-center gap-1"><Lucide icon="zap" className="w-3 h-3"/> Defib Sim</div>
                            <div className="text-sm font-bold text-white truncate max-w-[22rem]">{ds.name || scenario.title}</div>
                        </div>
                        <span className={`text-[10px] px-2 py-0.5 rounded border font-bold uppercase ${education ? 'border-sky-600 text-sky-300 bg-sky-950/40' : 'border-violet-600 text-violet-300 bg-violet-950/40'}`}>{education ? 'Education' : 'Assessment'}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <div role={syncProblem ? 'alert' : 'status'} title={syncStatus.message || ''} className={`h-8 px-2 flex items-center gap-1 rounded border text-[10px] uppercase font-bold ${syncProblem ? 'border-red-500 bg-red-950/60 text-red-300' : syncStatus.state === 'connected' ? 'border-emerald-700 bg-emerald-950/40 text-emerald-300' : 'border-amber-600 bg-amber-950/40 text-amber-300'}`}>
                            <Lucide icon={syncProblem ? 'wifi-off' : 'wifi'} className="w-3 h-3" /> {syncProblem ? 'Sync error' : syncStatus.state === 'connected' ? 'Session live' : 'Syncing'}
                        </div>
                        <div role="status" data-testid="defib-presence" className={`h-8 px-2 flex items-center gap-1 rounded border text-[10px] uppercase font-bold ${defibClients.length ? 'border-amber-500 bg-amber-950/40 text-amber-300' : 'border-slate-600 bg-slate-900 text-slate-400'}`}
                             title={defibClients.length ? 'A defib tablet is linked to this session.' : 'No defib tablet is linked over the network yet (a defib in another tab of this browser links without appearing here).'}>
                            <Lucide icon="zap" className="w-3 h-3" /> {defibClients.length ? (defibClients.length === 1 ? 'Defib linked' : `${defibClients.length} defibs`) : 'No defib tablet'}
                        </div>
                        <Button ariaLabel="Show the QR code to open the defib" variant="outline" onClick={() => setShowJoin(true)} className="h-8 px-2 text-sky-300 border-sky-500/50"><Lucide icon="qr-code" className="w-4 h-4 mr-1"/> Join</Button>
                        <Button variant="outline" href={`defib/index.html?session=${sessionID}`} target="_blank" className="h-8 px-2 text-amber-400 border-amber-500/50"><Lucide icon="external-link" className="w-4 h-4 mr-1"/> Open defib</Button>
                        <div className="font-mono text-2xl font-bold text-white ml-1">{fmt(state.time)}</div>
                    </div>
                </div>

                {!state.isRunning && !state.isFinished && (
                    <div role="status" data-testid="defib-clock-stopped" className="flex items-center gap-2 px-3 py-2 rounded border border-amber-600 bg-amber-950/40 text-amber-200 text-xs">
                        <Lucide icon="clock" className="w-4 h-4 flex-none"/>
                        {(state.pausedAt === null || state.pausedAt === undefined)
                            ? <span><b>The clock has not started.</b> Log times stay at {fmt(state.time)} until it does. Press START, or it starts by itself at the learner's first action on the defib.</span>
                            : <span><b>Paused.</b> Presses are still logged, all at {fmt(state.time)}, until you press START.</span>}
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
                    {/* ================= Column 1: patient, monitor, device ================= */}
                    <div className="flex flex-col gap-2 min-w-0">
                        <div className={card}>
                            <div className={h}><Lucide icon="user" className="w-3 h-3"/> Patient</div>
                            <div className="text-sm text-white font-bold">{scenario.patientName} ({scenario.patientAge}y {scenario.sex}{weight ? `, ${weight} kg` : ''})</div>
                            {ds.description && <p className="text-xs text-slate-300 mt-1">{ds.description}</p>}
                            <div className="flex flex-wrap gap-1 mt-2 text-[10px]">
                                {ds.requiresSync && <span className="px-1.5 py-0.5 rounded border border-amber-600 text-amber-300">Needs SYNC</span>}
                                {ds.requiresPacing && <span className="px-1.5 py-0.5 rounded border border-fuchsia-600 text-fuchsia-300">Needs pacing</span>}
                                {ds.energyAdvice && <span className="px-1.5 py-0.5 rounded border border-slate-600 text-slate-300">RCUK: {ds.energyAdvice}</span>}
                                {ds.requiresPacing && <span className="px-1.5 py-0.5 rounded border border-slate-600 text-slate-300">Capture threshold {state.pacingThreshold} mA</span>}
                            </div>
                        </div>

                        <div className="bg-black rounded border border-slate-700 overflow-hidden">
                            <div className="flex justify-between items-center px-2 pt-1">
                                <span className={`text-xs font-bold ${pulseless ? 'text-red-300' : 'text-emerald-300'}`} data-testid="defib-rhythm">{RG.labelFor(state.rhythm)}</span>
                                <span className="text-[10px] text-slate-400">what the pads show</span>
                            </div>
                            <div className="h-40">
                                <ECGMonitor rhythmType={state.rhythm} hr={vitals.hr} rr={vitals.rr} spO2={vitals.spO2} etco2={vitals.etco2}
                                            isPaused={false} showTraces={true} showEcg={true} showPleth={!pulseless} showResp={false}
                                            showEtco2={false} showArt={false} isCPR={state.cprInProgress} showSyncMarkers={!!defib.syncMode} className="h-full"/>
                            </div>
                            <div className="grid grid-cols-4 gap-1 p-2 text-center font-mono">
                                {[['HR', vitals.hr, 'text-emerald-400'], ['BP', `${Math.round(vitals.bpSys || 0)}/${Math.round(vitals.bpDia || 0)}`, 'text-red-300'], ['SpO₂', vitals.spO2, 'text-sky-300'], ['ETCO₂', Number(vitals.etco2 || 0).toFixed(1), 'text-yellow-300']].map(([l, v, c]) => (
                                    <div key={l}><div className="text-[9px] text-slate-400">{l}</div><div className={`text-lg font-bold ${c}`}>{typeof v === 'number' ? Math.round(v) : v}</div></div>
                                ))}
                            </div>
                        </div>

                        <div className={card} data-testid="device-mirror">
                            <div className={h}><Lucide icon="monitor" className="w-3 h-3"/> The learner's defib</div>
                            {mirror ? (
                                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                                    <span className="text-slate-400">Mode</span><span className="text-white font-bold uppercase">{mirror.mode}</span>
                                    <span className="text-slate-400">Energy</span><span className="text-white font-bold">{mirror.energy} J {mirror.sync ? <span className="text-amber-300">SYNC</span> : null}</span>
                                    <span className="text-slate-400">State</span><span className="text-white">{mirror.machine}</span>
                                    <span className="text-slate-400">Lead / size</span><span className="text-white">{mirror.lead} x{mirror.gain}</span>
                                    <span className="text-slate-400">Pacer</span><span className="text-white">{mirror.pacerOutput} mA, {mirror.pacerRate}/min, {mirror.pacerDemand ? 'demand' : 'async'}</span>
                                    <span className="text-slate-400">Screen</span><span className={`font-mono ${mirror.messageType === 'alert' ? 'text-amber-300' : 'text-emerald-300'}`}>{mirror.message || '—'}</span>
                                </div>
                            ) : (
                                <div className="text-xs text-slate-400 space-y-1">
                                    <div>From the learner's presses: mode <b className="text-white uppercase">{defib.mode || 'off'}</b>, energy <b className="text-white">{defib.energy || '—'} J</b>{defib.syncMode ? <b className="text-amber-300"> SYNC</b> : null}, pacer <b className="text-white">{Number(pacer.output) || 0} mA / {Number(pacer.rate) || 0} per min</b>.</div>
                                    <div className="text-slate-400">The full screen mirror appears when a tablet links with the session code.</div>
                                </div>
                            )}
                            <div className="flex flex-wrap gap-2 mt-2 text-[10px]">
                                <span className="px-1.5 py-0.5 rounded border border-slate-600 text-slate-300">Shocks: <b className="text-white">{defib.shockCount || 0}</b></span>
                                <span className="px-1.5 py-0.5 rounded border border-slate-600 text-slate-300">Last: <b className="text-white">{defib.lastEnergy ? `${defib.lastEnergy} J` : '—'}</b></span>
                                {state.pacing && state.pacing.electrical && <span className="px-1.5 py-0.5 rounded border border-fuchsia-500 text-fuchsia-300 font-bold">{state.pacing.mechanical ? 'Mechanical capture' : 'Electrical capture only'}</span>}
                                {defib.lastAnalysis && <span className="px-1.5 py-0.5 rounded border border-slate-600 text-slate-300">Analysis: <b className="text-white">{defib.lastAnalysis.result}</b></span>}
                            </div>
                        </div>
                    </div>

                    {/* ================= Column 2: rhythm, sequence, settings ================= */}
                    <div className="flex flex-col gap-2 min-w-0">
                        {steps.length > 0 && (
                            <div className={card} data-testid="defib-steps-runner">
                                <div className={h}><Lucide icon="list" className="w-3 h-3"/> Custom sequence {step && step.done ? '— complete' : ''}</div>
                                <ol className="space-y-1">
                                    {steps.map((s, i) => {
                                        const current = step && !step.done && step.index === i;
                                        const past = step && (step.done || step.index > i);
                                        return (
                                            <li key={i} className={`flex items-center justify-between gap-2 px-2 py-1 rounded border text-xs ${current ? 'border-sky-500 bg-sky-950/40 text-white' : past ? 'border-slate-700 text-slate-400' : 'border-slate-700 text-slate-300'}`}>
                                                <span>{i + 1}. {RG.labelFor(s.rhythm)}</span>
                                                <span className="text-[10px]">{TRIGGER_LABELS[s.trigger] || s.trigger}{current && /^timer_/.test(s.trigger) ? ` (${fmt((Number(state.time) || 0) - (Number(step.since) || 0))})` : ''}</span>
                                            </li>
                                        );
                                    })}
                                </ol>
                                <div className="flex gap-2 mt-2">
                                    <Button variant="outline" onClick={() => sim.goToDefibStep(step ? step.index + 1 : 1, 'facilitator')} disabled={!!(step && step.done)} className="h-8 text-xs flex-1">Next step</Button>
                                    <Button variant="outline" onClick={() => sim.goToDefibStep(0, 'facilitator restarted the sequence')} className="h-8 text-xs flex-1">Restart sequence</Button>
                                </div>
                            </div>
                        )}

                        <div className={card}>
                            <div className={h}><Lucide icon="activity" className="w-3 h-3"/> Rhythm</div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                                {(showAllRhythms ? RG.SELECTABLE : COMMON).map(r => (
                                    <button key={r} type="button" data-rhythm={r} onClick={() => setRhythm(r)}
                                            className={chip(RG.canonical(state.rhythm) === r, RG.isPulseless(r) ? 'bg-red-800 border-red-400 text-white' : 'bg-emerald-800 border-emerald-400 text-white')}>{RG.labelFor(r)}</button>
                                ))}
                            </div>
                            <button type="button" onClick={() => setShowAllRhythms(!showAllRhythms)} className="mt-2 text-[10px] text-sky-400 hover:text-sky-200 underline">{showAllRhythms ? 'Fewer rhythms' : 'All rhythms'}</button>
                        </div>

                        <Section id="defibShock" tone="card" title="Shock response" summary={shockSummary} defaultOpen={false}>
                            {steps.length > 0 && step && !step.done
                                ? <p className="text-[11px] text-sky-300 mb-2">The custom sequence decides what a shock does until it completes.</p>
                                : null}
                            <div className="space-y-1">
                                {[
                                    ['shockResponse', 'Converts', [['auto', 'Auto (scenario default)'], ['model', 'Realistic model (energy, CPR, drugs)'], ['1', '1st adequate shock'], ['2', '2nd adequate shock'], ['3', '3rd adequate shock'], ['4', '4th adequate shock'], ['5', '5th adequate shock'], ['never', 'Never (refractory)']]],
                                    ['rOnT', 'Unsync shock with a pulse', [['always', 'Always causes VF'], ['sometimes', 'Sometimes causes VF (1 in 3)'], ['never', 'No effect (flagged)']]],
                                    ['refib', 'After ROSC', [['off', 'Stays in ROSC'], ['once', 'VF recurs once (30-90 s)'], ['model', 'Realistic model']]],
                                    ['cvEnergy', 'Cardioversion succeeds at', [['default', 'Default (70 J adult, 1 J/kg child)']].concat(RG.ADULT_ENERGY_STEPS.map(j => [String(j), `${j} J or more`]))]
                                ].map(([k, label, opts]) => (
                                    <label key={k} className="flex items-center justify-between gap-2 text-[11px] text-slate-300">
                                        <span className="whitespace-nowrap">{label}</span>
                                        <select value={(state.defibSettings || {})[k] || (k === 'cvEnergy' ? 'default' : '')} onChange={e => sim.setDefibSettings({ [k]: e.target.value })} aria-label={label}
                                                className="min-w-0 max-w-[15rem] bg-slate-900 border border-slate-600 rounded px-1 py-0.5 text-[11px] text-white">
                                            {opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                                        </select>
                                    </label>
                                ))}
                            </div>
                            <div className="mt-2 text-[11px] text-slate-400">
                                Next shock converts to:{' '}
                                {['Sinus Rhythm', 'VF', 'PEA', 'Asystole'].map(r => (
                                    <button key={r} type="button" onClick={() => sim.setQueuedRhythm(r)} className={`ml-1 px-1.5 py-0.5 rounded border text-[10px] font-bold ${state.queuedRhythm === r ? 'bg-sky-700 border-sky-400 text-white' : 'bg-slate-900 border-slate-600 text-slate-300'}`}>{RG.shortFor(r)}</button>
                                ))}
                                {state.queuedRhythm && <button type="button" onClick={() => sim.setQueuedRhythm(null)} className="ml-2 text-sky-400 underline">clear</button>}
                            </div>
                        </Section>

                        <Section id="defibPacing" tone="card" title="Pacing & artefacts" summary={pacingSummary} defaultOpen={false}>
                            <div className="flex items-center justify-between text-xs text-slate-300">
                                <span>Capture threshold</span>
                                <span className="flex items-center gap-1">
                                    <button type="button" aria-label="Lower the capture threshold" onClick={() => sim.dispatch({ type: 'SET_PACING_THRESHOLD', payload: (Number(state.pacingThreshold) || 70) - 5 })} className="w-6 h-6 rounded bg-slate-700 border border-slate-600">-</button>
                                    <b className="text-white w-14 text-center" data-testid="pacing-threshold">{state.pacingThreshold} mA</b>
                                    <button type="button" aria-label="Raise the capture threshold" onClick={() => sim.dispatch({ type: 'SET_PACING_THRESHOLD', payload: (Number(state.pacingThreshold) || 70) + 5 })} className="w-6 h-6 rounded bg-slate-700 border border-slate-600">+</button>
                                </span>
                            </div>
                            <div className="text-[10px] text-slate-400 mb-2">Mechanical capture (a pulse) needs about 10 mA more.</div>
                            <div className="flex flex-wrap gap-1">
                                {[['movement', 'Patient movement'], ['interference', 'Mains interference'], ['leadoff', 'Lead off']].map(([k, label]) => (
                                    <button key={k} type="button" data-artefact={k} aria-pressed={!!noise[k]} onClick={() => sim.setNoise({ [k]: !noise[k] })} className={chip(!!noise[k], 'bg-amber-800 border-amber-400 text-white')}>{label}</button>
                                ))}
                            </div>
                        </Section>
                    </div>

                    {/* ================= Column 3: arrest, drugs, log ================= */}
                    <div className="flex flex-col gap-2 min-w-0">
                        <div className={`${card} ${arrest.since !== null && arrest.since !== undefined ? 'border-red-600' : ''}`}>
                            <div className={h}><Lucide icon="heart-pulse" className="w-3 h-3"/> Arrest</div>
                            <div className="flex items-center justify-between text-xs mb-2">
                                <span className={arrest.since !== null && arrest.since !== undefined ? 'text-red-300 font-bold' : 'text-slate-400'} data-testid="arrest-status">
                                    {arrest.since !== null && arrest.since !== undefined ? `In arrest ${fmt((Number(state.time) || 0) - arrest.since)} — ${arrest.shocks} shock${arrest.shocks === 1 ? '' : 's'}` : 'Not in arrest'}
                                </span>
                                <span className="font-mono text-lg text-white" title="Time since the cycle timer was reset">{fmt(state.cycleTimer)}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-1">
                                <button type="button" onClick={() => sim.toggleCPR()} aria-pressed={!!state.cprInProgress} className={chip(!!state.cprInProgress, 'bg-red-800 border-red-400 text-white')}>{state.cprInProgress ? 'CPR running' : 'Start CPR'}</button>
                                <button type="button" onClick={() => sim.setMetronome(!state.metronomeOn)} aria-pressed={!!state.metronomeOn} className={chip(!!state.metronomeOn, 'bg-sky-800 border-sky-400 text-white')}>Metronome {state.metronomeOn ? 'ON' : 'off'}</button>
                                <button type="button" onClick={nextCycle} className={chip(false)} title="Fast-forward 2 minutes to the next rhythm check">Rhythm check (+2:00)</button>
                                <button type="button" onClick={() => triggerROSC('Sinus Rhythm', 'facilitator')} className={chip(false)}>ROSC</button>
                            </div>
                        </div>

                        {/* RCUK prompts are time-critical, so they stay on screen while Drugs is closed. */}
                        {prompts.length > 0 && (
                            <div className="p-2 rounded border border-amber-600 bg-amber-950/40 text-[11px] text-amber-200 space-y-0.5" data-testid="drug-prompts">
                                <div className="font-bold uppercase text-[9px] tracking-widest text-amber-400">RCUK prompts (facilitator only)</div>
                                {prompts.map(p => <div key={p}>• {p}</div>)}
                            </div>
                        )}
                        <Section id="defibDrugs" tone="card" title="Drugs" summary={drugsSummary} defaultOpen={false}>
                            <div className="text-[10px] text-slate-400 mb-1">
                                Adrenaline {arrest.adrenaline.length ? `${arrest.adrenaline.length} this arrest, last ${lastGiven(arrest.adrenaline)}` : 'not given this arrest'} · Amiodarone {arrest.amiodarone.length ? `${arrest.amiodarone.length} dose${arrest.amiodarone.length > 1 ? 's' : ''}, last ${lastGiven(arrest.amiodarone)}` : 'not given'}
                            </div>
                            <div className="grid grid-cols-2 gap-1">
                                {drug('AdrenalineIV', adultDrugs ? 'Adrenaline 1 mg IV' : 'Adrenaline 10 mcg/kg IV')}
                                {drug('Amiodarone', adultDrugs ? `Amiodarone ${arrest.amiodarone.length ? '150' : '300'} mg IV` : 'Amiodarone 5 mg/kg IV',
                                    () => { if (adultDrugs && arrest.amiodarone.length) addLogEntry('Amiodarone: this is the second dose (150 mg).', 'info'); })}
                                {drug('Atropine')}
                                {drug('Adenosine')}
                                {drug('Isoprenaline')}
                                {drug('AdrenalineInfusion')}
                                {drug('Fentanyl', 'Fentanyl (analgesia)')}
                                {drug('Midazolam', 'Midazolam (sedation)')}
                            </div>
                        </Section>

                        <div className={`${card} flex flex-col min-h-[14rem] max-h-[26rem]`}>
                            <div className={h}><Lucide icon="list" className="w-3 h-3"/> Event log</div>
                            <form className="flex gap-1 mb-2" onSubmit={e => { e.preventDefault(); if (note.trim()) { addLogEntry(note.trim(), 'manual', true); setNote(''); } }}>
                                <input value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note to the log" aria-label="Log note" className="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded px-2 text-xs text-white h-7" />
                                <Button type="submit" variant="outline" className="h-7 px-2 text-xs">Add</Button>
                            </form>
                            <div className="flex-1 overflow-y-auto font-mono text-[11px] space-y-1" data-testid="defib-log">
                                {log.map(({ entry, index }) => (
                                    <div key={index} className={`flex gap-2 ${entry.flagged ? 'bg-amber-900/20' : ''}`}>
                                        <button type="button" aria-label={`${entry.flagged ? 'Unflag' : 'Flag'} log entry at ${entry.simTime}`} onClick={() => sim.dispatch({ type: 'TOGGLE_FLAG', payload: index })} className={entry.flagged ? 'text-amber-500' : 'text-slate-400 hover:text-amber-500'}><Lucide icon="flag" className="w-3 h-3"/></button>
                                        <span className="text-slate-400 flex-none" title={entry.time ? `Clock time ${entry.time}` : undefined}>{entry.simTime}</span>
                                        <span className={logClass(entry.type)}>{entry.msg}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {showJoin && (() => {
                    let svg = null;
                    try { const q = window.qrcode(0, 'M'); q.addData(defibUrl); q.make(); svg = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }).replace('<svg ', '<svg style="width:100%;height:100%;display:block" '); } catch (e) { svg = null; }
                    return (
                        <Modal label="Open the defib" onClose={() => setShowJoin(false)}>
                            <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-md shadow-2xl">
                                <div className="flex justify-between items-center mb-2">
                                    <h3 className="text-lg font-bold text-white uppercase tracking-wider">Open the defib</h3>
                                    <button aria-label="Close" onClick={() => setShowJoin(false)} className="text-slate-400 hover:text-white"><Lucide icon="x" className="w-5 h-5"/></button>
                                </div>
                                <p className="text-xs text-slate-400 mb-3">Point the tablet's camera at the code, or open <span className="font-mono">defib/</span> and type the session code <b className="font-mono text-white text-base tracking-widest">{sessionID}</b>.</p>
                                {svg ? <div className="bg-white p-2 rounded w-56 h-56 mx-auto" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="text-xs text-slate-400 text-center">QR code unavailable — use the link below.</div>}
                                <div className="text-[10px] text-slate-400 font-mono break-all text-center select-all mt-2">{defibUrl}</div>
                                <Button onClick={() => setShowJoin(false)} variant="outline" className="w-full mt-4">Close</Button>
                            </div>
                        </Modal>
                    );
                })()}
            </div>
        );
    };

    window.DefibSimScreen = DefibSimScreen;
})();
