// =================================================================================================
// COURSE MARK SHEETS (restricted course scenarios, e.g. ETC)
// -------------------------------------------------------------------------------------------------
// A restricted scenario may carry a `markScheme` block: the facilitator's pack for a course
// scenario (radio report, how to set the patient up, the A-B-C-D-E pathway with each role's
// findings and expected actions, the results to give, and the Achieved / Not achieved criteria).
// Nothing course-specific lives in this file: the content is read from the database at run time
// with the rest of the restricted scenario (see README "Restricted scenarios"), so this file only
// knows how to show it.
//
//   markScheme: {
//     kind: 'workshop' | 'assessment',        // assessment = pass needs every critical point
//     source, note,                            // where it came from; a caveat shown in amber
//     radioReport: [..], learningOutcomes: [..], technicalSkills: [..], nonTechnicalSkills: [..],
//     setup: { initial: [..], after: [..], afterLabel, equipment: [..], injuries: [..], skills: [..] },
//     pathway: [{ role, findings, actions }],  // findings/actions are multi-line strings
//     results: [{ label, text }],              // sounds, AMPLE, blood gases, X-rays, eFAST, CT
//     criticalPoints: [..], criticalNote,      // assessment scenarios
//     criteria: { technical: [..], nonTechnical: [..], other: [..] },   // the A / N items
//     summary, debriefPoints: [..], teachingPoints: [..]
//   }
//
// Firebase stores arrays as objects with numeric keys (and drops empty ones), so every list is
// read through asList().
// =================================================================================================
(() => {
    const { useState } = React;

    const asList = (v) => {
        if (Array.isArray(v)) return v.filter(x => x !== null && x !== undefined && x !== '');
        if (v && typeof v === 'object') return Object.keys(v).sort((a, b) => Number(a) - Number(b)).map(k => v[k]).filter(x => x !== null && x !== undefined && x !== '');
        if (typeof v === 'string' && v.trim()) return [v];
        return [];
    };
    const str = (v) => (v === null || v === undefined) ? '' : String(v);

    const get = (scenario) => {
        const ms = scenario && scenario.markScheme;
        return ms && typeof ms === 'object' && !Array.isArray(ms) ? ms : null;
    };

    // The items a facilitator marks A (achieved) or N (not achieved), in order.
    const items = (scenario) => {
        const ms = get(scenario);
        if (!ms) return [];
        const out = [];
        const crit = ms.criteria && typeof ms.criteria === 'object' ? ms.criteria : {};
        asList(ms.criticalPoints).forEach((t, i) => out.push({ id: `cp${i}`, section: 'critical', text: str(t) }));
        asList(crit.technical).forEach((t, i) => out.push({ id: `ts${i}`, section: 'technical', text: str(t) }));
        asList(crit.nonTechnical).forEach((t, i) => out.push({ id: `nt${i}`, section: 'nonTechnical', text: str(t) }));
        asList(crit.other).forEach((t, i) => out.push({ id: `ot${i}`, section: 'other', text: str(t) }));
        return out;
    };

    const SECTION_LABEL = { critical: 'Critical points', technical: 'Technical skills', nonTechnical: 'Non-technical skills', other: 'Other criteria' };

    // Overall result. An assessment passes only when every item is Achieved (both critical points
    // plus the other criteria); a workshop just counts. Nothing is decided until every item is marked.
    const result = (scenario, marks) => {
        const ms = get(scenario) || {};
        const list = items(scenario);
        const m = marks || {};
        const achieved = list.filter(i => m[i.id] === 'A').length;
        const notAchieved = list.filter(i => m[i.id] === 'N').length;
        const unmarked = list.length - achieved - notAchieved;
        const criticalMissed = list.filter(i => i.section === 'critical' && m[i.id] === 'N').length;
        let verdict = null;
        if (ms.kind === 'assessment' && list.length) {
            if (criticalMissed || (notAchieved && !unmarked)) verdict = 'Not yet achieved';
            else if (!unmarked && !notAchieved) verdict = 'Pass';
        }
        return { total: list.length, achieved, notAchieved, unmarked, criticalMissed, verdict };
    };

    // ---- display pieces ------------------------------------------------------------------------
    const Lines = ({ text, className = '' }) => {
        const lines = str(text).split('\n').map(l => l.trimEnd());
        return <div className={className}>{lines.map((l, i) => l.trim() ? <div key={i}>{l}</div> : <div key={i} className="h-1.5" />)}</div>;
    };
    const Bullets = ({ list, className = 'text-slate-200' }) => (
        <ul className={`list-disc pl-5 space-y-0.5 text-sm ${className}`}>{asList(list).map((t, i) => <li key={i}>{str(t)}</li>)}</ul>
    );
    const Block = ({ title, tone = 'text-sky-400', children }) => (
        <section className="bg-slate-900/60 border border-slate-700 rounded-lg p-3 break-inside-avoid">
            <h4 className={`text-xs font-bold uppercase tracking-wider mb-2 ${tone}`}>{title}</h4>
            {children}
        </section>
    );

    // A / N marking row. `marks` absent = read-only.
    const MarkRow = ({ item, mark, onMark }) => {
        const btn = (v, label, on) => (
            <button type="button" aria-pressed={mark === v} aria-label={`${label}: ${item.text}`}
                onClick={() => onMark(item.id, mark === v ? null : v)}
                className={`w-9 h-8 rounded border text-sm font-bold ${mark === v ? on : 'border-slate-600 text-slate-400 hover:text-white'}`}>{v}</button>
        );
        return (
            <li className="flex items-start gap-2 py-1 border-b border-slate-800 last:border-0">
                <span className={`flex-1 text-sm ${item.section === 'critical' ? 'text-amber-200 font-bold' : 'text-slate-200'}`}>{item.text}</span>
                {onMark && <span className="flex gap-1 flex-none">{btn('A', 'Achieved', 'bg-emerald-700 border-emerald-500 text-white')}{btn('N', 'Not achieved', 'bg-red-800 border-red-500 text-white')}</span>}
            </li>
        );
    };

    const Criteria = ({ scenario, marks, onMark }) => {
        const ms = get(scenario) || {};
        const list = items(scenario);
        if (!list.length) return null;
        const sections = ['critical', 'technical', 'nonTechnical', 'other'].filter(s => list.some(i => i.section === s));
        const r = result(scenario, marks);
        return (
            <div className="space-y-3" data-testid="mark-criteria">
                {onMark && (
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
                        <span><b className="text-emerald-400">{r.achieved}</b> achieved</span>
                        <span><b className="text-red-400">{r.notAchieved}</b> not achieved</span>
                        <span><b className="text-slate-200">{r.unmarked}</b> not marked</span>
                        {r.verdict && <span data-testid="mark-verdict" className={`px-2 py-0.5 rounded font-bold uppercase ${r.verdict === 'Pass' ? 'bg-emerald-800 text-emerald-100' : 'bg-red-900 text-red-100'}`}>{r.verdict}</span>}
                    </div>
                )}
                {sections.map(s => (
                    <div key={s}>
                        <div className={`text-[11px] font-bold uppercase tracking-wider mb-1 ${s === 'critical' ? 'text-amber-400' : 'text-slate-400'}`}>{SECTION_LABEL[s]}</div>
                        {s === 'critical' && ms.criticalNote && <p className="text-[11px] text-amber-300/90 mb-1">{str(ms.criticalNote)}</p>}
                        <ul>{list.filter(i => i.section === s).map(i => <MarkRow key={i.id} item={i} mark={marks ? marks[i.id] : undefined} onMark={onMark} />)}</ul>
                    </div>
                ))}
                {onMark && <p className="text-[11px] text-slate-500">Only two marks count: A (achieved) or N (not achieved). Press a mark again to clear it.{ms.kind === 'assessment' ? ' An assessment is passed only when both critical points and the other criteria are achieved.' : ''}</p>}
            </div>
        );
    };

    // The whole facilitator pack. `marks`/`onMark` add A/N buttons to the criteria.
    const MarkSheetBody = ({ scenario, marks, onMark }) => {
        const ms = get(scenario);
        if (!ms) return null;
        const setup = ms.setup && typeof ms.setup === 'object' ? ms.setup : {};
        const pathway = asList(ms.pathway).filter(r => r && typeof r === 'object');
        const results = asList(ms.results).filter(r => r && typeof r === 'object');
        return (
            <div className="space-y-3 text-left">
                {ms.note && <p className="text-xs text-amber-300 bg-amber-950/30 border border-amber-700/50 rounded p-2">{str(ms.note)}</p>}
                {asList(ms.radioReport).length > 0 && <Block title="Scenario / radio report"><Bullets list={ms.radioReport} /></Block>}
                <div className="grid md:grid-cols-2 gap-3">
                    {asList(ms.learningOutcomes).length > 0 && <Block title="Learning outcomes" tone="text-indigo-300"><Bullets list={ms.learningOutcomes} /></Block>}
                    {(asList(ms.technicalSkills).length > 0 || asList(ms.nonTechnicalSkills).length > 0) && (
                        <Block title="Skills" tone="text-indigo-300">
                            {asList(ms.technicalSkills).length > 0 && <><div className="text-[11px] text-slate-400 uppercase font-bold">Technical</div><Bullets list={ms.technicalSkills} /></>}
                            {asList(ms.nonTechnicalSkills).length > 0 && <><div className="text-[11px] text-slate-400 uppercase font-bold mt-1">Non-technical</div><Bullets list={ms.nonTechnicalSkills} /></>}
                        </Block>
                    )}
                </div>
                {(asList(setup.initial).length > 0 || asList(setup.injuries).length > 0 || asList(setup.equipment).length > 0) && (
                    <Block title="Setting up the patient" tone="text-emerald-400">
                        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                            {asList(setup.initial).length > 0 && <div><div className="text-[11px] text-slate-400 uppercase font-bold">Initial obs</div><Bullets list={setup.initial} /></div>}
                            {asList(setup.after).length > 0 && <div><div className="text-[11px] text-slate-400 uppercase font-bold">{str(setup.afterLabel) || 'After treatment'}</div><Bullets list={setup.after} /></div>}
                            {asList(setup.injuries).length > 0 && <div><div className="text-[11px] text-slate-400 uppercase font-bold">Injuries (moulage)</div><Bullets list={setup.injuries} /></div>}
                            {asList(setup.equipment).length > 0 && <div><div className="text-[11px] text-slate-400 uppercase font-bold">On arrival</div><Bullets list={setup.equipment} /></div>}
                        </div>
                        {asList(setup.skills).length > 0 && <div className="mt-2 text-xs text-slate-400"><b className="text-slate-300">Skills stations:</b> {asList(setup.skills).join('; ')}</div>}
                    </Block>
                )}
                {pathway.length > 0 && (
                    <Block title="Pathway: findings to give and expected actions" tone="text-amber-400">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm border-collapse" data-testid="mark-pathway">
                                <thead><tr className="text-[11px] uppercase text-slate-400"><th className="text-left p-1 w-16">Role</th><th className="text-left p-1">Findings (role card)</th><th className="text-left p-1">Expected actions</th></tr></thead>
                                <tbody>
                                    {pathway.map((r, i) => (
                                        <tr key={i} className="align-top border-t border-slate-700">
                                            <td className="p-1 font-bold text-white whitespace-pre-line">{str(r.role)}</td>
                                            <td className="p-1 text-slate-200"><Lines text={r.findings} /></td>
                                            <td className="p-1 text-emerald-200"><Lines text={r.actions} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Block>
                )}
                {results.length > 0 && (
                    <Block title="Results to give when asked" tone="text-cyan-300">
                        <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
                            {results.map((r, i) => <div key={i} className="flex gap-2"><dt className="text-slate-400 font-bold min-w-[7rem]">{str(r.label)}</dt><dd className="text-slate-200 whitespace-pre-line">{str(r.text)}</dd></div>)}
                        </dl>
                    </Block>
                )}
                {items(scenario).length > 0 && <Block title={onMark ? 'Mark sheet' : 'Mark scheme'} tone="text-fuchsia-300"><Criteria scenario={scenario} marks={marks} onMark={onMark} /></Block>}
                {(ms.summary || asList(ms.debriefPoints).length > 0) && (
                    <Block title="Debrief: learning points" tone="text-violet-300">
                        {ms.summary && <p className="text-sm text-slate-300 mb-1">{str(ms.summary)}</p>}
                        <Bullets list={ms.debriefPoints} />
                    </Block>
                )}
                {asList(ms.teachingPoints).length > 0 && <Block title="Teaching aid" tone="text-slate-300"><Bullets list={ms.teachingPoints} className="text-slate-300" /></Block>}
                {ms.source && <p className="text-[10px] text-slate-500">Source: {str(ms.source)}</p>}
            </div>
        );
    };

    // ---- printable HTML (the mark sheet on its own, or inside the debrief report) ----------------
    const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
    const ul = (list) => asList(list).length ? `<ul>${asList(list).map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : '';
    const nl = (t) => esc(t).replace(/\n/g, '<br>');
    const criteriaHtml = (scenario, marks) => {
        const ms = get(scenario) || {};
        const list = items(scenario);
        if (!list.length) return '';
        const r = result(scenario, marks);
        const rows = list.map(i => {
            const m = marks ? marks[i.id] : null;
            const cell = marks ? `<td style="width:70px;font-weight:bold;color:${m === 'A' ? '#15803d' : m === 'N' ? '#b91c1c' : '#64748b'}">${m === 'A' ? 'A' : m === 'N' ? 'N' : '&ndash;'}</td>` : '<td style="width:90px;">A &nbsp;/&nbsp; N</td>';
            return `<tr><td style="width:150px;color:#475569;">${esc(SECTION_LABEL[i.section])}</td><td${i.section === 'critical' ? ' style="font-weight:bold;"' : ''}>${esc(i.text)}</td>${cell}</tr>`;
        }).join('');
        const summary = marks ? `<p><b>${r.achieved}</b> achieved, <b>${r.notAchieved}</b> not achieved, <b>${r.unmarked}</b> not marked${r.verdict ? ` &middot; <b>${esc(r.verdict)}</b>` : ''}.</p>` : '';
        return `${ms.criticalNote ? `<p style="color:#92400e;">${esc(ms.criticalNote)}</p>` : ''}${summary}<table><thead><tr><th>Section</th><th>Criterion</th><th>Mark</th></tr></thead><tbody>${rows}</tbody></table>`;
    };
    const sheetHtml = (scenario, marks) => {
        const ms = get(scenario);
        if (!ms) return '';
        const setup = ms.setup && typeof ms.setup === 'object' ? ms.setup : {};
        const pathway = asList(ms.pathway).filter(r => r && typeof r === 'object');
        const results = asList(ms.results).filter(r => r && typeof r === 'object');
        const card = (title, body) => body ? `<div class="card"><h3>${esc(title)}</h3>${body}</div>` : '';
        return [
            ms.note ? `<p style="color:#92400e;border:1px solid #f59e0b;padding:6px;border-radius:6px;">${esc(ms.note)}</p>` : '',
            card('Scenario / radio report', ul(ms.radioReport)),
            card('Learning outcomes', ul(ms.learningOutcomes)),
            card('Skills', (asList(ms.technicalSkills).length ? `<h4>Technical</h4>${ul(ms.technicalSkills)}` : '') + (asList(ms.nonTechnicalSkills).length ? `<h4>Non-technical</h4>${ul(ms.nonTechnicalSkills)}` : '')),
            card('Setting up the patient', (asList(setup.initial).length ? `<h4>Initial obs</h4>${ul(setup.initial)}` : '') + (asList(setup.after).length ? `<h4>${esc(setup.afterLabel || 'After treatment')}</h4>${ul(setup.after)}` : '') + (asList(setup.injuries).length ? `<h4>Injuries (moulage)</h4>${ul(setup.injuries)}` : '') + (asList(setup.equipment).length ? `<h4>On arrival</h4>${ul(setup.equipment)}` : '') + (asList(setup.skills).length ? `<h4>Skills stations</h4>${ul(setup.skills)}` : '')),
            card('Pathway: findings to give and expected actions', pathway.length ? `<table><thead><tr><th>Role</th><th>Findings (role card)</th><th>Expected actions</th></tr></thead><tbody>${pathway.map(r => `<tr><td><b>${nl(r.role)}</b></td><td>${nl(r.findings)}</td><td>${nl(r.actions)}</td></tr>`).join('')}</tbody></table>` : ''),
            card('Results to give when asked', results.length ? `<table><tbody>${results.map(r => `<tr><td style="width:160px;"><b>${esc(r.label)}</b></td><td>${nl(r.text)}</td></tr>`).join('')}</tbody></table>` : ''),
            card(marks ? 'Mark sheet' : 'Mark scheme', criteriaHtml(scenario, marks)),
            card('Debrief: learning points', (ms.summary ? `<p>${esc(ms.summary)}</p>` : '') + ul(ms.debriefPoints)),
            card('Teaching aid', ul(ms.teachingPoints)),
            ms.source ? `<p class="muted">Source: ${esc(ms.source)}</p>` : ''
        ].join('');
    };
    const printSheet = (scenario) => {
        const css = 'body{font-family:Arial,sans-serif;color:#0f172a;margin:0;padding:20px;max-width:1000px}h1{color:#0369a1;margin:0 0 4px}h3{margin:0 0 6px}h4{margin:8px 0 4px;color:#334155}.card{border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;margin-bottom:10px;break-inside:avoid}table{width:100%;border-collapse:collapse;font-size:.85rem}th,td{text-align:left;vertical-align:top;padding:4px 6px;border-bottom:1px solid #e2e8f0}th{color:#475569;font-size:.7rem;text-transform:uppercase}ul{margin:0;padding-left:20px}.muted{color:#64748b;font-size:.75rem}.restricted{color:#92400e;font-size:.75rem}';
        const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Mark sheet — ${esc(scenario.title)}</title><style>${css}</style></head><body><h1>${esc(scenario.title)}</h1><p class="restricted">Restricted course material. For use on the course only; do not copy or share.</p>${sheetHtml(scenario, null)}</body></html>`;
        const w = window.open('', '_blank');
        if (!w || !w.document) { window.alert('The browser blocked the print window. Allow pop-ups for this site and try again.'); return; }
        w.document.open(); w.document.write(html); w.document.close();
        const go = () => { try { w.focus(); w.print(); } catch (e) {} };
        if (w.document.readyState === 'complete') setTimeout(go, 300); else w.addEventListener('load', () => setTimeout(go, 300));
    };

    // ---- the modal (scenario list, briefing and controller) --------------------------------------
    const MarkSheetModal = ({ scenario, onClose }) => {
        const { Modal, Button, Lucide } = window;
        if (!scenario || !get(scenario)) return null;
        return (
            <Modal label={`Mark sheet: ${scenario.title}`} onClose={onClose} className="bg-slate-800 border border-slate-600 rounded-lg w-full max-w-5xl max-h-[92vh] flex flex-col">
                <div className="flex items-center justify-between gap-2 p-3 border-b border-slate-700">
                    <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-wider text-amber-400 font-bold">{get(scenario).kind === 'assessment' ? 'Team leader assessment' : 'Facilitator pack'}{scenario.group ? ` · ${scenario.group}` : ''}</div>
                        <h3 className="text-lg font-bold text-white truncate">{scenario.title}</h3>
                    </div>
                    <div className="flex gap-2 flex-none">
                        <Button variant="outline" onClick={() => printSheet(scenario)} className="h-8 px-2 text-xs"><Lucide icon="printer" className="w-3 h-3 mr-1"/> Print</Button>
                        <Button variant="secondary" onClick={onClose} className="h-8 px-3 text-xs">Close</Button>
                    </div>
                </div>
                <div className="overflow-y-auto p-3"><MarkSheetBody scenario={scenario} /></div>
            </Modal>
        );
    };

    // ---- the debrief card ------------------------------------------------------------------------
    const DebriefMarkSheet = ({ scenario, marks, onMark }) => {
        const [open, setOpen] = useState(false);
        const ms = get(scenario);
        if (!ms || !items(scenario).length) return null;
        return (
            <div className="bg-slate-800 p-4 rounded-lg border border-fuchsia-800/60" data-testid="debrief-marksheet">
                <h3 className="text-lg font-bold text-white mb-1">{ms.kind === 'assessment' ? 'Team leader assessment' : 'Mark sheet'}</h3>
                <p className="text-xs text-slate-400 mb-2">Mark each criterion for the team leader. The marks go into the downloaded or printed report.</p>
                <Criteria scenario={scenario} marks={marks} onMark={onMark} />
                {(ms.summary || asList(ms.debriefPoints).length > 0) && (
                    <div className="mt-3">
                        <button type="button" onClick={() => setOpen(o => !o)} className="text-xs text-sky-300 underline">{open ? 'Hide' : 'Show'} the learning points for the debrief</button>
                        {open && <div className="mt-2">{ms.summary && <p className="text-sm text-slate-300 mb-1">{str(ms.summary)}</p>}<Bullets list={ms.debriefPoints} /></div>}
                    </div>
                )}
            </div>
        );
    };

    // Groups restricted scenarios for the list: course, then group, in authored order.
    const groupScenarios = (list) => {
        const order = (s) => (Number.isFinite(Number(s.order)) ? Number(s.order) : 1e6);
        const sorted = [...list].sort((a, b) => order(a) - order(b) || str(a.title).localeCompare(str(b.title)));
        const groups = [];
        sorted.forEach(s => {
            const key = str(s.group) || str(s.category) || 'Other';
            let g = groups.find(x => x.key === key);
            if (!g) { g = { key, scenarios: [] }; groups.push(g); }
            g.scenarios.push(s);
        });
        return groups;
    };
    const courseOf = (s) => str(s && s.course).trim() || 'Other';

    window.MarkScheme = { get, items, result, asList, sheetHtml, criteriaHtml, printSheet, groupScenarios, courseOf, MarkSheetBody, MarkSheetModal, DebriefMarkSheet };
})();
