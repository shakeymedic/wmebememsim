/* ======================= screen rendering ======================= */
/* The four areas of the Atlan screen ([IFU1] pp. 79-81): the header bar (patient, alarms, time), the main menu
   bar, the monitoring area (curves, parameter fields, gas field; the Standby page in Standby) and the therapy
   bar (mode name and tabs, SIMV/CMV, therapy controls, More, fresh-gas controls). Where each sits and how big
   it is are the simulator's choice. */
function valStr(scope, key, v) {
  const d = defFor(scope, key);
  if (!d) return fmt(v);
  if (d.names) return d.names[v] || '?';
  if (d.list) return ieStr(v);
  if (d.off0 && v <= 0) return 'Off';
  if (scope === 'lim' && d.offMax && v > d.max) return 'Off';
  return fmt(v, d.dp || 0);
}
function defFor(scope, key) { return scope === 'lim' ? ALIM[key] : ctrlDef(key, null, scope === 'draft' && D ? D.set : V.set); }
function curVal(scope, key) {
  if (scope === 'lim') return V.lim[key];
  if (scope === 'draft') return D.set[key];
  return V.set[key];
}
function isAct(scope, key) { return !!E && E.key === key && E.scope === scope; }
const labelFor = (key, mode) => key === 'peep' && mode === 'SPONT' ? 'CPAP' : CTRL[key].label;
const limLabel = k => ALIM[k].label + (k.endsWith('low') ? ' low' : ' high');
function rangeStr(d) {
  if (d.names) return d.names.join(' / ');
  return (d.off0 ? 'Off, ' : '') + fmt(d.min, d.dp || 0) + '–' + fmt(d.max, d.dp || 0);
}
/* a therapy control: dark green when active, yellow while selected and not yet confirmed, light green when it
   belongs to a mode that is not active yet ([IFU2] p. 104) */
