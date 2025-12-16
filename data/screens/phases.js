(() => {
    const { useEffect, useRef } = React;

    // --- SCREEN 3: BRIEFING ---
    const BriefingScreen = ({ scenario, onStart, onBack }) => {
        const { Button, Lucide } = window;
        return (
            <div className="max-w-5xl mx-auto space-y-6 animate-fadeIn p-4 overflow-y-auto h-full">
                <div className="bg-slate-800 border-l-4 border-sky-500 shadow-lg rounded-lg overflow-hidden">
                    <div className="p-6 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
                        <div>
                            <h2 className="text-3xl font-bold text-white mb-2">{scenario.title}</h2>
                            <div className="flex gap-2 mt-2">
                                <span className="bg-slate-700 text-sky-300 text-xs px-2 py-1 rounded border border-slate-600">{scenario.category}</span>
                                <span className="bg-slate-700 text-emerald-300 text-xs px-2 py-1 rounded border border-slate-600">{scenario.ageRange}</span>
                                <span className="bg-slate-700 text-amber-300 text-xs px-2 py-1 rounded border border-slate-600">{scenario.acuity}</span>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-[10px] text-slate-500 uppercase font-bold">Initial GCS</div>
                            <div className="text-4xl font-mono font-bold text-white">{scenario.vitals.gcs}</div>
                        </div>
                    </div>
                    {scenario.ageRange === 'Paediatric' && scenario.wetflag && (
                        <div className="mx-6 mt-4 p-4 bg-purple-900/20 border border-purple-500/50 rounded-lg">
                            <h3 className="text-sm font-bold text-purple-400 uppercase mb-2">WETFLAG (Est. {scenario.wetflag.weight}kg)</h3>
                            <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-center">
                                <div className="bg-slate-900 p-2 rounded"><div className="text-[9px] text-slate-500 uppercase">Energy (4J)</div><div className="font-bold text-white">{scenario.wetflag.energy} J</div></div>
                                <div className="bg-slate-900 p-2 rounded"><div className="text-[9px] text-slate-500 uppercase">Tube</div><div className="font-bold text-white">{scenario.wetflag.tube}</div></div>
                                <div className="bg-slate-900 p-2 rounded"><div className="text-[9px] text-slate-500 uppercase">Fluids (10ml)</div><div className="font-bold text-white">{scenario.wetflag.fluids} ml</div></div>
                                <div className="bg-slate-900 p-2 rounded"><div className="text-[9px] text-slate-500 uppercase">Lorazepam</div><div className="font-bold text-white">{scenario.wetflag.lorazepam} mg</div></div>
                                <div className="bg-slate-900 p-2 rounded"><div className="text-[9px] text-slate-500 uppercase">Adrenaline</div><div className="font-bold text-white">{scenario.wetflag.adrenaline} mcg</div></div>
                                <div className="bg-slate-900 p-2 rounded"><div className="text-[9px] text-slate-500 uppercase">Glucose (2ml)</div><div className="font-bold text-white">{scenario.wetflag.glucose} ml</div></div>
                            </div>
                        </div>
                    )}
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6">
                        <div className="space-y-6">
                            <div className="bg-slate-900/50 p-4 rounded border border-slate-700">
                                <h3 className="text-sm font-bold text-sky-400 uppercase mb-2 border-b border-slate-700 pb-1">Patient Brief</h3>
                                <p className="text-sm text-slate-400 mb-2"><strong className="text-slate-300 uppercase text-xs">Patient Name:</strong> {scenario.patientName}</p>
                                <p className="text-lg leading-relaxed text-slate-200 mb-4">{scenario.profile}</p>
                                <div className="space-y-2 text-sm">
                                    <div className="flex"><span className="w-24 text-slate-500 font-bold">PMH:</span><span className="text-slate-300">{scenario.pmh ? scenario.pmh.join(", ") : 'Nil'}</span></div>
                                    <div className="flex"><span className="w-24 text-slate-500 font-bold">Rx:</span><span className="text-slate-300">{scenario.dhx ? scenario.dhx.join(", ") : 'Nil'}</span></div>
                                    <div className="flex"><span className="w-24 text-slate-500 font-bold">Allergies:</span><span className="text-red-400 font-bold">{scenario.allergies ? scenario.allergies.join(", ") : 'NKDA'}</span></div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="p-3 bg-amber-900/20 rounded border border-amber-600/30">
                                <h4 className="text-sm font-bold text-amber-400 uppercase mb-1">Clinical Progression</h4>
                                <p className="text-sm text-slate-300 leading-snug">{scenario.instructorBrief.progression}</p>
                            </div>
                            <div className="p-3 bg-emerald-900/20 rounded border border-emerald-600/30">
                                <h4 className="text-sm font-bold text-emerald-400 uppercase mb-1">Key Interventions</h4>
                                <ul className="list-disc pl-4 text-sm text-slate-300 space-y-1">
                                    {scenario.instructorBrief.interventions && scenario.instructorBrief.interventions.map((l, i) => <li key={i}>{l}</li>)}
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="flex flex-col md:flex-row gap-4">
                    <Button onClick={onBack} variant="secondary" className="flex-1">Back to Setup</Button>
                    <Button onClick={onStart} className="flex-1 shadow-sky-900/20 shadow-xl h-14 text-xl">Start Scenario</Button>
                </div>
            </div>
        );
    };

    // --- SCREEN 6: DEBRIEF ---
    const DebriefScreen = ({ sim, onRestart }) => {
        const { Button, Lucide, Card } = window;
        const { state } = sim; const { log, scenario, history, completedObjectives } = state; const chartRef = useRef(null);
        
        const defaultObjectives = ["Airway Assessment", "Breathing Assessment", "Circulation Assessment", "Disability Assessment", "Exposure"];
        const scenarioObjectives = scenario?.instructorBrief?.learningObjectives || defaultObjectives;

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
                        { label: 'HR', data: history.map(h => h.hr), borderColor: '#ef4444', borderWidth: 2, pointRadius: 0, tension: 0.1 }, 
                        { label: 'Sys BP', data: history.map(h => h.bp), borderColor: '#3b82f6', borderWidth: 2, pointRadius: 0, tension: 0.1 },
                        { label: 'SpO2', data: history.map(h => h.spo2), borderColor: '#22d3ee', borderWidth: 2, pointRadius: 0, tension: 0.1 }
                    ] 
                }, 
                options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0 } } } 
            }); 
            return () => { if (window.myChart) window.myChart.destroy(); }; 
        }, [history]);
        
        const handleExport = () => { if (!window.jspdf) return; const doc = new window.jspdf.jsPDF(); doc.setFontSize(16); doc.text(`Simulation Debrief: ${scenario.title}`, 10, 10); doc.setFontSize(10); let y = 30; log.forEach(l => { if (y > 280) { doc.addPage(); y = 10; } doc.text(`[${l.simTime}] ${l.msg}`, 10, y); y += 6; }); doc.save("sim-debrief.pdf"); };
        
        return (
            <div className="max-w-6xl mx-auto space-y-6 animate-fadeIn p-4 h-full overflow-y-auto">
                <div className="flex justify-between bg-slate-800 p-4 rounded-lg border border-slate-700">
                    <h2 className="text-2xl font-bold text-white">Simulation Debrief</h2>
                    <div className="flex gap-2"><Button onClick={handleExport} variant="secondary"><Lucide icon="download"/> PDF</Button><Button onClick={onRestart} variant="primary"><Lucide icon="rotate-ccw"/> New Sim</Button></div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card title="Performance Checklist" icon="check-square" className="border-emerald-500/50">
                        <div className="p-2 space-y-2">
                            {scenarioObjectives.map((obj, i) => {
                                const isDone = completedObjectives.has(obj) || (obj.includes('Fluid') && completedObjectives.has('Fluids')) || (obj.includes('Antibiotic') && completedObjectives.has('Antibiotics')); 
                                return (
                                    <div key={i} className="flex items-center gap-2 text-sm text-slate-300">
                                        <div className={`w-4 h-4 border rounded flex items-center justify-center ${isDone ? 'bg-emerald-500 border-emerald-500' : 'border-slate-500'}`}>{isDone && <Lucide icon="check" className="w-3 h-3 text-white"/>}</div>
                                        <span>{obj}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </Card>
                    <Card title="Analysis" icon="activity" className="border-amber-500/50"><div className="p-2"><textarea className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white h-24 text-sm" placeholder="Why did it happen?" /></div></Card>
                    <Card title="Application" icon="arrow-right-circle" className="border-sky-500/50"><div className="p-2"><textarea className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-white h-24 text-sm" placeholder="What will we do differently?" /></div></Card>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><Card title="Physiological Trends" icon="activity"><div className="bg-slate-900 p-2 rounded h-64 relative"><canvas ref={chartRef}></canvas></div></Card><Card title="Action Timeline" icon="clock"><div className="space-y-1 max-h-80 overflow-y-auto font-mono text-xs p-2">{log.map((l, i) => (<div key={i} className="flex gap-4 border-b border-slate-700 pb-1"><span className="text-sky-400 w-12 flex-shrink-0">{l.simTime}</span><span className="text-slate-300">{l.msg}</span></div>))}</div></Card></div>
            </div>
        );
    };

    window.BriefingScreen = BriefingScreen;
    window.DebriefScreen = DebriefScreen;
})();
