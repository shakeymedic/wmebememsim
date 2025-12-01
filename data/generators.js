// data/generators.js

// --- MATH HELPERS ---
window.getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
window.getRandomFloat = (min, max, decimals) => parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
window.getRandomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];
window.clamp = (val, min, max) => Math.min(Math.max(val, min), max);

// --- MEDICAL GENERATORS ---

window.generateHistory = (age, sex = 'Male') => {
    if (age < 20) return { pmh: ["Nil significant"], dhx: ["Nil"], allergies: ["Nil"] };
    
    const commonPMH = ["Hypertension", "Type 2 Diabetes", "Asthma", "Hyperlipidaemia", "GORD", "Depression", "Anxiety", "Previous MI", "AF", "CKD Stage 3"];
    const femalePMH = ["PCOS", "Endometriosis", "Previous C-Section"];
    
    let pmh = [];
    let dhx = [];
    
    // Logic for PMH generation
    const pmhCount = age > 60 ? window.getRandomInt(1, 4) : age > 40 ? window.getRandomInt(0, 2) : window.getRandomInt(0, 1);
    
    for(let i=0; i<pmhCount; i++) {
        const item = window.getRandomItem(commonPMH);
        if(!pmh.includes(item)) pmh.push(item);
    }
    
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

    return {
        pmh: pmh,
        dhx: dhx,
        allergies: [Math.random() > 0.8 ? window.getRandomItem(["Penicillin", "Latex", "NSAIDs", "Trimethoprim"]) : "NKDA"]
    };
};

window.getBaseVitals = (age) => {
    let v = { hr: 75, rr: 16, bpSys: 120, bpDia: 75, temp: 36.8, bm: 5.8, gcs: 15, pupils: '3mm' }; 
    if (age < 1) v = { hr: 145, rr: 45, bpSys: 75, bpDia: 45, temp: 37.0, bm: 4.5, gcs: 15, pupils: '3mm' }; 
    else if (age <= 2) v = { hr: 125, rr: 30, bpSys: 90, bpDia: 55, temp: 37.0, bm: 5.0, gcs: 15, pupils: '3mm' }; 
    else if (age <= 5) v = { hr: 110, rr: 25, bpSys: 95, bpDia: 60, temp: 37.0, bm: 5.0, gcs: 15, pupils: '3mm' }; 
    else if (age <= 12) v = { hr: 90, rr: 20, bpSys: 105, bpDia: 65, temp: 36.8, bm: 5.5, gcs: 15, pupils: '4mm' }; 
    else if (age > 65) v = { hr: 70, rr: 18, bpSys: 135, bpDia: 80, temp: 36.5, bm: 6.0, gcs: 15, pupils: '3mm' }; 
    return v;
};

window.estimateWeight = (age) => {
    if (age < 0) return null;
    if (age === 0) return "3.5"; 
    if (age < 1) return "6.0"; 
    if (age >= 1 && age <= 10) return Math.round((age + 4) * 2); 
    if (age > 10 && age < 16) return Math.round(age * 3 + 7); 
    return null; 
};

window.calculateWetflag = (age, weightStr) => {
    const weight = parseFloat(weightStr);
    if (isNaN(weight) || weight <= 0) return null;

    return {
        weight: weight,
        energy: Math.min(200, Math.round(weight * 4)), 
        tube: age < 1 ? "3.5-4.0" : Math.min(8.0, ((age / 4) + 4)).toFixed(1),
        fluids: Math.round(weight * 10), 
        lorazepam: Math.min(4, weight * 0.1).toFixed(1), 
        adrenaline: Math.min(10, weight * 0.1).toFixed(1), 
        glucose: Math.round(weight * 2) 
    };
};

