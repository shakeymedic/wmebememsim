/* ---------- knob cursor (yellow outline) ---------- */
function kfList() {
  const scope = win ? $('#win') : $('#screen');
  return $$('[data-kf]', scope).filter(el => !el.disabled && el.getAttribute('aria-disabled') !== 'true' && el.offsetParent !== null && (win || !el.closest('#win')));
}
function applyCursor() {
  $$('.kcur', $('#screen')).forEach(el => el.classList.remove('kcur', 'cur'));
  if (cursor < 0 || E) return;
  const L = kfList(); if (!L.length) return;
  L[cursor % L.length].classList.add('kcur', 'cur');
}

/* ---------- editing: touch a control (yellow), turn the knob, press the knob to confirm ([IFU1] pp. 84-85) ----------
   Not confirmed within 15 s, the change is dropped (tones in the last 5 s). The IFU does not say whether turning
   the knob restarts the 15 s; here it does (the simulator's reading). */
function selectControl(scope, key) {
  if (E && E.key === key && E.scope === scope) { cancelEdit(); return; }   /* touched again: no change */
  E = {scope, key, val:curVal(scope, key), t0:B.now};
  renderAll();
}
function turn(dir) {
  rotateKnob(dir);
  if (!V.power || V.selftest > 0) return;
  if (!E) {
    const L = kfList(); if (!L.length) return;
    cursor = cursor < 0 ? (dir > 0 ? 0 : L.length - 1) : (cursor + dir + L.length) % L.length;
    applyCursor(); return;
  }
  E.t0 = B.now;
  const d = defFor(E.scope, E.key);
  if (d.list) {
    let i = d.list.findIndex(x => Math.abs(x - E.val) < 1e-6);
    if (i < 0) i = 0;
    E.val = d.list[clamp(i + dir, 0, d.list.length - 1)]; renderAll(); return;
  }
  if (d.offMax && E.val > d.max) { if (dir < 0) { E.val = d.max; renderAll(); } return; }
  if (d.offMax && E.val >= d.max && dir > 0) { E.val = 99999; renderAll(); return; }
  if (d.off0 && E.val <= 0) { if (dir > 0) { E.val = d.min; renderAll(); } return; }
  const st = typeof d.step === 'function' ? d.step(E.val, dir) : d.step;
  let v = Math.round((E.val + dir * st) / st) * st;
  if (d.off0 && v < d.min) v = dir < 0 ? 0 : d.min;
  else v = clamp(v, d.min, d.max);
  if (E.scope === 'lim') {
    const pairs = {mvlow:'mvhigh', o2low:'o2high', etco2low:'etco2high'};
    const hiOf = pairs[E.key]; if (hiOf && v >= V.lim[hiOf] && V.lim[hiOf] <= ALIM[hiOf].max) return;
    const loOf = Object.keys(pairs).find(k => pairs[k] === E.key); if (loOf && v <= V.lim[loOf] && V.lim[loOf] > 0) return;
  }
  E.val = +v.toFixed(2);
  renderAll();
}
function pressKnob() {
  const kn = $('#knob'); kn.classList.add('press'); setTimeout(() => kn.classList.remove('press'), 140);
  if (!V.power || V.selftest > 0) return;
  if (E) { confirmEdit(); return; }
  if (D) { applyDraft(); return; }
  if (!$('#dlg').hidden) { $('#dlg').hidden = true; goStandby(); return; }
  if (win === 'start' && cursor < 0) { startVentilation(); return; }
  const L = kfList();
  if (cursor >= 0 && L.length) { L[cursor % L.length].click(); return; }
  scrToast('Touch a control, turn the knob to change it and press the knob to confirm.');
}
/* the settings that depend on PEEP and the carrier gas follow them ([IFU1] p. 270; [PI]) */
function keepDependent(s) {
  const pe = s.peep || 0;
  if (s.pinsp < pe + 5) s.pinsp = Math.min(80, pe + 5);
  if (s.pmax < pe + 10) s.pmax = Math.min(80, pe + 10);
  if (s.ps > 80 - pe) s.ps = 80 - pe;
  if (s.carrier === 1 && s.o2 < 25) s.o2 = 25;
}
function confirmEdit() {
  if (!E) return;
  const {scope, key, val} = E;
  E = null;
  if (scope === 'lim') {
    V.lim[key] = val;
    logEvent('Alarm limit changed: ' + limLabel(key) + ' ' + valStr('lim', key, val), 'info');
  } else if (scope === 'draft') { if (D) { D.set[key] = val; keepDependent(D.set); D.t0 = B.now; } }
  else {
    const was = V.set[key];
    V.set[key] = val; keepDependent(V.set);
    if (key === 'carrier' && was !== val) logEvent('Carrier gas: ' + CTRL.carrier.names[val] + (val === 1 ? ' (FG O2 at least 25%)' : ''), 'info');
    else if (key !== 'height' && key !== 'age') logEvent('Setting changed: ' + CTRL[key].label + ' ' + valStr('ctrl', key, val) + (CTRL[key].unit ? ' ' + CTRL[key].unit : ''), 'info');
  }
  renderAll();
  updateTasks();
}
function cancelEdit() { E = null; renderAll(); }
let knobAngle = 0;
function rotateKnob(dir) { knobAngle += dir * 15; $('#knobRot').style.transform = 'rotate(' + knobAngle + 'deg)'; }
function checkSettingPrompts() {}
/* the 15 s confirmation time, the timed tests and the O2+ log line, every engine step */
let editBeep = -1;
function editTick(dt) {
  if (E && E.t0 !== undefined) {
    const left = EDIT_TIMEOUT_S - (B.now - E.t0);
    if (left <= 0) { E = null; editBeep = -1; scrToast('Change not confirmed: the setting is unchanged.'); renderAll(); }
    else if (left <= 5 && Math.ceil(left) !== editBeep) { editBeep = Math.ceil(left); beep(1, 0.2, 880); renderRcol(); if (win) renderWindow(); }
  }
  if (D && B.now - D.t0 > EDIT_TIMEOUT_S) { D = null; scrToast('New mode not confirmed: the therapy is unchanged.'); renderAll(); }
  if (V.testRun) testTick(dt);
}

