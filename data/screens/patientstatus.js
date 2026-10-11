// THE PATIENT AT A GLANCE: the strip at the top of the controller.
//
//   - one line that says what is happening to the patient now (in arrest, apnoeic and not being
//     ventilated, ventilated on the Atlan A350, stable ...), coloured by how urgent it is
//   - flags for the obs that are out of range (distressed, hypoxic, hypotensive, GCS ...), worked out
//     from the patient's TRUE obs, whether or not a sensor is on to show them to the team
//   - a stick figure showing what is attached: ECG leads, SpO2 probe, BP cuff, temperature, capnography,
//     arterial line, IV access, central line, airway, ventilator, pads, catheter, CPR
//   - the ventilator chooser (HAMILTON-T1, HAMILTON-C6, Atlan A350), switchable at any time
//
// Everything is derived from the engine state the controller already has: nothing new is stored or
// synced. The thresholds are NEWS2's red scores for adults and approximate ranges for children; they
// are prompts for the facilitator, not a scoring system.
(() => {
    const { useState } = React;

    const has = (set, k) => !!(set && typeof set.has === 'function' && set.has(k));
    const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);

    // Out-of-range limits by age (years). Adults: NEWS2 (RCP 2017) red scores. Children: approximate
    // limits from the usual paediatric ranges, wide enough to flag only clearly abnormal obs.
    function limitsFor(age) {
        const a = num(age);
        if (a !== null && a < 1) return { rrHi: 60, rrLo: 20, hrHi: 180, hrLo: 100, sbpLo: 70 };
        if (a !== null && a < 5) return { rrHi: 40, rrLo: 15, hrHi: 160, hrLo: 80, sbpLo: 75 };
        if (a !== null && a < 12) return { rrHi: 30, rrLo: 12, hrHi: 140, hrLo: 60, sbpLo: 80 };
        return { rrHi: 24, rrLo: 9, hrHi: 130, hrLo: 41, sbpLo: 91 };
    }

    // What the patient's state is, worked out once and used by the strip, the figure and the tests.
    function assess(state) {
        const RG = window.RHYTHMS;
        const VP = window.VENT_PROFILES;
        const VE = window.VENT_ENGINE;
        const s = state || {};
        const v = s.vitals || {};
        const act = s.activeInterventions || new Set();
        const sensors = window.getSensors ? window.getSensors(s) : {};
        const rhythm = s.rhythm || 'Sinus Rhythm';
        const arrest = !!(RG && RG.isPulseless(rhythm));
        const age = s.scenario ? s.scenario.patientAge : null;
        const L = limitsFor(age);

        // Airway and breathing support.
        const tube = has(act, 'RSI') ? 'ett' : has(act, 'FONA') ? 'fona' : has(act, 'i-gel') ? 'sga' : null;
        const bagging = has(act, 'Bagging');
        const niv = has(act, 'NIV') ? 'NIV' : has(act, 'CPAP') ? 'CPAP' : null;
        const oxygen = has(act, 'Oxygen');
        const adjunct = has(act, 'OPA') ? 'OPA' : has(act, 'NPA') ? 'NPA' : null;

        // The ventilators linked to the session, and the one breathing for the patient (if any).
        const mirrors = Object.keys(s.ventMirror || {}).map(k => s.ventMirror[k]).filter(Boolean)
            .sort((a, b) => Number(b.ts) - Number(a.ts));
        const vent = mirrors[0] || null;
        const ventilating = !!(vent && vent.state === 'ventilating');
        const model = VP ? VP.modelOf(s.vent && s.vent.model) : 't1';
        const modelName = VP ? VP.MODEL_SHORT[model] : 'ventilator';

        const paralysed = !!s.isParalysed;
        const rr = num(v.rr), spo2 = num(v.spO2), hr = num(v.hr), sbp = num(v.bpSys), dbp = num(v.bpDia);
        const gcs = num(v.gcs), temp = num(v.temp), bm = num(v.bm);
        const supported = ventilating || bagging || !!niv;
        // Can they breathe for themselves? Not in arrest, not paralysed, and not set (or, by the lung
        // profile, assumed) to be sedated and not breathing on the ventilator.
        const cfg = VE ? VE.configFor(s) : { breathing: null, profile: 'normal' };
        const sedatedLungs = !!(VP && VP.profiles[cfg.profile] && VP.profiles[cfg.profile].sedated);
        const cannotBreathe = arrest || paralysed || cfg.breathing === false || (cfg.breathing === null && sedatedLungs && (!!tube || !!vent));
        // With a tube in, the obs RR is the ventilation rate, so it says nothing about their own breathing.
        const apnoeic = cannotBreathe || (!supported && !tube && rr !== null && rr <= 0);

        // The headline: the one thing the facilitator most needs to know.
        let headline, tone;
        const airwayWord = tube === 'sga' ? 'Supraglottic airway' : tube === 'fona' ? 'Front-of-neck airway' : 'Intubated';
        if (arrest) {
            headline = `In cardiac arrest: ${RG.labelFor(rhythm)}`;
            tone = 'red';
        } else if (tube && !supported && vent && apnoeic) {
            headline = `${airwayWord} but NOT being ventilated (the ${modelName} is ${vent.state === 'standby' ? 'in standby' : vent.state === 'off' ? 'off' : 'not ventilating'})`;
            tone = 'red';
        } else if (tube && !supported && vent) {
            headline = `${airwayWord}, breathing for themselves (the ${modelName} is ${vent.state === 'standby' ? 'in standby' : vent.state === 'off' ? 'off' : 'not ventilating'})`;
            tone = 'amber';
        } else if (tube && !supported) {
            headline = `${airwayWord}: ventilation assumed (no ventilator linked)`;
            tone = 'cyan';
        } else if (apnoeic && !supported) {
            headline = paralysed ? 'Paralysed and apnoeic: NOT being ventilated' : 'Apnoeic: NOT being ventilated';
            tone = 'red';
        } else if (ventilating) {
            const how = tube === 'sga' ? 'on a supraglottic airway' : tube === 'fona' ? 'with a front-of-neck airway' : tube ? 'intubated' : 'on a mask';
            headline = `${apnoeic ? 'Anaesthetised, ' + how : how.charAt(0).toUpperCase() + how.slice(1)} and ventilated on the ${VP ? VP.MODEL_SHORT[VP.modelOf(vent.model)] : 'ventilator'}${vent.label ? ` (${vent.label})` : ''}`;
            tone = 'cyan';
        } else if (bagging) {
            headline = `Being ventilated by bag and ${tube ? (tube === 'sga' ? 'supraglottic airway' : 'tube') : 'mask'}`;
            tone = 'amber';
        } else if (niv) {
            headline = `On ${niv}`;
            tone = 'cyan';
        } else {
            headline = null;   // filled from the flags below
            tone = 'green';
        }

        // The out-of-range obs.
        const flags = [];
        const flag = (text, level) => flags.push({ text, level });
        if (!arrest) {
            if (!supported && !tube && !apnoeic && rr !== null && rr > L.rrHi) flag(`Distressed: RR ${rr}`, 'red');
            else if (!supported && !tube && !apnoeic && rr !== null && rr > 0 && rr < L.rrLo) flag(`Slow breathing: RR ${rr}`, 'red');
            if (spo2 !== null && spo2 < 88) flag(`Hypoxic: SpO2 ${Math.round(spo2)}%`, 'red');
            else if (spo2 !== null && spo2 < 92) flag(`Low SpO2: ${Math.round(spo2)}%`, 'amber');
            if (sbp !== null && sbp < L.sbpLo) flag(`Hypotensive: BP ${Math.round(sbp)}${dbp !== null ? '/' + Math.round(dbp) : ''}`, 'red');
            if (hr !== null && hr > L.hrHi) flag(`Tachycardic: HR ${Math.round(hr)}`, 'amber');
            else if (hr !== null && hr < L.hrLo) flag(`Bradycardic: HR ${Math.round(hr)}`, 'red');
            if (gcs !== null && gcs <= 8 && !paralysed && !tube) flag(`Unconscious: GCS ${gcs}`, 'red');
            else if (gcs !== null && gcs < 15 && gcs > 8) flag(`GCS ${gcs}`, 'amber');
        }
        if (temp !== null && temp <= 35) flag(`Hypothermic: ${temp.toFixed(1)}°C`, temp < 32 ? 'red' : 'amber');
        else if (temp !== null && temp >= 39.1) flag(`Fever: ${temp.toFixed(1)}°C`, 'amber');
        if (bm !== null && bm < 4) flag(`Hypoglycaemic: glucose ${bm.toFixed(1)}`, 'red');
        if (s.cprInProgress) flag(has(act, 'Lucas') ? 'CPR: LUCAS on' : 'CPR in progress', arrest ? 'cyan' : 'red');
        else if (arrest) flag('No CPR running', 'red');
        if (arrest && s.arrest && Number.isFinite(s.arrest.since)) {
            const secs = Math.max(0, Math.round((Number(s.time) || 0) - s.arrest.since));
            flag(`Arrest time ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, 'slate');
        }
        if (paralysed && !arrest) flag('Paralysed', 'slate');
        if (s.pacing && s.pacing.electrical) flag(s.pacing.mechanical ? 'Paced with capture' : 'Pacing: no capture', s.pacing.mechanical ? 'cyan' : 'red');

        if (!headline) {
            // The worst obs say it best ("Distressed: RR 34 · Hypoxic: SpO2 85%").
            const red = flags.filter(f => f.level === 'red'), amber = flags.filter(f => f.level === 'amber');
            const worst = red.length ? red : amber;
            headline = worst.length ? worst.slice(0, 2).map(f => f.text).join(' · ') + (worst.length > 2 ? ` (+${worst.length - 2} more)` : '') : 'Stable: obs within normal limits';
            tone = red.length ? 'red' : amber.length ? 'amber' : 'green';
        }

        // What is attached, in words (the figure shows the same).
        const monitors = [];
        if (sensors.ecg) monitors.push('ECG');
        if (sensors.spo2) monitors.push('SpO2');
        if (sensors.nibp) monitors.push('NIBP');
        if (sensors.temp) monitors.push('Temp');
        if (sensors.etco2) monitors.push('ETCO2');
        if (sensors.art) monitors.push('Art line');
        const access = [];
        if (has(act, 'IV Access')) access.push('IV');
        if (has(act, 'IO Access')) access.push('IO');
        if (has(act, 'CVC')) access.push('Central line');
        const airway = tube === 'ett' ? 'Tracheal tube' : tube === 'fona' ? 'Front-of-neck airway' : tube === 'sga' ? 'Supraglottic airway (i-gel)'
            : niv ? `${niv} mask` : bagging ? 'Bag-valve-mask' : oxygen ? 'Oxygen mask' : adjunct ? adjunct : null;
        const other = [];
        if (has(act, 'PacingPads')) other.push('Pads');
        if (has(act, 'Catheter')) other.push('Catheter');
        if (['SeldingerDrain', 'SurgicalDrain', 'FingerThoracostomy'].some(k => has(act, k))) other.push('Chest drain');
        if (has(act, 'Lucas')) other.push('LUCAS');

        return {
            arrest, apnoeic, paralysed, headline, tone, flags, sensors, tube, bagging, niv, oxygen, adjunct,
            vent, ventilating, model, modelName, monitors, access, airway, other,
            cpr: !!s.cprInProgress, lucas: has(act, 'Lucas'), pads: has(act, 'PacingPads'), catheter: has(act, 'Catheter'),
            drain: ['SeldingerDrain', 'SurgicalDrain', 'FingerThoracostomy'].some(k => has(act, k)),
            iv: has(act, 'IV Access') || has(act, 'IO Access'), cvc: has(act, 'CVC'),
            cyanosed: !arrest && spo2 !== null && spo2 < 88
        };
    }

    // ---- the stick figure ----------------------------------------------------------------------
    // Drawn facing the viewer, so the patient's right side is on the left of the picture.
    const PatientFigure = ({ a, className }) => {
        const body = a.arrest ? '#f87171' : '#e2e8f0';
        const face = a.arrest ? '#7f1d1d' : a.cyanosed ? '#1e3a8a' : '#334155';
        const ventCol = a.ventilating ? '#22d3ee' : '#f59e0b';
        const label = [a.headline,
            a.monitors.length ? 'Monitoring: ' + a.monitors.join(', ') : 'No monitoring attached',
            a.access.length ? 'Access: ' + a.access.join(', ') : 'No IV access',
            a.airway ? 'Airway: ' + a.airway : null,
            a.vent ? `Ventilator: ${a.modelName}, ${a.vent.state}` : null,
            a.other.length ? a.other.join(', ') : null].filter(Boolean).join('. ');
        const breathing = !a.apnoeic && !a.ventilating && !a.bagging;
        return (
            <svg viewBox="0 0 172 160" role="img" aria-label={label} data-testid="patient-figure" className={className}>
                <title>{label}</title>
                {/* the patient */}
                <g stroke={body} strokeWidth="3" strokeLinecap="round" fill="none">
                    <line x1="60" y1="35" x2="60" y2="96" />
                    <polyline points="60,46 38,70 30,96" />
                    <polyline points="60,46 82,70 90,96" />
                    <polyline points="60,96 46,150" />
                    <polyline points="60,96 74,150" />
                </g>
                <circle cx="60" cy="22" r="13" fill={face} stroke={body} strokeWidth="3">
                    {breathing && <animate attributeName="r" values="13;13.6;13" dur="3s" repeatCount="indefinite" />}
                </circle>
                {/* CPR: hands on the chest */}
                {a.cpr && !a.lucas && <g data-part="cpr"><path d="M50 66 h20 M60 56 v18" stroke="#fbbf24" strokeWidth="4" strokeLinecap="round"><animateTransform attributeName="transform" type="translate" values="0 0;0 4;0 0" dur="0.55s" repeatCount="indefinite" /></path></g>}
                {a.lucas && <rect data-part="lucas" x="44" y="52" width="32" height="30" rx="4" fill="none" stroke="#fbbf24" strokeWidth="2.5" />}
                {/* ECG electrodes: right arm red, left arm yellow, left leg green */}
                {a.sensors.ecg && <g data-part="ecg">
                    <circle cx="49" cy="50" r="3.2" fill="#ef4444" /><circle cx="71" cy="50" r="3.2" fill="#facc15" /><circle cx="70" cy="90" r="3.2" fill="#22c55e" />
                </g>}
                {/* defib / pacing pads: right upper chest and left side */}
                {a.pads && <g data-part="pads" fill="#f97316" fillOpacity="0.85"><rect x="45" y="56" width="11" height="14" rx="2" /><rect x="68" y="70" width="11" height="14" rx="2" /></g>}
                {/* NIBP cuff on the patient's right upper arm */}
                {a.sensors.nibp && <rect data-part="nibp" x="40" y="57" width="9" height="12" rx="2" fill="#60a5fa" transform="rotate(42 44 63)" />}
                {/* arterial line at the right wrist */}
                {a.sensors.art && <circle data-part="art" cx="31" cy="92" r="3.5" fill="#dc2626" stroke="#fecaca" strokeWidth="1" />}
                {/* SpO2 probe on a left finger */}
                {a.sensors.spo2 && <g data-part="spo2"><rect x="86" y="94" width="9" height="8" rx="2" fill="#ef4444" /><circle cx="90.5" cy="98" r="1.6" fill="#fecaca" /></g>}
                {/* IV / IO access on the left forearm */}
                {a.iv && <g data-part="iv"><rect x="81" y="76" width="9" height="5" rx="1" fill="#22d3ee" transform="rotate(62 85 78)" /><line x1="88" y1="74" x2="104" y2="64" stroke="#22d3ee" strokeWidth="1.2" /></g>}
                {/* central line in the right neck */}
                {a.cvc && <circle data-part="cvc" cx="54" cy="39" r="3" fill="#a78bfa" />}
                {/* temperature probe */}
                {a.sensors.temp && <g data-part="temp"><line x1="44" y1="17" x2="36" y2="10" stroke="#fb923c" strokeWidth="2" /><circle cx="35" cy="9" r="2.2" fill="#fb923c" /></g>}
                {/* chest drain and catheter */}
                {a.drain && <line data-part="drain" x1="74" y1="66" x2="100" y2="76" stroke="#94a3b8" strokeWidth="2" strokeDasharray="3 2" />}
                {a.catheter && <g data-part="catheter"><path d="M60 98 q-2 16 -14 22" stroke="#fde047" strokeWidth="1.6" fill="none" /><rect x="36" y="118" width="11" height="13" rx="2" fill="#fde047" fillOpacity="0.5" stroke="#fde047" /></g>}
                {/* airway: a face mask, or a tube from the mouth (or the neck) */}
                {(a.niv || a.oxygen || (a.bagging && !a.tube)) && !a.tube && <path data-part="mask" d="M52 24 q8 12 16 0 z" fill="#38bdf8" fillOpacity="0.55" stroke="#38bdf8" strokeWidth="1.5" />}
                {a.tube && <path data-part="tube" d={a.tube === 'fona' ? 'M60 37 L98 37 L124 26' : 'M60 28 L98 28 L124 22'} stroke={a.tube === 'sga' ? '#a78bfa' : '#e2e8f0'} strokeWidth="2.5" fill="none" />}
                {a.bagging && <ellipse data-part="bag" cx="136" cy="22" rx="10" ry="7" fill="#38bdf8" fillOpacity="0.35" stroke="#38bdf8" strokeWidth="1.5" />}
                {/* capnography on the airway */}
                {a.sensors.etco2 && <g data-part="etco2"><rect x="84" y={a.tube === 'fona' ? 31 : 22} width="14" height="8" rx="1.5" fill="#facc15" /><text x="91" y={a.tube === 'fona' ? 37 : 28} fontSize="5.5" textAnchor="middle" fill="#000" fontWeight="bold">CO2</text></g>}
                {/* the ventilator */}
                {a.vent && !a.bagging && <g data-part="vent">
                    {!a.tube && !a.niv && <path d="M60 28 L124 22" stroke={ventCol} strokeWidth="1.5" strokeDasharray="3 3" fill="none" />}
                    <rect x="124" y="6" width="46" height="30" rx="4" fill="#0f172a" stroke={ventCol} strokeWidth="2" />
                    <text x="147" y="19" fontSize="9" textAnchor="middle" fill={ventCol} fontWeight="bold">{a.model === 'a350' ? 'A350' : a.model.toUpperCase()}</text>
                    <text x="147" y="30" fontSize="6.5" textAnchor="middle" fill="#cbd5e1">{a.ventilating ? 'ventilating' : a.vent.state}</text>
                </g>}
            </svg>
        );
    };

    const TONE = {
        red: 'border-red-500 bg-red-950/50 text-red-200',
        amber: 'border-amber-500 bg-amber-950/40 text-amber-200',
        cyan: 'border-cyan-500 bg-cyan-950/40 text-cyan-200',
        green: 'border-emerald-600 bg-emerald-950/30 text-emerald-200',
        slate: 'border-slate-600 bg-slate-800 text-slate-200'
    };
    const CHIP = {
        red: 'bg-red-700 text-white', amber: 'bg-amber-500 text-black', cyan: 'bg-cyan-700 text-white',
        green: 'bg-emerald-700 text-white', slate: 'bg-slate-700 text-slate-100'
    };

    // ---- the strip ------------------------------------------------------------------------------
    const PatientStatusPanel = ({ sim, addLogEntry, showVent = true }) => {
        const state = sim.state;
        const a = assess(state);
        const VP = window.VENT_PROFILES;
        const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('wmebem_status_collapsed') === '1'; } catch (e) { return false; } });
        const toggle = () => { const n = !collapsed; setCollapsed(n); try { localStorage.setItem('wmebem_status_collapsed', n ? '1' : '0'); } catch (e) {} };
        const log = addLogEntry || sim.addLogEntry;
        const model = a.model;
        const ventShown = !!state.ventPanelOpen;
        const setModel = (m) => {
            if (!VP || m === model) return;
            sim.dispatch({ type: 'SET_VENT_CONFIG', payload: { model: m } });
            log(`Ventilator changed to the ${VP.MODELS[m]} (facilitator)`, 'system');
        };
        const toggleVentShown = () => {
            sim.dispatch({ type: 'SET_VENT_PANEL', payload: !ventShown });
            log(ventShown ? 'Ventilator taken off the patient screens (facilitator)' : 'Ventilator shown on the patient screens (facilitator)', 'system');
        };
        const row = (label, items, empty) => (
            <div className="flex gap-1.5 items-baseline min-w-0">
                <span className="text-[9px] uppercase font-bold text-slate-400 w-[4.6rem] flex-none">{label}</span>
                <span className={`text-[11px] truncate ${items.length ? 'text-white' : 'text-slate-300 italic'}`}>{items.length ? items.join(' · ') : empty}</span>
            </div>
        );

        return (
            <section aria-label="Patient status" data-testid="patient-status" className={`flex-none mb-2 rounded border-l-4 border ${TONE[a.tone] || TONE.slate}`}>
                <div className="flex items-center gap-2 px-2 py-1">
                    <span className={`flex-none w-2.5 h-2.5 rounded-full ${a.tone === 'red' ? 'bg-red-500 animate-pulse' : a.tone === 'amber' ? 'bg-amber-400' : a.tone === 'cyan' ? 'bg-cyan-400' : 'bg-emerald-400'}`} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                        <span className="text-[9px] uppercase tracking-widest font-bold text-slate-400 mr-2">Patient now</span>
                        <span data-testid="patient-headline" className="text-sm md:text-base font-bold">{a.headline}</span>
                    </div>
                    <button type="button" onClick={toggle} aria-expanded={!collapsed} className="flex-none text-[10px] uppercase font-bold px-2 py-0.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-700">
                        {collapsed ? 'Show' : 'Hide'}
                    </button>
                </div>
                {!collapsed && (
                    <div className="flex flex-wrap md:flex-nowrap gap-3 px-2 pb-2 items-start">
                        <PatientFigure a={a} className="w-32 h-28 md:w-40 md:h-36 flex-none bg-slate-950/60 rounded" />
                        <div className="min-w-0 flex-1 flex flex-col gap-1">
                            {a.flags.length > 0 && (
                                <div className="flex flex-wrap gap-1" data-testid="patient-flags">
                                    {a.flags.map((f, i) => <span key={i} className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${CHIP[f.level] || CHIP.slate}`}>{f.text}</span>)}
                                </div>
                            )}
                            {row('Monitoring', a.monitors, 'Nothing attached')}
                            {row('Access', a.access, 'None')}
                            {row('Airway', a.airway ? [a.airway] : [], 'Own airway')}
                            {a.other.length > 0 && row('Also', a.other, '')}
                        </div>
                        {VP && showVent && (
                            <div className="flex-none flex flex-col gap-1 w-full sm:w-auto sm:min-w-[11rem]" data-testid="status-vent">
                                <span className="text-[9px] uppercase font-bold text-slate-400">Ventilator</span>
                                <div className="flex gap-1" role="group" aria-label="Choose the ventilator">
                                    {Object.keys(VP.MODELS).map(m => (
                                        <button key={m} type="button" aria-pressed={model === m} title={VP.MODELS[m]} onClick={() => setModel(m)}
                                                className={`px-2 py-1 rounded border text-[10px] font-bold ${model === m ? 'bg-cyan-700 border-cyan-400 text-white' : 'bg-slate-900 border-slate-600 text-slate-300 hover:border-cyan-500'}`}>
                                            {m === 'a350' ? 'Atlan A350' : VP.MODEL_SHORT[m].replace('HAMILTON-', '')}
                                        </button>
                                    ))}
                                </div>
                                <span className="text-[10px] text-slate-400">{a.vent ? `${a.modelName}: ${a.ventilating ? 'ventilating' : a.vent.state}` : 'Not connected'}</span>
                                <button type="button" onClick={toggleVentShown}
                                        className={`px-2 py-1 rounded border text-[10px] font-bold ${ventShown ? 'bg-cyan-900/40 border-cyan-500 text-cyan-200' : 'bg-slate-900 border-cyan-600/60 text-cyan-300'}`}>
                                    {ventShown ? 'Take off the patient screens' : 'Show on the patient screens'}
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </section>
        );
    };

    window.PatientStatus = { assess, limitsFor, PatientFigure, PatientStatusPanel };
})();
