// data/generators.js

// --- MATH HELPERS ---
window.getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
window.getRandomFloat = (min, max, decimals) => parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
window.getRandomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];
window.clamp = (val, min, max) => Math.min(Math.max(val, min), max);

// --- PROFILE TEMPLATE INTERPOLATION ---
// Scenario briefs are stored as templates containing {age} / {sex} placeholders. Anything that
// renders a brief (preview card, builder, live dashboard) must go through here, otherwise the raw
// placeholder leaks into the UI.
// Ages are held in YEARS everywhere (WETFLAG, weight, energy and doses all need the real value), so
// an infant is a fraction: 4 months = 0.33, 6 weeks = 0.12. formatAge turns that into what a
// clinician would say: "newborn", "5 days", "6 weeks" (under 8 weeks), "4 months" (under 1 year,
// and for a fractional age under 2 years), then whole years. `adjective: true` gives the
// hyphenated form for "A 6-week-old", and screens that show an age should use this rather than
// printing patientAge with a "y" after it.
window.formatAge = (age, opts = {}) => {
    const adj = !!opts.adjective;
    const a = (age === undefined || age === null || age === '') ? NaN : Number(age);
    if (!Number.isFinite(a) || a < 0) return adj ? 'unknown-age' : 'unknown age';
    const unit = (n, word) => adj ? `${n}-${word}-old` : `${n} ${word}${n === 1 ? '' : 's'}`;
    if (a === 0) return 'newborn';
    const days = Math.round(a * 365.25);
    if (days < 7) return unit(Math.max(1, days), 'day');
    const weeks = Math.round(a * 365.25 / 7);
    if (weeks < 8) return unit(weeks, 'week');
    if (a < 1 || (a < 2 && !Number.isInteger(a))) return unit(Math.min(23, Math.max(2, Math.round(a * 12))), 'month');
    return unit(Math.floor(a), 'year');
};

window.formatProfileTemplate = (template, age, sex) => {
    if (!template) return "";
    const sexStr = sex ? String(sex).toLowerCase() : 'patient';
    return String(template)
        .replace(/\{age\}-year-old/g, window.formatAge(age, { adjective: true }))
        .replace(/\{age\}/g, window.formatAge(age))
        .replace(/\{sex\}/g, sexStr)
        // "A 8-year-old" / "A 11-year-old" / "A 80-year-old" read wrongly once the number is in.
        .replace(/\b([Aa]) (?=(?:8\d*|11|18)-)/g, '$1n ');
};

// Preview cards render before a patient is generated, so there is no patientAge yet. Draw one
// representative age per scenario and cache it so card text stays stable across re-renders.
const previewAgeCache = {};
window.getPreviewAge = (scenario) => {
    if (!scenario) return 40;
    if (scenario.patientAge !== undefined && scenario.patientAge !== null) return scenario.patientAge;
    const key = scenario.id || scenario.title;
    if (previewAgeCache[key] === undefined) {
        try { previewAgeCache[key] = scenario.ageGenerator ? scenario.ageGenerator() : 40; }
        catch (e) { previewAgeCache[key] = 40; }
    }
    return previewAgeCache[key];
};

window.getScenarioPreviewText = (scenario) => {
    if (!scenario) return "";
    const template = scenario.patientProfileTemplate || scenario.profile || "";
    return window.formatProfileTemplate(template, window.getPreviewAge(scenario), scenario.sex);
};

// --- SESSION RESTORE ---
// A persisted scenario has been through JSON, so generator functions are gone and older snapshots
// may only contain {id, title}. Re-merge over the live base definition and guarantee that every
// field a screen dereferences exists, so a resume can never throw during render.
window.rehydrateScenario = (saved) => {
    if (!saved) return null;
    let base = null;
    try {
        base = (window.ALL_SCENARIOS || []).find(s => s.id === saved.id) || null;
        if (!base && saved.id) {
            const custom = JSON.parse(localStorage.getItem('wmebem_custom_scenarios') || '[]');
            base = custom.find(s => s.id === saved.id) || null;
        }
    } catch (e) { base = null; }
    const merged = { ...(base || {}), ...saved };
    if (!merged.title) merged.title = 'Restored Scenario';
    if (!merged.patientProfileTemplate) merged.patientProfileTemplate = merged.profile || 'Patient details unavailable for this restored session.';
    if (!merged.profile) merged.profile = window.formatProfileTemplate(merged.patientProfileTemplate, merged.patientAge, merged.sex);
    if (!merged.instructorBrief) merged.instructorBrief = {};
    if (!Array.isArray(merged.recommendedActions)) merged.recommendedActions = [];
    return merged;
};

