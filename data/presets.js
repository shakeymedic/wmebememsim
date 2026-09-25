// =================================================================================================
// QUICK SIM PRESETS — scripted sequences of rhythm and obs changes for repeatable teaching.
//
// A preset is a list of steps. Each step fires either `after` N seconds (counted from the previous
// step, and only while the sim is not deliberately paused) or, with `wait: true`, when the
// facilitator presses Next (e.g. "revert once the team has given adenosine"). A step may set a
// rhythm (canonical id from data/rhythms.js), vitals, and `over` (seconds to ramp the vitals;
// 0 = immediately). `note` is what the facilitator sees and what goes in the event log.
//
// These are facilitation scripts, not clinical guidance. The numbers are plausible teaching values;
// edit or add your own. Presets the facilitator saves live in this browser's localStorage only
// (a per-device convenience), under PRESET_STORE_KEY.
// Plain JS (no JSX) so it loads before the screens; exposes window.QuickSimPresets.
// =================================================================================================
(function () {
    'use strict';

    var BUILT_IN = [
        {
            id: 'brady-chb', name: 'Bradycardia → complete heart block',
            description: 'Symptomatic bradycardia that progresses through Mobitz II to complete heart block with falling BP.',
            steps: [
                { after: 0, rhythm: 'Sinus Bradycardia', vitals: { hr: 48, bpSys: 102, bpDia: 62, spO2: 97, rr: 16 }, over: 0, note: 'Sinus bradycardia, 48/min' },
                { after: 60, rhythm: '2nd Deg Heart Block', vitals: { hr: 40, bpSys: 90, bpDia: 55 }, over: 30, note: 'Mobitz II, BP falling' },
                { after: 90, rhythm: 'Complete Heart Block', vitals: { hr: 32, bpSys: 74, bpDia: 40, spO2: 94, gcs: 13 }, over: 60, note: 'Complete heart block, hypotensive' }
            ]
        },
        {
            id: 'svt-revert', name: 'SVT → reverts when treated',
            description: 'Stable narrow-complex tachycardia that waits for the team, then reverts to sinus when you press Next.',
            steps: [
                { after: 0, rhythm: 'SVT', vitals: { hr: 182, bpSys: 108, bpDia: 72, spO2: 98, rr: 20 }, over: 0, note: 'SVT 182/min, haemodynamically stable' },
                { wait: true, rhythm: 'Sinus Rhythm', vitals: { hr: 92, bpSys: 122, bpDia: 76 }, over: 0, note: 'Reverts to sinus (press Next when the team has treated it)' }
            ]
        },
        {
            id: 'sepsis', name: 'Deteriorating sepsis',
            description: 'Febrile tachycardic patient who becomes progressively more shocked and hypoxic over about 3 minutes.',
            steps: [
                { after: 0, rhythm: 'Sinus Tachycardia', vitals: { hr: 112, bpSys: 104, bpDia: 64, spO2: 95, rr: 22, temp: 38.7 }, over: 0, note: 'Febrile, tachycardic' },
                { after: 90, vitals: { hr: 126, bpSys: 90, bpDia: 52, spO2: 93, rr: 26 }, over: 60, note: 'Worsening: BP falling, RR rising' },
                { after: 90, vitals: { hr: 140, bpSys: 78, bpDia: 42, spO2: 90, rr: 30, gcs: 13 }, over: 60, note: 'Septic shock' }
            ]
        },
        {
            id: 'periarrest-vf', name: 'Peri-arrest → VF arrest',
            description: 'Hypotensive tachycardia that becomes VT with a pulse, then pulseless VT, then VF.',
            steps: [
                { after: 0, rhythm: 'Sinus Tachycardia', vitals: { hr: 128, bpSys: 86, bpDia: 52, spO2: 94, rr: 24 }, over: 0, note: 'Tachycardic and hypotensive' },
                { after: 60, rhythm: 'VT', vitals: { hr: 178, bpSys: 72, bpDia: 44 }, over: 15, note: 'VT with a pulse, BP falling' },
                { after: 60, rhythm: 'pVT', note: 'Pulseless VT (arrest)' },
                { after: 30, rhythm: 'VF', note: 'Degenerates to VF' }
            ]
        },
        {
            id: 'hypoxia', name: 'Progressive hypoxia',
            description: 'Desaturating patient: SpO2 falls from 94% to 82% over two minutes with a rising RR and HR.',
            steps: [
                { after: 0, rhythm: 'Sinus Rhythm', vitals: { hr: 96, spO2: 94, rr: 22 }, over: 0, note: 'Mildly hypoxic' },
                { after: 45, vitals: { hr: 108, spO2: 88, rr: 28 }, over: 60, note: 'Desaturating' },
                { after: 60, rhythm: 'Sinus Tachycardia', vitals: { hr: 124, spO2: 82, rr: 32 }, over: 60, note: 'Severe hypoxia' }
            ]
        }
    ];

    var PRESET_STORE_KEY = 'wmebem.quickSimPresets.v1';
    var VITAL_KEYS = ['hr', 'bpSys', 'bpDia', 'spO2', 'rr', 'temp', 'etco2', 'gcs', 'bm'];

    function readSaved() {
        try {
            var raw = window.localStorage && window.localStorage.getItem(PRESET_STORE_KEY);
            var list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list.filter(function (p) { return p && p.id && p.name && Array.isArray(p.steps) && p.steps.length; }) : [];
        } catch (e) { return []; }
    }
    function writeSaved(list) {
        try { if (window.localStorage) window.localStorage.setItem(PRESET_STORE_KEY, JSON.stringify(list)); return true; }
        catch (e) { return false; }   // private mode / blocked storage: the preset simply is not kept
    }
    // A one-step preset capturing the patient as they are now: "put the patient back like this".
    function snapshotPreset(name, rhythm, vitals) {
        var v = {};
        VITAL_KEYS.forEach(function (k) { if (vitals && Number.isFinite(Number(vitals[k]))) v[k] = Number(vitals[k]); });
        return {
            id: 'user-' + Date.now().toString(36), name: String(name).slice(0, 60), user: true,
            description: 'Saved snapshot: rhythm and obs as they were when saved.',
            steps: [{ after: 0, rhythm: rhythm, vitals: v, over: 0, note: 'Snapshot applied' }]
        };
    }
    function all() { return BUILT_IN.concat(readSaved()); }
    function save(preset) { var list = readSaved(); list.push(preset); return writeSaved(list); }
    function remove(id) { return writeSaved(readSaved().filter(function (p) { return p.id !== id; })); }

    window.QuickSimPresets = { BUILT_IN: BUILT_IN, PRESET_STORE_KEY: PRESET_STORE_KEY, all: all, save: save, remove: remove, snapshotPreset: snapshotPreset, readSaved: readSaved };
})();
