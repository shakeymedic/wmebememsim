// data/screens/debrief.js
(() => {
    const { useEffect, useRef, useState } = React;

    const DebriefScreen = ({ sim, onRestart }) => {
        const { Button, Lucide, Card } = window;
        const { state } = sim; 
        const { log, scenario, history, completedObjectives } = state; 
        const chartRef = useRef(null);
        
        const [instructorNotes, setInstructorNotes] = useState("");

        // Request 7: Debrief Screen Chart with all Obs
        useEffect(() => { 
            if (!chartRef.current || !history.length) return; 
            if (!window.Chart) return;
            const ctx = chartRef.current.getContext('2d'); 
            if (window.myChart) window.myChart.destroy(); 
            
            // Map history to datasets
            window.myChart = new window.Chart(ctx, { 
                type: 'line', 
                data: { 
                    labels: history.map(h => `${Math.floor(h.time/60)}:${(h.time%60).toString().padStart(2,'0')}`), 
                    datasets: [ 
                        { label: 'HR', data: history.map(h => h.hr), borderColor: '#ef4444', borderWidth: 2, pointRadius: 0, tension: 0.1 }, 
                        { label: 'Sys BP', data: history.map(h => h.bp), borderColor: '#3b82f6', borderWidth: 2, pointRadius: 0, tension: 0.1 },
                        { label: 'SpO2', data: history.map(h => h.spo2), borderColor: '#22d3ee', borderWidth: 2, pointRadius: 0, tension: 0.1 }
                    ] 
                }, 
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    scales: { y: { min: 0 } },
                    interaction: { intersect: false, mode: 'index' },
                } 
            }); 
            return () => { if (window.myChart) window.myChart.destroy(); }; 
        }, [history]);
        
        const handleExport = () => { 
            if (!window.jspdf) return; 
            const doc = new window.jspdf.jsPDF(); 
            doc.setFontSize(16); doc.text(`Simulation Debrief: ${scenario.title}`, 10, 10); 
            doc.setFontSize(12); doc.text(`Candidate: __________________  Date: ${new Date().toLocaleDateString()}`, 10, 20);
            
            doc.setFontSize(10); 
            let y = 40; 
            
            // Log Export
            log.forEach(l => { 
                if (y > 280) { doc.addPage(); y = 10; } 
                doc.text(`[${l.simTime}] ${l.msg}`, 10, y); 
                y += 6; 
            }); 
            
            // Notes Export
            if(instructorNotes) {
                doc.addPage();
                doc.text("Instructor Notes:", 10, 10);
                const splitNotes = doc.splitTextToSize(instructorNotes, 180);
                doc.text(splitNotes, 10, 20);
            }
            
            doc.save("sim-debrief.pdf"); 
        };
        
        const objectives = scenario?.instructorBrief?.learningObjectives || ["Initial Assessment", "Primary Survey", "Interventions", "Re-evaluation"];

        return (
            <div className="max-w-7xl mx-auto space-y-6 animate-fadeIn p-4 h-full overflow-y-auto bg-slate-900 text-slate-200">
                <div className="flex justify-between bg-slate-800 p-4 rounded-lg border border-slate-700 items-center">
                    <div>
                        <h2 className="text-2xl font-bold text-white">Debrief: {scenario.title}</h2>
                        <div className="text-sm text-slate-400">Duration: {Math.floor(state.time / 60)}m {(state.time % 60)}s</div>
                    </div>
                    <div className="flex gap-2">
                        <Button onClick={handleExport} variant="secondary"><Lucide icon="download"/> Export PDF</Button>
                        <Button onClick={onRestart} variant="primary"><Lucide icon="rotate-ccw"/> New Sim</Button>
                    </div>
                </div>

                {/* Request 8: Expanded Debrief Details */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    
                    {/* Column 1: Objectives Checklist */}
                    <Card title="Clinical Objectives" icon="check-square" className="border-emerald-500/50">
                        <div className="p-2 space-y-3">
                            {objectives.map((obj, i) => {
                                const isDone = completedObjectives.has(obj); 
                                return (
                                    <div key={i} className="flex items-start gap-2 text-sm text-slate-300">
                                        <div className={`w-5 h-5 mt-0.5 border rounded flex-shrink-0 flex items-center justify-center ${isDone ? 'bg-emerald-500 border-emerald-500' : 'border-slate-500'}`}>
                                            {isDone && <Lucide icon="check" className="w-3 h-3 text-white"/>}
                                        </div>
                                        <span>{obj}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </Card>

                    {/* Column 2: Instructor Notes (Expanded) */}
                    <Card title="Instructor Feedback" icon="edit-3" className="border-amber-500/50">
                        <div className="p-2 flex flex-col h-full gap-2">
                            <textarea 
                                value={instructorNotes} 
                                onChange={(e) => setInstructorNotes(e.target.value)}
                                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white h-full text-sm resize-none" 
                                placeholder="Enter feedback on technical and non-technical skills (CRM, Communication, Leadership)..." 
                            />
                        </div>
                    </Card>
                    
                    {/* Column 3: Key Stats */}
                    <Card title="Scenario Stats" icon="bar-chart-2" className="border-sky-500/50">
                        <div className="grid grid-cols-2 gap-2 p-2 text-center">
                            <div className="bg-slate-900 p-2 rounded"><div className="text-xs text-slate-500">Total Interventions</div><div className="text-xl font-bold">{state.activeInterventions.size}</div></div>
                            <div className="bg-slate-900 p-2 rounded"><div className="text-xs text-slate-500">CPR Cycles</div><div className="text-xl font-bold">{Math.floor(state.cycleTimer / 120)}</div></div>
                            <div className="bg-slate-900 p-2 rounded"><div className="text-xs text-slate-500">Drugs Given</div><div className="text-xl font-bold">{Object.values(state.interventionCounts).reduce((a,b)=>a+b, 0)}</div></div>
                            <div className="bg-slate-900 p-2 rounded"><div className="text-xs text-slate-500">Outcome</div><div className={`text-xl font-bold ${state.vitals.hr > 0 ? 'text-green-500' : 'text-red-500'}`}>{state.vitals.hr > 0 ? 'Survived' : 'Deceased'}</div></div>
                        </div>
                    </Card>
                </div>

                {/* Physiological Graph */}
                <Card title="Physiological Trends & Events" icon="activity">
                    <div className="bg-slate-900 p-2 rounded h-80 relative">
                        <canvas ref={chartRef}></canvas>
                    </div>
                </Card>

                {/* Timeline Log */}
                <Card title="Action Timeline" icon="clock">
                    <div className="space-y-1 max-h-80 overflow-y-auto font-mono text-xs p-2">
                        {log.map((l, i) => (
                            <div key={i} className="flex gap-4 border-b border-slate-700/50 pb-1 hover:bg-slate-800">
                                <span className="text-sky-400 w-12 flex-shrink-0">{l.simTime}</span>
                                <span className={`${l.type === 'action' ? 'text-emerald-300 font-bold' : l.type === 'danger' ? 'text-red-400 font-bold' : 'text-slate-300'}`}>
                                    {l.msg}
                                </span>
                            </div>
                        ))}
                    </div>
                </Card>
            </div>
        );
    };

    window.DebriefScreen = DebriefScreen;
})();