// --- BUILDER INPUT VALIDATION ---
// Physiologically plausible bounds. Values outside these are almost always typos, and previously
// propagated silently into WETFLAG maths and the debrief chart.
window.BUILDER_LIMITS = {
    age:   { min: 0,  max: 120, label: 'Age',         unit: 'years' },
    hr:    { min: 0,  max: 300, label: 'Heart Rate',  unit: 'bpm' },
    bpSys: { min: 0,  max: 300, label: 'Systolic BP', unit: 'mmHg' },
    rr:    { min: 0,  max: 100, label: 'Resp Rate',   unit: '/min' },
    spO2:  { min: 0,  max: 100, label: 'SpO2',        unit: '%' },
    gcs:   { min: 3,  max: 15,  label: 'GCS',         unit: '' },
    temp:  { min: 20, max: 45,  label: 'Temp',        unit: '°C' },
    bpDia: { min: 0,  max: 250, label: 'Diastolic BP', unit: 'mmHg' },
    etco2: { min: 0,  max: 15,  label: 'EtCO2',       unit: 'kPa' },
    bm:    { min: 0,  max: 50,  label: 'Glucose',     unit: 'mmol/L' },
    icp:   { min: 0,  max: 80,  label: 'ICP',         unit: 'mmHg' },
    // PH is a modelled vital now (bicarbonate/ventilation teaching), so the facilitator's
    // manual-control modal needs a limit entry or it would silently accept any number.
    ph:    { min: 6.5, max: 7.9, label: 'pH',         unit: '' },
    // Serum potassium is a modelled vital (hyperkalaemia + DKA teaching), so the
    // facilitator's manual-control modal needs a limit entry of its own.
    k:     { min: 1.5, max: 9.5, label: 'Potassium',  unit: 'mmol/L' },
    // 0.5 kg is a 23-week neonate; 300 kg covers bariatric. Zero or negative previously divided
    // through the WETFLAG maths and produced 0 J shock energy and 0 mL fluid boluses.
    weight: { min: 0.5, max: 300, label: 'Weight',    unit: 'kg' }
};

window.validateBuilderField = (field, rawValue) => {
    const limit = window.BUILDER_LIMITS[field];
    if (!limit) return null;
    if (rawValue === '' || rawValue === null || rawValue === undefined) return `${limit.label} is required.`;
    const num = Number(rawValue);
    if (!Number.isFinite(num)) return `${limit.label} must be a number.`;
    if (num < limit.min || num > limit.max) return `${limit.label} must be between ${limit.min} and ${limit.max} ${limit.unit}`.trim() + '.';
    return null;
};

// --- NAME GENERATOR ---
window.generateName = (sex) => {
    const male = ["James", "John", "Robert", "Michael", "William", "David", "Richard", "Joseph", "Thomas", "Charles", "George", "Harry", "Jack", "Oliver", "Noah", "Arthur", "Leo"];
    const female = ["Mary", "Patricia", "Jennifer", "Linda", "Elizabeth", "Barbara", "Susan", "Jessica", "Sarah", "Karen", "Olivia", "Amelia", "Isla", "Ava", "Mia", "Grace", "Lily"];
    const sur = ["Smith", "Jones", "Williams", "Taylor", "Brown", "Davies", "Evans", "Wilson", "Thomas", "Johnson", "Roberts", "Robinson", "Thompson", "Wright", "Walker", "White", "Edwards", "Hughes", "Green", "Hall"];
    
    const first = sex === 'Female' ? window.getRandomItem(female) : window.getRandomItem(male);
    return `${first} ${window.getRandomItem(sur)}`;
};

// --- MEDICAL GENERATORS ---
window.generateHistory = (age, sex = 'Male') => {
    if (age < 20) return { pmh: ["Nil significant"], dhx: ["Nil"], allergies: ["Nil"] };
    const commonPMH = ["Hypertension", "Type 2 Diabetes", "Asthma", "Hyperlipidaemia", "GORD", "Depression", "Anxiety", "Previous MI", "AF", "CKD Stage 3"];
    const femalePMH = ["PCOS", "Endometriosis", "Previous C-Section"];
    let pmh = []; let dhx = [];
    const pmhCount = age > 60 ? window.getRandomInt(1, 4) : age > 40 ? window.getRandomInt(0, 2) : window.getRandomInt(0, 1);
    for(let i=0; i<pmhCount; i++) { const item = window.getRandomItem(commonPMH); if(!pmh.includes(item)) pmh.push(item); }
    if (sex === 'Female' && Math.random() > 0.8) pmh.push(window.getRandomItem(femalePMH));
    if (pmh.includes("Hypertension")) dhx.push("Ramipril 5mg OD");
    if (pmh.includes("Type 2 Diabetes")) dhx.push("Metformin 1g BD");
    if (pmh.includes("Asthma")) dhx.push("Salbutamol PRN", "Beclometasone BD");
    if (pmh.includes("Hyperlipidaemia")) dhx.push("Atorvastatin 20mg ON");
    if (pmh.includes("GORD")) dhx.push("Omeprazole 20mg OD");
    if (pmh.includes("AF")) dhx.push("Bisoprolol 2.5mg OD", "Edoxaban 60mg OD");
    if (pmh.includes("Previous MI")) dhx.push("Aspirin 75mg OD", "Atorvastatin 80mg ON", "Bisoprolol 2.5mg OD");
    if (pmh.length === 0) pmh.push("Nil significant");
    if (dhx.length === 0) dhx.push("Nil regular medications");
    return { pmh: pmh, dhx: dhx, allergies: [Math.random() > 0.8 ? window.getRandomItem(["Penicillin", "Latex", "NSAIDs", "Trimethoprim"]) : "NKDA"] };
};

