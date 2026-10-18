/* ======================= device definitions (anaesthetic machine) ======================= */
/* Ranges are the IFU's technical data ([IFU1] pp. 269-273; [PI] pp. 10-11). Start values are the factory
   configuration ([IFU2] pp. 216-219: VT 500 mL, RR 12, Pmax 40, Pinsp 15, ΔPsupp 10, Insp term 25%, PEEP 3,
   Slope 0.2 s, RRmin 6, I:E 1:2 (so Tinsp 1.7 s at RR 12), %Tplat 20, Trigger 4.0 L/min, FG O2 100%,
   FG flow 2.00 L/min). Step sizes are not in the IFU: the simulator's choice. Pressures are shown in cmH2O
   (the device can be set to hPa, mbar or cmH2O; 1 hPa is about 1 cmH2O). */
const IE_LIST = [1/9, 1/8, 1/7, 1/6, 1/5, 1/4, 1/3.5, 1/3, 1/2.5, 1/2, 1/1.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
const ieStr = r => { const t = v => String(+v.toFixed(1)); return r >= 1 ? t(r) + ':1' : '1:' + t(1 / r); };
const CTRL = {
  vt:    {label:'VT', unit:'mL', min:10, max:1500, step:v => v >= 100 ? 10 : 5, tip:'The tidal volume each mandatory breath delivers in the volume modes (VC and VC - AF).'},
  rate:  {label:'RR', unit:'/min', min:3, max:100, step:1, tip:'The number of mandatory breaths per minute.'},
  ti:    {label:'Tinsp', unit:'s', min:0.2, max:10, step:0.1, dp:1, tip:'How long each mandatory breath lasts. With RR it sets the I:E ratio, shown under the controls.'},
  pinsp: {label:'Pinsp', unit:'cmH2O', min:5, max:80, step:1, tip:'The airway pressure each pressure-controlled breath reaches. On this machine this is the total pressure, not the pressure above PEEP.'},
  pmax:  {label:'Pmax', unit:'cmH2O', min:10, max:80, step:1, tip:'The highest pressure a volume-controlled breath may reach. If the set volume needs more, the breath is limited at Pmax and "Tidal volume not achieved" can appear.'},
  peep:  {label:'PEEP', unit:'cmH2O', min:2, max:35, step:1, off0:true, tip:'The pressure kept in the lungs at the end of breathing out. In PSV it is labelled CPAP.'},
  ps:    {label:'ΔPsupp', unit:'cmH2O', min:3, max:80, step:1, off0:true, tip:'Pressure support above PEEP for the breaths the patient triggers (in SIMV and PSV). Off means no support.'},
  trig:  {label:'Trigger', unit:'L/min', min:0.3, max:15, step:v => v >= 1 ? 0.5 : 0.1, dp:1, tip:'How much inspiratory flow the patient has to make to trigger a breath. A lower number is more sensitive.'},
  ets:   {label:'Insp term', unit:'%', min:5, max:80, step:5, tip:'A supported breath ends when the inspiratory flow has fallen to this percentage of its peak.'},
  pramp: {label:'Slope', unit:'s', min:0, max:2, step:0.1, dp:1, tip:'How quickly the pressure rises at the start of a pressure breath, in seconds.'},
  pause: {label:'%Tplat', unit:'%', min:0, max:60, step:5, tip:'The part of each volume-controlled breath held as a plateau with no flow, so the plateau pressure (Pplat) can be read.'},
  rrmin: {label:'RRmin', unit:'/min', min:3, max:25, step:1, off0:true, tip:'The minimum breathing rate in PSV. If the patient breathes more slowly, the machine gives pressure-controlled breaths at this rate (Apnea Ventilation).'},
  o2:    {label:'FG O2', unit:'%', min:21, max:100, step:1, tip:'The oxygen concentration of the fresh gas from the mixer. With N2O as the carrier gas it cannot be set below 25%.'},
  fgf:   {label:'FG flow', unit:'L/min', min:0.2, max:15, step:v => v >= 2 ? 0.5 : 0.1, dp:2, off0:true, tip:'The total fresh-gas flow into the breathing system. At low flows the patient rebreathes their own gas, so the inspired oxygen and agent change slowly.'},
  carrier:{label:'Carrier gas', unit:'', list:[0, 1], names:['Air', 'N2O'], tip:'The gas mixed with the oxygen in the fresh gas: Air or nitrous oxide (N2O).'},
  height:{label:'Height', unit:'cm', min:30, max:250, step:1, tip:"The patient's height, used for the ideal body weight."},
  age:   {label:'Age', unit:'years', min:1, max:110, step:1, tip:"The patient's age, used to age-correct the MAC values (xMAC)."}
};
/* ranges that depend on other settings ([IFU1] p. 270: Pinsp PEEP+5 to 80, Pmax PEEP+10 to 80, ΔPsupp up to
   80 - PEEP; [PI]: FG O2 at least 25% with N2O) */
function ctrlDef(key, mk, src) {
  const d = CTRL[key], s = src || V.set;
  if (!d) return d;
  if (key === 'pinsp') return {...d, min:Math.max(d.min, (s.peep || 0) + 5)};
  if (key === 'pmax') return {...d, min:Math.max(d.min, (s.peep || 0) + 10)};
  if (key === 'ps') return {...d, max:80 - (s.peep || 0)};
  if (key === 'o2') return {...d, min:s.carrier === 1 ? 25 : 21};
  return d;
}
/* alarm limits ([IFU2] pp. 211-212 and 216). MV limits start at VT x RR x (1 ± 40%), at least 2.0 / 0.3 L/min,
   and MV high starts Off ([IFU2] p. 202). The Apnea time is not a setting here: 20 s is the simulator's. */
const mvStep = (v, dir) => (dir > 0 ? v : v - 0.001) >= 10 ? 1 : (dir > 0 ? v : v - 0.001) >= 1 ? 0.5 : 0.1;
const vtStep = (v, dir) => (dir > 0 ? v : v - 0.001) >= 500 ? 50 : (dir > 0 ? v : v - 0.001) >= 100 ? 10 : 5;
const ALIM = {
  phigh:    {label:'Paw', unit:'cmH2O', min:5, max:99, step:1, tip:'Upper airway pressure alarm limit. A ventilator breath that reaches it is cut short and "Airway pressure high" sounds.'},
  mvhigh:   {label:'MV', unit:'L/min', min:0.1, max:40, step:mvStep, dp:1, offMax:true, tip:'Upper minute volume alarm limit (Off at the start of a case).'},
  mvlow:    {label:'MV', unit:'L/min', min:0.1, max:40, step:mvStep, dp:1, off0:true, tip:'Lower minute volume alarm limit, set from VT x RR - 40% when ventilation starts. Not active in the first 45 s after starting or changing mode.'},
  o2high:   {label:'FiO2', unit:'%', min:19, max:99, step:1, offMax:true, tip:'Upper inspired oxygen alarm limit.'},
  o2low:    {label:'FiO2', unit:'%', min:18, max:98, step:1, tip:'Lower inspired oxygen alarm limit (factory setting 20%).'},
  etco2high:{label:'etCO2', unit:'kPa', min:0.1, max:9.8, step:0.1, dp:1, offMax:true, tip:'Upper end-tidal CO2 alarm limit.'},
  etco2low: {label:'etCO2', unit:'kPa', min:0.1, max:9.7, step:0.1, dp:1, off0:true, tip:'Lower end-tidal CO2 alarm limit.'},
  /* not shown on the anaesthetic machine: the shared engine reads them (unset, so they never alarm) */
  vthigh:   {label:'VT', unit:'mL', min:10, max:3000, step:vtStep, offMax:true, hidden:true},
  vtlow:    {label:'VT', unit:'mL', min:10, max:3000, step:vtStep, off0:true, hidden:true}
};
const LIM_ROWS = [['phigh', null], ['mvhigh', 'mvlow'], ['o2high', 'o2low'], ['etco2high', 'etco2low']];
/* Therapy bar per mode ([IFU1] pp. 300-301, a table the text extractor scrambled: approximate). basic: the
   therapy controls always shown; more: those the expand ("More") button adds. The fresh-gas controls (FG)
   sit at the right of the therapy bar in every mode. */
const FG = ['carrier', 'o2', 'fgf'];
const MODE_CTRLS = {
  'MAN':    {basic:[], more:[]},
  'APVcmv': {basic:['vt','rate','ti','peep'], more:['pramp']},
  'APVsimv':{basic:['vt','rate','ti','peep'], more:['ps','pramp','trig','ets']},
  'SCMV':   {basic:['vt','rate','ti','pmax','peep'], more:['pause']},
  'SIMV':   {basic:['vt','rate','ti','pmax','peep'], more:['ps','pause','pramp','trig','ets']},
  'PCV+':   {basic:['pinsp','rate','ti','peep'], more:['pramp']},
  'PSIMV+': {basic:['pinsp','rate','ti','peep'], more:['ps','pramp','trig','ets']},
  'SPONT':  {basic:['peep','ps','trig','rrmin'], more:['pinsp','pramp','ets']}
};
const TOGGLES = {};
/* the facilitator's remote control can set any therapy control, the fresh gas included */
function modeCtrls(mk) {
  const c = MODE_CTRLS[mk] || MODE_CTRLS.MAN;
  return {basic:c.basic.concat(FG), more:c.more, vent:c.basic};
}
/* the mode tabs ([IFU2] p. 150) and the SIMV/CMV buttons: each tab and synchronisation is one engine mode */
const TABS = [['MAN', 'Man/Spon'], ['AF', 'VC - AF'], ['VC', 'VC'], ['PC', 'PC'], ['PSV', 'PSV']];
const TAB_MODES = {MAN:{cmv:'MAN'}, AF:{cmv:'APVcmv', simv:'APVsimv'}, VC:{cmv:'SCMV', simv:'SIMV'}, PC:{cmv:'PCV+', simv:'PSIMV+'}, PSV:{cmv:'SPONT'}};
const tabOf = m => Object.keys(TAB_MODES).find(t => TAB_MODES[t].cmv === m || TAB_MODES[t].simv === m) || 'MAN';
const syncOf = m => ['APVsimv', 'SIMV', 'PSIMV+'].includes(m) ? 'simv' : 'cmv';
const MODE_GROUPS = [];
/* what each tab, SIMV/CMV and More do, for the hover hints and the Education guide (the simulator's summaries) */
const TAB_TIP = {
  MAN:'Man/Spon: no ventilator breaths. Ventilate by squeezing the bag (the APL valve sets the pressure limit), or let the patient breathe spontaneously with the APL valve at Spont.',
  AF:'VC - AF, volume control with AutoFlow: the set VT every breath, delivered with the lowest pressure that achieves it (a decelerating flow).',
  VC:'VC, volume control: the set VT every breath with a constant flow and a plateau. The pressure depends on the lungs; Pmax limits it.',
  PC:'PC, pressure control: every breath rises to Pinsp for Tinsp. The volume depends on the lungs, so watch VT.',
  PSV:'PSV, pressure support: the patient triggers every breath and gets ΔPsupp above PEEP (CPAP when ΔPsupp is Off). RRmin gives backup breaths if they breathe too slowly.'
};
const SYNC_TIP = {
  simv:'SIMV: mandatory breaths at the set RR, timed with the patient\'s own efforts. Breaths the patient takes in between get the pressure support (ΔPsupp, under More).',
  cmv:'CMV: every breath is a mandatory breath at the set RR. In this simulator the patient cannot trigger extra breaths in CMV.'
};
const MODE_EXPLAIN = {MAN:TAB_TIP.MAN, APVcmv:TAB_TIP.AF, APVsimv:TAB_TIP.AF + ' ' + SYNC_TIP.simv, SCMV:TAB_TIP.VC, SIMV:TAB_TIP.VC + ' ' + SYNC_TIP.simv,
  'PCV+':TAB_TIP.PC, 'PSIMV+':TAB_TIP.PC + ' ' + SYNC_TIP.simv, SPONT:TAB_TIP.PSV};
/* the full mode names ([IFU1] pp. 298-301; [PI] p. 11) */
const MODE_NAME = {MAN:'Man/Spon', APVcmv:'VC-CMV/AutoFlow', APVsimv:'VC-SIMV/AutoFlow', SCMV:'VC-CMV', SIMV:'VC-SIMV', 'PCV+':'PC-CMV', 'PSIMV+':'PC-SIMV', SPONT:'CPAP/PSV'};
const VCM = ['SCMV', 'SIMV'];
const CMV_MODES = ['SCMV', 'APVcmv', 'PCV+'];
const isVC = m => VCM.includes(m === undefined ? V.mode : m);
const mName = (m, src) => { const s = src || V.set, n = MODE_NAME[m] || m; return ['SIMV', 'APVsimv', 'PSIMV+'].includes(m) && s.ps > 0 ? n.replace('SIMV', 'SIMV/PS') : n; };
const APV = ['APVcmv', 'APVsimv'];
const NIVMODES = [];
/* the modes a face mask suits (an awake patient with no airway): Man/Spon and CPAP/PSV; the others expect a tube or SGA */
const MASK_MODES = ['MAN', 'SPONT'];
const INVASIVE = ['MAN', 'SCMV', 'SIMV', 'APVcmv', 'APVsimv', 'PCV+', 'PSIMV+', 'SPONT'];
const BACKUP_MODES = ['MAN', 'SPONT'];   /* Apnea in Man/Spon; RRmin backup in PSV */
const SIGH_MODES = [];
const isNIV = () => false;
const isHFO = () => false;
const isInvasive = m => INVASIVE.includes(m === undefined ? V.mode : m);
const modeKey = () => V.mode;
const modeLabel = () => mName(V.mode);
const isSIMV = () => ['SIMV', 'APVsimv', 'PSIMV+'].includes(V.mode);

const DEFAULT_SET = {vt:500, rate:12, ti:1.7, pinsp:15, pmax:40, peep:3, ps:10, trig:4, ets:25, pramp:0.2, pause:20, rrmin:6,
  o2:100, fgf:2, carrier:0, height:170, age:40,
  /* the shared engine's own keys for modes the anaesthetic machine does not have */
  ie:0.5, pcontrol:15, minvol:100, hflow:15, plim:30, timax:1.5, phi:20, thigh:1, aphi:20, plo:5, athigh:5.4, tlow:0.6};
const DEFAULT_LIM = {phigh:40, mvhigh:99999, mvlow:3.6, o2high:99999, o2low:20, etco2high:7.0, etco2low:0, apnoea:20};
const O2_BAND = 5;
const O2_ENRICH_S = 120;
const AUDIO_PAUSE_S = 120;   /* the alarm silence key mutes for 2 min ([IFU1]) */
const NEB_MIN = 30;
const EDIT_TIMEOUT_S = 15;   /* an unconfirmed change resets after 15 s, with tones in the last 5 s ([IFU1] pp. 84-85) */

/* the machine's state (the ventilator's settings are V.set) */
const V = {
  power:false, selftest:0, standby:true, ambient:false, mode:'MAN', set:{...DEFAULT_SET}, lim:{...DEFAULT_LIM},
  backupOn:false, sigh:false, psync:false, cpr:null, aprvInit:false, sex:'Male', locked:false, night:false, o2Enrich:0, audioPause:0, manualReq:false, neb:0,
  standbySince:0, startSuppress:0, gfx:'wave', spo2On:false, sound:false, loud:5,
  tests:{sys:null, leak:null}, testRun:null,
  /* the breathing system and gas supply around the ventilator */
  apl:30, vap:0, o2sw:'aux', auxO2:0, light:false, more:false, caseStart:0, modeSince:0
};
/* the gas in the machine and the circle (gasTick), and the hardware's moment-to-moment state */
const G = {fio2:21, fin2o:0, etn2o:0, fiag:0, etag:0, bag:2.0, circP:0, flush:false, squeeze:null, ySealed:false, fg:null,
  lastCO2:0, fgLowT:0, pcontT:0, plowT:0, apneaT:0,
  /* hands-free bagging (the simulator's, not Dräger's): squeezes the bag by itself at a set rate until it is stopped */
  autoBag:false, bagRate:12, abSq:false, abLast:-1e9};
let E = null;          // current edit {scope:'ctrl'|'lim'|'draft', key, val, t0}
let D = null;          // a new mode, shown in the therapy bar until it is confirmed {mode, set}
let win = null;        // open dialog: 'start' | 'alarms' | 'tests' | 'setup' | 'info'
let winTab = '';
let cursor = -1;       // knob cursor index over [data-kf] elements
let helpFor = null;    // alarm id whose troubleshooting help is shown

/* ======================= the machine's gas: fresh gas, the circle, the bag and the vaporiser ======================= */
/* A teaching model, not Dräger's. The IFU gives: O2+ 25-75 L/min bypassing the vaporisers; Add. O2 up to at least
   10 L/min; FG flow Off or 0.2-15 L/min; MAC at 40 years (sevoflurane 2.1%, N2O 105%) with the Mapleson age
   correction ([IFU2] p. 169). The rest are the simulator's values. */
const VO2 = 0.25;          /* L/min of oxygen the patient takes up */
const BAG_L = 3;           /* the breathing bag */
const BAG_SQUEEZE = 35;    /* cmH2O: the most a firm squeeze of the bag reaches */
const SYS_L = 6;           /* L of gas the fresh gas has to wash through: circle, absorber and lungs */
const FLUSH_LPM = 50;      /* O2+ */
const MAC40 = {sev:2.1, n2o:105};
const macAge = (mac40, age) => mac40 * Math.pow(10, -0.00269 * (age - 40));
const patientAge = () => clamp(Number(V.set.age) || 40, 1, 110);
/* the fresh gas leaving the machine now: total L/min and its O2, N2O and agent (all %) */
function freshGas() {
  const on = V.power && !V.standby && V.selftest <= 0;
  const n2o = V.set.carrier === 1, o2ok = !(P && P.o2fail);
  let f = on ? (V.set.fgf || 0) : 0, o2 = V.set.o2;
  /* no O2 supply: the mixer cannot add O2; with N2O it stops altogether (simulator's reading of the hypoxic guard) */
  if (!o2ok) { if (n2o) f = 0; else o2 = 21; }
  /* O2+ and Add. O2 are pneumatic: they work in Standby and switched off ([PI]: emergency Man/Spon) */
  const extra = o2ok ? (G.flush ? FLUSH_LPM : 0) + (V.o2sw === 'add' ? V.auxO2 : 0) : 0;
  const total = f + extra;
  if (total <= 0) return {total:0, mixer:0, o2:21, n2o:0, ag:0};
  return {total, mixer:f, o2:(f * o2 / 100 + extra) / total * 100, n2o:n2o ? f * (100 - o2) / total : 0, ag:f > 0 ? V.vap * f / total : 0};
}
/* the APL valve works on the bag in Man/Spon and Standby; in the ventilator modes excess gas leaves through the
   ventilator's own exhaust (simulator's reading) */
const aplActive = () => V.mode === 'MAN' || V.standby || !V.power;
/* the pressure a squeeze of the bag reaches above the circuit's: up to the APL setting, nothing with the valve open */
function bagDP() {
  if (V.apl <= 0) return 0.5;
  return Math.max(0, Math.min(V.apl, BAG_SQUEEZE) - baseP());
}
/* the Y-piece on the circuit plug: a sealed breathing system, a few millilitres per cmH2O (the system test) */
function sealedLung() { return {...P.base, C:0.004, R:4, tau:0.016, effort:0, sedated:true, vtBase:0.005}; }
function gasTick(dt) {
  if (!P) return;
  const fg = freshGas(); G.fg = fg;
  const conn = !P.disc && !G.ySealed;
  const breathing = V.power && !V.standby && B.now - B.lastStart < 12;
  /* uptake from the circle only while the machine is in use: off or in Standby the mask is not on the face yet */
  const vo2 = conn && V.power && !V.standby && (breathing || !P.pr.sedated) ? VO2 : 0;
  const tau = 60 * SYS_L / Math.max(fg.total, 0.3), k = 1 - Math.exp(-dt / Math.min(tau, 1200));
  /* oxygen: the patient's uptake lowers the inspired O2 at low flows, Fi = (FGF x FO2 - VO2) / (FGF - VO2) */
  if (fg.total > 0 || vo2 > 0) {
    /* a flow below the uptake empties the bag (the "fresh gas low" alarm) but cannot make pure O2 hypoxic;
       with no fresh gas at all, rebreathing uses the oxygen up */
    let o2T = fg.total > vo2 + 0.05 ? (fg.total * fg.o2 / 100 - vo2) / (fg.total - vo2) * 100 : fg.total > 0 ? fg.o2 : 10;
    o2T = clamp(o2T, 5, 100);
    G.fio2 += (o2T - G.fio2) * k;
    const n2oT = fg.total > vo2 + 0.05 ? Math.min(100 - o2T, fg.n2o * fg.total / (fg.total - vo2)) : G.fin2o;
    G.fin2o += (n2oT - G.fin2o) * k;
    /* the agent: below the minute volume the patient rebreathes exhaled gas, so Fi lies between the fresh gas and Et */
    const fresh = clamp(fg.total / Math.max(1, M.mv || 0), 0, 1);
    G.fiag += (fg.ag * fresh + G.etag * (1 - fresh) - G.fiag) * k;
  }
  /* uptake: end-tidal follows inspired within a minute or so while the lungs are ventilated, settling at Et/Fi
     about 0.85 (a simplification of the uptake curve: the slow later rise is left out) */
  if (conn && breathing) {
    const ke = 1 - Math.exp(-dt / 40);
    G.etag += (G.fiag * 0.85 - G.etag) * ke; G.etn2o += (G.fin2o * 0.9 - G.etn2o) * ke;
  }
  /* the bag: fresh gas fills it; the patient's uptake and any leak empty it */
  const setMV = V.set.vt / 1000 * V.set.rate;
  const leak = (P.disc ? (V.mode === 'MAN' || V.standby ? fg.total + 2 : Math.max(fg.total, setMV)) : 0) + (P.circLeak ? 3 : 0)
    + (V.mode === 'MAN' && P.fit !== 'good' ? (P.fit === 'large' ? 15 : 5) : 0);
  G.bag = clamp(G.bag + (fg.total - vo2 - leak) * dt / 60, 0, BAG_L + 2);
  /* a squeeze of the bag in Man/Spon pushes the excess out through the APL valve, so the bag cannot stay overfull
     while someone is hand-ventilating */
  if (G.squeeze !== null && V.mode === 'MAN' && V.power && !V.standby) G.bag = Math.min(G.bag, BAG_L);
  /* an over-full bag: the pressure rises (40 cmH2O per extra litre) until the APL valve (or the exhaust) vents it */
  const vent = aplActive() ? (V.apl <= 0 ? 0.5 : V.apl) : 0.5;
  let p = G.bag > BAG_L ? (G.bag - BAG_L) * 40 : 0;
  if (p > vent) { p = vent; G.bag = BAG_L + vent / 40; }
  G.circP = p;
}
/* the capnogram: CO2 rises to end-tidal through expiration and falls to the inspired CO2 (0 here) on inspiration */
function co2Now() {
  const et = etco2kPa();
  if (et === null || !B.br) return 0;
  if (B.phase === 'insp') return Math.max(0, (B.co2Last || 0) * Math.exp(-B.t / 0.08));
  const v = et * (1 - Math.exp(-Math.max(0, B.t - 0.15) / 0.18)) * (1 + 0.03 * Math.min(1, B.t / 2));
  B.co2Last = v;
  return v;
}
/* etCO2 in kPa while gas moves through the circuit and the gas module sees it (null when there is nothing to measure) */
function etco2kPa() {
  if (!V.power || V.standby || V.selftest > 0 || LIVE.etco2 === null || G.ySealed || P.disc) return null;
  return LIVE.etco2;
}
function xMAC() {
  const age = patientAge();
  return G.etag / macAge(MAC40.sev, age) + G.etn2o / macAge(MAC40.n2o, age);
}