function ctlHTML(key, scope, val, mode) {
  const d = defFor(scope, key), act = isAct(scope, key), v = act ? E.val : val;
  const lb = scope === 'lim' ? limLabel(key) : labelFor(key, mode);
  const st = act ? 'sel' : scope === 'draft' ? 'avail' : 'on';
  const left = act && E.t0 !== undefined ? Math.max(0, EDIT_TIMEOUT_S - (B.now - E.t0)) : null;
  const tip = lb + ': ' + (d.tip || '') + (scope === 'draft' ? ' (Light green: part of the new mode, not active until you press the rotary knob.)' : ' Touch it, turn the rotary knob, then press the knob to confirm.');
  return `<button class="tctl ${st}${left !== null && left <= 5 ? ' warn' : ''}" data-kf data-scope="${scope}" data-key="${key}" data-tip="${esc(tip)}" aria-pressed="${act}" aria-label="${esc(lb)} ${esc(valStr(scope, key, v))} ${esc(d.unit)}">`
    + `<span class="lb">${esc(lb)}</span><span class="v">${esc(valStr(scope, key, v))}</span><span class="u">${esc(d.unit)}</span>`
    + (act ? `<span class="rng">${esc(rangeStr(d))}</span>` : '') + '</button>';
}
/* ---------- the therapy bar ---------- */
function renderRcol() {
  const tb = $('#tbar');
  if (!V.power || V.selftest > 0) { tb.hidden = true; return; }
  tb.hidden = false;
  const mode = D ? D.mode : V.mode, src = D ? D.set : V.set, scope = D ? 'draft' : 'ctrl';
  const tabNow = tabOf(V.mode), tabSel = tabOf(mode);
  $('#modeName').innerHTML = `<b>${esc(V.standby ? 'Standby' : mName(V.mode))}</b>` + (D ? `<span class="pend">New: ${esc(mName(D.mode, D.set))}. Press the rotary knob to start it.</span>` : '');
  $('#modeName').dataset.tip = D ? 'A new mode is selected but not running yet. Check its settings (light green), then press the rotary knob to start it. Touching the active (dark green) tab cancels it.'
    : 'The active ventilation mode. To change it: touch a mode tab, choose SIMV or CMV where shown, check the light-green settings, then press the rotary knob.';
  $('#tbar').classList.toggle('pending', !!D);
  $('#tabs').innerHTML = TABS.map(([t, n]) => {
    const st = t === tabSel && D && t !== tabNow ? 'sel' : t === tabNow ? 'on' : 'avail';
    return `<button class="ttab ${st}" data-kf data-tabmode="${t}" data-tip="${esc(TAB_TIP[t] + (t === tabNow ? ' (Active.)' : V.standby ? ' Touch to choose it.' : ' Touch to select it, then press the rotary knob to start it.'))}" aria-pressed="${t === tabNow}">${esc(n)}</button>`;
  }).join('') + (TAB_MODES[tabSel].simv ? ['simv', 'cmv'].map(sy => {
    const cur = syncOf(V.mode) === sy && tabSel === tabNow, sel = D && syncOf(D.mode) === sy && !cur;
    return `<button class="tsync ${sel ? 'sel' : cur ? 'on' : 'avail'}" data-kf data-sync="${sy}" data-tip="${esc(SYNC_TIP[sy])}">${sy.toUpperCase()}</button>`;
  }).join('') : '') + (MODE_CTRLS[mode].more.length ? `<button class="tmore" data-kf id="tMore" data-tip="More / Less: shows or hides the extra settings for this mode (pressure support, trigger, slope and others)." aria-pressed="${V.more}">${V.more ? 'Less' : 'More'}</button>` : '');
  const c = MODE_CTRLS[mode];
  const keys = c.basic.concat(V.more ? c.more : []);
  $('#rcol').innerHTML = keys.length ? keys.map(k => ctlHTML(k, scope, src[k], mode)).join('')
    : `<div class="tinfo"><b>Man/Spon</b><span>Ventilate with the bag. The APL valve sets the pressure limit: turn it fully anticlockwise to Spont (open) for spontaneous breathing.</span><span class="apl">APL ${V.apl > 0 ? V.apl + ' cmH2O' : 'Spont (open)'}</span></div>`;
  $('#fgctl').innerHTML = `<div class="fgh" data-tip="Fresh gas: the gas mixture the machine delivers into the breathing system (carrier gas, its oxygen concentration and the total flow). The vaporiser adds agent to it.">Fresh gas</div>` + FG.map(k => ctlHTML(k, 'ctrl', V.set[k], mode)).join('');
  $('#tbNote').innerHTML = therapyNote(mode, src);
}
/* the extra-information field: derived timing, and what the mode does (the simulator's text) */
function therapyNote(mode, s) {
  const parts = [];
  if (['SCMV', 'SIMV', 'APVcmv', 'APVsimv', 'PCV+', 'PSIMV+'].includes(mode)) {
    const c = 60 / s.rate, ti = Math.min(s.ti, c * 0.8);
    parts.push(`I:E ${ieStr(ti / (c - ti))}`);
    if (isVC(mode)) parts.push(`insp. flow ${fmt(s.vt / 1000 / Math.max(0.2, ti * (1 - s.pause / 100)) * 60)} L/min`);
  }
  if (mode === 'SPONT' && s.rrmin > 0) parts.push(`RRmin ${s.rrmin}/min: backup breaths at Pinsp ${s.pinsp}`);
  if (!V.standby && M.fspont !== null && M.fspont > 0) parts.push(`spontaneous ${fmt(M.fspont)}/min`);
  return parts.join(' · ');
}
/* ---------- the monitoring area: parameter fields and the gas field ---------- */
const PARAMS = [
  {id:'pip', n:'PIP', u:'cmH2O', dp:0, v:() => M.ppeak, lim:() => 'high ' + V.lim.phigh, tip:'Peak airway pressure of the last breath. The small number is the Paw high alarm limit.'},
  {id:'pplat', n:'Pplat', u:'cmH2O', dp:0, v:() => M.pplat, tip:'Plateau pressure at the end of inspiration, when the flow has stopped: the pressure the alveoli see. A high PIP with a normal Pplat points to the airway or tube; both high points to the lungs or chest wall.'},
  {id:'peep', n:'PEEP', u:'cmH2O', dp:0, v:() => V.mode === 'MAN' ? Math.max(G.circP, M.peep || 0) : M.peep, tip:'Pressure at the end of expiration. In Man/Spon it is the pressure held in the breathing system by the bag and APL valve.'},
  {id:'mv', n:'MV', u:'L/min', dp:1, v:() => M.mv, lim:() => (V.lim.mvhigh <= ALIM.mvhigh.max ? fmt(V.lim.mvhigh, 1) : 'Off') + ' / ' + (V.lim.mvlow > 0 ? fmt(V.lim.mvlow, 1) : 'Off'), tip:'Expired minute volume (litres per minute). The small numbers are the high and low alarm limits.'},
  {id:'vt', n:'VT', u:'mL', dp:0, v:() => M.vte, tip:'Expired tidal volume of the last breath. Lung-protective ventilation aims at about 6 to 8 mL/kg of ideal body weight.'},
  {id:'rr', n:'RR', u:'/min', dp:0, v:() => M.ftot, tip:'Measured breathing rate: machine and patient breaths together.'}
];
function renderMMP() {
  const el = $('#mmps');
  if (!V.power || V.selftest > 0) { el.innerHTML = ''; $('#smp').innerHTML = ''; return; }
  const pri = {};
  topAlarms().forEach(a => { if (a.f && !pri[a.f]) pri[a.f] = a.p; });
  el.innerHTML = PARAMS.map(p => {
    const v = V.standby ? null : p.v();
    return `<button class="pf ${pri[p.id] ? 'al ' + pri[p.id] : ''}" data-kf data-open="alarms" data-tab="limits" data-tip="${esc(p.n + ': ' + p.tip + ' Touch to open the alarm limits.')}" aria-label="${p.n} ${fmt(v, p.dp)} ${p.u}"><span class="n">${p.n}</span><span class="u">${p.u}</span>`
      + `<span class="v">${v === null || v === undefined ? '--' : fmt(v, p.dp)}</span>${p.lim ? `<span class="lm">${esc(p.lim())}</span>` : ''}</button>`;
  }).join('');
  renderSMP(pri);
}
/* the gas field: inspired and expired O2, CO2, N2O and agent, and xMAC ([IFU2] p. 170; N2O and agent only when not zero) */
function renderSMP(pri) {
  const el = $('#smp');
  if (!V.power || V.selftest > 0) { el.innerHTML = ''; return; }
  const sb = V.standby, et = etco2kPa(), moving = !sb && B.now - B.lastStart < 12 && !G.ySealed && !P.disc;
  const rows = [['O2', '%', G.fio2, moving ? Math.max(0, G.fio2 - 4.5) : null, 0, 'o2', 'Oxygen: inspired (in) and end-tidal (et). The end-tidal oxygen shows how well the lungs are filled with oxygen, for example after pre-oxygenation.']];
  rows.push(['CO2', 'kPa', et === null ? null : 0, et === null || !moving ? null : et, 1, 'co2', 'Carbon dioxide: inspired (in, normally 0) and end-tidal (et). No CO2 while ventilating means no gas exchange: disconnection, oesophageal tube or no cardiac output.']);
  if (G.fin2o > 0.5 || G.etn2o > 0.5) rows.push(['N2O', '%', G.fin2o, moving ? G.etn2o : null, 0, '', 'Nitrous oxide, inspired and end-tidal.']);
  if (G.fiag > 0.04 || G.etag > 0.04) rows.push(['Sev', '%', G.fiag, moving ? G.etag : null, 1, 'ag', 'Sevoflurane, inspired and end-tidal. The end-tidal value is what the patient\'s brain follows.']);
  const mac = xMAC();
  el.innerHTML = `<div class="gh"><span></span><span>in</span><span>et</span></div>` + rows.map(r => `<div class="gr ${r[5]} ${pri && pri[r[5]] ? 'al ' + pri[r[5]] : ''}" data-tip="${esc(r[6])}"><span class="n">${r[0]}<small>${r[1]}</small></span><b>${sb || r[2] === null ? '--' : fmt(r[2], r[4])}</b><b>${sb || r[3] === null ? '--' : fmt(r[3], r[4])}</b></div>`).join('')
    + (mac > 0.05 ? `<div class="gr mac" data-tip="xMAC: the end-tidal agents added together as multiples of their age-corrected MAC. 1 MAC is the end-tidal concentration at which half of patients do not move to a surgical incision."><span class="n">xMAC<small>age ${patientAge()}</small></span><b></b><b>${sb ? '--' : fmt(mac, 1)}</b></div>` : '');
}
/* the header bar: patient category and data (left) */
function renderModeName() {
  const on = V.power && V.selftest <= 0;
  $('#hdrPat').style.visibility = on ? '' : 'hidden';
  $('#hdrPat').dataset.tip = 'Patient category, age and height, from the Start dialog. Age is used for xMAC.';
  $('#hdrPat').innerHTML = `<b>Adult</b><span>${patientAge()} y · ${V.set.height} cm</span>`;
}
function wallClock() { const d = new Date(); return d.toTimeString().slice(0, 5); }
/* the header bar: silenced alarms, power and the time (right) */
function renderBstat() {
  const el = $('#bstat');
  if (!V.power || V.selftest > 0) { el.innerHTML = ''; return; }
  const b = Math.round(P.batt);
  const ap = V.audioPause > 0 ? `<span class="ap" title="Alarms silenced">🔕 ${Math.floor(V.audioPause / 60)}:${String(Math.floor(V.audioPause % 60)).padStart(2, '0')}</span>` : '';
  el.innerHTML = `${ap}<span class="pw ${P.mains ? '' : 'batt'}">${P.mains ? 'Mains' : 'Battery ' + b + '%'}</span><span class="clock">${wallClock()}</span>`;
}
/* the header bar: the alarm message field, highest priority first, with !!! / !! / ! */
function renderAlarmBar() {
  const bar = $('#msgbar');
  if (!V.power || V.selftest > 0) { bar.innerHTML = ''; return; }
  const list = topAlarms();
  const edu = !document.body.classList.contains('assess');
  bar.innerHTML = list.slice(0, 3).map(a => `<span class="af ${a.p}"${edu && HELP[a.id] ? ` data-tip="${esc(a.t + ': ' + tipPlain(HELP[a.id]))}"` : ''}>${PRI_MARK[a.p]} ${esc(a.t)}</span>`).join('') + (list.length > 3 ? `<span class="af more">+${list.length - 3}</span>` : '');
  $('#lamp').className = 't1-lamp' + (list.length ? ' ' + list[0].p : '');
}
/* the main menu bar ([IFU2] pp. 350-353; the simulated ones work, the others say so) */
const MENU_TIP = {
  mAlarms:'Alarms: the alarm limits, the current alarms (with what to check) and the log.',
  mAuto:'Autoset limits: sets the minute volume and Paw high limits around the values measured now.',
  mViews:'Views: other screen layouts. Not simulated here.', mTrends:'Trends and data. Not simulated here.', mProc:'Procedures (for example a lung recruitment). Not simulated here.',
  mSetup:'System setup: alarm volume and the colour scheme.',
  mTests:'Tests: the system test and leak test before the first patient. Only in Standby.',
  mStart:'Start: choose the patient, then start the therapy with the rotary knob.',
  mStandby:'Standby: stop the ventilation and the fresh gas (you confirm first).'
};
/* a help text without its markup, for a hover hint */
const tipPlain = h => h.replace(/<li>/g, ' • ').replace(/<[^>]+>/g, '').trim();
function renderMenu() {
  const el = $('#mmenu');
  if (!V.power || V.selftest > 0) { el.innerHTML = ''; return; }
  const b = (id, label, opts = {}) => `<button class="mm ${win === opts.open ? 'open' : ''}" data-kf ${opts.open ? `data-open="${opts.open}"` : `id="${id}"`} ${opts.dis ? 'aria-disabled="true"' : ''} data-tip="${esc(MENU_TIP[id] || '')}">${label}</button>`;
  el.innerHTML = b('mAlarms', 'Alarms...', {open:'alarms'}) + b('mAuto', 'Autoset limits') + b('mViews', 'Views...', {dis:true}) + b('mTrends', 'Trends/ Data...', {dis:true})
    + b('mProc', 'Proce- dures...', {dis:true}) + b('mSetup', 'System setup...', {open:'setup'}) + (V.standby ? b('mTests', 'Tests...', {open:'tests'}) : '')
    + '<span class="sp"></span>' + (V.standby ? b('mStart', 'Start...', {open:'start'}) : b('mStandby', 'Standby...'));
}
/* the Standby page, in the monitoring area: readiness after the tests ([IFU1] p. 87: green, yellow or red) */
function renderStandbyPage() {
  const el = $('#sbpage');
  const show = V.power && V.selftest <= 0 && V.standby;
  el.hidden = !show; $('#gfx').style.visibility = show ? 'hidden' : '';
  if (!show) return;
  const t = V.tests, ready = t.sys === 'fail' || t.leak === 'fail' ? 'red' : t.sys === 'ok' && t.leak === 'ok' ? 'green' : 'yellow';
  const txt = {green:'Fully operational', yellow:'Operational with restrictions: the tests have not all been done today', red:'Not operational: a test failed. Repeat it.'}[ready];
  const at = k => t[k] === 'ok' ? 'passed ' + (t[k + 'At'] || '') : t[k] === 'fail' ? 'failed ' + (t[k + 'At'] || '') : 'not done';
  el.innerHTML = `<div class="sb-h">Standby</div>
    <div class="sb-ready ${ready}" data-tip="Readiness: green when the system test and leak test have both passed today, yellow when they have not been done, red when one failed."><span class="dot"></span><span>${txt}</span></div>
    <div class="sb-tests">System test: ${at('sys')}<br>Leak test: ${at('leak')}</div>
    <div class="sb-btns"><button class="wb green" data-kf data-open="start" data-tip="Start: check the patient data and the mode, then press the rotary knob to start the therapy.">Start...</button><button class="wb" data-kf id="qsMan" data-tip="Quick start Man/Spon: starts hand ventilation straight away (bag and APL valve), for example to pre-oxygenate.">Quick start Man/Spon</button><button class="wb" data-kf data-open="tests" data-tip="Tests: the system test and the leak test. Seal the Y-piece on the circuit plug first.">Tests...</button></div>
    <p class="sb-note">Fresh gas and ventilation are off in Standby. Squeezing the breathing bag also opens the Start dialog.</p>`;
}
function renderLEDs() {
  const lit = (id, v) => { const e = $('#' + id); if (e) e.classList.toggle('lit', !!v); };
  lit('kAudio', V.power && V.audioPause > 0); lit('kLight', V.light);
  $('#kPower').classList.toggle('on', V.power);
  $('#t1').classList.toggle('lightOn', V.light);
  $('#screen').classList.toggle('night', V.night);
  const off = $('#scrOff');
  off.hidden = V.power && V.selftest <= 0;
  $('#scrOffTxt').innerHTML = V.power ? 'ANAESTHETIC MACHINE<small>Starting up…</small>' : '';
  $('#t1').classList.toggle('off', !V.power);
  $('#knob').classList.toggle('confirm', V.power && V.selftest <= 0 && !!(E || D || win === 'start'));
  renderHW();
  renderGuide();
}
function renderAll() {
  V.backupOn = V.mode === 'SPONT' && V.set.rrmin > 0;
  renderModeName(); renderRcol(); renderMMP(); renderAlarmBar(); renderBstat(); renderMenu(); renderStandbyPage(); renderLEDs();
  if (win) renderWindow(); else $('#win').hidden = true;
  applyCursor();
  guideHighlight();
}