// Age-stratified alarm thresholds (heart rate, respiratory rate)
window.getAlarmThresholds = (age) => {
    if (age == null) age = 40;
    if (age < 1)        return { hr: { low: 100, high: 180 }, rr: { low: 30, high: 60 }, spO2: 92 };
    if (age <= 2)       return { hr: { low: 90,  high: 160 }, rr: { low: 24, high: 40 }, spO2: 92 };
    if (age <= 5)       return { hr: { low: 80,  high: 140 }, rr: { low: 22, high: 34 }, spO2: 92 };
    if (age <= 12)      return { hr: { low: 60,  high: 120 }, rr: { low: 18, high: 30 }, spO2: 92 };
    if (age > 65)       return { hr: { low: 50,  high: 110 }, rr: { low: 10, high: 24 }, spO2: 90 };
    return                     { hr: { low: 40,  high: 130 }, rr: { low: 8,  high: 30 }, spO2: 90 };
};

window.getBaseVitals = (age) => {
    let v = { hr: 75, rr: 16, bpSys: 120, bpDia: 75, temp: 36.8, bm: 5.8, gcs: 15, pupils: 3 }; 
    if (age < 1) v = { hr: 145, rr: 45, bpSys: 75, bpDia: 45, temp: 37.0, bm: 4.5, gcs: 15, pupils: 3 }; 
    else if (age <= 2) v = { hr: 125, rr: 30, bpSys: 90, bpDia: 55, temp: 37.0, bm: 5.0, gcs: 15, pupils: 3 }; 
    else if (age <= 5) v = { hr: 110, rr: 25, bpSys: 95, bpDia: 60, temp: 37.0, bm: 5.0, gcs: 15, pupils: 3 }; 
    else if (age <= 12) v = { hr: 90, rr: 20, bpSys: 105, bpDia: 65, temp: 36.8, bm: 5.5, gcs: 15, pupils: 4 }; 
    else if (age > 65) v = { hr: 70, rr: 18, bpSys: 135, bpDia: 80, temp: 36.5, bm: 6.0, gcs: 15, pupils: 3 }; 
    return v;
};

// Sinus rate bands for naming a sinus rhythm when a scenario does not state one. Children: the APLS
// normal heart-rate ranges by age (under 1 year 110-160, 1-2 years 100-150, 2-5 years 95-140, 5-12
// years 80-120, over 12 years 60-100); adults: under 60 is a sinus bradycardia, over 100 a sinus
// tachycardia.
window.sinusRateBand = (age) => {
    const a = (age === undefined || age === null || age === '') ? 40 : Number(age);
    if (!Number.isFinite(a)) return { low: 60, high: 100 };
    if (a < 1)   return { low: 110, high: 160 };
    if (a < 2)   return { low: 100, high: 150 };
    if (a < 5)   return { low: 95,  high: 140 };
    if (a <= 12) return { low: 80,  high: 120 };
    return { low: 60, high: 100 };
};
// The default ECG for a scenario that does not author one: sinus, named from the heart rate.
window.sinusEcgForHr = (hr, age) => {
    const rate = Number(hr);
    const band = window.sinusRateBand(age);
    if (Number.isFinite(rate) && rate > 0 && rate > band.high) return { type: 'Sinus Tachycardia', findings: `Sinus tachycardia, rate ${Math.round(rate)}`, derivedFromHr: true };
    if (Number.isFinite(rate) && rate > 0 && rate < band.low) return { type: 'Sinus Bradycardia', findings: `Sinus bradycardia, rate ${Math.round(rate)}`, derivedFromHr: true };
    return { type: 'Sinus Rhythm', findings: 'Normal sinus rhythm', derivedFromHr: true };
};

// RCUK Paediatric emergency drug chart (Guidelines 2025, updated Feb 2026): weights are averaged
// lean body mass from 50th-centile weights. Ages between the chart's rows are interpolated.
// Under 1 year the rows are in months (< 1 month 3.5 kg, 1 month 4, 3 months 5, 6 months 7).
const RCUK_WEIGHT_BY_AGE = [[0, 3.5], [1 / 12, 4], [0.25, 5], [0.5, 7], [1, 10], [2, 12], [3, 14], [4, 16], [5, 18],
    [6, 20], [7, 23], [8, 26], [10, 30], [12, 38], [14, 50]];
