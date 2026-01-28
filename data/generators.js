// data/generators.js
window.getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

window.getRandomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];

window.MALE_NAMES = ["James", "John", "Michael", "David", "William", "Richard", "Robert", "Thomas", "Christopher", "Daniel", "Matthew", "Anthony", "Mark", "Paul", "Steven", "Andrew", "Joseph", "Charles", "Joshua", "George", "Harry", "Oliver", "Jack", "Noah", "Charlie", "Jacob", "Alfie", "Oscar", "Leo", "Mohammed"];
window.FEMALE_NAMES = ["Mary", "Patricia", "Jennifer", "Elizabeth", "Linda", "Susan", "Jessica", "Sarah", "Karen", "Nancy", "Margaret", "Lisa", "Betty", "Dorothy", "Sandra", "Ashley", "Kimberly", "Emily", "Donna", "Michelle", "Emma", "Olivia", "Ava", "Isla", "Sophie", "Mia", "Isabella", "Charlotte", "Amelia", "Lily"];
window.SURNAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Miller", "Davis", "Garcia", "Rodriguez", "Wilson", "Martinez", "Anderson", "Taylor", "Thomas", "Moore", "Jackson", "Martin", "Lee", "Thompson", "White", "Harris", "Clark", "Lewis", "Robinson", "Walker", "Hall", "Young", "King", "Wright", "Hill"];

window.generateName = (sex) => {
    const first = sex === 'Male' ? window.getRandomItem(MALE_NAMES) : window.getRandomItem(FEMALE_NAMES);
    const last = window.getRandomItem(SURNAMES);
    return `${first} ${last}`;
};

window.generateHistory = (age, sex) => {
    const pmhPool = ["Hypertension", "Type 2 Diabetes", "Asthma", "COPD", "IHD", "Atrial Fibrillation", "Hypothyroidism", "Depression", "Anxiety", "Epilepsy", "Osteoarthritis", "Rheumatoid Arthritis", "CKD Stage 3", "GORD", "Hyperlipidaemia"];
    const dhxPool = ["Aspirin", "Metformin", "Ramipril", "Bisoprolol", "Atorvastatin", "Omeprazole", "Salbutamol", "Amlodipine", "Levothyroxine", "Sertraline", "Furosemide", "Apixaban", "Paracetamol PRN"];
    
    const numPmh = age > 65 ? window.getRandomInt(2, 4) : (age > 40 ? window.getRandomInt(0, 2) : window.getRandomInt(0, 1));
    const numDhx = numPmh > 0 ? window.getRandomInt(numPmh, numPmh + 2) : 0;
    
    const pmh = [];
    const dhx = [];
    const usedPmh = new Set();
    const usedDhx = new Set();
    
    for (let i = 0; i < numPmh; i++) {
        let item = window.getRandomItem(pmhPool);
        while (usedPmh.has(item)) item = window.getRandomItem(pmhPool);
        usedPmh.add(item);
        pmh.push(item);
    }
    
    for (let i = 0; i < numDhx; i++) {
        let item = window.getRandomItem(dhxPool);
        while (usedDhx.has(item)) item = window.getRandomItem(dhxPool);
        usedDhx.add(item);
        dhx.push(item);
    }
    
    return { pmh: pmh.length > 0 ? pmh : ["Nil"], dhx: dhx.length > 0 ? dhx : ["Nil"], allergies: [Math.random() > 0.8 ? window.getRandomItem(["Penicillin", "Latex", "NSAIDs", "Trimethoprim"]) : "NKDA"] };
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
    let rawTube = (age / 4) + 4;
    let tubeSize = Math.round(rawTube * 2) / 2;
    if (age < 1) tubeSize = "3.5-4.0"; 
    else if (tubeSize > 9.0) tubeSize = 9.0;
    else if (tubeSize < 3.0) tubeSize = 3.0;
    let adrenalineMcg = Math.round(weight * 10);
    let glucoseVol = Math.round(weight * 2);
    return { 
        weight: weight, 
        age: age,
        energy: Math.round(weight * 4),
        tube: tubeSize.toString(), 
        fluids: Math.round(weight * 10),
        lorazepam: Math.min(4, weight * 0.1).toFixed(1),
        adrenaline: adrenalineMcg, 
        glucose: glucoseVol
    };
};

