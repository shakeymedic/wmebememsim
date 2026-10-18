// =================================================================================================
// THE ICU VENTILATOR PAGE  (node scripts/make-c6.mjs  ->  vent/c6.html)
//
// The ICU ventilator (Anaesthetics / ICU on the start screen) is generated from the
// transport ventilator page (vent/index.html), so the two share ONE breath engine, alarm logic, window code and
// simulator link layer. Edit vent/index.html, then run this script; never edit vent/c6.html by hand.
// tests/specs/c6.spec.js fails if vent/c6.html is out of date.
//
// What changes for the ICU ventilator (from the ICU ventilator Operator's Manual, SW 1.2.x, document 10197564/00,
// as noted beside each item; anything else is the simulator's own choice and says so):
//   - the housing: a widescreen touch monitor (1920 x 1200 on the device; drawn here at 1280 x 800)
//     with the alarm lamp on top and the keys of Fig 2-2: Manual breath, O2 enrichment, Audio pause,
//     Screen lock/unlock, Nebuliser, Power/Standby, Print screen and the Press-and-Turn knob. The ICU ventilator
//     has no Day/Night key (Day & Night is under System > Settings). The manual does not give the
//     keys' exact positions: here they sit in a row under the screen, in the manual's numbering order.
//   - the screen (Fig 2-6): mode name top left, message bar, Modes button, power source and time top
//     right, MMPs down the left, the graphics in the middle, the active mode's main controls along the
//     bottom, and the window buttons (Alarms, Controls, Monitoring, Graphics, Tools, Events, System).
//     Colours other than those the manual states (yellow = selected, orange = being adjusted, green =
//     O2 enrichment, red / yellow alarms) are the simulator's.
//   - the modes (Table 2-1): adds the volume-controlled (S)CMV and SIMV (constant flow, with an
//     inspiratory pause), uses the manual's default APVcmv / APVsimv names, and has no VS.
//   - wider control and alarm ranges (Tables 16-5 and 16-9).
// It is an independent training simulator, not made, endorsed or supported by any ventilator manufacturer.
// =================================================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'vent', 'index.html');
const OUT = path.join(ROOT, 'vent', 'c6.html');

let html = fs.readFileSync(SRC, 'utf8');
const fail = (msg) => { console.error('[make-c6] FAILED: ' + msg); process.exit(1); };
// Replace exactly one occurrence (or `count`), so a change to the transport ventilator page that breaks a rule stops the build.
const sub = (from, to, count = 1) => {
    const n = html.split(from).length - 1;
    if (n !== count) fail(`expected ${count} of: ${from.slice(0, 90)} (found ${n})`);
    html = html.split(from).join(to);
};
// Replace everything from the line holding `a` up to (not including) the line holding `b`.
const between = (a, b, to) => {
    const i = html.indexOf(a), j = html.indexOf(b, i + 1);
    if (i < 0 || j < 0) fail(`markers not found: ${a.slice(0, 60)} / ${b.slice(0, 60)}`);
    const li = html.lastIndexOf('\n', i) + 1, lj = html.lastIndexOf('\n', j) + 1;
    html = html.slice(0, li) + to + html.slice(lj);
};

// ---- page head ---------------------------------------------------------------------------------
sub('<title>EM Evidence — Ventilator Simulator</title>', '<title>EM Evidence — ICU Ventilator Simulator</title>');
sub(`<!--
  THE TRANSPORT VENTILATOR, AS A SIMULATION DEVICE.`, `<!--
  GENERATED FILE: made from vent/index.html by scripts/make-c6.mjs. Do not edit; edit the transport ventilator page and rerun.
  THE ICU VENTILATOR, AS A SIMULATION DEVICE. It shares the transport ventilator page's breath engine.`);
sub('<span class="title">Transport ventilator</span>', '<span class="title">ICU ventilator</span>');