window.estimateWeight = (age) => {
    const a = Number(age);
    if (!Number.isFinite(a) || a < 0 || a >= 16) return null;
    const t = RCUK_WEIGHT_BY_AGE;
    if (a >= t[t.length - 1][0]) return t[t.length - 1][1];     // "Adolescent": 50 kg
    let i = 0;
    while (t[i + 1][0] <= a) i++;
    const [a0, w0] = t[i], [a1, w1] = t[i + 1];
    const w = w0 + (w1 - w0) * (a - a0) / (a1 - a0);
    return a < 1 ? Math.round(w * 2) / 2 : Math.round(w);
};

// Tracheal tube internal diameter (mm) from the same chart. Cuffed tubes are listed from 1 month;
// under 1 month the chart gives uncuffed only. Ages between rows take the row below.
const RCUK_TUBE_BY_AGE = [[0, null, '3.0'], [1 / 12, '3.0', '3.0–3.5'], [0.25, '3.0', '3.5'], [0.5, '3.0', '3.5'],
    [1, '3.5', '4.0'], [2, '4.0', '4.5'], [3, '4.0–4.5', '4.5–5.0'], [4, '4.5', '5.0'], [5, '4.5–5.0', '5.0–5.5'],
    [6, '5.0', '5.5'], [7, '5.0–5.5', '5.5–6.0'], [8, '6.0–6.5', null], [10, '7.0', null], [12, '7.0–7.5', null], [14, '7.0–8.0', null]];
window.rcukTubeSize = (age) => {
    const a = Number(age);
    if (!Number.isFinite(a) || a < 0) return null;
    let row = RCUK_TUBE_BY_AGE[0];
    RCUK_TUBE_BY_AGE.forEach(r => { if (r[0] <= a) row = r; });
    const [, cuffed, uncuffed] = row;
    return { cuffed, uncuffed, label: cuffed ? `${cuffed} cuffed` : `${uncuffed} uncuffed` };
};

// WETFLAG from the RCUK Paediatric emergency drug chart (2025): adrenaline 10 mcg/kg (max 1 mg),
// fluid bolus 10 ml/kg (max 500 ml), 10% glucose 2 ml/kg (the chart tops out at 50 ml), lorazepam
// 100 mcg/kg (max 4 mg), defibrillation 4 J/kg.
window.calculateWetflag = (age, weightStr) => {
    const weight = parseFloat(weightStr);
    if (isNaN(weight) || weight <= 0) return null;
    const tube = window.rcukTubeSize(age);
    return {
        weight: weight,
        // 4 J/kg, but computed by the shared registry so the WETFLAG card, the assessor's
        // energy ladder, the monitor-hosted defib and the standalone defib page can never disagree
        // about what this patient needs (the standalone page used to hardcode 120 J for everyone).
        energy: (window.RHYTHMS ? window.RHYTHMS.recommendedEnergy(weight, age) : Math.round(weight * 4)),
        tube: tube ? tube.label : '',
        tubeCuffed: tube ? tube.cuffed : null,
        tubeUncuffed: tube ? tube.uncuffed : null,
        fluids: Math.min(500, Math.round(weight * 10)),
        lorazepam: Math.min(4, weight * 0.1).toFixed(1),
        adrenaline: Math.min(1000, Math.round(weight * 10)),
        glucose: Math.min(50, Math.round(weight * 2))
    };
};

