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
        // NEWS2 is not validated under 16, so 12 to 15 year olds keep the older children's limits.
        if (a !== null && a < 16) return { rrHi: 30, rrLo: 12, hrHi: 140, hrLo: 60, sbpLo: 80 };
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
        // Counted as ventilating only when it reaches the patient: switched on, the facilitator's link
        // to the obs not turned off, and the circuit connected. Man/Spon on the A350 ventilates only
        // when breaths are being given (the bag squeezed or the patient breathing), and high-flow
        // oxygen on the T1 or C6 gives oxygen, not breaths.
        const ventMode = vent ? String(vent.mode || '') : '';
        const manual = ventMode === 'MAN', highFlow = ventMode === 'HiFlowO2';
        const unplugged = !!(vent && vent.phys && Number(vent.phys.conn) === 0);
        const reaches = !!(vent && vent.state === 'ventilating' && s.ventLink !== false && !unplugged);
        const manBreaths = !!(vent && vent.mon && Number(vent.mon.ftot) > 0);
        const ventilating = reaches && !highFlow && (!manual || manBreaths);
        const ventWhy = !vent ? '' : vent.state === 'standby' ? 'in standby' : vent.state === 'off' ? 'off'
            : vent.state !== 'ventilating' ? 'not ventilating' : s.ventLink === false ? 'not linked to the patient'
            : unplugged ? 'disconnected from the patient' : highFlow ? 'on high-flow oxygen'
            : manual ? 'in Man/Spon with no breaths being given' : 'not ventilating';
        const model = VP ? VP.modelOf(s.vent && s.vent.model) : 't1';
        const modelName = VP ? VP.MODEL_SHORT[model] : 'ventilator';

        const paralysed = !!s.isParalysed;
        const rr = num(v.rr), spo2 = num(v.spO2), hr = num(v.hr), sbp = num(v.bpSys), dbp = num(v.bpDia);
        const gcs = num(v.gcs), temp = num(v.temp), bm = num(v.bm);
        const supported = ventilating || bagging || !!niv;
        const ventName = vent && VP ? VP.MODEL_SHORT[VP.modelOf(vent.model)] : modelName;
        // Can they breathe for themselves? Not in arrest, not paralysed, and not set (or, by the lung
        // profile, assumed) to be sedated and not breathing on the ventilator. The profile alone only
        // counts with a tube in or in a ventilator scenario: an awake asthmatic is not sedated.
        const cfg = VE ? VE.configFor(s) : { breathing: null, profile: 'normal' };
        const sedatedLungs = !!(VP && VP.profiles[cfg.profile] && VP.profiles[cfg.profile].sedated);
        const cannotBreathe = arrest || paralysed || cfg.breathing === false || (cfg.breathing === null && sedatedLungs && (!!tube || !!(s.scenario && s.scenario.ventSim)));
        // With a tube in, the obs RR is the ventilation rate, so it says nothing about their own breathing.
        const apnoeic = cannotBreathe || (!supported && !tube && rr !== null && rr <= 0);

        // The headline: the one thing the facilitator most needs to know.
        let headline, tone;
        const airwayWord = tube === 'sga' ? 'Supraglottic airway' : tube === 'fona' ? 'Front-of-neck airway' : 'Intubated';
        if (arrest) {
            headline = `In cardiac arrest: ${RG.labelFor(rhythm)}`;
            tone = 'red';
        } else if (tube && !supported && vent && apnoeic) {
            headline = `${airwayWord} but NOT being ventilated (the ${ventName} is ${ventWhy})`;
            tone = 'red';
        } else if (tube && !supported && vent) {
            headline = `${airwayWord}, breathing for themselves (the ${ventName} is ${ventWhy})`;
            tone = 'amber';
        } else if (tube && !supported) {
            headline = `${airwayWord}: ventilation assumed (no ventilator linked)`;
            tone = 'cyan';
        } else if (apnoeic && !supported) {
            headline = (paralysed ? 'Paralysed and apnoeic: NOT being ventilated' : 'Apnoeic: NOT being ventilated')
                + (vent && (manual || highFlow) && reaches ? ` (the ${ventName} is ${ventWhy})` : '');
            tone = 'red';
        } else if (ventilating && manual && !apnoeic) {
            headline = `${tube ? airwayWord + ', b' : 'B'}reathing for themselves on the ${ventName} in Man/Spon`;
            tone = 'cyan';
        } else if (ventilating) {
            const how = tube === 'sga' ? 'on a supraglottic airway' : tube === 'fona' ? 'with a front-of-neck airway' : tube ? 'intubated' : 'on a mask';
            headline = `${apnoeic ? 'Anaesthetised, ' + how : how.charAt(0).toUpperCase() + how.slice(1)} and ventilated on the ${ventName}${vent.label ? ` (${vent.label})` : ''}`;
            tone = 'cyan';
        } else if (bagging) {
            headline = `Being ventilated by bag and ${tube ? (tube === 'sga' ? 'supraglottic airway' : 'tube') : 'mask'}`;
            tone = 'amber';
        } else if (niv) {
            headline = `On ${niv}`;
            tone = 'cyan';
        } else if (highFlow && reaches) {
            headline = `On high-flow oxygen on the ${ventName}`;
            tone = 'cyan';
        } else if (manual && reaches) {
            headline = `On the ${ventName} in Man/Spon, breathing for themselves`;
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
            vent, ventilating, ventWhy, manual, highFlow, model, modelName, monitors, access, airway, other,
            cpr: !!s.cprInProgress, lucas: has(act, 'Lucas'), pads: has(act, 'PacingPads'), catheter: has(act, 'Catheter'),
            drain: ['SeldingerDrain', 'SurgicalDrain', 'FingerThoracostomy'].some(k => has(act, k)),
            iv: has(act, 'IV Access') || has(act, 'IO Access'), cvc: has(act, 'CVC'),
            cyanosed: !arrest && spo2 !== null && spo2 < 88,
            eyesClosed: arrest || paralysed || !!tube || (gcs !== null && gcs <= 8),
            distressed: flags.some(f => /^Distressed/.test(f.text)),
            sex: s.scenario && s.scenario.sex === 'Female' ? 'Female' : 'Male'
        };
    }

    // ---- the patient picture ------------------------------------------------------------------
    // The patient lying on a trolley, seen from above with the head at the top (so the patient's right
    // side is on the left of the picture), with every piece of kit drawn where it really goes and its
    // cable or tubing running to the monitor, the ventilator, the defib or the drip stand.
    const SKIN = { normal: '#e9b993', shade: '#c98f6b', cyan: '#9fb4d6', cyanShade: '#7189b3', arrest: '#b9bec7', arrestShade: '#8b919c' };
    const PatientFigure = ({ a, className }) => {
        const skin = a.arrest ? SKIN.arrest : a.cyanosed ? SKIN.cyan : SKIN.normal;
        const shade = a.arrest ? SKIN.arrestShade : a.cyanosed ? SKIN.cyanShade : SKIN.shade;
        const ventCol = a.ventilating ? '#22d3ee' : '#f59e0b';
        const anyMon = a.sensors.ecg || a.sensors.spo2 || a.sensors.nibp || a.sensors.temp || a.sensors.etco2 || a.sensors.art;
        const label = [a.headline,
            a.monitors.length ? 'Monitoring: ' + a.monitors.join(', ') : 'No monitoring attached',
            a.access.length ? 'Access: ' + a.access.join(', ') : 'No IV access',
            a.airway ? 'Airway: ' + a.airway : null,
            a.vent ? `Ventilator: ${a.modelName}, ${a.vent.state}` : null,
            a.other.length ? a.other.join(', ') : null].filter(Boolean).join('. ');
        const breathing = !a.apnoeic && !a.ventilating && !a.bagging;
        const chestMoves = !a.arrest && (breathing || a.ventilating || a.bagging);
        const breathDur = a.distressed ? '1.6s' : '3.6s';
        // where the airway leaves the patient: the mouth, or the front of the neck
        const ax = 95, ay = a.tube === 'fona' ? 54 : 41;
        const cable = { fill: 'none', strokeWidth: 1.1, strokeLinecap: 'round', opacity: 0.85 };
        return (
            <svg viewBox="0 0 220 200" role="img" aria-label={label} data-testid="patient-figure" className={className}>
                <title>{label}</title>
                <defs>
                    <linearGradient id="ps-skin" x1="0" x2="1"><stop offset="0" stopColor={shade} /><stop offset="0.35" stopColor={skin} /><stop offset="0.65" stopColor={skin} /><stop offset="1" stopColor={shade} /></linearGradient>
                    <linearGradient id="ps-sheet" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#7c93b5" /><stop offset="1" stopColor="#4f6487" /></linearGradient>
                    <radialGradient id="ps-pillow"><stop offset="0" stopColor="#f1f5f9" /><stop offset="1" stopColor="#cbd5e1" /></radialGradient>
                </defs>

                {/* the trolley, its mattress and the pillow */}
                <rect x="52" y="3" width="86" height="194" rx="12" fill="#1e293b" stroke="#475569" strokeWidth="1.5" />
                <rect x="57" y="8" width="76" height="184" rx="9" fill="#334155" />
                <ellipse cx="95" cy="28" rx="30" ry="18" fill="url(#ps-pillow)" opacity="0.9" />

                {/* the drip stand (IV fluids) */}
                {a.iv && <g data-part="drip">
                    <line x1="24" y1="6" x2="24" y2="70" stroke="#94a3b8" strokeWidth="1.5" /><line x1="16" y1="6" x2="32" y2="6" stroke="#94a3b8" strokeWidth="1.5" />
                    <rect x="17" y="9" width="14" height="20" rx="3" fill="#e0f2fe" fillOpacity="0.85" stroke="#7dd3fc" />
                    <rect x="17" y="17" width="14" height="12" rx="2" fill="#7dd3fc" fillOpacity="0.55" />
                    <rect x="22" y="29" width="4" height="7" fill="#cbd5e1" />
                </g>}
                {/* the arterial line's pressure bag and transducer */}
                {a.sensors.art && <g data-part="artbag"><rect x="9" y="42" width="11" height="15" rx="3" fill="#fecaca" stroke="#ef4444" /><text x="14.5" y="52" fontSize="5" textAnchor="middle" fill="#7f1d1d" fontWeight="bold">300</text></g>}

                {/* the patient's body */}
                <g data-part="body">
                    {/* arms, lying by the sides */}
                    <path d="M71 62 C62 78 60 98 61 124" stroke={shade} strokeWidth="11" strokeLinecap="round" fill="none" />
                    <path d="M71 62 C62 78 60 98 61 124" stroke={skin} strokeWidth="9" strokeLinecap="round" fill="none" />
                    <path d="M119 62 C128 78 130 98 129 124" stroke={shade} strokeWidth="11" strokeLinecap="round" fill="none" />
                    <path d="M119 62 C128 78 130 98 129 124" stroke={skin} strokeWidth="9" strokeLinecap="round" fill="none" />
                    <ellipse cx="61" cy="131" rx="5" ry="7" fill={skin} stroke={shade} strokeWidth="0.8" />
                    <ellipse cx="129" cy="131" rx="5" ry="7" fill={skin} stroke={shade} strokeWidth="0.8" />
                    {/* neck and chest, which rise and fall with each breath */}
                    <rect x="88" y="44" width="14" height="14" rx="3" fill={skin} />
                    <g>
                        {chestMoves && <animateTransform attributeName="transform" type="scale" additive="sum" values="1 1;1.035 1.02;1 1" dur={a.ventilating || a.bagging ? '4.5s' : breathDur} repeatCount="indefinite" />}
                        <path d="M72 58 Q95 50 118 58 Q124 62 124 72 L121 108 Q120 122 114 128 L76 128 Q70 122 69 108 L66 72 Q66 62 72 58 Z" fill="url(#ps-skin)" stroke={shade} strokeWidth="0.8" />
                        {/* collarbones, the sternum and the lower ribs */}
                        <path d="M78 60 Q86 63 93 61 M97 61 Q104 63 112 60" stroke={shade} strokeWidth="0.9" fill="none" opacity="0.8" />
                        <path d="M95 64 L95 92" stroke={shade} strokeWidth="0.7" opacity="0.6" />
                        <path d="M76 96 Q86 104 95 98 Q104 104 114 96" stroke={shade} strokeWidth="0.7" fill="none" opacity="0.6" />
                        <circle cx="84" cy="80" r="1.4" fill={shade} /><circle cx="106" cy="80" r="1.4" fill={shade} />
                    </g>
                    {/* the sheet over the hips and legs */}
                    <path d="M64 118 Q95 112 126 118 L128 186 Q95 192 62 186 Z" fill="url(#ps-sheet)" />
                    <path d="M95 126 L95 184 M74 132 Q80 160 78 182 M116 132 Q110 160 112 182" stroke="#3b4d6b" strokeWidth="1" fill="none" opacity="0.7" />
                    <path d="M64 118 Q95 112 126 118" stroke="#a5b4cf" strokeWidth="2" fill="none" />
                    {/* the head: hair, ears, eyes (closed when unconscious or anaesthetised), nose and mouth */}
                    <ellipse cx="95" cy="30" rx="15" ry="17" fill={skin} stroke={shade} strokeWidth="0.8" />
                    <ellipse cx="80.5" cy="31" rx="2.4" ry="4" fill={shade} /><ellipse cx="109.5" cy="31" rx="2.4" ry="4" fill={shade} />
                    <path d={a.sex === 'Female' ? 'M79 30 Q76 10 95 11 Q114 10 111 30 Q110 19 95 17 Q80 19 79 30 Z' : 'M81 24 Q80 12 95 12 Q110 12 109 24 Q104 17 95 17 Q86 17 81 24 Z'} fill="#4a3426" />
                    {a.eyesClosed
                        ? <path d="M86 29 q3 2 6 0 M98 29 q3 2 6 0" stroke="#3f2a1f" strokeWidth="1" fill="none" />
                        : <g fill="#1f2937"><ellipse cx="89" cy="28.5" rx="1.6" ry="1.3" /><ellipse cx="101" cy="28.5" rx="1.6" ry="1.3" /></g>}
                    <path d="M95 30 L93.6 35 L96 35.4" stroke={shade} strokeWidth="0.8" fill="none" />
                    {!a.tube && <path d={a.distressed ? 'M91 40 Q95 37 99 40 Q95 42.5 91 40 Z' : 'M91.5 39.5 Q95 41.5 98.5 39.5'} stroke="#8b4a3c" strokeWidth="1" fill={a.distressed ? '#5b2b25' : 'none'} />}
                </g>

                {/* the monitor, the ventilator and the defib beside the trolley */}
                <g data-part="monitor" opacity={anyMon ? 1 : 0.45}>
                    <rect x="150" y="58" width="66" height="46" rx="5" fill="#0b1220" stroke={anyMon ? '#38bdf8' : '#475569'} strokeWidth="1.5" />
                    <rect x="155" y="63" width="56" height="30" rx="2" fill="#020617" />
                    {a.sensors.ecg && <path d="M157 74 h8 l2 -5 l2 9 l2 -4 h9 l2 -5 l2 9 l2 -4 h9 l2 -5 l2 9 l2 -4 h3" stroke="#4ade80" strokeWidth="1" fill="none" />}
                    {a.sensors.spo2 && <path d="M157 86 q4 -6 8 0 t8 0 t8 0 t8 0 t8 0 t5 0" stroke="#38bdf8" strokeWidth="0.9" fill="none" />}
                    {!anyMon && <text x="183" y="81" fontSize="6" textAnchor="middle" fill="#94a3b8">no sensors</text>}
                    <text x="183" y="100.5" fontSize="5.5" textAnchor="middle" fill="#94a3b8" fontWeight="bold">MONITOR</text>
                </g>
                {a.vent && !a.bagging && <g data-part="vent">
                    <rect x="150" y="6" width="66" height="44" rx="5" fill="#0b1220" stroke={ventCol} strokeWidth="1.8" />
                    <rect x="155" y="11" width="56" height="22" rx="2" fill="#020617" />
                    {a.ventilating && <path d="M157 28 l4 -12 h10 l3 12 h4 l4 -12 h10 l3 12 h4 l4 -12 h4" stroke={ventCol} strokeWidth="1" fill="none" />}
                    {!a.ventilating && <text x="183" y="25" fontSize="7" textAnchor="middle" fill={ventCol} fontWeight="bold">{a.vent.state === 'ventilating' ? (a.highFlow ? 'HFO' : a.manual ? 'MAN' : 'no link') : a.vent.state}</text>}
                    <text x="183" y="44" fontSize="7.5" textAnchor="middle" fill={ventCol} fontWeight="bold">{a.model === 'a350' ? 'ATLAN A350' : a.model === 'c6' ? 'HAMILTON C6' : 'HAMILTON T1'}</text>
                </g>}
                {a.pads && <g data-part="defib">
                    <rect x="150" y="112" width="66" height="34" rx="5" fill="#1c1917" stroke="#f97316" strokeWidth="1.5" />
                    <rect x="155" y="117" width="34" height="18" rx="2" fill="#020617" />
                    <circle cx="203" cy="126" r="7" fill="#dc2626" stroke="#fecaca" strokeWidth="0.8" />
                    <text x="203" y="128" fontSize="5" textAnchor="middle" fill="#fff" fontWeight="bold">⚡</text>
                    <text x="172" y="142" fontSize="5.5" textAnchor="middle" fill="#fdba74" fontWeight="bold">DEFIB</text>
                </g>}

                {/* CPR: hands on the lower sternum, or a LUCAS over the chest */}
                {a.lucas && <g data-part="lucas"><path d="M64 98 L64 70 Q95 56 126 70 L126 98" stroke="#fbbf24" strokeWidth="4" fill="none" /><rect x="87" y="62" width="16" height="10" rx="2" fill="#fbbf24" /><circle cx="95" cy="84" r="5" fill="#fde68a" stroke="#b45309"><animate attributeName="r" values="5;3.5;5" dur="0.55s" repeatCount="indefinite" /></circle></g>}
                {a.cpr && !a.lucas && <g data-part="cpr">
                    <g><animateTransform attributeName="transform" type="translate" values="0 0;0 3;0 0" dur="0.55s" repeatCount="indefinite" />
                        <ellipse cx="95" cy="86" rx="9" ry="6" fill="#fcd34d" stroke="#b45309" strokeWidth="0.8" /><ellipse cx="95" cy="84" rx="8" ry="5" fill="#fde68a" stroke="#b45309" strokeWidth="0.8" />
                    </g>
                </g>}

                {/* ECG: right arm (red), left arm (yellow), left leg (green), leads to the monitor */}
                {a.sensors.ecg && <g data-part="ecg">
                    <path d="M79 66 C100 52 130 60 150 70 M111 66 C125 62 138 64 150 72 M112 110 C130 104 140 90 150 76" stroke="#e2e8f0" {...cable} />
                    {[[79, 66, '#ef4444'], [111, 66, '#facc15'], [112, 110, '#22c55e']].map(([x, y, c]) => <g key={c}><circle cx={x} cy={y} r="4.2" fill="#f8fafc" stroke="#94a3b8" strokeWidth="0.6" /><circle cx={x} cy={y} r="2.2" fill={c} /></g>)}
                </g>}
                {/* defib / pacing pads: right of the upper sternum and the left side, cables to the defib */}
                {a.pads && <g data-part="pads">
                    <path d="M80 70 C110 48 140 110 150 122 M124 98 C134 104 142 116 150 128" stroke="#f97316" {...cable} strokeWidth="1.4" />
                    <rect x="73" y="65" width="15" height="19" rx="3" fill="#fb923c" stroke="#9a3412" strokeWidth="0.8" transform="rotate(-12 80 74)" />
                    <rect x="114" y="88" width="13" height="20" rx="3" fill="#fb923c" stroke="#9a3412" strokeWidth="0.8" transform="rotate(10 120 98)" />
                </g>}
                {/* NIBP cuff on the right upper arm, its tube to the monitor */}
                {a.sensors.nibp && <g data-part="nibp">
                    <path d="M57 80 C44 76 44 10 60 6 C80 1 120 1 136 6 C148 12 146 50 152 60" stroke="#64748b" {...cable} strokeWidth="1.6" />
                    <rect x="56" y="72" width="14" height="17" rx="3" fill="#1d4ed8" stroke="#93c5fd" strokeWidth="0.8" transform="rotate(14 63 80)" />
                    <path d="M58 78 h10 M58 83 h10" stroke="#93c5fd" strokeWidth="0.6" transform="rotate(14 63 80)" />
                </g>}
                {/* IV cannula in the right forearm, the giving set up to the drip */}
                {a.iv && <g data-part="iv">
                    <path d="M24 36 C24 70 46 100 60 108" stroke="#7dd3fc" {...cable} />
                    <rect x="56" y="103" width="10" height="8" rx="1.5" fill="#f8fafc" fillOpacity="0.85" transform="rotate(-20 61 107)" />
                    <rect x="59" y="105" width="5" height="4" rx="1" fill="#22d3ee" transform="rotate(-20 61 107)" />
                </g>}
                {/* arterial line in the left radial artery, the transducer line to the pressure bag */}
                {a.sensors.art && <g data-part="art">
                    <path d="M128 122 C150 150 30 170 14 57" stroke="#ef4444" {...cable} opacity="0.7" />
                    <rect x="124" y="118" width="9" height="7" rx="1.5" fill="#f8fafc" /><circle cx="128.5" cy="121.5" r="2" fill="#dc2626" />
                </g>}
                {/* SpO2 probe on a left finger, its cable to the monitor */}
                {a.sensors.spo2 && <g data-part="spo2">
                    <path d="M131 140 C140 140 140 110 150 92" stroke="#94a3b8" {...cable} />
                    <rect x="125" y="134" width="10" height="8" rx="2.5" fill="#dc2626" stroke="#7f1d1d" strokeWidth="0.6" /><circle cx="130" cy="138" r="1.4" fill="#fecaca"><animate attributeName="opacity" values="1;0.3;1" dur="0.9s" repeatCount="indefinite" /></circle>
                </g>}
                {/* temperature probe at the left ear */}
                {a.sensors.temp && <g data-part="temp"><path d="M111 31 C126 30 138 50 150 62" stroke="#fb923c" {...cable} /><circle cx="110.5" cy="31" r="2.2" fill="#fb923c" /></g>}
                {/* central line in the right internal jugular */}
                {a.cvc && <g data-part="cvc"><path d="M88 52 l-6 -3 M88 52 l-7 0 M88 52 l-6 3" stroke="#a78bfa" strokeWidth="1.4" /><rect x="85.5" y="49" width="5" height="6" rx="1" fill="#c4b5fd" /></g>}
                {/* chest drain on the left side, to its bottle */}
                {a.drain && <g data-part="drain"><path d="M122 92 C140 100 136 150 144 170" stroke="#cbd5e1" strokeWidth="1.8" fill="none" /><rect x="138" y="168" width="14" height="20" rx="2" fill="#e2e8f0" fillOpacity="0.4" stroke="#cbd5e1" /><rect x="138" y="180" width="14" height="8" fill="#ef4444" fillOpacity="0.5" /></g>}
                {/* urinary catheter, to the bag hanging off the trolley */}
                {a.catheter && <g data-part="catheter"><path d="M95 130 C96 160 60 170 40 178" stroke="#fde047" strokeWidth="1.4" fill="none" /><rect x="28" y="172" width="16" height="20" rx="3" fill="#fde047" fillOpacity="0.45" stroke="#facc15" /></g>}

                {/* the airway */}
                {(a.niv || a.oxygen || (a.bagging && !a.tube)) && !a.tube && <g data-part="mask">
                    {a.niv && <path d="M80 31 Q78 24 81 22 M110 31 Q112 24 109 22" stroke="#64748b" strokeWidth="2" fill="none" />}
                    <path d={a.niv ? 'M86 26 Q95 20 104 26 L105 41 Q95 49 85 41 Z' : 'M87 32 Q95 28 103 32 L103 41 Q95 47 87 41 Z'} fill={a.niv ? '#bae6fd' : a.bagging ? '#f1f5f9' : '#bbf7d0'} fillOpacity="0.55" stroke={a.niv ? '#38bdf8' : a.bagging ? '#94a3b8' : '#22c55e'} strokeWidth="1.2" />
                    {a.oxygen && !a.niv && !a.bagging && <path d="M103 40 C120 46 120 10 150 4" stroke="#22c55e" {...cable} />}
                </g>}
                {a.tube && <g data-part="tube">
                    {a.tube !== 'fona' && <path d="M82 38 Q95 44 108 38" stroke="#f8fafc" strokeWidth="1.2" fill="none" opacity="0.8" />}
                    {a.tube === 'sga'
                        ? <rect x="91" y={ay - 5} width="8" height="9" rx="2" fill="#4ade80" stroke="#166534" strokeWidth="0.8" />
                        : <circle cx={ax} cy={ay} r="2.6" fill="#f8fafc" stroke="#0ea5e9" strokeWidth="1" />}
                    <path d={`M${ax} ${ay} C${ax + 6} ${ay - 2} ${ax + 10} ${ay - 4} ${ax + 15} ${ay - 6}`} stroke="#e2e8f0" strokeWidth="2.6" fill="none" />
                </g>}
                {/* the ventilator circuit, or the bag */}
                {(a.tube || a.niv || (a.vent && a.ventilating)) && a.vent && !a.bagging && <path data-part="circuit"
                    d={`M${ax + 15} ${(a.tube ? ay - 6 : 36)} C${ax + 30} ${(a.tube ? ay - 14 : 30)} ${ax + 40} 30 150 28`}
                    stroke="#cbd5e1" strokeWidth="4" strokeDasharray="1.6 1.2" fill="none" opacity="0.9" />}
                {a.bagging && <g data-part="bag">
                    <path d={`M${a.tube ? ax + 15 : 103} ${a.tube ? ay - 6 : 37} C120 30 124 22 128 18`} stroke="#94a3b8" strokeWidth="3" fill="none" />
                    <ellipse cx="136" cy="14" rx="12" ry="8" fill="#38bdf8" fillOpacity="0.45" stroke="#0284c7" strokeWidth="1.2"><animate attributeName="rx" values="12;9;12" dur="5s" repeatCount="indefinite" /></ellipse>
                </g>}
                {/* capnography: the adaptor on the airway and its sampling line to the monitor */}
                {a.sensors.etco2 && <g data-part="etco2">
                    <path d={`M${a.tube ? ax + 14 : 104} ${a.tube ? ay - 5 : 40} C130 50 140 56 150 66`} stroke="#facc15" {...cable} />
                    <rect x={a.tube ? ax + 9 : 99} y={a.tube ? ay - 11 : 34} width="12" height="7" rx="1.5" fill="#facc15" stroke="#854d0e" strokeWidth="0.5" />
                    <text x={a.tube ? ax + 15 : 105} y={a.tube ? ay - 6 : 39} fontSize="4.5" textAnchor="middle" fill="#000" fontWeight="bold">CO2</text>
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
    const PatientStatusPanel = ({ sim, addLogEntry, showVent = true, extra = null }) => {
        const state = sim.state;
        const a = assess(state);
        const VP = window.VENT_PROFILES;
        // Compact (headline, flags and a one-line summary) or full (with the figure). With no saved choice,
        // a short screen (or a narrow one, such as a portrait tablet) starts compact so the obs and resus
        // controls below keep their room.
        const [collapsed, setCollapsed] = useState(() => {
            let saved = null;
            try { saved = localStorage.getItem('wmebem_status_collapsed'); } catch (e) {}
            return saved === '1' || saved === '0' ? saved === '1' : ((window.innerHeight || 1000) < 900 || (window.innerWidth || 1440) < 1024);
        });
        // The ventilator chooser only where a ventilator is in play: a ventilator or anaesthetic scenario,
        // one chosen in the Ventilator section, or a ventilator tablet already linked.
        const ventInPlay = !!(state.vent || (state.scenario && state.scenario.ventSim) || Object.keys(state.ventMirror || {}).length);
        const toggle = () => { const n = !collapsed; setCollapsed(n); try { localStorage.setItem('wmebem_status_collapsed', n ? '1' : '0'); } catch (e) {} };
        const log = addLogEntry || sim.addLogEntry;
        const model = a.model;
        const ventShown = !!state.ventPanelOpen;
        const setModel = (m) => {
            if (!VP || m === model) return;
            // A different machine starts switched off, so ask before taking the patient off a working one.
            if (a.vent && a.vent.state === 'ventilating' && !window.confirm(`Change to the ${VP.MODELS[m]}? The tablet reloads on the new machine switched off, so the patient stops being ventilated.`)) return;
            sim.dispatch({ type: 'SET_VENT_CONFIG', payload: { model: m } });
            log(`Ventilator changed to the ${VP.MODELS[m]} (facilitator)`, 'system');
        };
        const toggleVentShown = () => {
            sim.dispatch({ type: 'SET_VENT_PANEL', payload: !ventShown });
            log(ventShown ? 'Ventilator taken off the patient screens (facilitator)' : 'Ventilator shown on the patient screens (facilitator)', 'system');
        };
        // ONE-TAP RESUS during a pulseless rhythm, beside the CPR flag: the same actions as the
        // CPR button on the controller's defib panel (sim.toggleCPR, which logs "CPR started
        // (facilitator)") and its Defib button (SET_DEFIB_PANEL), so they log identically.
        const cprOn = !!state.cprInProgress;
        const defibOpen = !!state.defibPanelOpen;
        const toggleDefib = () => {
            sim.dispatch({ type: 'SET_DEFIB_PANEL', payload: !defibOpen });
            // Bring the controller's own defib controls (charge, shock) into view as well.
            if (!defibOpen) setTimeout(() => { try { const el = document.querySelector('[data-testid="defib-panel"]'); if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {} }, 80);
        };
        const resusButtons = a.arrest ? (
            <span className="inline-flex gap-1 flex-none" data-testid="status-resus">
                <button type="button" data-testid="status-cpr" onClick={() => sim.toggleCPR && sim.toggleCPR()} aria-pressed={cprOn}
                        title={cprOn ? 'Stop chest compressions (logged)' : 'Start chest compressions (logged)'}
                        className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wide ${cprOn ? 'bg-slate-900 border-red-400 text-red-200 hover:bg-red-950' : 'bg-red-600 border-red-300 text-white hover:bg-red-500'}`}>
                    {cprOn ? 'Stop CPR' : 'Start CPR'}
                </button>
                <button type="button" data-testid="status-defib" onClick={toggleDefib} aria-pressed={defibOpen}
                        title="Opens the defibrillator on the student monitor and the controller (the same as the Defib button under Rhythm & resus)."
                        className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wide ${defibOpen ? 'bg-amber-900/60 border-amber-400 text-amber-200' : 'bg-amber-500 border-amber-300 text-black hover:bg-amber-400'}`}>
                    {defibOpen ? 'Close Defib' : 'Defib'}
                </button>
            </span>
        ) : null;
        // The flags, with the resus buttons straight after the CPR flag ("No CPR running").
        const cprAt = a.flags.findIndex(f => /CPR/.test(f.text));
        const flagChips = (
            <>
                {a.flags.map((f, i) => (
                    <React.Fragment key={i}>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${CHIP[f.level] || CHIP.slate}`}>{f.text}</span>
                        {i === cprAt && resusButtons}
                    </React.Fragment>
                ))}
                {cprAt === -1 && resusButtons}
            </>
        );
        const row = (label, items, empty) => (
            <div className="flex gap-1.5 items-baseline min-w-0">
                <span className="text-[9px] uppercase font-bold text-slate-400 w-[4.6rem] flex-none">{label}</span>
                <span className={`text-[11px] truncate ${items.length ? 'text-white' : 'text-slate-300 italic'}`}>{items.length ? items.join(' · ') : empty}</span>
            </div>
        );

        return (
            <section aria-label="Patient status" data-testid="patient-status" className={`flex-none mb-2 rounded border-l-4 border ${TONE[a.tone] || TONE.slate}`}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1">
                    <span className={`flex-none w-2.5 h-2.5 rounded-full ${a.tone === 'red' ? 'bg-red-500 animate-pulse' : a.tone === 'amber' ? 'bg-amber-400' : a.tone === 'cyan' ? 'bg-cyan-400' : 'bg-emerald-400'}`} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                        <span className="text-[9px] uppercase tracking-widest font-bold text-slate-400 mr-2">Patient now</span>
                        <span data-testid="patient-headline" className="text-sm md:text-base font-bold">{a.headline}</span>
                    </div>
                    {/* The "Screens show: Monitor | Defib | Ventilator" switch (data/screens/screenspanel.js). */}
                    {extra}
                    <button type="button" onClick={toggle} aria-expanded={!collapsed} title={collapsed ? 'Show the patient figure and details' : 'Make this strip one line'} className="flex-none text-[10px] uppercase font-bold px-2 py-0.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-700">
                        {collapsed ? 'More' : 'Less'}
                    </button>
                </div>
                {collapsed && (
                    <div className="flex flex-wrap items-center gap-1 px-2 pb-1" data-testid="patient-compact">
                        {flagChips}
                        <span className="text-[11px] text-slate-300 truncate min-w-0">
                            {[a.monitors.length ? a.monitors.join(' · ') : 'Nothing attached', a.access.length ? a.access.join(' · ') : 'No access', a.airway || 'Own airway'].join('  |  ')}
                        </span>
                    </div>
                )}
                {!collapsed && (
                    <div className="flex flex-wrap md:flex-nowrap gap-3 px-2 pb-2 items-start">
                        <PatientFigure a={a} className="w-44 h-40 md:w-52 md:h-48 flex-none bg-slate-950/70 rounded-lg" />
                        <div className="min-w-0 flex-1 flex flex-col gap-1">
                            {(a.flags.length > 0 || resusButtons) && (
                                <div className="flex flex-wrap items-center gap-1" data-testid="patient-flags">
                                    {flagChips}
                                </div>
                            )}
                            {row('Monitoring', a.monitors, 'Nothing attached')}
                            {row('Access', a.access, 'None')}
                            {row('Airway', a.airway ? [a.airway] : [], 'Own airway')}
                            {a.other.length > 0 && row('Also', a.other, '')}
                        </div>
                        {VP && showVent && ventInPlay && (
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
                                <span className="text-[10px] text-slate-400">{a.vent ? `${a.modelName}: ${a.ventilating ? 'ventilating' : a.vent.state === 'ventilating' ? a.ventWhy : a.vent.state}` : 'Not connected'}</span>
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
