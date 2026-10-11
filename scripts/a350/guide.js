/* ---------- hover hints: what each part of the machine is (the simulator's own text) ---------- */
/* A mouse or pen resting on anything with data-tip shows a bubble; keyboard focus shows it too. On a touch
   screen nothing pops up (a tap must stay a tap): the Education guide shows the last thing touched instead. */
const tipEl = document.createElement('div');
tipEl.className = 'a-tip'; tipEl.hidden = true; tipEl.setAttribute('role', 'tooltip');
document.body.appendChild(tipEl);
let tipTimer = null, tipShown = '', tipAt = null, lastTip = null;
function placeTip(x, y) {
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
  let l = x + 14, t = y + 18;
  if (l + w > vw - 8) l = Math.max(8, x - w - 14);
  if (t + h > vh - 8) t = Math.max(8, y - h - 14);
  tipEl.style.left = l + 'px'; tipEl.style.top = t + 'px';
}
function showTip(text, x, y) { tipEl.textContent = text; tipEl.hidden = false; tipShown = text; placeTip(x, y); }
function hideTip() { clearTimeout(tipTimer); tipTimer = null; tipEl.hidden = true; tipShown = ''; tipAt = null; }
function noteTip(el) {
  const t = el && el.dataset.tip;
  if (t && (!lastTip || lastTip !== t)) { lastTip = t; renderGuide(); }
}
/* No hints in Assessment: some explain what a reading means (no CO2 = oesophageal tube...), which is the test. */
document.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch' || isAssess()) { if (tipShown) hideTip(); return; }
  const el = e.target.closest && e.target.closest('[data-tip]');
  const text = el ? el.dataset.tip : '';
  if (!text) { hideTip(); return; }
  if (text === tipShown) { placeTip(e.clientX, e.clientY); return; }
  if (tipAt === text) return;
  hideTip(); tipAt = text;
  tipTimer = setTimeout(() => { showTip(text, e.clientX, e.clientY); noteTip(el); }, 400);
}, {passive:true});
document.addEventListener('pointerdown', e => { hideTip(); const el = e.target.closest && e.target.closest('[data-tip]'); if (el) noteTip(el); }, true);
document.addEventListener('pointerleave', hideTip);
window.addEventListener('scroll', hideTip, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideTip(); });
document.addEventListener('focusin', e => {
  const el = e.target.closest && e.target.closest('[data-tip]');
  if (!el || !el.matches(':focus-visible') || isAssess()) return;
  const r = el.getBoundingClientRect();
  showTip(el.dataset.tip, r.left + r.width / 2, r.bottom);
  noteTip(el);
});
document.addEventListener('focusout', hideTip);

/* ---------- the Education guide beside the machine ---------- */
/* What the machine is doing, what the alarms mean, what the last thing hovered or touched is, and step-by-step
   help that points at the next control. Hidden in Assessment. All the simulator's text. */
/* Open by default only where there is room for it beside a full-size machine (a laptop or a large
   screen); on a tablet it starts closed and the Guide button opens it. A saved choice wins. */