window.generateVbg = (clinicalState = "normal") => {
    let vbg = { pH: 7.40, pCO2: 5.3, pO2: 5.0, HCO3: 24, BE: 0, Lac: 1.0, K: 4.0, Glu: 5.5, Ketones: 0.2 };
    vbg.pH += window.getRandomFloat(-0.03, 0.03, 2);
    switch (clinicalState) {
        case "dka_severe": vbg = { pH: 6.95, pCO2: 2.5, pO2: 4.0, HCO3: 5, BE: -24, Lac: 2.5, K: 5.4, Glu: 28.0, Ketones: 5.8 }; break;
        // HHS (JBDS-IP 2022 criteria): glucose >= 30 mmol/L, osmolality >= 320 mOsm/kg, pH >= 7.3,
        // bicarbonate >= 15 mmol/L, ketones < 3 mmol/L. Hypernatraemic and dry, not acidotic.
        case "hhs": vbg = { pH: 7.34, pCO2: 5.0, pO2: 5.0, HCO3: 20, BE: -4, Lac: 2.2, K: 4.8, Na: 152, Glu: 42.0, Ketones: 1.0, Osm: 360 }; break;
        case "septic_shock": vbg = { pH: 7.25, pCO2: 4.5, pO2: 3.5, HCO3: 16, BE: -8, Lac: 6.5, K: 4.2, Glu: 4.0, Ketones: 0.5 }; break;
        case "haemorrhagic_shock": vbg = { pH: 7.20, pCO2: 4.8, pO2: 3.5, HCO3: 14, BE: -10, Lac: 8.0, K: 3.8, Glu: 9.0, Ketones: 1.2 }; break;
        case "copd_retainer": vbg = { pH: 7.30, pCO2: 9.5, pO2: 4.5, HCO3: 34, BE: 8, Lac: 1.2, K: 4.0, Glu: 6.0, Ketones: 0.2 }; break;
        case "respiratory_acidosis_acute": vbg = { pH: 7.15, pCO2: 9.5, pO2: 3.0, HCO3: 24, BE: 0, Lac: 1.5, K: 4.1, Glu: 6.2, Ketones: 0.2 }; break;
        case "metabolic_acidosis_severe": vbg = { pH: 6.90, pCO2: 6.0, pO2: 3.5, HCO3: 10, BE: -22, Lac: 12.0, K: 6.5, Glu: 6.0, Ketones: 0.4 }; break;
        case "metabolic_alkalosis": vbg = { pH: 7.50, pCO2: 5.8, pO2: 5.2, HCO3: 30, BE: 6, Lac: 1.0, K: 3.0, Glu: 5.5, Ketones: 0.2 }; break;
        case "hyperkalemia": vbg = { pH: 7.35, pCO2: 5.0, pO2: 4.8, HCO3: 22, BE: -2, Lac: 1.5, K: 7.5, Glu: 6.0, Ketones: 0.2 }; break;
        case "hyponatremia": vbg = { pH: 7.40, pCO2: 5.3, pO2: 5.0, HCO3: 24, BE: 0, Lac: 1.2, K: 4.0, Na: 115, Glu: 5.5, Ketones: 0.2 }; break;
        case "gi_bleed": vbg = { pH: 7.32, pCO2: 4.8, pO2: 4.2, HCO3: 20, BE: -4, Lac: 3.5, K: 4.1, Glu: 6.5, Ketones: 1.5 }; break; 
        case "hypercalcemia": vbg = { pH: 7.42, pCO2: 5.3, pO2: 5.0, HCO3: 24, BE: 0, Lac: 1.2, K: 4.0, Ca: 3.5, Glu: 5.5, Ketones: 0.2 }; break;
        case "hypothermia": vbg = { pH: 7.30, pCO2: 5.0, pO2: 4.0, HCO3: 22, BE: -2, Lac: 2.5, K: 3.5, Glu: 4.5, Ketones: 0.3 }; break;
        case "co_poisoning": vbg = { pH: 7.35, pCO2: 5.0, pO2: 4.5, HCO3: 18, BE: -6, Lac: 4.0, K: 4.0, Glu: 6.0, Ketones: 0.2 }; break;
        default: break;
    }
    return vbg;
};

// HOW THE AUTHORED VBG AND THE DYNAMIC MODEL ARE RECONCILED (documented deliberately):
//   * The AUTHORED block WINS for the baseline. `startVbg` is the scenario's own authored `vbg`
//     (or the block materialised from `vbgClinicalState`), resolved once in enrichScenario and
//     stored on BOTH scenario.vbg and scenario.investigations.vbg so they cannot disagree.
//   * This function only ever applies DELTAS on top of that baseline, for the analytes it actually
//     models: pH, pCO2, HCO3, Lac, K, Glu, Ketones.
//   * Any authored analyte this model does NOT touch — pO2, Na, Ca — is carried through verbatim.
//     An authored pO2 of 12 therefore stays 12. (Before Wave 3, scenario.vbg was null for 113/254
//     scenarios, so revealInvestigation fell back to generateVbg('normal'), whose VENOUS default
//     pO2 is 5.0 — the reported "authored pO2 12 rendered as 5.0" defect.)
//   * A facilitator improve/deteriorate trigger is an explicit clinical state change and moves the
//     baseline itself, so the next repeat gas differs even before time-based physiology accrues.
window.calculateDynamicVbg = (startVbg, currentVitals, activeInterventions, timeSeconds, trendDirection = null) => {
    if (!startVbg) return { pH: 7.4, pCO2: 5.0, pO2: 12.0, HCO3: 24, Lac: 1.0, K: 4.0, Glu: 5.5, Ketones: 0.2 };
    let vbg = { ...startVbg };
    // A facilitator-triggered improvement/deterioration is an explicit clinical state change. Apply it
    // to the runtime VBG baseline so the next repeat gas changes even before time-based physiology accrues.
    if (trendDirection === 'improve') {
        vbg.pH = Math.min(7.4, vbg.pH + 0.05);
        vbg.Lac = Math.max(1, vbg.Lac / 2);
        if (Number.isFinite(vbg.K) && vbg.K > 5.5) vbg.K = Math.max(4.0, vbg.K - 1.0);
    } else if (trendDirection === 'deteriorate') {
        vbg.pH = Math.max(6.8, vbg.pH - 0.05);
        vbg.Lac = Math.min(15, vbg.Lac + 2);
        if (Number.isFinite(vbg.HCO3)) vbg.HCO3 = Math.max(5, vbg.HCO3 - 2);
    }
    const minutes = timeSeconds / 60;
    const isVentilated = activeInterventions.has('Bagging') || activeInterventions.has('RSI') || activeInterventions.has('i-gel') || activeInterventions.has('NIV');
    if (currentVitals.rr < 10 && !isVentilated) { vbg.pCO2 = Math.min(15, vbg.pCO2 + (0.1 * minutes)); vbg.pH = Math.max(6.8, vbg.pH - (0.01 * minutes)); }
    if (isVentilated && vbg.pCO2 > 6.0) { vbg.pCO2 = Math.max(4.5, vbg.pCO2 - (0.2 * minutes)); vbg.pH = Math.min(7.4, vbg.pH + (0.02 * minutes)); }
    if (currentVitals.spO2 < 85 || currentVitals.bpSys < 80) { vbg.Lac = Math.min(15, vbg.Lac + (0.1 * minutes)); vbg.pH = Math.max(6.8, vbg.pH - (0.01 * minutes)); vbg.HCO3 = Math.max(10, vbg.HCO3 - (0.5 * minutes)); }
    if (activeInterventions.has('InsulinInfusion') || activeInterventions.has('InsulinDextrose')) {
        vbg.Ketones = Math.max(0.1, vbg.Ketones - (0.05 * minutes));
        vbg.Glu = Math.max(4.0, vbg.Glu - (0.1 * minutes));
    }
    return vbg;
};