// ---- styles: the housing and the main screen ---------------------------------------------------
between('/* ===== Simulator: device housing', '/* windows */', `/* ===== Simulator: the ICU ventilator monitor (designed at ${'1360 x 1000'} px, scaled to fit) ===== */
.t1-wrap{position:relative;width:100%;overflow:hidden;border-radius:14px;background:radial-gradient(ellipse at 50% 35%,#ffffff 0,#e9eef3 60%,#dfe5eb 100%);padding:10px 0 4px}
.t1-scaler{position:relative;margin:0 auto;transform-origin:0 0}
.fs-exit{display:none}
body.t1fs{overflow:hidden}
body.t1fs .t1-wrap{position:fixed;inset:0;z-index:1000;width:auto;border-radius:0;padding:0;overflow:hidden;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 40%,#4a5058 0,#2a2e33 60%,#1b1e22 100%)}
body.t1fs .t1-scaler{margin:0}
body.t1fs .fs-exit{display:block;position:absolute;top:10px;right:10px;z-index:2;background:rgba(15,27,45,.55);color:#fff;border:1px solid rgba(255,255,255,.35);border-radius:8px;padding:6px 12px;font-size:.85rem;font-weight:600;opacity:.6;cursor:pointer}
body.t1fs .fs-exit:hover,body.t1fs .fs-exit:focus-visible{opacity:1}
.t1{position:absolute;left:0;top:0;width:1360px;height:1000px;font-family:"Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;user-select:none;-webkit-user-select:none}
.t1 button{font-family:inherit}
/* the monitor: a dark frame round a widescreen touch screen, the alarm lamp along the top edge */
.c6-body{position:absolute;left:0;top:14px;width:1360px;height:984px;border-radius:30px;background:linear-gradient(180deg,#4a5057 0,#30353a 6%,#25292d 70%,#1d2023 100%);box-shadow:0 12px 28px rgba(0,0,0,.4),inset 0 0 0 2px #5d646b,inset 0 2px 2px rgba(255,255,255,.18)}
.t1-lamp{position:absolute;left:380px;top:0;width:600px;height:26px;border-radius:13px 13px 6px 6px;background:linear-gradient(180deg,#eef1f4,#bfc5ca);box-shadow:inset 0 -2px 3px rgba(0,0,0,.25),0 1px 0 #fff}
.t1-lamp.hi{background:#ff2a1f;box-shadow:0 0 22px 6px rgba(255,42,31,.75);animation:t1blink .7s steps(2,start) infinite}
.t1-lamp.med{background:#ffd400;box-shadow:0 0 18px 4px rgba(255,212,0,.7);animation:t1blink 1.4s steps(2,start) infinite}
.t1-lamp.low{background:#ffd400;box-shadow:0 0 14px 3px rgba(255,212,0,.6)}
.t1-lamp.self{animation:t1self 1s steps(2,start) 3}
@keyframes t1blink{50%{background:linear-gradient(180deg,#eef1f4,#bfc5ca);box-shadow:none}}
@keyframes t1self{0%{background:#ffd400}50%{background:#ff2a1f}}
.t1-screenbox{position:absolute;left:40px;top:58px;width:1280px;height:800px;background:#000;border-radius:3px;box-shadow:0 0 0 3px #0b0c0d,0 0 0 4px #61686f}
.t1-name{position:absolute;left:46px;top:888px;color:#f2f4f6;font-weight:700;font-size:30px;letter-spacing:2px}
.t1-name small{display:block;font-size:12px;font-weight:600;letter-spacing:1.5px;color:#9aa3ab;margin-top:2px}
/* the keys under the screen (Fig 2-2 numbering order), backlit when active */
.t1 .k{position:absolute;top:880px;width:88px;height:66px;background:linear-gradient(180deg,#17191b,#060707);border:2px solid #aeb4b9;border-radius:12px;color:#f2f4f6;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;box-shadow:0 2px 3px rgba(0,0,0,.6)}
.t1 .k:active{transform:translateY(1px);border-color:#fff}
.t1 .k:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}
.t1 .k svg{width:32px;height:32px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.t1 .k.lit{border-color:#5ff07f;box-shadow:0 0 12px rgba(95,240,127,.7),inset 0 0 10px rgba(95,240,127,.35)}
.t1 .k.litred{border-color:#ff3b30;box-shadow:0 0 12px rgba(255,59,48,.7),inset 0 0 10px rgba(255,59,48,.35)}
.t1 .k.pw{width:72px;height:72px;top:877px;border-radius:50%;border:3px solid #9da3a8}
.t1 .k.pw.on{border-color:#5ff07f;box-shadow:0 0 10px rgba(95,240,127,.65),inset 0 0 6px rgba(95,240,127,.3)}
.t1 .k .o2{font-weight:700;font-size:18px;display:flex;align-items:center;gap:1px}
.t1 .k .o2 sub{font-size:11px;margin-top:8px}
.t1 .k .min{font-size:10px;font-weight:800;margin-left:4px}
.t1 .k.ap{width:118px}
.t1 .led{display:none}
.t1 .klbl{position:absolute;top:952px;font-size:11px;color:#aab2b9;text-align:center;width:110px;letter-spacing:.3px}
/* the Press-and-Turn knob, bottom right */
.t1-knob{position:absolute;left:1206px;top:868px;width:112px;height:112px;border-radius:50%;cursor:grab;touch-action:none;padding:0;border:0;background:repeating-conic-gradient(from 0deg,#3b3f43 0 5deg,#1c1e20 5deg 10deg);box-shadow:0 6px 12px rgba(0,0,0,.55),inset 0 0 0 3px #111}
.t1-knob:active{cursor:grabbing}
.t1-knob:focus-visible{outline:3px solid #f59e0b;outline-offset:3px}
.t1-knob .rot{position:absolute;inset:0;border-radius:50%}
.t1-knob .rot:after{content:"";position:absolute;left:50%;top:5px;width:3px;height:12px;margin-left:-1.5px;background:#6c7278;border-radius:2px}
.t1-knob .ring{position:absolute;left:18px;top:18px;width:76px;height:76px;border-radius:50%;background:radial-gradient(circle at 40% 35%,#3a3e42,#17191b 70%);box-shadow:0 0 0 5px #1c1f22,0 0 0 8px #59e57a,0 0 14px 8px rgba(89,229,122,.4),inset 0 2px 3px rgba(255,255,255,.12)}
.t1-knob.press .ring{transform:scale(.96)}
/* ===== the screen: designed at 1280 x 800 logical px, scaled into the screen box ===== */
.screen{position:absolute;left:0;top:0;width:1280px;height:800px;transform-origin:0 0;background:#0e141b;color:#fff;overflow:hidden;font-size:16px;line-height:1.15;transition:filter .3s}
.screen.night{filter:brightness(.5)}
.screen button{font-family:inherit;color:inherit;cursor:pointer}
.scr-mode{position:absolute;left:0;top:0;width:260px;height:60px;background:#0e141b;border:0;display:flex;align-items:center;gap:12px;padding:0 14px;font-size:30px;color:#fff;text-align:left}
.scr-mode svg{width:16px;height:30px;fill:#fff;flex:0 0 auto}
.scr-mode span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.scr-msg{position:absolute;left:260px;top:0;width:700px;height:60px;background:#26313c;border:0;color:#fff;font-size:24px;font-weight:600;text-align:center;padding:0 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.scr-msg.hi{background:#e30613;color:#fff}
.scr-msg.med,.scr-msg.low{background:#ffde00;color:#000}
.scr-msg.tech{background:#e30613;color:#fff}
.scr-msg.info{color:#e6e6e6;font-weight:500;font-size:20px}
.scr-modes{position:absolute;left:960px;top:0;width:150px;height:60px;background:#3d6d9e;border:0;border-left:2px solid #0e141b;font-size:22px;font-weight:600;color:#fff}
.scr-modes.open{background:#eef2f6;color:#000}
.mmps{position:absolute;left:0;top:60px;width:220px;height:540px;background:#0e141b}
.mmp{position:absolute;left:0;width:218px;height:80px;background:#22303d;border:0;border-bottom:2px solid #0e141b;text-align:right;padding:2px 14px 0 6px;color:#fff;display:block}
.mmp .v{display:block;font-size:44px;font-weight:400;letter-spacing:-1px;font-variant-numeric:tabular-nums;height:48px;line-height:50px}
.mmp .n{display:inline-block;font-size:16px;color:#fff;line-height:18px;margin-right:6px}
.mmp .u{display:inline-block;font-size:13px;color:#b7c4d1;line-height:18px}
.mmp.alarm .v{color:#ffde00}
.mmp.alarm:after{content:"";position:absolute;right:0;top:0;bottom:0;width:8px;background:#ffde00}
.mmp.alarm.hi:after{background:#ff3b30}
.mmp.alarm.hi .v{color:#ff3b30}
.mmp.cprt .v{color:#ff9a1f;font-size:38px}
.mmp-spo2{position:absolute;left:0;top:490px;width:218px;height:50px;background:#22303d;border:0;color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 14px;font-size:18px}
.mmp-spo2 b{font-weight:400;font-size:24px}
.gfx{position:absolute;left:220px;top:60px;width:860px;height:540px;background:#000;border:0;padding:0;text-align:left}
.gfx canvas{position:absolute;left:0;width:860px;display:block}
.gfx .freeze{position:absolute;right:8px;top:6px;width:26px;height:24px;border:1.5px solid #bbb;border-radius:3px;color:#ddd;font-size:15px;line-height:20px;text-align:center}
.dynlung{position:absolute;left:199px;top:200px;width:462px;height:316px;background:#2493c9;border-radius:2px;overflow:hidden}
.dynlung svg{position:absolute;left:0;top:0;width:462px;height:316px}
.dynlung .dl-pat{position:absolute;left:10px;top:8px;font-size:15px;line-height:1.25;color:#fff}
.dynlung .dl-row{position:absolute;left:0;right:0;bottom:6px;display:flex;justify-content:space-around;text-align:center;font-size:14px;color:#fff;line-height:1.15}
.dynlung .dl-row b{display:block;font-weight:400;font-size:21px}
.dynlung .dl-row small{display:block;font-size:11px;color:#dcefff}
.dynlung .dl-side{position:absolute;right:12px;top:110px;text-align:right;font-size:14px;line-height:1.2}
.dynlung .dl-side b{display:block;font-size:20px;font-weight:400}
.dynlung .dl-note{position:absolute;left:10px;top:76px;font-size:11px;line-height:1.25;color:#e8f5ff;max-width:108px}
/* the secondary monitoring column on the right (the simulator's choice of values) */
.smp{position:absolute;left:1080px;top:60px;width:200px;height:540px;background:#151e27;border-left:2px solid #0e141b;padding:4px 0}
.smp div{display:flex;justify-content:space-between;align-items:baseline;padding:5px 12px;border-bottom:1px solid #26323e;font-size:14px;color:#b7c4d1}
.smp div b{font-weight:400;font-size:24px;color:#fff;font-variant-numeric:tabular-nums}
.smp div small{display:block;font-size:11px;color:#8798a9}
/* the active mode's main controls along the bottom */
.ctlbar{position:absolute;left:0;top:600px;width:1280px;height:130px;background:#0e141b;border-top:2px solid #26313c}
.mctl{position:absolute;top:8px;width:150px;height:114px;background:#3d6d9e;border:0;border-radius:8px;padding:0;color:#fff;box-shadow:inset 0 0 0 2px #5f8fbf}
.mctl .lb{position:absolute;left:0;right:0;top:6px;font-size:16px;text-align:center;white-space:nowrap}
.mctl .c{position:absolute;left:0;right:0;top:30px;display:flex;flex-direction:column;align-items:center;font-size:40px;line-height:1;font-variant-numeric:tabular-nums}
.mctl .c small{font-size:13px;margin-top:4px;color:#dbe7f3}
.mctl .rng{display:none}
.mctl.sel,.wctl.sel .c{box-shadow:0 0 0 4px #ffde00}
.mctl.act{background:#f39200;box-shadow:inset 0 0 0 2px #ffb347}
.mctl.act .c small{color:#fff}
.mctl.act .rng{display:flex;position:absolute;left:10px;right:10px;top:92px;justify-content:space-between;font-size:11px;color:#fff}
.mctl.enrich{background:#5cb03a;box-shadow:inset 0 0 0 2px #7fd05c}
.wctl.act .c{background:#f39200;border-color:#f39200;color:#fff}
.wctl.act .c small{color:#fff}
.wctl.act .rng{display:flex;position:absolute;left:8px;right:8px;top:82px;justify-content:space-between;font-size:11px;color:#bbb}
.rbtn{display:none}
/* the window buttons */
.bbar{position:absolute;left:0;top:730px;width:1280px;height:70px;background:#0e141b;border-top:2px solid #26313c}
.bbtn{position:absolute;top:6px;height:58px;width:150px;background:#2f3d4b;border:0;border-radius:6px;font-size:19px;font-weight:600;color:#fff}
.rbtn.open,.bbtn.open{background:#eef2f6;color:#000}
.bstat{position:absolute;left:1110px;top:0;width:170px;height:60px;display:flex;align-items:center;justify-content:flex-end;gap:7px;padding-right:10px;color:#fff;font-size:12px;background:#0e141b;z-index:4}
.bstat svg{height:24px}
.bstat .ap{color:#ffde00;font-weight:700;font-size:13px;display:flex;align-items:center;gap:2px}
.bstat .clock{font-size:13px;color:#cfd8e0;line-height:1.25;text-align:right;margin-left:4px}
`);
// the windows open over the graphics and the right-hand column; the rest of the window styles are the transport ventilator's
sub('.win{position:absolute;left:180px;top:56px;width:620px;height:484px;', '.win{position:absolute;left:220px;top:60px;width:1060px;height:540px;');
sub('.dlg{position:absolute;left:150px;top:150px;', '.dlg{position:absolute;left:430px;top:230px;');
sub('.lockic{position:absolute;right:160px;top:14px;', '.lockic{position:absolute;right:330px;top:14px;');
sub('.scr-toast{position:absolute;left:190px;top:62px;width:450px;', '.scr-toast{position:absolute;left:400px;top:66px;width:480px;');