/* ---------- event wiring: screen ---------- */
$('#screen').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (!V.power || V.selftest > 0) return;
  cursor = -1;
  if (b.getAttribute('aria-disabled') === 'true') { scrToast('Not simulated in this trainer.'); return; }
  if (b.dataset.scope && b.dataset.key) { selectControl(b.dataset.scope, b.dataset.key); return; }
  if (E) { E = null; }   /* touching anything else drops an unconfirmed change */
  if (b.dataset.tabmode) { chooseMode(TAB_MODES[b.dataset.tabmode][syncOf(D ? D.mode : V.mode)] || TAB_MODES[b.dataset.tabmode].cmv); return; }
  if (b.dataset.sync) { const t = tabOf(D ? D.mode : V.mode); chooseMode(TAB_MODES[t][b.dataset.sync] || TAB_MODES[t].cmv); return; }
  if (b.dataset.open) { if (win === b.dataset.open && !b.closest('#win')) { closeWin(); return; } openWin(b.dataset.open, b.dataset.tab); return; }
  if (b.dataset.tab) { winTab = b.dataset.tab; helpFor = null; renderWindow(); return; }
  if (b.dataset.sex) { V.sex = b.dataset.sex; renderAll(); return; }
  if (b.dataset.loud) { V.loud = +b.dataset.loud; beep(1, 0.2, 700); renderWindow(); return; }
  if (b.dataset.night) { V.night = b.dataset.night === '1'; renderAll(); return; }
  if (b.dataset.help) { helpFor = helpFor === b.dataset.help ? null : b.dataset.help; renderWindow(); return; }
  if (b.dataset.test) { startTest(b.dataset.test); return; }
  switch (b.id) {
    case 'tMore': V.more = !V.more; renderAll(); break;
    case 'mAuto': autoLimits(); break;
    case 'mStandby': $('#dlg').hidden = false; break;
    case 'qsMan': quickStartMan(); break;
    case 'stNew':
      V.set = {...DEFAULT_SET, age:V.set.age, height:V.set.height}; V.lim = {...DEFAULT_LIM}; V.mode = 'MAN'; D = null;
      logEvent('New adult case: the start values are set', 'info'); renderAll(); break;
    case 'stCont': scrToast('Continue case: the last settings are kept.'); break;
    case 'sbStart': startVentilation(); break;
    case 'wCancel': case 'wClose': closeWin(); break;
    case 'limAuto': autoLimits(); break;
    case 'bufReset': inactive.clear(); helpFor = null; renderWindow(); break;
    case 'dlgX': $('#dlg').hidden = true; break;
    case 'dlgGo': $('#dlg').hidden = true; goStandby(); break;
  }
});
/* a tab or SIMV/CMV: straight away in Standby; during therapy the new mode waits for the knob ([IFU1] p. 99) */
function chooseMode(m) {
  if (!m) return;
  if (V.standby) {
    if (m !== V.mode) { const prev = V.mode; V.mode = m; D = null; modeEntered(prev); logEvent('Mode set: ' + modeLabel(), 'info'); }
    renderAll(); return;
  }
  if (m === V.mode) { D = null; renderAll(); return; }
  createDraft(m); renderAll();
}
/* Autoset limits: around the values measured now (the rule is the simulator's: MV ± 40%, Paw high PIP + 10) */
function autoLimits() {
  if (V.standby || M.mv === null || !(M.mv > 0)) { scrToast('Autoset uses the measured values: start the therapy first.'); return; }
  V.lim.mvhigh = +clamp(Math.max(M.mv * 1.4, 2), 0.1, 40).toFixed(1);
  V.lim.mvlow = +clamp(Math.max(M.mv * 0.6, 0.3), 0.1, V.lim.mvhigh - 0.1).toFixed(1);
  if (M.ppeak !== null) V.lim.phigh = clamp(Math.round(M.ppeak + 10), 15, 99);
  logEvent('Alarm limits set with Autoset', 'info');
  renderAll();
}
/* MV low from the set VT and RR, -40%, at least 0.3 L/min; MV high stays as it is (Off at the start) ([IFU2] p. 202) */
function mvLimitsFromSettings() {
  if (V.mode === 'MAN' || V.mode === 'SPONT') return;
  V.lim.mvlow = +Math.max(0.3, V.set.vt / 1000 * V.set.rate * 0.6).toFixed(1);
  if (V.lim.mvhigh <= ALIM.mvhigh.max && V.lim.mvhigh <= V.lim.mvlow) V.lim.mvhigh = 99999;
}

