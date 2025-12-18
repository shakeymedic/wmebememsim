// data/screens/debrief.js
(() => {
    const { useEffect, useRef, useState } = React;

    const DebriefScreen = ({ sim, onRestart }) => {
        const { Button, Lucide, Card } = window;
        const { state } = sim; 
        const { log, scenario, history, completedObjectives, assessments } = state; 
        const chartRef = useRef(null);
        
        const [instructorNotes, setInstructorNotes] = useState("");
        const flaggedEvents = log.filter(l => l.flagged);

        const startTime = log.find(l => l.msg === "Simulation Started")?.timeSeconds || 0;
        
        const getFirstTime = (searchTerms) => {
            const entry = log.find(l => searchTerms.some(term => l.msg.toLowerCase().includes(term.toLowerCase())));
            if (!entry) return "N/A";
            const diff = entry.timeSeconds - startTime;
            return `${Math.floor(diff/60)}m ${diff%60}s`;
        };

        const metrics = {
            duration: `${Math.floor(state.time / 60)}m ${state.time % 60}s`,
            timeToAdrenaline: getFirstTime(['Adrenaline', 'Epinephrine']),
            timeToDefib: getFirstTime(['Shock Delivered', 'Defib']),
            timeToIV: getFirstTime(['IV Access', 'Cannula']),
            cprCycles: Math.floor(state.cycleTimer / 120) 
        };

        useEffect(() => { 
            if (!chartRef.current || !history || history.length === 0) return; 
            if (!window.Chart) return;
            const ctx = chartRef.current.getContext('2d'); 
            if (window.myChart) window.myChart.destroy(); 
            
            const labels = history.map(h => `${Math.floor(h.time/60)}:${(h.time%60).toString().padStart(2,'0')}`);
            
            window.myChart = new window.Chart(ctx, { 
                type: 'line', 
                data: { 
                    labels: labels, 
                    datasets: [ 
                        { label: 'HR', data: history.map(h => h.hr), borderColor: '#ef4444', borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'y' }, 
                        { label: 'Sys BP', data: history.map(h => h.bp), borderColor: '#3b82f6', borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'y' },
                        { label: 'SpO2', data: history.map(h => h.spo2), borderColor: '#22d3ee', borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'y1' }
                    ] 
                }, 
                options: { 
                    responsive: true, maintainAspectRatio: false, 
                    scales: { 
                        y: { type: 'linear', display: true, position: 'left', min: 0, max: 250 },
                        y1: { type: 'linear', display: true, position: 'right', min: 0, max: 100, grid: {drawOnChartArea: false} }
                    },
                    interaction: { intersect: false, mode: 'index' },
                    plugins: { legend: { labels: { color: '#cbd5e1' } } }
                } 
            }); 
            return () => { if (window.myChart) window.myChart.destroy(); }; 
        }, [history, log]);
        
        const handleExport = () => { 
            if (!window.jspdf) return; 
            const doc = new window.jspdf.jsPDF(); 
            doc.setFontSize(16); doc.text(`Simulation Debrief: ${scenario.title}`, 10, 10); 
            doc.setFontSize(12); doc.text(`Date: ${new Date().toLocaleDateString()}`, 10, 20);
            
            let y = 40;
            // Add Assessments
            if (assessments) {
                doc.setFontSize(14); doc.text("Instructor Assessment", 10, y); y += 10;
                doc.setFontSize(10);
                Object.entries(assessments).forEach(([skill, res]) => {
                    const status = res === true ? "Good" : (res === false ? "Needs Improvement" : "Not Observed");
                    doc.text(`${skill}: ${status}`, 10, y); y+=6;
                });
                y += 10;
            }

            // Add Log
            doc.setFontSize(14); doc.text("Log", 10, y); y += 10;
            doc.setFontSize(10); 
            log.forEach(l => { 
                if (y > 280) { doc.addPage(); y = 10; } 
                doc.text(`[${l.simTime}] ${l.msg}`, 10, y); 
                y += 6; 
            }); 
            doc.save("sim-debrief.pdf"); 
        };
        
        return (
            <div className="max-w-7xl mx-auto space-y-4 animate-fadeIn p-4 h-full overflow-y-auto bg-slate-900 text-slate-200">
                <div className="flex justify-between bg-slate-800 p-4 rounded-lg border border-slate-700 items-center">
                    <div>
                        <h2 className="text-2xl font-bold text-white">Debrief: {scenario.title}</h2>
                        <div className="text-sm text-slate-400">Outcome: <span className={state.vitals.hr > 0 ? "text-emerald-400" : "text-red-400"}>{state.vitals.hr > 0 ? "Survived" : "Deceased"}</span></div>
                    </div>
                    <div className="flex gap-2">
                        <Button onClick={handleExport} variant="secondary"><Lucide icon="download"/> Export PDF</Button>
                        <Button onClick={onRestart} variant="primary"><Lucide icon="rotate-ccw"/> New Sim</Button>
                    </div>
                </div>

                {/* --- NEW: FLAGGED EVENTS & ASSESSMENT --- */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card title="Assessment Checklist" icon="clipboard-check" className="border-sky-500/50">
                        <div className="p-2 grid grid-cols-2 gap-2">
                             {assessments && Object.entries(assessments).map(([skill, result]) => (
                                 <div key={skill} className={`p-2 rounded border flex items-center justify-between ${result === true ? 'bg-emerald-900/20 border-emerald-500/50' : (result === false ? 'bg-red-900/20 border-red-500/50' : 'bg-slate-800 border-slate-700 opacity-50')}`}>
                                     <span className="text-sm font-bold">{skill}</span>
                                     {result === true ? <Lucide icon="check" className="text-emerald-500 w-4 h-4"/> : (result === false ? <Lucide icon="x" className="text-red-500 w-4 h-4"/> : <span className="text-xs text-slate-500">N/A</span>)}
                                 </div>
                             ))}
                        </div>
                    </Card>

                    <Card title="Flagged Discussion Points" icon="flag" className="border-amber-500/50">
                        {flaggedEvents.length > 0 ? (
                            <div className="p-2 space-y-2">
                                {flaggedEvents.map((l, i) => (
                                    <div key={i} className="flex gap-3 bg-amber-900/10 border border-amber-500/30 p-2 rounded">
                                        <span className="font-mono text-amber-500 text-xs mt-0.5">{l.simTime}</span>
                                        <span className="text-slate-200 text-sm">{l.msg}</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="p-4 text-center text-slate-500 italic text-sm">No events were flagged during the scenario.</div>
                        )}
                    </Card>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Card title="Performance Metrics" icon="zap" className="md:col-span-1 border-sky-500/50">
                        <div className="p-4 grid grid-cols-1 gap-4 text-sm">
                            <div className="flex justify-between border-b border-slate-700 pb-1"><span>Total Duration</span><span className="font-mono font-bold text-white">{metrics.duration}</span></div>
                            <div className="flex justify-between border-b border-slate-700 pb-1"><span>Time to IV Access</span><span className="font-mono font-bold text-sky-400">{metrics.timeToIV}</span></div>
                            <div className="flex justify-between border-b border-slate-700 pb-1"><span>Time to 1st Drug</span><span className="font-mono font-bold text-purple-400">{metrics.timeToAdrenaline}</span></div>
                            <div className="flex justify-between border-b border-slate-700 pb-1"><span>Time to Shock</span><span className="font-mono font-bold text-red-400">{metrics.timeToDefib}</span></div>
                            <div className="flex justify-between"><span>CPR Cycles</span><span className="font-mono font-bold text-white">{metrics.cprCycles}</span></div>
                        </div>
                    </Card>

                    <Card title="Instructor Feedback" icon="edit-3" className="md:col-span-3 border-slate-700">
                        <div className="p-2 h-full">
                            <textarea value={instructorNotes} onChange={(e) => setInstructorNotes(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white h-full min-h-[120px] text-sm resize-none focus:border-sky-500 outline-none" placeholder="Enter final feedback notes..." />
                        </div>
                    </Card>
                </div>

                <Card title="Physiological Trends" icon="activity">
                    <div className="bg-slate-900 p-2 rounded h-64 relative"><canvas ref={chartRef}></canvas></div>
                </Card>

                <Card title="Full Action Timeline" icon="clock">
                    <div className="space-y-1 max-h-64 overflow-y-auto font-mono text-xs p-2">
                        {log.map((l, i) => (
                            <div key={i} className="flex gap-4 border-b border-slate-700/50 pb-2 hover:bg-slate-800 p-1 rounded transition-colors">
                                <span className="text-sky-400 w-16 flex-shrink-0 font-bold">{l.simTime}</span>
                                <span className="text-slate-500 w-24 flex-shrink-0">{l.type.toUpperCase()}</span>
                                <span className={`flex-grow ${l.type === 'action' ? 'text-emerald-300 font-bold' : l.type === 'danger' ? 'text-red-400 font-bold' : 'text-slate-300'}`}>{l.msg}</span>
                            </div>
                        ))}
                    </div>
                </Card>
            </div>
        );
    };
    window.DebriefScreen = DebriefScreen;
})();
