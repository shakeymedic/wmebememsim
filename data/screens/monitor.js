// data/screens/monitor.js
(() => {
    const { useState, useEffect } = React;

    const MonitorContainer = ({ sim, sessionID }) => {
        const { VitalDisplay, ECGMonitor, Lucide } = window;
        
        // Safety check if sim is not passed (e.g. if index.html isn't updated yet)
        if (!sim) return <div className="h-full flex items-center justify-center text-red-500 font-bold bg-black">ERROR: Simulation Data Not Connected (Check index.html)</div>;

        const { state } = sim;
        const { vitals, rhythm, etco2Enabled, scenario, arrestPanelOpen, cprInProgress, cycleTimer, isOffline, connectionStatus } = state;

        // Flash effect for critical alarms
        const isCritical = vitals.hr === 0 || (vitals.hr < 40 && vitals.hr > 0) || vitals.spO2 < 85 || vitals.bpSys < 70;
        const [flash, setFlash] = useState(false);
        
        useEffect(() => {
            if (isCritical || arrestPanelOpen) {
                const interval = setInterval(() => setFlash(p => !p), 800);
                return () => clearInterval(interval);
            } else {
                setFlash(false);
            }
        }, [isCritical, arrestPanelOpen]);

        return (
            <div className={`h-full flex flex-col bg-black text-white overflow-hidden relative ${flash ? 'box-shadow-[inset_0_0_50px_rgba(255,0,0,0.5)]' : ''}`}>
                
                {/* TOP BAR */}
                <div className="flex justify-between items-center px-4 py-2 bg-zinc-900 border-b border-zinc-800">
                    <div className="flex items-center gap-4">
                        <div className="text-zinc-400 font-bold text-lg">ADULT</div>
                        <div className="text-zinc-500 text-sm">ID: {sessionID}</div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="text-zinc-400 font-mono text-xl">{new Date().toLocaleTimeString()}</div>
                        {isOffline && <div className="text-red-500 font-bold animate-pulse">OFFLINE</div>}
                        <div className="text-green-500"><Lucide icon="wifi" className="w-5 h-5" /></div>
                    </div>
                </div>

                {/* MAIN CONTENT GRID */}
                <div className="flex-1 grid grid-cols-12 gap-1 p-1">
                    
                    {/* LEFT: WAVEFORMS (9 cols) */}
                    <div className="col-span-9 flex flex-col gap-1">
                        {/* ECG CHANNEL */}
                        <div className="flex-1 bg-zinc-900/50 rounded border border-zinc-800 relative overflow-hidden flex flex-col">
                            <div className="absolute top-2 left-2 text-green-500 font-bold text-sm z-10 flex gap-2">
                                <span>II</span>
                                <span>x1.0</span>
                                <span>MONITOR</span>
                            </div>
                            <div className="flex-1 relative">
                                <ECGMonitor 
                                    rhythmType={rhythm} 
                                    hr={vitals.hr} 
                                    isCPR={cprInProgress} 
                                    showTraces={true} 
                                    className="w-full h-full"
                                    color="#39ff14" // Classic Phosphor Green
                                    speed={1.5}     // Faster sweep for realism
                                />
                            </div>
                        </div>

                        {/* SPO2 CHANNEL */}
                        <div className="h-32 bg-zinc-900/50 rounded border border-zinc-800 relative overflow-hidden flex flex-col">
                            <div className="absolute top-2 left-2 text-cyan-400 font-bold text-sm z-10">PLETH</div>
                            <div className="flex-1 relative">
                                <ECGMonitor 
                                    rhythmType="sinus" // Use sinus logic for pleth wave
                                    hr={vitals.hr} 
                                    isCPR={cprInProgress}
                                    showTraces={vitals.spO2 > 0} 
                                    className="w-full h-full"
                                    color="#22d3ee" 
                                    speed={1.5}
                                    flatline={vitals.spO2 === 0}
                                />
                            </div>
                        </div>

                        {/* CO2 CHANNEL (Conditional) */}
                        {etco2Enabled && (
                            <div className="h-32 bg-zinc-900/50 rounded border border-zinc-800 relative overflow-hidden flex flex-col">
                                <div className="absolute top-2 left-2 text-yellow-400 font-bold text-sm z-10">CO2</div>
                                <div className="flex-1 relative">
                                    {/* Simplified CO2 wave via ECGMonitor for now, or dedicated component */}
                                    <ECGMonitor 
                                        rhythmType="sinus" // Placeholder for resp wave
                                        hr={vitals.rr * 4} // Fake rate for visualization 
                                        isCPR={false}
                                        showTraces={true} 
                                        className="w-full h-full"
                                        color="#fbbf24" 
                                        speed={0.5} 
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* RIGHT: NUMBERS (3 cols) */}
                    <div className="col-span-3 flex flex-col gap-1">
                        <VitalDisplay label="HR" value={vitals.hr} unit="bpm" isMonitor={true} alert={vitals.hr < 40 || vitals.hr > 140} />
                        <VitalDisplay label="SpO2" value={vitals.spO2} unit="%" isMonitor={true} alert={vitals.spO2 < 90} />
                        <VitalDisplay label="NIBP" value={vitals.bpSys} value2={vitals.bpDia} unit="mmHg" isMonitor={true} isNIBP={true} alert={vitals.bpSys < 90 || vitals.bpSys > 180} />
                        <VitalDisplay label="RR" value={vitals.rr} unit="rpm" isMonitor={true} alert={vitals.rr < 10 || vitals.rr > 30} />
                        {etco2Enabled && <VitalDisplay label="ETCO2" value={vitals.etco2} unit="kPa" isMonitor={true} />}
                        <VitalDisplay label="TEMP" value={vitals.temp} unit="°C" isMonitor={true} isText={false} />
                    </div>
                </div>

                {/* ARREST OVERLAY */}
                {arrestPanelOpen && (
                    <div className="absolute bottom-4 left-4 right-4 bg-red-900/90 border-2 border-red-500 rounded-xl p-4 flex justify-between items-center animate-pulse z-50">
                        <div className="text-white font-bold text-3xl">CARDIAC ARREST PROTOCOL ACTIVE</div>
                        <div className="flex gap-8">
                            <div className="text-center">
                                <div className="text-xs uppercase opacity-70">Cycle Timer</div>
                                <div className="text-5xl font-mono font-bold">{Math.floor(cycleTimer / 60)}:{(cycleTimer % 60).toString().padStart(2, '0')}</div>
                            </div>
                            {cprInProgress && (
                                <div className="text-center">
                                    <div className="text-xs uppercase opacity-70">CPR</div>
                                    <div className="text-5xl font-mono font-bold text-yellow-400">IN PROGRESS</div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    window.MonitorContainer = MonitorContainer;
})();