function startVentilation() {
  if (E) confirmEdit();
  if (D) { V.mode = D.mode; V.set = {...D.set}; D = null; }
  V.standby = false; V.ambient = false; V.startSuppress = 0;
  B.lastStart = B.now; B.nextEffort = B.now + 0.6; B.starts = []; B.types = []; B.vols = [];
  Object.assign(B, {Vee:0, vEndInsp:0, simvC0:B.now, simvDue:true, lastMand:-1e9, apnoeaVent:false, ovl:null, br:null, phase:'exp', t:0});
  V.caseStart = B.now; G.lastCO2 = B.now;
  modeEntered(null);
  mvLimitsFromSettings();
  win = null; $('#dlg').hidden = true;
  logEvent('Therapy started (' + modeLabel() + ')', 'info');
  if (V.tests.sys !== 'ok' || V.tests.leak !== 'ok') logEvent('Started without a passed system test and leak test', 'info');
  updateTasks(); renderAll();
}
function quickStartMan() { const prev = V.mode; V.mode = 'MAN'; D = null; if (prev !== 'MAN') modeEntered(prev); startVentilation(); }
function goStandby() {
  V.standby = true; V.standbySince = B.now; active.clear(); B.apnoeaVent = false; E = null; D = null;
  for (const k in M) M[k] = null;
  logEvent('Standby', 'info');
  win = null; renderAll();
}