// ---- markup: the ICU ventilator monitor --------------------------------------------------------------------
const icon = {
    manual: '<svg viewBox="0 0 30 24" aria-hidden="true"><path d="M15 3v8"/><path d="M15 9c-2 0-3 2-4 2"/><path d="M15 9c2 0 3 2 4 2"/><path d="M11 6.5C7 6.5 4 13 4 18c0 2 1.5 3 3.5 2.5L12 19V11"/><path d="M19 6.5c4 0 7 6.5 7 11.5 0 2-1.5 3-3.5 2.5L18 19V11"/></svg>',
    audio: '<svg viewBox="0 0 24 24" aria-hidden="true" style="stroke:#ff4b3e"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/><path d="M3 3l18 18"/></svg>',
    lock: '<svg viewBox="0 0 34 24" aria-hidden="true"><rect x="5" y="11" width="10" height="8" rx="1"/><path d="M7 11V8a3 3 0 0 1 6 0v3"/><path d="M19 20l6-16"/><rect x="21" y="13" width="9" height="7" rx="1"/><path d="M23 13v-2.5a2.5 2.5 0 0 1 5 0"/></svg>',
    neb: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="9" width="10" height="12" rx="2"/><path d="M10 9V6h4v3"/><path d="M15 4l3-1.5M15 6l3.5 0M15 3l2-2.5"/></svg>',
    power: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/></svg>',
    print: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="9" width="14" height="11" rx="2"/><path d="M9 9V5a2 2 0 0 1 4 0v8"/><path d="M13 9.5a1.6 1.6 0 0 1 3 0V12"/></svg>'
};
const key = (id, cls, left, label, inner) =>
    `                <button class="k ${cls}" id="${id}" style="left:${left}px" aria-label="${label}">${inner}</button>\n` +
    `                <span class="klbl" aria-hidden="true" style="left:${left + (cls.includes('ap') ? 118 : cls.includes('pw') ? 72 : 88) / 2 - 55}px">${label.replace(/ key$/, '')}</span>\n`;
