// data/prehospital.js
//
// WHAT IS ALREADY ON THE PATIENT WHEN THE TEAM ARRIVES. A patient brought in from the scene often has
// oxygen on, a cannula with fluids running, a collar and head blocks, a pelvic binder or a tourniquet.
// The scenario's start (the patient picture and the Monitoring & access / kit state) must show that,
// or the picture contradicts the handover ("arrives with O2, IV fluids running and is fully immobilised"
// over a figure with nothing on).
//
// A scenario says so in one of two ways:
//   - `setupKit: ['Oxygen', 'IV Access', 'FluidInfusion', 'Collar', 'HeadBlocks']`, written by the
//     author. An empty list means "nothing on", and stops the words being read.
//   - otherwise, its words: the patient description (`profile` / `patientProfileTemplate`), a
//     `handover` and a course mark scheme's `markScheme.radioReport`. Only what the words plainly say
//     is in place goes on; anything negated or still to do ("no IV access", "needs a collar") does not.
//
// The kit goes on through the same path as the controller's "Set up the patient" window (scenario.setupKit,
// data/engine.js setUpIntervention): it does not change the obs (the scenario's obs are the obs with it
// on), it is not counted as the team's in the debrief, and the team can take it off. Monitoring is never
// put on here: the team attaches the department's monitor (data/engine-reducers.js LOAD_SCENARIO).
(() => {
    // Kit that may start on the patient: continuous interventions, minus the monitoring sensors and CPR
    // (compressions are their own state, started from the Rhythm & resus panel).
    const NOT_KIT = new Set(['Obs', 'MonECG', 'MonSpO2', 'MonNIBP', 'MonTemp', 'ToggleETCO2', 'CPR']);
    const cleanSetupKit = (list) => {
        const I = window.INTERVENTIONS || {};
        const out = [];
        (Array.isArray(list) ? list : []).forEach(k => {
            if (typeof k !== 'string' || NOT_KIT.has(k) || !I[k] || I[k].type !== 'continuous' || out.indexOf(k) !== -1) return;
            out.push(k);
        });
        // Fluids running need a cannula to run through.
        if (out.indexOf('FluidInfusion') !== -1 && out.indexOf('IV Access') === -1) out.unshift('IV Access');
        return out;
    };

    const normalise = (t) => String(t || '').toLowerCase()
        .replace(/[‘’]/g, "'").replace(/[‐-―]/g, '-').replace(/o₂/g, 'o2').replace(/\s+/g, ' ');

    // A part of a sentence that says the thing is absent, failed, or still to be done.
    const NEGATED = /\b(no|not|nil|without|unable|failed|refused|refusing|declined|removed|unsuccessful|cannot|can't|couldn't|need|needs|needed|requires?|required|should|consider|awaiting|planned|will)\b/;
    // Words that make "oxygen" or "IV" mean "in place" rather than a reading ("oxygen saturation").
    // "T:" is the treatment line of an ATMIST handover.
    const IN_PLACE = /\b(arriv\w*|brought|with|on|receiving|received|given|applied|via|has had|had|running|in situ|in place|sited|non-?rebreath\w*|nrb|high[- ]flow|\d+ ?(l|litres?)(\/min)?|treatment|tx|pre-?hospital|at (the )?scene|by (the )?(crew|paramedics?|ambulance|hems|police|bystanders?))\b|(^|\s)t:/;
    const LIMB = /\b(leg|legs|arm|arms|limb|limbs|ankle|wrist|knee|elbow|shoulder|hand|foot|femur|tibia|forearm|thigh|finger|fingers)\b/;

    // [kit, test on one part of a sentence (and the whole sentence for context)]
    const RULES = [
        // Airway and breathing
        [['Oxygen'], (f, s) => /\b(o2|oxygen)\b(?!\s*sat)/.test(f) && IN_PLACE.test(s) && !/\b(room|on) air\b/.test(f) && !/\b(home|long-term|ltot) (o2|oxygen)|\b(o2|oxygen) (user|dependent|at home)\b/.test(f)],
        [['Oxygen'], (f) => /\b(non-?rebreath\w* (mask|bag)|nrb mask|high[- ]flow (o2|oxygen))\b/.test(f)],
        [['OPA'], (f) => /\b(guedel|opa|oropharyngeal airway)\b/.test(f)],
        [['NPA'], (f) => /\b(npa|nasopharyngeal airway|nasal airway)\b/.test(f)],
        [['i-gel'], (f) => /\b(i-?gel|lma|laryngeal mask|supraglottic airway|sga)\b/.test(f)],
        [['RSI'], (f) => /\b(intubated|tubed|endotracheal tube|tracheal tube|ett in situ)\b/.test(f) || /\bpre-?hospital (rsi|emergency anaesthe\w*|anaesthe\w*)\b/.test(f)],
        [['Bagging'], (f) => /\b(being bagged|bag-?valve-?mask ventilation|bvm ventilation)\b/.test(f)],
        [['CPAP'], (f, s) => /\bcpap\b/.test(f) && IN_PLACE.test(s)],
        // Circulation
        [['IV Access'], (f, s) => /\b(cannula|cannulae|cannulated|venflon|iv access|iv line|io access|intraosseous|humeral io|tibial io|io in situ)\b/.test(f) && (IN_PLACE.test(s) || /\bcannulated\b/.test(f))],
        [['IV Access', 'FluidInfusion'], (f) => /\b(fluids?|saline|hartmann'?s|crystalloid|plasma-?lyte)\b/.test(f) && /\b(running|up|going|infusing|in progress|attached|connected)\b/.test(f)],
        [['IV Access'], (f) => /\b(fluids?|saline|hartmann'?s|crystalloid|blood)\b/.test(f) && /\b(given|administered|received|bolus)\b/.test(f)],
        [['IV Access'], (f) => /\b(iv|intravenous|io) (fluids?|saline|hartmann'?s|morphine|paracetamol|txa|tranexamic acid|fentanyl|ketamine|antibiotics?)\b.*\b(given|administered|received)\b/.test(f)],
        [['PelvicBinder'], (f) => /\b(pelvic binder|binder|sam pelvic|t-?pod|prometheus)\b/.test(f)],
        [['Tourniquet'], (f) => /\btourniquets?\b/.test(f)],
        [['ChestSeal'], (f) => /\b(chest seal|asherman|hyfin|russell seal|occlusive dressing)\b/.test(f)],
        [['WoundDressing'], (f) => /\b(dressings?|dressed|packed|packing|pressure bandage|bandaged|haemostatic|celox|quikclot|israeli bandage)\b/.test(f) && !/\b(occlusive dressing|chest seal)\b/.test(f)],
        [['PacingPads'], (f) => /\b(defib(rillator)? pads|pacing pads|pads (on|in place|attached|applied))\b/.test(f)],
        [['Lucas'], (f) => /\b(lucas|autopulse|mechanical (cpr|chest compressions?))\b/.test(f)],
        // Spine and limbs. "Immobilised" with no limb named is the spine: collar and head blocks, and a
        // scoop as well for "fully" (or "full", "triple") immobilised.
        [['Collar'], (f) => /\bcollar\b/.test(f)],
        [['HeadBlocks'], (f) => /\b(head ?blocks?|blocks & tape|collar & blocks|in blocks|head huggers?|head immobili[sz]ers?)\b/.test(f) || /^(head )?blocks\b/.test(f)],
        [['Collar', 'HeadBlocks'], (f) => /\b(immobili[sz](ed|ation)|spinal motion restriction)\b/.test(f) && !LIMB.test(f)],
        [['Scoop'], (f) => /\b(fully|full|triple|totally) (spinal(ly)? )?immobili[sz](ed|ation)\b/.test(f) && !LIMB.test(f)],
        [['Scoop'], (f) => /\b(scoop|scoop stretcher|vacuum mattress|spinal board|long ?board|backboard)\b/.test(f)],
        [['TractionSplint'], (f) => /\b(traction splint|kendrick|sager|hare splint)\b/.test(f)],
        [['Splinting'], (f) => /\b(splint|splints|splinted|vacuum splint|box splint|sam splint)\b/.test(f) && !/\b(traction splint|hare splint)\b/.test(f)],
        [['Plaster'], (f) => /\b(backslab|plaster cast|in plaster)\b/.test(f)],
        [['ClingFilm'], (f) => /\bcling ?film\b/.test(f)],
        [['Catheter'], (f) => /\b(urinary catheter|catheteri[sz]ed|indwelling catheter|suprapubic catheter|long-term catheter|catheter in situ|blocked catheter)\b/.test(f)]
    ];

    // The words a scenario gives for the patient on arrival.
    const arrivalText = (s) => {
        const profile = s.profile || (window.formatProfileTemplate ? window.formatProfileTemplate(s.patientProfileTemplate || '', s.patientAge, s.sex) : (s.patientProfileTemplate || ''));
        const radio = s.markScheme && s.markScheme.radioReport;
        const handover = s.handover;
        return [profile].concat(Array.isArray(radio) ? radio : [radio], Array.isArray(handover) ? handover : [handover])
            .filter(t => typeof t === 'string' && t.trim()).join('. ');
    };

    // { kit: [...], phrases: [...] }: the kit the scenario's words say is on, and the words that said it.
    const prehospitalKit = (scenario) => {
        const s = scenario || {};
        // "Collar and blocks", "blocks and tape" are one thing, not two parts of the sentence.
        const text = normalise(arrivalText(s)).replace(/\b(collar|blocks) and (blocks|tape)\b/g, '$1 & $2');
        const kit = [], phrases = [];
        text.split(/[.;!?\n]+/).forEach(sentence => {
            // Parts of a sentence: "with O2, IV fluids running and is fully immobilised but not in a collar"
            sentence.split(/,|\bbut\b|\band\b|\bthen\b|\bwhile\b/).forEach(part => {
                const f = part.trim();
                if (!f || NEGATED.test(f)) return;
                RULES.forEach(([keys, test]) => {
                    if (!test(f, sentence)) return;
                    keys.forEach(k => { if (kit.indexOf(k) === -1) kit.push(k); });
                    if (phrases.indexOf(f) === -1) phrases.push(f);
                });
            });
        });
        return { kit: cleanSetupKit(kit), phrases };
    };

    // The scenario to load: with `setupKit` from the author's own list, or from its words. Returns the
    // scenario unchanged when nothing is on.
    const withPrehospitalKit = (scenario) => {
        if (!scenario || typeof scenario !== 'object') return scenario;
        const kit = Array.isArray(scenario.setupKit) ? cleanSetupKit(scenario.setupKit) : prehospitalKit(scenario).kit;
        if (!kit.length && !Array.isArray(scenario.setupKit)) return scenario;
        return Object.assign({}, scenario, { setupKit: kit });
    };

    window.cleanSetupKit = cleanSetupKit;
    window.prehospitalKit = prehospitalKit;
    window.withPrehospitalKit = withPrehospitalKit;
})();
