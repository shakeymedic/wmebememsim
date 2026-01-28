// data/screens/debrief.js
(() => {
    const { useState } = React;

    const DebriefGraph = ({ history, log }) => {
        if (!history || history.length < 2) return <div className="text-slate-500 text-xs p-4 text-center">Not enough data for graph</div>;

        const width = 800;
        const height = 500; // Increased height
        const padding = 40;
        const graphW = width - padding * 2;
        const graphH = height - padding * 2;

        const maxTime = Math.max(...history.map(h => h.time));
        const minTime = Math.min(...history.map(h => h.time));
        const duration = maxTime - minTime || 1;

        const getX = (t) => padding + ((t - minTime) / duration) * graphW;
        const getY = (val, maxVal) => (height - padding) - (val / maxVal) * graphH;

        // Create Paths
        let hrPath = "M " + history.map(h => `${getX(h.time)},${getY(h.hr, 200)}`).join(" L ");
        let bpPath = "M " + history.map(h => `${getX(h.time)},${getY(h.bp, 250)}`).join(" L ");
        let spo2Path = "M " + history.map(h => `${getX(h.time)},${getY(h.spo2, 100)}`).join(" L ");

        // Filter log for relevant events to tag (Action or Manual)
        const events = log.filter(l => (l.type === 'action' || l.type === 'manual') && l.timeSeconds);

        return (
            <div className="w-full bg-slate-900 border border-slate-700 rounded p-2 mb-4 overflow-hidden">
                <h4 className="text-xs font-bold text-slate-400 mb-2 uppercase">Vitals Trend & Interventions</h4>
                <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
                    {/* Grid */}
                    <line x1={padding} y1={height-padding} x2={width-padding} y2={height-padding} stroke="#333" strokeWidth="1"/>
                    <line x1={padding} y1={padding} x2={padding} y2={height-padding} stroke="#333" strokeWidth="1"/>
                    
                    {/* Traces */}
                    <path d={hrPath} fill="none" stroke="#22c55e" strokeWidth="2" /> {/* HR Green */}
                    <path d={bpPath} fill="none" stroke="#ef4444" strokeWidth="2" /> {/* BP Red */}
                    <path d={spo2Path} fill="none" stroke="#3b82f6" strokeWidth="1" strokeDasharray="4" /> {/* SpO2 Blue Dashed */}

                    {/* Intervention Markers & Tags */}
                    {events.map((l, i) => {
                        const x = getX(l.timeSeconds); 
                        // Stagger vertical height of text to prevent overlap: Modulo 4 levels
                        const textY = padding + 20 + (i % 8) * 15; 
                        
                        return (
                            <g key={i}>
                                {/* Dashed Line down */}
                                <line x1={x} y1={textY} x2={x} y2={height-padding} stroke="white" strokeWidth="1" strokeOpacity="0.2" strokeDasharray="2"/>
                                {/* Dot on time axis (bottom) */}
                                <circle cx={x} cy={height-padding} r="2" fill="white"/>
                                
                                {/* Text Label */}
                                <text 
                                    x={x} 
                                    y={textY} 
                                    fill="#94a3b8" 
                                    fontSize="9" 
                                    fontWeight="bold" 
                                    textAnchor="start"
                                    transform={`rotate(-45, ${x}, ${textY})`} // Rotate text
                                >
                                    {l.msg}
                                </text>
                            </g>
                        );
                    })}
                    
                    {/* Legend */}
                    <text x={width-80} y={height-10} fill="#22c55e" fontSize="10" fontWeight="bold">HR</text>
                    <text x={width-60} y={height-10} fill="#ef4444" fontSize="10" fontWeight="bold">BP</text>
                    <text x={width-40} y={height-10} fill="#3b82f6" fontSize="10" fontWeight="bold">SpO2</text>
                </svg>
            </div>
        );
    };

    const DebriefScreen = ({ sim, onExit }) => {
        const { state } = sim;
        const { Lucide, Button } = window;
        const [filter, setFilter] = useState('all');

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
            const text = `SIMULATION REPORT - ${state.scenario.title}\nDate: ${new Date().toLocaleString()}\nStudent Score: ${score}%\n\nLOG:\n` + 
                         state.log.map(l => `[${l.simTime}] ${l.msg}`).join('\n');
            const blob = new Blob([text], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Debrief_${Date.now()}.txt`;
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