const GUIDE_OPEN_MIN = 1280;
let guideOpen = (() => { try { const v = localStorage.getItem('wmebem_a350_guide'); return v === null ? window.innerWidth >= GUIDE_OPEN_MIN : v === '1'; } catch (e) { return window.innerWidth >= GUIDE_OPEN_MIN; } })();
let guideTask = null, lastGuide = '';
$('#guideToggle').addEventListener('click', () => {
  guideOpen = !guideOpen;
  try { localStorage.setItem('wmebem_a350_guide', guideOpen ? '1' : '0'); } catch (e) {}
  lastGuide = ''; renderGuide(); fitDevice();
});
$('#guideBody').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.task) { guideTask = guideTask === b.dataset.task ? null : b.dataset.task; renderGuide(); guideHighlight(); }
  if (b.id === 'gDone') { guideTask = null; renderGuide(); guideHighlight(); }
});
const isAssess = () => document.body.classList.contains('assess');
const TASKS = [
  ['on', 'Switch on and check the machine'],
  ['man', 'Ventilate by hand (Man/Spon)'],
  ['preox', 'Pre-oxygenate, or raise the oxygen fast'],
  ['setting', 'Change a setting'],
  ['vap', 'Give sevoflurane'],
  ['silence', 'Silence an alarm'],
  ['mode:APVcmv', 'Change mode to VC-CMV/AutoFlow'], ['mode:SCMV', 'Change mode to VC-CMV'], ['mode:SIMV', 'Change mode to VC-SIMV'],
  ['mode:PCV+', 'Change mode to PC-CMV'], ['mode:PSIMV+', 'Change mode to PC-SIMV'], ['mode:SPONT', 'Change mode to CPAP/PSV'],
  ['standby', 'Stop ventilating (Standby)']
];
/* each step: [text, done?, the element to point at] */
function taskSteps(task) {
  const on = V.power && V.selftest <= 0;
  const S = [['Switch the machine on: press the round On / Standby key under the screen.', on, '#kPower']];
  if (task.startsWith('mode:')) {
    const m = task.slice(5), t = tabOf(m), sync = TAB_MODES[t].simv ? syncOf(m) : null, cur = D ? D.mode : V.mode;
    const tabName = TABS.find(x => x[0] === t)[1];
    S.push([`Touch the ${tabName} tab in the therapy bar (bottom of the screen).`, on && tabOf(cur) === t, `[data-tabmode="${t}"]`]);
    if (sync) S.push([`Touch ${sync.toUpperCase()} (next to the tabs).`, on && cur === m, `[data-sync="${sync}"]`]);
    S.push(['Check the settings: the light-green ones belong to the new mode. Touch one to change it (turn and press the knob).', on && cur === m, null]);
    if (V.standby) {
      S.push(['Touch Start... (Standby page or menu).', win === 'start', '[data-open="start"]']);
      S.push(['Press the rotary knob to start the therapy.', !V.standby && V.mode === m, '#knob']);
    } else S.push(['Press the rotary knob to start the new mode.', V.mode === m && !D, '#knob']);
    return S;
  }
  switch (task) {
    case 'on':
      S.push(['Seal the Y-piece on the circuit plug (touch the Y-piece beside the bag).', G.ySealed || (V.tests.sys === 'ok' && V.tests.leak === 'ok'), '#ypiece']);
      S.push(['Set the APL valve to 30 (the + and − beside APL valve).', V.apl >= 5 || (V.tests.sys === 'ok' && V.tests.leak === 'ok'), '#aplUp']);
      S.push(['Open Tests... and run the System test.', V.tests.sys === 'ok', V.standby && win === 'tests' ? '[data-test="sys"]' : '[data-open="tests"]']);
      S.push(['Run the Leak test.', V.tests.leak === 'ok', V.standby && win === 'tests' ? '[data-test="leak"]' : '[data-open="tests"]']);
      S.push(['Connect the Y-piece to the patient again (touch the Y-piece).', !G.ySealed && V.tests.sys === 'ok' && V.tests.leak === 'ok', '#ypiece']);
      return S;
    case 'man':
      S.push([V.standby ? 'Touch Quick start Man/Spon on the Standby page.' : 'Touch the Man/Spon tab, then press the rotary knob.', on && !V.standby && V.mode === 'MAN', V.standby ? '#qsMan' : (D && D.mode === 'MAN' ? '#knob' : '[data-tabmode="MAN"]')]);
      S.push(['Set the APL valve to about 20 to 30 cmH2O, so a squeeze can inflate the lungs (Spont = fully open, no pressure).', V.apl >= 15, '#aplUp']);
      S.push(['Squeeze the bag: press and hold until the chest rises (about 1 second), then let go. Repeat every 5 to 6 seconds.', !V.standby && V.mode === 'MAN' && B.now - B.lastStart < 8, '#bag']);
      S.push(['Watch the CO2 curve and VT: a square capnogram and a sensible VT mean the breaths are going in.', false, '#gfx']);
      return S;
    case 'preox':
      S.push(['Touch FG O2 in the therapy bar, turn the knob to 100, press the knob.', V.set.o2 >= 100, '[data-key="o2"]']);
      S.push(['Touch FG flow, turn it up to 8 to 10 L/min, press the knob. The circle fills with oxygen in a minute or two.', V.set.fgf >= 8, '[data-key="fgf"]']);
      S.push(['Or hold O2+ for a few seconds to fill the system with oxygen at once (it bypasses the vaporiser).', G.fio2 > 90, '#kFlush']);
      S.push(['Watch the O2 in and et values in the gas field: aim for an end-tidal O2 above 90%.', G.fio2 > 94, '#smp']);
      return S;
    case 'setting':
      S.push(['Touch the setting you want to change. It turns yellow.', !!E, '.tctl']);
      S.push(['Turn the rotary knob to the new value.', false, '#knob']);
      S.push(['Press the rotary knob to confirm. If you do not within 15 seconds, the change is dropped.', false, '#knob']);
      return S;
    case 'vap':
      S.push(['Turn the vaporiser up with its + (the pink panel).', V.vap > 0, '#vapUp']);
      S.push(['Make sure fresh gas is flowing: the agent only reaches the patient with the fresh gas.', (V.set.fgf || 0) > 0, '[data-key="fgf"]']);
      S.push(['Watch Sev in and et, and xMAC, in the gas field.', G.etag > 0.3, '#smp']);
      return S;
    case 'silence':
      S.push(['Read the alarm in the message bar and deal with its cause.', false, '#msgbar']);
      S.push(['Press the Alarm silence key under the screen: the tones stop for 2 minutes.', V.audioPause > 0, '#kAudio']);
      return S;
    case 'standby':
      S.push(['Press the On / Standby key.', !$('#dlg').hidden || V.standby, '#kPower']);
      S.push(['Confirm Standby on the screen (or press the knob).', V.standby, '#dlgGo']);
      return S;
  }
  return S;
}
function guideHighlight() {
  $$('.g-hl').forEach(el => el.classList.remove('g-hl'));
  if (!guideTask || !guideOpen || isAssess()) return;
  const next = taskSteps(guideTask).find(s => !s[1]);
  if (!next || !next[2]) return;
  const el = $(next[2]);
  if (el && el.offsetParent !== null) el.classList.add('g-hl');
}
const r0 = v => v === null || v === undefined ? '--' : Math.round(v);
/* what the machine is doing now, in plain words */
function guideNow() {
  if (!V.power) return ['The machine is switched off. Press the round On / Standby key under the screen to switch it on.'];
  if (V.selftest > 0) return ['The machine is starting up.'];
  const out = [];
  if (V.standby) {
    if (V.testRun) out.push('<b>' + TEST_NAME[V.testRun.kind] + ' running.</b> Keep the Y-piece sealed on the circuit plug until it finishes.');
    else if (V.tests.sys !== 'ok' || V.tests.leak !== 'ok') out.push('<b>Standby.</b> No ventilation and no fresh gas. Before the first patient, run the system test and leak test (Tests...): seal the Y-piece on the circuit plug first.');
    else out.push('<b>Standby, tests passed.</b> Connect the Y-piece to the patient, then Start... (choose the mode, press the knob) or Quick start Man/Spon.');
    if (G.ySealed && !V.testRun) out.push('The Y-piece is sealed on the circuit plug: connect it to the patient before you start.');
  } else {
    out.push(`<b>${esc(mName(V.mode))}.</b> ${esc(MODE_EXPLAIN[V.mode] || '')}`);
    const sinceBreath = B.now - B.lastStart;
    if (V.mode === 'MAN') {
      out.push(V.apl <= 0 ? 'The APL valve is at Spont (fully open): the patient can breathe freely, but squeezing the bag builds almost no pressure. Turn it up to hand-ventilate.'
        : `The APL valve is at ${V.apl} cmH2O: a squeeze of the bag can reach up to ${Math.min(V.apl, BAG_SQUEEZE)} cmH2O.`);
      if (sinceBreath > 8) out.push(`<span class="g-warn">No breath for ${Math.round(sinceBreath)} s.</span> If the patient is not breathing, squeeze the bag (press and hold, then let go) every 5 to 6 seconds, or start a ventilator mode.`);
      if (G.circP > 10) out.push(`<span class="g-warn">The pressure in the breathing system is ${Math.round(G.circP)} cmH2O and the bag is overfull.</span> The fresh gas has nowhere to go: open the APL valve or turn the fresh-gas flow down.`);
    }
    if (G.bag < 0.6 && !V.standby) out.push('<span class="g-warn">The bag is nearly empty:</span> more gas is leaving the system than the fresh gas brings in. Look for a leak or a disconnection; turn the flow up or press O2+.');
    const fg = G.fg || freshGas();
    if (!(fg.total > 0)) out.push('<span class="g-warn">No fresh gas is flowing.</span> Set FG flow.');
    else if (G.fio2 < V.set.o2 - 10 && V.o2sw !== 'add') out.push(`The inspired O2 (${r0(G.fio2)}%) is still below the fresh-gas O2 (${V.set.o2}%): at ${fmt(fg.total, 1)} L/min the breathing system fills slowly. Turn FG flow up (8 to 10 L/min) or press O2+ to raise it quickly.`);
    if (V.set.carrier === 1 && (V.set.fgf || 0) < 1) out.push('N2O at a low flow: the oxygen in the circle can fall well below the fresh-gas O2. Watch FiO2.');
    if (V.vap > 0 || G.etag > 0.05) out.push(`Sevoflurane: ${fmt(V.vap, 1)}% on the dial, end-tidal ${fmt(G.etag, 1)}% (xMAC ${fmt(xMAC(), 1)}, age ${patientAge()}). At low flows it takes several minutes to change.`);
    if (D) out.push(`<span class="g-warn">New mode selected: ${esc(mName(D.mode, D.set))}.</span> Check its settings (light green), then press the rotary knob to start it. Touch the dark-green tab to cancel.`);
    if (E) out.push(`<span class="g-warn">Changing ${esc(E.scope === 'lim' ? limLabel(E.key) : CTRL[E.key].label)}:</span> turn the knob, then press it to confirm (${Math.max(0, Math.ceil(EDIT_TIMEOUT_S - (B.now - E.t0)))} s left).`);
    if (M.vte !== null && M.vte !== undefined && V.mode !== 'MAN') {
      const ibw = calcIBW(), perKg = M.vte / ibw;
      let line = `Measured: VT ${r0(M.vte)} mL (${fmt(perKg, 1)} mL/kg of ideal body weight, ${ibw} kg), RR ${r0(M.ftot)}/min, MV ${fmt(M.mv, 1)} L/min, PIP ${r0(M.ppeak)}` + (M.pplat !== null && M.pplat !== undefined ? `, Pplat ${r0(M.pplat)}` : '') + ' cmH2O.';
      if (perKg > 8.5) line += ' <span class="g-warn">VT is above 8 mL/kg.</span>';
      else if (perKg < 5 && M.vte > 0) line += ' <span class="g-warn">VT is small.</span>';
      if (M.pplat > 30) line += ' <span class="g-warn">Pplat is above 30.</span>';
      out.push(line);
    }
    if (active.has('plimit')) out.push('The volume breaths are being limited at Pmax, so the set VT is not going in. Find out why the pressure is high before raising Pmax.');
  }
  return out;
}
function renderGuide() {
  const aside = $('#guide'); if (!aside) return;
  const assess = isAssess();
  aside.hidden = assess;
  aside.classList.toggle('closed', !guideOpen);
  $('#guideToggle').setAttribute('aria-expanded', guideOpen);
  if (assess || !guideOpen) { if (lastGuide) { $('#guideBody').innerHTML = ''; lastGuide = ''; } return; }
  let h = '<h3>What is happening</h3><ul class="g-now">' + guideNow().map(t => `<li>${t}</li>`).join('') + '</ul>';
  const al = topAlarms();
  if (al.length) h += '<h3>Alarms</h3>' + al.map(a => `<div class="g-al ${a.p}">${PRI_MARK[a.p]} ${esc(a.t)}</div>${HELP[a.id] || ''}`).join('');
  if (guideTask) {
    const steps = taskSteps(guideTask), next = steps.findIndex(s => !s[1]);
    const name = TASKS.find(t => t[0] === guideTask)[1];
    h += `<h3>How to: ${esc(name)}</h3><ol class="g-steps">` + steps.map((s, i) => `<li class="${s[1] ? 'done' : i === next ? 'next' : ''}">${esc(s[0])}</li>`).join('') + '</ol>'
      + (next < 0 ? '<p class="g-ok">Done.</p>' : '<p class="g-small">The control for the next step is outlined on the machine.</p>') + '<button class="g-btn" id="gDone">Close these steps</button>';
  }
  h += '<h3>What\'s this?</h3><p class="g-tip">' + (lastTip ? esc(lastTip) : 'Rest the mouse on any part of the machine (or touch it) to see what it is.') + '</p>';
  h += '<h3>How do I…</h3><div class="g-tasks">' + TASKS.map(([k, n]) => `<button class="g-task ${guideTask === k ? 'on' : ''}" data-task="${k}">${esc(n)}</button>`).join('') + '</div>';
  if (h !== lastGuide) { $('#guideBody').innerHTML = h; lastGuide = h; }
}