window.generateVbg = (clinicalState = "normal") => {
    let vbg = { pH: 7.38, pCO2: 5.5, pO2: 5.0, HCO3: 24, BE: 0, Lactate: 1.2, K: 4.2, Na: 140, Hb: 135, Glucose: 5.5 };
    
    switch(clinicalState) {
        case "metabolic_acidosis_severe":
            vbg = { pH: 7.10, pCO2: 2.5, pO2: 4.5, HCO3: 10, BE: -18, Lactate: 8.5, K: 5.8, Na: 138, Hb: 130, Glucose: 4.0 };
            break;
        case "metabolic_acidosis":
            vbg = { pH: 7.25, pCO2: 3.5, pO2: 4.8, HCO3: 16, BE: -10, Lactate: 4.5, K: 5.2, Na: 139, Hb: 128, Glucose: 5.0 };
            break;
        case "respiratory_acidosis":
            vbg = { pH: 7.28, pCO2: 8.5, pO2: 6.0, HCO3: 28, BE: 2, Lactate: 1.5, K: 4.5, Na: 140, Hb: 145, Glucose: 6.0 };
            break;
        case "respiratory_alkalosis":
            vbg = { pH: 7.52, pCO2: 3.0, pO2: 5.5, HCO3: 22, BE: -2, Lactate: 1.0, K: 3.8, Na: 141, Hb: 140, Glucose: 5.5 };
            break;
        case "septic_shock":
            vbg = { pH: 7.22, pCO2: 3.0, pO2: 4.2, HCO3: 14, BE: -12, Lactate: 7.0, K: 5.0, Na: 136, Hb: 100, Glucose: 8.0 };
            break;
        case "haemorrhagic_shock":
            vbg = { pH: 7.30, pCO2: 3.8, pO2: 4.5, HCO3: 18, BE: -8, Lactate: 5.5, K: 4.8, Na: 138, Hb: 65, Glucose: 6.5 };
            break;
        case "dka":
            vbg = { pH: 7.15, pCO2: 2.2, pO2: 5.0, HCO3: 8, BE: -20, Lactate: 2.0, K: 5.5, Na: 132, Hb: 150, Glucose: 28.0 };
            break;
        case "hhs":
            vbg = { pH: 7.32, pCO2: 4.5, pO2: 5.0, HCO3: 20, BE: -4, Lactate: 1.8, K: 4.0, Na: 155, Hb: 160, Glucose: 45.0 };
            break;
        case "hyperkalemia":
            vbg = { pH: 7.32, pCO2: 4.8, pO2: 5.0, HCO3: 20, BE: -4, Lactate: 1.5, K: 7.2, Na: 138, Hb: 100, Glucose: 6.0 };
            break;
        case "hyponatremia":
            vbg = { pH: 7.38, pCO2: 5.2, pO2: 5.2, HCO3: 24, BE: 0, Lactate: 1.0, K: 4.0, Na: 118, Hb: 135, Glucose: 5.5 };
            break;
        case "hypercalcemia":
            vbg = { pH: 7.40, pCO2: 5.0, pO2: 5.0, HCO3: 24, BE: 0, Lactate: 1.2, K: 4.2, Na: 140, Hb: 130, Glucose: 5.5 };
            break;
        case "co_poisoning":
            vbg = { pH: 7.35, pCO2: 4.8, pO2: 12.0, HCO3: 22, BE: -2, Lactate: 3.5, K: 4.2, Na: 140, Hb: 145, Glucose: 7.0 };
            break;
        case "hypothermia":
            vbg = { pH: 7.25, pCO2: 4.0, pO2: 4.0, HCO3: 18, BE: -6, Lactate: 4.0, K: 5.5, Na: 138, Hb: 150, Glucose: 3.5 };
            break;
        default:
            break;
    }
    
    // Add some random variation
    Object.keys(vbg).forEach(key => {
        if (typeof vbg[key] === 'number') {
            vbg[key] = parseFloat((vbg[key] + (Math.random() - 0.5) * 0.2).toFixed(2));
        }
    });
    
    return vbg;
};

window.generateUrine = (type = "normal") => {
    const results = {
        normal: { findings: "Urinalysis: Negative for leukocytes, nitrites, blood, protein, glucose, ketones." },
        uti: { findings: "Urinalysis: Leukocytes +++, Nitrites +ve, Blood +, Protein trace. Consistent with UTI." },
        dka: { findings: "Urinalysis: Glucose +++, Ketones +++, Protein +. Consistent with DKA." },
        rhabdo: { findings: "Urinalysis: Blood +++ (myoglobinuria), Protein ++. No RBCs on microscopy." },
        pregnancy: { findings: "Urinalysis: Beta-hCG POSITIVE. Leukocytes neg, Nitrites neg." },
        dehydration: { findings: "Urinalysis: Specific gravity 1.035, Ketones +, otherwise NAD." }
    };
    return results[type] || results.normal;
};

