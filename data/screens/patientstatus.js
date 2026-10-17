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
// Everything is derived from the engine state the controller already has (only "Show on monitor"
// sends anything: the picture, in monitorPopup). The thresholds are NEWS2's red scores for adults and approximate ranges for children; they
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
        // The modelled ICP, in scenarios that have one (neuro deterioration). It answers to
        // osmotherapy and to a tube with normocapnia, so the facilitator can watch it come down.
        const detType = s.scenario && s.scenario.deterioration ? String(s.scenario.deterioration.type || '').toLowerCase() : '';
        const icp = num(s.icp);
        if (/^neuro/.test(detType) && icp !== null) flag(`ICP ~${Math.round(icp)} mmHg (model)`, icp > 25 ? 'red' : icp > 20 ? 'amber' : 'slate');

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
        // Fluids running through it: an infusion, or a bolus of fluid or blood still going in (until its peak).
        const t = num(s.time) || 0;
        const fluids = (access.length > 0 || has(act, 'FluidInfusion')) && (has(act, 'FluidInfusion') || (s.activeDrugs || []).some(d => d && ['Fluids', 'Blood', 'Albumin'].indexOf(d.key) !== -1
            && t >= Number(d.startTime) && t - Number(d.startTime) < (Number(d.peak) || 600) && !(Number(d.stopTime) >= 0)));
        if (fluids) access.push('IV fluids running');
        const airway = tube === 'ett' ? 'Tracheal tube' : tube === 'fona' ? 'Front-of-neck airway' : tube === 'sga' ? 'Supraglottic airway (i-gel)'
            : niv ? `${niv} mask` : bagging ? 'Bag-valve-mask' : oxygen ? 'Oxygen mask' : adjunct ? adjunct : null;
        const other = [];
        if (has(act, 'PacingPads')) other.push('Pads');
        if (has(act, 'Catheter')) other.push('Catheter');
        if (['SeldingerDrain', 'SurgicalDrain', 'FingerThoracostomy'].some(k => has(act, k))) other.push('Chest drain');
        if (has(act, 'Lucas')) other.push('LUCAS');
        // The injuries (from the scenario's words, or the facilitator's list) and the kit on them.
        const INJ = window.Injuries;
        const injuries = INJ ? INJ.forScenario(s.scenario) : [];
        const kit = INJ ? INJ.kitPlan(injuries, k => has(act, k)) : [];
        kit.forEach(k => { if (other.indexOf(k.name) === -1) other.push(k.name); });

        return {
            arrest, apnoeic, paralysed, headline, tone, flags, sensors, tube, bagging, niv, oxygen, adjunct,
            vent, ventilating, ventWhy, manual, highFlow, model, modelName, monitors, access, airway, other,
            cpr: !!s.cprInProgress, lucas: has(act, 'Lucas'), pads: has(act, 'PacingPads'), catheter: has(act, 'Catheter'),
            drain: ['SeldingerDrain', 'SurgicalDrain', 'FingerThoracostomy'].some(k => has(act, k)),
            iv: has(act, 'IV Access') || has(act, 'IO Access'), cvc: has(act, 'CVC'), fluids,
            cyanosed: !arrest && spo2 !== null && spo2 < 88,
            eyesClosed: arrest || paralysed || !!tube || (gcs !== null && gcs <= 8),
            distressed: flags.some(f => /^Distressed/.test(f.text)),
            sex: s.scenario && s.scenario.sex === 'Female' ? 'Female' : 'Male', age,
            injuries, kit
        };
    }

    // ---- the patient picture ------------------------------------------------------------------
    // The patient lying on a trolley, seen from above with the head at the top (so the patient's right
    // side is on the left of the picture), with every piece of kit drawn where it really goes and its
    // cable or tubing running to the monitor, the ventilator, the defib or the drip stand.
    const PatientFigure = ({ a, className }) => {
        const tint = a.arrest ? 'ps-arrest' : a.cyanosed ? 'ps-cyan' : null;
        const ventCol = a.ventilating ? '#22d3ee' : '#f59e0b';
        const anyMon = a.sensors.ecg || a.sensors.spo2 || a.sensors.nibp || a.sensors.temp || a.sensors.etco2 || a.sensors.art;
        const label = [a.headline,
            a.monitors.length ? 'Monitoring: ' + a.monitors.join(', ') : 'No monitoring attached',
            a.access.length ? 'Access: ' + a.access.join(', ') : 'No IV access',
            a.airway ? 'Airway: ' + a.airway : null,
            a.vent ? `Ventilator: ${a.modelName}, ${a.vent.state}` : null,
            a.other.length ? a.other.join(', ') : null,
            a.injuries.length && window.Injuries ? 'Injuries: ' + a.injuries.map(window.Injuries.label).join(', ') : null].filter(Boolean).join('. ');
        const INJ = window.Injuries, BA = window.BodyArt;
        const pregnant = a.injuries.some(i => i.kind === 'pregnant');
        // The body: the man, the woman, the pregnant woman, or the child (smaller the younger), from
        // the artwork in images/patient/ (data/screens/bodyart.js).
        const F = BA ? BA.frame(BA.pick(a.sex, a.age, pregnant)) : null;
        const g = INJ && F ? INJ.geometry(a.injuries, F) : null;
        const S = INJ ? INJ.Sprite : null;
        const breathing = !a.apnoeic && !a.ventilating && !a.bagging;
        const chestMoves = !a.arrest && (breathing || a.ventilating || a.bagging);
        const breathDur = a.ventilating || a.bagging ? '4.5s' : a.distressed ? '1.6s' : '3.6s';
        // where the airway leaves the patient: the mouth, or the front of the neck
        const ax = 95, ay = a.tube === 'fona' ? 54 : 41;
        const cable = { fill: 'none', strokeWidth: 1.1, strokeLinecap: 'round', opacity: 0.85 };
        // Kit on the arms follows the arm (and moves to the other arm when one is missing).
        const armOK = (s, n) => g && g[s].arm.cut > n;
        const nibpSide = armOK('R', 2) ? 'R' : 'L', ivSide = armOK('R', 3) ? 'R' : 'L';
        const artSide = armOK('L', 4) ? 'L' : 'R', spo2Side = armOK('L', 4) ? 'L' : armOK('R', 4) ? 'R' : null;
        const at = (s, i) => g[s].arm.pts[i];
        const mid = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
        const z = g ? g.z : 1;
        const trolley = BA ? BA.place(BA.frame(BA.pick('Male', null, false)), BA.TROLLEY) : null;
        return (
            <svg viewBox="0 0 220 250" role="img" aria-label={label} data-testid="patient-figure" className={className}>
                <title>{label}</title>
                <defs>
                    {/* cyanosed: blue-grey; in arrest: grey and pale */}
                    <filter id="ps-cyan" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values="0.6 0.15 0.1 0 0  0.1 0.7 0.15 0 0  0.15 0.2 0.85 0 0.06  0 0 0 1 0" /></filter>
                    <filter id="ps-arrest" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values="0.42 0.36 0.14 0 0.04  0.4 0.38 0.14 0 0.04  0.4 0.36 0.2 0 0.06  0 0 0 1 0" /></filter>
                </defs>

                {/* the trolley, its mattress and the pillow */}
                {trolley ? <image href="images/patient/body/trolley.webp" {...trolley} preserveAspectRatio="none" />
                    : <rect x="52" y="3" width="86" height="244" rx="12" fill="#1e293b" stroke="#475569" strokeWidth="1.5" />}

                {/* the drip stand, while IV fluids are running */}
                {a.fluids && <g data-part="drip">{S ? <S name="drip" c={[24, 25]} w={28} /> : <line x1="24" y1="6" x2="24" y2="70" stroke="#94a3b8" strokeWidth="1.5" />}</g>}
                {/* the arterial line's pressure bag and transducer */}
                {a.sensors.art && <g data-part="artbag"><rect x="9" y="46" width="11" height="15" rx="3" fill="#fecaca" stroke="#ef4444" /><text x="14.5" y="56" fontSize="5" textAnchor="middle" fill="#7f1d1d" fontWeight="bold">300</text></g>}

                {/* the patient, then the injuries and the kit on them (data/screens/injuries.js) */}
                {g && <INJ.Body g={g} eyesClosed={a.eyesClosed} breathe={chestMoves} breathDur={breathDur} tint={tint} />}
                {g && <INJ.InjuryLayer list={a.injuries} g={g} />}
                {g && <INJ.KitLayer kit={a.kit} list={a.injuries} g={g} />}

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

                {/* Kit on the arms, placed by the arm's own joints */}
                {/* NIBP cuff on the upper arm, its tube to the monitor */}
                {g && a.sensors.nibp && (() => {
                    const p = at(nibpSide, 1);
                    return <g data-part="nibp">
                        <path d={`M${p[0]} ${p[1] - 4} C${p[0] - 14} ${p[1] - 8} 44 10 60 6 C80 1 120 1 136 6 C148 12 146 50 152 60`} stroke="#64748b" {...cable} strokeWidth="1.6" />
                        <S name="cuff" c={p} w={12 * z} h={15 * z} rot={nibpSide === 'R' ? 8 : -8} />
                    </g>;
                })()}
                {/* IV cannula in the forearm, the giving set up to the drip */}
                {g && a.iv && (() => {
                    const p = at(ivSide, 3);
                    return <g data-part="iv">
                        {a.fluids && <path data-part="giving-set" d={`M20 44 C22 80 ${p[0] - 14} ${p[1] - 6} ${p[0]} ${p[1]}`} stroke="#7dd3fc" {...cable} />}
                        <S name="cannula" c={p} w={11 * z} rot={-70} />
                    </g>;
                })()}
                {/* arterial line in the radial artery, the transducer line to the pressure bag */}
                {g && a.sensors.art && (() => {
                    const p = mid(at(artSide, 3), at(artSide, 4), 0.8);
                    return <g data-part="art">
                        <path d={`M${p[0]} ${p[1]} C150 150 30 170 14 61`} stroke="#ef4444" {...cable} opacity="0.7" />
                        <S name="cannula" c={p} w={9 * z} rot={-110} /><circle cx={p[0]} cy={p[1]} r={1.6 * z} fill="#dc2626" />
                    </g>;
                })()}
                {/* SpO2 probe on a finger, its cable to the monitor (an ear probe if both hands are missing) */}
                {g && a.sensors.spo2 && (() => {
                    const p = spo2Side ? mid(at(spo2Side, 4), at(spo2Side, 5), 0.78) : g.T([110.5, 31]);
                    return <g data-part="spo2">
                        <path d={`M${p[0]} ${p[1]} C140 140 140 110 150 92`} stroke="#94a3b8" {...cable} />
                        <S name="spo2" c={p} w={11 * z} rot={spo2Side === 'R' ? 100 : 80} />
                        <circle cx={p[0]} cy={p[1]} r={1.2 * z} fill="#fecaca"><animate attributeName="opacity" values="1;0.3;1" dur="0.9s" repeatCount="indefinite" /></circle>
                    </g>;
                })()}

                {/* Kit on the head and trunk: placed for the adult man and moved onto this body */}
                <g transform={F ? F.matrix : undefined}>
                    {/* CPR: hands on the lower sternum, or a LUCAS over the chest */}
                    {a.lucas && <g data-part="lucas">{S && <S name="lucas" c={[95, 82]} w={60} />}<circle cx="95" cy="86" r="4" fill="#38bdf8" fillOpacity="0.5"><animate attributeName="r" values="4.5;3;4.5" dur="0.55s" repeatCount="indefinite" /></circle></g>}
                    {a.cpr && !a.lucas && <g data-part="cpr">
                        <g><animateTransform attributeName="transform" type="translate" values="0 0;0 3;0 0" dur="0.55s" repeatCount="indefinite" />
                            {S && <S name="cprhands" c={[95, 86]} w={17} />}
                        </g>
                    </g>}

                    {/* ECG: right arm (red), left arm (yellow), left leg (green), leads to the monitor */}
                    {a.sensors.ecg && <g data-part="ecg">
                        <path d="M77 66 C100 52 130 60 150 70 M113 66 C125 62 138 64 150 72 M112 112 C130 104 140 90 150 76" stroke="#e2e8f0" {...cable} />
                        {[[77, 66, '#ef4444'], [113, 66, '#facc15'], [112, 112, '#22c55e']].map(([x, y, c]) => <g key={c}>{S && <S name="electrode" c={[x, y]} w={8} />}<circle cx={x} cy={y} r="1.3" fill={c} /></g>)}
                    </g>}
                    {/* defib / pacing pads: right of the upper sternum and the left side, cables to the defib */}
                    {a.pads && <g data-part="pads">
                        <path d="M84 70 C110 48 140 110 150 122 M124 98 C134 104 142 116 150 128" stroke="#f97316" {...cable} strokeWidth="1.4" />
                        {[[80, 75, -12], [120, 99, 10]].map(([x, y, r]) => <g key={x} transform={`rotate(${r} ${x} ${y})`}>
                            <rect x={x - 7.5} y={y - 9.5} width="15" height="19" rx="3" fill="#f8fafc" stroke="#94a3b8" strokeWidth="0.8" />
                            <rect x={x - 5.5} y={y - 7.5} width="11" height="15" rx="2" fill="#e2e8f0" stroke="#cbd5e1" strokeWidth="0.5" />
                            <rect x={x - 2} y={y - 11} width="4" height="3" rx="1" fill="#f97316" />
                        </g>)}
                    </g>}
                    {/* temperature probe at the left ear */}
                    {a.sensors.temp && <g data-part="temp"><path d="M111 31 C126 30 138 50 150 62" stroke="#fb923c" {...cable} /><circle cx="110.5" cy="31" r="2" fill="#fb923c" /></g>}
                    {/* central line in the right internal jugular */}
                    {a.cvc && <g data-part="cvc">{S && <S name="cvc" c={[86, 54]} w={11} rot={-25} />}</g>}
                    {/* chest drain on the left side, to its bottle */}
                    {a.drain && <g data-part="drain"><path d="M121 92 C140 100 136 150 142 166" stroke="#cbd5e1" strokeWidth="1.6" fill="none" />{S && <S name="drain" c={[145, 178]} w={18} />}<circle cx="121" cy="92" r="1.6" fill="#f8fafc" /></g>}
                    {/* urinary catheter, to the bag hanging off the trolley */}
                    {a.catheter && <g data-part="catheter"><path d="M95 136 C96 160 60 170 46 176" stroke="#fde047" strokeWidth="1.3" fill="none" />{S && <S name="catheter" c={[36, 184]} w={22} />}</g>}

                    {/* the airway */}
                    {a.adjunct === 'OPA' && !a.tube && !a.niv && !a.oxygen && !a.bagging && <g data-part="opa">{S && <S name="guedel" c={[95, 40]} w={6} />}</g>}
                    {(a.niv || a.oxygen) && !a.tube && !a.bagging && <g data-part="mask">
                        {a.niv
                            ? <><path d="M80 31 Q78 24 81 22 M110 31 Q112 24 109 22" stroke="#64748b" strokeWidth="2" fill="none" />
                                <path d="M86 26 Q95 20 104 26 L105 41 Q95 49 85 41 Z" fill="#bae6fd" fillOpacity="0.55" stroke="#38bdf8" strokeWidth="1.2" /></>
                            : <>{S && <S name="mask" c={[100, 40]} w={27} />}<path d="M106 46 C120 42 120 10 150 4" stroke="#22c55e" {...cable} /></>}
                    </g>}
                    {a.bagging && !a.tube && <g data-part="mask"><ellipse cx="95" cy="37" rx="8" ry="7" fill="#f1f5f9" fillOpacity="0.25" stroke="#94a3b8" strokeWidth="1" /></g>}
                    {a.tube && <g data-part="tube">
                        {a.tube !== 'fona' && <path d="M82 38 Q95 44 108 38" stroke="#f8fafc" strokeWidth="1.2" fill="none" opacity="0.8" />}
                        {S && (a.tube === 'sga' ? <S name="igel" c={[ax + 2, ay - 2]} w={10} rot={-30} /> : <S name="tube" c={[ax + 3, ay - 4]} w={10} rot={-20} />)}
                    </g>}
                    {/* the ventilator circuit, or the bag */}
                    {(a.tube || a.niv || (a.vent && a.ventilating)) && a.vent && !a.bagging && <path data-part="circuit"
                        d={`M${ax + 8} ${(a.tube ? ay - 10 : 36)} C${ax + 30} ${(a.tube ? ay - 16 : 30)} ${ax + 40} 30 150 28`}
                        stroke="#cbd5e1" strokeWidth="4" strokeDasharray="1.6 1.2" fill="none" opacity="0.9" />}
                    {a.bagging && <g data-part="bag">
                        {S && (a.tube ? <S name="bvm" c={[121, 26]} w={38} rot={-25} flip /> : <S name="bvm" c={[113, 32]} w={44} rot={-10} flip />)}
                    </g>}
                    {/* capnography: the adaptor on the airway and its sampling line to the monitor */}
                    {a.sensors.etco2 && <g data-part="etco2">
                        <path d={`M${a.tube ? ax + 14 : 104} ${a.tube ? ay - 5 : 40} C130 50 140 56 150 66`} stroke="#facc15" {...cable} />
                        <rect x={a.tube ? ax + 9 : 99} y={a.tube ? ay - 11 : 34} width="12" height="7" rx="1.5" fill="#facc15" stroke="#854d0e" strokeWidth="0.5" />
                        <text x={a.tube ? ax + 15 : 105} y={a.tube ? ay - 6 : 39} fontSize="4.5" textAnchor="middle" fill="#000" fontWeight="bold">CO2</text>
                    </g>}
                </g>
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

    // ---- the picture on the patient monitor --------------------------------------------------
    // "Show on monitor" puts the picture on every patient screen that has a monitor, for the team to
    // see (a handover, or a guide to the moulage). It rides in monitorPopup like a result, so the
    // database rules are unchanged: the injuries, sex and age go with it, and the monitor draws the
    // kit, colour and breathing from its own synced state, so they stay live. A result sent later
    // replaces it, as one result replaces another.
    const PICTURE = 'Patient picture';
    const pictureOf = (state) => {
        const INJ = window.Injuries, sc = state.scenario || {};
        const injuries = INJ ? INJ.forScenario(sc).map(i => ({ region: i.region, kind: i.kind, side: i.side || null, open: !!i.open })) : [];
        return { injuries, sex: sc.sex === 'Female' ? 'Female' : 'Male', age: num(sc.patientAge) };
    };
    const pictureShown = (state) => !!(state.monitorPopup && state.monitorPopup.type === PICTURE && state.monitorPopup.picture);
    const usePictureOnMonitor = (sim, log) => {
        const state = sim.state;
        const shown = pictureShown(state);
        const now = JSON.stringify(pictureOf(state));
        // Keep the monitor's copy up to date while it is showing (an injury added, a different patient).
        React.useEffect(() => {
            if (shown && JSON.stringify(state.monitorPopup.picture) !== now) sim.dispatch({ type: 'TRIGGER_POPUP', payload: { type: PICTURE, picture: JSON.parse(now) } });
        }, [shown, now]);
        const toggle = () => {
            if (shown) { sim.dispatch({ type: 'CLEAR_POPUP' }); log('Patient picture taken off the monitor (facilitator)', 'system'); }
            else { sim.dispatch({ type: 'TRIGGER_POPUP', payload: { type: PICTURE, picture: JSON.parse(now) } }); log('Patient picture shown on the monitor (facilitator)', 'system'); }
        };
        return { shown, toggle };
    };
    const PictureButton = ({ pic, className = '' }) => (
        <button type="button" onClick={pic.toggle} aria-pressed={pic.shown} data-testid="picture-on-monitor"
                title={pic.shown ? 'Take the patient picture off the patient monitor' : 'Show this picture on the patient monitor, for the team to see'}
                className={`flex-none text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${pic.shown ? 'bg-sky-900/50 border-sky-400 text-sky-100' : 'border-sky-600 text-sky-300 hover:bg-sky-900/40'} ${className}`}>
            {pic.shown ? 'Hide from monitor' : 'Show on monitor'}
        </button>
    );
    // The monitor's side (data/screens/monitor.js MonitorContainer): the picture over the whole screen.
    const MonitorPicture = ({ state }) => {
        if (!pictureShown(state)) return null;
        const p = state.monitorPopup.picture;
        const injuries = Array.isArray(p.injuries) ? p.injuries : Object.values(p.injuries || {});
        const a = assess({ ...state, scenario: { ...(state.scenario || {}), sex: p.sex, patientAge: p.age, injuries } });
        return (
            <div className="absolute inset-0 z-[80] bg-slate-950 flex flex-col items-center justify-center p-3 animate-fadeIn" data-testid="monitor-picture">
                <div className="text-slate-300 text-sm md:text-lg font-bold uppercase tracking-widest mb-2">The patient</div>
                <PatientFigure a={a} className="h-[82vh] max-w-full" />
            </div>
        );
    };

    // ---- setting the patient up before START -------------------------------------------------
    // Injuries and the kit already on the patient when the team arrives (tourniquets, a cannula, an
    // oxygen mask ...), in any mode. Kit put on here is not the team's action and does not change the
    // obs (sim.setUpIntervention, data/engine.js); the team can still take it off.
    const SETUP_KIT = [
        ['Obs', 'Monitoring'], ['IV Access', 'IV cannula'], ['Oxygen', 'Oxygen mask'], ['OPA', 'Guedel airway'], ['NPA', 'Nasal airway'],
        ['FluidInfusion', 'IV fluids running'], ['Collar', 'Collar'], ['HeadBlocks', 'Head blocks'], ['Scoop', 'Scoop stretcher'], ['PelvicBinder', 'Pelvic binder'], ['Tourniquet', 'Tourniquet'], ['WoundDressing', 'Dressings'], ['ChestSeal', 'Chest seal'],
        ['TractionSplint', 'Traction splint'], ['Splinting', 'Splint'], ['Plaster', 'Backslab'], ['ClingFilm', 'Cling film'],
        ['Catheter', 'Urinary catheter'], ['ArtLine', 'Arterial line'], ['CVC', 'Central line']
    ];
    const kitOn = (state, key) => key === 'Obs'
        ? !!(window.getSensors && window.getSensors(state).standard) || has(state.activeInterventions, 'Obs')
        : has(state.activeInterventions, key);
    const PatientSetup = ({ sim, addLogEntry, onClose }) => {
        const { Modal, Button, Lucide } = window;
        const INJ = window.Injuries, state = sim.state;
        const log = addLogEntry || sim.addLogEntry;
        const pic = usePictureOnMonitor(sim, log);
        if (!state.scenario) return null;
        const a = assess(state);
        const setInjuries = (next) => {
            const sc = { ...state.scenario };
            if (next) sc.injuries = next; else delete sc.injuries;
            sim.dispatch({ type: 'UPDATE_SCENARIO', payload: sc });
            const now = INJ ? INJ.forScenario(sc).map(INJ.label) : [];
            log(`Set-up: injuries ${now.length ? now.join(', ') : 'none'}`, 'system');
        };
        const kit = (key) => sim.setUpIntervention ? sim.setUpIntervention(key) : sim.applyIntervention(key);
        return (
            <Modal fixed label="Set up the patient" onClose={onClose}>
                <div className="bg-slate-800 p-4 rounded-lg border border-slate-600 w-full max-w-4xl shadow-2xl max-h-[92vh] overflow-y-auto" data-testid="patient-setup">
                    <div className="flex justify-between items-start mb-3 gap-2">
                        <div className="min-w-0">
                            <h3 className="text-lg font-bold text-white uppercase tracking-wider">Set up the patient</h3>
                            <p className="text-[11px] text-slate-400">Injuries, and what is already done when the team arrives. Kit put on here does not change the obs and is not marked as the team’s; they can still take it off.</p>
                        </div>
                        <button aria-label="Close" onClick={onClose} className="text-slate-400 hover:text-white flex-none"><Lucide icon="x" className="w-5 h-5" /></button>
                    </div>
                    <div className="flex flex-col md:flex-row gap-4">
                        <div className="flex-none flex flex-col items-center gap-2">
                            <PatientFigure a={a} className="w-56 h-64 bg-slate-950/70 rounded-lg" />
                            <PictureButton pic={pic} className="text-xs px-3 py-1" />
                        </div>
                        <div className="min-w-0 flex-1 flex flex-col">
                            <h4 className="text-xs font-bold uppercase text-slate-300 mb-1">Injuries</h4>
                            {INJ && <INJ.InjuryPicker scenario={state.scenario} onChange={setInjuries} />}
                        </div>
                        <div className="min-w-0 md:w-64 flex-none">
                            <h4 className="text-xs font-bold uppercase text-slate-300 mb-1">Already done</h4>
                            <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Already done when the team arrives">
                                {SETUP_KIT.map(([key, name]) => {
                                    const on = kitOn(state, key);
                                    return (
                                        <button key={key} type="button" onClick={() => kit(key)} aria-pressed={on} data-kit={key}
                                                className={`px-2 py-1.5 rounded border text-xs font-bold text-left ${on ? 'bg-emerald-800/60 border-emerald-400 text-white' : 'bg-slate-900 border-slate-600 text-slate-300 hover:border-emerald-500'}`}>
                                            {on ? '\u2713 ' : ''}{name}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                    <div className="border-t border-slate-700 pt-3 mt-3 flex justify-end gap-2">
                        {Array.isArray(state.scenario.injuries) && <Button onClick={() => setInjuries(null)} variant="secondary">Scenario's own injuries</Button>}
                        <Button onClick={onClose} variant="primary" className="px-6">Done</Button>
                    </div>
                </div>
            </Modal>
        );
    };

    // ---- the strip ------------------------------------------------------------------------------
    // `showScenario`: the scenario's summary and its "Full scenario" window (data/screens/scenarioview.js),
    // for library and course scenarios (not Quick Sim, which has no scenario).
    // `setUp`: a "Set up patient" button here until START (where the page has none of its own).
    const PatientStatusPanel = ({ sim, addLogEntry, showVent = true, extra = null, showScenario = false, setUp = false }) => {
        const state = sim.state;
        const a = assess(state);
        const [showFull, setShowFull] = useState(false);
        const [editInjuries, setEditInjuries] = useState(false);
        const SV = window.ScenarioView, INJ = window.Injuries;
        const withScenario = showScenario && !!SV && !!state.scenario;
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
        const pic = usePictureOnMonitor(sim, log);
        const [showSetup, setShowSetup] = useState(false);
        const notStarted = !state.isRunning && !state.isFinished && (state.pausedAt === null || state.pausedAt === undefined);
        const model = a.model;
        const ventShown = !!state.ventPanelOpen;
        const setModel = (m) => {
            if (!VP || m === model) return;
            // A different machine starts switched off, so ask before taking the patient off a working one.
            if (a.vent && a.vent.state === 'ventilating' && !window.confirm(`Change to the ${VP.MODELS[m]}? The tablet reloads on the new machine switched off, so the patient stops being ventilated.`)) return;
            sim.dispatch({ type: 'SET_VENT_CONFIG', payload: { model: m } });
            log(`Ventilator changed to the ${VP.MODELS[m]} (facilitator)`, 'system');
        };
        // The facilitator's own injury list (null: back to what the scenario's words say).
        const setInjuries = (next) => {
            const sc = { ...state.scenario };
            if (next) sc.injuries = next; else delete sc.injuries;
            sim.dispatch({ type: 'UPDATE_SCENARIO', payload: sc });
            const now = INJ ? INJ.forScenario(sc).map(INJ.label) : [];
            log(`Injuries on the patient picture: ${now.length ? now.join(', ') : 'none'}${next ? '' : ' (the scenario\u2019s own)'}`, 'system');
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
                        {/* On a phone a flag the headline already spells out is not repeated as a chip. */}
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${CHIP[f.level] || CHIP.slate} ${String(a.headline || '').includes(f.text) ? 'max-md:hidden' : ''}`}>{f.text}</span>
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
                    {/* The "Screens show: Monitor | Defib | Ventilator" switch (data/screens/screenspanel.js). On a
                        phone it takes its own full-width row under the headline, so the headline is not squeezed. */}
                    {extra && <div className="min-w-0 max-md:order-last max-md:w-full">{extra}</div>}
                    {withScenario && collapsed && (
                        <button type="button" onClick={() => setShowFull(true)} data-testid="open-full-scenario-compact" className="flex-none text-[10px] uppercase font-bold px-2 py-0.5 rounded border border-sky-500 text-sky-200 hover:bg-sky-900/40">
                            Full scenario
                        </button>
                    )}
                    {setUp && notStarted && state.scenario && (
                        <button type="button" onClick={() => setShowSetup(true)} aria-label="Set up the patient" className="flex-none text-[10px] uppercase font-bold px-2 py-0.5 rounded border border-amber-400 bg-amber-700 text-white hover:bg-amber-600">Set up patient</button>
                    )}
                    {state.scenario && <PictureButton pic={pic} />}
                    <button type="button" onClick={toggle} aria-expanded={!collapsed} title={collapsed ? 'Show the patient figure and details' : 'Make this strip one line'} className="flex-none text-[10px] uppercase font-bold px-2 py-0.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-700">
                        {collapsed ? 'More' : 'Less'}
                    </button>
                </div>
                {collapsed && (
                    <div className="flex flex-wrap items-center gap-1 px-2 pb-1" data-testid="patient-compact">
                        {withScenario && <span className="text-[11px] font-bold text-emerald-300 uppercase truncate max-w-[18rem]" title={state.scenario.title}>{state.scenario.title}</span>}
                        {flagChips}
                        <span className="text-[11px] text-slate-300 truncate min-w-0">
                            {[a.monitors.length ? a.monitors.join(' · ') : 'Nothing attached', a.access.length ? a.access.join(' · ') : 'No access', a.airway || 'Own airway'].join('  |  ')}
                        </span>
                    </div>
                )}
                {!collapsed && (
                    <div className="flex flex-wrap md:flex-nowrap gap-3 px-2 pb-2 items-start">
                        <PatientFigure a={a} className="w-40 h-44 md:w-44 md:h-48 flex-none bg-slate-950/70 rounded-lg" />
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
                            {INJ && (
                                <div className="flex gap-1.5 items-baseline min-w-0" data-testid="patient-injuries">
                                    <span className="text-[9px] uppercase font-bold text-slate-400 w-[4.6rem] flex-none">Injuries</span>
                                    <span className={`text-[11px] min-w-0 ${a.injuries.length ? 'text-white' : 'text-slate-300 italic'}`}>{a.injuries.length ? a.injuries.map(INJ.label).join(' \u00b7 ') : 'None'}</span>
                                    {state.scenario && <button type="button" onClick={() => setEditInjuries(true)} aria-label="Change the injuries on the patient picture" className="flex-none text-[9px] uppercase font-bold px-1.5 py-0.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-700">Change</button>}
                                </div>
                            )}
                        </div>
                        {withScenario && <SV.ScenarioSummary scenario={state.scenario} onOpen={() => setShowFull(true)} />}
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
                {showFull && SV && state.scenario && <SV.FullScenarioModal scenario={state.scenario} onClose={() => setShowFull(false)} />}
                {showSetup && <PatientSetup sim={sim} addLogEntry={log} onClose={() => setShowSetup(false)} />}
                {editInjuries && INJ && state.scenario && <INJ.InjuryEditor scenario={state.scenario} onChange={setInjuries} onClose={() => setEditInjuries(false)} />}
            </section>
        );
    };

    window.PatientStatus = { assess, limitsFor, PatientFigure, PatientStatusPanel, PatientSetup, MonitorPicture, usePictureOnMonitor, PictureButton };
})();
