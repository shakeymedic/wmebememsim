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
    'Manoeuvres': { label: 'Head Tilt / Jaw Thrust', route: 'manual', effect: { SpO2: 5 }, category: 'Airway', log: 'Airway manoeuvres applied.', type: 'continuous', duration: 5, pk: { onset: 5, peak: 30, offset: 0 } },
    'OPA': { label: 'Guedel / OPA', route: 'oropharyngeal', effect: { SpO2: 5 }, category: 'Airway', log: 'Oropharyngeal airway inserted.', type: 'continuous', duration: 10 },
    'NPA': { label: 'Nasopharyngeal', route: 'nasopharyngeal', effect: { SpO2: 5 }, category: 'Airway', log: 'Nasopharyngeal airway inserted.', type: 'continuous', duration: 15 },
    // Oxygenation via a rescue airway takes 15-60s to show on the probe, then is sustained.
    'i-gel': { label: 'i-gel / LMA', route: 'supraglottic', effect: { SpO2: 15, RR: 'vent' }, category: 'Airway', log: 'Supraglottic airway (i-gel) inserted.', type: 'continuous', duration: 30, pk: { onset: 5, peak: 40, offset: 60 } },
    'Suction': { label: 'Suction', route: 'manual', effect: { SpO2: 5 }, category: 'Airway', log: 'Airway suctioned.', type: 'bolus', duration: 15, pk: { onset: 2, peak: 20, offset: 0, maxDoses: 3 } },
    // RSI is deliberately performable with ANY induction agent or none at all — the expectations
    // below are advisory only. No SpO2 jump: oxygenation during the apnoeic period is modelled in
    // engine.js (pre-oxygenation reservoir vs. apnoeic desaturation) rather than asserted here.
    'RSI': { label: 'RSI / Intubation', route: 'IV + oral ETT', effect: { RR: 'vent', BP: -20, gcs: 'sedated' }, category: 'Airway', log: 'Rapid Sequence Induction performed. Patient intubated.', type: 'continuous', duration: 120,
        pk: { onset: 30, peak: 120, offset: 300 },
        expects: ['IV Access'],
        expectsAny: [
            { label: 'pre-oxygenation', keys: ['Preoxygenation', 'ApnoeicOxygenation', 'Oxygen', 'Bagging', 'NIV', 'CPAP'] },
            { label: 'an induction agent', keys: ['Propofol', 'Ketamine', 'Midazolam', 'Etomidate', 'Thiopentone'] },
            { label: 'a neuromuscular blocker', keys: ['Roc', 'Sux'] }
        ] },
    'Preoxygenation': { label: 'Pre-oxygenation (3 min)', route: 'face mask', effect: { SpO2: 4 }, category: 'Airway', log: 'Pre-oxygenation: 15L/min via tight-seal mask for 3 minutes, sitting up.', type: 'continuous', duration: 180, pk: { onset: 10, peak: 180, offset: 120 }, safeApnoea: { adult: 360, child: 180, infant: 120 } },
    'ApnoeicOxygenation': { label: 'Apnoeic Oxygenation (NODESAT)', route: 'nasal', effect: {}, category: 'Airway', log: 'Nasal cannulae 15L/min left on for apnoeic oxygenation.', type: 'continuous', duration: 300, safeApnoea: { extendFactor: 1.5, dropFactor: 0.5 } },
    'VideoLaryngoscopy': { label: 'Videolaryngoscopy', route: 'oral', effect: {}, category: 'Airway', log: 'Videolaryngoscope used for intubation attempt.', type: 'continuous', duration: 60 },
    'Bougie': { label: 'Bougie / Stylet', route: 'oral', effect: {}, category: 'Airway', log: 'Bougie railroaded — tracheal clicks felt.', type: 'bolus', duration: 30 },
    'Cricoid': { label: 'Cricoid Pressure', route: 'manual', effect: {}, category: 'Airway', log: 'Cricoid pressure applied by trained assistant.', type: 'continuous', duration: 120 },
    'GoodView': { label: 'View: Grade 1-2 (good)', route: 'n/a', effect: {}, category: 'Airway', log: 'Laryngoscopy: Cormack-Lehane grade 1-2 view obtained.', type: 'bolus', duration: 10 },
    'PoorView': { label: 'View: Grade 3-4 (poor)', route: 'n/a', effect: {}, category: 'Airway', log: 'Laryngoscopy: Cormack-Lehane grade 3-4 view — difficult airway declared.', type: 'bolus', duration: 10 },
    'TubeConfirm': { label: 'Confirm Tube (ETCO2)', route: 'n/a', effect: {}, category: 'Airway', log: 'Tube position confirmed: sustained ETCO2 waveform, chest rise, bilateral air entry.', type: 'bolus', duration: 10 },
    'FailedIntubation': { label: 'Failed Intubation (DAS Plan B)', route: 'n/a', effect: {}, category: 'Airway', log: 'FAILED INTUBATION declared. Stop and think — DAS plan B: supraglottic airway rescue.', type: 'bolus', duration: 10 },
    'CICO': { label: 'Declare CICO', route: 'n/a', effect: {}, category: 'Airway', log: "CAN'T INTUBATE, CAN'T OXYGENATE declared. Call for help — proceed to front-of-neck access.", type: 'bolus', duration: 10 },
    'FONA': { label: 'FONA', route: 'front-of-neck', effect: { SpO2: 60, RR: 'vent' }, category: 'Airway', log: 'Emergency FONA performed. Airway secured.', type: 'continuous', duration: 60, pk: { onset: 5, peak: 45, offset: 60 } },
    'Magills': { label: 'Magill Forceps', route: 'oral', effect: { SpO2: 10 }, category: 'Airway', log: 'Foreign body removed with Magills.', type: 'bolus', duration: 15, pk: { onset: 2, peak: 20, offset: 0, maxDoses: 2 } },
    'ToggleETCO2': { label: 'Toggle ETCO2', route: 'n/a', effect: {}, category: 'Airway', log: 'ETCO2 monitoring toggled.', type: 'bolus', duration: 0 },

    // --- BREATHING ---
    // Oxygen no longer jumps: it ramps over ~1 min (shunt-dependent) and is sustained while on.
    'Oxygen': { label: 'High Flow O2', route: 'face mask', effect: { SpO2: 10 }, category: 'Breathing', log: 'High flow oxygen applied.', type: 'continuous', duration: 5, pk: { onset: 5, peak: 60, offset: 90 } },
    'Bagging': { label: 'Bag-Valve-Mask', route: 'BVM', effect: { SpO2: 25, RR: 'vent' }, category: 'Breathing', log: 'Manual ventilation (BVM) started.', type: 'continuous', duration: 5, pk: { onset: 5, peak: 45, offset: 45 } },
    // Nebulised beta-agonist: onset 5-15 min, peak 30-60 min, tachycardia and tremor, then wears off.
    'Nebs': { label: 'Nebs (Salb/Iprat)', route: 'NEB', effect: { HR: 12, RR: -3, SpO2: 3, K: -0.4 }, category: 'Breathing', log: 'Nebulisers (Salbutamol/Ipratropium) administered.', type: 'bolus', duration: 300, pk: { onset: 120, peak: 900, offset: 5400, maxDoses: 6 }, ceiling: { vital: 'hr', value: 150 } },
    'NebAdrenaline': { label: 'Neb Adrenaline', route: 'NEB', effect: { HR: 10, RR: -5, SpO2: 5 }, category: 'Breathing', log: 'Nebulised Adrenaline running.', type: 'bolus', duration: 300, pk: { onset: 120, peak: 600, offset: 7200, maxDoses: 3 } },
    'CPAP': { label: 'CPAP', route: 'mask', effect: { SpO2: 10, RR: -5, BP: -5 }, category: 'Breathing', log: 'CPAP initiated.', type: 'continuous', duration: 60, pk: { onset: 10, peak: 90, offset: 120 } },
    'NIV': { label: 'NIV (BiPAP)', route: 'mask', effect: { SpO2: 12, RR: -5, BP: -5 }, category: 'Breathing', log: 'NIV (BiPAP) initiated.', type: 'continuous', duration: 60, pk: { onset: 10, peak: 90, offset: 120 } },
    // GENUINELY INSTANT — a decompressed tension pneumothorax improves in seconds. No pk on purpose.
    'Needle': { label: 'Needle Decompression', route: 'percutaneous', effect: { SpO2: 20, BP: 15, RR: -8 }, category: 'Breathing', log: 'Needle thoracocentesis performed.', type: 'bolus', duration: 30 },
    'FingerThoracostomy': { label: 'Finger Thoracostomy', route: 'surgical', effect: { SpO2: 20, BP: 15, RR: -8 }, category: 'Breathing', log: 'Finger thoracostomy performed.', type: 'bolus', duration: 60 },
    'SeldingerDrain': { label: 'Chest Drain (Seldinger)', route: 'percutaneous', effect: { SpO2: 15, BP: 10, RR: -5 }, category: 'Breathing', log: 'Seldinger chest drain inserted.', type: 'continuous', duration: 450, pk: { onset: 10, peak: 90, offset: 120 } },
    'SurgicalDrain': { label: 'Chest Drain (Surgical)', route: 'surgical', effect: { SpO2: 15, BP: 10, RR: -5 }, category: 'Breathing', log: 'Surgical chest drain inserted.', type: 'continuous', duration: 600, pk: { onset: 10, peak: 90, offset: 120 } },
    'ChestSeal': { label: 'Chest Seal', route: 'topical', effect: { SpO2: 5, RR: -2 }, category: 'Breathing', log: 'Chest seal applied.', type: 'continuous', duration: 15, pk: { onset: 5, peak: 45, offset: 60 } },

    // --- CIRCULATION ---
    'IV Access': { label: 'IV/IO Access', route: 'IV/IO', effect: {}, category: 'Circulation', log: 'IV/IO access secured.', type: 'continuous', duration: 30 },
    // 500 mL over 5-15 min: the pressure rises across the infusion and then partially decays as the
    // crystalloid redistributes. Four boluses is the sensible ceiling before blood/pressors.
    'Fluids': { label: 'Fluid Bolus', route: 'IV', effect: { BP: 8, HR: -3 }, category: 'Circulation', log: 'Fluid bolus administered.', type: 'bolus', duration: 60, pk: { onset: 60, peak: 600, offset: 3600, maxDoses: 4 }, expects: ['IV Access'], volume: true },
    'Blood': { label: 'Blood (O Neg)', route: 'IV', effect: { BP: 12, HR: -5 }, category: 'Circulation', log: 'O-Negative Blood administered.', type: 'bolus', duration: 300, pk: { onset: 60, peak: 900, offset: 0, maxDoses: 6 }, expects: ['IV Access'], volume: true },
    'TXA': { label: 'TXA 1g', route: 'IV', effect: {}, category: 'Circulation', log: 'IV Tranexamic Acid administered.', type: 'bolus', duration: 60, expects: ['IV Access'] },
    // AdrenalineIV previously had NO haemodynamic effect at all (only a rhythm chance). It is the
    // archetypal fast-on/fast-off pressor: < 1 min onset, ~2 min peak, gone by 5-10 min.
    'AdrenalineIV': { label: 'Adrenaline 1mg (IV)', route: 'IV', effect: { HR: 25, BP: 30, changeRhythm: 'chance' }, category: 'Circulation', log: 'IV Adrenaline administered.', type: 'bolus', duration: 5, pk: { onset: 20, peak: 90, offset: 420, maxDoses: 6 }, expects: ['IV Access'] },
    'Amiodarone': { label: 'Amiodarone 300mg', route: 'IV', effect: { BP: -10, changeRhythm: 'chance' }, category: 'Circulation', log: 'IV Amiodarone administered.', type: 'bolus', duration: 60, pk: { onset: 30, peak: 600, offset: 7200, maxDoses: 2 }, expects: ['IV Access'] },
    'Atropine': { label: 'Atropine 600mcg', route: 'IV', effect: { HR: 12 }, category: 'Circulation', log: 'IV Atropine administered.', type: 'bolus', duration: 10, pk: { onset: 30, peak: 180, offset: 3600, maxDoses: 5 }, expects: ['IV Access'], cumulative: { unit: 'mg', perDose: 0.6, max: 3, message: 'Maximum 3 mg cumulative atropine reached — full vagal blockade. Further doses are futile: pace (transcutaneous/transvenous) or start an isoprenaline/adrenaline infusion.' }, ceiling: { vital: 'hr', value: 115 } },
    // GENUINELY NEAR-INSTANT AND TRANSIENT — adenosine works in 10-20s and is over inside a minute.
    'Adenosine': { label: 'Adenosine 6/12/12', route: 'IV (rapid push + flush)', effect: { HR: -60, changeRhythm: 'chance' }, category: 'Circulation', log: 'IV Adenosine rapid bolus administered.', type: 'bolus', duration: 2, expects: ['IV Access'], pk: { onset: 5, peak: 10, plateau: 15, offset: 40, maxDoses: 3 }, cumulative: { unit: 'mg', perDose: 12, max: 30, message: 'Adenosine 6/12/12 completed without conversion — stop escalating: reconsider the diagnosis (is this AF/flutter/VT?) and move to rate control or synchronised cardioversion.' }, avBlock: { pause: 8, convertAt: 12, chanceByDose: [0.55, 0.75, 0.8] } },
    'Metaraminol': { label: 'Metaraminol', route: 'IV', effect: { BP: 15, HR: -3 }, category: 'Circulation', log: 'IV Metaraminol bolus administered.', type: 'bolus', duration: 10, pk: { onset: 45, peak: 120, offset: 1800, maxDoses: 4 }, expects: ['IV Access'] },
    // Infusion: sustained while running, offset 2-5 min after it is stopped.
    'Noradrenaline': { label: 'Noradrenaline Infusion', route: 'IV infusion', effect: { BP: 20 }, category: 'Circulation', log: 'Noradrenaline infusion started.', type: 'continuous', duration: 300, pk: { onset: 30, peak: 120, offset: 120 }, expects: ['IV Access'] },
    'GTN': { label: 'GTN Spray', route: 'SL', effect: { BP: -8 }, category: 'Circulation', log: 'GTN Spray sublingual administered.', type: 'bolus', duration: 5, pk: { onset: 60, peak: 150, offset: 1500, maxDoses: 3 } },
    'GTNInfusion': { label: 'GTN Infusion', route: 'IV infusion', effect: { BP: -15 }, category: 'Circulation', log: 'GTN infusion started.', type: 'continuous', duration: 0, pk: { onset: 60, peak: 240, offset: 420 }, expects: ['IV Access'] },
    'FluidInfusion': { label: 'Fluid Infusion', route: 'IV infusion', effect: { BP: 5 }, category: 'Circulation', log: 'IV Fluid infusion started (Maintenance).', type: 'continuous', duration: 0, pk: { onset: 30, peak: 600, offset: 1800 }, expects: ['IV Access'], volume: true },
    // Electricity is instant. No pk, ever.
    'Defib': { label: 'Defibrillation (Shock)', route: 'transthoracic', effect: { changeRhythm: 'defib' }, category: 'Circulation', log: 'Shock Delivered.', type: 'bolus', duration: 5, expects: ['PacingPads'] },
    'Cardioversion': { label: 'Sync Cardioversion', route: 'transthoracic', effect: { changeRhythm: 'sync' }, category: 'Circulation', log: 'Synchronised DC Shock delivered.', type: 'bolus', duration: 5, expects: ['PacingPads'] },
    'Pacing': { label: 'External Pacing', route: 'transcutaneous', effect: { HR: 'pace', BP: 15 }, category: 'Circulation', log: 'External Pacing initiated.', type: 'continuous', duration: 10, expects: ['PacingPads'] },
    'Lucas': { label: 'Lucas Device', route: 'mechanical', effect: { BP: 30, cpr: true }, category: 'Circulation', log: 'Mechanical Chest Compression device applied.', type: 'continuous', duration: 30 },

    // --- DRUGS ---
    // Morphine: onset 5-10 min IV, peak 15-20 min, duration 3-4 h. Previously instant.
    'Analgesia': { label: 'Morphine', route: 'IV', effect: { HR: -5, RR: -3, BP: -2 }, category: 'Drugs', log: 'IV Morphine administered.', type: 'bolus', duration: 10, pk: { onset: 180, peak: 900, offset: 10800, maxDoses: 4 }, expects: ['IV Access'] },
    'Fentanyl': { label: 'Fentanyl', route: 'IV', effect: { HR: -2, RR: -3, BP: -2 }, category: 'Drugs', log: 'IV Fentanyl administered.', type: 'bolus', duration: 10, pk: { onset: 30, peak: 300, offset: 2700, maxDoses: 4 }, expects: ['IV Access'] },
    'Paracetamol': { label: 'Paracetamol IV', route: 'IV', effect: { Temp: -0.5 }, category: 'Drugs', log: 'IV Paracetamol administered.', type: 'bolus', duration: 10, expects: ['IV Access'], pk: { onset: 900, peak: 5400, offset: 14400, maxDoses: 2 }, antipyretic: true },
    // --- INDUCTION AGENTS: clinically differentiated haemodynamic profiles AND timing ---
    // gcs is numeric so the envelope can wake the patient up again: an induction dose wears off.
    'Ketamine': { label: 'Ketamine', route: 'IV', effect: { gcs: -12, BP: 8, HR: 10 }, category: 'Drugs', log: 'IV Ketamine administered (1.5-2 mg/kg induction). Sympathomimetic — BP and HR preserved.', type: 'bolus', duration: 15, pk: { onset: 30, peak: 60, offset: 900, maxDoses: 2 }, expects: ['IV Access'] },
    'Midazolam': { label: 'Midazolam', route: 'IV', effect: { gcs: -8, BP: -10, RR: -5 }, category: 'Drugs', log: 'IV Midazolam administered. Slower onset (2-3 min) — hypotension and respiratory depression expected.', type: 'bolus', duration: 10, pk: { onset: 60, peak: 240, offset: 2400, maxDoses: 3 }, expects: ['IV Access'] },
    'Etomidate': { label: 'Etomidate', route: 'IV', effect: { gcs: -12, BP: -5 }, category: 'Drugs', log: 'IV Etomidate administered (0.3 mg/kg). Haemodynamically stable induction; adrenal suppression.', type: 'bolus', duration: 10, pk: { onset: 30, peak: 60, offset: 420, maxDoses: 1 }, expects: ['IV Access'] },
    'Thiopentone': { label: 'Thiopentone', route: 'IV', effect: { gcs: -12, BP: -25, HR: 8 }, category: 'Drugs', log: 'IV Thiopentone administered (3-5 mg/kg). Marked venodilation and myocardial depression.', type: 'bolus', duration: 10, pk: { onset: 30, peak: 45, offset: 600, maxDoses: 1 }, expects: ['IV Access'] },
    'Alfentanil': { label: 'Alfentanil', route: 'IV', effect: { HR: -8, BP: -8, RR: -6 }, category: 'Drugs', log: 'IV Alfentanil administered (10-20 mcg/kg). Blunts the pressor response to laryngoscopy.', type: 'bolus', duration: 10, pk: { onset: 30, peak: 90, offset: 900, maxDoses: 3 }, expects: ['IV Access'] },
    'Sugammadex': { label: 'Sugammadex', route: 'IV', effect: { reverseParalysis: true }, category: 'Drugs', log: 'IV Sugammadex administered (16 mg/kg). Rocuronium blockade reversed — spontaneous ventilation returning.', type: 'bolus', duration: 10, expects: ['IV Access'], pk: { onset: 60, peak: 180, offset: 0, maxDoses: 2 }, reversalOver: { onset: 60, full: 180 } },
    'Lorazepam': { label: 'Lorazepam', route: 'IV', effect: { gcs: -3, RR: -3 }, category: 'Drugs', log: 'IV Lorazepam administered.', type: 'bolus', duration: 10, pk: { onset: 120, peak: 600, offset: 14400, maxDoses: 3 }, expects: ['IV Access'] },
    // Naloxone MUST wear off: re-narcotisation at 30-60 min is the entire teaching point.
    'Naloxone': { label: 'Naloxone', route: 'IV', effect: { RR: 10, gcs: 8 }, category: 'Drugs', log: 'IV Naloxone administered. Duration 30-60 min — SHORTER than most opioids, watch for re-narcotisation.', type: 'bolus', duration: 5, pk: { onset: 60, peak: 300, offset: 2400, maxDoses: 4 }, expects: ['IV Access'] },
    // Antibiotics: correctly NO acute obs change. No effect, no pk.
    'Antibiotics': { label: 'Co-Amoxiclav', route: 'IV', effect: {}, category: 'Drugs', log: 'IV Co-Amoxiclav administered.', type: 'bolus', duration: 30, expects: ['IV Access'] },
    'Ceftriaxone': { label: 'Ceftriaxone', route: 'IV', effect: {}, category: 'Drugs', log: 'IV Ceftriaxone administered.', type: 'bolus', duration: 30, expects: ['IV Access'] },
    'Tazocin': { label: 'Tazocin (Pip/Taz)', route: 'IV', effect: {}, category: 'Drugs', log: 'IV Tazocin administered.', type: 'bolus', duration: 30, expects: ['IV Access'] },
    'Gentamicin': { label: 'Gentamicin', route: 'IV', effect: {}, category: 'Drugs', log: 'IV Gentamicin administered.', type: 'bolus', duration: 30, expects: ['IV Access'] },
    'Antiemetic': { label: 'Ondansetron', route: 'IV', effect: {}, category: 'Drugs', log: 'IV Ondansetron administered.', type: 'bolus', duration: 10, expects: ['IV Access'] },
    'Cyclizine': { label: 'Cyclizine', route: 'IV', effect: { HR: 5 }, category: 'Drugs', log: 'IV Cyclizine administered.', type: 'bolus', duration: 10, pk: { onset: 120, peak: 600, offset: 3600, maxDoses: 2 }, expects: ['IV Access'] },
    // Magnesium runs over 20 min — gradual bronchodilation and flushing, not an instant change.
    'MagSulph': { label: 'Magnesium Sulphate', route: 'IV', effect: { BP: -5, RR: -2 }, category: 'Drugs', log: 'IV Magnesium Sulphate administered (over 20 min).', type: 'bolus', duration: 600, pk: { onset: 120, peak: 1200, offset: 5400, maxDoses: 2 }, expects: ['IV Access'] },
    'Calcium': { label: 'Calcium Gluconate', route: 'IV', effect: { BP: 5 }, category: 'Drugs', log: 'IV Calcium Gluconate administered.', type: 'bolus', duration: 30, pk: { onset: 60, peak: 180, offset: 3600, maxDoses: 4 }, expects: ['IV Access'] },
    'CalciumChloride': { label: 'Calcium Chloride', route: 'IV', effect: { BP: 8, HR: 5 }, category: 'Drugs', log: 'IV Calcium Chloride administered.', type: 'bolus', duration: 30, pk: { onset: 45, peak: 150, offset: 3600, maxDoses: 4 }, expects: ['IV Access'] },
    // BM is a real vital now. Insulin/dextrose is given for hyperkalaemia: the dextrose load nudges
    // the glucose up over 10-15 min. (Serum K+ is not modelled in the obs panel — see the log note.)
    'InsulinDextrose': { label: 'Insulin/Dextrose', route: 'IV', effect: { BM: 2, K: -1.2 }, category: 'Drugs', log: 'Insulin/Dextrose bolus started (Hyperkalaemia). K+ shifts intracellularly over 15-30 min.', type: 'bolus', duration: 60, pk: { onset: 60, peak: 600, offset: 3600, maxDoses: 3 }, expects: ['IV Access'], rebound: { delay: 2400, effect: { BM: -3.5 }, pk: { onset: 0, peak: 1800, offset: 7200, maxDoses: 3 }, log: 'Insulin/dextrose given — recheck the glucose at 30-60 min: late hypoglycaemia is expected.' } },
    'Dextrose': { label: 'Glucose 10%', route: 'IV', effect: { BM: 5, K: -0.2 }, category: 'Drugs', log: 'IV Glucose/Dextrose administered.', type: 'bolus', duration: 60, pk: { onset: 30, peak: 120, offset: 1800, maxDoses: 4 }, expects: ['IV Access'] },
    'InsulinInfusion': { label: 'Insulin Infusion', route: 'IV infusion', effect: { BM: -5 }, category: 'Drugs', log: 'Fixed rate Insulin infusion started (0.1 u/kg/hr). Expect ~3 mmol/L/hr fall.', type: 'continuous', duration: 0, pk: { onset: 300, peak: 6000, offset: 3600 }, expects: ['IV Access'], drive: { vital: 'bm', ratePerHour: -3.5, target: 7.0, secondary: { vital: 'k', ratePerHour: -0.6, target: 3.8 } } },
    // Hydrocortisone's haemodynamic benefit is a matter of HOURS, not minutes: effectively no acute
    // change inside a simulation, which is the clinically honest answer.
    'Hydrocortisone': { label: 'Hydrocortisone', route: 'IV', effect: { BP: 3 }, category: 'Drugs', log: 'IV Hydrocortisone administered. Haemodynamic effect takes hours, not minutes.', type: 'bolus', duration: 10, pk: { onset: 900, peak: 3600, offset: 0, maxDoses: 1 }, expects: ['IV Access'] },
    'Dexamethasone': { label: 'Dexamethasone', route: 'IV', effect: { RR: -3 }, category: 'Drugs', log: 'IV Dexamethasone administered.', type: 'bolus', duration: 10, expects: ['IV Access'], pk: { onset: 1800, peak: 7200, offset: 0, maxDoses: 1 } },
    'Aspirin': { label: 'Aspirin 300mg', route: 'PO', effect: {}, category: 'Drugs', log: 'Aspirin PO administered.', type: 'bolus', duration: 10 },
    'Clopidogrel': { label: 'Clopidogrel', route: 'PO', effect: {}, category: 'Drugs', log: 'Clopidogrel PO administered.', type: 'bolus', duration: 10 },
    'Ticagrelor': { label: 'Ticagrelor', route: 'PO', effect: {}, category: 'Drugs', log: 'Ticagrelor PO administered.', type: 'bolus', duration: 10 },
    'Heparin': { label: 'Heparin / LMWH', route: 'SC/IV', effect: {}, category: 'Drugs', log: 'Anticoagulation administered.', type: 'bolus', duration: 10 },
    // --- NEUROMUSCULAR BLOCKERS ---
    // Wave 2: the blockade is now driven by the SAME pk entry as everything else — onset = pk.onset,
    // end of blockade = pk.offset. Roc ~60s / ~45 min, sux ~45s / ~8 min. One timer, not two.
    'Roc': { label: 'Rocuronium', route: 'IV', effect: { paralysed: true }, paralysis: { onset: 60, duration: 2700 }, category: 'Drugs', log: 'IV Rocuronium administered (1.2 mg/kg). Onset ~60s, duration ~45 min.', type: 'bolus', duration: 10, pk: { onset: 60, peak: 120, offset: 2760, maxDoses: 2 }, expects: ['IV Access'] },
    'Sux': { label: 'Suxamethonium', route: 'IV', effect: { paralysed: true }, paralysis: { onset: 45, duration: 480 }, category: 'Drugs', log: 'IV Suxamethonium administered (1.5 mg/kg). Fasciculations, then onset ~45s, duration ~8 min.', type: 'bolus', duration: 10, pk: { onset: 45, peak: 75, offset: 525, maxDoses: 2 }, expects: ['IV Access'] },
    'Propofol': { label: 'Propofol', route: 'IV', effect: { gcs: -12, BP: -25, RR: -6 }, category: 'Drugs', log: 'IV Propofol administered (1-2 mg/kg induction). Significant vasodilatation — expect a BP drop.', type: 'bolus', duration: 10, pk: { onset: 30, peak: 90, offset: 600, maxDoses: 3 }, expects: ['IV Access'] },
    // IM adrenaline: onset 3-5 min, peak ~10 min, duration 20-30 min. Was instant.
    'AdrenalineIM': { label: 'Adrenaline 500mcg (IM)', route: 'IM (anterolateral thigh)', effect: { HR: 20, BP: 15, SpO2: 5 }, category: 'Drugs', log: 'IM Adrenaline administered (anterolateral thigh).', type: 'bolus', duration: 300, pk: { onset: 45, peak: 240, plateau: 600, offset: 1800, maxDoses: 4 }, cumulative: { unit: 'mcg', perDose: 500, max: 2000, message: 'Four doses of IM adrenaline given — this is refractory anaphylaxis. Start an ADRENALINE INFUSION and call for senior/critical care help.' } },
    'Glucagon': { label: 'Glucagon', route: 'IM', effect: { BM: 5 }, category: 'Drugs', log: 'IM Glucagon administered.', type: 'bolus', duration: 30, pk: { onset: 300, peak: 1800, offset: 5400, maxDoses: 2 } },
    'Labetalol': { label: 'Labetalol', route: 'IV', effect: { BP: -20, HR: -10 }, category: 'Drugs', log: 'IV Labetalol administered.', type: 'bolus', duration: 15, pk: { onset: 120, peak: 600, offset: 7200, maxDoses: 3 }, expects: ['IV Access'] },
    'Phentolamine': { label: 'Phentolamine', route: 'IV', effect: { BP: -20 }, category: 'Drugs', log: 'IV Phentolamine administered.', type: 'bolus', duration: 10, pk: { onset: 60, peak: 180, offset: 1800, maxDoses: 3 }, expects: ['IV Access'] },
    'Digibind': { label: 'Digibind', route: 'IV', effect: { HR: 10 }, category: 'Drugs', log: 'Digoxin-specific antibody fragments administered. Onset 20-30 min.', type: 'bolus', duration: 60, pk: { onset: 600, peak: 2400, offset: 0, maxDoses: 2 }, expects: ['IV Access'] },
    // pH is a modelled vital now: bicarbonate shifts it over minutes.
    // E12: bicarbonate generates CO2, so the ETCO2 rises after it is given (and it shifts K+ in).
    'SodiumBicarb': { label: 'Sodium Bicarbonate', route: 'IV', effect: { pH: 0.1, BP: 3, K: -0.4, ETCO2: 0.6 }, category: 'Drugs', log: 'IV Sodium Bicarbonate administered.', type: 'bolus', duration: 30, pk: { onset: 60, peak: 300, offset: 2400, maxDoses: 3 }, expects: ['IV Access'] },
    'HypertonicSaline': { label: 'Hypertonic Saline', route: 'IV', effect: { BP: 5, gcs: 2 }, category: 'Drugs', log: 'Hypertonic Saline (3%) administered. ICP falls over 5-20 min.', type: 'bolus', duration: 30, pk: { onset: 120, peak: 600, offset: 7200, maxDoses: 2 }, expects: ['IV Access'] },
    'T3T4': { label: 'Liothyronine (T3)', route: 'IV', effect: { HR: 5, Temp: 0.5 }, category: 'Drugs', log: 'IV Liothyronine administered. Onset is measured in hours.', type: 'bolus', duration: 30, pk: { onset: 1800, peak: 5400, offset: 0, maxDoses: 2 }, expects: ['IV Access'] },
    'Bisphosphonate': { label: 'Bisphosphonate', route: 'IV', effect: {}, category: 'Drugs', log: 'IV Bisphosphonate administered.', type: 'bolus', duration: 60, expects: ['IV Access'] },
    'IVIG': { label: 'IVIG', route: 'IV', effect: {}, category: 'Drugs', log: 'Intravenous Immunoglobulin administered.', type: 'bolus', duration: 60, expects: ['IV Access'] },
    'Chlorphenamine': { label: 'Chlorphenamine', route: 'IV', effect: {}, category: 'Drugs', log: 'IV Chlorphenamine administered.', type: 'bolus', duration: 10, expects: ['IV Access'] },
    'Lipid': { label: 'Intralipid 20%', route: 'IV', effect: { BP: 10 }, category: 'Drugs', log: 'Intralipid 20% emulsion administered.', type: 'bolus', duration: 60, expects: ['IV Access'], pk: { onset: 60, peak: 300, offset: 1800, maxDoses: 2 } },
    'Desferrioxamine': { label: 'Desferrioxamine', route: 'IV infusion', effect: {}, category: 'Drugs', log: 'IV Desferrioxamine infusion started.', type: 'continuous', duration: 0, expects: ['IV Access'] },
    'Fomepizole': { label: 'Fomepizole', route: 'IV', effect: {}, category: 'Drugs', log: 'IV Fomepizole administered.', type: 'bolus', duration: 30, expects: ['IV Access'] },
    // Temp is a modelled vital now: dantrolene cools over 15-60 min and holds.
    'Dantrolene': { label: 'Dantrolene', route: 'IV', effect: { Temp: -1.5 }, category: 'Drugs', log: 'IV Dantrolene administered.', type: 'bolus', duration: 30, pk: { onset: 300, peak: 1800, offset: 0, maxDoses: 4 }, expects: ['IV Access'] },
    'Pralidoxime': { label: 'Pralidoxime', route: 'IV', effect: {}, category: 'Drugs', log: 'IV Pralidoxime administered.', type: 'bolus', duration: 30, expects: ['IV Access'] },
    'Charcoal': { label: 'Activated Charcoal', route: 'PO', effect: {}, category: 'Drugs', log: 'Activated Charcoal administered.', type: 'bolus', duration: 10 },
    'Lactulose': { label: 'Lactulose', route: 'PO', effect: {}, category: 'Drugs', log: 'Lactulose administered.', type: 'bolus', duration: 10 },
    'Rifaximin': { label: 'Rifaximin', route: 'PO', effect: {}, category: 'Drugs', log: 'Rifaximin administered.', type: 'bolus', duration: 10 },
    // Terlipressin: onset 15-30 min. Was instant.
    'Terlipressin': { label: 'Terlipressin', route: 'IV', effect: { BP: 10 }, category: 'Drugs', log: 'IV Terlipressin administered. Onset 15-30 min.', type: 'bolus', duration: 10, pk: { onset: 300, peak: 1200, offset: 14400, maxDoses: 3 }, expects: ['IV Access'] },
    'Octaplex': { label: 'Octaplex / PCC', route: 'IV', effect: {}, category: 'Drugs', log: 'Prothrombin Complex Concentrate administered.', type: 'bolus', duration: 30, expects: ['IV Access'] },
    'VitaminK': { label: 'Vitamin K', route: 'IV', effect: {}, category: 'Drugs', log: 'IV Vitamin K administered.', type: 'bolus', duration: 10, expects: ['IV Access'] },
    'Rasburicase': { label: 'Rasburicase', route: 'IV', effect: {}, category: 'Drugs', log: 'IV Rasburicase administered.', type: 'bolus', duration: 10, expects: ['IV Access'] },
    'VitaminA': { label: 'Vitamin A', route: 'PO', effect: {}, category: 'Drugs', log: 'Vitamin A administered.', type: 'bolus', duration: 10 },
    'Acetazolamide': { label: 'Acetazolamide', route: 'IV', effect: {}, category: 'Drugs', log: 'IV Acetazolamide administered.', type: 'bolus', duration: 10, expects: ['IV Access'] },
    'Cyproheptadine': { label: 'Cyproheptadine', route: 'PO', effect: {}, category: 'Drugs', log: 'Cyproheptadine administered.', type: 'bolus', duration: 10 },
    'Thrombolysis': { label: 'Thrombolysis (Alteplase)', route: 'IV', effect: {}, category: 'Drugs', log: 'IV thrombolysis (alteplase) commenced.', type: 'bolus', duration: 60, expects: ['IV Access'] },
    'Nimodipine': { label: 'Nimodipine', route: 'PO', effect: { BP: -5 }, category: 'Drugs', log: 'Nimodipine administered.', type: 'bolus', duration: 10, pk: { onset: 600, peak: 1800, offset: 0, maxDoses: 2 } },
    'Pabrinex': { label: 'Pabrinex / Thiamine', route: 'IV', effect: {}, category: 'Drugs', log: 'IV Pabrinex (thiamine) administered.', type: 'bolus', duration: 30, expects: ['IV Access'] },
    'Antivenom': { label: 'Antivenom', route: 'IV', effect: {}, category: 'Drugs', log: 'Antivenom administered.', type: 'bolus', duration: 30, expects: ['IV Access'] },
    'Oxytocin': { label: 'Oxytocin', route: 'IV', effect: { BP: -5 }, category: 'Drugs', log: 'IV Oxytocin administered.', type: 'bolus', duration: 10, pk: { onset: 60, peak: 180, offset: 1200, maxDoses: 3 }, expects: ['IV Access'] },
    'Ergometrine': { label: 'Ergometrine', route: 'IM/IV', effect: { BP: 10 }, category: 'Drugs', log: 'IV Ergometrine administered.', type: 'bolus', duration: 10, pk: { onset: 120, peak: 420, offset: 3600, maxDoses: 2 }, expects: ['IV Access'] },
    'Carboprost': { label: 'Carboprost', route: 'IM', effect: {}, category: 'Drugs', log: 'IM Carboprost administered.', type: 'bolus', duration: 10 },
    'AntiD': { label: 'Anti-D Ig', route: 'IM', effect: {}, category: 'Drugs', log: 'Anti-D Immunoglobulin administered.', type: 'bolus', duration: 10, expects: ['IV Access'] },
    'Prostin': { label: 'Dinoprostone (Prostin)', route: 'IV infusion', effect: {}, category: 'Drugs', log: 'IV Dinoprostone infusion started.', type: 'continuous', duration: 0, expects: ['IV Access'] },
    'Furosemide': { label: 'Furosemide', route: 'IV', effect: { BP: -5 }, category: 'Drugs', log: 'IV Furosemide administered. Venodilation ~5 min, diuresis ~30 min.', type: 'bolus', duration: 30, pk: { onset: 120, peak: 1800, offset: 10800, maxDoses: 3 }, expects: ['IV Access'] },
    'Albumin': { label: 'Human Albumin Solution', route: 'IV', effect: { BP: 5 }, category: 'Drugs', log: 'IV Albumin administered.', type: 'bolus', duration: 60, pk: { onset: 300, peak: 1800, offset: 0, maxDoses: 3 }, expects: ['IV Access'], volume: true },
    'TopicalEyeDrops': { label: 'Topical Eye Drops', route: 'topical', effect: {}, category: 'Drugs', log: 'Topical eye drops (Timolol/Pilocarpine) applied.', type: 'bolus', duration: 10 },

    // --- PROCEDURES ---
    'Obs': { label: 'Attach Monitoring (all)', route: 'n/a', effect: {}, category: 'Procedures', log: 'Full monitoring applied (ECG, SpO2, NIBP, temp). Vitals now visible.', type: 'continuous', duration: 5 },
    // ---- WAVE 7 / ITEM 4: INDIVIDUALLY ATTACHABLE MONITORING ----------------------------------
    // Each item gates exactly its own value/trace on the student monitor (see engine getSensors).
    // 'Obs' above is the unchanged ONE-CLICK FAST PATH and implies all four continuous sensors, so
    // nothing that already exists has to know these keys. They are `continuous`, so the existing
    // second-press-to-remove behaviour in applyIntervention detaches them and logs it, with no new
    // machinery. NEVER prerequisites for anything — the permissive philosophy is unchanged.
    'MonECG': { label: 'ECG electrodes', route: '3-lead', effect: {}, category: 'Procedures', log: 'ECG electrodes attached — rhythm and heart rate now visible.', type: 'continuous', duration: 5 },
    'MonSpO2': { label: 'SpO2 probe', route: 'digit probe', effect: {}, category: 'Procedures', log: 'SpO2 probe attached — pleth and saturations now visible.', type: 'continuous', duration: 5 },
    'MonNIBP': { label: 'NIBP cuff', route: 'cuff', effect: {}, category: 'Procedures', log: 'NIBP cuff attached — blood pressure available (cycle to measure).', type: 'continuous', duration: 5 },
    'MonTemp': { label: 'Temperature probe', route: 'probe', effect: {}, category: 'Procedures', log: 'Temperature probe attached — temperature now visible.', type: 'continuous', duration: 5 },
    // Intermittent point-of-care checks: these reveal a value AT THIS MOMENT (timestamped) rather
    // than a live channel, which is the clinically important distinction.
    'CheckGlucose': { label: 'POC glucose (BM)', route: 'capillary', effect: {}, category: 'Procedures', log: 'Capillary blood glucose checked.', type: 'bolus', duration: 0 },
    'CheckVBG': { label: 'POC VBG (pH + K+)', route: 'venous sample', effect: {}, category: 'Procedures', log: 'Venous blood gas sent — pH and potassium reported.', type: 'bolus', duration: 0, expects: ['IV Access'] },
    'ArtLine': { label: 'Arterial Line', route: 'arterial', effect: {}, category: 'Procedures', log: 'Arterial line inserted.', type: 'continuous', duration: 120 },
    'CVC': { label: 'Central Line', route: 'central IV', effect: {}, category: 'Procedures', log: 'Central venous catheter inserted.', type: 'continuous', duration: 180, expects: ['IV Access'] },
    'Catheter': { label: 'Urinary Catheter', route: 'urethral', effect: {}, category: 'Procedures', log: 'Urinary catheter inserted.', type: 'continuous', duration: 60 },
    'NGTube': { label: 'NG Tube', route: 'nasogastric', effect: {}, category: 'Procedures', log: 'Nasogastric tube inserted.', type: 'continuous', duration: 60 },
    // WAVE 4a / PART 2D: ONE realistic warming rate and ONE realistic cooling rate. The old model
    // parked the temperature at +/-1.5 degC of wherever the patient started, so hypothermia at
    // 30 degC could never be corrected and hyperthermia could never be brought down at all.
    // `drive` is now the behaviour (see engine applyDriveTick): a fixed degC/hour towards 36.8,
    // stopping on arrival, with the `effect.Temp` magnitude retained as the clinical review's
    // nominal excursion (it is excluded from the additive envelope while the drive is running, so
    // it can never be applied twice). Bair Hugger + warmed fluids ~1.5 degC/h; active cooling
    // (cold fluids, ice packs, surface cooling) ~2 degC/h.
    // WAVE 5 / ITEM 9: pk.onset 300s -> 60s for both. A drive's `onset` is dead time before the RATE
    // starts at all; adding a 300 s dead period to the 300 s rate ramp meant active cooling took ten
    // minutes to reach its declared 2 degC/h, so the observed rate was roughly a third of the declared
    // one and the temperature looked frozen for the first several minutes. A forced-air blanket or
    // surface cooling starts removing heat within a minute, so 60 s of dead time is the honest value;
    // the declared rates themselves (1.5 degC/h warming, 2.0 degC/h cooling) are unchanged and are
    // now actually achieved. DRIVE_RAMP_SECONDS in engine.js is also reduced, 300s -> 120s.
    'Warming': { label: 'Active Warming', route: 'external', effect: { Temp: 3 }, category: 'Procedures', log: 'Active warming started (Bair Hugger / warmed fluids). Warms at ~1.5 \u00b0C/h toward 36.8 \u00b0C.', type: 'continuous', duration: 600, pk: { onset: 60, peak: 10800, offset: 3600 }, drive: { vital: 'temp', ratePerHour: 1.5, target: 36.8 } },
    'Cooling': { label: 'Active Cooling', route: 'external', effect: { Temp: -3 }, category: 'Procedures', log: 'Active cooling started. Cools at ~2.0 \u00b0C/h toward 36.8 \u00b0C.', type: 'continuous', duration: 600, pk: { onset: 60, peak: 7200, offset: 3600 }, drive: { vital: 'temp', ratePerHour: -2.0, target: 36.8 } },
    'CPR': { label: 'Start CPR', route: 'manual', effect: { BP: 40, cpr: true }, category: 'Procedures', log: 'Chest compressions started.', type: 'continuous', duration: 5 },
    'Splinting': { label: 'Splint / Immobilise', route: 'external', effect: {}, category: 'Procedures', log: 'Limb splinted / immobilised.', type: 'continuous', duration: 60 },
    'Collar': { label: 'C-Spine Collar', route: 'external', effect: {}, category: 'Procedures', log: 'C-Spine immobilisation applied.', type: 'continuous', duration: 15 },
    'PelvicBinder': { label: 'Pelvic Binder', route: 'external', effect: { BP: 5 }, category: 'Procedures', log: 'Pelvic binder applied.', type: 'continuous', duration: 30, pk: { onset: 10, peak: 90, offset: 120 } },
    'Thoracotomy': { label: 'Resus Thoracotomy', route: 'surgical', effect: { BP: 20, SpO2: 15 }, category: 'Procedures', log: 'Resuscitative Thoracotomy performed.', type: 'bolus', duration: 120 },
    'REBOA': { label: 'REBOA', route: 'endovascular', effect: { BP: 30 }, category: 'Procedures', log: 'REBOA catheter deployed.', type: 'continuous', duration: 120, pk: { onset: 5, peak: 45, offset: 90 }, expects: ['IV Access'] },
    'PPCI': { label: 'PPCI Referral', route: 'n/a', effect: {}, category: 'Procedures', log: 'Urgent transfer for Primary PCI.', type: 'bolus', duration: 300 },
    'AsciticTap': { label: 'Ascitic Tap', route: 'percutaneous', effect: {}, category: 'Procedures', log: 'Ascitic tap/paracentesis performed.', type: 'bolus', duration: 60 },
    'Hyperbaric': { label: 'Hyperbaric Referral', route: 'n/a', effect: {}, category: 'Procedures', log: 'Referral to hyperbaric unit made.', type: 'bolus', duration: 10 },
    'Surgery': { label: 'Emergency Surgery', route: 'n/a', effect: {}, category: 'Procedures', log: 'Patient transferred to theatre.', type: 'bolus', duration: 300 },
    'Delivery': { label: 'Vaginal Delivery', route: 'n/a', effect: {}, category: 'Procedures', log: 'Baby delivered.', type: 'bolus', duration: 60 },
    'Hysterotomy': { label: 'Perimortem C-Section', route: 'surgical', effect: {}, category: 'Procedures', log: 'Perimortem C-Section performed.', type: 'bolus', duration: 60 },
    'NerveBlock': { label: 'Nerve Block (FIB)', route: 'perineural (LA)', effect: { HR: -5 }, category: 'Procedures', log: 'Fascia Iliaca Block performed.', type: 'bolus', duration: 120, pk: { onset: 600, peak: 1200, offset: 28800, maxDoses: 2 } },
    'Canthotomy': { label: 'Lat. Canthotomy', route: 'surgical', effect: {}, category: 'Procedures', log: 'Lateral Canthotomy performed.', type: 'bolus', duration: 60 },
    'Escharotomy': { label: 'Escharotomy', route: 'surgical', effect: {}, category: 'Procedures', log: 'Escharotomy performed.', type: 'bolus', duration: 120 },
    'AirEnema': { label: 'Air Enema', route: 'PR', effect: {}, category: 'Procedures', log: 'Radiological air enema performed.', type: 'bolus', duration: 120 },
    // GENUINELY NEAR-INSTANT — relieving tamponade works immediately. No pk.
    'Pericardiocentesis': { label: 'Pericardiocentesis', route: 'percutaneous', effect: { BP: 20, HR: -10 }, category: 'Procedures', log: 'Needle pericardiocentesis performed.', type: 'bolus', duration: 60 },
    'Tourniquet': { label: 'Tourniquet', route: 'external', effect: {}, category: 'Procedures', log: 'Tourniquet applied.', type: 'continuous', duration: 10 },
    'Plaster': { label: 'Plaster / Backslab', route: 'external', effect: {}, category: 'Procedures', log: 'Plaster backslab applied.', type: 'continuous', duration: 120 },
    'ClingFilm': { label: 'Cling Film', route: 'topical', effect: { Temp: 0.5 }, category: 'Procedures', log: 'Burns covered with cling film (reduces evaporative heat loss).', type: 'continuous', duration: 30, pk: { onset: 300, peak: 3600, offset: 1800 } },
    'ExchangeTransfusion': { label: 'Exchange Transfusion', route: 'IV', effect: {}, category: 'Procedures', log: 'Exchange Transfusion started.', type: 'continuous', duration: 300, expects: ['IV Access'] },
    'LumbarPuncture': { label: 'Lumbar Puncture', route: 'intrathecal', effect: {}, category: 'Procedures', log: 'Lumbar puncture performed.', type: 'bolus', duration: 300 },
    'Reduction': { label: 'Reduction / Manipulation', route: 'manual', effect: {}, category: 'Procedures', log: 'Fracture / dislocation reduced under analgesia.', type: 'bolus', duration: 120 },
    'Phototherapy': { label: 'Phototherapy', route: 'external', effect: {}, category: 'Procedures', log: 'Phototherapy commenced.', type: 'continuous', duration: 60 },
    'Irrigation': { label: 'Irrigation', route: 'topical', effect: {}, category: 'Procedures', log: 'Copious irrigation started.', type: 'continuous', duration: 300 },
    'PacingPads': { label: 'Pacing Pads', route: 'transcutaneous', effect: {}, category: 'Procedures', log: 'Defib/Pacing pads applied.', type: 'continuous', duration: 10 },

    // =========================================================================================
    // WAVE 4a — ROUTE-SPECIFIC INTERVENTIONS (PART 3).
    // Separate KEYS per route (never a behaviour-bearing `route` field), because UI buttons,
    // scenario recommendedActions/stabilisers, DETERIORATION_TREATMENTS and the RTDB command
    // channel are ALL key-addressed. `route` is descriptive only and is rendered on the button
    // so the facilitator can tell IM from IV at a glance.
    // These unlock algorithms that were previously impossible: buccal midazolam for paediatric
    // status (NICE NG217 / APLS step 1), IM adrenaline escalation to an infusion for refractory
    // anaphylaxis, IM ketamine for acute behavioural disturbance, PR diazepam pre-hospital.
    // =========================================================================================
    // --- BENZODIAZEPINES / ANTICONVULSANTS — the routes UK/APLS algorithms actually use
    'MidazolamBuccal': { label: 'Midazolam Buccal (10 mg)', route: 'buccal', effect: { gcs: -6, RR: -4 }, category: 'Drugs', log: 'Buccal Midazolam 10 mg administered (NICE NG217 / APLS first line with no IV access).', type: 'bolus', duration: 120, pk: { onset: 120, peak: 480, offset: 3600, maxDoses: 2 } },
    'MidazolamIN': { label: 'Midazolam Intranasal', route: 'intranasal', effect: { gcs: -6, RR: -4 }, category: 'Drugs', log: 'Intranasal Midazolam administered (0.2-0.3 mg/kg).', type: 'bolus', duration: 120, pk: { onset: 90, peak: 420, offset: 3000, maxDoses: 2 } },
    'MidazolamIM': { label: 'Midazolam IM', route: 'IM', effect: { gcs: -8, BP: -8, RR: -5 }, category: 'Drugs', log: 'IM Midazolam administered. Seizure termination usually 2-5 min; deep sedation is slower.', type: 'bolus', duration: 300, pk: { onset: 120, peak: 420, offset: 3600, maxDoses: 2 } },
    'LorazepamIM': { label: 'Lorazepam IM', route: 'IM', effect: { gcs: -3, RR: -3 }, category: 'Drugs', log: 'IM Lorazepam administered. Absorption is SLOW and ERRATIC (10-30 min) — buccal midazolam is preferred.', type: 'bolus', duration: 300, pk: { onset: 600, peak: 1800, offset: 14400, maxDoses: 2 } },
    'DiazepamIV': { label: 'Diazepam IV (10 mg)', route: 'IV', effect: { gcs: -4, RR: -4, BP: -5 }, category: 'Drugs', log: 'IV Diazepam 10 mg administered. Fast CNS entry but redistributes — seizures may recur.', type: 'bolus', duration: 60, pk: { onset: 30, peak: 180, offset: 3600, maxDoses: 2 }, expects: ['IV Access'] },
    'DiazepamPR': { label: 'Diazepam PR (rectal)', route: 'rectal', effect: { gcs: -4, RR: -3 }, category: 'Drugs', log: 'Rectal Diazepam administered. Therapeutic levels in 5-10 min.', type: 'bolus', duration: 120, pk: { onset: 120, peak: 600, offset: 5400, maxDoses: 2 } },
    'Levetiracetam': { label: 'Levetiracetam (60 mg/kg infusion)', route: 'IV infusion over 10 min', effect: {}, category: 'Drugs', log: 'IV Levetiracetam (60 mg/kg) infusion started — second-line anticonvulsant (NICE NG217).', type: 'bolus', duration: 600, pk: { onset: 300, peak: 900, offset: 0, maxDoses: 1 }, expects: ['IV Access'] },
    'Phenytoin': { label: 'Phenytoin (20 mg/kg infusion)', route: 'IV infusion over >=20 min', effect: { BP: -10, HR: -10 }, category: 'Drugs', log: 'IV Phenytoin (20 mg/kg) infusion started over >=20 min. Cardiac monitoring mandatory.', type: 'bolus', duration: 1200, pk: { onset: 300, peak: 1200, offset: 0, maxDoses: 1 }, expects: ['IV Access'] },
    'Flumazenil': { label: 'Flumazenil', route: 'IV', effect: { gcs: 6, RR: 5 }, category: 'Drugs', log: 'IV Flumazenil administered. CAUTION: seizure risk; shorter-acting than the benzodiazepine.', type: 'bolus', duration: 60, pk: { onset: 60, peak: 420, offset: 2700, maxDoses: 2 }, expects: ['IV Access'] },
    // --- SEDATION / ANALGESIA BY ROUTE
    // WAVE 5 / ITEM 8: peak 240s -> 180s. IM ketamine for acute behavioural disturbance is specified
    // as ~3 minutes to PEAK effect (4-5 mg/kg IM; dissociation typically 3-4 min). The deployed
    // 240 s peaked at ~4 min, a minute late. Onset (90 s, first effect) and the 600 s plateau /
    // 1800 s offset are unchanged and still bracket the peak correctly. IV ketamine is untouched
    // (onset 30 / peak 60 = 1 min, verified correct in live testing).
    'KetamineIM': { label: 'Ketamine IM (sedation / ABD)', route: 'IM', effect: { gcs: -12, BP: 8, HR: 10 }, category: 'Drugs', log: 'IM Ketamine administered (4-5 mg/kg). Onset ~90s, PEAK at ~3 min — WAIT, do not stack doses.', type: 'bolus', duration: 300, pk: { onset: 90, peak: 180, plateau: 600, offset: 1800, maxDoses: 2 } },
    'MorphineIM': { label: 'Morphine IM', route: 'IM', effect: { HR: -5, RR: -3, BP: -2 }, category: 'Drugs', log: 'IM Morphine administered. Onset 10-20 min, peak 30-60 min — slow analgesia.', type: 'bolus', duration: 300, pk: { onset: 600, peak: 1800, offset: 14400, maxDoses: 3 } },
    'MorphineOral': { label: 'Morphine oral (Oramorph)', route: 'oral', effect: { HR: -3, RR: -2 }, category: 'Drugs', log: 'Oral Morphine (Oramorph) administered. Onset 20-30 min.', type: 'bolus', duration: 300, pk: { onset: 1200, peak: 3600, offset: 14400, maxDoses: 3 } },
    'ParacetamolOral': { label: 'Paracetamol oral', route: 'oral', effect: { Temp: -0.5 }, category: 'Drugs', log: 'Oral Paracetamol administered. Peak plasma 45-50 min; antipyresis over 1-2 h.', type: 'bolus', duration: 60, pk: { onset: 1800, peak: 7200, offset: 14400, maxDoses: 2 } },
    'Metoclopramide': { label: 'Metoclopramide', route: 'IV', effect: {}, category: 'Drugs', log: 'IV Metoclopramide administered.', type: 'bolus', duration: 60, expects: ['IV Access'] },
    // --- OPIOID REVERSAL BY ROUTE
    'NaloxoneIM': { label: 'Naloxone IM', route: 'IM', effect: { RR: 10, gcs: 8 }, category: 'Drugs', log: 'IM Naloxone administered. Onset ~6 min (vs 1-2 min IV) — do not re-dose too early.', type: 'bolus', duration: 120, pk: { onset: 180, peak: 600, offset: 2700, maxDoses: 4 } },
    'NaloxoneIN': { label: 'Naloxone Intranasal', route: 'intranasal', effect: { RR: 8, gcs: 6 }, category: 'Drugs', log: 'Intranasal Naloxone administered. Tmax 15-30 min; repeat every 2-3 min if no response.', type: 'bolus', duration: 120, pk: { onset: 180, peak: 900, offset: 3600, maxDoses: 4 } },
    // --- VASOACTIVE / ANTIARRHYTHMIC — push-dose and infusions
    'AdrenalinePush': { label: 'Adrenaline push-dose (50-100 mcg IV)', route: 'IV (diluted push-dose)', effect: { HR: 10, BP: 20 }, category: 'Circulation', log: 'Push-dose Adrenaline (50-100 mcg IV) given. Onset <1 min, lasts 5-10 min.', type: 'bolus', duration: 60, pk: { onset: 15, peak: 60, offset: 300, maxDoses: 6 }, expects: ['IV Access'] },
    'AdrenalineInfusion': { label: 'Adrenaline Infusion', route: 'IV infusion', effect: { BP: 20, HR: 15 }, category: 'Circulation', log: 'Adrenaline infusion started (refractory anaphylaxis / shock). Titrate to effect.', type: 'continuous', duration: 0, pk: { onset: 30, peak: 120, offset: 180 }, expects: ['IV Access'] },
    'AmiodaroneInfusion': { label: 'Amiodarone Infusion (900 mg/24 h)', route: 'IV infusion', effect: { BP: -5 }, category: 'Circulation', log: 'Amiodarone infusion started (900 mg/24 h). Central access preferred.', type: 'continuous', duration: 0, pk: { onset: 300, peak: 1800, offset: 3600 }, expects: ['IV Access'] },
    'LabetalolInfusion': { label: 'Labetalol Infusion', route: 'IV infusion', effect: { BP: -20, HR: -10 }, category: 'Drugs', log: 'Labetalol infusion started (2 mg/min, titrated).', type: 'continuous', duration: 0, pk: { onset: 120, peak: 600, offset: 1800 }, expects: ['IV Access'] },
    'MagnesiumInfusion': { label: 'Magnesium Infusion (1 g/h, eclampsia)', route: 'IV infusion', effect: { BP: -5, RR: -2 }, category: 'Drugs', log: 'Magnesium infusion started (1 g/h). Monitor reflexes and respiratory rate.', type: 'continuous', duration: 0, pk: { onset: 300, peak: 1800, offset: 3600 }, expects: ['IV Access'] },
    'Digoxin': { label: 'Digoxin IV load', route: 'IV infusion', effect: { HR: -15 }, category: 'Drugs', log: 'IV Digoxin loading dose started. Onset 10-30 min, peak 1-6 h.', type: 'bolus', duration: 1200, pk: { onset: 600, peak: 3600, offset: 0, maxDoses: 2 }, expects: ['IV Access'] },
    // --- RESPIRATORY ESCALATION
    'SalbutamolIV': { label: 'Salbutamol IV infusion', route: 'IV infusion', effect: { HR: 25, RR: -3, SpO2: 3, K: -0.9 }, category: 'Breathing', log: 'IV Salbutamol infusion started. Expect marked tachycardia, lactate rise and hypokalaemia.', type: 'continuous', duration: 0, pk: { onset: 60, peak: 600, offset: 1800 }, expects: ['IV Access'], ceiling: { vital: 'hr', value: 160 } },
    'NebsContinuous': { label: 'Nebs - back-to-back / continuous', route: 'nebulised (continuous)', effect: { HR: 15, RR: -3, SpO2: 3, K: -0.8 }, category: 'Breathing', log: 'Continuous back-to-back nebulisers running.', type: 'continuous', duration: 0, pk: { onset: 120, peak: 900, offset: 3600 }, ceiling: { vital: 'hr', value: 155 } },
    // --- SEPSIS / METABOLIC
    'Benzylpenicillin': { label: 'Benzylpenicillin 1.2 g', route: 'IV or IM', effect: {}, category: 'Drugs', log: 'Benzylpenicillin 1.2 g administered (suspected meningococcal sepsis).', type: 'bolus', duration: 60 },
    'BenzylpenicillinIM': { label: 'Benzylpenicillin 1.2 g IM', route: 'IM', effect: {}, category: 'Drugs', log: 'Benzylpenicillin 1.2 g IM administered — the pre-hospital / no-IV-access route.', type: 'bolus', duration: 60 },
    'InsulinSubcut': { label: 'Insulin subcutaneous (rapid-acting)', route: 'subcutaneous', effect: { BM: -4 }, category: 'Drugs', log: 'Subcutaneous rapid-acting insulin given. Onset 15 min, peak 1-2 h.', type: 'bolus', duration: 60, pk: { onset: 900, peak: 5400, offset: 14400, maxDoses: 3 } },
    'GlucoseOral': { label: 'Glucose oral (gel / juice / GlucoGel)', route: 'oral / buccal', effect: { BM: 4 }, category: 'Drugs', log: 'Oral glucose gel / juice given (conscious hypoglycaemia).', type: 'bolus', duration: 60, pk: { onset: 600, peak: 1500, offset: 3600, maxDoses: 3 } },
};