window.generatePocus = (type = "normal") => {
    const results = {
        normal: { findings: "POCUS: No free fluid. Normal lung sliding bilaterally. IVC normal calibre with respiratory variation. Normal cardiac contractility." },
        tamponade: { findings: "POCUS: Large pericardial effusion with RV diastolic collapse. Swinging heart. No lung sliding B/L (poor views)." },
        pneumothorax: { findings: "POCUS: Absent lung sliding on affected side with lung point identified. No free fluid." },
        pulmonary_oedema: { findings: "POCUS: Multiple B-lines bilaterally (>3 per field). Dilated IVC with minimal respiratory variation. Reduced LV function." },
        ruptured_aaa: { findings: "POCUS: Large AAA (>6cm) with surrounding haematoma. Free fluid in Morison's pouch and pelvis." },
        ectopic: { findings: "POCUS: Empty uterus with free fluid in pelvis. No IUP identified." },
        pe: { findings: "POCUS: Dilated RV with McConnell's sign. IVC dilated and non-collapsing. No free fluid." }
    };
    return results[type] || results.normal;
};

window.generateCT = (type = "normal") => {
    const results = {
        normal: "CT Head: No acute intracranial abnormality. No mass effect or midline shift.",
        sah: "CT Head: SUBARACHNOID HAEMORRHAGE - diffuse blood in basal cisterns and Sylvian fissures. Early hydrocephalus.",
        stroke_isch: "CT Head: Loss of grey-white differentiation in R MCA territory. Hyperdense R MCA sign. NIHSS correlation recommended.",
        stroke_haem: "CT Head: Large intracerebral haemorrhage in L basal ganglia with surrounding oedema. Midline shift 8mm to right.",
        subdural: "CT Head: Acute-on-chronic subdural haematoma with mixed density. 12mm at thickest point with 6mm midline shift.",
        extradural: "CT Head: Biconvex hyperdense collection consistent with extradural haematoma. Associated skull fracture. Mass effect.",
        pe: "CTPA: Large saddle PE at main pulmonary artery bifurcation. Multiple segmental emboli bilaterally. RV:LV ratio >1.",
        dissection: "CT Aorta: Stanford Type A dissection from aortic root to iliac bifurcation. True lumen compressed. No rupture.",
        pancreatitis: "CT Abdomen: Bulky pancreas with surrounding fat stranding and peripancreatic fluid collections. Modified CTSI 6.",
        perf: "CT Abdomen: Free intraperitoneal air. Likely hollow viscus perforation. Urgent surgical review."
    };
    return results[type] || results.normal;
};

// Investigation presets for controller to send
window.CT_HEAD_PRESETS = [
    { label: "Normal", value: "CT Head: No acute intracranial abnormality. No mass effect or midline shift." },
    { label: "SAH", value: "CT Head: SUBARACHNOID HAEMORRHAGE - diffuse blood in basal cisterns and Sylvian fissures. Early hydrocephalus." },
    { label: "Large ICH", value: "CT Head: Large intracerebral haemorrhage with surrounding oedema and midline shift. Neurosurgical review recommended." },
    { label: "Ischaemic Stroke", value: "CT Head: Loss of grey-white differentiation in MCA territory. Early ischaemic changes. Consider thrombolysis." },
    { label: "Subdural", value: "CT Head: Acute subdural haematoma with mass effect and midline shift. Urgent neurosurgical referral." },
    { label: "Extradural", value: "CT Head: Biconvex extradural haematoma with associated skull fracture. Mass effect present." },
    { label: "Contusions", value: "CT Head: Multiple cerebral contusions with surrounding oedema. No surgical lesion. ICP monitoring recommended." },
    { label: "Diffuse Axonal Injury", value: "CT Head: Multiple petechial haemorrhages at grey-white junction consistent with DAI. No surgical lesion." }
];

