// =================================================================================================
// THE DRÄGER ATLAN A350 PAGE  (node scripts/make-a350.mjs  ->  vent/a350.html)
//
// The Atlan A350 anaesthetic machine (Anaesthetics / ICU on the start screen) is generated from the
// HAMILTON-C6 page (vent/c6.html, itself generated from vent/index.html), so all three machines share
// ONE breath engine, patient model and simulator link layer. Edit vent/index.html (or the C6 generator),
// run scripts/make-c6.mjs, then this script; never edit vent/a350.html by hand.
// tests/specs/a350.spec.js fails if vent/a350.html is out of date.
//
// What is Dräger's and what is the simulator's. Sources (read 11 Oct 2026):
//   [IFU1]  Atlan A300/A300 XL/A350/A350 XL Instructions for Use, SW 1.0n, Edition 2 (English; read
//           through a text extractor, so tables were checked against [IFU2] where possible)
//   [IFU2]  Atlan A100/A300/A350 (XL) Instructions for Use, SW 2.1n, Edition 2 (Romanian; translated here)
//   [PI]    Atlan A350/A350 XL product information, 91 07 088 (English)
// Taken from them: the screen's four areas (header bar, main menu bar, monitoring area, therapy bar), the
// mode tabs (Man/Spon, VC - AF, VC, PC, PSV) and SIMV/CMV, the setting names, ranges and factory start
// values, touch-a-control / turn / press-the-knob-to-confirm with the 15 s reset, the control colours
// (dark green active, yellow selected, light green available, grey unavailable), the electronic mixer
// (FG O2, FG flow, carrier Air or N2O; 25% O2 minimum with N2O), O2+, Aux. O2 / Add. O2, the APL valve
// (Spont = open, Man 5-70), the alarm priorities (!!! red, !! yellow, ! cyan) and the alarm texts below,
// the factory alarm limits, the xMAC calculation (MAC values and the Mapleson age correction), the
// Standby page, the Start dialog, Quick start Man/Spon, and the system test and leak test.
// The simulator's own choices (marked where they are made): the exact positions, sizes and colours (the
// IFU gives no layout drawing values or RGB colours), the machine's hardware arrangement, step sizes,
// the gas model (inspired O2 at low flow, agent uptake, the bag and APL), alarm thresholds and delays the
// IFU does not give, some alarm wording, and the condensed test sequences.
// It is a training recreation, not Dräger software, and is not endorsed by Drägerwerk AG.
// =================================================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'vent', 'c6.html');
const OUT = path.join(ROOT, 'vent', 'a350.html');

let html = fs.readFileSync(SRC, 'utf8');
const fail = (msg) => { console.error('[make-a350] FAILED: ' + msg); process.exit(1); };
const sub = (from, to, count = 1) => {
    const n = html.split(from).length - 1;
    if (n !== count) fail(`expected ${count} of: ${from.slice(0, 90)} (found ${n})`);
    html = html.split(from).join(to);
};
const between = (a, b, to) => {
    const i = html.indexOf(a), j = html.indexOf(b, i + 1);
    if (i < 0 || j < 0) fail(`markers not found: ${a.slice(0, 60)} / ${b.slice(0, 60)}`);
    const li = html.lastIndexOf('\n', i) + 1, lj = html.lastIndexOf('\n', j) + 1;
    html = html.slice(0, li) + to + html.slice(lj);
};
const read = (f) => fs.readFileSync(path.join(ROOT, 'scripts', 'a350', f), 'utf8');

// ---- page head ---------------------------------------------------------------------------------
sub('<title>EM Evidence — ICU Ventilator Simulator</title>', '<title>EM Evidence — Anaesthetic Machine Simulator</title>');
sub(`  GENERATED FILE: made from vent/index.html by scripts/make-c6.mjs. Do not edit; edit the T1 page and rerun.
  THE HAMILTON-C6 ICU VENTILATOR, AS A SIMULATION DEVICE. It shares the HAMILTON-T1 page's breath engine.`,
`  GENERATED FILE: made from vent/c6.html by scripts/make-a350.mjs (parts in scripts/a350/). Do not edit;
  edit vent/index.html or the generators and rerun scripts/make-c6.mjs, then scripts/make-a350.mjs.
  THE DRÄGER ATLAN A350 ANAESTHETIC MACHINE, AS A SIMULATION DEVICE. It shares the HAMILTON-T1 page's breath
  engine; the machine, its screen and its gas are this generator's (see the notes in scripts/make-a350.mjs).
  It is a training recreation, not Dräger software, and is not endorsed by Drägerwerk AG.`);
