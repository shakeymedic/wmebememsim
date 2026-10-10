// database.rules.json against what the app actually writes.
// This checks the rules' STRUCTURE and simple validators with a small evaluator written here; the
// CI "rules" job runs the same rules in the real Firebase emulator (tests/rules/).
const fs = require('fs');
const path = require('path');
const { test } = require('@playwright/test');
const { useFakeFirebase, trackErrors, openController, expandSection, expect } = require('./helpers');

const ROOT = path.join(__dirname, '..', '..');
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, 'database.rules.json'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')).rules;
const SESSION = RULES.sessions.$code;
const CODE_RE = new RegExp(SESSION['.write'].match(/matches\(\/(.*)\/\)/)[1]);

// The sync payload's keys, read from the source with Babel (as the build compiles it).
function payloadKeys() {
  const Babel = require(path.join(ROOT, 'node_modules', '@babel', 'standalone'));
  const src = fs.readFileSync(path.join(ROOT, 'data', 'engine-sync.js'), 'utf8');
  const at = src.indexOf('const payload = {', src.indexOf('const flush = () => {'));
  let d = 0, k = src.indexOf('{', at); const start = k;
  for (;; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) break; }
  const ast = Babel.transform('(' + src.slice(start, k + 1) + ')', { ast: true, code: false }).ast;
  return ast.program.body[0].expression.properties.map(p => p.key.name || p.key.value);
}