between('        <div class="t1-wrap" id="device">', '        <div class="under" aria-label="Knob controls">', `        <div class="t1-wrap" id="device">
          <button class="fs-exit" id="btnFsExit" aria-label="Exit full screen">✕ Exit full screen</button>
          <div class="t1-scaler" id="t1scaler">
          <div class="t1 c6" id="t1">
            <div class="c6-body" aria-hidden="true"></div>
            <div class="t1-lamp" id="lamp" role="img" aria-label="Alarm lamp"></div>
            <div class="t1-screenbox" id="screenbox">
              <div class="screen" id="screen">
                <button class="scr-mode" id="btnModeName" aria-label="Patient group and active mode. Touch to open Modes"><svg viewBox="0 0 16 30" aria-hidden="true"><circle cx="8" cy="4" r="3.6"/><path d="M3 9h10l1.5 10h-2.5l-.8 10h-2.4l-.6-8h-.4l-.6 8H4.8L4 19H1.5z"/></svg><span id="modeName">APVcmv</span></button>
                <button class="scr-msg" id="msgbar" aria-live="polite" aria-label="Message bar. Touch to open the alarm buffer"></button>
                <button class="scr-modes" id="btnModes" data-open="modes">Modes</button>
                <div class="bstat" id="bstat"></div>
                <div class="lockic" aria-hidden="true">🔒</div>
                <div class="mmps" id="mmps" aria-label="Main monitoring parameters"></div>
                <button class="gfx" id="gfx" aria-label="Graphics. Touch to choose waveforms or panels">
                  <canvas id="cv1" style="top:0;height:178px"></canvas>
                  <canvas id="cv2" style="top:181px;height:178px"></canvas>
                  <canvas id="cv3" style="top:362px;height:178px"></canvas>
                  <div class="dynlung" id="dynlung" hidden></div>
                  <span class="freeze" aria-hidden="true">❄</span>
                </button>
                <div class="smp" id="smp" aria-label="More monitoring"></div>
                <div class="ctlbar" id="rcol" aria-label="Main controls"></div>
                <div class="bbar">
                  <button class="bbtn" data-open="alarms" style="left:8px">Alarms</button>
                  <button class="bbtn" data-open="controls" style="left:166px">Controls</button>
                  <button class="bbtn" data-open="monitoring" style="left:324px">Monitoring</button>
                  <button class="bbtn" data-open="gfx" style="left:482px">Graphics</button>
                  <button class="bbtn" data-open="tools" style="left:640px">Tools</button>
                  <button class="bbtn" data-open="events" style="left:798px">Events</button>
                  <button class="bbtn" data-open="system" style="left:956px">System</button>
                </div>
                <div class="win" id="win" hidden role="dialog" aria-modal="false" aria-label="Window"></div>
                <div class="dlg" id="dlg" hidden role="dialog" aria-label="Activate standby">
                  <button class="wx" id="dlgX" aria-label="Close">✕</button>
                  <h5>Standby</h5>
                  <p>No ventilation delivered to the patient.<br>Deactivate humidifier during Standby.</p>
                  <button class="wb wide" id="dlgGo">Activate standby</button>
                </div>
                <div class="scr-toast" id="scrToast" hidden></div>
                <div class="scr-off" id="scrOff" hidden><span id="scrOffTxt"></span></div>
              </div>
            </div>
            <div class="t1-name">ICU VENTILATOR<small>EMEVIDENCE · TRAINING SIMULATOR</small></div>
${key('kManual', '', 480, 'Manual breath key', icon.manual)}${key('kO2', '', 584, 'O2 enrichment key', '<span class="o2">↑O<sub>2</sub></span>')}${key('kAudio', 'ap', 688, 'Audio pause key', icon.audio + '<span class="min">2 MIN.</span>')}${key('kLock', '', 822, 'Screen lock/unlock key', icon.lock)}${key('kNeb', '', 926, 'Nebuliser key', icon.neb)}${key('kPower', 'pw', 1030, 'Power/Standby key', icon.power)}${key('kPrint', '', 1118, 'Print screen key', icon.print)}            <button class="t1-knob" id="knob" aria-label="Press-and-turn knob. Arrow keys turn it, Enter or Space presses it"><span class="rot" id="knobRot"></span><span class="ring"></span></button>
            <!-- the device code drives these indicators; on the ICU ventilator they light the keys (no Day/Night key, no battery LEDs on the monitor) -->
            <div hidden><button id="kDay" tabindex="-1" aria-hidden="true"></button><b class="led" id="led-day"></b><b class="led" id="led-lock"></b><b class="led" id="led-man"></b><b class="led" id="led-o2"></b><b class="led" id="led-print"></b><b class="led" id="led-neb"></b><b class="led" id="led-audio"></b><b class="led" id="led-b1"></b><b class="led" id="led-b2"></b></div>
          </div>
          </div>
        </div>
`);

// ---- device definitions: the ICU ventilator's ranges and modes ---------------------------------------------
sub('/* ======================= device definitions (transport ventilator SW 3.0.x, adult/ped) ======================= */',
    '/* ======================= device definitions (ICU ventilator SW 1.2.x, adult/ped; ranges from manual Tables 16-5 and 16-9) ======================= */');
