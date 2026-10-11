// =================================================================================================
// CHECK THE AUTHORED LEARNING-OBJECTIVE COMPONENTS   (node scripts/check-objectives.mjs)
//
// Every built-in scenario objective must have an authored entry in window.SCENARIO_OBJECTIVE_ACTIONS
// (data/scenarios.js): a list of OR-groups of intervention keys, or [] for an objective that is not
// scorable from actions. Without an entry the debrief falls back to keyword inference, which is what
// credited antihistamine for bradykinin angio-oedema. This script fails (exit 1) when:
//   * a built-in objective has no authored entry;
//   * an entry names an intervention key that is not in window.INTERVENTIONS;
//   * an entry is malformed (not a list of non-empty lists of strings);
//   * an entry is for a scenario id or objective text that does not exist (a typo would otherwise
//     leave the real objective silently on inference);
//   * another scenario source (Ventilator Sim, Defib Sim, ...) declares objectives of its own.
// tests/specs/objectives.spec.js runs the same checks in the browser against the loaded app.
// =================================================================================================
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// The two data files are plain browser scripts that write to `window`.
const sandbox = { console, Math, JSON, Object, Array, Set, Map, Number, String, Date };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(read('data/interventions.js'), sandbox, { filename: 'data/interventions.js' });
// enrichScenario and the processing after it need the rest of the app; the raw library and the
// authored table are all this check needs.
const scenariosSrc = read('data/scenarios.js');
const cut = scenariosSrc.indexOf('window.enrichScenario');
vm.runInContext(cut > 0 ? scenariosSrc.slice(0, cut) : scenariosSrc, sandbox, { filename: 'data/scenarios.js' });

const INTERVENTIONS = sandbox.INTERVENTIONS || {};
const RAW = sandbox.RAW_SCENARIOS || [];
const AUTHORED = sandbox.SCENARIO_OBJECTIVE_ACTIONS || {};

const problems = [];
const objectivesOf = (s) => [...new Set([
    ...(Array.isArray(s.learningObjectives) ? s.learningObjectives : []),
    ...(Array.isArray(s.instructorBrief && s.instructorBrief.learningObjectives) ? s.instructorBrief.learningObjectives : [])
].filter(o => typeof o === 'string' && o.length))];

if (!RAW.length) problems.push('No built-in scenarios were found in data/scenarios.js.');
if (!Object.keys(INTERVENTIONS).length) problems.push('No interventions were found in data/interventions.js.');

let objectiveCount = 0, scorable = 0, judged = 0;
const byId = new Map();
RAW.forEach(s => {
    if (byId.has(s.id)) problems.push(`Duplicate scenario id ${s.id}.`);
    byId.set(s.id, s);
    const entry = AUTHORED[s.id];
    objectivesOf(s).forEach(obj => {
        objectiveCount++;
        if (!entry || !Object.prototype.hasOwnProperty.call(entry, obj)) {
            problems.push(`${s.id} (${s.title}): no authored components for objective "${obj}".`);
            return;
        }
        const groups = entry[obj];
        if (!Array.isArray(groups)) { problems.push(`${s.id}: "${obj}" must be a list of groups, e.g. [['AdrenalineIM'], ['Fluids']] or [].`); return; }
        if (groups.length === 0) { judged++; return; }
        scorable++;
        groups.forEach((g, i) => {
            if (!Array.isArray(g) || g.length === 0) { problems.push(`${s.id}: "${obj}" group ${i + 1} must be a non-empty list of intervention keys.`); return; }
            g.forEach(k => {
                if (typeof k !== 'string') problems.push(`${s.id}: "${obj}" group ${i + 1} has a non-string key.`);
                else if (!Object.prototype.hasOwnProperty.call(INTERVENTIONS, k)) problems.push(`${s.id}: "${obj}" names unknown intervention key '${k}'.`);
            });
        });
    });
});
// Entries that point nowhere (a typo in an id or in the objective text).
Object.keys(AUTHORED).forEach(id => {
    const s = byId.get(id);
    if (!s) { problems.push(`Authored components for unknown scenario id ${id}.`); return; }
    const objs = objectivesOf(s);
    Object.keys(AUTHORED[id]).forEach(obj => {
        if (objs.indexOf(obj) === -1) problems.push(`${id}: authored objective "${obj}" is not one of the scenario's objectives (${objs.map(o => `"${o}"`).join(', ')}).`);
    });
});
// The other scenario sources must not declare objectives without an entry here.
['data/ventsim.js', 'data/defibsim.js', 'data/presets.js', 'data/generators.js', 'data/simscreens.js'].forEach(rel => {
    if (!fs.existsSync(path.join(ROOT, rel))) return;
    const m = read(rel).match(/learningObjectives\s*:\s*\[\s*['"`]/);
    if (m) problems.push(`${rel} declares learning objectives; give them authored components and extend this check.`);
});

if (problems.length) {
    console.error(`[check-objectives] FAILED: ${problems.length} problem(s)`);
    problems.forEach(p => console.error('  - ' + p));
    process.exit(1);
}
console.log(`[check-objectives] OK: ${RAW.length} scenarios, ${objectiveCount} objectives (${scorable} scored from actions, ${judged} by facilitator tick).`);