window.generateUrine = (type = "normal") => {
    const base = { leuks: "-", nitrites: "-", blood: "-", ketones: "-", protein: "-", glucose: "-", bhcg: "Negative" };
    if(type === "uti") return { ...base, leuks: "+++", nitrites: "+" };
    if(type === "dka") return { ...base, ketones: "++++", glucose: "++++" };
    if(type === "hhs") return { ...base, ketones: "Trace", glucose: "++++" };
    if(type === "rhabdo") return { ...base, blood: "+++ (Myoglobin)" };
    if(type === "pregnancy") return { ...base, bhcg: "POSITIVE" };
    if(type === "renal_colic") return { ...base, blood: "++" };
    return base;
};

window.generatePocus = (type = "normal") => {
    const base = { heart: "Normal contractility. No pericardial effusion.", lungs: "Lung sliding present bilaterally. No B-lines.", abdo: "No free fluid in Morison's pouch or splenorenal angle." };
    if(type === "tamponade") return { ...base, heart: "Large pericardial effusion. RV diastolic collapse present." };
    if(type === "pneumothorax") return { ...base, lungs: "Left: Absent lung sliding. Barcode sign present." };
    if(type === "pulmonary_oedema") return { ...base, lungs: "Diffuse B-lines bilaterally (Rocket tails)." };
    if(type === "ruptured_aaa") return { ...base, abdo: "Large free fluid in abdomen. Aorta > 5cm." };
    if(type === "ectopic") return { ...base, abdo: "Empty uterus. Free fluid in Pouch of Douglas." };
    if(type === "pe") return { ...base, heart: "RV dilatation. Septal flattening (D-sign)." };
    return base;
};

window.generateCT = (type = "normal") => {
    if(type === "sah") return "Hyperdensity within the basal cisterns and sylvian fissures consistent with acute Subarachnoid Haemorrhage.";
    if(type === "stroke_isch") return "No acute haemorrhage. Dense MCA sign on right side. Early loss of grey-white differentiation.";
    if(type === "stroke_haem") return "Large intracerebral haematoma in the right basal ganglia with surrounding oedema.";
    if(type === "subdural") return "Crescentic hyperdensity over the left hemisphere with 5mm midline shift.";
    if(type === "extradural") return "Biconvex (lentiform) hyperdensity in the right temporal region. Fracture of temporal bone.";
    if(type === "pe") return "CTPA: Filling defects seen in both main pulmonary arteries extending into lobar branches. Right heart strain.";
    if(type === "dissection") return "CT Aorta: Dissection flap visible originating in ascending aorta and extending to iliac bifurcation (Type A).";
    if(type === "pancreatitis") return "CT Abdo: Pancreas is oedematous with peripancreatic stranding and fluid collections.";
    if(type === "perf") return "CT Abdo: Free air under the diaphragm. Extravasation of contrast from duodenum.";
    return "No acute intracranial/thoracic/abdominal pathology identified.";
};

window.HUMAN_FACTOR_CHALLENGES = [
  { id: 'hf0', type: 'Standard Simulation', description: 'Manage effectively.' },
  { id: 'hf1', type: 'Blindfolded Lead', description: 'Leader blindfolded. Tests closed-loop comms.' },
  { id: 'hf2', type: 'Silent Team', description: 'Only leader speaks.' },
  { id: 'hf3', type: 'New Junior', description: 'Junior member needs explicit instructions.' },
  { id: 'hf4', type: 'Missing Kit', description: 'Crucial equipment missing.' },
  { id: 'hf5', type: 'Distracted Senior', description: 'Consultant on phone, dismissive.' },
];