sub('<span class="title">HAMILTON-C6</span>', '<span class="title">Atlan A350</span>');

// ---- styles and markup: the machine and its screen (scripts/a350/style.css, markup.html) -----------
between('/* ===== Simulator: the HAMILTON-C6 monitor', '/* below-device controls', read('style.css'));
between('        <div class="t1-wrap" id="device">', '        <div class="under" aria-label="Knob controls">', read('markup.html'));

// ---- device definitions: the A350's modes, settings, limits and state (scripts/a350/defs.js) ---------
between('/* ======================= device definitions', '/* ======================= patient profiles', read('defs.js'));

// ---- the breath engine: Man/Spon and the bag, Dräger's Pinsp (absolute), Pmax, Tinsp, Slope ---------
between('/* Apnea backup: NIV backs up with PCV+', '/* timing of mandatory breaths', `/* PSV: with RRmin set, mandatory pressure-controlled breaths at RRmin when the patient breathes too slowly
   (the IFU names RRmin; how the backup breaths are shaped is the simulator's choice: Pinsp, Tinsp 1 s) */
function backupSet() {
  return {mode:'PCV+', dp:Math.max(5, V.set.pinsp - (V.set.peep || 0)), rate:Math.max(3, V.set.rrmin || 6), ti:1.0};
}
`);
sub("function baseP() { return V.mode === 'APRV' ? V.set.plo : V.set.peep; }",
    "function baseP() { return V.mode === 'MAN' ? G.circP : (V.set.peep || 0); }   /* Man/Spon: whatever pressure the bag and APL valve hold */");
sub("  if (m === 'APVcmv' || m === 'PCV+' || m === 'SCMV') { const c = 60 / s.rate; return {cycle:c, ti:c * s.ie / (1 + s.ie)}; }",
    "  if (m === 'APVcmv' || m === 'PCV+' || m === 'SCMV') { const c = 60 / s.rate; return {cycle:c, ti:Math.min(s.ti, c * 0.8)}; }   /* A350: Tinsp is set (I:E up to 4:1) */");
sub("  if (m === 'PCV+') return s.pcontrol;\n  if (m === 'PSIMV+') return V.psync ? s.pinsp : s.pcontrol;",
    "  if (m === 'PCV+' || m === 'PSIMV+') return Math.max(0, s.pinsp - (s.peep || 0));   /* Dräger's Pinsp is the total pressure, not above PEEP */");
between('function measuredO2() {', 'function pushLog', `/* the inspired O2 the A350's gas module measures (the circle and fresh-gas model, gasTick) */
function measuredO2() { return G.fio2; }
`);
sub("  if (pc && isVC(m) && !B.apnoeaVent && mt) { startVCBreath(kind, auto, sigh, mt, base); return; }",
    "  B.vcLim = 0; B.vcLimVt = 0;\n  if (pc && isVC(m) && !B.apnoeaVent && mt && startVCBreath(kind, auto, sigh, mt, base)) return;");
sub("  let dP = kind === 'spont' ? spontDP() : (kind === 'manual' && !mt) ? Math.max(spontDP(), 10) : mandDP();",
    "  let dP = kind === 'spont' ? spontDP() : (kind === 'manual' && !mt) ? bagDP() : B.vcLim > 0 ? B.vcLim : mandDP();");
sub("  const lim = V.lim.phigh - (sigh ? 3 : 10);\n  const limited = base + dP > lim + 0.01;",
    "  const lim = kind === 'manual' && !mt ? 999 : V.lim.phigh;   /* the bag is limited by the APL valve, the ventilator by Paw high */\n  const limited = base + dP > lim + 0.01 || B.vcLim > 0;");
