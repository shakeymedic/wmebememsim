(() => {
    const { useState, useEffect } = React;

    // =========================================================================================
    // VITALS TREND FOR THE DOWNLOADABLE / PRINTED REPORT.
    // The on-screen graph below never reached the report, which had no trend at all. HR, BP, SpO2
    // and RR have different units, so rather than one shared y-axis they are four small charts on a
    // shared time axis (small multiples), each titled, with the flagged events (arrests, shocks,
    // hand-flagged moments) marked as vertical lines on every chart and listed underneath, plus a
    // table of the sampled values so nothing depends on reading a line by colour. Plain SVG strings:
    // the report is a standalone HTML file with no scripts.
    // =========================================================================================
    const escHtml = (v) => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmtClock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
    const buildReportTrend = (history, log) => {
        const pts = (history || []).filter(h => Number.isFinite(Number(h.time)));
        if (pts.length < 2) {
            return `<div class="card"><h3 style="margin-top:0;">Vitals trend</h3><div class="muted">No trend was recorded. The trend is sampled every 5 seconds while the clock runs (in Quick Sim, press START to record it).</div></div>`;
        }
        const t0 = Math.min(...pts.map(h => h.time)), t1 = Math.max(...pts.map(h => h.time));
        const span = Math.max(1, t1 - t0);
        const events = (log || []).filter(l => l.flagged && Number.isFinite(Number(l.timeSeconds)) && l.timeSeconds >= t0 && l.timeSeconds <= t1);
        const W = 360, H = 150, L = 38, R = 10, T = 22, B = 24, gw = W - L - R, gh = H - T - B;
        const x = (t) => L + ((t - t0) / span) * gw;
        const chart = (key, title, unit, floorMax, fixed) => {
            const vals = pts.map(h => Number(h[key])).filter(Number.isFinite);
            if (!vals.length) return '';
            const lo = fixed ? fixed[0] : 0;
            const hi = fixed ? fixed[1] : Math.max(floorMax, Math.ceil((Math.max(...vals) * 1.1) / 20) * 20);
            const y = (v) => T + gh - ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * gh;
            const d = pts.filter(h => Number.isFinite(Number(h[key]))).map((h, i) => `${i ? 'L' : 'M'}${x(h.time).toFixed(1)},${y(Number(h[key])).toFixed(1)}`).join(' ');
            const ticks = [lo, (lo + hi) / 2, hi].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/><text x="${L - 4}" y="${(y(v) + 3).toFixed(1)}" font-size="9" fill="#64748b" text-anchor="end">${Math.round(v)}</text>`).join('');
            const marks = events.map(e => `<line x1="${x(e.timeSeconds).toFixed(1)}" x2="${x(e.timeSeconds).toFixed(1)}" y1="${T}" y2="${T + gh}" stroke="#94a3b8" stroke-width="1" stroke-dasharray="3 3"/>`).join('');
            const last = vals[vals.length - 1];
            return `<figure class="mini"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escHtml(title)} over time"><text x="${L}" y="13" font-size="11" font-weight="bold" fill="#0f172a">${escHtml(title)} <tspan font-weight="normal" fill="#64748b">(${escHtml(unit)}) \u2014 last ${escHtml(Math.round(last * 10) / 10)}</tspan></text>${ticks}${marks}<path d="${d}" fill="none" stroke="#2563eb" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><text x="${L}" y="${H - 6}" font-size="9" fill="#64748b">${fmtClock(t0)}</text><text x="${W - R}" y="${H - 6}" font-size="9" fill="#64748b" text-anchor="end">${fmtClock(t1)}</text></svg></figure>`;
        };
        const charts = [chart('hr', 'Heart rate', 'bpm', 160), chart('bp', 'Systolic BP', 'mmHg', 180), chart('spo2', 'SpO2', '%', 100, [50, 100]), chart('rr', 'Resp rate', '/min', 40)].join('');
        const eventList = events.length
            ? `<ol class="events">${events.map(e => `<li><span class="mono">${escHtml(e.simTime || fmtClock(e.timeSeconds))}</span> ${escHtml(e.msg)}</li>`).join('')}</ol>`
            : '<div class="muted">No flagged events in this period.</div>';
        // One table row per 30 s of sim time (every sample would run to pages).
        const rows = []; let lastT = -Infinity;
        pts.forEach(h => { if (h.time - lastT >= 30 || h === pts[pts.length - 1]) { rows.push(h); lastT = h.time; } });
        const num = (v, dp) => Number.isFinite(Number(v)) ? Number(v).toFixed(dp || 0) : '\u2014';
        const table = `<table class="compact"><thead><tr><th>Time</th><th>HR</th><th>SBP</th><th>SpO2</th><th>RR</th><th>Temp</th><th>GCS</th></tr></thead><tbody>${rows.map(h => `<tr><td class="mono">${fmtClock(h.time)}</td><td>${num(h.hr)}</td><td>${num(h.bp)}</td><td>${num(h.spo2)}</td><td>${num(h.rr)}</td><td>${num(h.temp, 1)}</td><td>${escHtml(h.gcs ?? '\u2014')}</td></tr>`).join('')}</tbody></table>`;
        return `<div class="card"><h3 style="margin-top:0;">Vitals trend</h3><p class="muted" style="margin-top:0;">Dashed lines mark flagged events (listed below the charts).</p><div class="minis">${charts}</div><h4>Flagged events</h4>${eventList}<h4>Sampled values</h4>${table}</div>`;
    };
    window.__debriefReportTrend = buildReportTrend;   // exercised by the verifier

    const DebriefGraph = ({ history, log, quickSim }) => {
        if (!history || history.length < 2) return <div className="text-slate-500 text-xs p-4 text-center">{quickSim ? 'No vitals trend yet: it is recorded every 5 seconds while the clock runs. In Quick Sim, press START to record it.' : 'Not enough data for graph'}</div>;

        const width = 1200;
        const height = 700;
        const paddingLeft = 50;
        const paddingRight = 100;
        const paddingTop = 50;
        const paddingBottom = 250; 
        const graphW = width - paddingLeft - paddingRight;
        const graphH = height - paddingTop - paddingBottom;

        const maxTime = Math.max(...history.map(h => h.time));
        const minTime = Math.min(...history.map(h => h.time));
        const duration = maxTime - minTime || 1;

        const getX = (t) => paddingLeft + ((t - minTime) / duration) * graphW;
        // Axis maxima used to be hardcoded, so one extreme value (e.g. HR 999) was drawn above the
        // plot area and clipped away. Grow the axis to fit the data, and clamp as a last resort.
        const axisMax = (key, floor) => {
            const peak = Math.max(0, ...history.map(h => Number(h[key])).filter(Number.isFinite));
            return Math.max(floor, Math.ceil((peak * 1.1) / 20) * 20);
        };
        const hrMax = axisMax('hr', 200);
        const bpMax = axisMax('bp', 250);
        const spo2Max = 100;
        const getY = (val, maxVal) => {
            const v = Math.min(Math.max(Number(val) || 0, 0), maxVal);
            return (height - paddingBottom) - (v / maxVal) * graphH;
        };
        const buildPath = (key, maxVal) => {
            const pts = history.filter(h => Number.isFinite(Number(h[key])));
            if (pts.length < 2) return "";
            return "M " + pts.map(h => `${getX(h.time)},${getY(h[key], maxVal)}`).join(" L ");
        };

        const hrPath = buildPath('hr', hrMax);
        const bpPath = buildPath('bp', bpMax);
        const spo2Path = buildPath('spo2', spo2Max);

        // WAVE 2 / B2: temp, glucose and pH are modelled vitals now, so a warming, dextrose or
        // bicarbonate scenario has a real trace worth debriefing. Each needs its OWN scale (a pH of
        // 7.2 on an HR axis is a flat line at the bottom), and a channel that never moved and sat at
        // its normal value is omitted rather than drawing a meaningless straight line.
        const bandedPath = (key, lo, hi) => {
            const pts = history.filter(h => Number.isFinite(Number(h[key])));
            if (pts.length < 2) return null;
            const vals = pts.map(h => Number(h[key]));
            const span = Math.max(...vals) - Math.min(...vals);
            if (span < (hi - lo) * 0.02) return null;
            const y = (v) => (height - paddingBottom) - ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * graphH;
            return { d: 'M ' + pts.map(h => `${getX(h.time)},${y(Number(h[key]))}`).join(' L '), lo, hi };
        };
        const tempTrace = bandedPath('temp', 30, 42);
        const bmTrace = bandedPath('bm', 0, 30);
        const phTrace = bandedPath('ph', 6.8, 7.7);
        let extraLegendRow = 3;

        return (
            <div className="w-full bg-slate-900 border border-slate-700 rounded p-4 mb-4 overflow-hidden">
                <h4 className="text-xs font-bold text-slate-400 mb-2 uppercase">Vitals Trend & Interventions</h4>
                <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto bg-slate-950 rounded border border-slate-800">
                    <line x1={paddingLeft} y1={height-paddingBottom} x2={width-paddingRight} y2={height-paddingBottom} stroke="#334155" strokeWidth="2"/>
                    <line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={height-paddingBottom} stroke="#334155" strokeWidth="2"/>
                    
                    <path d={hrPath} fill="none" stroke="#22c55e" strokeWidth="4" />
                    <path d={bpPath} fill="none" stroke="#ef4444" strokeWidth="4" />
                    <path d={spo2Path} fill="none" stroke="#3b82f6" strokeWidth="3" strokeDasharray="8" />
                    {tempTrace && <path d={tempTrace.d} fill="none" stroke="#f97316" strokeWidth="2" strokeDasharray="2 6" />}
                    {bmTrace && <path d={bmTrace.d} fill="none" stroke="#a78bfa" strokeWidth="2" strokeDasharray="2 6" />}
                    {phTrace && <path d={phTrace.d} fill="none" stroke="#facc15" strokeWidth="2" strokeDasharray="2 6" />}

                    {(() => {
                        let lastLabelX = -Infinity;
                        // B5: 'danger' and 'warning' are now plotted too. Shocks are logged as
                        // 'danger', so every defibrillation in the session was previously INVISIBLE
                        // on the debrief timeline — the single most important event in an arrest
                        // scenario did not appear in the debrief at all.
                        const PLOTTED = ['action', 'manual', 'danger', 'warning'];
                        const MARKER_FILL = { danger: '#ef4444', warning: '#f59e0b', manual: '#a78bfa', action: '#0ea5e9' };
                        return log.filter(l => PLOTTED.includes(l.type) && l.timeSeconds !== undefined && l.timeSeconds !== null).map((l, i) => {
                            const x = getX(l.timeSeconds);
                            const showLabel = x - lastLabelX >= 80;
                            if (showLabel) lastLabelX = x;
                            const yPos = height - paddingBottom + 15;
                            const fill = MARKER_FILL[l.type] || '#0ea5e9';
                            const isShock = l.type === 'danger' && /shock/i.test(l.msg || '');
                            return <g key={i}><line x1={x} y1={paddingTop} x2={x} y2={yPos} stroke={l.type === 'danger' ? '#ef4444' : '#94a3b8'} strokeWidth={isShock ? 2 : 1} strokeOpacity={isShock ? 0.7 : 0.4} strokeDasharray="4"/><circle cx={x} cy={yPos} r={isShock ? 7 : 5} fill={fill}/>{isShock && <text x={x} y={paddingTop + 14} fill="#fca5a5" fontSize="13" fontWeight="bold" textAnchor="middle">\u26a1</text>}{showLabel && <text x={x} y={yPos + 15} fill="#f8fafc" fontSize="12" fontWeight="bold" textAnchor="start" transform={`rotate(45, ${x}, ${yPos + 15})`}>{l.msg}</text>}</g>;
                        });
                    })()}
                    
                    <text x={width-90} y={paddingTop + 20} fill="#22c55e" fontSize="18" fontWeight="bold">HR /{hrMax}</text>
                    <text x={width-90} y={paddingTop + 45} fill="#ef4444" fontSize="18" fontWeight="bold">BP /{bpMax}</text>
                    <text x={width-90} y={paddingTop + 70} fill="#3b82f6" fontSize="18" fontWeight="bold">SpO2 /100</text>
                    {tempTrace && <text x={width-90} y={paddingTop + 70 + 25 * (extraLegendRow++ - 2)} fill="#f97316" fontSize="14" fontWeight="bold">Temp {tempTrace.lo}-{tempTrace.hi}</text>}
                    {bmTrace && <text x={width-90} y={paddingTop + 70 + 25 * (extraLegendRow++ - 2)} fill="#a78bfa" fontSize="14" fontWeight="bold">BM {bmTrace.lo}-{bmTrace.hi}</text>}
                    {phTrace && <text x={width-90} y={paddingTop + 70 + 25 * (extraLegendRow++ - 2)} fill="#facc15" fontSize="14" fontWeight="bold">pH {phTrace.lo}-{phTrace.hi}</text>}
                </svg>
            </div>
        );
    };

    const DebriefScreen = ({ sim, onExit }) => {
        const { state } = sim;
        const { Lucide, Button } = window;
        const scenario = state.scenario || {};
        // WAVE 4b / A5: QUICK SIM DEBRIEF. Quick Sim produces a real, lightweight debrief — event
        // log, vitals trend graph and instructor notes — but there is no scenario, so there are no
        // learning objectives to score and no score to show. Every scenario-dependent block below is
        // guarded, and `state.scenario` being null outright (an edge case that could previously
        // reach this screen via an aborted load) is handled by the `|| {}` above.
        const isQuickSim = !!scenario.quickSim;
        const [filter, setFilter] = useState('all');
        const [replayIdx, setReplayIdx] = useState(null);
        // WAVE 4b / D1: keyed on state.runId — a genuinely unique id minted per RUN by the engine.
        // It used to read `state.sessionID`, which has never existed on state, so the key silently
        // collapsed to the SCENARIO id and every run of the same scenario shared one set of notes.
        // The remaining fallbacks only matter for a pre-Wave-4b saved session.
        const notesKey = `wmebem_debrief_notes_${state.runId || scenario.id || 'current'}`;
        const [instructorNotes, setInstructorNotes] = useState(() => { try { return localStorage.getItem(notesKey) || ''; } catch (e) { return ''; } });
        useEffect(() => { try { localStorage.setItem(notesKey, instructorNotes); } catch (e) {} }, [notesKey, instructorNotes]);

        const filteredLog = state.log.filter(entry => {
            if (filter === 'all') return true;
            if (filter === 'actions') return entry.type === 'action';
            if (filter === 'manual') return entry.type === 'manual' || entry.flagged;
            if (filter === 'system') return entry.type === 'system';
            // B5: the log filter had no way of showing 'danger'/'warning' entries at all, so shocks
            // and flagged deviations could not be isolated in the debrief.
            if (filter === 'shocks') return entry.type === 'danger' || /shock|defib|cardiovers/i.test(entry.msg || '');
            if (filter === 'rhythm') return /^Rhythm:/i.test(entry.msg || '') || /ROSC|CARDIAC ARREST/i.test(entry.msg || '');
            return true;
        });

        // ---- B5: SHOCK METRICS IN THE DEBRIEF ------------------------------------------------
        // These now exist because Wave 3 moved the shock tally out of a bare useRef (which never
        // reached state, Firebase, localStorage or this screen, and reset on resume) into
        // state.defib, which is synced and persisted.
        const defibMetrics = state.defib || {};
        const shockEvents = state.log.filter(l => l.type === 'danger' && /shock delivered/i.test(l.msg || ''));
        const conversionEvents = state.log.filter(l => /^Rhythm:/.test(l.msg || '') && /\u2192/.test(l.msg || ''));

        // Sequence deviations: structured records written by the engine's permissive gating. Nothing
        // was blocked during the session; these are the teaching points that fell out of it.
        const deviations = state.log.filter(l => l.deviation && Array.isArray(l.deviation.missing));
        // WAVE 5 / ITEM 3: `flagged` marks BOTH deviations and merely-significant events (arrests,
        // shocks, hand flags). The two counts are now reported separately and labelled, so neither
        // screen shows a deviation count that disagrees with the deviation list.
        const flaggedCount = state.log.filter(l => l.flagged).length;
        const significanceCount = flaggedCount - deviations.length;

        const allObjectives = (() => {
            // A5: no scenario means no objectives. Array.isArray guards a restricted/pasted scenario
            // that carries a malformed learningObjectives field.
            const a = Array.isArray(scenario.learningObjectives) ? scenario.learningObjectives : [];
            const b = Array.isArray(scenario.instructorBrief?.learningObjectives) ? scenario.instructorBrief.learningObjectives : [];
            const seen = new Set();
            return [...a, ...b].filter(o => { if (seen.has(o)) return false; seen.add(o); return true; });
        })();
        const objectivesTotal = allObjectives.length;
        const completed = state.completedObjectives instanceof Set ? state.completedObjectives : new Set();
        // ---- WAVE 5 / ITEM 2: PARTIAL CREDIT ON MULTI-COMPONENT OBJECTIVES --------------------
        // "Hyperkalaemia treatment" needs calcium AND insulin/dextrose. Giving only calcium used to
        // read "0% — Objectives Met: 0/1", which a facilitator reasonably mistakes for a bug. The
        // engine now derives each objective's COMPONENTS from the scenario's own recommended actions
        // and reports which were done and which were missing. Scores are not inflated: the headline
        // number still counts only fully-completed objectives, and the partial-credit number is
        // shown next to it, explicitly labelled.
        const progress = (window.computeObjectiveProgress
            ? window.computeObjectiveProgress(state.scenario || {}, {
                interventionCounts: state.interventionCounts,
                activeInterventions: state.activeInterventions,
                completedObjectives: completed
            })
            : { objectives: [], total: objectivesTotal, fullyMet: 0, partial: 0, score: null, partialScore: null, hasPartial: false });
        const objectiveRows = progress.objectives || [];
        const objectivesMet = progress.fullyMet;
        // A score of "100%" against zero objectives is meaningless and actively misleading in Quick
        // Sim, so the score is null when there is nothing to score and the card is omitted.
        const score = objectivesTotal > 0 ? (progress.score ?? 0) : null;
        const partialScore = objectivesTotal > 0 ? (progress.partialScore ?? 0) : null;
        const partialCount = progress.partial || 0;
        const statusOf = (obj) => {
            const row = objectiveRows.find(r => r.objective === obj);
            return row || { objective: obj, status: completed.has(obj) ? 'met' : 'none', components: [], metComponents: [], missingComponents: [], multiComponent: false };
        };

        const generateReport = (mode) => {
            const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
            // WAVE 5 / ITEM 2: the report shows the same three-state status and names the components
            // that were and were not done, so a partial objective is never printed as a bare failure.
            const objRows = allObjectives.map(obj => {
                const r = statusOf(obj);
                const colour = r.status === 'met' ? '#22c55e' : r.status === 'partial' ? '#fbbf24' : '#ef4444';
                const label = r.status === 'met' ? '\u2713 Met' : r.status === 'partial' ? '\u25D0 Partly done' : '\u2715 Not Met';
                const detail = (r.components && r.components.length)
                    ? `${r.metComponents.length ? 'Done: ' + esc(r.metComponents.join(', ')) : ''}${r.metComponents.length && r.missingComponents.length ? '<br>' : ''}${r.missingComponents.length ? 'Not done: ' + esc(r.missingComponents.join(', ')) : ''}`
                    : '<span style="color:#64748b;">No component breakdown available for this objective.</span>';
                return `<tr><td style="padding:6px 10px;border-bottom:1px solid #334155;">${esc(obj)}</td><td style="padding:6px 10px;border-bottom:1px solid #334155;color:${colour};font-weight:bold;white-space:nowrap;">${label}</td><td style="padding:6px 10px;border-bottom:1px solid #334155;color:#cbd5e1;font-size:.85rem;">${detail}</td></tr>`;
            }).join('');
            const logRows = state.log.map(l => { const colour = l.type === 'danger' ? '#ef4444' : l.type === 'success' ? '#22c55e' : '#cbd5e1'; return `<tr><td style="padding:5px 10px;border-bottom:1px solid #1e293b;color:#94a3b8;font-family:monospace;white-space:nowrap;">${esc(l.simTime)}</td><td style="padding:5px 10px;border-bottom:1px solid #1e293b;color:${colour};">${l.flagged ? '\uD83D\uDEA9 ' : ''}${esc(l.msg)}</td></tr>`; }).join('');
            const devRows = deviations.map(d => `<tr><td style="padding:5px 10px;border-bottom:1px solid #1e293b;color:#94a3b8;font-family:monospace;white-space:nowrap;">${esc(d.simTime)}</td><td style="padding:5px 10px;border-bottom:1px solid #1e293b;color:#fbbf24;font-weight:bold;">${esc(d.deviation.label || d.deviation.action)}</td><td style="padding:5px 10px;border-bottom:1px solid #1e293b;color:#cbd5e1;">${esc(d.deviation.missing.join(', '))}</td></tr>`).join('');
            const shockRows = shockEvents.map(l => `<tr><td style="padding:5px 10px;border-bottom:1px solid #1e293b;color:#94a3b8;font-family:monospace;white-space:nowrap;">${esc(l.simTime)}</td><td style="padding:5px 10px;border-bottom:1px solid #1e293b;color:#fca5a5;">${esc(l.msg)}</td></tr>`).join('');
            const convRows = conversionEvents.map(l => `<tr><td style="padding:5px 10px;border-bottom:1px solid #1e293b;color:#94a3b8;font-family:monospace;white-space:nowrap;">${esc(l.simTime)}</td><td style="padding:5px 10px;border-bottom:1px solid #1e293b;color:#fbbf24;">${esc(l.msg)}</td></tr>`).join('');
            // B5: defibrillation data reaches the downloadable debrief report too.
            const defibCard = `<div class="card"><h3 style="color:#ef4444;margin-top:0;">Defibrillation &amp; Rhythm</h3><div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:12px;"><div><div style="font-size:.7rem;color:#64748b;text-transform:uppercase;">Shocks</div><div style="font-size:1.5rem;font-weight:bold;">${esc(defibMetrics.shockCount || shockEvents.length || 0)}</div></div><div><div style="font-size:.7rem;color:#64748b;text-transform:uppercase;">Into shockable rhythm</div><div style="font-size:1.5rem;font-weight:bold;">${esc(defibMetrics.shockableShocks || 0)}</div></div><div><div style="font-size:.7rem;color:#64748b;text-transform:uppercase;">Cumulative energy</div><div style="font-size:1.5rem;font-weight:bold;">${esc(defibMetrics.totalEnergy || 0)} J</div></div><div><div style="font-size:.7rem;color:#64748b;text-transform:uppercase;">Last energy</div><div style="font-size:1.5rem;font-weight:bold;">${esc(defibMetrics.lastEnergy ?? '--')} J</div></div></div>${shockRows ? `<table><thead><tr><th>Time</th><th>Shock</th></tr></thead><tbody>${shockRows}</tbody></table>` : '<div style="color:#94a3b8;">No shocks delivered.</div>'}${convRows ? `<h4 style="color:#fbbf24;">Rhythm transitions</h4><table><thead><tr><th>Time</th><th>Transition</th></tr></thead><tbody>${convRows}</tbody></table>` : ''}</div>`;
            const devCard = `<div class="card"><h3 style="color:#fbbf24;margin-top:0;">Sequence Deviations</h3>${deviations.length ? `<table><thead><tr><th>Time</th><th>Action</th><th>Not in place</th></tr></thead><tbody>${devRows}</tbody></table>` : '<div style="color:#94a3b8;">No sequence deviations recorded.</div>'}</div>`;
            const safeTitle = esc(scenario.title || 'Simulation');
            // A5: the objectives card and the score are omitted from the downloadable report when
            // there are no objectives, rather than printing "100% of 0".
            const scoreBlock = score === null
                ? `<div><div style="font-size:.75rem;color:#64748b;text-transform:uppercase;">Mode</div><div style="font-size:1.5rem;font-weight:bold;">Quick Sim</div><div style="font-size:.7rem;color:#64748b;">No scenario \u2014 nothing to score</div></div>`
                : `<div><div style="font-size:.75rem;color:#64748b;text-transform:uppercase;">Score (fully met)</div><div class="score">${esc(score)}%</div></div><div><div style="font-size:.75rem;color:#64748b;text-transform:uppercase;">Objectives Met</div><div style="font-size:1.5rem;font-weight:bold;">${esc(objectivesMet)} / ${esc(objectivesTotal)}</div>${partialCount ? `<div style="font-size:.7rem;color:#fbbf24;">+ ${esc(partialCount)} partly done</div>` : ''}</div>${partialCount ? `<div><div style="font-size:.75rem;color:#64748b;text-transform:uppercase;">With partial credit</div><div style="font-size:1.5rem;font-weight:bold;color:#fbbf24;">${esc(partialScore)}%</div><div style="font-size:.7rem;color:#64748b;">components done / components expected</div></div>` : ''}`;
            const objCard = objectivesTotal === 0 ? '' : `<div class="card"><h3 style="color:#a78bfa;margin-top:0;">Learning Objectives</h3><p style="color:#94a3b8;font-size:.8rem;margin-top:0;">Objectives made of more than one component are only \u201cmet\u201d when every component was done. Anything started but incomplete is shown as partly done, with the missing component named \u2014 a low score here is a discussion point, not a verdict.</p><table><thead><tr><th>Objective</th><th>Status</th><th>Components</th></tr></thead><tbody>${objRows}</tbody></table></div>`;
            // Light, print-friendly theme (it used to be dark, which printed as solid black pages).
            // The inline colours inside the cards were written for a dark background, so the CSS
            // re-maps the light-on-dark ones to readable ink.
            const reportCss = `body{font-family:Arial,sans-serif;background:#fff;color:#0f172a;margin:0;padding:24px;max-width:1000px}h1{color:#0369a1;margin-bottom:4px}h2{color:#475569;font-size:1rem;font-weight:normal;margin-bottom:24px}h3{color:#0f172a!important}h4{margin:14px 0 6px;color:#334155}.card{background:#fff;border-radius:8px;padding:16px;margin-bottom:16px;border:1px solid #cbd5e1;break-inside:avoid}.score{font-size:3rem;font-weight:bold;color:#0369a1}table{width:100%;border-collapse:collapse}th{text-align:left;padding:8px 10px;color:#475569;font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #cbd5e1}td{color:#0f172a!important;border-bottom:1px solid #e2e8f0!important}.muted{color:#64748b;font-size:.85rem}.mono{font-family:monospace;color:#475569}.minis{display:grid;grid-template-columns:1fr 1fr;gap:8px}.mini{margin:0;border:1px solid #e2e8f0;border-radius:6px;padding:4px}.mini svg{width:100%;height:auto;display:block}.events{margin:0;padding-left:20px;font-size:.85rem}table.compact td,table.compact th{padding:3px 8px;font-size:.8rem}@media (max-width:640px){.minis{grid-template-columns:1fr}}@media print{body{padding:0}.card{border-color:#94a3b8}a{color:inherit}}`;
            const trendCard = buildReportTrend(state.history, state.log);
            const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Debrief \u2014 ${safeTitle}</title><style>${reportCss}</style></head><body><h1>${safeTitle}</h1><h2>Simulation Debrief Report &nbsp;&bull;&nbsp; ${esc(new Date().toLocaleString('en-GB'))}</h2><div class="card"><div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;">${scoreBlock}<div><div style="font-size:.75rem;color:#64748b;text-transform:uppercase;">Duration</div><div style="font-size:1.5rem;font-weight:bold;">${esc(Math.floor(state.time/60))}m ${esc(state.time%60)}s</div></div></div></div>${objCard}${trendCard}${devCard}${defibCard}<div class="card"><h3 style="color:#38bdf8;margin-top:0;">Simulation Log</h3><table><thead><tr><th>Time</th><th>Event</th></tr></thead><tbody>${logRows}</tbody></table></div><div class="card"><h3 style="color:#fbbf24;margin-top:0;">Instructor Notes</h3><div style="white-space:pre-wrap;">${esc(instructorNotes)}</div></div></body></html>`;
            if (mode === 'print') {
                // Opened from the click itself, so popup blockers allow it. If one still blocks it,
                // fall back to downloading the same file.
                const w = window.open('', '_blank');
                if (w && w.document) {
                    w.document.open(); w.document.write(html); w.document.close();
                    const go = () => { try { w.focus(); w.print(); } catch (e) {} };
                    if (w.document.readyState === 'complete') setTimeout(go, 300); else w.addEventListener('load', () => setTimeout(go, 300));
                    return;
                }
            }
            const blob = new Blob([html], { type: 'text/html' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `Debrief_${Date.now()}.html`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
        };

        return (
            <div className="h-full flex flex-col bg-slate-900 p-4 overflow-hidden">
                <div className="flex justify-between items-center mb-4 border-b border-slate-700 pb-4">
                    <div>
                        <h1 className="text-2xl font-bold text-white flex items-center gap-2"><Lucide icon="check-circle" className="text-emerald-500"/> Simulation Complete</h1>
                        <p className="text-slate-400">
                            {scenario.title || 'Simulation'}
                            {isQuickSim && <span className="ml-2 text-[10px] uppercase tracking-wider font-bold text-sky-400 border border-sky-700 bg-sky-950/40 rounded px-1.5 py-0.5">Quick Sim &middot; no scenario</span>}
                            {' '}• Duration: {Math.floor(state.time/60)}m {state.time%60}s
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <Button onClick={() => generateReport('print')} variant="secondary" title="Open a print-friendly report and print it (or save as PDF)"><Lucide icon="printer" className="mr-2 h-4 w-4"/> Print</Button>
                        <Button onClick={() => generateReport('download')} variant="secondary"><Lucide icon="download" className="mr-2 h-4 w-4"/> Download Report</Button>
                        <Button onClick={onExit} variant="danger">Exit to Menu</Button>
                    </div>
                </div>

                <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-hidden min-h-0">
                    <div className="overflow-y-auto space-y-4 pr-2">
                        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                            <h3 className="text-lg font-bold text-white mb-2">Performance Summary</h3>
                            {/* A5: with no scenario there are no objectives and therefore no score.
                                Showing "100%" against zero objectives would be actively misleading. */}
                            {score === null ? (
                                <div className="mb-4 text-sm text-slate-400">
                                    {isQuickSim
                                        ? 'Quick Sim has no scenario, so there are no learning objectives to score. The event log, the vitals trend and your notes below are the debrief.'
                                        : 'This session declared no learning objectives, so there is nothing to score.'}
                                </div>
                            ) : (
                                <div className="flex items-center gap-4 mb-4 flex-wrap">
                                    <div>
                                        <div className="text-4xl font-bold text-sky-400">{score}%</div>
                                        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Fully met</div>
                                    </div>
                                    {/* WAVE 5 / ITEM 2: partial credit is shown next to the strict score, never
                                        folded into it, so a part-treated multi-component objective reads as
                                        "1 of 2 components done" rather than as a flat 0%. */}
                                    {partialCount > 0 && (
                                        <div>
                                            <div className="text-4xl font-bold text-amber-400">{partialScore}%</div>
                                            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">With partial credit</div>
                                        </div>
                                    )}
                                    <div className="text-sm text-slate-400">
                                        Objectives Met: {objectivesMet}/{objectivesTotal}
                                        {partialCount > 0 && <span className="text-amber-400"> · {partialCount} partly done</span>}
                                    </div>
                                </div>
                            )}
                            
                            {/* B5: shock summary. Shock count, cumulative energy and the last energy
                                used are teaching data (energy escalation, 4 J/kg in children,
                                shocks-per-ROSC) and were previously unavailable after the session. */}
                            <div className="mb-4 bg-slate-900 border border-red-900/60 rounded p-3">
                                <h4 className="text-xs font-bold text-red-400 uppercase mb-2 flex items-center gap-1"><Lucide icon="zap" className="w-3 h-3"/> Defibrillation</h4>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    {[['Shocks', defibMetrics.shockCount || shockEvents.length || 0, ''],
                                      ['Into shockable', defibMetrics.shockableShocks || 0, ''],
                                      ['Cumulative', defibMetrics.totalEnergy || 0, 'J'],
                                      ['Last energy', defibMetrics.lastEnergy ?? '--', 'J']].map(([lbl, val, unit]) => (
                                        <div key={lbl} className="bg-slate-800 rounded p-2 text-center border border-slate-700">
                                            <div className="text-[10px] font-bold uppercase text-slate-400">{lbl}</div>
                                            <div className="text-lg font-mono font-bold text-white">{val}<span className="text-[9px] text-slate-500 ml-0.5">{unit}</span></div>
                                        </div>
                                    ))}
                                </div>
                                <div className="text-[10px] text-slate-500 mt-2">
                                    Device left in {String(defibMetrics.mode || 'monitor').toUpperCase()} mode{defibMetrics.syncMode ? ', SYNC armed' : ''}.
                                    {' '}{conversionEvents.length} rhythm transition{conversionEvents.length === 1 ? '' : 's'} recorded.
                                </div>
                                {shockEvents.length > 0 && (
                                    <div className="mt-2 max-h-28 overflow-y-auto space-y-1">
                                        {shockEvents.map((l, i) => (
                                            <div key={i} className="flex gap-2 text-[11px]">
                                                <span className="font-mono text-slate-500 flex-none">{l.simTime}</span>
                                                <span className="text-red-300">{l.msg}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <DebriefGraph history={state.history} log={state.log} quickSim={isQuickSim} />

                            {state.history && state.history.length > 1 && (
                                <div className="mb-4 bg-slate-900 border border-slate-700 rounded p-3">
                                    <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">Session Replay</h4>
                                    <input
                                        type="range"
                                        min={0}
                                        max={state.history.length - 1}
                                        value={replayIdx !== null ? replayIdx : state.history.length - 1}
                                        onChange={e => setReplayIdx(parseInt(e.target.value))}
                                        className="w-full accent-sky-500"
                                    />
                                    {replayIdx !== null && state.history[replayIdx] && (
                                        <div className="grid grid-cols-4 gap-2 mt-2">
                                            {[['HR', state.history[replayIdx].hr, 'bpm', '#22c55e'],
                                              ['BP', state.history[replayIdx].bp, 'mmHg', '#ef4444'],
                                              ['SpO2', state.history[replayIdx].spo2, '%', '#3b82f6'],
                                              ['RR', state.history[replayIdx].rr, '/min', '#a78bfa'],
                                              // Wave 2: the point-of-care channels are recorded too.
                                              ['Temp', Number.isFinite(state.history[replayIdx].temp) ? state.history[replayIdx].temp.toFixed(1) : '--', '°C', '#f97316'],
                                              ['BM', Number.isFinite(state.history[replayIdx].bm) ? state.history[replayIdx].bm.toFixed(1) : '--', 'mmol', '#c4b5fd'],
                                              ['pH', Number.isFinite(state.history[replayIdx].ph) ? state.history[replayIdx].ph.toFixed(2) : '--', '', '#facc15']].map(([lbl, val, unit, col]) => (
                                                <div key={lbl} className="bg-slate-800 rounded p-2 text-center border border-slate-700">
                                                    <div className="text-[10px] font-bold uppercase" style={{color: col}}>{lbl}</div>
                                                    <div className="text-lg font-mono font-bold text-white">{val ?? '--'}</div>
                                                    <div className="text-[9px] text-slate-500">{unit}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <div className="flex justify-between mt-1">
                                        <span className="text-[10px] text-slate-500">T+0s</span>
                                        <span className="text-[10px] text-sky-400 font-mono">{replayIdx !== null && state.history[replayIdx] ? `T+${state.history[replayIdx].time}s` : 'Drag to replay'}</span>
                                        <span className="text-[10px] text-slate-500">T+{state.history[state.history.length-1].time}s</span>
                                    </div>
                                </div>
                            )}

                            {/* A5: omitted entirely rather than rendered as an empty list. */}
                            {objectivesTotal > 0 && (
                                <>
                                    <h4 className="text-sm font-bold text-white mb-2 uppercase">Learning Objectives</h4>
                                    <ul className="space-y-2">
                                        {allObjectives.map((obj, i) => {
                                            const r = statusOf(obj);
                                            const icon = r.status === 'met' ? 'check-square' : r.status === 'partial' ? 'minus-square' : 'square';
                                            const colour = r.status === 'met' ? 'text-emerald-500' : r.status === 'partial' ? 'text-amber-400' : 'text-slate-600';
                                            return (
                                                <li key={i} className="text-sm text-slate-300">
                                                    <div className="flex items-start gap-2">
                                                        <Lucide icon={icon} className={`${colour} w-4 h-4 flex-none mt-0.5`} />
                                                        <span className="flex-1">{obj}</span>
                                                        {r.status === 'partial' && <span className="text-[9px] uppercase font-bold text-amber-300 border border-amber-700 bg-amber-950/40 rounded px-1 py-0.5 flex-none">partly done</span>}
                                                    </div>
                                                    {/* WAVE 5 / ITEM 2: name the components, so "not met" is never opaque. */}
                                                    {r.components && r.components.length > 0 && (
                                                        <div className="ml-6 mt-1 flex flex-wrap gap-1">
                                                            {r.components.map(c => (
                                                                <span key={c.key} className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${c.met ? 'text-emerald-300 border-emerald-800 bg-emerald-950/40' : 'text-slate-400 border-slate-700 bg-slate-900'}`}>
                                                                    {c.met ? '\u2713' : '\u2715'} {c.label}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                    <p className="text-[10px] text-slate-500 mt-2">A multi-component objective counts as met only when every component was done. Partly-done objectives show the missing component above and are excluded from the fully-met score.</p>
                                </>
                            )}
                        </div>

                        {/* A5: the sequence-deviation card is expectation machinery. Quick Sim has no
                            interventions at all, so there is nothing that could be out of sequence and
                            the card is omitted rather than shown permanently empty. Manual flags still
                            appear in the log pane on the right. */}
                        {!isQuickSim && (
                        <div className="bg-slate-800 p-4 rounded-lg border border-amber-600/50">
                            <h3 className="text-lg font-bold text-amber-400 mb-1 flex items-center gap-2"><Lucide icon="flag" className="w-4 h-4"/> Sequence Deviations</h3>
                            <p className="text-xs text-slate-400 mb-3">Actions performed before their usual prerequisites were in place. Nothing was blocked — these are discussion points, not errors by definition. {deviations.length} deviation{deviations.length === 1 ? '' : 's'}; {significanceCount} other flagged event{significanceCount === 1 ? '' : 's'} (arrests, shocks and manual flags) are highlighted in the timeline but are not deviations.</p>
                            {deviations.length === 0 ? (
                                <div className="text-sm text-slate-500">No sequence deviations recorded.</div>
                            ) : (
                                <ul className="space-y-2">
                                    {deviations.map((entry, i) => (
                                        <li key={i} className="bg-slate-900 border border-amber-700/40 rounded p-2">
                                            <div className="flex justify-between gap-2 items-baseline">
                                                <span className="text-sm font-bold text-amber-200">{entry.deviation.label || entry.deviation.action}</span>
                                                <span className="font-mono text-xs text-slate-500">{entry.simTime}</span>
                                            </div>
                                            <div className="text-xs text-slate-300 mt-0.5">Not in place: {entry.deviation.missing.join(', ')}</div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                        )}

                        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                            <h3 className="text-lg font-bold text-white mb-2">Instructor Notes</h3>
                            <textarea value={instructorNotes} onChange={e => setInstructorNotes(e.target.value)} className="w-full h-32 bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm" placeholder="Add feedback notes here..."></textarea>
                        </div>
                    </div>

                    <div className="flex flex-col bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
                        <div className="flex border-b border-slate-700 bg-slate-900 p-2 gap-2">
                            {['all', 'actions', 'manual', 'shocks', 'rhythm', 'system'].map(f => (
                                <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1 rounded text-xs font-bold uppercase ${filter === f ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                                    {f}
                                </button>
                            ))}
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-2">
                            {filteredLog.map((entry, i) => (
                                <div key={i} className={`flex gap-3 text-sm border-b border-slate-700/50 pb-1 ${entry.flagged ? 'bg-amber-900/10 p-1 rounded' : ''}`}>
                                    <span className="text-slate-500 font-mono w-16 flex-shrink-0">{entry.simTime}</span>
                                    <span className={`flex-grow ${entry.type === 'danger' ? 'text-red-400 font-bold' : entry.type === 'success' ? 'text-emerald-400 font-bold' : 'text-slate-300'}`}>
                                        {entry.flagged && <Lucide icon="flag" className="inline w-3 h-3 text-amber-500 mr-1"/>}
                                        {entry.msg}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    window.DebriefScreen = DebriefScreen;
})();
