/* ---------- front-panel keys ---------- */
let pwT = null, pwLong = false;
const kPower = $('#kPower');
kPower.addEventListener('pointerdown', () => { pwLong = false; clearTimeout(pwT); pwT = setTimeout(() => { pwLong = true; powerHold(); }, 3000); });
['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => kPower.addEventListener(ev, () => clearTimeout(pwT)));
kPower.addEventListener('click', () => {
  if (pwLong) { pwLong = false; return; }
  if (!V.power) { powerOn(); return; }
  if (V.selftest > 0) return;
  if (V.standby) { scrToast('In Standby: hold the key for 3 seconds to switch the machine off.'); return; }
  $('#dlg').hidden = false;
});
function powerHold() {
  if (!V.power) return;
  if (!V.standby) { scrToast('Go to Standby first (press the key, then confirm Standby).'); return; }
  V.power = false; win = null; E = null; D = null; active.clear(); $('#dlg').hidden = true; V.testRun = null; setPhysical([]);
  logEvent('Machine switched off', 'info'); renderAll();
}
function powerOn() {
  V.power = true; V.selftest = 4; V.standby = true; V.standbySince = B.now;
  $('#lamp').className = 't1-lamp'; void $('#lamp').offsetWidth; $('#lamp').classList.add('self');
  renderAll();
}
$('#kAudio').addEventListener('click', () => { if (!V.power) return; V.audioPause = V.audioPause > 0 ? 0 : AUDIO_PAUSE_S; if (V.audioPause) logEvent('Alarms silenced for 2 minutes', 'info'); renderAll(); });
$('#kLight').addEventListener('click', () => { V.light = !V.light; renderLEDs(); });
$('#btnSound').addEventListener('click', e => { V.sound = !V.sound; e.currentTarget.setAttribute('aria-pressed', V.sound); if (V.sound) beep(1, 0.2, 700); });

/* ---------- the machine's hardware (the simulator's arrangement and scales; the supply pressures shown are
   typical UK pipeline values, not measured) ---------- */
/* the vaporiser: a sevoflurane dial, 0 to 8% in 0.2% steps (simulator's scale) */
function setVap(v) {
  const was = V.vap; V.vap = clamp(Math.round(v * 5) / 5, 0, 8);
  if (V.vap !== was) logEvent('Vaporiser: sevoflurane ' + fmt(V.vap, 1) + '%', 'info');
  renderHW();
}
$('#vapUp').addEventListener('click', () => setVap(V.vap + (V.vap >= 2 ? 0.5 : 0.2)));
$('#vapDn').addEventListener('click', () => setVap(V.vap - (V.vap > 2 ? 0.5 : 0.2)));
/* O2+: oxygen straight into the breathing system while it is held (it bypasses the vaporiser) */
const kFlush = $('#kFlush');
function flush(on) {
  if (on === G.flush) return;
  G.flush = on;
  if (on) logEvent('O2+ (oxygen flush)', 'info');
  renderHW();
}
kFlush.addEventListener('pointerdown', e => { e.preventDefault(); try { kFlush.setPointerCapture(e.pointerId); } catch (er) {} flush(true); });
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => kFlush.addEventListener(ev, () => flush(false)));
kFlush.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); flush(true); } });
kFlush.addEventListener('keyup', e => { if (e.key === ' ' || e.key === 'Enter') flush(false); });
/* the O2 switch: Aux. O2 (to an O2 outlet for a mask or nasal cannula) or Add. O2 (into the breathing system) */
$('#o2sw').addEventListener('click', () => {
  V.o2sw = V.o2sw === 'add' ? 'aux' : 'add';
  logEvent('O2 switch: ' + (V.o2sw === 'add' ? 'Add. O2' : 'Aux. O2'), 'info'); renderHW();
});
const setAux = v => { V.auxO2 = clamp(v, 0, 10); renderHW(); };
$('#auxUp').addEventListener('click', () => setAux(V.auxO2 + 1));
$('#auxDn').addEventListener('click', () => setAux(V.auxO2 - 1));
/* the APL valve: Spont (fully open) or 5 to 70 cmH2O for Man */
const setAPL = v => { const was = V.apl; V.apl = v < 5 ? 0 : clamp(v, 5, 70); if (V.apl !== was) logEvent('APL valve: ' + (V.apl ? V.apl + ' cmH2O' : 'Spont'), 'info'); renderHW(); renderRcol(); };
$('#aplUp').addEventListener('click', () => setAPL(V.apl <= 0 ? 5 : V.apl + 5));
$('#aplDn').addEventListener('click', () => setAPL(V.apl - 5));
/* the breathing bag: squeeze (hold) to give a breath in Man/Spon; letting go ends it */
const bagEl = $('#bag');
/* why the bag cannot be squeezed now (and what to do), or '' when it can */
function bagBlocked() {
  if (!V.power) return 'The machine is switched off. Press the On / Standby key.';
  if (V.selftest > 0) return 'The machine is still starting up.';
  if (V.standby) return 'standby';
  if (V.mode !== 'MAN') return 'The ventilator is breathing for the patient. Choose Man/Spon to ventilate by hand.';
  return '';
}
function squeeze(on, auto) {
  if (on) {
    const why = bagBlocked();
    if (why) {
      if (auto) return;
      if (why === 'standby') openWin('start'); else if (!V.power) toast(why); else if (V.selftest <= 0) scrToast(why);
      return;
    }
    if (G.squeeze !== null) return;
    G.squeeze = B.now; V.manualReq = true; G.abSq = !!auto;
    if (G.autoBag) G.abLast = B.now;   /* a squeeze by hand counts as one of the hands-free breaths */
  } else {
    if (G.squeeze === null) return;
    G.squeeze = null; V.manualReq = false; G.abSq = false;
    const br = B.br;
    if (B.phase === 'insp' && br && br.kind === 'manual' && !br.vc && B.t < br.Ti) {
      /* let go early: the breath ends now, with the volume it had reached */
      const g = t => 1 - Math.exp(-t / br.tau);
      br.VT *= g(B.t) / Math.max(0.01, g(br.Ti));
      br.Ti = Math.max(0.15, B.t);
    }
  }
  renderHW();
}
bagEl.addEventListener('pointerdown', e => { e.preventDefault(); try { bagEl.setPointerCapture(e.pointerId); } catch (er) {} squeeze(true); });
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => bagEl.addEventListener(ev, () => { if (!G.abSq) squeeze(false); }));
bagEl.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); squeeze(true); } });
bagEl.addEventListener('keyup', e => { if ((e.key === ' ' || e.key === 'Enter') && !G.abSq) squeeze(false); });
/* hands-free bagging (the simulator's own control, not part of the A350): squeezes the bag for about a second at the set
   rate until it is stopped, so the learner does not have to keep pressing. The pressure each squeeze reaches is still set
   by the APL valve. It stops by itself when the machine leaves Man/Spon, goes to Standby or is switched off. */