sub("  if (pc) Ti = kind === 'manual' && !mt ? 1.0 : mt.ti;", "  if (pc) Ti = kind === 'manual' && !mt ? 3.0 : mt.ti;   /* a squeeze lasts until the bag is let go (at most 3 s) */");
sub("  if (P.kink) VT *= 0.7;\n  VT = Math.max(0.005, VT * rnd(0.95, 1.05));",
    "  if (P.kink) VT *= 0.7;\n  if (B.vcLimVt > 0) VT = Math.min(VT, B.vcLimVt);\n  if (kind === 'manual' && !mt) VT = Math.min(VT, Math.max(0.005, G.bag));   /* an empty bag has nothing to give */\n  VT = Math.max(0.005, VT * rnd(0.95, 1.05));");
sub("pramp: Math.min(s.pramp / 1000, Ti / 3)", "pramp: Math.min(kind === 'manual' ? 0.25 : s.pramp, Ti / 3)");
sub(`  else {
    const room = (V.lim.phigh - peepM - iPeep - R * F) * C;
    if (VT > room) { VT = Math.max(0.005, room); hiP = true; tFlow = Math.max(0.05, VT / F); Ti = tFlow + 0.02; }
  }`, `  else {
    /* Pmax: when the volume would need more pressure, the breath is pressure-limited at Pmax for the rest of
       inspiration (IFU: Pmax is the pressure limitation in VC; the decelerating-flow shape is the simulator's) */
    const pmax = Math.min(V.set.pmax, V.lim.phigh);
    if (peepM + iPeep + VT / C + R * F > pmax + 0.01) { B.vcLim = Math.max(0, pmax - base); B.vcLimVt = VT; return false; }
  }`);
sub(`  if (peepM < base - 3) B.lowPeepBr = (B.lowPeepBr || 0) + 1; else B.lowPeepBr = 0;
}
/* a spontaneous breath taken on top of a pressure level`, `  if (peepM < base - 3) B.lowPeepBr = (B.lowPeepBr || 0) + 1; else B.lowPeepBr = 0;
  return true;
}
/* a spontaneous breath taken on top of a pressure level`);
sub("  M.ppeak = Math.max(br.maxP, br.peepM);", "  M.ppeak = Math.max(br.maxP, br.peepM);\n  if (M.ppeak >= V.lim.phigh - 0.01 && !(br.kind === 'manual' && V.mode === 'MAN')) { raise('phigh'); B.highPT = 3; }");
sub("  if (M.ppeak < V.lim.plow) raise('plow'); else clear('plow');\n", '');
sub("  if (isInvasive(m) && !V.cpr && V.o2Enrich <= 0 && M.vti > 50 && M.vte < M.vti / 8) raise('discpat'); else clear('discpat');   /* suppressed during O2 enrichment (10.4) */\n", '');
sub("  if (B.vlimit) raise('vlimit'); else clear('vlimit');\n", '');
sub("  const triggered = !V.cpr && V.set.trig > 0 && effort >= V.set.trig;",
    "  /* Man/Spon: every breath the patient takes is their own; CMV modes are not patient-triggered on the A350 (simulator's reading of SIMV/CMV) */\n  const triggered = m === 'MAN' ? effort > 0 : !V.cpr && !CMV_MODES.includes(m) && V.set.trig > 0 && effort >= V.set.trig;");
sub("    if (B.phase === 'exp' && BACKUP_MODES.includes(m) && !V.cpr && !B.apnoeaVent && B.now - B.lastStart >= V.lim.apnoea) {",
    "    if (B.phase === 'exp' && BACKUP_MODES.includes(m) && !V.cpr && !B.apnoeaVent && B.now - B.lastStart >= (V.backupOn ? 60 / backupSet().rate : V.lim.apnoea)) {");
sub("      if (V.backupOn) { B.apnoeaVent = true; B.consecTrig = 0; raise('apvent'); startBreath('mand'); }\n      else raise('apnea');",
    "      if (V.backupOn) { B.apnoeaVent = true; B.consecTrig = 0; raise('apvent'); startBreath('mand'); }   /* Apnea itself: evalAlarms (no breath and no CO2) */");
