// MONITOR TRACE VARIATIONS: the facilitator's choices for how the traces LOOK, shown inside the
// controller's Heart rate, SpO2 and Blood pressure windows (tap the tile).
//
//   - ECG: patient movement, mains interference, shivering / tremor, lead off
//   - Pleth: normal, poor peripheral perfusion, motion artefact, respiratory swing
//   - Arterial line: normal, overdamped, underdamped, respiratory swing, and a fast-flush test
//
// They live in state.noise (sim.setNoise), which already reaches every patient screen and the
// defib tablet, and is free-form in the database rules: no rules change. The drawing is in
// ECGMonitor (data/components.js) and the shapes in data/rhythms.js. The patient's true obs never
// change; only a damped arterial line shows wrong numbers, as a real one does.
(() => {
    const chip = (on) => `p-2 rounded border text-xs font-bold leading-tight ${on ? 'bg-sky-600 border-sky-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}`;
    const label = 'text-xs text-slate-400 font-bold uppercase mb-2 block';
    const hint = 'text-[10px] text-slate-400 mt-2 leading-relaxed';

    const ECG = [
        ['movement', 'Movement', 'Patient movement: large irregular baseline swings.'],
        ['interference', 'Mains', 'Mains (50 Hz) interference: a thick, fuzzy line.'],
        ['tremor', 'Shivering / tremor', 'Shivering or tremor: fast irregular oscillation that can look like flutter waves or VF.'],
        ['leadoff', 'Lead off', 'A lead off: a flat line on the monitor ECG with CHECK LEADS. Defib pads are not affected.']
    ];
    const PLETH = [
        ['normal', 'Normal', 'A normal pulse wave with a dicrotic notch.'],
        ['poor', 'Poor perfusion', 'Poor peripheral perfusion (cold, shut down, vasoconstricted): a small, rounded, noisy wave. The SpO2 number is unchanged; set it separately if you want it unreliable.'],
        ['motion', 'Motion artefact', 'A moving or shivering hand: large irregular swings swamp the pulse.'],
        ['swing', 'Resp. swing', 'Respiratory swing: the pulse height rises and falls with each breath (e.g. hypovolaemia on a ventilator).']
    ];
    const ART = [
        ['normal', 'Normal', 'An optimally damped arterial trace.'],
        ['overdamped', 'Overdamped', 'Overdamped (air bubble, clot, kinked line, soft bag): blunted, slurred wave, no dicrotic notch. Reads about 16 mmHg low systolic and 8 high diastolic; MAP unchanged.'],
        ['underdamped', 'Underdamped', 'Underdamped (long or stiff tubing, resonance): tall narrow spike with ringing. Reads about 20 mmHg high systolic and 10 low diastolic; MAP unchanged.'],
        ['swing', 'Resp. swing', 'Respiratory swing: systolic pressure varies with each breath (pulse pressure variation, e.g. hypovolaemia).']
    ];

    const TraceVariations = ({ kind, sim, noise, hasArt, hasSpo2, hasEcg }) => {
        const n = noise || {};
        const set = (patch) => sim.setNoise(patch);
        if (kind === 'hr') {
            return (
                <div data-testid="trace-ecg">
                    <label className={label}>ECG artefact</label>
                    <div className="grid grid-cols-2 gap-2">
                        {ECG.map(([k, txt, title]) => (
                            <button key={k} type="button" data-trace={`ecg-${k}`} aria-pressed={!!n[k]} title={title} onClick={() => set({ [k]: !n[k] })} className={chip(!!n[k])}>{txt}</button>
                        ))}
                    </div>
                    <div className={hint}>Shown on the monitor ECG, your strip and the defib.{hasEcg ? '' : ' ECG leads are not attached yet.'}</div>
                </div>
            );
        }
        if (kind === 'spO2') {
            const cur = n.pleth || 'normal';
            const sel = PLETH.find(p => p[0] === cur) || PLETH[0];
            return (
                <div data-testid="trace-pleth">
                    <label className={label}>Pleth trace</label>
                    <div className="grid grid-cols-2 gap-2">
                        {PLETH.map(([k, txt, title]) => (
                            <button key={k} type="button" data-trace={`pleth-${k}`} aria-pressed={cur === k} title={title} onClick={() => set({ pleth: k })} className={chip(cur === k)}>{txt}</button>
                        ))}
                    </div>
                    <div className={hint}>{sel[2]}{hasSpo2 ? '' : ' The SpO2 probe is not attached yet.'}</div>
                </div>
            );
        }
        if (kind === 'bp') {
            const cur = n.art || 'normal';
            const sel = ART.find(p => p[0] === cur) || ART[0];
            return (
                <div data-testid="trace-art">
                    <label className={label}>Arterial line trace</label>
                    <div className="grid grid-cols-2 gap-2">
                        {ART.map(([k, txt, title]) => (
                            <button key={k} type="button" data-trace={`art-${k}`} aria-pressed={cur === k} title={title} onClick={() => set({ art: k })} className={chip(cur === k)}>{txt}</button>
                        ))}
                    </div>
                    <button type="button" data-trace="art-flush" disabled={!hasArt} onClick={() => set({ artFlush: true })}
                            title="Fast-flush (square wave) test: the trace jumps off the scale, then drops back. Normal: 1 to 2 oscillations. Overdamped: a slow return with none. Underdamped: several."
                            className={`mt-2 w-full p-2 rounded border text-xs font-bold ${hasArt ? 'bg-red-900/50 border-red-600 text-red-100 hover:bg-red-800/60' : 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed'}`}>
                        Flush test
                    </button>
                    <div className={hint}>{sel[2]}{hasArt ? ' Flush test shows how the line is damped.' : ' Attach an arterial line to see this trace.'}</div>
                </div>
            );
        }
        return null;
    };

    window.TraceVariations = TraceVariations;
})();
