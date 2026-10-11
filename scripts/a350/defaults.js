function deviceDefaults() {
  Object.assign(V, {power:false, selftest:0, standby:true, ambient:false, mode:'MAN', set:{...DEFAULT_SET}, lim:{...DEFAULT_LIM}, backupOn:false, cpr:null, psync:false, sigh:false, aprvInit:false,
    gfx:'wave', locked:false, night:false, o2Enrich:0, audioPause:0, manualReq:false, neb:0, startSuppress:0, standbySince:B.now, testRun:null, testMsg:'', tests:{sys:null, leak:null},
    apl:30, vap:0, o2sw:'aux', auxO2:0, light:false, more:false, caseStart:B.now, modeSince:B.now});
  V.sex = LIVE.sex === 'Female' ? 'Female' : 'Male';
  V.set.height = V.sex === 'Female' ? 162 : 174;
  if (LIVE.age !== null && LIVE.age !== undefined) V.set.age = clamp(Math.round(LIVE.age), 1, 110);
  Object.assign(G, {fio2:21, fin2o:0, etn2o:0, fiag:0, etag:0, bag:2.0, circP:0, flush:false, squeeze:null, ySealed:false, fg:null, lastCO2:0, fgLowT:0, pcontT:0, plowT:0, apneaT:0, autoBag:false, abSq:false, abLast:-1e9});
  P.pr = {...P.base};
  E = null; D = null; active.clear(); inactive.clear(); history.length = 0; helpFor = null; cursor = -1;
  for (const k in M) M[k] = null;
  Object.assign(B, {phase:'exp', t:0, br:null, starts:[], types:[], apnoeaVent:false, missLog:[], tiMaxLog:[], autoLog:[], lowVtCount:0, highVtCount:0, lossPeepT:0, highPeepCount:0, highPT:0, vols:[], apvP:10, vsP:10, ovl:null, Vee:0, vEndInsp:0, nBreaths:0, vlimit:false, apvLim:false, vcLim:0, vcLimVt:0});
  TR.o2.length = 0; TR.flow.length = 0; TR.lastMin = -1;
  bufC.fill(0); bufP.fill(0); bufF.fill(0); bufV.fill(0); bufPl.fill(0); bufTrig.fill(0);
  P.onNivMin = 0; P.batt = 100; probsNow = []; applyProblems(VP.probList(LIVE.config && LIVE.config.probs));
  $('#dlg').hidden = true;
  setPhysical([]);
  win = null;
  renderAll();
}