/* ---------- the system test and the leak test (condensed: the simulator's sequence, not Dräger's) ---------- */
const PHYS = {seal:'Seal the Y-piece on the circuit plug', unseal:'Connect the Y-piece to the patient'};
function setPhysical(list) {
  $('#hands').hidden = !(list && list.length);
  const hc = $('#handsCard'); if (hc) hc.hidden = !(list && list.length);
  $('#physical').innerHTML = list && list.length ? list.map(k => `<button data-phys="${k}">${esc(PHYS[k])}</button>`).join('') : '';
}
$('#physical').addEventListener('click', e => { const b = e.target.closest('[data-phys]'); if (b) setYPiece(b.dataset.phys === 'seal'); });
const TEST_NAME = {sys:'System test', leak:'Leak test'};
const TEST_STEPS = {
  sys:[[0, 'Checking the gas supply and the fresh-gas mixer…'], [0.25, 'Checking the ventilator and the pressure measurement…'], [0.5, 'Checking the breathing system for leaks…'], [0.75, 'Checking the gas measurement and the valves…']],
  leak:[[0, 'Pressurising the breathing system…'], [0.5, 'Measuring the leak…']]
};
function startTest(kind) {
  if (!V.standby) { scrToast('Tests are only available in Standby.'); return; }
  if (V.testRun) { scrToast('A test is already running.'); return; }
  V.testMsg = '';
  V.testRun = {kind, t:0, dur:kind === 'sys' ? 40 : 15, msg:'<b>' + TEST_NAME[kind] + '</b> starting…'};
  logEvent(TEST_NAME[kind] + ' started', 'info');
  setPhysical(['seal', 'unseal']);
  renderAll();
}
function testTick(dt) {
  const T = V.testRun;
  if (!V.power || !V.standby) { V.testRun = null; setPhysical([]); return; }
  T.t += dt;
  const f = T.t / T.dur;
  /* what makes a test fail: the Y-piece not on the plug, a leak in the breathing system, no O2 supply,
     the APL valve open (it must be closed for the system to hold pressure) */
  if (T.t > 2 && !G.ySealed) return finishTest(T.kind, false, 'The breathing system is open. Seal the Y-piece on the circuit plug of the bag elbow and repeat the test.');
  if (T.t > 2 && V.apl <= 0) return finishTest(T.kind, false, 'The APL valve is open (Spont). Set it to 30 and repeat the test.');
  if (T.kind === 'sys' && f > 0.1 && P.o2fail) return finishTest('sys', false, 'O2 supply pressure too low. Check the pipeline connection or the O2 cylinder.');
  if (f > 0.6 && P.circLeak) return finishTest(T.kind, false, 'Leak in the breathing system. Check the absorber, the hoses, the bag and the connections, then repeat.');
  if (f >= 1) return finishTest(T.kind, true, TEST_NAME[T.kind] + ' passed.');
  const step = TEST_STEPS[T.kind].filter(s => f >= s[0]).pop();
  T.msg = '<b>' + TEST_NAME[T.kind] + '</b> ' + step[1];
}
function finishTest(kind, ok, why) {
  V.tests[kind] = ok ? 'ok' : 'fail';
  V.tests[kind + 'At'] = new Date().toLocaleString('en-GB', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'});
  V.testRun = null; setPhysical([]);
  V.testMsg = (ok ? '✔ ' : '✖ ') + esc(why);
  logEvent(TEST_NAME[kind] + (ok ? ' passed' : ' failed'), ok ? 'info' : 'med');
  renderAll();
  updateTasks();
}
