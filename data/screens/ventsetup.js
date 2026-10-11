(() => {
    const { useState } = React;

    // =============================================================================================
    // VENTILATOR SIM: the start-screen tab. Pick a scenario and Education or Assessment. The
    // candidate uses the ventilator on the room monitor tablet (shown there from the start) or on
    // its own tablet (Screens -> Join by QR code -> Ventilator); the facilitator runs it from the controller's
    // Ventilator section. Everything else (engine, session, monitor, debrief) is shared.
    // devices: the machines this card offers, the first being the default: ['t1'] (the HAMILTON-T1,
    // the Ventilator Sim card) or ['a350', 'c6'] (the Dräger Atlan A350 anaesthetic machine and the
    // HAMILTON-C6 ICU ventilator, the Anaesthetics / ICU card). Each shows the scenarios written for it.
    // =============================================================================================
    const VentSimSetup = ({ onStart, devices = ['t1'] }) => {
        const { Lucide } = window;
        const VS = window.VentSim;
        const VP = window.VENT_PROFILES;
        const [mode, setMode] = useState('education');
        const [device, setDevice] = useState(devices[0]);
        // The anaesthetic emergencies (for novice anaesthetists) come first.
        const listFor = (d) => VS.forDevice(d).slice().sort((a, b) => (b.group === 'Anaesthetic emergencies') - (a.group === 'Anaesthetic emergencies'));
        const list = listFor(device);
        const [choice, setChoice] = useState(list[0].id);
        // A scenario written for both machines stays chosen when the machine changes.
        const pickDevice = (d) => { setDevice(d); const l = listFor(d); if (!l.some(s => s.id === choice)) setChoice(l[0].id); };
        const devName = VP.MODEL_SHORT[device];
        const DEV_TEXT = {
            t1: 'Ventilator Sim: HAMILTON-T1 skills',
            c6: 'ICU ventilator: HAMILTON-C6 skills',
            a350: 'Anaesthetic machine: Dräger Atlan A350 skills'
        };

        const groups = [];
        list.forEach(s => {
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
                    <p className="font-bold text-cyan-300 mb-1 flex items-center gap-2"><Lucide icon="wind" className="w-4 h-4"/> {DEV_TEXT[device]}</p>
                    {device === 'a350' && <p className="text-xs text-slate-400 mb-1">A recreation of a Dräger Atlan A350 anaesthetic machine: the machine check, the breathing system with the bag and APL valve, fresh gas and a sevoflurane vaporiser, and its ventilator (Man/Spon, volume, pressure and pressure support modes). Built from Dräger's published instructions for use and product information, but the screen layout, colours and some wording, alarm delays and the gas model are the simulator's approximations. For training only; it is not Dräger software.</p>}
                    {device === 'c6' && <p className="text-xs text-slate-400 mb-1">A recreation of the HAMILTON-C6 intensive care ventilator: a widescreen touch display with the controls along the bottom, volume- and pressure-controlled modes, ASV and NIV. For training only; it is not Hamilton Medical software.</p>}
                    {device !== 't1' && <p className="text-xs text-slate-400 mb-1">The <b>Anaesthetic emergencies</b> follow the Association of Anaesthetists' Quick Reference Handbook (QRH, June 2023 edition): the guideline number is in each name. The scenario text, patients and effect sizes are the simulator's and should be checked by the facilitator.</p>}
                    <p className="text-xs text-slate-400">The candidate uses the {devName} on the room monitor tablet (it opens there; they can flip to the obs and back) or on its own tablet (<b>Screens</b> → <b>Join by QR code</b> → Ventilator). You run it from the controller's <b>Ventilator</b> section: problems, lungs, and full remote control of the device. The ventilator drives SpO2, CO2 and the breathing rate.</p>
                </div>
                {devices.length > 1 && (
                    <div>
                        <div className="text-[10px] text-slate-400 uppercase font-bold mb-1">Machine</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {devices.map(d => (
                                <button key={d} type="button" data-vent-device={d} onClick={() => pickDevice(d)} className={optionClass(device === d)} aria-pressed={device === d}>
                                    <div className="font-bold">{VP.MODELS[d]}</div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
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
                <button type="button" onClick={() => onStart({ scenario: choice, mode, device })}
                        className="w-full py-4 text-lg font-bold rounded bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-900/20">{device === 'a350' ? 'Start anaesthetic machine scenario' : device === 'c6' ? 'Start ICU ventilator scenario' : 'Start Ventilator Sim'}</button>
            </div>
        );
    };

    window.VentSimSetup = VentSimSetup;
})();
