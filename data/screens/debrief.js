(() => {
    const { useState } = React;

    const DebriefGraph = ({ history, log }) => {
        if (!history || history.length < 2) return <div className="text-slate-500 text-xs p-4 text-center">Not enough data for graph</div>;

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
        const getY = (val, maxVal) => (height - paddingBottom) - (val / maxVal) * graphH;

        let hrPath = "M " + history.map(h => `${getX(h.time)},${getY(h.hr, 200)}`).join(" L ");
        let bpPath = "M " + history.map(h => `${getX(h.time)},${getY(h.bp, 250)}`).join(" L ");
        let spo2Path = "M " + history.map(h => `${getX(h.time)},${getY(h.spo2, 100)}`).join(" L ");

        return (
            <div className="w-full bg-slate-900 border border-slate-700 rounded p-4 mb-4 overflow-hidden">
                <h4 className="text-xs font-bold text-slate-400 mb-2 uppercase">Vitals Trend & Interventions</h4>
                <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto bg-slate-950 rounded border border-slate-800">
                    <line x1={paddingLeft} y1={height-paddingBottom} x2={width-paddingRight} y2={height-paddingBottom} stroke="#334155" strokeWidth="2"/>
                    <line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={height-paddingBottom} stroke="#334155" strokeWidth="2"/>
                    
                    <path d={hrPath} fill="none" stroke="#22c55e" strokeWidth="4" />
                    <path d={bpPath} fill="none" stroke="#ef4444" strokeWidth="4" />
                    <path d={spo2Path} fill="none" stroke="#3b82f6" strokeWidth="3" strokeDasharray="8" />

                    {log.filter(l => l.type === 'action' || l.type === 'manual').map((l, i) => {
                        const x = getX(l.timeSeconds); 
                        if (!l.timeSeconds) return null;
                        const staggerY = (i % 8) * 25; 
                        const yPos = height - paddingBottom + staggerY + 15;
                        return (
                            <g key={i}>
                                <line x1={x} y1={paddingTop} x2={x} y2={yPos} stroke="#94a3b8" strokeWidth="1" strokeOpacity="0.4" strokeDasharray="4"/>
                                <circle cx={x} cy={yPos} r="5" fill="#0ea5e9"/>
                                <text x={x} y={yPos + 15} fill="#f8fafc" fontSize="12" fontWeight="bold" textAnchor="start" transform={`rotate(45, ${x}, ${yPos + 15})`}>{l.msg}</text>
                            </g>
                        );
                    })}
                    
                    <text x={width-80} y={paddingTop + 20} fill="#22c55e" fontSize="18" fontWeight="bold">HR</text>
                    <text x={width-80} y={paddingTop + 45} fill="#ef4444" fontSize="18" fontWeight="bold">BP</text>
                    <text x={width-80} y={paddingTop + 70} fill="#3b82f6" fontSize="18" fontWeight="bold">SpO2</text>
                </svg>
            </div>
        );
    };

    const DebriefScreen = ({ sim, onExit }) => {
        const { state } = sim;
        const { Lucide, Button } = window;
        const [filter, setFilter] = useState('all');
        const [replayIdx, setReplayIdx] = useState(null);

        const filteredLog = state.log.filter(entry => {
            if (filter === 'all') return true;
            if (filter === 'actions') return entry.type === 'action';
            if (filter === 'manual') return entry.type === 'manual' || entry.flagged;
            if (filter === 'system') return entry.type === 'system';
            return true;
        });

        const objectivesTotal = state.scenario.learningObjectives ? state.scenario.learningObjectives.length : 0;
        const objectivesMet = state.completedObjectives.size;
        const score = objectivesTotal > 0 ? Math.round((objectivesMet / objectivesTotal) * 100) : 100;

        const generateReport = () => {
            const objRows = (state.scenario.learningObjectives || []).map(obj => {
                const met = state.completedObjectives.has(obj);
                return `<tr><td style="padding:6px 10px;border-bottom:1px solid #334155;">${obj}</td><td style="padding:6px 10px;border-bottom:1px solid #334155;color:${met ? '#22c55e' : '#ef4444'};font-weight:bold;">${met ? '\u2713 Met' : '\u2715 Not Met'}</td></tr>`;
            }).join('');
            const logRows = state.log.map(l => {
                const colour = l.type === 'danger' ? '#ef4444' : l.type === 'success' ? '#22c55e' : '#cbd5e1';
                return `<tr><td style="padding:5px 10px;border-bottom:1px solid #1e293b;color:#94a3b8;font-family:monospace;white-space:nowrap;">${l.simTime}</td><td style="padding:5px 10px;border-bottom:1px solid #1e293b;color:${colour};">${l.flagged ? '\uD83D\uDEA9 ' : ''}${l.msg}</td></tr>`;
            }).join('');
            const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Debrief \u2014 ${state.scenario.title}</title><style>body{font-family:Arial,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:24px}h1{color:#38bdf8;margin-bottom:4px}h2{color:#94a3b8;font-size:1rem;font-weight:normal;margin-bottom:24px}.card{background:#1e293b;border-radius:8px;padding:16px;margin-bottom:16px;border:1px solid #334155}.score{font-size:3rem;font-weight:bold;color:#38bdf8}table{width:100%;border-collapse:collapse}th{text-align:left;padding:8px 10px;color:#64748b;font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #334155}</style></head><body>
<h1>${state.scenario.title}</h1><h2>Simulation Debrief Report &nbsp;&bull;&nbsp; ${new Date().toLocaleString()}</h2>
<div class="card"><div style="display:flex;align-items:center;gap:24px;"><div><div style="font-size:.75rem;color:#64748b;text-transform:uppercase;">Score</div><div class="score">${score}%</div></div><div><div style="font-size:.75rem;color:#64748b;text-transform:uppercase;">Objectives Met</div><div style="font-size:1.5rem;font-weight:bold;">${objectivesMet} / ${objectivesTotal}</div></div><div><div style="font-size:.75rem;color:#64748b;text-transform:uppercase;">Duration</div><div style="font-size:1.5rem;font-weight:bold;">${Math.floor(state.time/60)}m ${state.time%60}s</div></div></div></div>
<div class="card"><h3 style="color:#a78bfa;margin-top:0;">Learning Objectives</h3><table><thead><tr><th>Objective</th><th>Status</th></tr></thead><tbody>${objRows}</tbody></table></div>
<div class="card"><h3 style="color:#38bdf8;margin-top:0;">Simulation Log</h3><table><thead><tr><th>Time</th><th>Event</th></tr></thead><tbody>${logRows}</tbody></table></div>
</body></html>`;
            const blob = new Blob([html], { type: 'text/html' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Debrief_${Date.now()}.html`;
            a.click();
        };

        return (
            <div className="h-full flex flex-col bg-slate-900 p-4 overflow-hidden">
                <div className="flex justify-between items-center mb-4 border-b border-slate-700 pb-4">
                    <div>
                        <h1 className="text-2xl font-bold text-white flex items-center gap-2"><Lucide icon="check-circle" className="text-emerald-500"/> Simulation Complete</h1>
                        <p className="text-slate-400">{state.scenario.title} • Duration: {Math.floor(state.time/60)}m {state.time%60}s</p>
                    </div>
                    <div className="flex gap-2">
                        <Button onClick={generateReport} variant="secondary"><Lucide icon="download" className="mr-2 h-4 w-4"/> Download Report</Button>
                        <Button onClick={onExit} variant="danger">Exit to Menu</Button>
                    </div>
                </div>

                <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-hidden min-h-0">
                    <div className="overflow-y-auto space-y-4 pr-2">
                        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                            <h3 className="text-lg font-bold text-white mb-2">Performance Summary</h3>
                            <div className="flex items-center gap-4 mb-4">
                                <div className="text-4xl font-bold text-sky-400">{score}%</div>
                                <div className="text-sm text-slate-400">Objectives Met: {objectivesMet}/{objectivesTotal}</div>
                            </div>
                            
                            <DebriefGraph history={state.history} log={state.log} />

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
                                              ['RR', state.history[replayIdx].rr, '/min', '#a78bfa']].map(([lbl, val, unit, col]) => (
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

                            <h4 className="text-sm font-bold text-white mb-2 uppercase">Learning Objectives</h4>
                            <ul className="space-y-2">
                                {state.scenario.learningObjectives && state.scenario.learningObjectives.map((obj, i) => (
                                    <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                                        <Lucide icon={state.completedObjectives.has(obj) ? "check-square" : "square"} className={state.completedObjectives.has(obj) ? "text-emerald-500 w-4 h-4" : "text-slate-600 w-4 h-4"} />
                                        {obj}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                            <h3 className="text-lg font-bold text-white mb-2">Instructor Notes</h3>
                            <textarea className="w-full h-32 bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm" placeholder="Add feedback notes here..."></textarea>
                        </div>
                    </div>

                    <div className="flex flex-col bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
                        <div className="flex border-b border-slate-700 bg-slate-900 p-2 gap-2">
                            {['all', 'actions', 'manual', 'system'].map(f => (
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