sub("  peep:  {label:'PEEP/CPAP', unit:'cmH2O', min:0, max:35, step:1},", "  peep:  {label:'PEEP/CPAP', unit:'cmH2O', min:0, max:50, step:1},");
sub("  ps:    {label:'ΔPsupport', unit:'cmH2O', min:0, max:60, step:1},", "  ps:    {label:'ΔPsupport', unit:'cmH2O', min:0, max:100, step:1},");
sub("  pinsp: {label:'ΔPinsp', unit:'cmH2O', min:3, max:60, step:1},", "  pinsp: {label:'ΔPinsp', unit:'cmH2O', min:3, max:100, step:1},");
sub("  pcontrol:{label:'ΔPcontrol', unit:'cmH2O', min:5, max:60, step:1},", "  pcontrol:{label:'ΔPcontrol', unit:'cmH2O', min:5, max:100, step:1},");
sub("  phi:   {label:'P high', unit:'cmH2O', min:0, max:60, step:1},", "  phi:   {label:'P high', unit:'cmH2O', min:0, max:100, step:1},");
sub("  aphi:  {label:'P high', unit:'cmH2O', min:0, max:60, step:1},", "  aphi:  {label:'P high', unit:'cmH2O', min:0, max:100, step:1},");
sub("  plo:   {label:'P low', unit:'cmH2O', min:0, max:35, step:1},", "  plo:   {label:'P low', unit:'cmH2O', min:0, max:50, step:1},");
sub("  hflow: {label:'Flow', unit:'l/min', min:2, max:60, step:1},", "  hflow: {label:'Flow', unit:'l/min', min:2, max:100, step:1},");
sub("  plim:  {label:'Plimit', unit:'cmH2O', min:5, max:60, step:1},", "  plim:  {label:'Plimit', unit:'cmH2O', min:5, max:100, step:1},");
/* Pause: the end-inspiratory pause of the volume-controlled modes, as a % of TI. The manual lists the control; its range and default are the simulator's choice. */
sub("  height:{label:'Pat. height', unit:'cm', min:130, max:250, step:1}\n};",
    "  height:{label:'Pat. height', unit:'cm', min:130, max:250, step:1},\n  pause: {label:'Pause', unit:'%', min:0, max:70, step:5}   /* (S)CMV and SIMV; range and default are the simulator's choice */\n};");
sub("    const min = ['APVcmv', 'PCV+', 'CPR'].includes(mk) ? 4", "    const min = ['APVcmv', 'PCV+', 'CPR', 'SCMV'].includes(mk) ? 4");
sub("  if (key === 'trig' && ['APVcmv', 'PCV+'].includes(mk)) return {...d, off0:true};", "  if (key === 'trig' && ['APVcmv', 'PCV+', 'SCMV'].includes(mk)) return {...d, off0:true};");
sub("  phigh: {label:'Pressure', unit:'cmH2O', min:15, max:70, step:1},", "  phigh: {label:'Pressure', unit:'cmH2O', min:15, max:110, step:1},");
sub("  plow:  {label:'Pressure', unit:'cmH2O', min:4, max:60, step:1},", "  plow:  {label:'Pressure', unit:'cmH2O', min:4, max:100, step:1},");
sub("V.lim.phigh = clamp(V.set.plim + 10, 15, 70)", "V.lim.phigh = clamp(V.set.plim + 10, 15, 110)");
sub("V.lim.phigh = clamp(val + 10, 15, 70)", "V.lim.phigh = clamp(val + 10, 15, 110)");
sub("V.lim.phigh = clamp(Math.round(Math.max(M.ppeak + 10, 35)), 15, 70);", "V.lim.phigh = clamp(Math.round(Math.max(M.ppeak + 10, 35)), 15, 110);");
sub("  'VS':      {basic:['vt','peep','o2','plim'], more:['trig','ets','pramp'], main:['vt','peep','o2']},\n", '');
sub("const MODE_CTRLS = {\n", `const MODE_CTRLS = {
  /* volume controlled, constant (square) flow (manual Table 2-1, controls p. 128); Flow pattern is fixed at square in this simulator */
  'SCMV':    {basic:['vt','rate','ie','pause','peep','o2','plim'], more:['trig','sigh'], main:['vt','rate','peep','o2']},
  'SIMV':    {basic:['vt','rate','ti','pause','ps','peep','o2','plim'], more:['trig','ets','pramp','sigh'], main:['vt','rate','ps','peep','o2']},
`);
sub(`const MODE_GROUPS = [
  ['Volume controlled (adaptive)', ['APVcmv', 'APVsimv', 'VS']],
  ['Pressure controlled (biphasic)', ['PCV+', 'PSIMV+', 'SPONT', 'DuoPAP', 'APRV']],
  ['Intelligent ventilation', ['ASV']],
  ['Noninvasive', ['NIV', 'NIV-ST', 'HiFlowO2']]
];`, `const MODE_GROUPS = [   /* ICU ventilator manual Table 2-1 (adult/paediatric) */
  ['Volume controlled', ['SCMV', 'SIMV']],
  ['Adaptive (volume targeted, pressure controlled)', ['APVcmv', 'APVsimv']],
  ['Pressure controlled', ['PCV+', 'PSIMV+', 'SPONT', 'DuoPAP', 'APRV']],
  ['Intelligent ventilation', ['ASV']],
  ['Noninvasive', ['NIV', 'NIV-ST', 'HiFlowO2']]
];`);
sub(`/* Configuration offers "(S)CMV+/SIMV+" or "APVcmv/APVsimv" names; (S)CMV+/SIMV+ is the default (3.0.x manual 13.4.2, p. 260; Table 15-14) */
const MODE_NAME = {APVcmv:'(S)CMV+', APVsimv:'SIMV+'};`, `/* C6: APVcmv/APVsimv is the default naming (Configuration can switch to (S)CMV+/SIMV+; manual 14.4.2). SCMV is the internal key for (S)CMV. */
const MODE_NAME = {SCMV:'(S)CMV'};
const VCM = ['SCMV', 'SIMV'];
const isVC = m => VCM.includes(m === undefined ? V.mode : m);`);
sub("const INVASIVE = ['APVcmv', 'APVsimv', 'VS',", "const INVASIVE = ['SCMV', 'SIMV', 'APVcmv', 'APVsimv', 'VS',");
sub("const BACKUP_MODES = ['APVsimv', 'SPONT',", "const BACKUP_MODES = ['SIMV', 'APVsimv', 'SPONT',");
sub("const SIGH_MODES = ['APVcmv', 'APVsimv',", "const SIGH_MODES = ['SCMV', 'SIMV', 'APVcmv', 'APVsimv',");
sub("const isSIMV = () => V.mode === 'APVsimv' || (V.mode === 'PSIMV+' && !V.psync);", "const isSIMV = () => V.mode === 'APVsimv' || V.mode === 'SIMV' || (V.mode === 'PSIMV+' && !V.psync);");
sub("  minvol:100, hflow:15, plim:30, trig:5, ets:25, pramp:70, timax:1.5, height:174};", "  minvol:100, hflow:15, plim:30, trig:5, ets:25, pramp:70, timax:1.5, height:174, pause:10};");

