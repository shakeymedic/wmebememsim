// data/screens/debrief.js
(() => {
    const { useEffect, useRef, useState } = React;

    const DebriefScreen = ({ sim, onRestart }) => {
        const { Button, Lucide, Card } = window;
        const { state } = sim; 
        const { log, scenario, history, completedObjectives } = state; 
        const chartRef = useRef(null);
        
        const [instructorNotes, setInstructorNotes] = useState("");

        // Calculation of Performance Metrics
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
            totalInterventions: state.activeInterventions.size,
            cprCycles: Math.floor(state.cycleTimer / 120) // Approximation
        };

        // Chart with Observations AND Interventions
        useEffect(() => { 
            if (!chartRef.current || !history.length) return; 
            if (!window.Chart) return;
            const ctx = chartRef.current.getContext('2d'); 
            if (window.myChart) window.myChart.destroy(); 
            
            window.myChart = new window.Chart(ctx, { 
                type: 'line', 
                data: { 
                    labels: history.map(h => `${Math.floor(h.time/60)}:${(h.time%60).toString().padStart(2,'0')}`), 
                    datasets: [ 
                        { label: 'HR (bpm)', data: history.map(h => h.hr), borderColor: '#ef4444', borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'y' }, 
                        { label: 'Sys BP (mmHg)', data: history.map(h => h.bp), borderColor: '#3b82f6', borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'y' },
                        { label: 'SpO2 (%)', data: history.map(h => h.spo2), borderColor: '#22d3ee', borderWidth: 2, pointRadius: 0, tension: 0.3, yAxisID: 'y1' },
                        { 
                            label: 'Interventions',
                            type: 'scatter',
                            data: history.map(h => {
                                const hasAction = log.some(l => (l.type === 'action' || l.type === 'manual') && Math.abs(l.timeSeconds - h.time) <= 4);
                                return hasAction ? h.hr : null; // Plot marker on the HR line
                            }),
                            backgroundColor: 'white',
                            borderColor: 'white',
                            pointStyle: 'triangle',
                            pointRadius: 6,
                            showLine: false,
                            yAxisID: 'y'
                        }
                    ] 
                }, 
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    scales: { 
                        y: { type: 'linear', display: true, position: 'left', title: {display: true, text: 'HR / BP'} },
                        y1: { type: 'linear', display: true, position: 'right', min: 0, max: 100, grid: {drawOnChartArea: false}, title: {display: true, text: 'SpO2'} }
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
            
            doc.setFontSize(10); 
            let y = 40; 
            
            log.forEach(l => { 
                if (y > 280) { doc.addPage(); y = 10; } 
                doc.text(`[${l.simTime}] ${l.msg}`, 10, y); 
                y += 6; 
            }); 
            
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

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Card title="Clinical Objectives" icon="check-square" className="md:col-span-1 border-emerald-500/50">
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

                    <Card title="Performance Metrics" icon="zap" className="md:col-span-1 border-sky-500/50">
                        <div className="p-4 grid grid-cols-1 gap-4 text-sm">
                            <div className="flex justify-between border-b border-slate-700 pb-1"><span>Total Duration</span><span className="font-mono font-bold text-white">{metrics.duration}</span></div>
                            <div className="flex justify-between border-b border-slate-700 pb-1"><span>Time to IV Access</span><span className="font-mono font-bold text-sky-400">{metrics.timeToIV}</span></div>
                            <div className="flex justify-between border-b border-slate-700 pb-1"><span>Time to 1st Drug</span><span className="font-mono font-bold text-purple-400">{metrics.timeToAdrenaline}</span></div>
                            <div className="flex justify-between border-b border-slate-700 pb-1"><span>Time to Shock</span><span className="font-mono font-bold text-red-400">{metrics.timeToDefib}</span></div>
                            <div className="flex justify-between"><span>CPR Cycles</span><span className="font-mono font-bold text-white">{metrics.cprCycles}</span></div>
                        </div>
                    </Card>

                    <Card title="Instructor Feedback" icon="edit-3" className="md:col-span-2 border-amber-500/50">
                        <div className="p-2 flex flex-col h-full gap-2">
                            <textarea 
                                value={instructorNotes} 
                                onChange={(e) => setInstructorNotes(e.target.value)}
                                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white h-32 text-sm resize-none focus:border-sky-500 outline-none" 
                                placeholder="Enter feedback on technical and non-technical skills (CRM, Communication, Leadership)..." 
                            />
                        </div>
                    </Card>
                </div>

                <Card title="Physiological Trends & Events" icon="activity">
                    <div className="bg-slate-900 p-2 rounded h-80 relative">
                        <canvas ref={chartRef}></canvas>
                    </div>
                </Card>

                <Card title="Action Timeline" icon="clock">
                    <div className="space-y-1 max-h-80 overflow-y-auto font-mono text-xs p-2">
                        {log.map((l, i) => (
                            <div key={i} className="flex gap-4 border-b border-slate-700/50 pb-2 hover:bg-slate-800 p-1 rounded transition-colors">
                                <span className="text-sky-400 w-16 flex-shrink-0 font-bold">{l.simTime}</span>
                                <span className="text-slate-500 w-24 flex-shrink-0">{l.type.toUpperCase()}</span>
                                <span className={`flex-grow ${l.type === 'action' ? 'text-emerald-300 font-bold' : l.type === 'danger' ? 'text-red-400 font-bold' : 'text-slate-300'}`}>
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