window.generateVbg = (clinicalState = "normal") => {
    let vbg = { pH: 7.40, pCO2: 5.3, HCO3: 24, BE: 0, Lac: 1.0, K: 4.0, Glu: 5.5 };
    vbg.pH += window.getRandomFloat(-0.03, 0.03, 2);
    switch (clinicalState) {
        case "dka_severe": vbg = { pH: 6.95, pCO2: 2.5, HCO3: 5, BE: -24, Lac: 2.5, K: 5.4, Glu: 28.0 }; break;
        case "septic_shock": vbg = { pH: 7.25, pCO2: 4.5, HCO3: 16, BE: -8, Lac: 6.5, K: 4.2, Glu: 4.0 }; break;
        case "haemorrhagic_shock": vbg = { pH: 7.20, pCO2: 4.8, HCO3: 14, BE: -10, Lac: 8.0, K: 3.8, Glu: 9.0 }; break;
        case "copd_retainer": vbg = { pH: 7.30, pCO2: 9.5, HCO3: 34, BE: 8, Lac: 1.2, K: 4.0, Glu: 6.0 }; break;
        case "respiratory_acidosis_acute": vbg = { pH: 7.15, pCO2: 9.5, HCO3: 24, BE: 0, Lac: 1.5, K: 4.1, Glu: 6.2 }; break;
        case "metabolic_acidosis_severe": vbg = { pH: 6.90, pCO2: 6.0, HCO3: 10, BE: -22, Lac: 12.0, K: 6.5, Glu: 6.0 }; break;
        case "metabolic_alkalosis": vbg = { pH: 7.50, pCO2: 5.8, HCO3: 30, BE: 6, Lac: 1.0, K: 3.0, Glu: 5.5 }; break;
        case "hyperkalemia": vbg = { pH: 7.35, pCO2: 5.0, HCO3: 22, BE: -2, Lac: 1.5, K: 7.5, Glu: 6.0 }; break;
        case "hyponatremia": vbg = { pH: 7.40, pCO2: 5.3, HCO3: 24, BE: 0, Lac: 1.2, K: 4.0, Na: 115, Glu: 5.5 }; break;
        case "gi_bleed": vbg = { pH: 7.32, pCO2: 4.8, HCO3: 20, BE: -4, Lac: 3.5, K: 4.1, Glu: 6.5 }; break; 
        case "hypercalcemia": vbg = { pH: 7.42, pCO2: 5.3, HCO3: 24, BE: 0, Lac: 1.2, K: 4.0, Ca: 3.5, Glu: 5.5 }; break;
        case "hypothermia": vbg = { pH: 7.30, pCO2: 5.0, HCO3: 22, BE: -2, Lac: 2.5, K: 3.5, Glu: 4.5 }; break;
        case "co_poisoning": vbg = { pH: 7.35, pCO2: 5.0, HCO3: 18, BE: -6, Lac: 4.0, K: 4.0, Glu: 6.0 }; break;
        default: break;
    }
    return vbg;
};

window.calculateDynamicVbg = (startVbg, currentVitals, activeInterventions, timeSeconds) => {
    if (!startVbg) return { pH: 7.4, pCO2: 5.0, HCO3: 24, Lac: 1.0, K: 4.0, Glu: 5.5 };
    
    let vbg = { ...startVbg };
    const minutes = timeSeconds / 60;

    const isVentilated = activeInterventions.has('Bagging') || activeInterventions.has('RSI') || activeInterventions.has('i-gel') || activeInterventions.has('NIV');
    
    if (currentVitals.rr < 10 && !isVentilated) {
        vbg.pCO2 = Math.min(15, vbg.pCO2 + (0.1 * minutes)); 
        vbg.pH = Math.max(6.8, vbg.pH - (0.01 * minutes));
    }

    if (isVentilated && vbg.pCO2 > 6.0) {
         vbg.pCO2 = Math.max(4.5, vbg.pCO2 - (0.2 * minutes));
         vbg.pH = Math.min(7.4, vbg.pH + (0.02 * minutes));
    }

    if (currentVitals.spO2 < 85 || currentVitals.bpSys < 80) {
        vbg.Lac = Math.min(15, vbg.Lac + (0.1 * minutes));
        vbg.pH = Math.max(6.8, vbg.pH - (0.01 * minutes));
        vbg.HCO3 = Math.max(10, vbg.HCO3 - (0.5 * minutes));
    }

    return vbg;
};