// =================================================================================================
// QUICK SIM SYNTHETIC PATIENT
// -------------------------------------------------------------------------------------------------
// Quick Sim is a stripped-back "obs + rhythm only" teaching mode. It has NO clinical scenario: no
// brief, no learning objectives, no intervention library, no expectation machinery. But every other
// part of the app (engine, vitals precedence, Firebase sync, monitor, defib, debrief) is driven off
// `state.scenario`, so rather than fork a parallel controller we hand the EXISTING engine a
// deliberately blank synthetic patient and let the controller omit the scenario-dependent panels.
//
// Design rules this object has to satisfy:
//   * `quickSim: true` is the single flag every screen keys off (it survives sync + persistence
//     because it is a primitive on the scenario, exactly like `showWetflag`).
//   * NO `deterioration` block  -> LOAD_SCENARIO's detMode0 resolves to 'manual' (requirement A6),
//     while the AUTO/MANUAL toggle stays available because it is state, not scenario, driven.
//   * NO `recommendedActions`, `customActions`, `stabilisers`, `learningObjectives` -> nothing for
//     the omitted panels to render and nothing for the objective/score machinery to score.
//   * Age-appropriate starting obs via getBaseVitals(), plus WETFLAG whenever a paediatric weight
//     is resolvable, so paediatric energy (4 J/kg) and dosing work exactly as in a real scenario.
//   * It is NOT put through enrichScenario(): enrichment exists to attach equipment lists, guideline
//     links and investigation findings, none of which Quick Sim shows. A minimal `ecg`/`vbg` pair is
//     supplied directly so the monitor trace and any repeat-gas code path still have valid input.
window.buildQuickSimScenario = (opts = {}) => {
    // Number('') and Number(null) are 0, which silently made a blank age field a newborn.
    const rawAge = (opts.age === undefined || opts.age === null || String(opts.age).trim() === '') ? NaN : Number(opts.age);
    const age = Number.isFinite(rawAge) && rawAge >= 0 && rawAge <= 120 ? rawAge : 40;
    const sex = opts.sex === 'Female' ? 'Female' : 'Male';
    const name = String(opts.name || '').trim() || 'Quick Sim Patient';

    // Weight: explicit facilitator entry wins; otherwise estimate for children and leave adults
    // null (which is what the rest of the app already means by "no weight-based dosing needed").
    let weight = null;
    const rawWeight = Number(opts.weight);
    if (Number.isFinite(rawWeight) && rawWeight > 0) weight = rawWeight;
    else if (age < 16) { const est = window.estimateWeight(age); weight = est === null ? null : parseFloat(est); }

    // WETFLAG is the paediatric chart, so only a child (< 16) gets one. An adult's typed weight is
    // kept (weight-based drugs) but must not turn on the paediatric card, 4 J/kg energies and doses.
    const wetflag = (weight && age < 16) ? window.calculateWetflag(age, weight) : null;
    const base = window.getBaseVitals(age);
    const rhythm = (window.RHYTHMS && window.RHYTHMS.isKnown(opts.rhythm)) ? window.RHYTHMS.canonical(opts.rhythm) : 'Sinus Rhythm';

    const vitals = {
        hr: base.hr, bpSys: base.bpSys, bpDia: base.bpDia, rr: base.rr,
        spO2: 98, temp: base.temp, gcs: base.gcs, bm: base.bm, pupils: base.pupils,
        etco2: 4.5, ph: 7.4, k: 4.2
    };

    return {
        id: `QUICK_${Date.now()}`,
        quickSim: true,
        title: 'Quick Sim',
        category: 'Quick Sim',
        ageRange: age < 16 ? 'Paediatric' : (age > 65 ? 'Elderly' : 'Adult'),
        acuity: 'Majors',
        patientName: name,
        patientAge: age,
        sex,
        // Kept deliberately factual: there is no clinical story to tell.
        patientProfileTemplate: `Blank {age}-year-old {sex} for ad-hoc teaching. No scenario — the facilitator drives the obs and rhythm directly.`,
        profile: window.formatProfileTemplate(`Blank {age}-year-old {sex} for ad-hoc teaching. No scenario — the facilitator drives the obs and rhythm directly.`, age, sex),
        presentingComplaint: 'Quick Sim (no scenario)',
        vitalsMod: vitals,
        vitals,
        pmh: [], dhx: [], allergies: ['NKDA'],
        difficulty: null,
        // Empty by design — see the header comment. Do not "helpfully" populate these.
        recommendedActions: [], customActions: [], stabilisers: [], learningObjectives: [],
        instructorBrief: { progression: null, interventions: [], learningObjectives: [] },
        equipment: [], learningLinks: [],
        ecg: { type: rhythm, findings: (window.RHYTHMS ? window.RHYTHMS.labelFor(rhythm) : rhythm) },
        chestXray: null,
        investigations: null,
        evolution: null,
        vbg: window.generateVbg('normal'),
        vbgClinicalState: 'normal',
        weight, wetflag,
        showWetflag: opts.showWetflag === true,
        hf: (window.HUMAN_FACTOR_CHALLENGES || [])[0] || null
    };
};

