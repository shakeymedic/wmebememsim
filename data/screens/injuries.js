// THE PATIENT'S INJURIES, AND THE KIT ON THEM, for the patient picture on the controller
// (data/screens/patientstatus.js).
//
//   - detect(scenario) reads the injuries from the scenario's own words (title, presenting complaint,
//     profile): "stabbed in the left flank", "right wrist is deformed", "complete right below knee
//     amputation", "burns to the chest and arms". Only what the text says is drawn; a side the text
//     does not give is drawn on the right and labelled "side not stated".
//   - forScenario(scenario) is what the picture shows: the facilitator's own list (scenario.injuries,
//     set in the Injuries editor) when there is one, otherwise what detect() found.
//   - Limbs, InjuryLayer and KitLayer are the SVG layers. The kit (collar, pelvic binder, traction
//     splint, splint, backslab, tourniquet, chest seal, dressing, cling film) appears when its
//     intervention is ticked, on the injured limb where there is one.
//   - InjuryEditor lets the facilitator add or remove injuries during the run.
//
// Nothing here is synced or stored except scenario.injuries, which rides in the scenario like the
// investigation result choices do.
(() => {
    const { useState } = React;

    // ---- the words ---------------------------------------------------------------------------
    const PART = {
        head: 'head', scalp: 'head', skull: 'head', forehead: 'head', ear: 'head', ears: 'head',
        face: 'face', facial: 'face', midface: 'face', maxillofacial: 'face', jaw: 'face', chin: 'face', nose: 'face', cheek: 'face',
        eye: 'eye', eyes: 'eye', globe: 'eye', orbit: 'eye', orbital: 'eye', retrobulbar: 'eye', periorbital: 'eye',
        neck: 'neck',
        sternum: 'sternum', sternal: 'sternum',
        chest: 'chest', thorax: 'chest', rib: 'chest', ribs: 'chest', hemithorax: 'chest',
        abdomen: 'abdomen', abdominal: 'abdomen', epigastrium: 'abdomen', epigastric: 'abdomen', umbilicus: 'abdomen',
        handlebar: 'abdomen', handlebars: 'abdomen', belly: 'abdomen', stomach: 'abdomen',
        flank: 'flank', loin: 'flank',
        pelvis: 'pelvis', pelvic: 'pelvis', perineum: 'pelvis', perineal: 'pelvis', straddle: 'pelvis',
        groin: 'groin',
        hip: 'hip', hips: 'hip', nof: 'hip',
        thigh: 'thigh', thighs: 'thigh', femur: 'thigh', femoral: 'thigh', femurs: 'thigh', aboveknee: 'thigh',
        knee: 'knee', knees: 'knee',
        tibia: 'shin', tibial: 'shin', fibula: 'shin', tibfib: 'shin', shin: 'shin', shins: 'shin', calf: 'shin', calves: 'shin', belowknee: 'shin',
        ankle: 'ankle', ankles: 'ankle',
        foot: 'foot', feet: 'foot', toe: 'foot', toes: 'foot', heel: 'foot',
        leg: 'leg', legs: 'leg',
        humerus: 'upperArm', humeral: 'upperArm', upperarm: 'upperArm', shoulder: 'upperArm', elbow: 'upperArm', supracondylar: 'upperArm',
        forearm: 'forearm', wrist: 'forearm', wrists: 'forearm', radius: 'forearm', ulna: 'forearm', colles: 'forearm',
        hand: 'hand', hands: 'hand', finger: 'hand', fingers: 'hand', thumb: 'hand', palm: 'hand',
        arm: 'arm', arms: 'arm'
    };
    // Plural words mean both sides when no side is given ("legs trapped", "arms").
    const PLURAL = new Set(['eyes', 'hips', 'thighs', 'femurs', 'knees', 'shins', 'calves', 'ankles', 'feet', 'legs', 'wrists', 'hands', 'arms']);
    const KIND_RULES = [
        [/^(fractur|broken|deform|dislocat|flail|angulat|tenting|shortened|rotated)/, 'fracture'],
        [/^(kendrick|traction)$/, 'traction'],
        [/^(amputat|severed)/, 'amputation'],
        [/^evisc/, 'evisceration'],
        [/^impal/, 'impaled'],
        [/^(stab|wound|lacerat|gunshot|gsw|bleed|haemorrhag|bubbling|penetrat|slash)/, 'wound'],
        [/^ruptur/, 'rupture'],
        [/^(cut|shot)$/, 'wound'],
        [/^(burn|scald|singed|flame)/, 'burn'],
        [/^(bruis|abrasion|haematoma|graze|contusion|punch|kick)/, 'bruise'],
        [/^(bump|struck|seatbelt)$/, 'bruise'],
        [/^(crush|crushed)$/, 'crush'],
        [/^injur/, 'injury'],
        [/^trauma$/, 'injury']
    ];
    const kindOf = (w) => { for (const [re, k] of KIND_RULES) if (re.test(w)) return k; return null; };
    const SIDE = { left: 'L', right: 'R', both: 'both', bilateral: 'both' };
    const PREP = new Set(['to', 'of', 'in', 'on', 'over', 'at', 'through', 'into', 'onto', 'across', 'around']);
    const CONNECT = new Set([',', 'and', '&', 'or']);
    const FILLER = new Set(['the', 'his', 'her', 'their', 'a', 'an', 'left', 'right', 'both', 'bilateral', 'medial', 'lateral', 'upper', 'lower', 'distal', 'proximal', 'anterior', 'posterior', 'open', 'compound']);
    const NEGATE = new Set(['no', 'not', 'without', 'denies', 'nil']);
    const SIDED = new Set(['eye', 'chest', 'flank', 'groin', 'hip', 'thigh', 'knee', 'shin', 'ankle', 'foot', 'leg', 'upperArm', 'forearm', 'hand', 'arm']);
    const LEG_REGIONS = new Set(['hip', 'thigh', 'knee', 'shin', 'ankle', 'foot']);
    const ARM_REGIONS = new Set(['upperArm', 'forearm', 'hand']);

    const normalise = (text) => String(text || '').toLowerCase()
        .replace(/[()]/g, ' to ')
        .replace(/neck of (the )?femur|#\s*nof/g, 'nof')
        .replace(/leg through the thigh/g, 'thigh')
        .replace(/below[- ](the[- ])?knee|\bbka\b/g, 'belowknee')
        .replace(/above[- ](the[- ])?knee|\baka\b/g, 'aboveknee')
        .replace(/tib(ia)?\s*\/\s*fib(ula)?/g, 'tibfib')
        .replace(/lower limbs/g, 'legs').replace(/lower limb/g, 'leg')
        .replace(/upper limbs/g, 'arms').replace(/upper limb/g, 'arm')
        .replace(/upper arm/g, 'upperarm').replace(/lower legs?/g, 'shin')
        .replace(/chest wall/g, 'chest').replace(/mid-face/g, 'midface')
        .replace(/seat ?belt (sign|bruis\w*|mark\w*)/g, 'seatbelt')
        .replace(/fracture-dislocation/g, 'fracture dislocation')
        .replace(/trapped under/g, 'crushed under')
        .replace(/traumatic/g, ' ');

    // One clause's injuries: each body part gets the kinds that bind to it.
    function clauseInjuries(clause, out) {
        const toks = (clause.match(/[a-z0-9]+|,|&/g) || []);
        const part = toks.map(t => PART[t] || null);
        const kind = toks.map(t => kindOf(t));
        // A kind just after "no" / "not" ("no obvious injuries") says nothing.
        toks.forEach((t, i) => { if (NEGATE.has(t)) for (let j = i + 1; j <= i + 3 && j < toks.length; j++) kind[j] = null; });
        // "open" belongs to the fracture word just after it (or the part it comes before), not to
        // the whole clause: "closed fracture of the left femur, open fracture of the right forearm".
        const openTok = (i) => [toks[i - 1], toks[i - 2]].some(t => t === 'open' || t === 'compound');
        const partOpen = toks.map((t, i) => part[i] !== null && openTok(i));
        const kinds = toks.map(() => []);
        const bindForward = (k, from) => {
            // "wound to the left ankle", "stabbed twice in the abdomen and groin", "flail chest"
            let j = from + 1, prep = false, gap = 0;
            while (j < toks.length && part[j] === null && kind[j] === null && gap <= 4) {
                if (CONNECT.has(toks[j])) {
                    // "burns and abdominal injury": the burns are not the abdomen's
                    let q = j + 1;
                    while (q < toks.length && FILLER.has(toks[q])) q++;
                    if (q < toks.length && part[q] !== null) return false;
                }
                if (PREP.has(toks[j])) prep = true;
                else if (!FILLER.has(toks[j])) gap++;
                j++;
            }
            if (j >= toks.length || part[j] === null) return false;
            if (!prep && j - from - 1 > 0 && toks.slice(from + 1, j).some(t => !FILLER.has(t))) return false;
            kinds[j].push(k);
            if (openTok(from)) partOpen[j] = true;
            // chain: "to the chest and arms", "head, chest, arm and leg"
            let p = j;
            for (;;) {
                let q = p + 1, sawConnect = false;
                while (q < toks.length && (CONNECT.has(toks[q]) || FILLER.has(toks[q]))) { if (CONNECT.has(toks[q])) sawConnect = true; q++; }
                if (!sawConnect || q >= toks.length || part[q] === null) break;
                kinds[q].push(k); if (openTok(from)) partOpen[q] = true; p = q;
            }
            return true;
        };
        const boundForward = toks.map((t, i) => kind[i] ? bindForward(kind[i], i) : false);
        // "right wrist is deformed", "left knee injury with deformity", "tibia injury"
        for (let i = 0; i < toks.length; i++) {
            if (part[i] === null) continue;
            let j = i + 1, gap = 0;
            while (j < toks.length && part[j] === null && gap <= 3) {
                if (kind[j] && !boundForward[j]) { kinds[i].push(kind[j]); if (openTok(j)) partOpen[i] = true; }
                else if (!kind[j] && !CONNECT.has(toks[j]) && !FILLER.has(toks[j])) gap++;
                j++;
            }
        }
        // "head, chest, arm and leg injuries", "abdominal and leg injuries": a part followed only by a
        // connector takes the kinds of the part after it.
        for (let i = toks.length - 1; i >= 0; i--) {
            if (part[i] === null || kinds[i].length) continue;
            let j = i + 1, sawConnect = false;
            while (j < toks.length && (CONNECT.has(toks[j]) || FILLER.has(toks[j]))) { if (CONNECT.has(toks[j])) sawConnect = true; j++; }
            if (sawConnect && j < toks.length && part[j] !== null) { kinds[i] = kinds[j].slice(); partOpen[i] = partOpen[j]; }
        }
        for (let i = 0; i < toks.length; i++) {
            if (part[i] === null || !kinds[i].length) continue;
            let side = null;
            for (let j = i - 1; j >= 0; j--) if (SIDE[toks[j]]) { side = SIDE[toks[j]]; break; }
            if (!side && PLURAL.has(toks[i])) side = 'both';
            let region = part[i];
            const ks = new Set(kinds[i]);
            if (region === 'sternum') { region = 'chest'; side = 'C'; }
            if (ks.has('traction') && (region === 'leg' || region === 'thigh')) { region = 'thigh'; ks.add('fracture'); }
            ks.delete('traction');
            // A ruptured globe is an open eye injury; a ruptured spleen or aorta shows nothing outside.
            if (ks.has('rupture') && region === 'eye') ks.add('wound');
            ks.delete('rupture');
            if (!ks.size) continue;
            // An amputation "at the wrist" takes the hand.
            if (ks.has('amputation') && /^wrists?$/.test(toks[i])) region = 'hand';
            out.push({ region, kinds: ks, side, open: partOpen[i], word: toks[i] });
        }
    }

    const SEVERITY = ['amputation', 'evisceration', 'impaled', 'fracture', 'wound', 'burn', 'crush', 'bruise', 'injury'];

    function detect(scenario) {
        const s = scenario || {};
        const profile = s.profile || (window.formatProfileTemplate ? window.formatProfileTemplate(s.patientProfileTemplate || '', s.patientAge, s.sex) : (s.patientProfileTemplate || ''));
        const text = normalise([s.title, s.presentingComplaint, profile].filter(Boolean).join('. '));
        const raw = [];
        text.split(/[.;!?:\n]+/).forEach(c => clauseInjuries(c, raw));
        // Sides the text gives for a region anywhere ("discharged into the left index finger").
        const statedSide = {};
        text.split(/[.;!?:\n]+/).forEach(c => {
            const toks = c.match(/[a-z0-9]+/g) || [];
            toks.forEach((t, i) => {
                if (!PART[t]) return;
                for (let j = i - 1; j >= Math.max(0, i - 4); j--) if (SIDE[toks[j]] && SIDE[toks[j]] !== 'both') { statedSide[PART[t]] = statedSide[PART[t]] || SIDE[toks[j]]; break; }
            });
        });
        const list = [];
        raw.forEach(r => {
            let kind = SEVERITY.find(k => r.kinds.has(k));
            const open = kind === 'fracture' && (r.open || r.kinds.has('wound'));
            if (r.region === 'abdomen' && r.kinds.has('evisceration')) kind = 'evisceration';
            let sides = [r.side];
            let guessed = false;
            if (SIDED.has(r.region)) {
                if (r.side === 'both') sides = ['R', 'L'];
                else if (!r.side || r.side === 'C') {
                    // The front of the chest: the sternum, or burns or bruising given no side.
                    if (r.region === 'chest' && (r.side === 'C' || (!r.side && ['burn', 'bruise', 'injury'].indexOf(kind) !== -1))) sides = ['C'];
                    else if (statedSide[r.region]) sides = [statedSide[r.region]];
                    else { sides = ['R']; guessed = true; }
                }
            } else sides = [null];
            sides.forEach(side => list.push({ region: r.region, kind, side, open: !!open, guessed }));
        });
        // A visible bump from 20 weeks: "32 weeks pregnant", "at 34 weeks", "term pregnancy", or pregnant
        // with no gestation given (but not an early pregnancy: ectopic, miscarriage, a positive test).
        const gm = text.match(/\b(?:at|pregnant,?\s*(?:to\s*)?)\s*(\d{1,2})\s*weeks\b|\b(\d{1,2})\s*weeks'?\s*(?:pregnant|gestation)/);
        const weeks = gm ? Number(gm[1] || gm[2]) : null;
        const pregnant = /\bpregnan/.test(text) && !/\bnot pregnan/.test(text);
        if ((weeks !== null && weeks >= 20) || /\bterm pregnancy\b/.test(text) ||
            (pregnant && weeks === null && !/positive pregnancy test|ectopic|early pregnancy|miscarri/.test(text))) {
            list.push({ region: 'abdomen', kind: 'pregnant', side: null, open: false, guessed: false });
        }
        // Burns the text gives no place for ("40% TBSA burns"): the chest and both arms, labelled so.
        if (/\b(burn|burns|burnt|scald|scalds|scalded)\b/.test(text) && !list.some(i => i.kind === 'burn')) {
            list.push({ region: 'chest', kind: 'burn', side: 'C', open: false, guessed: true, areaGuessed: true });
            list.push({ region: 'arm', kind: 'burn', side: 'R', open: false, guessed: false, areaGuessed: true });
            list.push({ region: 'arm', kind: 'burn', side: 'L', open: false, guessed: false, areaGuessed: true });
        }
        return tidy(list);
    }

    // One entry per place and kind; an open fracture absorbs the wound at the same place; a stated
    // side beats a guessed one; a vague "leg injury" gives way to a named part of that leg.
    function tidy(list) {
        const key = (i) => `${i.region}|${i.side || ''}|${i.kind}`;
        const seen = new Map();
        list.forEach(i => { if (!seen.has(key(i)) || (seen.get(key(i)).guessed && !i.guessed)) seen.set(key(i), i); });
        let out = Array.from(seen.values());
        out.forEach(f => { if (f.kind === 'fracture' && out.some(w => w.kind === 'wound' && w.region === f.region && w.side === f.side)) f.open = true; });
        out = out.filter(i => !(i.kind === 'wound' && out.some(f => f.kind === 'fracture' && f.region === i.region && f.side === i.side)));
        out = out.filter(i => !(i.guessed && out.some(o => o !== i && o.region === i.region && o.kind === i.kind && !o.guessed)));
        out = out.filter(i => !(i.kind !== 'amputation' && out.some(o => o.kind === 'amputation' && o.region === i.region && o.side === i.side)));
        // A plain "injury" (or a wound beside an evisceration) adds nothing to a named injury at the same place.
        const samePlace = (a, b) => a !== b && a.region === b.region && a.side === b.side;
        out = out.filter(i => !(i.kind === 'injury' && out.some(o => o !== i && o.region === i.region && o.kind !== 'injury' && o.kind !== 'pregnant')));
        out = out.filter(i => !(i.kind === 'wound' && out.some(o => samePlace(o, i) && o.kind === 'evisceration')));
        out = out.filter(i => !(i.kind === 'bruise' && out.some(o => samePlace(o, i) && (o.kind === 'wound' || o.kind === 'fracture'))));
        const specific = (generic, set) => out.some(o => set.has(o.region) && (o.side === generic.side || generic.guessed));
        const vague = (i) => i.guessed || i.kind === 'injury' || i.kind === 'bruise';
        out = out.filter(i => !(i.region === 'leg' && vague(i) && specific(i, LEG_REGIONS)));
        out = out.filter(i => !(i.region === 'arm' && vague(i) && specific(i, ARM_REGIONS)));
        // A hip fracture and a vague fracture of the same leg are the same injury.
        return out;
    }

    const cache = new Map();
    function forScenario(scenario) {
        if (!scenario) return [];
        if (Array.isArray(scenario.injuries)) return scenario.injuries.filter(i => i && REGION_NAME[i.region] && KIND_NAME[i.kind]);
        const k = [scenario.id, scenario.title, scenario.presentingComplaint, scenario.profile, scenario.patientProfileTemplate].join('|');
        if (!cache.has(k)) { if (cache.size > 50) cache.clear(); cache.set(k, detect(scenario)); }
        return cache.get(k);
    }

    // ---- the words for people ----------------------------------------------------------------
    const REGION_NAME = { head: 'head', face: 'face', eye: 'eye', neck: 'neck', chest: 'chest', abdomen: 'abdomen', flank: 'flank', pelvis: 'pelvis',
        groin: 'groin', hip: 'hip', thigh: 'thigh', knee: 'knee', shin: 'lower leg', ankle: 'ankle', foot: 'foot', leg: 'leg',
        upperArm: 'upper arm / elbow', forearm: 'forearm / wrist', hand: 'hand', arm: 'arm' };
    const KIND_NAME = { fracture: 'fracture', amputation: 'amputation', wound: 'wound', evisceration: 'evisceration', impaled: 'impaled object',
        burn: 'burns', bruise: 'bruising', crush: 'crush injury', injury: 'injury', pregnant: 'pregnant' };
    const SPECIAL = {
        'thigh|fracture': 'femur fracture', 'shin|fracture': 'tibia / fibula fracture', 'leg|fracture': 'leg fracture',
        'hip|fracture': 'hip fracture (leg shortened and rotated)', 'chest|fracture': 'rib fractures', 'knee|fracture': 'knee dislocation / deformity',
        'ankle|fracture': 'ankle fracture-dislocation', 'pelvis|fracture': 'pelvic fracture', 'head|fracture': 'skull fracture',
        'face|fracture': 'facial fractures', 'upperArm|fracture': 'upper arm / elbow fracture', 'forearm|fracture': 'forearm / wrist fracture',
        'thigh|amputation': 'amputation through the thigh', 'shin|amputation': 'below-knee amputation', 'leg|amputation': 'below-knee amputation',
        'hand|amputation': 'hand amputated at the wrist', 'forearm|amputation': 'forearm amputation', 'arm|amputation': 'forearm amputation',
        'abdomen|evisceration': 'abdominal wound with evisceration', 'abdomen|impaled': 'impaled object in the abdomen',
        'abdomen|pregnant': 'pregnant', 'head|injury': 'head injury', 'head|bruise': 'scalp bruising / haematoma',
        'abdomen|injury': 'abdominal injury', 'abdomen|bruise': 'abdominal bruising', 'abdomen|wound': 'abdominal wound',
        'abdomen|burn': 'abdominal burns', 'pelvis|injury': 'pelvic injury', 'pelvis|bruise': 'pelvic bruising',
        'face|injury': 'facial injuries', 'face|bruise': 'facial bruising', 'face|wound': 'facial wound', 'face|burn': 'facial burns'
    };
    function label(i) {
        const base = SPECIAL[`${i.region}|${i.kind}`] || `${REGION_NAME[i.region]} ${KIND_NAME[i.kind]}`;
        const side = i.side === 'R' ? 'Right ' : i.side === 'L' ? 'Left ' : '';
        let s = side ? side + base : base.charAt(0).toUpperCase() + base.slice(1);
        if (i.open && i.kind === 'fracture') s += ' (open)';
        if (i.areaGuessed) s += ' (areas not stated)';
        else if (i.guessed && side) s += ' (side not stated)';
        return s;
    }

    // What the facilitator can add.
    const PRESETS = [
        ['head', 'injury'], ['face', 'injury'], ['eye', 'bruise'], ['neck', 'wound'], ['chest', 'wound'], ['chest', 'fracture'],
        ['abdomen', 'wound'], ['abdomen', 'bruise'], ['abdomen', 'evisceration'], ['abdomen', 'impaled'], ['flank', 'wound'],
        ['pelvis', 'fracture'], ['groin', 'wound'], ['hip', 'fracture'], ['thigh', 'fracture'], ['thigh', 'wound'], ['knee', 'fracture'],
        ['shin', 'fracture'], ['ankle', 'fracture'], ['leg', 'crush'], ['thigh', 'amputation'], ['shin', 'amputation'],
        ['upperArm', 'fracture'], ['forearm', 'fracture'], ['hand', 'wound'], ['hand', 'amputation'],
        ['face', 'burn'], ['chest', 'burn'], ['abdomen', 'burn'], ['arm', 'burn'], ['leg', 'burn'], ['abdomen', 'pregnant']
    ].map(([region, kind]) => ({ region, kind, sided: SIDED.has(region) && !(region === 'chest' && kind === 'burn'),
        name: label({ region, kind, side: null }).replace(/ \(.*\)$/, '') }));

    // ---- where things are on the picture ------------------------------------------------------
    // The picture is 220 x 250, the patient seen from above with the head at the top, so the
    // patient's RIGHT is on the LEFT of the picture. Points are given for the right side and
    // mirrored about x = 95 for the left.
    const mx = (side, x) => side === 'L' ? 190 - x : x;
    const injAt = (list, side, regions, kinds) => list.find(i => i.side === side && regions.indexOf(i.region) !== -1 && (!kinds || kinds.indexOf(i.kind) !== -1));

    // The limbs' joints, bent where a fracture deforms them, short where an amputation took them.
    function geometry(list) {
        const g = {};
        ['R', 'L'].forEach(side => {
            const X = (x) => mx(side, x);
            const lat = side === 'L' ? 1 : -1;     // outward, in picture x
            const has = (regions, kinds) => !!injAt(list, side, regions, kinds);
            // arm: shoulder, elbow, wrist, hand
            const arm = { segs: [], hand: [X(61), 131], stump: null };
            const ampHand = has(['hand'], ['amputation']), ampFore = has(['forearm', 'arm'], ['amputation']);
            const upper = [[X(71), 62]];
            if (has(['upperArm'], ['fracture'])) upper.push([X(71) + lat * 10, 82]);
            upper.push([X(63), 96]);
            const fore = [[X(63), 96]];
            if (has(['forearm', 'arm'], ['fracture'])) fore.push([X(63) + lat * 6, 110]);
            if (ampFore) fore.push([X(62), 108]); else fore.push([X(61), 124]);
            arm.segs = [{ pts: upper, w: 10 }, { pts: fore, w: 9 }];
            if (ampFore) { arm.stump = [X(62), 108]; arm.hand = null; }
            else if (ampHand) { arm.stump = [X(61), 124]; arm.hand = null; }
            arm.mid = { upperArm: [X(66), 79], forearm: [X(62), 110], hand: [X(61), 131] };
            // leg: hip, knee, ankle, foot
            const hipFx = has(['hip'], ['fracture']);
            const sh = hipFx ? 7 : 0;
            const leg = { segs: [], foot: null, footRot: 0, stump: null };
            const thigh = [[X(84), 128]];
            if (has(['thigh'], ['fracture'])) thigh.push([X(84) + lat * 6, 155 - sh]);
            const kneeOut = has(['knee'], ['fracture']) ? lat * 5 : 0;
            const ampThigh = has(['thigh'], ['amputation']), ampShin = has(['shin', 'leg'], ['amputation']);
            if (ampThigh) { thigh.push([X(83.5), 160]); leg.stump = [X(83.5), 160]; }
            else thigh.push([X(83) + kneeOut, 180 - sh]);
            leg.segs.push({ pts: thigh, w: 14 });
            if (!ampThigh) {
                const shin = [[X(83) + kneeOut, 180 - sh]];
                if (has(['shin', 'leg'], ['fracture'])) shin.push([X(83) + kneeOut + lat * 6, 200 - sh]);
                if (ampShin) { shin.push([X(83) + kneeOut, 196]); leg.stump = [X(83) + kneeOut, 196]; }
                else shin.push([X(82), 220 - sh]);
                leg.segs.push({ pts: shin, w: 10 });
                if (!ampShin) {
                    const ankleFx = has(['ankle'], ['fracture']);
                    leg.foot = [X(82) + (ankleFx ? lat * 5 : 0) + (hipFx ? lat * 3 : 0), 228 - sh];
                    leg.footRot = (hipFx ? 50 : 0) * (side === 'L' ? 1 : -1) + (ankleFx ? 35 * (side === 'L' ? 1 : -1) : 0);
                }
            }
            leg.ankle = ampThigh || ampShin ? null : [X(82), 220 - sh];
            leg.mid = { hip: [X(74), 134], thigh: [X(83.5), 155 - sh], knee: [X(83) + kneeOut, 180 - sh], shin: [X(82.5), 200 - sh],
                ankle: [X(82), 219 - sh], foot: [X(82), 228 - sh], leg: [X(82.5), 200 - sh] };
            g[side] = { arm, leg };
        });
        return g;
    }

    const POINT = {
        head: () => [95, 15], face: () => [95, 36], neck: () => [95, 51], abdomen: () => [95, 108], pelvis: () => [95, 130],
        eye: (s) => [mx(s, 89), 28], chest: (s) => s === 'C' ? [95, 76] : [mx(s, 82), 80], flank: (s) => [mx(s, 71), 110],
        groin: (s) => [mx(s, 87), 141]
    };
    function pointFor(i, g) {
        if (POINT[i.region]) return POINT[i.region](i.side || 'R');
        const side = i.side === 'L' ? 'L' : 'R';
        const G = g[side];
        if (ARM_REGIONS.has(i.region) || i.region === 'arm') return G.arm.mid[i.region === 'arm' ? 'forearm' : i.region];
        return G.leg.mid[i.region] || G.leg.mid.shin;
    }

    // ---- the layers ---------------------------------------------------------------------------
    const line = (pts) => 'M' + pts.map(p => `${p[0]} ${p[1]}`).join(' L');

    // Arms, legs, hands and feet (and the shorts), in the skin colours patientstatus.js chooses.
    const Limbs = ({ g, skin, shade }) => (
        <g data-part="limbs">
            {['R', 'L'].map(side => {
                const { arm, leg } = g[side];
                return (
                    <g key={side}>
                        {leg.segs.map((s, k) => <path key={'ls' + k} d={line(s.pts)} stroke={shade} strokeWidth={s.w + 2} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
                        {leg.segs.map((s, k) => <path key={'l' + k} d={line(s.pts)} stroke={skin} strokeWidth={s.w} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
                        {leg.foot && <ellipse cx={leg.foot[0]} cy={leg.foot[1]} rx="5" ry="7.5" fill={skin} stroke={shade} strokeWidth="0.8" transform={`rotate(${leg.footRot} ${leg.foot[0]} ${leg.foot[1] - 4})`} />}
                        {arm.segs.map((s, k) => <path key={'as' + k} d={line(s.pts)} stroke={shade} strokeWidth={s.w + 2} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
                        {arm.segs.map((s, k) => <path key={'a' + k} d={line(s.pts)} stroke={skin} strokeWidth={s.w} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
                        {arm.hand && <ellipse cx={arm.hand[0]} cy={arm.hand[1]} rx="5" ry="7" fill={skin} stroke={shade} strokeWidth="0.8" />}
                    </g>
                );
            })}
            {/* shorts */}
            <path d="M65 118 Q95 112 125 118 L128 141 Q112 147 98 141 L95 137 L92 141 Q78 147 62 141 Z" fill="#3b4d6b" stroke="#2c3a52" strokeWidth="0.8" />
            <path d="M65 118 Q95 112 125 118" stroke="#a5b4cf" strokeWidth="1.6" fill="none" />
        </g>
    );

    const Bruise = ({ p, rx = 6, ry = 4.5, rot = 0 }) => (
        <g transform={`rotate(${rot} ${p[0]} ${p[1]})`}>
            <ellipse cx={p[0]} cy={p[1]} rx={rx} ry={ry} fill="#7c3aed" opacity="0.45" />
            <ellipse cx={p[0] + 0.8} cy={p[1] + 0.5} rx={rx * 0.55} ry={ry * 0.55} fill="#3b0764" opacity="0.4" />
        </g>
    );
    const Wound = ({ p, rot = -30 }) => (
        <g>
            <ellipse cx={p[0]} cy={p[1]} rx="3.6" ry="1.3" fill="#450a0a" stroke="#dc2626" strokeWidth="0.8" transform={`rotate(${rot} ${p[0]} ${p[1]})`} />
            <path d={`M${p[0] + 1} ${p[1] + 1.5} q1 3 0 5.5`} stroke="#b91c1c" strokeWidth="1.3" fill="none" strokeLinecap="round" />
            <circle cx={p[0] + 1} cy={p[1] + 8} r="1" fill="#b91c1c" />
        </g>
    );
    const BURN_SHAPE = {
        chest: (s) => s === 'C' || !s ? { c: [95, 82], rx: 22, ry: 17 } : { c: [mx(s, 84), 82], rx: 11, ry: 15 },
        abdomen: () => ({ c: [95, 108], rx: 18, ry: 11 }), face: () => ({ c: [95, 32], rx: 12, ry: 13 }),
        eye: (s) => ({ c: [mx(s, 89), 28], rx: 4, ry: 3.5 }), neck: () => ({ c: [95, 51], rx: 7, ry: 6 }),
        head: () => ({ c: [95, 20], rx: 13, ry: 9 })
    };
    function burnShape(i, g) {
        if (BURN_SHAPE[i.region]) return BURN_SHAPE[i.region](i.side);
        const side = i.side === 'L' ? 'L' : 'R';
        const G = g[side];
        if (i.region === 'arm') return { c: [mx(side, 65), 96], rx: 6, ry: 28 };
        if (ARM_REGIONS.has(i.region)) { const p = G.arm.mid[i.region]; return { c: p, rx: 6, ry: i.region === 'hand' ? 7 : 12 }; }
        if (i.region === 'leg') return { c: [mx(side, 83), 176], rx: 8.5, ry: 44 };
        const p = G.leg.mid[i.region] || G.leg.mid.shin; return { c: p, rx: 8, ry: 13 };
    }

    const InjuryLayer = ({ list, g }) => (
        <g data-part="injuries">
            {list.map((i, k) => {
                const p = pointFor(i, g);
                const id = `injury-${i.region}-${i.kind}`;
                if (i.kind === 'pregnant') return null;   // drawn with the body
                if (i.kind === 'burn') {
                    const b = burnShape(i, g);
                    return <g key={k} data-part={id}>
                        <ellipse cx={b.c[0]} cy={b.c[1]} rx={b.rx} ry={b.ry} fill="#ef4444" opacity="0.5" />
                        <ellipse cx={b.c[0] - b.rx * 0.3} cy={b.c[1] - b.ry * 0.25} rx={b.rx * 0.35} ry={b.ry * 0.3} fill="#7c2d12" opacity="0.55" />
                        <ellipse cx={b.c[0] + b.rx * 0.35} cy={b.c[1] + b.ry * 0.3} rx={b.rx * 0.3} ry={b.ry * 0.22} fill="#fde68a" opacity="0.45" />
                    </g>;
                }
                if (i.kind === 'amputation') {
                    const side = i.side === 'L' ? 'L' : 'R';
                    const st = (LEG_REGIONS.has(i.region) || i.region === 'leg') ? g[side].leg.stump : g[side].arm.stump;
                    if (!st) return null;
                    return <g key={k} data-part={id}><circle cx={st[0]} cy={st[1] + 1} r="5.5" fill="#991b1b" stroke="#ef4444" strokeWidth="0.8" /><circle cx={st[0]} cy={st[1] + 1} r="1.6" fill="#fef3c7" />
                        <path d={`M${st[0] - 2} ${st[1] + 6} q-1 4 0 7 M${st[0] + 2} ${st[1] + 6} q1 3 0 5`} stroke="#b91c1c" strokeWidth="1.3" fill="none" strokeLinecap="round" /></g>;
                }
                if (i.kind === 'evisceration') return <g key={k} data-part={id}>
                    <Wound p={[p[0], p[1] + 4]} rot={0} />
                    {[[-4, -1], [1, -3], [5, 0], [-1, 2], [3, 3]].map(([dx, dy], n) => <circle key={n} cx={p[0] + dx} cy={p[1] + dy} r="2.6" fill="#f9a8d4" stroke="#be185d" strokeWidth="0.6" />)}
                </g>;
                if (i.kind === 'impaled') return <g key={k} data-part={id}><Wound p={p} rot={0} /><path d={`M${p[0]} ${p[1]} L${p[0] + 26} ${p[1] - 20}`} stroke="#57534e" strokeWidth="3.4" strokeLinecap="round" /><path d={`M${p[0]} ${p[1]} L${p[0] + 26} ${p[1] - 20}`} stroke="#a8a29e" strokeWidth="1.2" strokeLinecap="round" /></g>;
                if (i.kind === 'wound') return <g key={k} data-part={id}><Wound p={p} /></g>;
                if (i.kind === 'crush') {
                    if (i.region === 'leg') { const G = g[i.side === 'L' ? 'L' : 'R'].leg.mid; return <g key={k} data-part={id}><Bruise p={G.thigh} rx={6} ry={14} /><Bruise p={G.shin} rx={5} ry={12} /></g>; }
                    return <g key={k} data-part={id}><Bruise p={p} rx={9} ry={7} /></g>;
                }
                if (i.kind === 'fracture') {
                    const limb = LEG_REGIONS.has(i.region) || ARM_REGIONS.has(i.region) || i.region === 'leg' || i.region === 'arm';
                    if (i.region === 'chest') {
                        const s = i.side === 'L' ? 'L' : 'R', q = [mx(s, 73), 90];
                        return <g key={k} data-part={id}><Bruise p={q} rx={7} ry={9} /><path d={`M${q[0] - 5} ${q[1] - 6} l9 2 M${q[0] - 5} ${q[1]} l9 2 M${q[0] - 5} ${q[1] + 6} l9 2`} stroke="#fca5a5" strokeWidth="0.8" strokeDasharray="2 1.2" /></g>;
                    }
                    if (i.region === 'pelvis') return <g key={k} data-part={id}><Bruise p={[95, 132]} rx={16} ry={6} /></g>;
                    return <g key={k} data-part={id}>
                        <Bruise p={p} rx={limb ? 5.5 : 7} ry={limb ? 7 : 5} />
                        {limb && <path d={`M${p[0] - 4} ${p[1] - 2} l2.5 2.5 l2 -3 l2 3 l2.5 -2.5`} stroke="#fecaca" strokeWidth="0.9" fill="none" />}
                        {i.open && <><Wound p={[p[0] + 1, p[1] + 1]} rot={70} /><path d={`M${p[0] - 1} ${p[1] - 1} l3 -3`} stroke="#fefce8" strokeWidth="1.6" strokeLinecap="round" /></>}
                    </g>;
                }
                // bruising, or an injury the text does not describe further
                if (i.region === 'head') return <g key={k} data-part={id}><Bruise p={[p[0] - 6, p[1] + 2]} rx={5} ry={4} /><Wound p={[p[0] - 5, p[1] + 1]} rot={15} /></g>;
                if (i.region === 'eye') return <g key={k} data-part={id}><ellipse cx={p[0]} cy={p[1]} rx="4.2" ry="3.4" fill="#5b21b6" opacity="0.55" /></g>;
                if (i.region === 'abdomen' && i.kind === 'bruise') return <g key={k} data-part={id}><Bruise p={p} rx={15} ry={4} rot={-25} /></g>;
                return <g key={k} data-part={id}><Bruise p={p} /></g>;
            })}
        </g>
    );

    // The kit on the patient. `has(key)` is whether that intervention is on.
    const LIMB_TARGETS = ['thigh', 'shin', 'leg', 'knee', 'ankle', 'foot', 'hip', 'forearm', 'arm', 'upperArm', 'hand'];
    function kitPlan(list, has) {
        const kit = [];
        const fx = list.filter(i => i.kind === 'fracture' && LIMB_TARGETS.indexOf(i.region) !== -1);
        const sideOf = (i) => i && i.side === 'L' ? 'L' : 'R';
        if (has('Collar')) kit.push({ type: 'collar', name: 'Collar' });
        if (has('PelvicBinder')) kit.push({ type: 'binder', name: 'Pelvic binder' });
        if (has('TractionSplint')) {
            const t = fx.find(i => i.region === 'thigh' || i.region === 'hip') || fx.find(i => LEG_REGIONS.has(i.region) || i.region === 'leg');
            kit.push({ type: 'traction', side: sideOf(t), name: 'Traction splint' });
        }
        if (has('Splinting')) {
            const t = fx.find(i => i.region !== 'thigh' && i.region !== 'hip') || fx[0];
            kit.push({ type: 'splint', side: sideOf(t), region: t ? t.region : 'shin', name: 'Splint' });
        }
        if (has('Plaster')) {
            const t = fx.find(i => ['ankle', 'shin', 'leg', 'forearm', 'arm', 'hand'].indexOf(i.region) !== -1);
            kit.push({ type: 'plaster', side: sideOf(t), region: t ? t.region : 'ankle', name: 'Backslab' });
        }
        if (has('Tourniquet')) {
            const bleeding = list.filter(i => (i.kind === 'amputation' || i.kind === 'wound' || (i.kind === 'fracture' && i.open) || i.kind === 'crush') && LIMB_TARGETS.indexOf(i.region) !== -1);
            const limbs = {};
            bleeding.forEach(i => { limbs[`${sideOf(i)}|${(LEG_REGIONS.has(i.region) || i.region === 'leg') ? 'leg' : 'arm'}`] = true; });
            const keys = Object.keys(limbs).length ? Object.keys(limbs) : ['R|leg'];
            keys.forEach(k => { const [side, limb] = k.split('|'); kit.push({ type: 'tourniquet', side, limb, name: 'Tourniquet' }); });
        }
        if (has('ChestSeal')) {
            const w = list.find(i => i.region === 'chest' && i.kind === 'wound');
            kit.push({ type: 'chestseal', side: w ? (w.side || 'R') : 'R', name: 'Chest seal' });
        }
        if (has('WoundDressing')) kit.push({ type: 'dressing', name: 'Dressing' });
        if (has('ClingFilm')) kit.push({ type: 'clingfilm', name: 'Cling film' });
        return kit;
    }

    // A strap or slab laid along a limb between two points.
    const Slab = ({ a, b, w, fill, stroke, lines }) => {
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx) * 180 / Math.PI;
        return (
            <g transform={`translate(${a[0]} ${a[1]}) rotate(${ang})`}>
                <rect x="-2" y={-w / 2} width={len + 4} height={w} rx="3" fill={fill} stroke={stroke} strokeWidth="0.8" opacity="0.92" />
                {Array.from({ length: lines }).map((_, n) => <line key={n} x1={(n + 1) * (len + 4) / (lines + 1) - 2} y1={-w / 2} x2={(n + 1) * (len + 4) / (lines + 1) - 2} y2={w / 2} stroke={stroke} strokeWidth="1.2" />)}
            </g>
        );
    };
    function segFor(region, side, g) {
        const G = g[side];
        const arm = G.arm.segs, leg = G.leg.segs;
        const first = (s) => s.pts[0], last = (s) => s.pts[s.pts.length - 1];
        if (region === 'upperArm') return [first(arm[0]), last(arm[0])];
        if (ARM_REGIONS.has(region) || region === 'arm') return [first(arm[1]), last(arm[1])];
        if (region === 'thigh' || region === 'hip') return [first(leg[0]), last(leg[0])];
        if (region === 'knee') return [[leg[0].pts[0][0], 160], leg[1] ? [last(leg[1])[0], 200] : last(leg[0])];
        if (leg[1]) {
            if (region === 'ankle' || region === 'foot') { const e = last(leg[1]); return [[e[0], e[1] - 22], [e[0], e[1] + 6]]; }
            return [first(leg[1]), last(leg[1])];
        }
        return [first(leg[0]), last(leg[0])];
    }

    const KitLayer = ({ kit, list, g }) => (
        <g data-part="kit">
            {kit.map((k, n) => {
                if (k.type === 'collar') return <g key={n} data-part="collar"><rect x="83" y="43" width="24" height="15" rx="5" fill="#1d4ed8" stroke="#bfdbfe" strokeWidth="0.9" /><rect x="91" y="46" width="8" height="7" rx="2" fill="#0f172a" stroke="#93c5fd" strokeWidth="0.6" /><path d="M85 50 h4 M101 50 h4" stroke="#bfdbfe" strokeWidth="0.8" /></g>;
                if (k.type === 'binder') return <g key={n} data-part="binder"><rect x="63" y="126" width="64" height="11" rx="3" fill="#111827" stroke="#9ca3af" strokeWidth="0.9" /><rect x="90" y="127.5" width="10" height="8" rx="1.5" fill="#f59e0b" stroke="#78350f" strokeWidth="0.6" /></g>;
                if (k.type === 'traction') {
                    const s = k.side, L = g[s].leg, X = (x) => mx(s, x);
                    const ankle = L.ankle || L.segs[L.segs.length - 1].pts.slice(-1)[0];
                    const tip = [X(82), 246];
                    return <g key={n} data-part="traction">
                        <path d={`M${X(70)} 126 L${tip[0]} ${tip[1]}`} stroke="#cbd5e1" strokeWidth="2.4" strokeLinecap="round" />
                        <path d={`M${X(70)} 126 L${tip[0]} ${tip[1]}`} stroke="#64748b" strokeWidth="0.8" strokeLinecap="round" />
                        <path d={`M${ankle[0] - 4} ${ankle[1]} L${tip[0]} ${tip[1] - 3} L${ankle[0] + 4} ${ankle[1]}`} stroke="#facc15" strokeWidth="1.4" fill="none" />
                        {[140, 166, 190, 208].map(y => <rect key={y} x={Math.min(X(70), X(92)) } y={y - 1.8} width="22" height="3.6" rx="1" fill="#facc15" opacity="0.9" stroke="#713f12" strokeWidth="0.4" />)}
                        <rect x={tip[0] - 2.5} y={tip[1] - 3} width="5" height="4" rx="1" fill="#facc15" />
                    </g>;
                }
                if (k.type === 'splint' || k.type === 'plaster') {
                    const [a, b] = segFor(k.region, k.side, g);
                    const leg = !(ARM_REGIONS.has(k.region) || k.region === 'arm');
                    return <g key={n} data-part={k.type}><Slab a={a} b={b} w={leg ? 15 : 11} fill={k.type === 'splint' ? '#f97316' : '#f5f5f4'} stroke={k.type === 'splint' ? '#9a3412' : '#a8a29e'} lines={k.type === 'splint' ? 3 : 5} /></g>;
                }
                if (k.type === 'tourniquet') {
                    const s = k.side, X = (x) => mx(s, x);
                    const p = k.limb === 'leg' ? [X(84), 142] : [X(68), 72];
                    const w = k.limb === 'leg' ? 20 : 15;
                    return <g key={n} data-part="tourniquet"><rect x={p[0] - w / 2} y={p[1] - 2.5} width={w} height="5" rx="1.5" fill="#0f172a" stroke="#475569" strokeWidth="0.7" />
                        <path d={`M${p[0] - 5} ${p[1] - 5} L${p[0] + 5} ${p[1] + 5}`} stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" /><rect x={p[0] + (s === 'L' ? 7 : -12)} y={p[1] - 7} width="5" height="4" rx="1" fill="#dc2626" /></g>;
                }
                if (k.type === 'chestseal') {
                    const p = POINT.chest(k.side);
                    return <g key={n} data-part="chestseal"><circle cx={p[0]} cy={p[1]} r="7" fill="#e0f2fe" fillOpacity="0.55" stroke="#0ea5e9" strokeWidth="1" /><rect x={p[0] - 2} y={p[1] - 2} width="4" height="4" rx="1" fill="#0ea5e9" /></g>;
                }
                if (k.type === 'dressing') {
                    const spots = list.filter(i => ['wound', 'amputation', 'evisceration', 'impaled'].indexOf(i.kind) !== -1 || (i.kind === 'fracture' && i.open));
                    return <g key={n} data-part="dressing">{spots.map((i, m) => {
                        let p = pointFor(i, g);
                        if (i.kind === 'amputation') { const s = i.side === 'L' ? 'L' : 'R'; p = ((LEG_REGIONS.has(i.region) || i.region === 'leg') ? g[s].leg.stump : g[s].arm.stump) || p; p = [p[0], p[1] + 2]; }
                        return <g key={m}><rect x={p[0] - 5.5} y={p[1] - 4.5} width="11" height="9" rx="1.5" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="0.6" /><circle cx={p[0] + 0.5} cy={p[1]} r="2" fill="#dc2626" opacity="0.45" /></g>;
                    })}</g>;
                }
                if (k.type === 'clingfilm') return <g key={n} data-part="clingfilm">{list.filter(i => i.kind === 'burn').map((i, m) => {
                    const b = burnShape(i, g);
                    return <g key={m}><ellipse cx={b.c[0]} cy={b.c[1]} rx={b.rx + 1.5} ry={b.ry + 1.5} fill="#e0f2fe" fillOpacity="0.28" stroke="#f8fafc" strokeOpacity="0.7" strokeWidth="0.6" />
                        <path d={`M${b.c[0] - b.rx * 0.6} ${b.c[1] - b.ry * 0.2} l${b.rx * 0.5} ${-b.ry * 0.4}`} stroke="#ffffff" strokeOpacity="0.7" strokeWidth="0.8" /></g>;
                })}</g>;
                return null;
            })}
        </g>
    );

    // ---- the editor ---------------------------------------------------------------------------
    function InjuryEditor({ scenario, onChange, onClose }) {
        const { Modal, Button, Lucide } = window;
        const list = forScenario(scenario);
        const own = Array.isArray(scenario.injuries);
        const [pick, setPick] = useState(0);
        const [side, setSide] = useState('R');
        const preset = PRESETS[pick];
        const add = () => {
            const sides = preset.sided ? (side === 'both' ? ['R', 'L'] : [side]) : [preset.region === 'chest' && preset.kind === 'burn' ? 'C' : null];
            const next = list.concat(sides.map(s => ({ region: preset.region, kind: preset.kind, side: s, open: false, guessed: false })));
            onChange(tidy(next.map(i => Object.assign({}, i))));
        };
        const remove = (n) => onChange(list.filter((_, m) => m !== n));
        return (
            <Modal fixed label="Injuries on the patient picture" onClose={onClose}>
                <div className="bg-slate-800 p-5 rounded-lg border border-slate-600 w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col" data-testid="injury-editor">
                    <div className="flex justify-between items-start mb-3 gap-2">
                        <div className="min-w-0">
                            <h3 className="text-lg font-bold text-white uppercase tracking-wider">Injuries</h3>
                            <p className="text-[11px] text-slate-400">What the patient picture on this controller shows. {own ? 'You have changed the list.' : 'Read from the scenario’s own words.'} The team does not see this picture.</p>
                        </div>
                        <button aria-label="Close" onClick={onClose} className="text-slate-400 hover:text-white flex-none"><Lucide icon="x" className="w-5 h-5" /></button>
                    </div>
                    <div className="space-y-1.5 overflow-y-auto flex-grow pr-1 mb-3" data-testid="injury-list">
                        {list.length === 0 && <p className="text-sm text-slate-400 italic">No injuries.</p>}
                        {list.map((i, n) => (
                            <div key={n} className="flex items-center justify-between gap-2 bg-slate-900 border border-slate-700 rounded px-2 py-1.5">
                                <span className="text-sm text-slate-100">{label(i)}</span>
                                <button type="button" onClick={() => remove(n)} aria-label={`Remove ${label(i)}`} className="text-[10px] uppercase font-bold px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700">Remove</button>
                            </div>
                        ))}
                    </div>
                    <div className="border-t border-slate-700 pt-3 flex flex-wrap gap-2 items-end">
                        <label className="flex flex-col gap-1 text-[11px] text-slate-400 font-bold uppercase flex-1 min-w-[12rem]">Add
                            <select value={pick} onChange={e => setPick(Number(e.target.value))} aria-label="Injury to add" className="bg-slate-900 border border-slate-600 rounded px-2 h-9 text-sm text-white normal-case font-normal">
                                {PRESETS.map((p, n) => <option key={n} value={n}>{p.name}</option>)}
                            </select>
                        </label>
                        {preset.sided && (
                            <label className="flex flex-col gap-1 text-[11px] text-slate-400 font-bold uppercase">Side
                                <select value={side} onChange={e => setSide(e.target.value)} aria-label="Side" className="bg-slate-900 border border-slate-600 rounded px-2 h-9 text-sm text-white normal-case font-normal">
                                    <option value="R">Right</option><option value="L">Left</option><option value="both">Both</option>
                                </select>
                            </label>
                        )}
                        <Button onClick={add} variant="primary" className="h-9 px-4">Add</Button>
                    </div>
                    <div className="border-t border-slate-700 pt-3 mt-3 grid grid-cols-2 gap-2">
                        <Button onClick={() => onChange(null)} variant="secondary" className="w-full" disabled={!own}>Scenario's own</Button>
                        <Button onClick={onClose} variant="outline" className="w-full">Done</Button>
                    </div>
                </div>
            </Modal>
        );
    }

    window.Injuries = { detect, forScenario, label, PRESETS, geometry, kitPlan, Limbs, InjuryLayer, KitLayer, InjuryEditor };
})();