sub("    if (B.phase === 'exp' && B.t > 0.4 && !V.cpr && s.trig > 0 && m !== 'APRV' && m !== 'DuoPAP') {",
    "    if (B.phase === 'exp' && B.t > 0.4 && !V.cpr && s.trig > 0 && m !== 'MAN' && !CMV_MODES.includes(m)) {");
sub("  return [p, f, v];", "  if (V.mode === 'MAN' && B.phase !== 'insp') p = Math.max(p, G.circP);   /* a bag held full by the APL valve */\n  return [p, f, v];");
// the capnogram: a CO2 sample beside each pressure, flow and volume sample
sub("const bufP = new Float32Array(NBUF),", "const bufC = new Float32Array(NBUF), bufP = new Float32Array(NBUF),");
sub("  bufP[bufIdx] = p; bufF[bufIdx] = f;", "  bufC[bufIdx] = co2Now(); bufP[bufIdx] = p; bufF[bufIdx] = f;");

// ---- alarms: Dräger's texts and priorities, and the machine's own (scripts/a350/alarms.js) ---------
between('/* ======================= alarms ======================= */', '/* ======================= screen: scaling', read('alarms.js'));

// ---- scaling and waveforms (Paw, Flow, CO2) ----------------------------------------------------
sub('const DEV_W = 1360, DEV_H = 1000;', 'const DEV_W = 1500, DEV_H = 900;');
between('function fitDevice() {', 'new ResizeObserver(fitDevice)', read('fit.js'));   /* the stacked layout on a tall screen, and 44 px touch targets */
sub('const GW = 860, GH = 178;', 'const GW = 760, GH = 176;');
between('function waveOpts() {', '/* trend of one value per simulated minute', read('waves.js'));

// ---- the screen, the dialogs and editing (scripts/a350/screen.js, input.js); the hardware, the hover hints and
//      the Education guide (hardware.js, guide.js) ------------------------------------------------------
between('/* ======================= screen rendering ======================= */', '/* ---------- knob cursor (yellow outline) ---------- */', read('screen.js'));
between('/* ---------- knob cursor (yellow outline) ---------- */', '/* ---------- front-panel keys ---------- */', read('input.js'));
between('/* ---------- front-panel keys ---------- */', '/* full screen: CSS takes', read('hardware.js') + read('guide.js'));

// ---- the simulator link: this page is the A350 -----------------------------------------------------
sub("const DEVICE_MODEL = 'c6';", "const DEVICE_MODEL = 'a350';");
sub("const saveKey = () => 'wmebem_c6_' + fb.code;", "const saveKey = () => 'wmebem_a350_' + fb.code;");
sub("const SAVE_KEYS = ['power', 'standby', 'ambient', 'mode', 'set', 'lim', 'backupOn', 'sigh', 'psync', 'sex', 'locked', 'night', 'spo2On', 'gfx', 'tests', 'loud', 'cpr'];",
    "const SAVE_KEYS = ['power', 'standby', 'ambient', 'mode', 'set', 'lim', 'sex', 'night', 'tests', 'loud', 'apl', 'vap', 'o2sw', 'auxO2', 'light'];");
sub("  win = V.power && V.standby ? 'standby' : null;\n  renderAll();\n  return true;", "  win = null;\n  renderAll();\n  return true;");
sub("  if (!ventOn || P.disc) VA = P.VAbase * (1 - 0.3 * P.fatigue);", "  if (!ventOn || P.disc || G.ySealed) VA = P.VAbase * (1 - 0.3 * P.fatigue);");
sub("(mandTiming() !== null || B.apnoeaVent) ? VA * (isNIV() ? 0.6 : 1) : 0.2;",
    "(mandTiming() !== null || B.apnoeaVent || (V.mode === 'MAN' && B.now - B.lastStart < 10)) ? VA * (isNIV() ? 0.6 : 1) : 0.2;");
sub("    peep = ['APRV', 'DuoPAP'].includes(V.mode) && M.pmean !== null ? Math.max(B.peepNow, M.pmean - 2) : B.peepNow;",
    "    peep = Math.max(B.peepNow || 0, V.mode === 'MAN' ? G.circP : 0);");