// ---- a tiny evaluator for the validators these rules use -------------------------------------
function check(expr, v) {
  if (expr === true || expr === 'true') return true;
  if (expr === false || expr === 'false') return false;
  return String(expr).split('&&').map(t => t.trim()).every(t => {
    let m;
    if (t === 'newData.isString()') return typeof v === 'string';
    if (t === 'newData.isNumber()') return typeof v === 'number';
    if (t === 'newData.isBoolean()') return typeof v === 'boolean';
    if ((m = t.match(/^newData\.val\(\)\.length <= (\d+)$/))) return String(v).length <= Number(m[1]);
    if ((m = t.match(/^newData\.hasChildren\(\[(.*)\]\)$/))) return v && typeof v === 'object' && m[1].split(',').map(x => x.trim().replace(/'/g, '')).every(c => v[c] !== undefined && v[c] !== null);
    if ((m = t.match(/^newData\.hasChild\('(.*)'\)$/))) return v && typeof v === 'object' && v[m[1]] !== undefined && v[m[1]] !== null;
    throw new Error('evaluator does not understand: ' + t);
  });
}
const childRule = (rule, key) => {
  if (!rule) return null;
  if (rule[key]) return rule[key];
  const wild = Object.keys(rule).find(k => k.startsWith('$') && k !== '$other');
  return wild ? rule[wild] : (rule.$other || null);
};
function validate(rule, value, where, problems) {
  if (value === null || value === undefined || !rule) return;
  if (rule['.validate'] !== undefined && !check(rule['.validate'], value)) problems.push(`${where}: fails ${JSON.stringify(rule['.validate'])} with ${JSON.stringify(value).slice(0, 80)}`);
  if (value && typeof value === 'object') Object.keys(value).forEach(k => validate(childRule(rule, k), value[k], `${where}/${k}`, problems));
}
const ruleAt = (segs) => segs.reduce((r, s) => childRule(r, s), RULES.sessions);

test('every key the controller publishes has a rule under sessions/$code/live', () => {
  const allowed = Object.keys(SESSION.live).filter(k => !k.startsWith('$') && !k.startsWith('.'));
  expect(payloadKeys().sort()).toEqual(allowed.sort());
});

test('session codes the app makes are the codes the rules accept, and nothing else', async ({ page, context }) => {
  await useFakeFirebase(context);
  await openController(page);
  const codes = await page.evaluate(() => Array.from({ length: 200 }, () => window.newSessionCode()));
  codes.forEach(c => expect(CODE_RE.test(c)).toBe(true));
  ['ABCD', 'ABC0EF', 'abcdef', 'ABCDEFG', 'AIBCDE', 'A1BCDE'].forEach(c => expect(CODE_RE.test(c)).toBe(false));
});

test('everything a controller, room monitor, defib tablet and ventilator write passes the rules', async ({ page, context }) => {
  await useFakeFirebase(context);
  trackErrors(page);
  const code = await openController(page);
  await page.getByRole('button', { name: 'Defib Sim', exact: true }).click();
  await page.locator('[data-defib-scenario="unstable-svt"]').click();
  await page.getByRole('button', { name: 'Start Defib Sim' }).click();
  await page.getByRole('button', { name: 'START', exact: true }).click();

  const monitor = await context.newPage();
  await monitor.goto(`/index.html?mode=monitor&session=${code}`);
  await expect.poll(() => monitor.evaluate(() => !!(window.__monitorEngine && window.__monitorEngine.state.lastUpdate))).toBe(true);
  await monitor.evaluate(() => { window.__monitorEngine.triggerNIBP(); window.__monitorEngine.sendDeviceEvent('CHECK_PULSE', { timestamp: Date.now() }); });

  const defib = await context.newPage();
  await defib.goto(`/defib/index.html?session=${code}`);
  await expect(defib.locator('#linkBanner')).toBeHidden();
  await defib.click('.mode-label[data-mode="defib"]');
  await defib.click('#leadBtn');
  await defib.click('#sizeBtn');
  await defib.click('#checkPulseBtn');
  await defib.click('#analyseBtn');
  await defib.waitForTimeout(3000);
  await defib.click('#syncBtn');
  await defib.click('#chargeBtn');
  await expect(defib.locator('#shockBtn')).toBeEnabled({ timeout: 5000 });
  await defib.click('#shockBtn');
  await defib.click('.mode-label[data-mode="pacer"]');
  await defib.click('[data-pacer-param="output"][data-pacer-dir="5"]');
  await defib.click('#markerBtn');
  await page.getByRole('button', { name: /Metronome/ }).click();
  await expandSection(page, 'defibPacing');
  await page.locator('[data-artefact="movement"]').click();
  // The ventilator: the lungs and the monitor toggle from the controller, then a tablet that
  // powers up, self-tests and ventilates (log lines and the mirror)
  await page.evaluate(() => { window.__simEngine.dispatch({ type: 'SET_VENT_CONFIG', payload: { profile: 'ards', breathing: false } }); window.__simEngine.dispatch({ type: 'SET_VENT_PANEL', payload: true }); });
  const vent = await page.context().newPage();
  await vent.goto(`/vent/index.html?session=${code}`);
  await expect(vent.locator('#linkBanner')).toBeHidden({ timeout: 10000 });
  await vent.click('#kPower');
  await expect(vent.getByRole('button', { name: 'Start ventilation' })).toBeVisible({ timeout: 10000 });
  await vent.click('#kPower');
  await expect.poll(() => vent.evaluate(() => window.__vent.ventStateNow().state)).toBe('ventilating');
  // The facilitator's side: lung adjustments, problems, Assessment and remote commands
  await page.evaluate(() => window.__simEngine.dispatch({ type: 'SET_VENT_CONFIG', payload: { lung: { c: 80, r: 14 }, probs: ['leakM', 'bronch'], assess: true } }));
  const ventId = await vent.evaluate(() => window.__vent.fb.presenceId);
  await page.evaluate((id) => { const E = window.__simEngine; E.sendVentCommand(id, 'set', 'peep', 8); E.sendVentCommand(id, 'mode', 'APVsimv'); E.sendVentCommand(id, 'silence'); }, ventId);
  await expect.poll(() => vent.evaluate(() => window.__vent.V.mode)).toBe('APVsimv');
  await page.waitForTimeout(1500);

  const problems = [];
  for (const [who, p] of [['controller', page], ['monitor', monitor], ['defib', defib], ['ventilator', vent]]) {
    const writes = await p.evaluate(() => window.__fakeRtdb.writes());
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) {
      const segs = w.path.split('/').filter(Boolean);
      if (segs[0] !== 'sessions') { problems.push(`${who} wrote outside sessions: ${w.path}`); continue; }
      if (!CODE_RE.test(segs[1] || '')) problems.push(`${who} wrote to a code the rules refuse: ${w.path}`);
      const entries = w.op === 'update' ? Object.keys(w.value || {}).map(k => [segs.concat(k.split('/').filter(Boolean)), w.value[k]]) : [[segs, w.value]];
      for (const [s, v] of entries) {
        const rule = ruleAt(s.slice(1));
        if (!rule) { problems.push(`${who}: no rule for ${s.join('/')}`); continue; }
        if (rule['.validate'] === false && v !== null) { problems.push(`${who}: ${s.join('/')} is not an allowed field`); continue; }
        // Whole-node checks (hasChildren) are made on the final data below; field checks here.
        const { ['.validate']: whole, ...rest } = rule;
        validate(w.op === 'update' && /hasChild/.test(String(whole)) ? rest : rule, v, `${who} ${s.join('/')}`, problems);
      }
    }
  }
  // The final session as stored, node by node
  validate(SESSION, await page.evaluate(([c]) => window.__fakeRtdb.get(`sessions/${c}`), [code]), `sessions/${code}`, problems);
  expect(problems).toEqual([]);
});
