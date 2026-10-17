// THE PATIENT'S INJURIES, AND THE KIT ON THEM, for the patient picture on the controller
// (data/screens/patientstatus.js).
//
//   - detect(scenario) reads the injuries from the scenario's own words (title, presenting complaint,
//     profile): "stabbed in the left flank", "right wrist is deformed", "complete right below knee
//     amputation", "burns to the chest and arms". Only what the text says is drawn; a side the text
//     does not give is drawn on the right and labelled "side not stated".
//   - forScenario(scenario) is what the picture shows: the facilitator's own list (scenario.injuries,
//     set in the Injuries editor) when there is one, otherwise what detect() found.
//   - Body, InjuryLayer and KitLayer are the picture's layers, drawn from the artwork in
//     images/patient/ (data/screens/bodyart.js). The kit (collar, pelvic binder, traction splint,
//     splint, backslab, tourniquet, chest seal, dressing, cling film) appears when its intervention
//     is ticked, on the injured limb where there is one.
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
    // patient's RIGHT is on the LEFT of the picture. The body is the generated artwork in
    // images/patient/ (data/screens/bodyart.js), cut into a torso and four pieces per limb. Each
    // limb is a chain of six points from the art: the root (shoulder or hip), mid-bone, the elbow
    // or knee, mid-bone, the wrist or ankle, and the end of the hand or the toes. Pieces 1 to 4
    // start at points 1 to 4: a fracture turns the pieces below it about a point, and an
    // amputation leaves them off.
    const mx = (side, x) => side === 'L' ? 190 - x : x;
    const injAt = (list, side, regions, kinds) => list.find(i => i.side === side && regions.indexOf(i.region) !== -1 && (!kinds || kinds.indexOf(i.kind) !== -1));
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    // As SVG's rotate(deg cx cy): positive turns clockwise on the screen
    const rotAbout = (p, c, deg) => {
        const r = deg * Math.PI / 180, s = Math.sin(r), k = Math.cos(r), dx = p[0] - c[0], dy = p[1] - c[1];
        return [c[0] + dx * k - dy * s, c[1] + dx * s + dy * k];
    };
    const angle = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;

    // Where each point of a chain ends up: turned by every bend at or above its piece, the lowest
    // bend first (the nesting of the SVG groups in LimbArt), and moved up by `dy` (a hip fracture's
    // shortening) unless it is the root.
    function pose(rest, rot, dy) {
        return rest.map((q, i) => {
            if (i === 0) return q;
            let p = q;
            for (let j = Math.min(i, 4); j >= 1; j--) if (rot[j]) p = rotAbout(p, rest[j], rot[j]);
            return [p[0], p[1] + (dy || 0)];
        });
    }

    // The limbs' joints, bent where a fracture deforms them, short where an amputation took them.
    // `F` is the body's frame from BodyArt.frame() (the man when it is not given).
    function geometry(list, F) {
        const BA = window.BodyArt;
        F = F || BA.frame();
        const z = F.S / BA.BASE;
        const g = { F, T: F.T, z };
        ['R', 'L'].forEach(side => {
            const out = side === 'L' ? -1 : 1;     // the rotation that swings the lower part outward
            const has = (regions, kinds) => !!injAt(list, side, regions, kinds);
            const J = F.art.joints[side];
            const restA = J.arm.map(F.at), restL = J.leg.map(F.at);
            const ar = [0, 0, 0, 0, 0], lr = [0, 0, 0, 0, 0];
            if (has(['upperArm'], ['fracture'])) ar[1] = 18 * out;
            if (has(['forearm', 'arm'], ['fracture'])) ar[3] = 18 * out;
            if (has(['thigh'], ['fracture'])) lr[1] = 14 * out;
            if (has(['knee'], ['fracture'])) lr[2] = 12 * out;
            if (has(['shin', 'leg'], ['fracture'])) lr[3] = 14 * out;
            const hipFx = has(['hip'], ['fracture']);
            if (has(['ankle'], ['fracture'])) lr[4] += 30 * out;
            if (hipFx) lr[4] += 45 * out;          // shortened and externally rotated
            const dy = hipFx ? -5 * z : 0;
            const aCut = has(['forearm', 'arm'], ['amputation']) ? 3 : has(['hand'], ['amputation']) ? 4 : 5;
            const lCut = has(['thigh'], ['amputation']) ? 1 : has(['shin', 'leg'], ['amputation']) ? 3 : 5;
            const A = pose(restA, ar, 0), L = pose(restL, lr, dy);
            const arm = {
                rest: restA, rot: ar, cut: aCut, dy: 0, pts: A,
                segs: [{ pts: [A[0], A[2]] }, { pts: [A[2], A[Math.min(aCut, 4)]] }],
                hand: aCut === 5 ? lerp(A[4], A[5], 0.45) : null,
                stump: aCut < 5 ? A[aCut] : null,
                mid: { upperArm: A[1], forearm: A[3], hand: lerp(A[4], A[5], 0.45) }
            };
            const legSegs = [{ pts: [L[0], lCut === 1 ? L[1] : L[2]] }];
            if (lCut >= 3) legSegs.push({ pts: [L[2], L[Math.min(lCut, 4)]] });
            const leg = {
                rest: restL, rot: lr, cut: lCut, dy, pts: L, segs: legSegs,
                foot: lCut === 5 ? lerp(L[4], L[5], 0.5) : null,
                ankle: lCut === 5 ? L[4] : null,
                stump: lCut < 5 ? L[lCut] : null,
                mid: { hip: lerp(L[0], [95, L[0][1]], 0.25), thigh: L[1], knee: L[2], shin: L[3], ankle: L[4], foot: lerp(L[4], L[5], 0.5), leg: L[3] }
            };
            g[side] = { arm, leg };
        });
        return g;
    }

    // Places on the trunk and head, for the adult man; g.T moves them onto the body shown.
    const POINT = {
        head: () => [95, 15], face: () => [95, 36], neck: () => [95, 51], abdomen: () => [95, 108], pelvis: () => [95, 130],
        eye: (s) => [mx(s, 89), 28], chest: (s) => s === 'C' ? [95, 76] : [mx(s, 82), 80], flank: (s) => [mx(s, 74), 110],
        groin: (s) => [mx(s, 87), 141]
    };
    function pointFor(i, g) {
        if (POINT[i.region]) return g.T(POINT[i.region](i.side || 'R'));
        const side = i.side === 'L' ? 'L' : 'R';
        const G = g[side];
        if (ARM_REGIONS.has(i.region) || i.region === 'arm') return G.arm.mid[i.region === 'arm' ? 'forearm' : i.region];
        return G.leg.mid[i.region] || G.leg.mid.shin;
    }

    // ---- the layers ---------------------------------------------------------------------------
    // A kit or injury picture, centred on `c`, `w` wide (and `h` high, or its own shape), turned by `rot`.
    const Sprite = ({ name, c, w, h, rot, opacity, flip }) => {
        const H = h || window.BodyArt.kitH(name, w);
        const t = [rot ? `rotate(${rot} ${c[0]} ${c[1]})` : '', flip ? `translate(${2 * c[0]} 0) scale(-1 1)` : ''].join(' ').trim();
        return <image href={window.BodyArt.kitSrc(name)} x={c[0] - w / 2} y={c[1] - H / 2} width={w} height={H} preserveAspectRatio="none"
            transform={t || undefined} opacity={opacity} />;
    };

    // One limb: its pieces nested so each bend carries everything below it.
    const LimbArt = ({ F, side, limb, L }) => {
        const BA = window.BodyArt;
        let inner = null;
        for (let k = Math.min(L.cut - 1, 4); k >= 1; k--) {
            const box = BA.place(F, F.art.pieces[`${side}${limb}${k}`]);
            inner = <g transform={L.rot[k] ? `rotate(${L.rot[k]} ${L.rest[k][0]} ${L.rest[k][1]})` : undefined}>
                <image href={BA.src(F, `${side}${limb}${k}`)} {...box} preserveAspectRatio="none" />{inner}
            </g>;
        }
        return <g transform={L.dy ? `translate(0 ${L.dy})` : undefined}>{inner}</g>;
    };

    // The patient: the torso (head, trunk, shorts and the tops of the limbs), the chest rising and
    // falling with each breath, the eyes closed when they are, then the legs and the arms.
    // `tint` is the id of an SVG filter (cyanosed, or in arrest).
    const Body = ({ g, eyesClosed, breathe, breathDur, tint }) => {
        const BA = window.BodyArt, F = g.F;
        const torso = BA.place(F, F.art.pieces.torso), chest = BA.place(F, F.art.pieces.chest), eyes = BA.place(F, F.art.pieces.eyesClosed);
        const c = F.at(F.art.chest);
        return (
            <g data-part="body" filter={tint ? `url(#${tint})` : undefined}>
                <image href={BA.src(F, 'torso')} {...torso} preserveAspectRatio="none" />
                <g transform={`translate(${c[0]} ${c[1]})`}>
                    <g>
                        {breathe && <animateTransform attributeName="transform" type="scale" values="1 1;1.035 1.02;1 1" dur={breathDur} repeatCount="indefinite" />}
                        <image href={BA.src(F, 'chest')} x={chest.x - c[0]} y={chest.y - c[1]} width={chest.width} height={chest.height} preserveAspectRatio="none" />
                    </g>
                </g>
                {eyesClosed && <image data-part="eyes-closed" href={BA.src(F, 'eyesClosed')} {...eyes} preserveAspectRatio="none" />}
                <g data-part="limbs">
                    {['R', 'L'].map(side => <LimbArt key={'l' + side} F={F} side={side} limb="leg" L={g[side].leg} />)}
                    {['R', 'L'].map(side => <LimbArt key={'a' + side} F={F} side={side} limb="arm" L={g[side].arm} />)}
                </g>
            </g>
        );
    };

    const BURN_SHAPE = {
        chest: (s) => s === 'C' || !s ? { c: [95, 82], rx: 22, ry: 17 } : { c: [mx(s, 84), 82], rx: 11, ry: 15 },
        abdomen: () => ({ c: [95, 108], rx: 18, ry: 11 }), face: () => ({ c: [95, 32], rx: 12, ry: 13 }),
        eye: (s) => ({ c: [mx(s, 89), 28], rx: 4, ry: 3.5 }), neck: () => ({ c: [95, 51], rx: 7, ry: 6 }),
        head: () => ({ c: [95, 20], rx: 13, ry: 9 })
    };
    function burnShape(i, g) {
        if (BURN_SHAPE[i.region]) { const b = BURN_SHAPE[i.region](i.side); return { c: g.T(b.c), rx: b.rx * g.F.kx, ry: b.ry * g.F.ky, rot: 0 }; }
        const side = i.side === 'L' ? 'L' : 'R';
        const G = g[side], z = g.z;
        // along the limb: from one point of its chain to another
        const along = (P, a, b, w) => ({ c: lerp(P[a], P[b], 0.5), rx: w * z, ry: Math.hypot(P[b][0] - P[a][0], P[b][1] - P[a][1]) / 2 + 2 * z, rot: angle(P[a], P[b]) - 90 });
        const A = G.arm.pts, L = G.leg.pts;
        if (i.region === 'arm') return along(A, 0, Math.min(G.arm.cut, 4), 6);
        if (i.region === 'upperArm') return along(A, 0, 2, 6);
        if (i.region === 'forearm') return along(A, 2, Math.min(G.arm.cut, 4), 5.5);
        if (i.region === 'hand') return { c: G.arm.mid.hand, rx: 5 * z, ry: 7 * z, rot: 0 };
        if (i.region === 'leg') return along(L, 0, Math.min(G.leg.cut, 4), 8.5);
        if (i.region === 'thigh' || i.region === 'hip') return along(L, 0, Math.min(G.leg.cut, 2), 8);
        if (i.region === 'shin') return along(L, 2, Math.min(G.leg.cut, 4), 6.5);
        const p = G.leg.mid[i.region] || G.leg.mid.shin; return { c: p, rx: 7 * z, ry: 9 * z, rot: 0 };
    }

    // The raw end of an amputated limb, across the limb's line.
    const Stump = ({ p, from, w }) => (
        <g transform={`rotate(${angle(from, p) - 90} ${p[0]} ${p[1]})`}>
            <ellipse cx={p[0]} cy={p[1]} rx={w / 2} ry={w / 4} fill="#991b1b" stroke="#ef4444" strokeWidth="0.6" />
            <ellipse cx={p[0]} cy={p[1]} rx={w / 7} ry={w / 9} fill="#fef3c7" />
            <path d={`M${p[0] - w / 5} ${p[1] + w / 5} q-0.6 ${w / 3} 0 ${w / 1.8} M${p[0] + w / 6} ${p[1] + w / 5} q0.6 ${w / 4} 0 ${w / 2.4}`} stroke="#b91c1c" strokeWidth="1.1" fill="none" strokeLinecap="round" />
        </g>
    );

    const InjuryLayer = ({ list, g }) => {
        const z = g.z;
        return (
            <g data-part="injuries">
                {list.map((i, k) => {
                    const p = pointFor(i, g);
                    const id = `injury-${i.region}-${i.kind}`;
                    if (i.kind === 'pregnant') return null;   // the pregnant body is drawn instead
                    if (i.kind === 'burn') {
                        const b = burnShape(i, g);
                        return <g key={k} data-part={id}><Sprite name="burn" c={b.c} w={b.rx * 2} h={b.ry * 2} rot={b.rot} opacity={0.92} /></g>;
                    }
                    if (i.kind === 'amputation') {
                        const side = i.side === 'L' ? 'L' : 'R';
                        const isLeg = LEG_REGIONS.has(i.region) || i.region === 'leg';
                        const limb = isLeg ? g[side].leg : g[side].arm;
                        if (!limb.stump) return null;
                        return <g key={k} data-part={id}><Stump p={limb.stump} from={limb.pts[limb.cut - 1]} w={(isLeg ? (limb.cut === 1 ? 15 : 10) : 7) * z} /></g>;
                    }
                    if (i.kind === 'evisceration') return <g key={k} data-part={id}><Sprite name="evisceration" c={p} w={22 * z} /></g>;
                    if (i.kind === 'impaled') return <g key={k} data-part={id}><Sprite name="knife" c={[p[0] + 4 * z, p[1] - 7 * z]} w={15 * z} /></g>;
                    if (i.kind === 'wound') return <g key={k} data-part={id}><Sprite name="laceration" c={p} w={9 * z} rot={-15} /></g>;
                    if (i.kind === 'crush') {
                        if (i.region === 'leg') { const G = g[i.side === 'L' ? 'L' : 'R'].leg.mid; return <g key={k} data-part={id}><Sprite name="bruise" c={G.thigh} w={14 * z} h={26 * z} /><Sprite name="abrasion" c={G.shin} w={12 * z} h={22 * z} /></g>; }
                        return <g key={k} data-part={id}><Sprite name="bruise" c={p} w={18 * z} /><Sprite name="abrasion" c={p} w={12 * z} /></g>;
                    }
                    if (i.kind === 'fracture') {
                        const limb = LEG_REGIONS.has(i.region) || ARM_REGIONS.has(i.region) || i.region === 'leg' || i.region === 'arm';
                        if (i.region === 'chest') {
                            const q = g.T([mx(i.side === 'L' ? 'L' : 'R', 73), 90]);
                            return <g key={k} data-part={id}><Sprite name="bruise" c={q} w={15 * z} h={19 * z} />
                                <path d={`M${q[0] - 5} ${q[1] - 6} l9 2 M${q[0] - 5} ${q[1]} l9 2 M${q[0] - 5} ${q[1] + 6} l9 2`} stroke="#fca5a5" strokeWidth="0.8" strokeDasharray="2 1.2" /></g>;
                        }
                        if (i.region === 'pelvis') return <g key={k} data-part={id}><Sprite name="bruise" c={g.T([95, 132])} w={34 * z} h={12 * z} /></g>;
                        return <g key={k} data-part={id}>
                            <Sprite name="swelling" c={p} w={(limb ? 13 : 15) * z} />
                            <Sprite name="bruise" c={p} w={(limb ? 9 : 12) * z} opacity={0.8} />
                            {i.open && <><Sprite name="laceration" c={[p[0] + 1, p[1] + 1]} w={8 * z} rot={60} /><path d={`M${p[0] - 1} ${p[1] - 1} l${3 * z} ${-3 * z}`} stroke="#fefce8" strokeWidth={1.6 * z} strokeLinecap="round" /></>}
                        </g>;
                    }
                    // bruising, or an injury the text does not describe further
                    if (i.region === 'head') return <g key={k} data-part={id}><Sprite name="bruise" c={[p[0] - 6, p[1] + 2]} w={11 * z} /><Sprite name="laceration" c={[p[0] - 5, p[1] + 1]} w={7 * z} rot={15} /></g>;
                    if (i.region === 'eye') return <g key={k} data-part={id}><Sprite name="bruise" c={p} w={10 * z} h={8 * z} /></g>;
                    if (i.region === 'abdomen' && i.kind === 'bruise') return <g key={k} data-part={id}><Sprite name="bruise" c={p} w={32 * z} h={9 * z} rot={-25} /></g>;
                    if (i.kind === 'bruise') return <g key={k} data-part={id}><Sprite name="bruise" c={p} w={13 * z} /></g>;
                    return <g key={k} data-part={id}><Sprite name="abrasion" c={p} w={12 * z} /></g>;
                })}
            </g>
        );
    };

    // The kit on the patient. `has(key)` is whether that intervention is on.
    const LIMB_TARGETS = ['thigh', 'shin', 'leg', 'knee', 'ankle', 'foot', 'hip', 'forearm', 'arm', 'upperArm', 'hand'];
    function kitPlan(list, has) {
        const kit = [];
        const fx = list.filter(i => i.kind === 'fracture' && LIMB_TARGETS.indexOf(i.region) !== -1);
        const sideOf = (i) => i && i.side === 'L' ? 'L' : 'R';
        if (has('Scoop')) kit.push({ type: 'scoop', name: 'Scoop stretcher' });
        if (has('Collar')) kit.push({ type: 'collar', name: 'Collar' });
        if (has('HeadBlocks')) kit.push({ type: 'blocks', name: 'Head blocks' });
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

    // The two ends of the part of a limb a splint or backslab covers.
    function segFor(region, side, g) {
        const G = g[side];
        const arm = G.arm.segs, leg = G.leg.segs, L = G.leg.pts;
        const first = (s) => s.pts[0], last = (s) => s.pts[s.pts.length - 1];
        if (region === 'upperArm') return [first(arm[0]), last(arm[0])];
        if (ARM_REGIONS.has(region) || region === 'arm') return [first(arm[1]), region === 'hand' && G.arm.hand ? G.arm.pts[5] : last(arm[1])];
        if (region === 'thigh' || region === 'hip') return [first(leg[0]), last(leg[0])];
        if (region === 'knee') return [L[1], leg[1] ? L[3] : last(leg[0])];
        if (leg[1]) {
            if (region === 'ankle' || region === 'foot') return G.leg.foot ? [L[3], L[5]] : [L[3], last(leg[1])];
            return [first(leg[1]), last(leg[1])];
        }
        return [first(leg[0]), last(leg[0])];
    }
    // A kit picture laid along a limb from a to b
    const Along = ({ name, a, b, w, extra = 4 }) => {
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) + extra;
        return <Sprite name={name} c={lerp(a, b, 0.5)} w={len} h={w} rot={angle(a, b)} />;
    };

    const KitLayer = ({ kit, list, g }) => {
        const z = g.z, T = g.T;
        return (
            <g data-part="kit">
                {kit.map((k, n) => {
                    // the scoop stretcher's two orange halves either side of the patient, joined at the head and feet
                    if (k.type === 'scoop') {
                        const [x0, y0] = T([46, 0]), [x1, y1] = T([144, 246]);
                        return <g key={n} data-part="scoop" fill="none" stroke="#f97316" strokeOpacity="0.9" strokeLinejoin="round">
                            <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} rx={10 * z} strokeWidth={3.2 * z} />
                            <path d={`M${x0 + 4 * z} ${y0 + 4 * z} V${y1 - 4 * z} M${x1 - 4 * z} ${y0 + 4 * z} V${y1 - 4 * z}`} strokeWidth={0.8 * z} strokeDasharray={`${4 * z} ${3 * z}`} />
                        </g>;
                    }
                    // head blocks either side of the head, and the tape across the forehead and chin
                    if (k.type === 'blocks') {
                        const w = 9 * g.F.kx, h = 26 * g.F.ky;
                        const [lx, ly] = T([75.5, 25]), [rx] = T([114.5, 25]);
                        const [tx0, ty] = T([77, 18]), [tx1, cy] = T([113, 43]);
                        return <g key={n} data-part="blocks">
                            <rect x={lx - w / 2} y={ly - h / 2} width={w} height={h} rx={2.5 * z} fill="#f97316" stroke="#7c2d12" strokeWidth={0.6 * z} />
                            <rect x={rx - w / 2} y={ly - h / 2} width={w} height={h} rx={2.5 * z} fill="#f97316" stroke="#7c2d12" strokeWidth={0.6 * z} />
                            <rect x={tx0} y={ty - 1.6 * z} width={tx1 - tx0} height={3.2 * z} fill="#fde68a" fillOpacity="0.9" stroke="#92400e" strokeWidth={0.4 * z} />
                            <rect x={tx0} y={cy - 1.6 * z} width={tx1 - tx0} height={3.2 * z} fill="#fde68a" fillOpacity="0.9" stroke="#92400e" strokeWidth={0.4 * z} />
                        </g>;
                    }
                    if (k.type === 'collar') return <g key={n} data-part="collar"><Sprite name="collar" c={T([95, 53])} w={25 * g.F.kx} h={26 * g.F.ky} /></g>;
                    if (k.type === 'binder') return <g key={n} data-part="binder"><Sprite name="binder" c={T([95, 131])} w={72 * g.F.kx} h={17 * g.F.ky} /></g>;
                    if (k.type === 'traction') {
                        const L = g[k.side].leg;
                        const end = L.ankle || L.stump;
                        const top = lerp(L.pts[0], L.pts[1], -0.2);
                        const tip = lerp(L.pts[2], end, 1.45);
                        // the picture runs from the pole's end (left) to the ischial pad (right)
                        return <g key={n} data-part="traction"><Along name="traction" a={tip} b={top} w={13 * z} extra={0} /></g>;
                    }
                    if (k.type === 'splint' || k.type === 'plaster') {
                        const [a, b] = segFor(k.region, k.side, g);
                        const leg = !(ARM_REGIONS.has(k.region) || k.region === 'arm');
                        return <g key={n} data-part={k.type}><Along name={k.type === 'splint' ? 'vacsplint' : 'plaster'} a={a} b={b} w={(leg ? 16 : 12) * z} extra={6 * z} /></g>;
                    }
                    if (k.type === 'tourniquet') {
                        const P = k.limb === 'leg' ? g[k.side].leg.pts : g[k.side].arm.pts;
                        const cut = (k.limb === 'leg' ? g[k.side].leg : g[k.side].arm).cut;
                        // above the wound: high on the thigh or upper arm, higher still above a stump there
                        const p = lerp(P[0], P[1], k.limb === 'leg' ? (cut === 1 ? 0.3 : 0.62) : 0.5);
                        const w = (k.limb === 'leg' ? 24 : 17) * z;
                        return <g key={n} data-part="tourniquet"><Sprite name="tourniquet" c={p} w={w} h={w * 0.32} rot={angle(P[0], P[1]) - 90} /></g>;
                    }
                    if (k.type === 'chestseal') return <g key={n} data-part="chestseal"><Sprite name="chestseal" c={T(POINT.chest(k.side))} w={15 * z} /></g>;
                    if (k.type === 'dressing') {
                        const spots = list.filter(i => ['wound', 'amputation', 'evisceration', 'impaled'].indexOf(i.kind) !== -1 || (i.kind === 'fracture' && i.open));
                        return <g key={n} data-part="dressing">{spots.map((i, m) => {
                            let p = pointFor(i, g);
                            if (i.kind === 'amputation') { const s = i.side === 'L' ? 'L' : 'R'; p = ((LEG_REGIONS.has(i.region) || i.region === 'leg') ? g[s].leg.stump : g[s].arm.stump) || p; }
                            return <Sprite key={m} name="dressing" c={p} w={(i.kind === 'evisceration' ? 20 : 11) * z} />;
                        })}</g>;
                    }
                    if (k.type === 'clingfilm') return <g key={n} data-part="clingfilm">{list.filter(i => i.kind === 'burn').map((i, m) => {
                        const b = burnShape(i, g);
                        return <g key={m} transform={b.rot ? `rotate(${b.rot} ${b.c[0]} ${b.c[1]})` : undefined}><ellipse cx={b.c[0]} cy={b.c[1]} rx={b.rx + 1.5} ry={b.ry + 1.5} fill="#e0f2fe" fillOpacity="0.28" stroke="#f8fafc" strokeOpacity="0.7" strokeWidth="0.6" />
                            <path d={`M${b.c[0] - b.rx * 0.6} ${b.c[1] - b.ry * 0.2} l${b.rx * 0.5} ${-b.ry * 0.4}`} stroke="#ffffff" strokeOpacity="0.7" strokeWidth="0.8" /></g>;
                    })}</g>;
                    return null;
                })}
            </g>
        );
    };

    // ---- the editor ---------------------------------------------------------------------------
    // The list with Remove buttons and the "Add" row: inside the Injuries window below, and in the
    // controller's "Set up the patient" window (data/screens/patientstatus.js).
    function InjuryPicker({ scenario, onChange }) {
        const { Button } = window;
        const list = forScenario(scenario);
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
            <>
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
            </>
        );
    }

    function InjuryEditor({ scenario, onChange, onClose }) {
        const { Modal, Button, Lucide } = window;
        const own = Array.isArray(scenario.injuries);
        return (
            <Modal fixed label="Injuries on the patient picture" onClose={onClose}>
                <div className="bg-slate-800 p-5 rounded-lg border border-slate-600 w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col" data-testid="injury-editor">
                    <div className="flex justify-between items-start mb-3 gap-2">
                        <div className="min-w-0">
                            <h3 className="text-lg font-bold text-white uppercase tracking-wider">Injuries</h3>
                            <p className="text-[11px] text-slate-400">What the patient picture shows. {own ? 'You have changed the list.' : 'Read from the scenario’s own words.'} The team sees the picture only when you show it on the monitor.</p>
                        </div>
                        <button aria-label="Close" onClick={onClose} className="text-slate-400 hover:text-white flex-none"><Lucide icon="x" className="w-5 h-5" /></button>
                    </div>
                    <InjuryPicker scenario={scenario} onChange={onChange} />
                    <div className="border-t border-slate-700 pt-3 mt-3 grid grid-cols-2 gap-2">
                        <Button onClick={() => onChange(null)} variant="secondary" className="w-full" disabled={!own}>Scenario's own</Button>
                        <Button onClick={onClose} variant="outline" className="w-full">Done</Button>
                    </div>
                </div>
            </Modal>
        );
    }

    window.Injuries = { detect, forScenario, label, PRESETS, geometry, pointFor, kitPlan, Sprite, Body, InjuryLayer, KitLayer, InjuryPicker, InjuryEditor };
})();
