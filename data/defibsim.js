// =================================================================================================
// DEFIB SIM — the defibrillator-training mode (formerly the standalone Defib-sim app).
//
// A Defib Sim session runs through the SAME engine, Firebase session and debrief as every other
// mode. This file only describes it: the built-in scenarios, the synthetic patient they load, the
// custom stepped scenarios a facilitator can build (stored in this browser), and the RCUK hint text
// the learner can open on the defib tablet in Education mode.
// Plain JS (no JSX) so the start screen, the controller AND defib/index.html can all load it.
// Exposes window.DefibSim.
// =================================================================================================
(function () {
    'use strict';

    // Arrest obs as the engine writes them (see arrestVitals in data/engine.js).
    var ARREST = { hr: 0, bpSys: 0, bpDia: 0, spO2: 0, rr: 0, gcs: 3, pupils: 'Dilated', etco2: 1.5 };

    // Built-in scenarios. `category` drives the debrief feedback (defibrillation / cardioversion /
    // pacing). shockToConvert applies when the shock response is "Auto"; pacingThreshold (mA) is
    // varied by up to 15 mA each time so learners have to titrate the output.
    var SCENARIOS = [
        { id: 'vf-arrest', name: 'Ventricular Fibrillation', group: 'Defibrillation (cardiac arrest)',
          description: 'Patient in cardiac arrest. Monitor shows coarse VF. No pulse, not breathing. Requires immediate defibrillation.',
          category: 'defibrillation', rhythm: 'VF', vitals: ARREST,
          successRhythm: 'Sinus Rhythm', successVitals: { hr: 82, spO2: 94, etco2: 4.7, bpSys: 110, bpDia: 70 },
          shockToConvert: 3, recommendedEnergy: 150 },
        { id: 'pulseless-vt', name: 'Pulseless VT', group: 'Defibrillation (cardiac arrest)',
          description: 'Patient in cardiac arrest. Monitor shows broad complex tachycardia. CONFIRM NO PULSE - this is a shockable arrest.',
          category: 'defibrillation', rhythm: 'pVT', vitals: ARREST,
          successRhythm: 'Sinus Rhythm', successVitals: { hr: 78, spO2: 93, etco2: 4.5, bpSys: 108, bpDia: 68 },
          shockToConvert: 3, recommendedEnergy: 150 },
        { id: 'unstable-vt', name: 'VT with a pulse (unstable)', group: 'Cardioversion (with a pulse)',
          description: 'Patient conscious but severely unwell. Broad complex tachycardia at 180/min. Pulse present. BP 82/48. Requires SYNCHRONISED cardioversion.',
          category: 'cardioversion', rhythm: 'VT', vitals: { hr: 180, spO2: 88, etco2: 3.7, bpSys: 82, bpDia: 48, rr: 24, gcs: 14 },
          successRhythm: 'Sinus Rhythm', successVitals: { hr: 76, spO2: 97, etco2: 4.8, bpSys: 118, bpDia: 74 },
          shockToConvert: 1, recommendedEnergy: 120, energyRange: [120, 150], energyAdvice: '120-150 J initial shock for VT with a pulse', requiresSync: true },
        { id: 'unstable-svt', name: 'SVT with life-threatening features', group: 'Cardioversion (with a pulse)',
          description: 'Patient with palpitations and chest pain. Narrow complex tachycardia at 190/min. BP 80/54. Requires SYNCHRONISED cardioversion.',
          category: 'cardioversion', rhythm: 'SVT', vitals: { hr: 190, spO2: 90, etco2: 3.5, bpSys: 80, bpDia: 54, rr: 22, gcs: 15 },
          successRhythm: 'Sinus Rhythm', successVitals: { hr: 74, spO2: 98, etco2: 4.8, bpSys: 120, bpDia: 76 },
          shockToConvert: 1, recommendedEnergy: 100, energyRange: [70, 120], energyAdvice: '70-120 J initial shock for SVT', requiresSync: true },
        { id: 'fast-af', name: 'Fast AF with life-threatening features', group: 'Cardioversion (with a pulse)',
          description: 'Patient with a fast irregular rhythm. Atrial fibrillation at 155/min. BP 82/48, pulmonary oedema developing. Requires SYNCHRONISED cardioversion.',
          category: 'cardioversion', rhythm: 'AF', vitals: { hr: 155, spO2: 88, etco2: 4.0, bpSys: 82, bpDia: 48, rr: 26, gcs: 15 },
          successRhythm: 'Sinus Rhythm', successVitals: { hr: 80, spO2: 96, etco2: 4.7, bpSys: 118, bpDia: 72 },
          shockToConvert: 1, recommendedEnergy: 200, energyRange: [200, 200], energyAdvice: 'maximum output (200 J on the R Series) for AF', requiresSync: true },
        { id: 'complete-hb', name: 'Complete heart block', group: 'Transcutaneous pacing',
          description: 'Patient syncopal and hypotensive. Complete dissociation between P waves and broad QRS complexes. HR 32/min. BP 86/50. High risk of asystole - atropine not recommended with a broad QRS. Requires transcutaneous pacing as a bridge to transvenous pacing.',
          category: 'pacing', rhythm: 'Complete Heart Block', vitals: { hr: 32, spO2: 92, etco2: 4.0, bpSys: 86, bpDia: 50, rr: 18, gcs: 14 },
          pacingThreshold: 60, requiresPacing: true },
        { id: 'symptomatic-brady', name: 'Symptomatic bradycardia', group: 'Transcutaneous pacing',
          description: 'Patient unwell with dizziness and hypotension. Junctional bradycardia at 38/min. BP 84/52. Failed atropine. Requires pacing.',
          category: 'pacing', rhythm: 'Junctional', vitals: { hr: 38, spO2: 93, etco2: 4.1, bpSys: 84, bpDia: 52, rr: 18, gcs: 15 },
          pacingThreshold: 60, requiresPacing: true }
    ];
    function byId(id) { for (var i = 0; i < SCENARIOS.length; i++) if (SCENARIOS[i].id === id) return SCENARIOS[i]; return null; }

    // What moves a custom scenario on to its next step.
    var TRIGGERS = {
        analyse: 'On Analyse (rhythm check)',
        shock: 'On successful shock',
        capture: 'On pacing capture',
        timer_30: 'Timer: 30 s',
        timer_60: 'Timer: 60 s',
        timer_120: 'Timer: 2 min'
    };
    // Files exported by the standalone Defib-sim used these names.
    var LEGACY_TRIGGERS = { manual: 'analyse', pacing: 'capture' };
    var MAX_STEPS = 5;

    function normaliseSteps(steps) {
        var RG = window.RHYTHMS;
        if (!Array.isArray(steps) || !steps.length || steps.length > 20) return null;
        var out = [];
        for (var i = 0; i < steps.length; i++) {
            var s = steps[i];
            if (!s || typeof s !== 'object') return null;
            var trig = LEGACY_TRIGGERS[s.trigger] || s.trigger;
            if (!Object.prototype.hasOwnProperty.call(TRIGGERS, trig)) return null;
            if (!RG || !RG.isKnown(s.rhythm)) return null;
            out.push({ rhythm: RG.canonical(s.rhythm), trigger: trig });
        }
        return out.slice(0, MAX_STEPS);
    }

    // ---- Custom scenarios saved in THIS browser (a per-device convenience, like Quick Sim presets).
    var STORE_KEY = 'wmebem.defibSim.custom.v1';
    function readSaved() {
        try {
            var raw = window.localStorage && window.localStorage.getItem(STORE_KEY);
            var obj = raw ? JSON.parse(raw) : {};
            return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
        } catch (e) { return {}; }
    }
    function writeSaved(obj) {
        try { window.localStorage.setItem(STORE_KEY, JSON.stringify(obj)); return true; } catch (e) { return false; }
    }
    function savedNames() { return Object.keys(readSaved()).sort(); }
    function loadSaved(name) {
        var all = readSaved();
        return Object.prototype.hasOwnProperty.call(all, name) ? normaliseSteps(all[name]) : null;
    }
    function save(name, steps) {
        var n = String(name || '').trim().slice(0, 60);
        var clean = normaliseSteps(steps);
        if (!n || n === '__proto__' || !clean) return false;
        var all = readSaved();
        all[n] = clean;
        return writeSaved(all);
    }
    function remove(name) {
        var all = readSaved();
        if (!Object.prototype.hasOwnProperty.call(all, name)) return false;
        delete all[name];
        return writeSaved(all);
    }
    // Accepts this app's export and the standalone Defib-sim's ({ app: 'defib-sim', steps }).
    function parseFile(text) {
        var data = JSON.parse(text);
        return normaliseSteps(Array.isArray(data) ? data : data && data.steps);
    }
    function exportText(steps) { return JSON.stringify({ app: 'wmebem-defib-sim', version: 1, steps: normaliseSteps(steps) || [] }, null, 2); }

    // ---- The patient a Defib Sim session loads. Built on Quick Sim's synthetic patient, so age,
    // weight, WETFLAG and paediatric energies work exactly as they do there.
    // opts: { scenario: id | 'free' | 'custom', mode: 'education' | 'assessment', steps (custom),
    //         age, weight, sex, name }
    function buildScenario(opts) {
        opts = opts || {};
        var RG = window.RHYTHMS;
        var sc = byId(opts.scenario);
        var steps = opts.scenario === 'custom' ? normaliseSteps(opts.steps) : null;
        if (opts.scenario === 'custom' && !steps) throw new Error('A custom scenario needs at least one valid step.');
        var rhythm = sc ? sc.rhythm : (steps ? steps[0].rhythm : 'Sinus Rhythm');
        var base = window.buildQuickSimScenario({ age: opts.age, weight: opts.weight, sex: opts.sex, name: opts.name || 'Defib Sim Patient', rhythm: rhythm, showWetflag: true });
        var vitals = Object.assign({}, base.vitals, sc ? sc.vitals : {});
        if (steps && RG.isPulseless(rhythm)) vitals = Object.assign({}, vitals, ARREST);
        var mode = opts.mode === 'assessment' ? 'assessment' : 'education';
        var title = sc ? sc.name : (steps ? 'Custom scenario' : 'Free play');
        var threshold = null;
        if (sc && sc.pacingThreshold) threshold = Math.max(30, sc.pacingThreshold + Math.floor(Math.random() * 31) - 15);
        var s = Object.assign({}, base, {
            id: 'DEFIB_' + (sc ? sc.id : (steps ? 'custom' : 'free')) + '_' + Date.now(),
            quickSim: false,
            title: 'Defib Sim: ' + title,
            category: 'Defib Sim',
            presentingComplaint: sc ? sc.description : (steps ? 'Custom stepped scenario' : 'Free play: the facilitator drives the rhythm'),
            profile: sc ? sc.description : base.profile,
            patientProfileTemplate: sc ? sc.description : base.patientProfileTemplate,
            acuity: 'Resus',
            vitalsMod: vitals,
            vitals: vitals,
            ecg: { type: RG.canonical(rhythm), findings: RG.labelFor(rhythm) },
            successRhythm: sc && sc.successRhythm ? sc.successRhythm : null,
            successVitals: sc && sc.successVitals ? sc.successVitals : null,
            shockToConvert: sc && sc.shockToConvert ? sc.shockToConvert : null,
            pacingThreshold: threshold || (opts.scenario === 'free' || !sc ? 60 : 70),
            // Defib Sim defaults (the standalone app's behaviour): fixed shock counts, an
            // unsynchronised shock into a perfusing rhythm always causes VF, no refibrillation.
            defibSettings: { shockResponse: 'auto', rOnT: 'always', refib: 'off' },
            defibSim: {
                scenario: sc ? sc.id : (steps ? 'custom' : 'free'),
                name: title,
                description: sc ? sc.description : '',
                mode: mode,
                category: sc ? sc.category : null,
                recommendedEnergy: sc && sc.recommendedEnergy ? sc.recommendedEnergy : null,
                energyRange: sc && sc.energyRange ? sc.energyRange : null,
                energyAdvice: sc && sc.energyAdvice ? sc.energyAdvice : null,
                requiresSync: !!(sc && sc.requiresSync),
                requiresPacing: !!(sc && sc.requiresPacing),
                steps: steps || []
            }
        });
        return s;
    }

    // RCUK guideline hints (Adult ALS Guidelines Oct 2025; adult ALS, bradyarrhythmia (2025) and
    // tachyarrhythmia (V3, March 2026) algorithms), carried over from the standalone Defib-sim.
    var GUIDELINES = {
        'shockable': {
            title: 'Shockable Arrest (VF / pVT)',
            content: `
                <ul>
                    <li><strong>1.</strong> Confirm arrest. Start CPR 30:2, attach the defibrillator and call the resuscitation team.</li>
                    <li><strong>2.</strong> Assess rhythm. If VF/pVT (VF of any amplitude, even fine VF), continue compressions while charging.</li>
                    <li><strong>3.</strong> Deliver <strong>1 shock</strong>, aiming for a pause in compressions of <strong>less than 5 s</strong>. Biphasic first shock <strong>at least 150 J</strong>; if unsuccessful, it is reasonable to increase the energy for later shocks.</li>
                    <li><strong>4.</strong> Immediately resume CPR for <strong>2 minutes</strong>, then reassess the rhythm.</li>
                    <li><strong>5.</strong> After <strong>3 shocks</strong>: give <strong>adrenaline 1 mg IV/IO</strong> and <strong>amiodarone 300 mg IV/IO</strong>. Repeat adrenaline every <strong>3-5 minutes</strong>.</li>
                    <li><strong>6.</strong> After <strong>5 shocks</strong>: give a further <strong>amiodarone 150 mg</strong> (counting all shocks, whether VF is refractory or recurrent). Lidocaine 100 mg (then 50 mg) is an alternative if amiodarone is unavailable.</li>
                    <li><strong>7.</strong> Refractory VF after 3 shocks: check pad position and consider an <strong>antero-posterior pad position</strong> (vector change).</li>
                    <li><strong>8.</strong> Identify and treat reversible causes: 4 Hs and 4 Ts.</li>
                </ul>
            `
        },
        'nonshockable': {
            title: 'Non-Shockable Arrest (Asystole / PEA)',
            content: `
                <ul>
                    <li><strong>1.</strong> Confirm arrest. Start CPR 30:2, attach the defibrillator and call the resuscitation team.</li>
                    <li><strong>2.</strong> Assess rhythm. If PEA or asystole, do <strong>NOT</strong> shock.</li>
                    <li><strong>3.</strong> Immediately resume CPR for <strong>2 minutes</strong>.</li>
                    <li><strong>4.</strong> Give <strong>adrenaline 1 mg IV/IO as soon as possible</strong>, then every <strong>3-5 minutes</strong>.</li>
                    <li><strong>5.</strong> If asystole is diagnosed, check the ECG carefully for <strong>P waves</strong>: this may respond to pacing.</li>
                    <li><strong>6.</strong> Identify and treat reversible causes: 4 Hs and 4 Ts.</li>
                </ul>
            `
        },
        'tachy': {
            title: 'Tachyarrhythmia (with a pulse)',
            content: `
                <ul>
                    <li><strong>1.</strong> ABCDE assessment. Monitor ECG, BP and SpO2, record a 12-lead ECG, give oxygen if SpO2 < 94%, obtain IV access. Not for sinus tachycardia: treat the cause.</li>
                    <li><strong>2. Life-threatening features?</strong>
                        <br>Shock; syncope with severe or ongoing hypotension; myocardial ischaemia; severe heart failure with pulmonary oedema; immediately post-ROSC.</li>
                    <li><strong>3. UNSTABLE:</strong>
                        <br>• <strong>Synchronised shock</strong>, up to 3 attempts. Consider sedation or anaesthesia if conscious.
                        <br>• Initial energy: <strong>AF</strong> - maximum defibrillator output; <strong>atrial flutter / SVT</strong> - 70-120 J, then stepwise increases; <strong>VT with a pulse</strong> - 120-150 J, consider stepwise increases.
                        <br>• If unsuccessful: <strong>amiodarone 300 mg IV over 10-20 min</strong> or procainamide 10-15 mg/kg (max 1 g) over 20 min, then repeat the synchronised shock.</li>
                    <li><strong>4. STABLE - narrow regular:</strong> vagal manoeuvres, then adenosine 6 mg, 12 mg, 18 mg rapid IV (if no pre-excitation), then verapamil or a beta-blocker, then synchronised shock.</li>
                    <li><strong>5. STABLE - narrow irregular (probable AF):</strong> rate control (EF > 40%: beta-blocker, verapamil, diltiazem or digoxin; EF < 40%: beta-blocker or digoxin). Anticoagulate if duration > 24 h.</li>
                    <li><strong>6. STABLE - broad regular:</strong> treat as VT with <strong>synchronised shock(s)</strong>. If sedation/anaesthesia risk is too high: procainamide 10-15 mg/kg over 20 min, or amiodarone 300 mg IV over 10-60 min then 900 mg over 24 h.</li>
                    <li><strong>7. STABLE - broad irregular:</strong> AF with pre-excitation - procainamide or cardioversion. Polymorphic VT with long QT - magnesium 8 mmol IV over 10 min, avoid amiodarone.</li>
                    <li>Seek expert help.</li>
                </ul>
            `
        },
        'brady': {
            title: 'Bradyarrhythmia',
            content: `
                <ul>
                    <li><strong>1.</strong> ABCDE assessment. Give oxygen if appropriate, IV access, monitor ECG, BP and SpO2, record a 12-lead ECG, treat reversible causes (e.g. electrolytes).</li>
                    <li><strong>2. Life-threatening features?</strong>
                        <br>Shock; syncope; myocardial ischaemia; severe heart failure; immediately post-ROSC.
                        <br>If yes: <strong>atropine 500 mcg IV</strong>.</li>
                    <li><strong>3. Risk of asystole?</strong> Recent asystole; <strong>Mobitz II AV block</strong>; <strong>complete heart block with broad QRS</strong>; ventricular pause > 3 s.</li>
                    <li><strong>4. Interim measures</strong> (unsatisfactory response or risk of asystole):
                        <br>• Atropine 500 mcg IV, repeat to a maximum of 3 mg
                        <br>• Isoprenaline 5 mcg/min IV, or adrenaline 2-10 mcg/min IV
                        <br>• Alternatives: aminophylline, dopamine, glucagon (beta-blocker or calcium channel blocker overdose); glycopyrrolate instead of atropine
                        <br>• and/or <strong>transcutaneous pacing</strong> (a bridge to transvenous pacing)</li>
                    <li><strong>5.</strong> Do <strong>not</strong> give atropine in high-degree AV block with a wide QRS (ineffective, may worsen the block) or after cardiac transplant (use aminophylline).</li>
                    <li><strong>6.</strong> Seek expert help and arrange transvenous pacing.</li>
                </ul>
            `
        },
        'postrosc': {
            title: 'Immediately After ROSC',
            content: `
                <ul>
                    <li><strong>1.</strong> ABCDE assessment.</li>
                    <li><strong>2.</strong> Aim for <strong>SpO2 94-98%</strong> and a <strong>normal PaCO2</strong>.</li>
                    <li><strong>3.</strong> Aim for <strong>systolic BP > 100 mmHg</strong>.</li>
                    <li><strong>4.</strong> Record a <strong>12-lead ECG</strong>.</li>
                    <li><strong>5.</strong> Identify and treat the cause.</li>
                    <li><strong>6.</strong> Temperature control.</li>
                </ul>
            `
        }
    };

    window.DefibSim = {
        SCENARIOS: SCENARIOS, byId: byId, TRIGGERS: TRIGGERS, MAX_STEPS: MAX_STEPS,
        normaliseSteps: normaliseSteps, savedNames: savedNames, loadSaved: loadSaved, save: save, remove: remove,
        parseFile: parseFile, exportText: exportText, buildScenario: buildScenario, GUIDELINES: GUIDELINES,
        STORE_KEY: STORE_KEY
    };
})();