// ---- the breath engine: volume-controlled breaths --------------------------------------------------
sub("  if (m === 'APVcmv' || m === 'PCV+') { const c = 60 / s.rate; return {cycle:c, ti:c * s.ie / (1 + s.ie)}; }\n  if (m === 'APVsimv' || m === 'PSIMV+' || m === 'NIV-ST')",
    "  if (m === 'APVcmv' || m === 'PCV+' || m === 'SCMV') { const c = 60 / s.rate; return {cycle:c, ti:c * s.ie / (1 + s.ie)}; }\n  if (m === 'APVsimv' || m === 'PSIMV+' || m === 'NIV-ST' || m === 'SIMV')");
sub("  if (['SPONT', 'NIV', 'APVsimv', 'PSIMV+', 'DuoPAP'].includes(m)) return s.ps;", "  if (['SPONT', 'NIV', 'APVsimv', 'PSIMV+', 'DuoPAP', 'SIMV'].includes(m)) return s.ps;");
sub("  if (m === 'APVcmv' || m === 'PCV+') return 'amand';", "  if (m === 'APVcmv' || m === 'PCV+' || m === 'SCMV') return 'amand';");
sub(`  const mt = mandTiming();
  const base = baseP();
  let dP = kind === 'spont'`, `  const mt = mandTiming();
  const base = baseP();
  if (pc && isVC(m) && !B.apnoeaVent && mt) { startVCBreath(kind, auto, sigh, mt, base); return; }
  let dP = kind === 'spont'`);
sub(`/* a spontaneous breath taken on top of a pressure level (APRV, and DuoPAP at P high) */`, `/* (S)CMV and SIMV: a volume-controlled breath. The set Vt is delivered at a constant (square) flow over TI less
   the pause, so the airway pressure is PEEP + intrinsic PEEP + resistance x flow + volume / compliance: Ppeak shows
   resistance and compliance together, Pplateau (during the pause) compliance alone. If the pressure reaches the high
   Pressure limit, inspiration ends there (High pressure). A leak is not compensated. The model is illustrative. */
function startVCBreath(kind, auto, sigh, mt, base) {
  const pr = P.pr, s = V.set;
  const Ti0 = mt.ti;
  let tFlow = Math.max(0.2, Ti0 * (1 - s.pause / 100));
  const VTset = s.vt / 1000 * (sigh ? 1.5 : 1);
  const k = leakK();
  let inspLeak = k * Math.sqrt(Math.max(base + 10, 0.5));
  let expLeak = k * Math.sqrt(Math.max(base, 0.5));
  let peepM = base;
  if (expLeak > 30) peepM = Math.max(0, base - (expLeak - 30) * 0.15);
  if (P.kink) peepM = base + 6;
  const R = pr.R * (P.kink ? 2.5 : 1), C = pr.C;
  const iPeep = B.Vee / C;
  const F = VTset / tFlow;   /* l/s from the ventilator */
  let VT = Math.max(0.005, (VTset - inspLeak / 60 * tFlow * 0.5) * rnd(0.98, 1.02));
  /* an SGA: pressure above its seal pushes part of each breath out round it */
  const over = sgaOver(peepM + iPeep + R * F + VT / C);
  if (over) { inspLeak += over * 5; VT = Math.max(0.005, VT - over * C * 0.6); }
  let Ti = Ti0, hiP = false;
  if (P.disc) { VT = 0.01; peepM = 0.3; inspLeak = 110; expLeak = 100; }
  else {
    const room = (V.lim.phigh - peepM - iPeep - R * F) * C;
    if (VT > room) { VT = Math.max(0.005, room); hiP = true; tFlow = Math.max(0.05, VT / F); Ti = tFlow + 0.02; }
  }
  const plat = peepM + iPeep + VT / C, peak = plat + R * F;
  let cough = null;
  const fightP = P.cough ? 0.55 : fightChance(kind);
  if (fightP && Math.random() < fightP) cough = {at: Math.min(Ti, 1.5) * rnd(0.25, 0.6), p: peak + rnd(18, 26)};
  pushLog(B.fightLog, !!cough && !P.cough);
  B.vlimit = false;
  B.br = {kind, auto, sigh, Ti, target: peak, base, peepM, dPeff: (s.pause > 0 && !hiP ? plat : peak) - peepM, VT, inspLeak, expLeak, Fp: F * 60, tau: pr.tau, tauE: pr.tau * 1.8 * (pr.trapX || 1),
          pramp: 0, limited:false, tiMaxHit:false, cough, obstructed:false, maxP: 0, spiked:false, vc:{F, tFlow, R, C, iPeep, hiP}};
  B.phase = 'insp'; B.t = 0;
  B.lastStart = B.now; B.lastMand = B.now;
  if (kind === 'mand' || kind === 'amand') B.simvDue = false;
  recordStart('mand', VT);
  if (!auto && kind === 'amand') { trigMark = 1; B.trigFlash = 0.35; }
  pushLog(B.tiMaxLog, false);
  pushLog(B.autoLog, auto);
  B.peepNow = peepM;
  M.peep = peepM;
  if (peepM < base - 3) B.lowPeepBr = (B.lowPeepBr || 0) + 1; else B.lowPeepBr = 0;
}
/* a spontaneous breath taken on top of a pressure level (APRV, and DuoPAP at P high) */`);
sub(`  B.vEndInsp = B.Vee + br.VT;
  B.phase = 'exp'; B.t = 0;`, `  B.vEndInsp = B.Vee + br.VT;
  B.phase = 'exp'; B.t = 0;
  if (br.vc && br.vc.hiP) { raise('phigh'); B.highPT = 3; }`);
sub(`  if (B.phase === 'insp') {
    const rise = br.pramp > 0.01`, `  if (B.phase === 'insp' && br.vc) {
    const c = br.vc;
    if (t < c.tFlow) {
      const vol = Math.min(br.VT, br.VT * t / c.tFlow);
      p = br.peepM + c.iPeep + c.R * c.F * Math.min(1, t / 0.04) + vol / c.C;
      f = c.F * 60 + br.inspLeak;
      v = vol * 1000;
    } else {
      p = br.peepM + c.iPeep + br.VT / c.C + c.R * c.F * Math.exp(-(t - c.tFlow) / 0.05);
      f = br.inspLeak * 0.3 + c.F * 60 * Math.exp(-(t - c.tFlow) / 0.02);
      v = br.VT * 1000;
    }
    if (br.cough && br.spiked && t - br.cough.at < 0.25 && t >= br.cough.at) p = br.cough.p;
    br.maxP = Math.max(br.maxP, p);
  } else if (B.phase === 'insp') {
    const rise = br.pramp > 0.01`);