sub("  const conn = ventOn && !P.disc;", "  const conn = ventOn && !P.disc && !G.ySealed;");
sub("  P.base = pr; P.pr = {...pr};", "  P.base = pr; P.pr = G.ySealed ? sealedLung() : {...pr};");
sub("  LIVE.etco2 = v.etco2Enabled && Number.isFinite(Number(vit.etco2)) ? Number(vit.etco2) : null;",
    "  LIVE.etco2 = Number.isFinite(Number(vit.etco2)) ? Number(vit.etco2) : null;   /* the A350 measures CO2 itself */\n  LIVE.age = Number.isFinite(Number(v.patientAge)) ? Number(v.patientAge) : null;");
between('function ventStateNow() {', 'let lastMirror = ', read('mirror.js'));
/* Man/Spon is the bag and a face mask as often as a tube: not an "invasive mode with no airway" */
sub("inv:isInvasive() ? 1 : 0,", "inv:isInvasive() && V.mode !== 'MAN' ? 1 : 0,");
/* the gas in the circle survives a reload (FiO2, the agent and the bag), so the patient is not suddenly on air */
sub("v, onNivMin:P.onNivMin}));",
    "v, onNivMin:P.onNivMin, gas:{fio2:G.fio2, fin2o:G.fin2o, etn2o:G.etn2o, fiag:G.fiag, etag:G.etag, bag:G.bag}}));");
sub("  P.onNivMin = Number(s.onNivMin) || 0;\n",
    "  P.onNivMin = Number(s.onNivMin) || 0;\n  if (s.gas) ['fio2', 'fin2o', 'etn2o', 'fiag', 'etag', 'bag'].forEach(k => { if (Number.isFinite(Number(s.gas[k]))) G[k] = Number(s.gas[k]); });\n");
between('function deviceDefaults() {', '/* ---------- what the facilitator sees ---------- */', read('defaults.js'));
sub(`      case 'o2':
        if (V.power && !P.o2fail) { if (V.o2Enrich > 0) { V.o2Enrich = 0; logEvent('O2 enrichment cancelled', 'info'); } else { V.o2Enrich = O2_ENRICH_S; logEvent('O2 enrichment started', 'info'); } renderAll(); }
        break;`, `      case 'o2':   /* the A350 has no O2 enrichment key: the facilitator's button sets FG O2 to 100% */
        if (V.power) remoteEdit('ctrl', 'o2', 100);
        break;`);
sub("  engineStep(dt);\n  if (V.selftest > 0) { V.selftest -= dt; if (V.selftest <= 0) { V.selftest = 0; win = 'standby'; logEvent('Self-test passed', 'info'); renderAll(); } }",
    "  engineStep(dt);\n  gasTick(dt);\n  bagTick();\n  editTick(dt);\n  if (V.selftest > 0) { V.selftest -= dt; if (V.selftest <= 0) { V.selftest = 0; win = null; logEvent('Machine switched on: Standby', 'info'); renderAll(); } }");
sub("['monitoring', 'alarms', 'system', 'standby'].includes(win)", "['alarms', 'tests'].includes(win)");
sub("    $('#simClock').textContent = V.power && !V.standby ? 'Ventilating ' + clockStr() : '';", "    $('#simClock').textContent = V.power && !V.standby ? 'In use ' + clockStr() : '';");
sub("window.__vent = {V, get P() { return P; }, B,", "window.__vent = {V, G, get P() { return P; }, B,");

// Nothing of the Hamilton screen may show on the Dräger page (comments that explain the shared engine aside).
const visible = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const left = visible.match(/.{0,50}(HAMILTON|Hamilton).{0,50}/);
if (left && !/MODEL_PAGES|HAMILTON-T1, HAMILTON-C6 or Atlan A350/.test(left[0])) fail('a Hamilton label survived: ' + left[0]);
if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur !== html) fail('vent/a350.html is out of date: run node scripts/make-a350.mjs');
    console.log('[make-a350] vent/a350.html is up to date');
} else {
    fs.writeFileSync(OUT, html);
    console.log('[make-a350] wrote vent/a350.html', html.length, 'bytes');
}
