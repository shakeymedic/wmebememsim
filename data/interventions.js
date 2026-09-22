// INTERVENTION SCHEMA
// ------------------------------------------------------------------------------------------------
// `expects: ['IV Access', ...]`      — things that SHOULD be in place first. NEVER blocking. The
//                                      engine proceeds and records a flagged "performed WITHOUT"
//                                      log entry for the debrief (see engine.js applyIntervention).
//                                      Satisfied by an active continuous intervention OR any prior
//                                      bolus dose (interventionCounts). `requires` is still read as
//                                      a synonym for backwards compatibility with saved/custom data.
// `expectsAny: [{ label, keys: [] }]` — "one of these" groups, e.g. any induction agent for RSI.
//
// `pk: { onset, peak, offset, plateau, maxDoses }` — SECONDS. CONSUMED BY THE ENGINE (Wave 2).
//   Turns `effect`'s numeric fields into a PEAK MAGNITUDE reached over time instead of an instant
//   clamped jump, evaluated as an ADDITIVE offset on top of the underlying physiology (see the
//   precedence comment in engine.js vitalsReducer).
//     onset   — seconds before ANY effect is measurable (one arm-brain time, absorption lag).
//     peak    — seconds from administration to full `effect` magnitude. Linear ramp onset -> peak.
//     plateau — OPTIONAL seconds from administration at which wear-off begins. Defaults to
//               peak + 35% of the peak->offset window, i.e. a sustained plateau then a decay.
//     offset  — for `type: 'bolus'`   : seconds from administration at which the effect is ZERO.
//                                       0 / omitted means "no modelled wear-off" (sustained).
//               for `type:'continuous'`: seconds to decay to zero AFTER the infusion/device is
//                                       STOPPED. The effect is held at peak while it is running.
//     maxDoses— ceiling on cumulative effect, expressed in doses. Repeat dosing is additive but
//               capped here, so three doses of atropine cannot give HR +60 (default 3).
//   NO `pk` == today's instantaneous clamped jump. That is deliberately preserved for genuinely
//   instant interventions: defibrillation, needle decompression, thoracostomy, pericardiocentesis,
//   adenosine, mechanical CPR, airway manoeuvres.
//
// `paralysis: { onset, duration }`    — legacy/explicit neuromuscular blockade timing. Wave 2 folded
//                                      this into the pk envelope: a paralytic's blockade now runs
//                                      from `pk.onset` to `pk.offset` and is tracked by the single
//                                      `activeDrugs[]` entry, so there is only ONE timer. This field
//                                      is still read as an override if present.
//
// Effect field -> vital mapping (engine.js EFFECT_TARGETS):
//   HR -> hr | BP -> bpSys (+0.6x bpDia) | RR -> rr | SpO2 -> spO2 | gcs -> gcs
//   BM -> bm (glucose, mmol/L) | Temp -> temp (degC) | pH -> ph    <- all four now modelled vitals
window.INTERVENTIONS = {
    // --- AIRWAY ---
    // Mechanical airway manoeuvres act as fast as they are performed: no pk, instant, as before.
    'Manoeuvres': { label: 'Head Tilt / Jaw Thrust', effect: { SpO2: 5 }, category: 'Airway', log: 'Airway manoeuvres applied.', type: 'continuous', duration: 5 },
    'OPA': { label: 'Guedel / OPA', effect: { SpO2: 5 }, category: 'Airway', log: 'Oropharyngeal airway inserted.', type: 'continuous', duration: 10 },
    'NPA': { label: 'Nasopharyngeal', effect: { SpO2: 5 }, category: 'Airway', log: 'Nasopharyngeal airway inserted.', type: 'continuous', duration: 15 },
    // Oxygenation via a rescue airway takes 15-60s to show on the probe, then is sustained.
    'i-gel': { label: 'i-gel / LMA', effect: { SpO2: 15, RR: 'vent' }, category: 'Airway', log: 'Supraglottic airway (i-gel) inserted.', type: 'continuous', duration: 30, pk: { onset: 5, peak: 40, offset: 60 } },
    'Suction': { label: 'Suction', effect: { SpO2: 5 }, category: 'Airway', log: 'Airway suctioned.', type: 'bolus', duration: 15, pk: { onset: 2, peak: 20, offset: 0, maxDoses: 3 } },
    // RSI is deliberately performable with ANY induction agent or none at all — the expectations
    // below are advisory only. No SpO2 jump: oxygenation during the apnoeic period is modelled in
    // engine.js (pre-oxygenation reservoir vs. apnoeic desaturation) rather than asserted here.
    'RSI': { label: 'RSI / Intubation', effect: { RR: 'vent', BP: -10, gcs: 'sedated' }, category: 'Airway', log: 'Rapid Sequence Induction performed. Patient intubated.', type: 'continuous', duration: 120,
        pk: { onset: 30, peak: 120, offset: 300 },
        expects: ['IV Access'],
        expectsAny: [
            { label: 'pre-oxygenation', keys: ['Preoxygenation', 'ApnoeicOxygenation', 'Oxygen', 'Bagging', 'NIV', 'CPAP'] },
            { label: 'an induction agent', keys: ['Propofol', 'Ketamine', 'Midazolam', 'Etomidate', 'Thiopentone'] },
            { label: 'a neuromuscular blocker', keys: ['Roc', 'Sux'] }
        ] },
    'Preoxygenation': { label: 'Pre-oxygenation (3 min)', effect: { SpO2: 4 }, category: 'Airway', log: 'Pre-oxygenation: 15L/min via tight-seal mask for 3 minutes, sitting up.', type: 'continuous', duration: 180, pk: { onset: 10, peak: 120, offset: 60 } },
    'ApnoeicOxygenation': { label: 'Apnoeic Oxygenation (NODESAT)', effect: {}, category: 'Airway', log: 'Nasal cannulae 15L/min left on for apnoeic oxygenation.', type: 'continuous', duration: 300 },
    'VideoLaryngoscopy': { label: 'Videolaryngoscopy', effect: {}, category: 'Airway', log: 'Videolaryngoscope used for intubation attempt.', type: 'continuous', duration: 60 },
    'Bougie': { label: 'Bougie / Stylet', effect: {}, category: 'Airway', log: 'Bougie railroaded — tracheal clicks felt.', type: 'bolus', duration: 30 },
    'Cricoid': { label: 'Cricoid Pressure', effect: {}, category: 'Airway', log: 'Cricoid pressure applied by trained assistant.', type: 'continuous', duration: 120 },
    'GoodView': { label: 'View: Grade 1-2 (good)', effect: {}, category: 'Airway', log: 'Laryngoscopy: Cormack-Lehane grade 1-2 view obtained.', type: 'bolus', duration: 10 },
    'PoorView': { label: 'View: Grade 3-4 (poor)', effect: {}, category: 'Airway', log: 'Laryngoscopy: Cormack-Lehane grade 3-4 view — difficult airway declared.', type: 'bolus', duration: 10 },
    'TubeConfirm': { label: 'Confirm Tube (ETCO2)', effect: {}, category: 'Airway', log: 'Tube position confirmed: sustained ETCO2 waveform, chest rise, bilateral air entry.', type: 'bolus', duration: 10 },
    'FailedIntubation': { label: 'Failed Intubation (DAS Plan B)', effect: {}, category: 'Airway', log: 'FAILED INTUBATION declared. Stop and think — DAS plan B: supraglottic airway rescue.', type: 'bolus', duration: 10 },
    'CICO': { label: 'Declare CICO', effect: {}, category: 'Airway', log: "CAN'T INTUBATE, CAN'T OXYGENATE declared. Call for help — proceed to front-of-neck access.", type: 'bolus', duration: 10 },
    'FONA': { label: 'FONA', effect: { SpO2: 60, RR: 'vent' }, category: 'Airway', log: 'Emergency FONA performed. Airway secured.', type: 'continuous', duration: 60, pk: { onset: 5, peak: 45, offset: 60 } },
    'Magills': { label: 'Magill Forceps', effect: { SpO2: 10 }, category: 'Airway', log: 'Foreign body removed with Magills.', type: 'bolus', duration: 15, pk: { onset: 2, peak: 20, offset: 0, maxDoses: 2 } },
    'ToggleETCO2': { label: 'Toggle ETCO2', effect: {}, category: 'Airway', log: 'ETCO2 monitoring toggled.', type: 'bolus', duration: 0 },

    // --- BREATHING ---
    // Oxygen no longer jumps: it ramps over ~1 min (shunt-dependent) and is sustained while on.
    'Oxygen': { label: 'High Flow O2', effect: { SpO2: 10 }, category: 'Breathing', log: 'High flow oxygen applied.', type: 'continuous', duration: 5, pk: { onset: 5, peak: 60, offset: 90 } },
    'Bagging': { label: 'Bag-Valve-Mask', effect: { SpO2: 25, RR: 'vent' }, category: 'Breathing', log: 'Manual ventilation (BVM) started.', type: 'continuous', duration: 5, pk: { onset: 5, peak: 45, offset: 45 } },
    // Nebulised beta-agonist: onset 5-15 min, peak 30-60 min, tachycardia and tremor, then wears off.
    'Nebs': { label: 'Nebs (Salb/Iprat)', effect: { HR: 12, RR: -3, SpO2: 5 }, category: 'Breathing', log: 'Nebulisers (Salbutamol/Ipratropium) administered.', type: 'bolus', duration: 300, pk: { onset: 120, peak: 600, offset: 2700, maxDoses: 3 } },
    'NebAdrenaline': { label: 'Neb Adrenaline', effect: { HR: 10, RR: -5, SpO2: 5 }, category: 'Breathing', log: 'Nebulised Adrenaline running.', type: 'bolus', duration: 300, pk: { onset: 180, peak: 900, offset: 7200, maxDoses: 3 } },
    'CPAP': { label: 'CPAP', effect: { SpO2: 10, RR: -5, BP: -5 }, category: 'Breathing', log: 'CPAP initiated.', type: 'continuous', duration: 60, pk: { onset: 10, peak: 90, offset: 120 } },
    'NIV': { label: 'NIV (BiPAP)', effect: { SpO2: 12, RR: -5, BP: -5 }, category: 'Breathing', log: 'NIV (BiPAP) initiated.', type: 'continuous', duration: 60, pk: { onset: 10, peak: 90, offset: 120 } },
    // GENUINELY INSTANT — a decompressed tension pneumothorax improves in seconds. No pk on purpose.
    'Needle': { label: 'Needle Decompression', effect: { SpO2: 20, BP: 15, RR: -8 }, category: 'Breathing', log: 'Needle thoracocentesis performed.', type: 'bolus', duration: 30 },
    'FingerThoracostomy': { label: 'Finger Thoracostomy', effect: { SpO2: 20, BP: 15, RR: -8 }, category: 'Breathing', log: 'Finger thoracostomy performed.', type: 'bolus', duration: 60 },
    'SeldingerDrain': { label: 'Chest Drain (Seldinger)', effect: { SpO2: 15, BP: 10, RR: -5 }, category: 'Breathing', log: 'Seldinger chest drain inserted.', type: 'continuous', duration: 450, pk: { onset: 10, peak: 90, offset: 120 } },
    'SurgicalDrain': { label: 'Chest Drain (Surgical)', effect: { SpO2: 15, BP: 10, RR: -5 }, category: 'Breathing', log: 'Surgical chest drain inserted.', type: 'continuous', duration: 600, pk: { onset: 10, peak: 90, offset: 120 } },
    'ChestSeal': { label: 'Chest Seal', effect: { SpO2: 5, RR: -2 }, category: 'Breathing', log: 'Chest seal applied.', type: 'continuous', duration: 15, pk: { onset: 5, peak: 45, offset: 60 } },

    // --- CIRCULATION ---
    'IV Access': { label: 'IV/IO Access', effect: {}, category: 'Circulation', log: 'IV/IO access secured.', type: 'continuous', duration: 30 },
    // 500 mL over 5-15 min: the pressure rises across the infusion and then partially decays as the
    // crystalloid redistributes. Four boluses is the sensible ceiling before blood/pressors.
    'Fluids': { label: 'Fluid Bolus', effect: { BP: 8, HR: -3 }, category: 'Circulation', log: 'Fluid bolus administered.', type: 'bolus', duration: 60, pk: { onset: 15, peak: 300, offset: 2400, maxDoses: 4 }, expects: ['IV Access'] },
    'Blood': { label: 'Blood (O Neg)', effect: { BP: 12, HR: -5 }, category: 'Circulation', log: 'O-Negative Blood administered.', type: 'bolus', duration: 300, pk: { onset: 30, peak: 600, offset: 5400, maxDoses: 6 }, expects: ['IV Access'] },
    'TXA': { label: 'TXA 1g', effect: {}, category: 'Circulation', log: 'IV Tranexamic Acid administered.', type: 'bolus', duration: 60, expects: ['IV Access'] },
    // AdrenalineIV previously had NO haemodynamic effect at all (only a rhythm chance). It is the
    // archetypal fast-on/fast-off pressor: < 1 min onset, ~2 min peak, gone by 5-10 min.
    'AdrenalineIV': { label: 'Adrenaline 1mg (IV)', effect: { HR: 25, BP: 30, changeRhythm: 'chance' }, category: 'Circulation', log: 'IV Adrenaline administered.', type: 'bolus', duration: 5, pk: { onset: 20, peak: 90, offset: 420, maxDoses: 4 }, expects: ['IV Access'] },
    'Amiodarone': { label: 'Amiodarone 300mg', effect: { BP: -8, changeRhythm: 'chance' }, category: 'Circulation', log: 'IV Amiodarone administered.', type: 'bolus', duration: 60, pk: { onset: 60, peak: 600, offset: 3600, maxDoses: 2 }, expects: ['IV Access'] },
    'Atropine': { label: 'Atropine 600mcg', effect: { HR: 20 }, category: 'Circulation', log: 'IV Atropine administered.', type: 'bolus', duration: 10, pk: { onset: 45, peak: 180, offset: 3600, maxDoses: 2 }, expects: ['IV Access'] },
    // GENUINELY NEAR-INSTANT AND TRANSIENT — adenosine works in 10-20s and is over inside a minute.
    'Adenosine': { label: 'Adenosine 6/12/12', effect: { HR: 'reset' }, category: 'Circulation', log: 'IV Adenosine rapid bolus administered.', type: 'bolus', duration: 2, expects: ['IV Access'] },
    'Metaraminol': { label: 'Metaraminol', effect: { BP: 15, HR: -3 }, category: 'Circulation', log: 'IV Metaraminol bolus administered.', type: 'bolus', duration: 10, pk: { onset: 45, peak: 120, offset: 1200, maxDoses: 4 }, expects: ['IV Access'] },
    // Infusion: sustained while running, offset 2-5 min after it is stopped.
    'Noradrenaline': { label: 'Noradrenaline Infusion', effect: { BP: 20 }, category: 'Circulation', log: 'Noradrenaline infusion started.', type: 'continuous', duration: 300, pk: { onset: 30, peak: 120, offset: 180 }, expects: ['IV Access'] },
    'GTN': { label: 'GTN Spray', effect: { BP: -8 }, category: 'Circulation', log: 'GTN Spray sublingual administered.', type: 'bolus', duration: 5, pk: { onset: 60, peak: 150, offset: 1500, maxDoses: 3 } },
    'GTNInfusion': { label: 'GTN Infusion', effect: { BP: -15 }, category: 'Circulation', log: 'GTN infusion started.', type: 'continuous', duration: 0, pk: { onset: 60, peak: 240, offset: 420 }, expects: ['IV Access'] },
    'FluidInfusion': { label: 'Fluid Infusion', effect: { BP: 5 }, category: 'Circulation', log: 'IV Fluid infusion started (Maintenance).', type: 'continuous', duration: 0, pk: { onset: 30, peak: 600, offset: 1800 }, expects: ['IV Access'] },
    // Electricity is instant. No pk, ever.
    'Defib': { label: 'Defibrillation (Shock)', effect: { changeRhythm: 'defib' }, category: 'Circulation', log: 'Shock Delivered.', type: 'bolus', duration: 5, expects: ['PacingPads'] },
    'Cardioversion': { label: 'Sync Cardioversion', effect: { changeRhythm: 'sync' }, category: 'Circulation', log: 'Synchronised DC Shock delivered.', type: 'bolus', duration: 5, expects: ['PacingPads'] },
    'Pacing': { label: 'External Pacing', effect: { HR: 'pace' }, category: 'Circulation', log: 'External Pacing initiated.', type: 'continuous', duration: 10, expects: ['PacingPads'] },
    'Lucas': { label: 'Lucas Device', effect: { BP: 30, cpr: true }, category: 'Circulation', log: 'Mechanical Chest Compression device applied.', type: 'continuous', duration: 30 },

    // --- DRUGS ---
    // Morphine: onset 5-10 min IV, peak 15-20 min, duration 3-4 h. Previously instant.
    'Analgesia': { label: 'Morphine', effect: { HR: -5, RR: -3, BP: -2 }, category: 'Drugs', log: 'IV Morphine administered.', type: 'bolus', duration: 10, pk: { onset: 180, peak: 900, offset: 10800, maxDoses: 4 }, expects: ['IV Access'] },
    'Fentanyl': { label: 'Fentanyl', effect: { HR: -2, RR: -3, BP: -2 }, category: 'Drugs', log: 'IV Fentanyl administered.', type: 'bolus', duration: 10, pk: { onset: 60, peak: 240, offset: 2400, maxDoses: 4 }, expects: ['IV Access'] },
    'Paracetamol': { label: 'Paracetamol IV', effect: {}, category: 'Drugs', log: 'IV Paracetamol administered.', type: 'bolus', duration: 10, expects: ['IV Access'] },
    // --- INDUCTION AGENTS: clinically differentiated haemodynamic profiles AND timing ---
    // gcs is numeric so the envelope can wake the patient up again: an induction dose wears off.
    'Ketamine': { label: 'Ketamine', effect: { gcs: -12, BP: 8, HR: 10 }, category: 'Drugs', log: 'IV Ketamine administered (1.5-2 mg/kg induction). Sympathomimetic — BP and HR preserved.', type: 'bolus', duration: 15, pk: { onset: 30, peak: 60, offset: 900, maxDoses: 2 }, expects: ['IV Access'] },
    'Midazolam': { label: 'Midazolam', effect: { gcs: -8, BP: -10, RR: -5 }, category: 'Drugs', log: 'IV Midazolam administered. Slower onset (2-3 min) — hypotension and respiratory depression expected.', type: 'bolus', duration: 10, pk: { onset: 120, peak: 240, offset: 2400, maxDoses: 3 }, expects: ['IV Access'] },
    'Etomidate': { label: 'Etomidate', effect: { gcs: -12, BP: -5 }, category: 'Drugs', log: 'IV Etomidate administered (0.3 mg/kg). Haemodynamically stable induction; adrenal suppression.', type: 'bolus', duration: 10, pk: { onset: 30, peak: 60, offset: 480, maxDoses: 1 }, expects: ['IV Access'] },
    'Thiopentone': { label: 'Thiopentone', effect: { gcs: -12, BP: -25, HR: 8 }, category: 'Drugs', log: 'IV Thiopentone administered (3-5 mg/kg). Marked venodilation and myocardial depression.', type: 'bolus', duration: 10, pk: { onset: 30, peak: 45, offset: 600, maxDoses: 1 }, expects: ['IV Access'] },
    'Alfentanil': { label: 'Alfentanil', effect: { HR: -8, BP: -8, RR: -6 }, category: 'Drugs', log: 'IV Alfentanil administered (10-20 mcg/kg). Blunts the pressor response to laryngoscopy.', type: 'bolus', duration: 10, pk: { onset: 30, peak: 90, offset: 900, maxDoses: 3 }, expects: ['IV Access'] },
    'Sugammadex': { label: 'Sugammadex', effect: { reverseParalysis: true }, category: 'Drugs', log: 'IV Sugammadex administered (16 mg/kg). Rocuronium blockade reversed — spontaneous ventilation returning.', type: 'bolus', duration: 10, expects: ['IV Access'] },
    'Lorazepam': { label: 'Lorazepam', effect: { gcs: -2, RR: -3 }, category: 'Drugs', log: 'IV Lorazepam administered.', type: 'bolus', duration: 10, pk: { onset: 180, peak: 420, offset: 14400, maxDoses: 3 }, expects: ['IV Access'] },
    // Naloxone MUST wear off: re-narcotisation at 30-60 min is the entire teaching point.
    'Naloxone': { label: 'Naloxone', effect: { RR: 10, gcs: 8 }, category: 'Drugs', log: 'IV Naloxone administered. Duration 30-60 min — SHORTER than most opioids, watch for re-narcotisation.', type: 'bolus', duration: 5, pk: { onset: 60, peak: 300, offset: 2400, maxDoses: 4 }, expects: ['IV Access'] },
    // Antibiotics: correctly NO acute obs change. No effect, no pk.
    'Antibiotics': { label: 'Co-Amoxiclav', effect: {}, category: 'Drugs', log: 'IV Co-Amoxiclav administered.', type: 'bolus', duration: 30, expects: ['IV Access'] },
    'Ceftriaxone': { label: 'Ceftriaxone', effect: {}, category: 'Drugs', log: 'IV Ceftriaxone administered.', type: 'bolus', duration: 30, expects: ['IV Access'] },
    'Tazocin': { label: 'Tazocin (Pip/Taz)', effect: {}, category: 'Drugs', log: 'IV Tazocin administered.', type: 'bolus', duration: 30, expects: ['IV Access'] },
    'Gentamicin': { label: 'Gentamicin', effect: {}, category: 'Drugs', log: 'IV Gentamicin administered.', type: 'bolus', duration: 30, expects: ['IV Access'] },
    'Antiemetic': { label: 'Ondansetron', effect: {}, category: 'Drugs', log: 'IV Ondansetron administered.', type: 'bolus', duration: 10, expects: ['IV Access'] },
    'Cyclizine': { label: 'Cyclizine', effect: { HR: 5 }, category: 'Drugs', log: 'IV Cyclizine administered.', type: 'bolus', duration: 10, pk: { onset: 120, peak: 600, offset: 3600, maxDoses: 2 }, expects: ['IV Access'] },
    // Magnesium runs over 20 min — gradual bronchodilation and flushing, not an instant change.
    'MagSulph': { label: 'Magnesium Sulphate', effect: { BP: -5, RR: -2 }, category: 'Drugs', log: 'IV Magnesium Sulphate administered (over 20 min).', type: 'bolus', duration: 600, pk: { onset: 300, peak: 1200, offset: 5400, maxDoses: 2 }, expects: ['IV Access'] },
    'Calcium': { label: 'Calcium Gluconate', effect: { BP: 5 }, category: 'Drugs', log: 'IV Calcium Gluconate administered.', type: 'bolus', duration: 30, pk: { onset: 60, peak: 180, offset: 2400, maxDoses: 3 }, expects: ['IV Access'] },
    'CalciumChloride': { label: 'Calcium Chloride', effect: { BP: 8, HR: 5 }, category: 'Drugs', log: 'IV Calcium Chloride administered.', type: 'bolus', duration: 30, pk: { onset: 45, peak: 150, offset: 2400, maxDoses: 3 }, expects: ['IV Access'] },
    // BM is a real vital now. Insulin/dextrose is given for hyperkalaemia: the dextrose load nudges
    // the glucose up over 10-15 min. (Serum K+ is not modelled in the obs panel — see the log note.)
    'InsulinDextrose': { label: 'Insulin/Dextrose', effect: { BM: 1.5 }, category: 'Drugs', log: 'Insulin/Dextrose bolus started (Hyperkalaemia). K+ shifts intracellularly over 15-30 min.', type: 'bolus', duration: 60, pk: { onset: 120, peak: 900, offset: 3600, maxDoses: 3 }, expects: ['IV Access'] },
    'Dextrose': { label: 'Glucose 10%', effect: { BM: 8 }, category: 'Drugs', log: 'IV Glucose/Dextrose administered.', type: 'bolus', duration: 60, pk: { onset: 60, peak: 180, offset: 2700, maxDoses: 3 }, expects: ['IV Access'] },
    'InsulinInfusion': { label: 'Insulin Infusion', effect: { BM: -5 }, category: 'Drugs', log: 'Fixed rate Insulin infusion started (0.1 u/kg/hr). Expect ~3 mmol/L/hr fall.', type: 'continuous', duration: 0, pk: { onset: 180, peak: 2400, offset: 1800 }, expects: ['IV Access'] },
    // Hydrocortisone's haemodynamic benefit is a matter of HOURS, not minutes: effectively no acute
    // change inside a simulation, which is the clinically honest answer.
    'Hydrocortisone': { label: 'Hydrocortisone', effect: { BP: 5 }, category: 'Drugs', log: 'IV Hydrocortisone administered. Haemodynamic effect takes hours, not minutes.', type: 'bolus', duration: 10, pk: { onset: 900, peak: 3600, offset: 0, maxDoses: 1 }, expects: ['IV Access'] },
    'Dexamethasone': { label: 'Dexamethasone', effect: {}, category: 'Drugs', log: 'IV Dexamethasone administered.', type: 'bolus', duration: 10, expects: ['IV Access'] },
    'Aspirin': { label: 'Aspirin 300mg', effect: {}, category: 'Drugs', log: 'Aspirin PO administered.', type: 'bolus', duration: 10 },
    'Clopidogrel': { label: 'Clopidogrel', effect: {}, category: 'Drugs', log: 'Clopidogrel PO administered.', type: 'bolus', duration: 10 },
    'Ticagrelor': { label: 'Ticagrelor', effect: {}, category: 'Drugs', log: 'Ticagrelor PO administered.', type: 'bolus', duration: 10 },
    'Heparin': { label: 'Heparin / LMWH', effect: {}, category: 'Drugs', log: 'Anticoagulation administered.', type: 'bolus', duration: 10 },
    // --- NEUROMUSCULAR BLOCKERS ---
    // Wave 2: the blockade is now driven by the SAME pk entry as everything else — onset = pk.onset,
    // end of blockade = pk.offset. Roc ~60s / ~45 min, sux ~45s / ~8 min. One timer, not two.
    'Roc': { label: 'Rocuronium', effect: { paralysed: true }, paralysis: { onset: 60, duration: 2700 }, category: 'Drugs', log: 'IV Rocuronium administered (1.2 mg/kg). Onset ~60s, duration ~45 min.', type: 'bolus', duration: 10, pk: { onset: 60, peak: 120, offset: 2760, maxDoses: 2 }, expects: ['IV Access'] },
    'Sux': { label: 'Suxamethonium', effect: { paralysed: true }, paralysis: { onset: 45, duration: 480 }, category: 'Drugs', log: 'IV Suxamethonium administered (1.5 mg/kg). Fasciculations, then onset ~45s, duration ~8 min.', type: 'bolus', duration: 10, pk: { onset: 45, peak: 75, offset: 525, maxDoses: 2 }, expects: ['IV Access'] },
    'Propofol': { label: 'Propofol', effect: { gcs: -12, BP: -25, RR: -6 }, category: 'Drugs', log: 'IV Propofol administered (1-2 mg/kg induction). Significant vasodilatation — expect a BP drop.', type: 'bolus', duration: 10, pk: { onset: 30, peak: 90, offset: 600, maxDoses: 3 }, expects: ['IV Access'] },
    // IM adrenaline: onset 3-5 min, peak ~10 min, duration 20-30 min. Was instant.
    'AdrenalineIM': { label: 'Adrenaline 500mcg (IM)', effect: { HR: 15, BP: 15, SpO2: 5 }, category: 'Drugs', log: 'IM Adrenaline administered (anterolateral thigh).', type: 'bolus', duration: 300, pk: { onset: 180, peak: 600, offset: 1800, maxDoses: 3 } },
    'Glucagon': { label: 'Glucagon', effect: { BM: 5 }, category: 'Drugs', log: 'IM Glucagon administered.', type: 'bolus', duration: 30, pk: { onset: 300, peak: 900, offset: 5400, maxDoses: 2 } },
    'Labetalol': { label: 'Labetalol', effect: { BP: -20, HR: -10 }, category: 'Drugs', log: 'IV Labetalol administered.', type: 'bolus', duration: 15, pk: { onset: 120, peak: 600, offset: 7200, maxDoses: 3 }, expects: ['IV Access'] },
    'Phentolamine': { label: 'Phentolamine', effect: { BP: -20 }, category: 'Drugs', log: 'IV Phentolamine administered.', type: 'bolus', duration: 10, pk: { onset: 60, peak: 180, offset: 1800, maxDoses: 3 }, expects: ['IV Access'] },
    'Digibind': { label: 'Digibind', effect: { HR: 10 }, category: 'Drugs', log: 'Digoxin-specific antibody fragments administered. Onset 20-30 min.', type: 'bolus', duration: 60, pk: { onset: 1200, peak: 1800, offset: 0, maxDoses: 2 }, expects: ['IV Access'] },
    // pH is a modelled vital now: bicarbonate shifts it over minutes.
    'SodiumBicarb': { label: 'Sodium Bicarbonate', effect: { pH: 0.1, BP: 3 }, category: 'Drugs', log: 'IV Sodium Bicarbonate administered.', type: 'bolus', duration: 30, pk: { onset: 60, peak: 300, offset: 2400, maxDoses: 3 }, expects: ['IV Access'] },
    'HypertonicSaline': { label: 'Hypertonic Saline', effect: { BP: 5, gcs: 2 }, category: 'Drugs', log: 'Hypertonic Saline (3%) administered. ICP falls over 5-20 min.', type: 'bolus', duration: 30, pk: { onset: 120, peak: 600, offset: 5400, maxDoses: 2 }, expects: ['IV Access'] },
    'T3T4': { label: 'Liothyronine (T3)', effect: { HR: 5, Temp: 0.5 }, category: 'Drugs', log: 'IV Liothyronine administered. Onset is measured in hours.', type: 'bolus', duration: 30, pk: { onset: 1800, peak: 5400, offset: 0, maxDoses: 2 }, expects: ['IV Access'] },
    'Bisphosphonate': { label: 'Bisphosphonate', effect: {}, category: 'Drugs', log: 'IV Bisphosphonate administered.', type: 'bolus', duration: 60, expects: ['IV Access'] },
    'IVIG': { label: 'IVIG', effect: {}, category: 'Drugs', log: 'Intravenous Immunoglobulin administered.', type: 'bolus', duration: 60, expects: ['IV Access'] },
    'Chlorphenamine': { label: 'Chlorphenamine', effect: {}, category: 'Drugs', log: 'IV Chlorphenamine administered.', type: 'bolus', duration: 10, expects: ['IV Access'] },
    'Lipid': { label: 'Intralipid 20%', effect: {}, category: 'Drugs', log: 'Intralipid 20% emulsion administered.', type: 'bolus', duration: 60, expects: ['IV Access'] },
    'Desferrioxamine': { label: 'Desferrioxamine', effect: {}, category: 'Drugs', log: 'IV Desferrioxamine infusion started.', type: 'continuous', duration: 0, expects: ['IV Access'] },
    'Fomepizole': { label: 'Fomepizole', effect: {}, category: 'Drugs', log: 'IV Fomepizole administered.', type: 'bolus', duration: 30, expects: ['IV Access'] },
    // Temp is a modelled vital now: dantrolene cools over 15-60 min and holds.
    'Dantrolene': { label: 'Dantrolene', effect: { Temp: -1 }, category: 'Drugs', log: 'IV Dantrolene administered.', type: 'bolus', duration: 30, pk: { onset: 300, peak: 1800, offset: 0, maxDoses: 3 }, expects: ['IV Access'] },
    'Pralidoxime': { label: 'Pralidoxime', effect: {}, category: 'Drugs', log: 'IV Pralidoxime administered.', type: 'bolus', duration: 30, expects: ['IV Access'] },
    'Charcoal': { label: 'Activated Charcoal', effect: {}, category: 'Drugs', log: 'Activated Charcoal administered.', type: 'bolus', duration: 10 },
    'Lactulose': { label: 'Lactulose', effect: {}, category: 'Drugs', log: 'Lactulose administered.', type: 'bolus', duration: 10 },
    'Rifaximin': { label: 'Rifaximin', effect: {}, category: 'Drugs', log: 'Rifaximin administered.', type: 'bolus', duration: 10 },
    // Terlipressin: onset 15-30 min. Was instant.
    'Terlipressin': { label: 'Terlipressin', effect: { BP: 10 }, category: 'Drugs', log: 'IV Terlipressin administered. Onset 15-30 min.', type: 'bolus', duration: 10, pk: { onset: 900, peak: 1800, offset: 7200, maxDoses: 2 }, expects: ['IV Access'] },
    'Octaplex': { label: 'Octaplex / PCC', effect: {}, category: 'Drugs', log: 'Prothrombin Complex Concentrate administered.', type: 'bolus', duration: 30, expects: ['IV Access'] },
    'VitaminK': { label: 'Vitamin K', effect: {}, category: 'Drugs', log: 'IV Vitamin K administered.', type: 'bolus', duration: 10, expects: ['IV Access'] },
    'Rasburicase': { label: 'Rasburicase', effect: {}, category: 'Drugs', log: 'IV Rasburicase administered.', type: 'bolus', duration: 10, expects: ['IV Access'] },
    'VitaminA': { label: 'Vitamin A', effect: {}, category: 'Drugs', log: 'Vitamin A administered.', type: 'bolus', duration: 10 },
    'Acetazolamide': { label: 'Acetazolamide', effect: {}, category: 'Drugs', log: 'IV Acetazolamide administered.', type: 'bolus', duration: 10, expects: ['IV Access'] },
    'Cyproheptadine': { label: 'Cyproheptadine', effect: {}, category: 'Drugs', log: 'Cyproheptadine administered.', type: 'bolus', duration: 10 },
    'Thrombolysis': { label: 'Thrombolysis (Alteplase)', effect: {}, category: 'Drugs', log: 'IV thrombolysis (alteplase) commenced.', type: 'bolus', duration: 60, expects: ['IV Access'] },
    'Nimodipine': { label: 'Nimodipine', effect: { BP: -5 }, category: 'Drugs', log: 'Nimodipine administered.', type: 'bolus', duration: 10, pk: { onset: 600, peak: 1800, offset: 0, maxDoses: 2 } },
    'Pabrinex': { label: 'Pabrinex / Thiamine', effect: {}, category: 'Drugs', log: 'IV Pabrinex (thiamine) administered.', type: 'bolus', duration: 30, expects: ['IV Access'] },
    'Antivenom': { label: 'Antivenom', effect: {}, category: 'Drugs', log: 'Antivenom administered.', type: 'bolus', duration: 30, expects: ['IV Access'] },
    'Oxytocin': { label: 'Oxytocin', effect: { BP: -5 }, category: 'Drugs', log: 'IV Oxytocin administered.', type: 'bolus', duration: 10, pk: { onset: 60, peak: 180, offset: 1200, maxDoses: 3 }, expects: ['IV Access'] },
    'Ergometrine': { label: 'Ergometrine', effect: { BP: 10 }, category: 'Drugs', log: 'IV Ergometrine administered.', type: 'bolus', duration: 10, pk: { onset: 120, peak: 420, offset: 3600, maxDoses: 2 }, expects: ['IV Access'] },
    'Carboprost': { label: 'Carboprost', effect: {}, category: 'Drugs', log: 'IM Carboprost administered.', type: 'bolus', duration: 10 },
    'AntiD': { label: 'Anti-D Ig', effect: {}, category: 'Drugs', log: 'Anti-D Immunoglobulin administered.', type: 'bolus', duration: 10, expects: ['IV Access'] },
    'Prostin': { label: 'Dinoprostone (Prostin)', effect: {}, category: 'Drugs', log: 'IV Dinoprostone infusion started.', type: 'continuous', duration: 0, expects: ['IV Access'] },
    'Furosemide': { label: 'Furosemide', effect: { BP: -5 }, category: 'Drugs', log: 'IV Furosemide administered. Venodilation ~5 min, diuresis ~30 min.', type: 'bolus', duration: 30, pk: { onset: 300, peak: 1800, offset: 21600, maxDoses: 2 }, expects: ['IV Access'] },
    'Albumin': { label: 'Human Albumin Solution', effect: { BP: 5 }, category: 'Drugs', log: 'IV Albumin administered.', type: 'bolus', duration: 60, pk: { onset: 120, peak: 1800, offset: 5400, maxDoses: 3 }, expects: ['IV Access'] },
    'TopicalEyeDrops': { label: 'Topical Eye Drops', effect: {}, category: 'Drugs', log: 'Topical eye drops (Timolol/Pilocarpine) applied.', type: 'bolus', duration: 10 },

    // --- PROCEDURES ---
    'Obs': { label: 'Attach Monitoring', effect: {}, category: 'Procedures', log: 'Monitoring applied. Vitals now visible.', type: 'continuous', duration: 5 },
    'ArtLine': { label: 'Arterial Line', effect: {}, category: 'Procedures', log: 'Arterial line inserted.', type: 'continuous', duration: 120 },
    'CVC': { label: 'Central Line', effect: {}, category: 'Procedures', log: 'Central venous catheter inserted.', type: 'continuous', duration: 180, expects: ['IV Access'] },
    'Catheter': { label: 'Urinary Catheter', effect: {}, category: 'Procedures', log: 'Urinary catheter inserted.', type: 'continuous', duration: 60 },
    'NGTube': { label: 'NG Tube', effect: {}, category: 'Procedures', log: 'Nasogastric tube inserted.', type: 'continuous', duration: 60 },
    // Active warming/cooling: roughly 0.5-2 degC per hour, sustained while running. Temp is modelled.
    'Warming': { label: 'Active Warming', effect: { Temp: 1.5 }, category: 'Procedures', log: 'Active warming started (Bair Hugger / warmed fluids).', type: 'continuous', duration: 600, pk: { onset: 120, peak: 3600, offset: 1800 } },
    'Cooling': { label: 'Active Cooling', effect: { Temp: -1.5 }, category: 'Procedures', log: 'Active cooling started.', type: 'continuous', duration: 600, pk: { onset: 120, peak: 3600, offset: 1800 } },
    'CPR': { label: 'Start CPR', effect: { BP: 40, cpr: true }, category: 'Procedures', log: 'Chest compressions started.', type: 'continuous', duration: 5 },
    'Splinting': { label: 'Splint / Immobilise', effect: {}, category: 'Procedures', log: 'Limb splinted / immobilised.', type: 'continuous', duration: 60 },
    'Collar': { label: 'C-Spine Collar', effect: {}, category: 'Procedures', log: 'C-Spine immobilisation applied.', type: 'continuous', duration: 15 },
    'PelvicBinder': { label: 'Pelvic Binder', effect: { BP: 5 }, category: 'Procedures', log: 'Pelvic binder applied.', type: 'continuous', duration: 30, pk: { onset: 10, peak: 90, offset: 120 } },
    'Thoracotomy': { label: 'Resus Thoracotomy', effect: { BP: 20, SpO2: 15 }, category: 'Procedures', log: 'Resuscitative Thoracotomy performed.', type: 'bolus', duration: 120 },
    'REBOA': { label: 'REBOA', effect: { BP: 30 }, category: 'Procedures', log: 'REBOA catheter deployed.', type: 'continuous', duration: 120, pk: { onset: 5, peak: 45, offset: 90 }, expects: ['IV Access'] },
    'PPCI': { label: 'PPCI Referral', effect: {}, category: 'Procedures', log: 'Urgent transfer for Primary PCI.', type: 'bolus', duration: 300 },
    'AsciticTap': { label: 'Ascitic Tap', effect: {}, category: 'Procedures', log: 'Ascitic tap/paracentesis performed.', type: 'bolus', duration: 60 },
    'Hyperbaric': { label: 'Hyperbaric Referral', effect: {}, category: 'Procedures', log: 'Referral to hyperbaric unit made.', type: 'bolus', duration: 10 },
    'Surgery': { label: 'Emergency Surgery', effect: {}, category: 'Procedures', log: 'Patient transferred to theatre.', type: 'bolus', duration: 300 },
    'Delivery': { label: 'Vaginal Delivery', effect: {}, category: 'Procedures', log: 'Baby delivered.', type: 'bolus', duration: 60 },
    'Hysterotomy': { label: 'Perimortem C-Section', effect: {}, category: 'Procedures', log: 'Perimortem C-Section performed.', type: 'bolus', duration: 60 },
    'NerveBlock': { label: 'Nerve Block (FIB)', effect: { HR: -5 }, category: 'Procedures', log: 'Fascia Iliaca Block performed.', type: 'bolus', duration: 120, pk: { onset: 300, peak: 900, offset: 14400, maxDoses: 2 } },
    'Canthotomy': { label: 'Lat. Canthotomy', effect: {}, category: 'Procedures', log: 'Lateral Canthotomy performed.', type: 'bolus', duration: 60 },
    'Escharotomy': { label: 'Escharotomy', effect: {}, category: 'Procedures', log: 'Escharotomy performed.', type: 'bolus', duration: 120 },
    'AirEnema': { label: 'Air Enema', effect: {}, category: 'Procedures', log: 'Radiological air enema performed.', type: 'bolus', duration: 120 },
    // GENUINELY NEAR-INSTANT — relieving tamponade works immediately. No pk.
    'Pericardiocentesis': { label: 'Pericardiocentesis', effect: { BP: 20, HR: -10 }, category: 'Procedures', log: 'Needle pericardiocentesis performed.', type: 'bolus', duration: 60 },
    'Tourniquet': { label: 'Tourniquet', effect: {}, category: 'Procedures', log: 'Tourniquet applied.', type: 'continuous', duration: 10 },
    'Plaster': { label: 'Plaster / Backslab', effect: {}, category: 'Procedures', log: 'Plaster backslab applied.', type: 'continuous', duration: 120 },
    'ClingFilm': { label: 'Cling Film', effect: { Temp: 0.5 }, category: 'Procedures', log: 'Burns covered with cling film (reduces evaporative heat loss).', type: 'continuous', duration: 30, pk: { onset: 180, peak: 1800, offset: 900 } },
    'ExchangeTransfusion': { label: 'Exchange Transfusion', effect: {}, category: 'Procedures', log: 'Exchange Transfusion started.', type: 'continuous', duration: 300, expects: ['IV Access'] },
    'LumbarPuncture': { label: 'Lumbar Puncture', effect: {}, category: 'Procedures', log: 'Lumbar puncture performed.', type: 'bolus', duration: 300 },
    'Reduction': { label: 'Reduction / Manipulation', effect: {}, category: 'Procedures', log: 'Fracture / dislocation reduced under analgesia.', type: 'bolus', duration: 120 },
    'Phototherapy': { label: 'Phototherapy', effect: {}, category: 'Procedures', log: 'Phototherapy commenced.', type: 'continuous', duration: 60 },
    'Irrigation': { label: 'Irrigation', effect: {}, category: 'Procedures', log: 'Copious irrigation started.', type: 'continuous', duration: 300 },
    'PacingPads': { label: 'Pacing Pads', effect: {}, category: 'Procedures', log: 'Defib/Pacing pads applied.', type: 'continuous', duration: 10 },
};
