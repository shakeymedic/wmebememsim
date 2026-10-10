(() => {
    const { useState } = React;

    // =============================================================================================
    // VENTILATOR SIM: the start-screen tab. Pick a scenario and Education or Assessment. The
    // candidate uses the HAMILTON-T1 on the room monitor tablet (shown there from the start) or on
    // its own tablet (Join -> Ventilator QR code); the facilitator runs it from the controller's
    // Ventilator section. Everything else (engine, session, monitor, debrief) is shared.
    // =============================================================================================
    const VentSimSetup = ({ onStart }) => {
        const { Lucide } = window;
        const VS = window.VentSim;
        const VP = window.VENT_PROFILES;
        const [mode, setMode] = useState('education');
        const [choice, setChoice] = useState(VS.SCENARIOS[0].id);

        const groups = [];
        VS.SCENARIOS.forEach(s => {
            let g = groups.find(x => x.name === s.group);
            if (!g) { g = { name: s.group, items: [] }; groups.push(g); }
            g.items.push(s);
        });
        const sel = VS.byId(choice);
        const label = (id) => { const p = VP.PROBLEMS.find(x => x.id === id); return p ? p.label : id; };
        const optionClass = (on) => `text-left p-3 rounded border transition-colors ${on ? 'bg-sky-900/40 border-sky-400 text-white' : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'}`;

        return (
            <div className="space-y-4 animate-fadeIn" data-testid="vent-setup">
                <div className="bg-cyan-950/30 border border-cyan-700/50 rounded p-3 text-sm text-slate-300">
                    <p className="font-bold text-cyan-300 mb-1 flex items-center gap-2"><Lucide icon="wind" className="w-4 h-4"/> Ventilator Sim: HAMILTON-T1 skills</p>
                    <p className="text-xs text-slate-400">The candidate uses the ventilator on the room monitor tablet (it opens there; they can flip to the obs and back) or on its own tablet (<b>Join</b> → Ventilator QR code). You run it from the controller's <b>Ventilator</b> section: problems, lungs, and full remote control of the device. The ventilator drives SpO2, CO2 and the breathing rate.</p>
                </div>
                <div>
                    <div className="text-[10px] text-slate-400 uppercase font-bold mb-1">Mode</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button type="button" onClick={() => setMode('education')} className={optionClass(mode === 'education')} aria-pressed={mode === 'education'}>
                            <div className="font-bold">Education</div>
                            <div className="text-xs text-slate-400">The ventilator shows its alarm troubleshooting help.</div>
                        </button>
                        <button type="button" onClick={() => setMode('assessment')} className={optionClass(mode === 'assessment')} aria-pressed={mode === 'assessment'}>
                            <div className="font-bold">Assessment</div>
                            <div className="text-xs text-slate-400">No alarm help on the ventilator. Feedback in the debrief.</div>
                        </button>
                    </div>
                </div>
                <div>
                    <div className="text-[10px] text-slate-400 uppercase font-bold mb-1">Scenario</div>
                    <div className="space-y-3">
                        {groups.map(g => (
                            <div key={g.name}>
                                <div className="text-xs font-bold text-slate-400 mb-1">{g.name}</div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                    {g.items.map(s => (
                                        <button key={s.id} type="button" data-vent-scenario={s.id} onClick={() => setChoice(s.id)} className={optionClass(choice === s.id)} aria-pressed={choice === s.id}>
                                            <div className="font-bold text-sm">{s.name}</div>
                                            <div className="text-[11px] text-slate-400 line-clamp-2">{s.description}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                {sel && (
                    <div className="bg-slate-900 border border-slate-700 rounded p-3 text-xs text-slate-300 space-y-1">
                        <div><b className="text-white">Patient:</b> {sel.age}-year-old {sel.sex.toLowerCase()}, {VP.profiles[sel.profile].name.toLowerCase()} lungs, {sel.airway === 'tube' ? 'intubated' : 'not intubated (mask)'}{sel.breathing === false ? ', sedated and paralysed' : ''}.</div>
                        {sel.problems.length > 0 && <div><b className="text-white">Problems to inject:</b> {sel.problems.map(label).join(', ')}.</div>}
                    </div>
                )}
                <button type="button" onClick={() => onStart({ scenario: choice, mode })}
                        className="w-full py-4 text-lg font-bold rounded bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-900/20">Start Ventilator Sim</button>
            </div>
        );
    };

    window.VentSimSetup = VentSimSetup;
})();