const BAG_TI = 1.0;
const setBagRate = v => { const was = G.bagRate; G.bagRate = clamp(v, 4, 30); if (G.autoBag && G.bagRate !== was) logEvent('Hands-free bagging: ' + G.bagRate + '/min', 'info'); renderHW(); };
function setAutoBag(on, why) {
  if (on === G.autoBag) return;
  if (on) {
    const b = bagBlocked();
    if (b) { if (b === 'standby') openWin('start'); else if (!V.power) toast(b); else scrToast(b); return; }
    G.autoBag = true; G.abLast = -1e9;
    logEvent('Hands-free bagging started: ' + G.bagRate + '/min', 'info');
  } else {
    G.autoBag = false;
    if (G.abSq) squeeze(false);
    logEvent('Hands-free bagging stopped' + (why ? ' (' + why + ')' : ''), 'info');
    if (why) scrToast('Hands-free bagging stopped: ' + why + '.');
  }
  renderHW();
}
function bagTick() {
  if (!G.autoBag) return;
  const b = bagBlocked();
  if (b) { setAutoBag(false, !V.power ? 'machine switched off' : V.standby ? 'Standby' : 'a ventilator mode was started'); return; }
  if (G.abSq && B.now - G.squeeze >= BAG_TI) squeeze(false);
  else if (G.squeeze === null && B.now - G.abLast >= 60 / G.bagRate) squeeze(true, true);
}
$('#abOn').addEventListener('click', () => setAutoBag(!G.autoBag));
$('#abUp').addEventListener('click', () => setBagRate(G.bagRate + 2));
$('#abDn').addEventListener('click', () => setBagRate(G.bagRate - 2));
/* the Y-piece: sealed on the circuit plug of the bag elbow (for the tests) or connected to the patient */
function setYPiece(sealed) {
  if (G.ySealed === sealed) return;
  G.ySealed = sealed;
  P.pr = sealed ? sealedLung() : {...P.base};
  logEvent(sealed ? 'Y-piece sealed on the circuit plug' : 'Y-piece connected to the patient', 'info');
  renderHW();
}
$('#ypiece').addEventListener('click', () => setYPiece(!G.ySealed));
function renderHW() {
  const fgOn = V.power && !V.standby;
  $('#vapVal').textContent = fmt(V.vap, 1);
  $('#vapNeedle').style.transform = 'rotate(' + (V.vap / 8 * 270 - 135) + 'deg)';
  kFlush.classList.toggle('lit', G.flush);
  const sw = $('#o2sw'); sw.textContent = V.o2sw === 'add' ? 'Add. O2' : 'Aux. O2'; sw.classList.toggle('add', V.o2sw === 'add');
  $('#auxVal').textContent = V.auxO2;
  $('#aplVal').textContent = V.apl > 0 ? V.apl : 'Spont';
  const o2 = P && !P.o2fail;
  $('#supply').innerHTML = `<span class="${o2 ? '' : 'bad'}">O2<b>${o2 ? '4.1' : '0.0'}</b>bar</span><span>Air<b>4.1</b>bar</span><span>N2O<b>4.1</b>bar</span><span>Fresh gas<b>${fgOn && G.fg ? fmt(G.fg.total, 1) : '0.0'}</b>L/min</span>`;
  /* the bag: its size follows the volume in it; squeezed while a hand breath is going in */
  const full = clamp(G.bag / BAG_L, 0.15, 1.25), sq = G.squeeze !== null && B.phase === 'insp';
  bagEl.classList.toggle('sq', sq);
  const ab = $('#abOn');
  ab.classList.toggle('on', G.autoBag); ab.setAttribute('aria-pressed', G.autoBag);
  ab.innerHTML = G.autoBag ? 'Hands-free <b>On</b>' : 'Hands-free <b>Off</b>';
  $('#abVal').textContent = G.bagRate;
  $('#bagIn').style.transform = 'scale(' + (0.55 + 0.4 * full) * (sq ? 0.8 : 1) + ',' + (0.5 + 0.45 * full) * (sq ? 0.85 : 1) + ')';
  const y = $('#ypiece');
  y.classList.toggle('sealed', G.ySealed);
  y.innerHTML = `<svg viewBox="0 0 60 46" aria-hidden="true"><path d="M8 4l22 22 22-22M30 26v18"/></svg>${G.ySealed ? 'Y-piece on the circuit plug<br><small>(touch to connect the patient)</small>' : 'Y-piece on the patient<br><small>(touch to seal it on the plug)</small>'}`;
}
