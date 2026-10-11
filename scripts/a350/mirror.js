function ventStateNow() {
  const state = !V.power ? 'off' : V.selftest > 0 ? 'selftest' : V.ambient ? 'ambient' : V.standby ? 'standby' : 'ventilating';
  const mk = modeKey(), c = modeCtrls(mk);
  const show = k => CTRL[k].label + ' ' + valStr('ctrl', k, V.set[k]) + (CTRL[k].unit ? ' ' + CTRL[k].unit : '');
  const ctl = c.vent.concat(FG).filter(k => V.set[k] !== undefined && CTRL[k]).map(show).join(' · ')
    + (mk === 'MAN' ? ' · APL ' + (V.apl > 0 ? V.apl + ' cmH2O' : 'Spont') + (G.autoBag ? ' · Hands-free bag ' + G.bagRate + '/min' : '') : '') + (V.vap > 0 ? ' · Sevo ' + fmt(V.vap, 1) + '%' : '');
  const limKeys = Object.keys(ALIM).filter(k => !ALIM[k].hidden && V.lim[k] !== undefined);
  const lim = limKeys.map(k => limLabel(k) + ' ' + valStr('lim', k, V.lim[k])).join(' · ');
  const mon = {};
  ['ppeak', 'pplat', 'peep', 'vte', 'mv', 'ftot'].forEach(k => { const v = finiteOr(M[k]); if (v !== null) mon[k] = v; });
  if (V.power && !V.standby) {
    mon.fio2 = finiteOr(G.fio2);
    mon.fgf = finiteOr(G.fg ? G.fg.total : 0);
    if (G.etag > 0.04) mon.etag = finiteOr(G.etag);
    const mac = xMAC(); if (mac > 0.05) mon.mac = finiteOr(mac);
  }
  const lv = JSON.stringify(limKeys.map(k => [k, limLabel(k), V.lim[k], String(valStr('lim', k, V.lim[k])), ALIM[k].unit || ''])).slice(0, 1500);
  return {
    state, mode:mk, label:String(modeLabel()).slice(0, 24), ctl:ctl.slice(0, 300), lim:lim.slice(0, 300), mon,
    o2:finiteOr(measuredO2()) || 0,
    alarms:topAlarms().map(a => a.p + ':' + a.t).join('|').slice(0, 600),
    win:String(win || '').slice(0, 16), locked:false, sex:V.sex, height:V.set.height, ibw:finiteOr(calcIBW()) || 0,
    tests:('system ' + (V.tests.sys || 'not done') + ', leak ' + (V.tests.leak || 'not done')).slice(0, 40),
    embedded:EMBEDDED, model:'a350', phys:physNow(), sv:settingsJSON(mk, c), lv, ts:Date.now()
  };
}