// One premade/random scenario template -> a concrete patient (age, sex, name, history, weight,
// WETFLAG, starting vitals, VBG). Used by the setup screen, and by the tests so they exercise
// exactly what the app does.
window.generatePatientFromTemplate = (base, opts = {}) => {
    const { generateHistory, estimateWeight, calculateWetflag, generateName, formatProfileTemplate, generateVbg } = window;
    // Number(null) and Number('') are 0 — a newborn — so a blank authored field must read as absent.
    const num = (v) => (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) ? NaN : Number(v);
    // Honour an AUTHORED patientAge before falling back to 40. Built-in scenarios all carry an
    // `ageGenerator`; a restricted scenario pasted into Firebase (or a hand-written custom one)
    // states its age directly as `patientAge` — and that age drives WETFLAG, the
    // paediatric 4 J/kg defibrillation energy and every weight-based dose, so silently
    // replacing a 5-year-old with a 40-year-old would have been a clinical error, not a
    // cosmetic one. Age 0 (a newborn) is a real age and must stay 0.
    const authoredAge = num(base.patientAge);
    const patientAge = base.ageGenerator ? base.ageGenerator()
        : (Number.isFinite(authoredAge) && authoredAge >= 0 ? authoredAge : 40);
    const title = String(base.title || '').toLowerCase();
    const template = base.patientProfileTemplate || base.profile || '';
    const p = String(template).toLowerCase();
    const forceFemale = ["ectopic", "ovarian", "pregnant", "labour", "birth", "gynae", "obstetric", "eclampsia", "uterus", "vaginal"];
    const forceMale = ["testicular", "prostate", "scrotal"];
    // An authored sex (built-in, Builder or restricted) wins; then the clinical keywords; then chance.
    let sex = (base.sex === 'Male' || base.sex === 'Female') ? base.sex : null;
    if (!sex) {
        if (forceFemale.some(k => title.includes(k) || p.includes(k)) || base.category === 'Obstetrics & Gynae') sex = 'Female';
        else if (forceMale.some(k => title.includes(k) || p.includes(k))) sex = 'Male';
        else sex = Math.random() > 0.5 ? 'Male' : 'Female';
    }

    const history = generateHistory(patientAge, sex);
    // An authored weight wins over the age estimate, for the same reason.
    const authoredWeight = num(base.weight);
    const weight = (Number.isFinite(authoredWeight) && authoredWeight > 0) ? authoredWeight
        : (patientAge < 16 ? estimateWeight(patientAge) : null);
    // WETFLAG is the paediatric chart: children (< 16) only, whatever weight was authored.
    const wetflag = (weight && patientAge < 16) ? calculateWetflag(patientAge, weight) : null;
    const patientName = (typeof base.patientName === 'string' && base.patientName.trim()) ? base.patientName.trim() : generateName(sex);

    // Built-in scenarios author `vitalsMod`; the Builder, custom and restricted scenarios author
    // `vitals`. Both are honoured (vitals last, as the more explicit of the two).
    const vitalsMod = (base.vitalsMod && typeof base.vitalsMod === 'object') ? base.vitalsMod : {};
    const authoredVitals = (base.vitals && typeof base.vitals === 'object') ? base.vitals : {};
    let finalVitals = { hr: 80, bpSys: 120, bpDia: 80, rr: 16, spO2: 98, temp: 37, gcs: 15, bm: 5, pupils: 3, ...vitalsMod, ...authoredVitals };
    const sysGiven = vitalsMod.bpSys !== undefined || authoredVitals.bpSys !== undefined;
    const diaGiven = vitalsMod.bpDia !== undefined || authoredVitals.bpDia !== undefined;
    if (sysGiven && !diaGiven) finalVitals.bpDia = Math.floor(finalVitals.bpSys * 0.65);

    // A scenario with no authored ECG was given a provisional sinus rhythm at enrichment; name it
    // from this patient's actual heart rate and age (sinus tachycardia / bradycardia).
    let ecgFields = {};
    if (base.ecg && base.ecg.derivedFromHr && window.sinusEcgForHr) {
        const ecg = window.sinusEcgForHr(finalVitals.hr, patientAge);
        ecgFields.ecg = ecg;
        if (base.investigations && base.investigations.ecg && base.investigations.ecg.derivedFromHr) {
            ecgFields.investigations = { ...base.investigations, ecg: { ...base.investigations.ecg, ...ecg } };
        }
    }

    // The scenario's own VBG (resolved once by enrichScenario, or authored) is the baseline; it is
    // only generated when there is none.
    let vbg = (base.vbg && typeof base.vbg === 'object') ? base.vbg : generateVbg(base.vbgClinicalState || "normal");
    if (!base.vbg && Number.isFinite(num(vitalsMod.bm))) vbg = { ...vbg, Glu: num(vitalsMod.bm) };

    return {
       ...base,
       ...ecgFields,
       patientName, patientAge, sex,
       profile: formatProfileTemplate(template, patientAge, sex),
       vitals: finalVitals,
       pmh: base.pmh || history.pmh,
       dhx: base.dhx || history.dhx,
       allergies: base.allergies || history.allergies,
       vbg,
       hf: opts.hf || null,
       weight, wetflag,
       showWetflag: opts.showWetflag === true
    };
};