sub("  const irvMode = ['APVcmv', 'APVsimv', 'PCV+', 'DuoPAP'].includes(m)", "  const irvMode = ['APVcmv', 'APVsimv', 'PCV+', 'DuoPAP', 'SCMV', 'SIMV'].includes(m)");
sub("  if (!cpr && (APV.includes(mode) || mode === 'VS') && !APV.includes(V.mode) && V.mode !== 'VS') set.vt",
    "  if (!cpr && (APV.includes(mode) || isVC(mode)) && !APV.includes(V.mode) && !isVC(V.mode)) set.vt");

// ---- windows and notes -------------------------------------------------------------------------
sub("  if (mode === 'APVcmv' || mode === 'PCV+') { const c = 60 / s.rate, ti = c * s.ie / (1 + s.ie); parts.push(",
    "  if (mode === 'APVcmv' || mode === 'PCV+' || mode === 'SCMV') { const c = 60 / s.rate, ti = c * s.ie / (1 + s.ie); parts.push(");
sub("  if (['APVsimv', 'PSIMV+', 'NIV-ST'].includes(mode)) { const c = 60 / s.rate", "  if (['APVsimv', 'PSIMV+', 'NIV-ST', 'SIMV'].includes(mode)) { const c = 60 / s.rate");
sub("  if (mode === 'DuoPAP') parts.push(`Time at PEEP/CPAP", `  if (isVC(mode)) {
    const c = 60 / s.rate, ti = mode === 'SCMV' ? c * s.ie / (1 + s.ie) : Math.min(s.ti, c * 0.8), tf = ti * (1 - s.pause / 100);
    parts.push(\`Volume control: Vt is delivered at a constant flow of \${fmt(s.vt / 1000 / Math.max(0.2, tf) * 60)} l/min over \${tf.toFixed(2)} s, then a \${s.pause}% pause. The pressure follows the lungs: Ppeak = PEEP + resistance × flow + Vt / compliance; Pplateau (in the pause) shows compliance alone. Inspiration stops at the high Pressure limit (\${plim + 10} cmH2O). Flow pattern is square only in this simulator.\` + (mode === 'SIMV' ? ' Spontaneous breaths between the mandatory ones get ΔPsupport.' : ''));
  }
  if (mode === 'DuoPAP') parts.push(\`Time at PEEP/CPAP`);
sub("      const bk = mk === 'NIV' ? 'PCV+' : 'SIMV+ (APVsimv)';", "      const bk = mk === 'NIV' ? 'PCV+' : 'APVsimv';");
sub('<p class="wnote">HiFlowO2 can only be selected in Standby. Neonatal modes (nCPAP, nCPAP-PC) and the INTELLiVENT-ASV option are not included in this adult trainer.</p>',
    '<p class="wnote">HiFlowO2 can only be selected in Standby. The neonatal group (nCPAP-PS) and the INTELLiVENT-ASV option are not included in this adult simulator.</p>');
sub("<tr><td>Software (simulated)</td><td>Trainer, modelled on SW 3.0.x</td></tr></tbody></table>", "<tr><td>Software (simulated)</td><td>Simulator, modelled on the ICU ventilator manual (SW 1.2.x)</td></tr></tbody></table>");
sub(`        <p class="wnote">Pre-transport estimate (manufacturer's quick guide, adult): O2 consumption = (ExpMinVol + 3 l/min) × (FiO2 − 20.9) / 79.1. It excludes the nebuliser; in NIV, leak increases use. <b>Check cylinder sizes and durations locally.</b></p></div>\`;`,
    `        <p class="wnote">Estimated O2 consumption uses the manufacturer's quick guide formula, (ExpMinVol + 3 l/min) × (FiO2 − 20.9) / 79.1: an approximation for the ICU ventilator. Simulated values.</p></div>\`;`);
sub('Night lowers the display brightness; the Day/Night key does the same.</p>', 'Night lowers the display brightness. On the ICU ventilator Day &amp; Night is set here: there is no Day/Night key.</p>');
sub("$('#scrOffTxt').innerHTML = V.power ? 'TRANSPORT VENTILATOR<small>Self-test in progress…</small>' : '';", "$('#scrOffTxt').innerHTML = V.power ? 'ICU VENTILATOR<small>Self-test in progress…</small>' : '';");

