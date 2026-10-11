// =================================================================================================
// VENTILATOR SIM: the ventilator-training mode (phase 4 of the ventilator plan).
//
// Like Defib Sim, a Ventilator Sim session runs through the SAME engine, Firebase session, monitor
// and debrief as every other mode. This file only describes it: the built-in scenarios, the patient
// each one loads, and the debrief feedback read from the event log and the ventilator samples
// (state.ventSamples, recorded every 15 s while a ventilator breathes for the patient).
//
// The teaching targets below are the simulator's, written for these scenarios from BTS/ICS NIV and
// ARDS lung-protective ventilation principles as commonly taught; they are not a guideline and
// should be reviewed by the facilitator. Plain JS (no JSX). Exposes window.VentSim.
// =================================================================================================
(function () {
    'use strict';

    // airway: 'tube' means intubated before the scenario starts (RSI recorded), 'none' a mask.
    // targets: spo2 [low, high] (%), vtMax / vtMin (ml/kg ideal body weight), pplatMax, dpMax
    // (driving pressure = Pplat - PEEP), autopeepMax, ipapMin, ipapMax, peepMin (all cmH2O), etco2 [low, high] (kPa).
    // The troubleshooting scenarios (DOPES, mucus plugging, transfer) are not about the tidal volume and start on
    // the ventilator's own default (Vt = 8 ml/kg IBW, measured a little above it), so they allow up to 8.5 ml/kg
    // rather than marking a candidate down for a setting they were handed; ARDS and post-RSI keep the strict 8.
    // problems: the problems this scenario is written around (the facilitator injects them).
    // startProblems: problems already present when the scenario starts.
    // devices: which machines the scenario is written for: 't1' (HAMILTON-T1, the Ventilator Sim
    // card), 'c6' (HAMILTON-C6) and/or 'a350' (Dräger Atlan A350 anaesthetic machine), both on the
    // Anaesthetics / ICU card. Missing means the T1 only.
    // targets.vc: a volume-controlled mode ((S)CMV or SIMV) is expected; targets.spont: a spontaneous
    // breathing trial on pressure support (SPONT) is expected.
    var SCENARIOS = [
        { id: 'copd-niv', devices: ['t1', 'c6'], name: 'AECOPD: start NIV', group: 'Noninvasive ventilation',
          description: '68-year-old with an exacerbation of COPD. Drowsy, using accessory muscles. On 28% oxygen after nebulisers: SpO2 85%, pH 7.24, PaCO2 9.6 kPa. Set up NIV and titrate it.',
          profile: 'copd', breathing: null, airway: 'none', age: 68, sex: 'Male',
          vitals: { hr: 112, bpSys: 148, bpDia: 86, rr: 30, spO2: 85, etco2: 8.2, gcs: 14, temp: 37.4 },
          targets: { spo2: [88, 92], ipapMin: 20, ipapMax: 30, niv: true },
          problems: ['leakL', 'det', 'cough'] },
        { id: 'cpo-cpap', name: 'Cardiogenic pulmonary oedema: CPAP', group: 'Noninvasive ventilation',
          description: '74-year-old with acute pulmonary oedema. Sitting up, frothy sputum, crackles to the apices. SpO2 86% on 60% oxygen. Start CPAP (NIV mode with no pressure support) and titrate.',
          profile: 'cpo', breathing: null, airway: 'none', age: 74, sex: 'Female',
          vitals: { hr: 124, bpSys: 182, bpDia: 104, rr: 34, spO2: 86, etco2: 5.6, gcs: 15, temp: 36.9 },
          targets: { spo2: [94, 98], peepMin: 8, niv: true },
          problems: ['leakM', 'disc'] },
        { id: 'ohs-niv', name: 'Obesity hypoventilation: NIV', group: 'Noninvasive ventilation',
          description: '58-year-old with obesity hypoventilation, drowsy with a raised CO2 on 28% oxygen. Snores and obstructs when asleep. Set up NIV with enough EPAP to hold the upper airway open.',
          profile: 'ohs', breathing: null, airway: 'none', age: 58, sex: 'Male',
          vitals: { hr: 104, bpSys: 156, bpDia: 92, rr: 26, spO2: 84, etco2: 8.2, gcs: 13, temp: 37.0 },
          targets: { spo2: [88, 92], peepMin: 8, ipapMax: 30, niv: true },
          problems: ['leakM', 'apnoea'] },
        { id: 'ards', devices: ['t1', 'c6'], name: 'ARDS: lung-protective ventilation', group: 'Invasive ventilation',
          description: '45-year-old with severe pneumonia, just intubated in the ED, sedated and paralysed, being bagged on 100% oxygen. Set lung-protective ventilation: low tidal volume, enough PEEP, a safe plateau pressure.',
          profile: 'ards', breathing: false, airway: 'tube', age: 45, sex: 'Male',
          vitals: { hr: 118, bpSys: 104, bpDia: 62, rr: 20, spO2: 86, etco2: 6.0, gcs: 3, temp: 38.6 },
          targets: { spo2: [88, 95], vtMax: 8, vtIdeal: 6, pplatMax: 30, dpMax: 15, peepMin: 8 },
          problems: ['disc', 'block'] },
        { id: 'asthma', devices: ['t1', 'c6'], name: 'Severe asthma, intubated', group: 'Invasive ventilation',
          description: '24-year-old with life-threatening asthma, intubated after failing to improve. Sedated and paralysed. Watch for air trapping: low rate, long expiratory time, and accept a raised CO2.',
          profile: 'asthma', breathing: false, airway: 'tube', age: 24, sex: 'Female',
          vitals: { hr: 128, bpSys: 112, bpDia: 64, rr: 14, spO2: 90, etco2: 7.0, gcs: 3, temp: 37.1 },
          targets: { spo2: [93, 98], pplatMax: 30, autopeepMax: 5 },
          problems: ['bronch', 'ptx'] },
        { id: 'post-rsi', devices: ['t1', 'c6'], name: 'After RSI in the ED: set up the ventilator', group: 'Invasive ventilation',
          description: '52-year-old intubated in the ED for a falling GCS after an overdose. Sedated and paralysed, tube position confirmed. The ventilator is switched off: check it, set it up from scratch and connect.',
          profile: 'normal', breathing: false, airway: 'tube', age: 52, sex: 'Male',
          vitals: { hr: 96, bpSys: 124, bpDia: 76, rr: 12, spO2: 97, etco2: 4.8, gcs: 3, temp: 36.8 },
          targets: { spo2: [94, 98], vtMin: 6, vtMax: 8, pplatMax: 30, etco2: [4.5, 6.0] },
          problems: [] },
        { id: 'dopes', devices: ['t1', 'c6'], name: 'Troubleshooting (DOPES)', group: 'Troubleshooting',
          description: 'Intubated, sedated and paralysed patient on the ventilator. The facilitator introduces problems one at a time: displaced or blocked tube, pneumothorax, equipment failure, stacked breaths. Find and fix each one.',
          profile: 'normal', breathing: false, airway: 'tube', age: 60, sex: 'Female',
          vitals: { hr: 90, bpSys: 128, bpDia: 74, rr: 14, spO2: 97, etco2: 4.9, gcs: 3, temp: 36.9 },
          targets: { spo2: [94, 98], vtMin: 6, vtMax: 8.5, pplatMax: 30 },
          problems: ['tubeout', 'block', 'ptx', 'disc', 'kink', 'o2fail'] },
        { id: 'plug', devices: ['t1', 'c6'], name: 'Mucus plugging: bronchoscopy', group: 'Troubleshooting',
          description: '71-year-old intubated two days ago for pneumonia, sedated and paralysed. Over the last hour the SpO2 has fallen despite more oxygen, the airway pressures are high and the tidal volumes low. Reduced air entry on the right. Work through DOPES, then bronchoscopy to clear the plug.',
          profile: 'normal', breathing: false, airway: 'tube', age: 71, sex: 'Male',
          vitals: { hr: 104, bpSys: 132, bpDia: 78, rr: 18, spO2: 88, etco2: 5.6, gcs: 3, temp: 37.8 },
          targets: { spo2: [92, 96], vtMin: 6, vtMax: 8.5, pplatMax: 30 },
          problems: ['plug'], startProblems: ['plug'] },
        { id: 'transfer', name: 'Interhospital transfer', group: 'Troubleshooting',
          description: 'Ventilated patient for transfer to a tertiary centre. Prepare the ventilator for transport, then manage what happens in the ambulance: mains power, battery, the oxygen cylinder and a disconnection.',
          profile: 'normal', breathing: false, airway: 'tube', age: 38, sex: 'Male',
          vitals: { hr: 88, bpSys: 122, bpDia: 72, rr: 14, spO2: 98, etco2: 4.7, gcs: 3, temp: 36.7 },
          targets: { spo2: [94, 98], vtMin: 6, vtMax: 8.5, pplatMax: 30 },
          problems: ['mains', 'battlow', 'o2fail', 'disc'] },
        // ---- written for the HAMILTON-C6 (ICU) ----
        { id: 'icu-vc', devices: ['c6'], name: 'Volume control: rising airway pressures', group: 'Intensive care',
          description: '57-year-old on ICU with pneumonia, intubated yesterday, sedated and paralysed. Set up volume-controlled ventilation ((S)CMV with an inspiratory pause) at 6-8 ml/kg ideal body weight. The facilitator then makes the airway pressures rise: use Ppeak and Pplateau to tell a resistance problem (tube, bronchospasm) from a compliance problem (pneumothorax).',
          profile: 'normal', breathing: false, airway: 'tube', age: 57, sex: 'Male',
          vitals: { hr: 98, bpSys: 118, bpDia: 70, rr: 16, spO2: 94, etco2: 5.4, gcs: 3, temp: 38.1 },
          targets: { spo2: [92, 98], vtMin: 6, vtMax: 8, pplatMax: 30, vc: true },
          problems: ['bronch', 'block', 'ptx'] },
        { id: 'icu-wean', devices: ['c6'], name: 'Weaning: spontaneous breathing trial', group: 'Intensive care',
          description: '63-year-old on day 5 of ICU after pneumonia. Sedation is off; awake, obeying commands, on 35% oxygen. The ventilator is in standby after a circuit change. Set it up for a spontaneous breathing trial on pressure support (SPONT, low pressure support, PEEP 5) and watch for signs that the trial is failing.',
          profile: 'normal', breathing: true, airway: 'tube', age: 63, sex: 'Female',
          vitals: { hr: 88, bpSys: 132, bpDia: 76, rr: 18, spO2: 96, etco2: 5.0, gcs: 11, temp: 37.2 },
          targets: { spo2: [92, 98], spont: true },
          problems: ['det', 'leakM'] },
        // ---- anaesthetic emergencies for novice anaesthetists, on the Atlan A350 or the HAMILTON-C6 ----
        // Each follows a guideline of the Association of Anaesthetists' Quick Reference Handbook (QRH,
        // June 2023 edition); the number is in the name. The patient is anaesthetised, intubated and
        // ventilated in theatre, on the Dräger Atlan A350 anaesthetic machine (or the HAMILTON-C6 as an
        // ICU ventilator). rhythm / deterioration / stabilisers / recommended / lung are optional:
        // the starting rhythm, the controller's autonomous deterioration (off until the facilitator
        // switches it to Auto), the interventions that turn it round, extra interventions to list
        // first, and the starting lung adjustments (live.vent.lung, e.g. CO2 production).
        { id: 'an-arrest', devices: ['a350', 'c6'], name: 'Cardiac arrest under anaesthesia (QRH 2-1)', group: 'Anaesthetic emergencies',
          description: '67-year-old having a laparotomy under general anaesthesia: intubated, paralysed, on the ventilator. Stable so far. The facilitator changes the rhythm (PEA after a sudden fall in ETCO2, or VF). Declare the arrest, start compressions, give 100% oxygen, turn the anaesthetic off, check the airway and capnography, and work through the causes.',
          profile: 'normal', breathing: false, airway: 'tube', age: 67, sex: 'Male',
          vitals: { hr: 78, bpSys: 112, bpDia: 64, rr: 12, spO2: 98, etco2: 4.6, gcs: 3, temp: 36.4 },
          targets: { spo2: [94, 100], vtMin: 6, vtMax: 8.5 },
          recommended: ['CPR', 'Defib', 'AdrenalineIV', 'Amiodarone', 'Fluids', 'Atropine'],
          problems: ['tubeout', 'disc', 'ptx'] },
        { id: 'an-hypoxia', devices: ['a350', 'c6'], name: 'Desaturation after intubation (QRH 2-2)', group: 'Anaesthetic emergencies',
          description: '34-year-old for a laparoscopic appendicectomy, just intubated and connected to the ventilator. The SpO2 is drifting down and the airway pressures are higher than expected. Give 100% oxygen and work through the hypoxia drill: equipment, airway (tube position and length), breathing, circulation, depth. The tube has gone too far; other causes can follow.',
          profile: 'normal', breathing: false, airway: 'tube', age: 34, sex: 'Female',
          vitals: { hr: 96, bpSys: 118, bpDia: 70, rr: 12, spO2: 93, etco2: 4.9, gcs: 3, temp: 36.6 },
          targets: { spo2: [94, 100], vtMin: 6, vtMax: 8.5, pplatMax: 30 },
          recommended: ['TubeWithdraw', 'Suction', 'Bronchoscopy'],
          problems: ['endo', 'tubeout', 'disc', 'o2fail', 'plug'], startProblems: ['endo'] },
        { id: 'an-paw', devices: ['a350', 'c6'], name: 'High airway pressure (QRH 2-3)', group: 'Anaesthetic emergencies',
          description: '58-year-old under general anaesthesia for a hip replacement, intubated and ventilated in volume control. Part way through, the airway pressure alarm goes off. Confirm the high pressure, isolate the patient from the circuit, and work along the tube to the lungs. The facilitator gives one cause at a time: kinked circuit, blocked tube, endobronchial tube, bronchospasm, light anaesthesia (coughing), pneumothorax.',
          profile: 'normal', breathing: false, airway: 'tube', age: 58, sex: 'Female',
          vitals: { hr: 84, bpSys: 124, bpDia: 72, rr: 12, spO2: 98, etco2: 4.8, gcs: 3, temp: 36.5 },
          targets: { spo2: [94, 100], vtMin: 6, vtMax: 8.5, pplatMax: 30, vc: true },
          recommended: ['Suction', 'TubeWithdraw', 'Nebs', 'Propofol', 'Roc', 'Needle'],
          problems: ['kink', 'block', 'endo', 'bronch', 'cough', 'ptx'] },
        { id: 'an-bronch', devices: ['a350', 'c6'], name: 'Bronchospasm after intubation (QRH 3-4)', group: 'Anaesthetic emergencies',
          description: '29-year-old with asthma, just intubated for an emergency laparoscopy. High inflation pressures, small tidal volumes, an upsloping capnograph and a rising CO2. Give 100% oxygen, stop stimulation, deepen anaesthesia, exclude tube problems, then treat (salbutamol first; magnesium, ketamine or adrenaline next). Lengthen expiration and watch for breath stacking. The facilitator removes the bronchospasm once it is treated.',
          profile: 'normal', breathing: false, airway: 'tube', age: 29, sex: 'Female',
          vitals: { hr: 112, bpSys: 128, bpDia: 76, rr: 12, spO2: 92, etco2: 6.2, gcs: 3, temp: 36.7 },
          targets: { spo2: [92, 100], pplatMax: 30, autopeepMax: 5 },
          recommended: ['Nebs', 'MagSulph', 'Ketamine', 'AdrenalineIVSmall', 'Hydrocortisone'],
          problems: ['bronch', 'trap', 'endo'], startProblems: ['bronch'] },
        { id: 'an-anaph', devices: ['a350', 'c6'], name: 'Anaphylaxis at induction (QRH 3-1)', group: 'Anaesthetic emergencies',
          description: '45-year-old given co-amoxiclav and rocuronium at induction, now intubated and ventilated. Within minutes: BP 68/38, HR 132, high airway pressures and falling SpO2. Call for help, stop the trigger, 100% oxygen, legs up, IV adrenaline 50 micrograms repeated, fast IV fluid; CPR if the systolic falls below 50. Set Patient condition to Auto for a patient who worsens until adrenaline is given. The facilitator removes the bronchospasm as it responds.',
          profile: 'normal', breathing: false, airway: 'tube', age: 45, sex: 'Male',
          vitals: { hr: 132, bpSys: 68, bpDia: 38, rr: 12, spO2: 91, etco2: 3.6, gcs: 3, temp: 36.6 },
          targets: { spo2: [92, 100], pplatMax: 30 },
          deterioration: { active: true, rate: 0.15, type: 'shock' }, stabilisers: ['AdrenalineIVSmall', 'Noradrenaline'],
          recommended: ['AdrenalineIVSmall', 'Fluids', 'CPR', 'Nebs', 'Hydrocortisone', 'Chlorphenamine', 'Metaraminol', 'Glucagon'],
          problems: ['bronch'], startProblems: ['bronch'] },
        { id: 'an-hypo', devices: ['a350', 'c6'], name: 'Hypotension and bradycardia after induction (QRH 2-4, 2-6)', group: 'Anaesthetic emergencies',
          description: '78-year-old on a beta-blocker, intubated after a propofol induction for a laparotomy, now on the ventilator. BP 74/40 and HR 46. Check oxygen delivery, airway and breathing first, then treat: an anticholinergic for the slow heart rate, a vasopressor (ephedrine, metaraminol), a fluid bolus and the depth of anaesthesia. Set Patient condition to Auto to make it worse until treated.',
          profile: 'normal', breathing: false, airway: 'tube', age: 78, sex: 'Female',
          vitals: { hr: 46, bpSys: 74, bpDia: 40, rr: 12, spO2: 97, etco2: 4.2, gcs: 3, temp: 36.2 },
          targets: { spo2: [94, 100], vtMin: 6, vtMax: 8.5 },
          rhythm: 'Sinus Bradycardia', deterioration: { active: true, rate: 0.05, type: 'shock' }, stabilisers: ['Ephedrine', 'Metaraminol', 'Glycopyrronium', 'Atropine'],
          recommended: ['Glycopyrronium', 'Atropine', 'Ephedrine', 'Metaraminol', 'Fluids'],
          problems: [] },
        { id: 'an-mh', devices: ['a350', 'c6'], name: 'Malignant hyperthermia crisis (QRH 3-8)', group: 'Anaesthetic emergencies',
          description: '22-year-old having a knee arthroscopy under sevoflurane, intubated and ventilated. ETCO2 rising despite more ventilation, tachycardia, then a rising temperature. Call for help and the MH kit, turn off the vapour, maximum oxygen flow, hyperventilate (2-3 times the minute volume), give dantrolene and start active cooling. CO2 production starts at twice normal; dantrolene brings it back. The facilitator raises the temperature by hand.',
          profile: 'normal', breathing: false, airway: 'tube', age: 22, sex: 'Male',
          vitals: { hr: 128, bpSys: 136, bpDia: 78, rr: 12, spO2: 96, etco2: 7.4, gcs: 3, temp: 38.4 },
          targets: { spo2: [94, 100], etco2: [4.5, 6.0] },
          lung: { m: 200 }, stabilisers: ['Dantrolene'],
          recommended: ['Dantrolene', 'Cooling', 'CheckVBG', 'SodiumBicarb', 'InsulinDextrose', 'CalciumChloride'],
          problems: [] },
        { id: 'an-equip', devices: ['a350', 'c6'], name: 'Oxygen and power failure in theatre (QRH 4-1, 4-2)', group: 'Anaesthetic emergencies',
          description: '50-year-old under general anaesthesia, intubated and ventilated. The facilitator fails the oxygen supply, the mains power, or disconnects the circuit. Recognise it from the alarms, check the patient, switch to a cylinder or hand ventilation with a self-inflating bag, and keep the patient anaesthetised (intravenous anaesthesia if the vapour stops).',
          profile: 'normal', breathing: false, airway: 'tube', age: 50, sex: 'Male',
          vitals: { hr: 76, bpSys: 122, bpDia: 70, rr: 12, spO2: 99, etco2: 4.7, gcs: 3, temp: 36.6 },
          targets: { spo2: [94, 100], vtMin: 6, vtMax: 8.5 },
          recommended: ['Bagging', 'Propofol'],
          problems: ['o2fail', 'mains', 'battlow', 'disc'] },
        { id: 'an-oeso', devices: ['a350', 'c6'], name: 'No capnography trace after intubation (oesophageal tube)', group: 'Anaesthetic emergencies',
          description: '41-year-old having a rapid sequence induction for an emergency laparotomy. The tube is in and connected, but there is no CO2 trace and the SpO2 starts to fall. No trace, wrong place: assume the tube is in the oesophagus. Call for help, give 100% oxygen, take the tube out and oxygenate by face mask (Man/Spon with the bag) before trying again. The facilitator removes the problem when the tube is re-sited.',
          profile: 'normal', breathing: false, airway: 'tube', age: 41, sex: 'Male',
          vitals: { hr: 104, bpSys: 132, bpDia: 78, rr: 12, spO2: 96, etco2: 4.8, gcs: 3, temp: 36.6 },
          targets: { spo2: [94, 100], vtMin: 6, vtMax: 8.5 },
          recommended: ['Bagging', 'RSI', 'Suction'],
          problems: ['tubeout', 'disc', 'o2fail'], startProblems: ['tubeout'] },
        { id: 'an-disc', devices: ['a350', 'c6'], name: 'Leak or disconnection during the case', group: 'Anaesthetic emergencies',
          description: '62-year-old under general anaesthesia for a bowel resection, intubated, ventilated and stable. The facilitator disconnects the circuit, cracks it, or adds a large leak. Recognise it (low minute volume, airway pressure not achieved, an emptying bag, a lost CO2 trace), hand-ventilate if needed, and work along the circuit from the machine to the patient to find it.',
          profile: 'normal', breathing: false, airway: 'tube', age: 62, sex: 'Male',
          vitals: { hr: 72, bpSys: 126, bpDia: 74, rr: 12, spO2: 99, etco2: 4.7, gcs: 3, temp: 36.4 },
          targets: { spo2: [94, 100], vtMin: 6, vtMax: 8.5 },
          recommended: ['Bagging'],
          problems: ['disc', 'circ', 'leakL', 'kink'] },
        // ---- the anaesthetic machine itself, for novices: the check, induction, maintenance, emergence ----
        { id: 'an-check', devices: ['a350'], name: 'Machine check, pre-oxygenation and induction', group: 'Anaesthetic machine skills',
          description: '55-year-old for an elective hernia repair, awake on the trolley and breathing on their own. The machine is switched off. Switch it on and run the system test and leak test (the facilitator may crack the circuit so the leak test fails). Pre-oxygenate by face mask in Man/Spon with the APL valve open and a high oxygen flow, aiming for an end-tidal O2 above 90%. After the induction drugs the facilitator stops the breathing: hand-ventilate with the bag, then intubate and start volume control.',
          profile: 'normal', breathing: null, airway: 'none', age: 55, sex: 'Male',
          vitals: { hr: 78, bpSys: 138, bpDia: 82, rr: 14, spO2: 97, etco2: 5.0, gcs: 15, temp: 36.7 },
          targets: { spo2: [94, 100], vtMin: 6, vtMax: 8.5 },
          recommended: ['Propofol', 'Fentanyl', 'Roc', 'Bagging', 'RSI'],
          problems: ['circ', 'leakM', 'apnoea'] },
        { id: 'an-lowflow', devices: ['a350'], name: 'Maintenance with sevoflurane at low flow', group: 'Anaesthetic machine skills',
          description: '38-year-old just intubated and ventilated in volume control, no vapour on yet. Start sevoflurane and bring the end-tidal to about 1 xMAC, then turn the fresh-gas flow down to 1 L/min and watch how slowly the inspired and end-tidal values now change. Try N2O as the carrier gas and watch the inspired oxygen at a low flow. The gas model is a teaching approximation, not a pharmacokinetic model.',
          profile: 'normal', breathing: false, airway: 'tube', age: 38, sex: 'Female',
          vitals: { hr: 82, bpSys: 118, bpDia: 70, rr: 12, spO2: 99, etco2: 4.8, gcs: 3, temp: 36.6 },
          targets: { spo2: [94, 100], vtMin: 6, vtMax: 8.5 },
          recommended: ['Propofol', 'Fentanyl'],
          problems: ['o2fail', 'circ'] },
        { id: 'an-emergence', devices: ['a350'], name: 'Emergence: from volume control to spontaneous breathing', group: 'Anaesthetic machine skills',
          description: '47-year-old at the end of a laparoscopic cholecystectomy, intubated and ventilated in volume control. The neuromuscular blockade has been reversed and the patient is starting to breathe against the ventilator. Change to a mode that supports their breathing (PC-SIMV with pressure support, then CPAP/PSV), turn the vapour off, raise the fresh-gas flow and oxygen, and judge when they are ready to wake up. The facilitator can stop the breathing again or make them cough.',
          profile: 'normal', breathing: true, airway: 'tube', age: 47, sex: 'Female',
          vitals: { hr: 88, bpSys: 134, bpDia: 80, rr: 14, spO2: 99, etco2: 5.4, gcs: 3, temp: 36.4 },
          targets: { spo2: [94, 100], spont: true },
          recommended: ['Sugammadex', 'Antiemetic', 'Suction'],
          problems: ['cough', 'apnoea', 'leakM'] }
    ];
    function byId(id) { for (var i = 0; i < SCENARIOS.length; i++) if (SCENARIOS[i].id === id) return SCENARIOS[i]; return null; }
    // The machines a scenario can be written for, and the scenarios written for one of them.
    var DEVICES = ['t1', 'c6', 'a350'];
    var deviceOf = function (d) { return DEVICES.indexOf(d) !== -1 ? d : 't1'; };
    function forDevice(device) { var d = deviceOf(device); return SCENARIOS.filter(function (s) { return (s.devices || ['t1']).indexOf(d) !== -1; }); }

    function buildScenario(opts) {
        opts = opts || {};
        var sc = byId(opts.scenario);
        if (!sc) throw new Error('Unknown ventilator scenario.');
        var device = deviceOf(opts.device);
        if ((sc.devices || ['t1']).indexOf(device) === -1) throw new Error('That scenario is not written for this ventilator.');
        var RG = window.RHYTHMS;
        var rhythm = sc.rhythm && RG && RG.isKnown(sc.rhythm) ? sc.rhythm : sc.vitals.hr > 100 && RG && RG.isKnown('Sinus Tachycardia') ? 'Sinus Tachycardia' : 'Sinus Rhythm';
        var base = window.buildQuickSimScenario({ age: sc.age, sex: sc.sex, name: opts.name || 'Ventilator Sim Patient', rhythm: rhythm });
        var vitals = Object.assign({}, base.vitals, sc.vitals);
        var mode = opts.mode === 'assessment' ? 'assessment' : 'education';
        var intubated = sc.airway === 'tube';
        // The controller's intervention list starts with what this scenario is likely to need.
        var recommended = ['Obs', 'ToggleETCO2', 'CheckVBG'];
        if (intubated) recommended.push('Suction', 'Propofol', 'Fentanyl', 'Roc');
        if (sc.profile === 'asthma' || sc.profile === 'copd') recommended.push('Nebs', 'Hydrocortisone');
        if (sc.profile === 'cpo') recommended.push('GTN', 'Furosemide');
        if (sc.problems.indexOf('ptx') !== -1) recommended.push('Needle', 'FingerThoracostomy');
        if (sc.problems.indexOf('plug') !== -1 || sc.problems.indexOf('block') !== -1) recommended.push('Bronchoscopy');
        (sc.recommended || []).forEach(function (k) { if (recommended.indexOf(k) === -1) recommended.push(k); });
        var defs = window.INTERVENTIONS || null;
        if (defs) recommended = recommended.filter(function (k) { return !!defs[k]; });
        var probNames = sc.problems.map(PROBLEM_LABEL);
        return Object.assign({}, base, {
            id: 'VENT_' + sc.id + '_' + Date.now(),
            // The full controller (interventions, drugs, investigations), as Defib Sim has: needle
            // decompression, bronchoscopy, sedation and nebulisers are part of these scenarios.
            quickSim: false,
            title: (sc.group === 'Anaesthetic emergencies' ? 'Anaesthetic emergency: ' : device === 'a350' ? 'Anaesthetic machine: ' : device === 'c6' ? 'ICU ventilator: ' : 'Ventilator Sim: ') + sc.name,
            category: 'Ventilator Sim',
            acuity: 'Resus',
            presentingComplaint: sc.description,
            profile: sc.description,
            patientProfileTemplate: sc.description,
            vitalsMod: vitals,
            vitals: vitals,
            recommendedActions: recommended,
            deterioration: sc.deterioration ? Object.assign({}, sc.deterioration) : (base.deterioration || { active: false, rate: 0 }),
            stabilisers: (sc.stabilisers || []).slice(),
            // No learning objectives on purpose: they are scored from the controller's interventions, and
            // this is scored by the ventilator feedback instead, so they would always read as missed.
            learningObjectives: [],
            instructorBrief: {
                progression: sc.description + (probNames.length ? ' Problems to inject, one at a time: ' + probNames.join(', ') + '.' : ''),
                interventions: [], learningObjectives: []
            },
            ventSim: {
                scenario: sc.id, name: sc.name, group: sc.group, description: sc.description, mode: mode, device: device,
                profile: sc.profile, breathing: sc.breathing, airway: sc.airway,
                targets: sc.targets, problems: sc.problems.slice(), startProblems: (sc.startProblems || []).slice(),
                lung: Object.assign({}, sc.lung || {})
            }
        });
    }

    // ---- DEBRIEF -----------------------------------------------------------------------------
    // A time on the session clock, as the rest of the debrief writes it (00:00), and a duration in words.
    var clock = function (sec) { sec = Math.max(0, Math.round(Number(sec) || 0)); return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0'); };
    var duration = function (sec) {
        sec = Math.max(0, Math.round(Number(sec) || 0));
        var m = Math.floor(sec / 60), r = sec % 60;
        return m ? m + ' min' + (r ? ' ' + r + ' s' : '') : r + ' s';
    };
    var median = function (a) { if (!a.length) return null; var s = a.slice().sort(function (x, y) { return x - y; }); var m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    var round1 = function (v) { return Math.round(v * 10) / 10; };
    var PROBLEM_LABEL = function (id) { var VP = window.VENT_PROFILES; var p = VP && VP.PROBLEMS.filter(function (x) { return x.id === id; })[0]; return p ? p.label : id; };

    // Was a ventilator part of this session at all?
    function used(state) {
        var log = (state && state.log) || [];
        return !!(state && state.scenario && state.scenario.ventSim) || log.some(function (l) { return /^Ventilator[ :(]/.test(l.msg || ''); });
    }

    function assess(state) {
        var sc = (state && state.scenario) || {};
        var vs = sc.ventSim || null;
        var tg = (vs && vs.targets) || {};
        var log = (state && state.log) || [];
        var samples = (state && state.ventSamples) || [];
        var hist = (state && state.history) || [];
        var t = function (l) { return Number(l.timeSeconds) || 0; };
        var find = function (re) { return log.filter(function (l) { return re.test(l.msg || ''); }); };
        var good = [], improve = [], stats = [];

        // Who did what: the candidate's own device actions are "Ventilator: ..."; remote changes are
        // "Ventilator (facilitator): ...".
        var starts = find(/^Ventilator: (Ventilation started|Therapy started)/);
        var leak = find(/^Ventilator: Leak test passed/), flow = find(/^Ventilator: Flow sensor calibration passed/);
        // The Atlan A350 logs "Therapy started" and has a system test instead of a flow sensor calibration.
        var a350 = starts.some(function (l) { return /^Ventilator: Therapy started/.test(l.msg); });
        if (a350) flow = find(/^Ventilator: System test passed/);
        var checkNames = a350 ? 'system test and leak test' : 'leak test and flow sensor calibration';
        var limits = find(/^Ventilator: (Alarm limit changed|Alarm limits set with Auto)/);
        var settings = find(/^Ventilator: Setting changed/);
        var hiAlarms = find(/^Ventilator alarm \(high priority\)/);
        var remote = find(/^Ventilator \(facilitator\):/);

        if (starts.length) {
            var how = /started \((.+?)\) \(/.exec(starts[0].msg + ' (') ;
            stats.push('Ventilation first started at ' + clock(t(starts[0])) + (how ? ' in ' + how[1] : ''));
            if (leak.length && flow.length && t(leak[0]) <= t(starts[0]) && t(flow[0]) <= t(starts[0])) good.push('Pre-use check done before connecting: ' + checkNames);
            else improve.push('The ' + checkNames + ' were not both passed before ventilation started' + (a350 ? ' (Standby > Tests...)' : ' (System > Tests & calib)'));
        } else if (vs) {
            improve.push('The ventilator was never started by the candidate');
        }
        if (limits.length) good.push('Alarm limits reviewed (' + limits.length + ' change' + (limits.length === 1 ? '' : 's') + ')');
        else if (starts.length) improve.push('The alarm limits were never adjusted: set them around this patient (Alarms > Limits, or Auto once ventilating)');
        if (settings.length) stats.push(settings.length + ' setting change' + (settings.length === 1 ? '' : 's') + ' by the candidate');
        if (hiAlarms.length) stats.push(hiAlarms.length + ' high-priority alarm' + (hiAlarms.length === 1 ? '' : 's'));
        if (remote.length) stats.push(remote.length + ' change' + (remote.length === 1 ? '' : 's') + ' made remotely by the facilitator');

        // NIV scenarios: an NIV mode, and a sensible inspiratory pressure
        var invStarts = starts.filter(function (l) { return /\((\(S\)CMV\+?|SIMV\+?|APVcmv|APVsimv|VS|PCV\+|PSIMV\+|SPONT|DuoPAP|APRV|ASV)/.test(l.msg); });
        // The mode the candidate chose: the mode ventilation started in, or a later mode change
        var usedMode = function (re) { return log.some(function (l) { var m = /^Ventilator: (?:(?:Ventilation|Therapy) started \((.+)\)|Mode changed .+ \u2192 (.+)) \([^()]*\)$/.exec(l.msg || ''); return !!m && re.test(m[1] || m[2]); }); };
        if (tg.vc && starts.length) {
            if (usedMode(/^(\(S\)CMV|SIMV|VC-CMV|VC-SIMV(\/PS)?)$/)) good.push('A volume-controlled mode was used, so Ppeak and Pplateau could be compared');
            else improve.push('No volume-controlled mode ((S)CMV or SIMV; on the A350, VC-CMV or VC-SIMV) was used: in volume control a rise in Ppeak with a normal Pplateau points to resistance (tube, bronchospasm), and a rise in both to compliance (pneumothorax, stiff lungs)');
        }
        if (tg.spont && starts.length) {
            if (usedMode(/^(SPONT|CPAP\/PSV)$/)) good.push('The trial was run on pressure support (SPONT, or CPAP/PSV on the A350)');
            else improve.push('Pressure support (SPONT, or CPAP/PSV on the A350) was never used: a spontaneous breathing trial is run on low pressure support (or a T-piece), not a controlled mode');
        }
        if (tg.niv && starts.length) {
            var nivStarts = starts.filter(function (l) { return /\((NIV|NIV-ST)\)/.test(l.msg); });
            if (invStarts.length) improve.push('An invasive mode was used for a patient with a mask: choose NIV, NIV-ST (or CPAP as NIV with no pressure support)');
            else if (nivStarts.length) good.push('A noninvasive mode was used');
            if (starts.some(function (l) { return /\(HiFlowO2\)/.test(l.msg); }))
                improve.push('High-flow nasal oxygen was used: it does not give the ventilatory support this patient needs. Use NIV, NIV-ST or CPAP');
        }

        // Ventilator samples (while it was breathing for the patient)
        var vtk = samples.filter(function (s) { return s.vte > 0 && s.ibw > 0 && !s.niv; }).map(function (s) { return s.vte / s.ibw; });
        var pplat = samples.filter(function (s) { return s.pplat > 0; }).map(function (s) { return s.pplat; });
        var dp = samples.filter(function (s) { return s.pplat > 0 && s.peep >= 0; }).map(function (s) { return s.pplat - s.peep; });
        var ap = samples.filter(function (s) { return s.autopeep >= 0; }).map(function (s) { return s.autopeep; });
        var peeps = samples.filter(function (s) { return s.setPeep >= 0; }).map(function (s) { return s.setPeep; });
        var ipaps = samples.filter(function (s) { return s.ipap > 0; }).map(function (s) { return s.ipap; });
        if (vtk.length) {
            var mv = round1(median(vtk));
            stats.push('Median tidal volume ' + mv + ' ml/kg ideal body weight (' + vtk.length + ' sample' + (vtk.length === 1 ? '' : 's') + ')');
            if (tg.vtMax) {
                if (mv <= tg.vtMax && (!tg.vtMin || mv >= tg.vtMin)) good.push('Tidal volume ' + mv + ' ml/kg IBW, within the target ' + (tg.vtMin ? tg.vtMin + '-' : 'up to ') + tg.vtMax + ' ml/kg' + (tg.vtIdeal && mv <= tg.vtIdeal + 0.5 ? ' (lung-protective, about ' + tg.vtIdeal + ' ml/kg)' : ''));
                else improve.push('Tidal volume ' + mv + ' ml/kg IBW: the target here is ' + (tg.vtMin ? tg.vtMin + '-' : 'up to ') + tg.vtMax + ' ml/kg ideal body weight');
            }
        }
        if (pplat.length) {
            var pmax = Math.max.apply(null, pplat);
            stats.push('Highest plateau pressure ' + round1(pmax) + ' cmH2O');
            if (tg.pplatMax) { if (pmax <= tg.pplatMax) good.push('Plateau pressure stayed at or below ' + tg.pplatMax + ' cmH2O'); else improve.push('Plateau pressure reached ' + round1(pmax) + ' cmH2O (target ' + tg.pplatMax + ' or less)'); }
        }
        if (dp.length && tg.dpMax) {
            var dmed = round1(median(dp));
            if (dmed <= tg.dpMax) good.push('Driving pressure ' + dmed + ' cmH2O (target ' + tg.dpMax + ' or less)'); else improve.push('Driving pressure ' + dmed + ' cmH2O (Pplat minus PEEP): the target is ' + tg.dpMax + ' or less');
        }
        if (ap.length && tg.autopeepMax !== undefined) {
            var last = ap[ap.length - 1];
            if (last <= tg.autopeepMax) good.push('AutoPEEP ' + round1(last) + ' cmH2O at the end: air trapping controlled');
            else improve.push('AutoPEEP still ' + round1(last) + ' cmH2O at the end: lower the rate and lengthen expiration');
        }
        if (peeps.length && tg.peepMin) {
            var pk = Math.max.apply(null, peeps);
            if (pk >= tg.peepMin) good.push('PEEP/CPAP of ' + pk + ' cmH2O used (target at least ' + tg.peepMin + ')'); else improve.push('PEEP/CPAP never reached ' + tg.peepMin + ' cmH2O (highest ' + pk + ')');
        }
        if (ipaps.length && tg.ipapMin) {
            var imx = Math.max.apply(null, ipaps);
            // The T1's NIV default is already 20 cmH2O, so only an increase counts as titration.
            var rose = imx > ipaps[0];
            var adjusted = settings.some(function (l) { return /Setting changed: (PEEP\/CPAP|\u0394Psupport|\u0394Pinsp) /.test(l.msg); });
            if (imx < tg.ipapMin) improve.push('Inspiratory pressure never reached ' + tg.ipapMin + ' cmH2O (highest ' + imx + '): in hypercapnic AECOPD, titrate IPAP up towards 20 or more over 10-30 minutes as tolerated (BTS/ICS)');
            else if (rose) good.push('Inspiratory pressure titrated up to ' + imx + ' cmH2O');
            else if (adjusted) good.push('Inspiratory pressure adjusted during the session (highest ' + imx + ' cmH2O)');
            else stats.push('Inspiratory pressure stayed at the starting ' + imx + ' cmH2O (the ventilator\u2019s default): it was not titrated to the patient\u2019s response');
        }
        if (ipaps.length && tg.ipapMax) {
            var im = Math.max.apply(null, ipaps);
            if (im > tg.ipapMax) improve.push('Inspiratory pressure reached ' + im + ' cmH2O: above ' + tg.ipapMax + ' needs senior review (BTS/ICS)');
        }

        // SpO2 and ETCO2 in their target range, from the debrief obs record, after ventilation began
        var from = starts.length ? t(starts[0]) : null;
        if (from !== null && tg.spo2) {
            var sp = hist.filter(function (h) { return h.time >= from + 60 && Number.isFinite(Number(h.spo2)) && h.spo2 > 0; });
            if (sp.length) {
                var inR = sp.filter(function (h) { return h.spo2 >= tg.spo2[0] && h.spo2 <= tg.spo2[1]; }).length;
                var pct = Math.round(inR / sp.length * 100);
                var line = 'SpO2 in the target ' + tg.spo2[0] + '-' + tg.spo2[1] + '% for ' + pct + '% of the time after the first minute';
                if (pct >= 70) good.push(line); else improve.push(line);
            }
        }
        if (from !== null && tg.etco2) {
            var ec = hist.filter(function (h) { return h.time >= from + 180 && Number(h.etco2) > 0; });
            if (ec.length) {
                var e = round1(ec[ec.length - 1].etco2);
                // kPa to one decimal place, as on every screen (5.0, not 5)
                var k1 = function (v) { return Number(v).toFixed(1); };
                if (e >= tg.etco2[0] && e <= tg.etco2[1]) good.push('ETCO2 ' + k1(e) + ' kPa at the end, within ' + k1(tg.etco2[0]) + '-' + k1(tg.etco2[1]) + ' kPa');
                else improve.push('ETCO2 ' + k1(e) + ' kPa at the end: aim for ' + k1(tg.etco2[0]) + '-' + k1(tg.etco2[1]) + ' kPa');
            }
        }

        // Problems: when each was injected and when it was fixed
        var problems = [];
        var open = {};
        // A problem the scenario starts with counts from the start.
        ((vs && vs.startProblems) || []).forEach(function (id) { var k0 = PROBLEM_LABEL(id); open[k0] = { label: k0, at: 0, fixedAt: null, fromStart: true }; problems.push(open[k0]); });
        log.forEach(function (l) {
            var m = /^Ventilator problem injected: (.+) \(facilitator\)$/.exec(l.msg || '');
            if (m) { open[m[1]] = { label: m[1], at: t(l), fixedAt: null }; problems.push(open[m[1]]); return; }
            m = /^Ventilator problem fixed: (.+) \(facilitator\)$/.exec(l.msg || '');
            if (m && open[m[1]]) { open[m[1]].fixedAt = t(l); delete open[m[1]]; return; }
            if (/^Ventilator problem fixed: tension pneumothorax decompressed/.test(l.msg || '')) {
                var k = PROBLEM_LABEL('ptx'); if (open[k]) { open[k].fixedAt = t(l); open[k].by = 'decompression'; delete open[k]; } return;
            }
            if (/^Ventilator problem fixed: mucus plug cleared by bronchoscopy/.test(l.msg || '')) {
                var kp = PROBLEM_LABEL('plug'); if (open[kp]) { open[kp].fixedAt = t(l); open[kp].by = 'bronchoscopy'; delete open[kp]; } return;
            }
            if (/^Ventilator problems: all fixed/.test(l.msg || '')) Object.keys(open).forEach(function (k2) { open[k2].fixedAt = t(l); delete open[k2]; });
        });
        problems.forEach(function (p) {
            p.text = p.label + (p.fromStart ? ': present from the start' : ': injected at ' + clock(p.at)) + (p.fixedAt !== null ? ', fixed ' + duration(p.fixedAt - p.at) + ' later' + (p.by === 'decompression' ? ' (chest decompressed)' : p.by === 'bronchoscopy' ? ' (bronchoscopy)' : '') : ', not fixed by the end');
        });

        return { good: good, improve: improve, stats: stats, problems: problems, samples: samples.length };
    }

    window.VentSim = { SCENARIOS: SCENARIOS, byId: byId, forDevice: forDevice, buildScenario: buildScenario, assess: assess, used: used };
})();