window.INVESTIGATION_PRESETS = {
    'CT_HEAD': window.CT_HEAD_PRESETS,
    'CT_CHEST': [
        { label: "Normal", value: "CT Chest: No acute cardiopulmonary abnormality. Lungs clear." },
        { label: "PE", value: "CT PA: Large saddle pulmonary embolism. RV strain evident. Urgent anticoagulation required." },
        { label: "Pneumothorax", value: "CT Chest: Large RIGHT pneumothorax with mediastinal shift. Urgent decompression required." },
        { label: "Haemothorax", value: "CT Chest: Large LEFT haemothorax with active extravasation. Surgical review recommended." },
        { label: "Aortic Dissection", value: "CT Aorta: Type A aortic dissection with intimal flap extending into arch. URGENT cardiothoracic referral." },
        { label: "Rib Fractures", value: "CT Chest: Multiple right-sided rib fractures (ribs 4-8) with underlying pulmonary contusion." }
    ],
    'CT_ABDO': [
        { label: "Normal", value: "CT Abdomen/Pelvis: No acute intra-abdominal abnormality." },
        { label: "Appendicitis", value: "CT Abdomen: Acute appendicitis with peri-appendiceal fat stranding. No perforation." },
        { label: "Bowel Obstruction", value: "CT Abdomen: Small bowel obstruction with transition point in RIF. Dilated proximal loops." },
        { label: "Free Air", value: "CT Abdomen: Pneumoperitoneum with free fluid. Perforated viscus - URGENT surgical review." },
        { label: "AAA Rupture", value: "CT Abdomen: Ruptured 8cm infrarenal AAA with retroperitoneal haematoma. EMERGENCY vascular surgery." },
        { label: "Splenic Injury", value: "CT Abdomen: Grade IV splenic laceration with active haemorrhage. Haemoperitoneum present." },
        { label: "Liver Laceration", value: "CT Abdomen: Grade III liver laceration with subcapsular haematoma. Haemoperitoneum present." }
    ],
    'CXR': [
        { label: "Normal", value: "CXR: Lung fields clear. No cardiomegaly. No pneumothorax." },
        { label: "Pneumothorax", value: "CXR: Large RIGHT tension pneumothorax with mediastinal shift. Urgent decompression required." },
        { label: "Haemothorax", value: "CXR: Large LEFT pleural effusion (likely haemothorax). Loss of costophrenic angle." },
        { label: "Pulmonary Oedema", value: "CXR: Bilateral interstitial oedema. Cardiomegaly. Upper lobe diversion. Bat wing appearance." },
        { label: "Pneumonia", value: "CXR: Right lower lobe consolidation with air bronchograms. Consistent with pneumonia." },
        { label: "Widened Mediastinum", value: "CXR: Widened mediastinum. Consider aortic pathology. CT recommended." },
        { label: "Rib Fractures", value: "CXR: Multiple right-sided rib fractures (ribs 4-7). Small associated pneumothorax." }
    ],
    'ECG': [
        { label: "Normal SR", value: "ECG: Normal sinus rhythm. Rate 72. No acute changes." },
        { label: "STEMI Anterior", value: "ECG: ST elevation V1-V4 with reciprocal changes. ANTERIOR STEMI - activate cath lab." },
        { label: "STEMI Inferior", value: "ECG: ST elevation II, III, aVF. INFERIOR STEMI - activate cath lab. Check RV leads." },
        { label: "NSTEMI", value: "ECG: ST depression V3-V6 with T wave inversion. Troponin pending. High risk ACS." },
        { label: "AF", value: "ECG: Atrial fibrillation. Ventricular rate 120. No acute ischaemic changes." },
        { label: "Complete HB", value: "ECG: Complete heart block. Ventricular rate 35. Urgent pacing required." },
        { label: "Hyperkalaemia", value: "ECG: Peaked T waves, prolonged PR, widened QRS. CHECK K+ URGENTLY." }
    ],
    'VBG': [
        { label: "Normal", content: "VBG: pH 7.38, pCO2 5.2, pO2 5.0, HCO3 24, BE 0, Lactate 1.0, K 4.0, Na 140, Hb 140, Glucose 5.5" },
        { label: "Metabolic Acidosis", content: "VBG: pH 7.25, pCO2 3.5, pO2 5.0, HCO3 15, BE -10, Lactate 4.0, K 4.8, Na 138, Hb 130, Glucose 6.0 - METABOLIC ACIDOSIS with respiratory compensation" },
        { label: "Severe Acidosis", content: "VBG: pH 7.05, pCO2 2.5, pO2 4.5, HCO3 6, BE -22, Lactate 8.5, K 5.8, Na 132, Hb 100, Glucose 4.0 - SEVERE METABOLIC ACIDOSIS - Critical" },
        { label: "Resp Acidosis", content: "VBG: pH 7.20, pCO2 9.5, pO2 6.0, HCO3 28, BE 2, Lactate 1.5, K 4.5, Na 140, Hb 150, Glucose 6.0 - RESPIRATORY ACIDOSIS - Type 2 resp failure" },
        { label: "Septic Shock", content: "VBG: pH 7.18, pCO2 2.8, pO2 4.8, HCO3 10, BE -16, Lactate 6.5, K 5.2, Na 135, Hb 95, Glucose 8.0 - Severe sepsis/septic shock" },
        { label: "DKA", content: "VBG: pH 7.15, pCO2 2.2, pO2 5.0, HCO3 8, BE -20, Lactate 2.0, K 5.5, Na 132, Hb 150, Glucose 28.0 - DKA. Ketones >3. Start DKA protocol." },
        { label: "Hyperkalaemia", content: "VBG: pH 7.32, pCO2 4.8, pO2 5.0, HCO3 20, BE -4, Lactate 1.5, K 7.2, Na 138, Hb 100, Glucose 6.0 - HYPERKALAEMIA - Check ECG, treat urgently" }
    ],
    'BLOODS': [
        { label: "Normal", value: "FBC: Hb 140, WCC 8.5, Plt 250. U&E: Na 140, K 4.2, Cr 85. LFT: Normal. Clotting: Normal." },
        { label: "Sepsis", value: "FBC: WCC 22, Plt 85. CRP 280. Lactate 4.5. Cr 180 (AKI). Clotting deranged." },
        { label: "DKA", value: "Glucose 28. K 6.2. Na 128. pH 7.1. HCO3 8. Ketones 5.2." },
        { label: "GI Bleed", value: "Hb 68 (↓↓). Plt 180. Urea 18.5 (↑). Cr 95. Group & Save sent." },
        { label: "Coagulopathy", value: "PT 35 (↑↑). APTT 55 (↑). Fibrinogen 0.8 (↓). Plt 45 (↓↓). Consider massive transfusion protocol." },
        { label: "Hyperkalaemia", value: "K 7.2. ECG changes - treat urgently. Na 138, Cr 250 (AKI stage 3)." }
    ],
    'URINE': [
        { label: "Normal", value: "Urinalysis: Clear. No blood, protein, leucocytes or nitrites." },
        { label: "UTI", value: "Urinalysis: Leucocytes +++, Nitrites +, Blood +. Consistent with UTI." },
        { label: "DKA", value: "Urinalysis: Ketones +++, Glucose +++." },
        { label: "Rhabdo", value: "Urinalysis: Blood +++ (no RBCs on microscopy - myoglobinuria). Check CK." },
        { label: "Pregnancy +ve", value: "Urinalysis: hCG POSITIVE. Pregnancy test positive." }
    ],
    'POCUS': [
        { label: "Normal", value: "POCUS: Good cardiac contractility. No pericardial effusion. IVC collapsing >50%. Lungs: A-lines bilaterally." },
        { label: "Tamponade", value: "POCUS: Large pericardial effusion with RV diastolic collapse. TAMPONADE - urgent pericardiocentesis." },
        { label: "Pneumothorax", value: "POCUS: Absent lung sliding on RIGHT. Barcode sign. PNEUMOTHORAX." },
        { label: "Pulm Oedema", value: "POCUS: Multiple B-lines bilaterally. Dilated IVC non-collapsing. Pulmonary oedema/fluid overload." },
        { label: "Ruptured AAA", value: "POCUS: 7cm infrarenal AAA with retroperitoneal fluid. RUPTURED AAA - activate major haemorrhage." },
        { label: "Ectopic", value: "POCUS: Free fluid in pelvis. No IUP seen. Consider ectopic pregnancy." },
        { label: "PE signs", value: "POCUS: Dilated RV with septal flattening (D-sign). McConnell's sign. RV:LV >1. Suggestive of PE." }
    ]
};

window.HUMAN_FACTOR_CHALLENGES = [
    { id: 'hf0', label: 'None', description: '' },
    { id: 'hf1', label: 'Aggressive Relative', description: 'A family member is shouting and demanding answers. De-escalation required.' },
    { id: 'hf2', label: 'Equipment Failure', description: 'The suction has failed. You need to find alternatives.' },
    { id: 'hf3', label: 'Interrupting Colleague', description: 'A colleague keeps interrupting with unrelated queries about another patient.' },
    { id: 'hf4', label: 'Missing Drugs', description: 'The first drug you look for is missing from the cupboard.' },
    { id: 'hf5', label: 'Language Barrier', description: 'The patient does not speak English. An interpreter is not immediately available.' },
    { id: 'hf6', label: 'Conflicting Senior Advice', description: 'Two senior clinicians are giving contradictory management advice.' },
    { id: 'hf7', label: 'Media Present', description: 'A journalist with a camera has entered the department.' },
    { id: 'hf8', label: 'VIP Patient', description: 'The patient is a local celebrity. Hospital management is asking for updates.' }
];
