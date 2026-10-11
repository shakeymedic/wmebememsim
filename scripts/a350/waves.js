/* the three curves: Paw, Flow and CO2. The IFU does not give the colours (they are configurable, and the agent
   and gas colours follow ISO 5359): these are the simulator's, with CO2 grey as in the ISO gas colours. */
function waveOpts() {
  const ph = V.lim.phigh;
  const pTop = niceTop(Math.max(ph, G.circP + 5), [20, 40, 60, 80, 100]);
  let fmax = 0; for (let i = 0; i < NBUF; i++) fmax = Math.max(fmax, Math.abs(bufF[i]));
  const fTop = niceTop(fmax * 1.05, [30, 60, 90, 120, 180]);
  let cmax = 0; for (let i = 0; i < NBUF; i++) cmax = Math.max(cmax, bufC[i]);
  const cTop = niceTop(cmax * 1.1, [6, 8, 10, 12]);
  return {
    paw: {ymin:-5, ymax:pTop, colour:'#ffd84a', label:'Paw', unit:'cmH2O', ticks:[0, pTop / 2, pTop], lines:[{v:ph, c:'#e5372b'}], marks:false},
    flow:{ymin:-fTop, ymax:fTop, colour:'#7fd3ff', label:'Flow', unit:'L/min', ticks:[-fTop, 0, fTop]},
    co2: {ymin:0, ymax:cTop, colour:'#d8d8d8', label:'CO2', unit:'kPa', ticks:[0, cTop / 2, cTop]}
  };
}
function drawWaves() {
  if (!V.power || V.selftest > 0 || V.standby) { CV.forEach(cv => prepCanvas(cv).clearRect(0, 0, GW, GH)); return; }
  const o = waveOpts();
  drawWave(CV[0], bufP, o.paw);
  drawWave(CV[1], bufF, o.flow);
  drawWave(CV[2], bufC, o.co2);
}
