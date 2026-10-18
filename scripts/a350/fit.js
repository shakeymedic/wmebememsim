/* The anaesthetic machine's scaling (replaces the transport ventilator's fitDevice). The machine is drawn at 1500 x 900 and scaled to fit. On a tall screen (a tablet held upright) it is stacked
   instead, at 1100 x 1330: the screen on top, the gas and breathing system underneath (.portrait, the
   simulator's arrangement), so it fills the width rather than sitting small in the middle.
   --hit and --shit are 44 CSS px in the machine's and the screen's own pixels: the touch targets use them. */
const DEV_TALL_W = 1100, DEV_TALL_H = 1330;
function fitDevice() {
  const wrap = $('#device'), sc = $('#t1scaler'), t1 = $('#t1');
  const W = wrap.clientWidth, H = wrap.clientHeight - 4;
  const tall = H > W * 1.1;
  t1.classList.toggle('portrait', tall);
  const dw = tall ? DEV_TALL_W : DEV_W, dh = tall ? DEV_TALL_H : DEV_H;
  const s = Math.max(0.2, Math.min(W / dw, H / dh));
  t1.style.transform = 'scale(' + s + ')'; t1.style.transformOrigin = '0 0';
  sc.style.width = (dw * s) + 'px'; sc.style.height = (dh * s) + 'px';
  const box = $('#screenbox'), ss = box.clientWidth / 1280;
  $('#screen').style.transform = 'scale(' + ss + ')';
  t1.style.setProperty('--hit', (44 / s).toFixed(1) + 'px');
  t1.style.setProperty('--shit', (44 / (s * ss)).toFixed(1) + 'px');
}