/* ---------- dialogs ---------- */
function openWin(id, tab) {
  if (!V.power || V.selftest > 0) return;
  if (id === 'tests' && !V.standby) { scrToast('Tests are only available in Standby.'); return; }
  if (id === 'start' && !V.standby) return;
  if (E && E.scope === 'lim' && id !== 'alarms') E = null;
  win = id; winTab = tab || ({alarms:'limits'})[id] || ''; helpFor = null; cursor = -1;
  renderAll();
}
function closeWin() {
  if (E && E.scope === 'lim') E = null;
  win = null; cursor = -1; renderAll();
}
const X = '<button class="wx" data-kf id="wClose" aria-label="Close" data-tip="Close this window.">✕</button>';
function tabs(list) {
  return `<div class="htabs" role="tablist">${list.map(([id, nm]) => `<button role="tab" data-kf data-tab="${id}" aria-selected="${winTab === id}">${nm}</button>`).join('')}</div>`;
}
function renderWindow() {
  const w = $('#win');
  if (!win) { w.hidden = true; return; }
  w.hidden = false;
  let h = '';
  if (win === 'start') {
    h = X + `<div class="wtitle">Start</div><div class="wbody">
      <div class="wrow"><button class="wb green" data-kf id="stNew" data-tip="New adult: resets the settings and alarm limits to the factory start values.">New adult</button><button class="wb" disabled title="Not simulated">New paediatric</button><button class="wb" disabled title="Not simulated">New neonate</button><button class="wb" data-kf id="stCont" data-tip="Continue case: keeps the last settings.">Continue case</button></div>
      <div class="wgrp">Patient data</div>
      <div class="wrow">${ctlHTML('age', 'ctrl', V.set.age)}${ctlHTML('height', 'ctrl', V.set.height)}
        <button class="wb ${V.sex === 'Male' ? 'green' : ''}" data-kf data-sex="Male">Male</button><button class="wb ${V.sex === 'Female' ? 'green' : ''}" data-kf data-sex="Female">Female</button></div>
      <div class="wgrp">Therapy</div>
      <p class="wnote">Mode: <b>${esc(mName(V.mode))}</b> · ${esc(valStr('ctrl', 'carrier', V.set.carrier))} · FG O2 ${V.set.o2}% · FG flow ${valStr('ctrl', 'fgf', V.set.fgf)} L/min. Choose the mode with the tabs and set the fresh gas in the therapy bar below.</p>
      <p class="wnote">Age is used for xMAC. Press the rotary knob to start therapy.</p></div>
      <div class="wfoot"><button class="wb" data-kf id="wCancel">Cancel</button><button class="wb green wide" data-kf id="sbStart" data-tip="Starts the chosen mode (the same as pressing the rotary knob).">Start therapy</button></div>`;
  } else if (win === 'alarms') {
    h = X + tabs([['limits', 'Limits'], ['current', 'Current alarms'], ['log', 'Log']]);
    if (winTab === 'limits') {
      h += `<div class="wbody" style="top:52px"><div class="limgrid">${LIM_ROWS.map(([hi, lo]) => {
        const cur = {phigh:M.ppeak, mvhigh:M.mv, o2high:G.fio2, etco2high:etco2kPa()}[hi];
        return `<div class="limrow"><span class="ln">${esc(ALIM[hi].label)}<small>${esc(ALIM[hi].unit)}</small></span>${ctlHTML(hi, 'lim', V.lim[hi])}${lo ? ctlHTML(lo, 'lim', V.lim[lo]) : '<span></span>'}<span class="lc">now ${V.standby || cur === null || cur === undefined ? '--' : fmt(cur, ALIM[hi].dp || 0)}</span></div>`;
      }).join('')}</div><p class="wnote">Factory limits: Paw high 40, FiO2 low 20, etCO2 high 7.0 kPa; MV limits are set from VT × RR ± 40% at the start of ventilation, with MV high Off.</p></div>
      <div class="wfoot"><button class="wb" data-kf id="limAuto">Autoset limits</button></div>`;
    } else if (winTab === 'current') {
      h += bufferHTML();
    } else {
      h += `<div class="wbody" style="top:52px"><table class="wtable"><thead><tr><th>Time</th><th>Event</th></tr></thead><tbody>${history.map(e => `<tr><td>${e.wall}</td><td>${e.p !== 'info' && PRI_MARK[e.p] ? PRI_MARK[e.p] + ' ' : ''}${esc(e.t)}</td></tr>`).join('') || '<tr><td colspan="2">No events.</td></tr>'}</tbody></table></div>`;
    }
  } else if (win === 'tests') {
    const r = V.testRun;
    h = X + `<div class="wtitle">Tests</div><div class="wbody">
      <div class="tc"><button data-kf data-test="sys" ${r ? 'disabled' : ''} data-tip="System test: checks the gas supply, the mixer, the ventilator, the sensors and the breathing system. Needs the Y-piece sealed and the APL valve not at Spont.">System test<span class="st ${V.tests.sys || ''}">${testMark(V.tests.sys)}</span><small>${V.tests.sysAt || 'not done'}</small></button>
      <button data-kf data-test="leak" ${r ? 'disabled' : ''} data-tip="Leak test: pressurises the breathing system to check for leaks. Needs the Y-piece sealed.">Leak test<span class="st ${V.tests.leak || ''}">${testMark(V.tests.leak)}</span><small>${V.tests.leakAt || 'not done'}</small></button></div>
      ${r ? `<div class="prog"><i style="width:${Math.round(100 * r.t / r.dur)}%"></i></div>` : ''}
      <div class="tc-msg" id="tcMsg">${r ? r.msg : (V.testMsg || 'Before the system test: seal the Y-piece on the circuit plug of the bag elbow, set the APL valve to 30, vaporiser dial at 0, O2 switch to Aux. O2. Then start the test.')}</div>
      <p class="wnote">On the machine the system test takes about 8 minutes and the leak test about 2. Here they are shortened, and the checks inside them are summarised, not the manufacturer's own sequence.</p></div>`;
  } else if (win === 'setup') {
    h = X + `<div class="wtitle">System setup</div><div class="wbody">
      <div class="wgrp">Alarm volume</div><div class="wrow">${[1,2,3,4,5,6,7,8,9,10].map(n => `<button class="wb ${V.loud === n ? 'green' : ''}" data-kf data-loud="${n}" style="min-width:44px;padding:0">${n}</button>`).join('')}</div>
      <div class="wgrp">Colour scheme</div><div class="wrow"><button class="wb ${!V.night ? 'green' : ''}" data-kf data-night="0">Day dark</button><button class="wb ${V.night ? 'green' : ''}" data-kf data-night="1">Night</button></div>
      <p class="wnote">Sound only plays if "Alarm sound" above the simulator is on. The device also has "Day light"; it is not simulated.</p></div>`;
  }
  w.innerHTML = h;
}
function bufferHTML() {
  const rows = [...active.keys()].map(id => ({id, at: active.get(id), act: true})).concat([...inactive.keys()].map(id => ({id, at: inactive.get(id), act: false})));
  rows.sort((a, b) => (b.act - a.act) || PRI_ORDER[ALARMS[b.id].p] - PRI_ORDER[ALARMS[a.id].p]);
  let h = `<div class="wbody" style="top:52px"><div class="abuf">${rows.map(r => `<button class="r ${ALARMS[r.id].p} ${r.act ? '' : 'inact'}" data-kf data-help="${r.id}"><time>${r.at}</time>${PRI_MARK[ALARMS[r.id].p]} ${esc(ALARMS[r.id].t)}${r.act ? '' : ' (over)'}<span class="i" aria-hidden="true">i</span></button>`).join('') || '<p class="wnote">No alarms.</p>'}</div>`;
  if (helpFor) { const hp = HELP[helpFor]; h += `<div class="help"><h6>${esc(ALARMS[helpFor].t)}</h6>${hp ? hp : '<p>No help text in this simulator.</p>'}<p class="wnote">The simulator's summary, not the manufacturer's text.</p></div>`; }
  h += '</div>';
  if (inactive.size) h += '<div class="wfoot"><button class="wb" data-kf id="bufReset">ALARM RESET</button></div>';
  return h;
}
function bindHelp() {}
function testMark(s) { return s === 'ok' ? '✔' : s === 'fail' ? '✖' : '–'; }
/* a new mode: shown in the therapy bar (light green) until the knob confirms it ([IFU1] p. 99) */
function createDraft(mode) {
  D = {mode, set:{...V.set}, t0:B.now};
}
function applyDraft() {
  const prev = V.mode, oldLabel = modeLabel();
  V.set = {...D.set}; V.mode = D.mode; D = null;
  modeEntered(prev);
  logEvent('Mode changed ' + oldLabel + ' → ' + modeLabel(), 'info');
  renderAll();
}
function modeEntered(prev) {
  B.apnoeaVent = false; clear('apvent'); clear('apnea'); clear('apnea2'); G.apneaT = 0;
  if (APV.includes(V.mode) && !APV.includes(prev)) B.apvP = 10;
  B.simvC0 = B.now; B.simvDue = true; B.lastMand = -1e9;
  V.modeSince = B.now;
  V.backupOn = V.mode === 'SPONT' && V.set.rrmin > 0;
}
function calcIBW() {
  const h = V.set.height;
  const base = V.sex === 'Male' ? 50 : 45.5;
  return Math.max(30, Math.round(base + 0.91 * (h - 152.4)));
}