// ---- scaling, waveforms and the screen's rendering ------------------------------------------------
sub('const DEV_W = 1000, DEV_H = 790;', 'const DEV_W = 1360, DEV_H = 1000;');
sub("  $('#screen').style.transform = 'scale(' + (box.clientWidth / 800) + ')';", "  $('#screen').style.transform = 'scale(' + (box.clientWidth / 1280) + ')';");
sub('const GW = 470, GH = 160;', 'const GW = 860, GH = 178;');
// main controls along the bottom (Fig 2-6 item 6): every main control of the active mode
sub(`function renderRcol() {
  if (!V.power || V.selftest > 0) { $('#rcol').innerHTML = ''; return; }
  const mc = modeCtrls(modeKey(), V.psync).main;
  let h = mc.map((k, i) => ctlHTML('mctl', k, 'ctrl', V.set[k]).replace('class="mctl', \`style="top:\${8 + i * 120}px" class="mctl\`)).join('');
  h += \`<button class="rbtn \${win === 'controls' || win === 'draft' ? 'open' : ''}" data-kf data-open="controls" style="top:380px">Controls</button>\`;
  h += \`<button class="rbtn \${win === 'alarms' ? 'open' : ''}" data-kf data-open="alarms" style="top:432px">Alarms</button>\`;
  $('#rcol').innerHTML = h;
}`, `function renderRcol() {
  if (!V.power || V.selftest > 0) { $('#rcol').innerHTML = ''; return; }
  const c = modeCtrls(modeKey(), V.psync);
  const keys = c.basic.filter(k => k !== 'plim').slice(0, 8);
  $('#rcol').innerHTML = keys.map((k, i) => ctlHTML('mctl', k, 'ctrl', V.set[k]).replace('class="mctl', \`style="left:\${8 + i * 158}px" class="mctl\`)).join('');
  $$('.bbtn[data-open]').forEach(b => b.setAttribute('data-kf', ''));
}`);
sub(`const MMP_DEF = [
  {id:'ppeak', n:'Ppeak', u:'cmH2O', dp:0},
  {id:'mv', n:'ExpMinVol', nniv:'MinVol NIV', u:'l/min', dp:1},
  {id:'vte', n:'VTE', nniv:'VTE NIV', u:'ml', dp:0},
  {id:'ftot', n:'fTotal', u:'b/min', dp:0}
];`, `const MMP_DEF = [   /* which MMPs the ICU ventilator shows by default is not in the manual: the simulator's choice */
  {id:'ppeak', n:'Ppeak', u:'cmH2O', dp:0},
  {id:'mv', n:'ExpMinVol', nniv:'MinVol NIV', u:'l/min', dp:1},
  {id:'vte', n:'VTE', nniv:'VTE NIV', u:'ml', dp:0},
  {id:'ftot', n:'fTotal', u:'b/min', dp:0},
  {id:'peep', n:'PEEP/CPAP', u:'cmH2O', dp:0},
  {id:'o2m', n:'Oxygen', u:'%', dp:0}
];`);
sub("      return `<button class=\"mmp cprt\" data-open=\"alarms\" style=\"top:${i * 106}px\"", "      return `<button class=\"mmp cprt\" data-open=\"alarms\" style=\"top:${i * 82}px\"");
sub("    return `<button class=\"mmp ${p ? 'alarm ' + p : ''}\" data-open=\"alarms\" style=\"top:${i * 106}px\"", "    return `<button class=\"mmp ${p ? 'alarm ' + p : ''}\" data-open=\"alarms\" style=\"top:${i * 82}px\"");
sub(`  }).join('') + (V.spo2On ? \`<button class="mmp-spo2" data-open="alarms" data-tab="2"><b>\${V.standby ? '--' : fmt(P.spo2)}%</b><span>SpO2</span></button>\` : '');
}`, `  }).join('') + (V.spo2On ? \`<button class="mmp-spo2" data-open="alarms" data-tab="2"><b>\${V.standby ? '--' : fmt(P.spo2)}%</b><span>SpO2</span></button>\` : '');
  renderSMP();
}
/* the right-hand column: more monitored values (manual Table 16-6; the choice of values is the simulator's) */
function renderSMP() {
  const el = $('#smp');
  if (!V.power || V.selftest > 0 || isHFO()) { el.innerHTML = ''; return; }
  const sb = V.standby, inv = isInvasive() && !sb && !P.disc;
  const rows = [['Pplateau', M.pplat, 0, 'cmH2O'], ['Pmean', M.pmean, 0, 'cmH2O'], ['AutoPEEP', isNIV() ? null : M.autopeep, 1, 'cmH2O'],
    ['Cstat', inv ? P.pr.C * 1000 : null, 1, 'ml/cmH2O'], ['Rinsp', inv ? P.pr.R : null, 0, 'cmH2O/(l/s)'], ['fSpont', M.fspont, 0, 'b/min'],
    ['VTI', M.vti, 0, 'ml'], ['VLeak', M.vleak, 0, '%'], ['PetCO2', petco2(), 1, 'kPa']];
  el.innerHTML = rows.map(r => \`<div><span>\${r[0]}<small>\${r[3]}</small></span><b>\${sb || r[1] === null || r[1] === undefined ? '--' : fmt(r[1], r[2])}</b></div>\`).join('');
}`);
sub(`function renderLEDs() {
  const on = (id, v) => $('#led-' + id).classList.toggle('on', !!v);`, `function renderLEDs() {
  /* the ICU ventilator lights its keys: O2 enrichment green, Audio pause red (manual 10.4 and 9.x); the others green while active (the simulator's choice) */
  const lit = (id, v, cls) => $('#' + id).classList.toggle(cls || 'lit', !!v);
  lit('kO2', V.power && V.o2Enrich > 0); lit('kAudio', V.power && V.audioPause > 0, 'litred'); lit('kLock', V.power && V.locked);
  lit('kManual', V.power && V.manualReq); lit('kNeb', V.power && V.neb > 0);
  const on = (id, v) => $('#led-' + id).classList.toggle('on', !!v);`);
sub(`  el.innerHTML = \`\${ap}<svg viewBox="0 0 22 20" width="22" height="20" aria-label="Humidifier">`, `  el.innerHTML = \`\${ap}<svg viewBox="0 0 22 20" width="22" height="20" aria-label="Humidifier">`);
sub(`    \${P.mains ? '<svg viewBox="0 0 16 24" width="12" height="22" aria-label="Mains power"><path d="M5 2v6M11 2v6M2 8h12v4a6 6 0 0 1-12 0zM8 18v5" stroke="#e6e6e6" stroke-width="2" fill="none"/></svg>' : ''}\`;`,
    `    \${P.mains ? '<svg viewBox="0 0 16 24" width="12" height="22" aria-label="Mains power"><path d="M5 2v6M11 2v6M2 8h12v4a6 6 0 0 1-12 0zM8 18v5" stroke="#e6e6e6" stroke-width="2" fill="none"/></svg>' : ''}<span class="clock">\${wallClock()}<br>\${new Date().toLocaleDateString('en-GB', {day:'2-digit', month:'2-digit', year:'numeric'})}</span>\`;`);
// the Day/Night key does not exist on the ICU ventilator (it stays wired, hidden, for the shared code)
sub("$('#kDay').addEventListener('click', () => { if (!V.power) return; V.night = !V.night; renderAll(); });\n", '');

// ---- the simulator link: this page is the ICU ventilator --------------------------------------------------
sub("const DEVICE_MODEL = 't1';", "const DEVICE_MODEL = 'c6';");
sub("const saveKey = () => 'wmebem_vent_' + fb.code;", "const saveKey = () => 'wmebem_c6_' + fb.code;");
sub("    embedded:EMBEDDED, phys:physNow(), sv:settingsJSON(mk, c), lv:limitsJSON(), ts:Date.now()", "    embedded:EMBEDDED, model:'c6', phys:physNow(), sv:settingsJSON(mk, c), lv:limitsJSON(), ts:Date.now()");
sub('/* Assessment mode: no alarm troubleshooting help on the screen (as on a real transport ventilator) */', '/* Assessment mode: no alarm troubleshooting help on the screen */');

/* No transport-ventilator label may show on the ICU ventilator page, and no manufacturer's name on either
   (comments, which explain the shared engine, aside). */
const visibleC6 = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const leftC6 = visibleC6.match(/.{0,60}(TRANSPORT VENTILATOR|>Transport ventilator<|HAMILTON|Hamilton|Dräger|Drager|Draeger|Atlan|ZOLL).{0,60}/);
if (leftC6) fail('a transport ventilator or brand label survived: ' + leftC6[0]);
if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur !== html) fail('vent/c6.html is out of date: run node scripts/make-c6.mjs');
    console.log('[make-c6] vent/c6.html is up to date');
} else {
    fs.writeFileSync(OUT, html);
    console.log('[make-c6] wrote vent/c6.html', html.length, 'bytes');
}
