// The patient picture's artwork (images/patient/): the generated bodies cut into pieces, the trolley, and
// the kit and injury pictures. Positions are pixels on the 768 x 1376 canvas the bodies were drawn on;
// frame() turns them into the figure's 220 x 250 units. Made by the scripts in the project's
// sim/patient-art/source folder (segment.py, sheets.py): rerun them and paste their meta.json here
// if the art is redrawn.
(function () {
    const BODY = {"male":{"pieces":{"torso":[188,68,392,852],"chest":[250,310,272,260],"Rarm1":[172,432,86,134],"Rarm2":[170,528,74,116],"Rarm3":[170,610,60,100],"Rarm4":[168,694,64,134],"Rleg1":[260,868,108,166],"Rleg2":[272,984,82,164],"Rleg3":[274,1106,74,158],"Rleg4":[266,1226,76,108],"Larm1":[514,432,80,134],"Larm2":[526,528,72,118],"Larm3":[538,610,60,100],"Larm4":[536,694,64,136],"Lleg1":[400,868,108,166],"Lleg2":[414,984,84,162],"Lleg3":[422,1106,72,160],"Lleg4":[428,1228,74,106],"eyesClosed":[310,128,148,68]},"joints":{"R":{"arm":[[232,355],[215,450],[205,545],[198,628],[193,712],[205,822]],"leg":[[325,770],[321,885],[318,1000],[316,1122],[315,1245],[306,1325]]},"L":{"arm":[[538,355],[555,450],[567,545],[572,628],[577,712],[560,822]],"leg":[[450,770],[454,885],[458,1000],[460,1122],[462,1245],[468,1325]]}},"head":[385,165],"neck":[385,285],"chest":[385,440],"pelvis":[385,760],"eyes":[385,162]},"female":{"pieces":{"torso":[212,66,344,848],"chest":[260,310,252,242],"Rarm1":[194,430,74,140],"Rarm2":[184,528,72,122],"Rarm3":[176,612,62,102],"Rarm4":[168,696,58,132],"Rleg1":[260,860,110,148],"Rleg2":[270,958,90,174],"Rleg3":[274,1092,76,168],"Rleg4":[266,1222,76,112],"Larm1":[506,432,70,136],"Larm2":[518,530,68,120],"Larm3":[532,614,62,100],"Larm4":[544,696,56,130],"Lleg1":[402,860,106,150],"Lleg2":[408,958,92,176],"Lleg3":[420,1092,76,170],"Lleg4":[428,1224,74,110],"eyesClosed":[304,126,162,68]},"joints":{"R":{"arm":[[245,350],[225,448],[210,545],[200,630],[190,715],[205,822]],"leg":[[325,780],[321,878],[318,975],[314,1108],[310,1240],[300,1322]]},"L":{"arm":[[530,350],[548,448],[565,545],[572,630],[580,715],[560,822]],"leg":[[450,780],[454,878],[458,975],[462,1108],[465,1240],[472,1322]]}},"head":[385,160],"neck":[385,290],"chest":[385,430],"pelvis":[385,770],"eyes":[385,160]},"pregnant":{"pieces":{"torso":[212,66,344,848],"chest":[260,310,252,242],"Rarm1":[194,430,74,140],"Rarm2":[184,528,72,122],"Rarm3":[176,612,62,102],"Rarm4":[168,696,58,130],"Rleg1":[260,860,110,148],"Rleg2":[270,958,90,174],"Rleg3":[274,1092,76,170],"Rleg4":[268,1222,74,112],"Larm1":[506,432,68,136],"Larm2":[518,530,68,120],"Larm3":[532,614,62,100],"Larm4":[544,696,58,130],"Lleg1":[402,860,106,150],"Lleg2":[410,958,90,176],"Lleg3":[420,1092,76,170],"Lleg4":[428,1224,74,110],"eyesClosed":[304,126,162,68]},"joints":{"R":{"arm":[[245,350],[225,448],[210,545],[200,630],[190,715],[205,822]],"leg":[[325,780],[321,878],[318,975],[314,1108],[310,1240],[300,1322]]},"L":{"arm":[[530,350],[548,448],[565,545],[572,630],[580,715],[560,822]],"leg":[[450,780],[454,878],[458,975],[462,1108],[465,1240],[472,1322]]}},"head":[385,160],"neck":[385,290],"chest":[385,430],"pelvis":[385,770],"eyes":[385,160]},"child":{"pieces":{"torso":[198,94,370,842],"chest":[274,366,222,210],"Rarm1":[194,456,86,130],"Rarm2":[182,540,78,108],"Rarm3":[172,612,66,88],"Rarm4":[126,684,84,132],"Rleg1":[262,882,94,118],"Rleg2":[258,954,86,148],"Rleg3":[258,1062,68,126],"Rleg4":[228,1168,82,122],"Larm1":[490,458,80,132],"Larm2":[506,540,78,114],"Larm3":[528,612,68,88],"Larm4":[554,688,86,128],"Lleg1":[410,882,94,122],"Lleg2":[422,958,86,146],"Lleg3":[438,1064,68,124],"Lleg4":[456,1168,82,122],"eyesClosed":[304,186,164,68]},"joints":{"R":{"arm":[[262,400],[240,480],[222,560],[205,632],[190,705],[168,790]],"leg":[[322,830],[316,902],[310,975],[298,1082],[285,1190],[265,1270]]},"L":{"arm":[[508,400],[528,480],[545,560],[568,632],[588,705],[606,790]],"leg":[[452,830],[458,902],[465,975],[472,1082],[480,1190],[502,1270]]}},"head":[385,230],"neck":[385,330],"chest":[385,470],"pelvis":[385,800],"eyes":[385,220]}};
    const TROLLEY = [139, 13, 491, 1363];
    // Kit and injury pictures: their pixel sizes, for their shape
    const KIT = {"igel":[120,140],"cuff":[121,140],"burn":[116,140],"knife":[100,140],"drip":[101,140],"plaster":[140,46],"evisceration":[122,140],"bruise":[137,140],"binder":[140,55],"guedel":[128,140],"tourniquet":[140,44],"cprhands":[96,140],"mask":[133,140],"bvm":[140,73],"cannula":[140,90],"collar":[117,140],"swelling":[126,140],"vacsplint":[140,47],"catheter":[120,140],"chestseal":[140,139],"abrasion":[140,124],"lucas":[116,140],"dressing":[140,139],"spo2":[140,84],"drain":[119,140],"traction":[140,44],"cvc":[123,140],"tube":[112,140],"electrode":[140,140],"laceration":[124,140]};

    const BASE = 0.176;   // figure units per canvas pixel for an adult
    const num = (v) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

    // Which body, and how big: children under 12 get the child, smaller the younger they are.
    function pick(sex, age, pregnant) {
        const n = num(age);
        if (n !== null && n < 12) return { body: 'child', S: BASE * (n < 1 ? 0.62 : n < 5 ? 0.72 : 0.82) };
        return { body: pregnant ? 'pregnant' : sex === 'Female' ? 'female' : 'male', S: BASE };
    }

    // Canvas pixels to figure units for that body: centred on x = 95, the top of the head at y = 13.
    function frame(p) {
        p = p || pick('Male', null, false);
        const b = BODY[p.body], S = p.S;
        const ox = 95 - b.head[0] * S, oy = 13 - b.pieces.torso[1] * S;
        const at = (q) => [ox + q[0] * S, oy + q[1] * S];
        // The older drawings (cables, the mask, the ECG dots ...) were placed for the adult man: this
        // maps those places onto this body, by its neck, pelvis and shoulders.
        const M = BODY.male, mS = BASE, mo = [95 - M.head[0] * mS, 13 - M.pieces.torso[1] * mS];
        const mAt = (q) => [mo[0] + q[0] * mS, mo[1] + q[1] * mS];
        const shW = (B, f) => f(B.joints.L.arm[0])[0] - f(B.joints.R.arm[0])[0];
        const ky = (at(b.pelvis)[1] - at(b.neck)[1]) / (mAt(M.pelvis)[1] - mAt(M.neck)[1]);
        const kx = shW(b, at) / shW(M, mAt);
        const ty = at(b.neck)[1] - ky * mAt(M.neck)[1];
        const T = (q) => [95 + (q[0] - 95) * kx, ty + q[1] * ky];
        const matrix = `matrix(${kx} 0 0 ${ky} ${95 - 95 * kx} ${ty})`;
        return { body: p.body, S, ox, oy, at, T, kx, ky, matrix, art: b };
    }

    // A piece of the body as an <image>, placed in figure units.
    function place(F, box) { return { x: F.ox + box[0] * F.S, y: F.oy + box[1] * F.S, width: box[2] * F.S, height: box[3] * F.S }; }
    const src = (F, name) => `images/patient/body/${F.body}-${name === 'eyesClosed' ? 'eyes' : name}.webp`;
    const kitSrc = (name) => `images/patient/kit/${name}.webp`;
    // A kit picture's height for a given width (or width for a height)
    const kitH = (name, w) => KIT[name] ? w * KIT[name][1] / KIT[name][0] : w;

    window.BodyArt = { BODY, TROLLEY, KIT, BASE, pick, frame, place, src, kitSrc, kitH };
})();
