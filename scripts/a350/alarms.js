/* ======================= alarms ======================= */
/* Priorities: high !!! red, medium !! yellow, low ! cyan ([IFU2] p. 197). The texts are the IFU's ([IFU1]
   pp. 202-218) except those marked "simulator's wording", which the IFU text available here did not give.
   Thresholds and delays the IFU does not give are the simulator's. */
const ALARMS = {
  phigh:    {t:'Airway pressure high', p:'hi', f:'pip'},
  pcont:    {t:'Airway press. continuously high', p:'hi', f:'peep'},
  plow:     {t:'Airway pressure not achieved', p:'med', f:'pip'},
  plimit:   {t:'Pressure limited', p:'low', f:'pip'},                 /* simulator's wording */
  apnea:    {t:'Apnea', p:'med'},
  apnea2:   {t:'Apnea', p:'hi'},                                      /* the IFU: !! escalating to !!! */
  apvent:   {t:'Apnea ventilation', p:'low'},                         /* simulator's wording (RRmin backup in PSV) */
  mvlow:    {t:'Minute volume low', p:'med', f:'mv'},
  mvhigh:   {t:'Minute volume high', p:'med', f:'mv'},
  o2low:    {t:'FiO2 low', p:'hi', f:'o2'},
  o2high:   {t:'FiO2 high', p:'med', f:'o2'},
  etco2high:{t:'etCO2 high', p:'med', f:'co2'},
  etco2low: {t:'etCO2 low', p:'med', f:'co2'},
  fglow:    {t:'Fresh gas low or leakage', p:'med'},
  nofg:     {t:'No fresh-gas flow', p:'hi'},
  o2fail:   {t:'O2 supply low', p:'hi'},
  addo2:    {t:'Add. O2 activated', p:'med'},
  mains:    {t:'Mains power failure', p:'med'},                       /* simulator's wording */
  battmed:  {t:'Battery low', p:'med'},                               /* simulator's wording */
  batthi:   {t:'Battery low', p:'hi'},                                /* simulator's wording */
  battdead: {t:'Battery empty', p:'hi'},                              /* simulator's wording */
  /* raised by the shared engine for other machines; never by the A350 */
  discpat:  {t:'Disconnection', p:'hi'}, vlimit:{t:'Volume limited', p:'low'}, chkplim:{t:'Check Pmax', p:'low'}, plimchg:{t:'Pressure limit changed', p:'low'},
  losspeep: {t:'PEEP not achieved', p:'med'}, highpeep:{t:'PEEP high', p:'med'}, exobs:{t:'Expiration obstructed', p:'hi'},
  vtlow:{t:'VT low', p:'med'}, vthigh:{t:'VT high', p:'med'}, fhigh:{t:'RR high', p:'med'}, flow:{t:'RR low', p:'med'},
  lowo2:{t:'FiO2 low', p:'hi'}, higho2:{t:'FiO2 high', p:'med'}, irv:{t:'IRV', p:'low'}, maxleak:{t:'Leakage', p:'low'}, asvtarget:{t:'Target not met', p:'low'}, cpron:{t:'CPR', p:'low'}
};
/* troubleshooting help (Education mode): the simulator's summary of what to check, not Dräger's text */
const HELP = {
  phigh:'<ul><li>The airway pressure reached the Paw high limit: inspiration ends there.</li><li>Look at the patient (coughing, light anaesthesia, bronchospasm) and along the circuit and tube (kinked, blocked, endobronchial).</li><li>Hand-ventilate to feel the lungs if in doubt.</li></ul>',
  pcont:'<ul><li>The pressure in the breathing system is staying high between breaths.</li><li>In Man/Spon: is the APL valve closed down with the bag filling? Open the APL valve (Spont) or squeeze the excess out.</li><li>Check the expiratory limb and the scavenging.</li></ul>',
  plow:'<ul><li>The set pressure is not being reached: gas is escaping.</li><li>Check for a disconnection, a leak at the tube cuff or the circuit, and the fresh-gas flow.</li></ul>',
  plimit:'<ul><li>The breath was limited at Pmax: the set VT may not be delivered.</li><li>Find out why the pressure is high before raising Pmax.</li></ul>',
  apnea:'<ul><li>No breath (no CO2) has been detected.</li><li>In Man/Spon: is the patient breathing? Ventilate by hand or start a ventilator mode.</li><li>Ventilating and still no CO2: think disconnection, oesophageal intubation, or no cardiac output.</li></ul>',
  apnea2:'<ul><li>No breath (no CO2) for some time.</li><li>Ventilate the patient now. Ventilating and still no CO2: disconnection, oesophageal intubation or cardiac arrest.</li></ul>',
  mvlow:'<ul><li>Less gas is going in and out than the limit.</li><li>Check the patient, a leak or disconnection, and the settings.</li></ul>',
  mvhigh:'<ul><li>The minute volume is above the limit. Check the settings and the patient.</li></ul>',
  o2low:'<ul><li>The inspired O2 is below the limit.</li><li>Raise FG O2 and the fresh-gas flow. With N2O, the O2 in the circle falls at low flows.</li><li>Check the O2 supply.</li></ul>',
  o2high:'<ul><li>The inspired O2 is above the limit.</li></ul>',
  etco2high:'<ul><li>The end-tidal CO2 is above the limit.</li><li>Ventilate more. Think of rebreathing (exhausted soda lime), malignant hyperthermia, sepsis or a CO2 load.</li></ul>',
  etco2low:'<ul><li>The end-tidal CO2 is below the limit.</li><li>Think of over-ventilation, a leak, a falling cardiac output or an embolus.</li></ul>',
  fglow:'<ul><li>The breathing bag is running empty: there is not enough fresh gas for what is being lost.</li><li>Look for a leak or a disconnection. Raise the fresh-gas flow; O2+ refills the bag.</li></ul>',
  nofg:'<ul><li>No fresh gas is flowing. Set a FG flow.</li><li>If the mixer has failed, use Add. O2 and keep the patient asleep (TIVA if the vapour has stopped).</li></ul>',
  o2fail:'<ul><li>The O2 supply pressure is low (pipeline or cylinder).</li><li>Open the O2 cylinder, check the patient\'s SpO2, call for help (QRH 4-1).</li><li>Have a self-inflating bag and an O2 cylinder ready.</li></ul>',
  addo2:'<ul><li>The O2 switch is set to Add. O2: emergency O2 goes straight into the breathing system.</li><li>Set the switch back to Aux. O2 when it is no longer needed.</li></ul>',
  mains:'<ul><li>The machine is running on its battery. Check the mains plug and supply (QRH 4-2).</li></ul>',
  battmed:'<ul><li>The battery is low. Restore mains power.</li></ul>',
  batthi:'<ul><li>The battery is nearly empty. Restore mains power and prepare to ventilate by hand with a self-inflating bag and TIVA.</li></ul>',
  battdead:'<ul><li>The battery is empty: the ventilator has stopped. Ventilate by hand (Man/Spon still works with Add. O2) or with a self-inflating bag.</li></ul>'
};
const PRI_ORDER = {hi:3, med:2, low:1};
const PRI_MARK = {hi:'!!!', med:'!!', low:'!'};
const active = new Map();
const inactive = new Map();
const history = [];
function raise(id) {
  if (!active.has(id)) {
    active.set(id, clockStr());
    inactive.delete(id);
    logEvent(ALARMS[id].t, ALARMS[id].p);
  }
}
function clear(id) { if (active.has(id)) { inactive.set(id, active.get(id)); active.delete(id); lowBeeped.delete(id); } }
function logEvent(t, p) {
  ventReport(t, p);
  history.unshift({time: clockStr(), wall: wallClock(), t, p}); if (history.length > 60) history.pop();
  if (win === 'alarms') renderWindow();
}
let msgCycle = 0;
function topAlarms() {
  return [...active.keys()].map(id => ({id, ...ALARMS[id]})).sort((a, b) => PRI_ORDER[b.p] - PRI_ORDER[a.p]);
}
const PATIENT_ALARMS = ['phigh', 'pcont', 'plow', 'plimit', 'apnea', 'apnea2', 'apvent', 'mvlow', 'mvhigh', 'o2low', 'o2high', 'etco2high', 'etco2low', 'fglow', 'nofg'];
function evalAlarms() {
  if (!P || !V.power || V.selftest > 0) return;
  /* the gas supply: also in Standby */
  if (P.o2fail) raise('o2fail'); else clear('o2fail');
  if (V.o2sw === 'add' && V.auxO2 > 0) raise('addo2'); else clear('addo2');
  if (V.standby || V.ambient) { PATIENT_ALARMS.forEach(clear); G.apneaT = 0; return; }
  const L = V.lim, m = V.mode, fg = G.fg || freshGas(), dt = 0.25;
  /* no breath for 15 s: the measured rate and minute volume fall to zero (the shared engine only updates them on a breath) */
  if (B.now - B.lastStart > 15) { M.ftot = 0; M.mv = 0; }
  /* fresh gas */
  if (!(fg.total > 0)) raise('nofg'); else clear('nofg');
  G.fgLowT = G.bag < 0.15 ? G.fgLowT + dt : 0;
  if (G.fgLowT > 5) raise('fglow'); else if (G.bag > 0.5) clear('fglow');
  /* gas measurement */
  if (G.fio2 < L.o2low) raise('o2low'); else clear('o2low');
  if (L.o2high <= ALIM.o2high.max && G.fio2 > L.o2high) raise('o2high'); else clear('o2high');
  const et = etco2kPa();
  if (et !== null && et > 0.5) G.lastCO2 = B.now;
  const settled = B.now - V.caseStart > 45 && B.now - V.modeSince > 45;
  if (et !== null && L.etco2high <= ALIM.etco2high.max && et > L.etco2high) raise('etco2high'); else clear('etco2high');
  if (et !== null && L.etco2low > 0 && et > 0.5 && et < L.etco2low && settled) raise('etco2low'); else clear('etco2low');
  /* Apnea: no breath and no CO2 for the Apnea time (20 s, the simulator's); !! then !!! after another 30 s */
  const sinceBreath = B.now - Math.max(B.lastStart, V.caseStart), sinceCO2 = B.now - Math.max(G.lastCO2, V.caseStart, V.modeSince);
  const apnoeic = (m === 'MAN' && sinceBreath >= L.apnoea) || (sinceBreath >= L.apnoea && !V.backupOn) || sinceCO2 >= L.apnoea + 10;
  if (apnoeic) { G.apneaT += dt; if (G.apneaT > 30) { clear('apnea'); raise('apnea2'); } else raise('apnea'); }
  else { G.apneaT = 0; clear('apnea'); clear('apnea2'); }
  if (B.apnoeaVent) raise('apvent'); else clear('apvent');
  if (!V.backupOn) B.apnoeaVent = false;
  /* pressure */
  if (B.highPT) { B.highPT -= dt; if (B.highPT <= 0) { B.highPT = 0; clear('phigh'); } }
  const baseline = m === 'MAN' ? G.circP : (M.peep === null ? 0 : M.peep);
  const pcontLim = Math.max((V.set.peep || 0) + 10, 15);   /* the simulator's threshold */
  G.pcontT = baseline > pcontLim ? G.pcontT + dt : 0;
  if (G.pcontT > 15) raise('pcont'); else if (baseline < pcontLim - 2) clear('pcont');
  const mandatory = m !== 'MAN' && m !== 'SPONT';
  G.plowT = mandatory && M.ppeak !== null && M.ppeak < (V.set.peep || 0) + 4 ? G.plowT + dt : 0;
  if (G.plowT > 10) raise('plow'); else if (G.plowT === 0) clear('plow');
  /* minute volume: MV low not in the first 45 s of a case or after a mode change ([IFU2] p. 202) */
  if (M.mv !== null && settled && L.mvlow > 0 && M.mv < L.mvlow) raise('mvlow'); else clear('mvlow');
  if (M.mv !== null && L.mvhigh <= ALIM.mvhigh.max && M.mv > L.mvhigh) raise('mvhigh'); else clear('mvhigh');
}
function powerTick(dtReal) {
  if (P.mains) { P.batt = Math.min(100, P.batt + dtReal * 0.5); clear('mains'); clear('battmed'); clear('batthi'); clear('battdead'); return; }
  if (!V.power) return;
  raise('mains');
  P.batt = Math.max(0, P.batt - dtReal * 0.8);
  if (P.batt <= 0) { clear('batthi'); raise('battdead'); if (!V.ambient && !V.standby) { V.ambient = true; logEvent('Ventilator stopped: battery empty', 'hi'); } }
  else if (P.batt < 12) { clear('battmed'); raise('batthi'); }
  else if (P.batt < 30) raise('battmed');
}

