// data/screens/monitor.js
(() => {
    const { useState, useEffect, useRef } = React;

    const MonitorScreen = ({ sim }) => {
        const { VitalDisplay, ECGMonitor, Lucide, Button } = window;
        const { state, enableAudio, triggerNIBP, toggleNIBPMode } = sim;
        const { vitals, prevVitals, rhythm, flash, activeInterventions, etco2Enabled, cprInProgress, scenario, nibp, monitorPopup, notification, arrestPanelOpen } = state;
        const hasMonitoring = activeInterventions.has('Obs'); const hasArtLine = activeInterventions.has('ArtLine');
        
        const [audioEnabled, setAudioEnabled] = useState(false);
        const [defibOpen, setDefibOpen] = useState(false);
        const [showToast, setShowToast] = useState(false);

        // Toast Logic
        useEffect(() => {
            if(notification && notification.id) {
                setShowToast(true);
                const timer = setTimeout(() => {
                    setShowToast(false);
                }, 3000); 
                return () => clearTimeout(timer);
            }
        }, [notification]);

        // Sync Defib Panel
        useEffect(() => {
             if (arrestPanelOpen && !defibOpen) setDefibOpen(true);
             if (!arrestPanelOpen && defibOpen) setDefibOpen(false);
        }, [arrestPanelOpen]);

        const handleEnableAudio = () => { enableAudio(); setAudioEnabled(true); };

        const isPaeds = scenario && (scenario.ageRange === 'Paediatric' || scenario.wetflag);

        return (
            <div className={`h-full w-full flex bg-black text-white transition-colors duration-200 ${flash === 'red' ? 'flash-red' : (flash === 'green' ? 'flash-green' : '')} relative overflow-hidden`}>
                {!audioEnabled && (<div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={handleEnableAudio}><div className="bg-slate-800 border border-sky-500 p-6 rounded-lg shadow-2xl animate-bounce cursor-pointer text-center"><Lucide icon="volume-2" className="w-12 h-12 text-sky-400 mx-auto mb-2"/><h2 className="text-xl font-bold text-white">Tap to Enable Sound</h2></div></div>)}
                
                {/* TOAST NOTIFICATION */}
                <div className={`absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-slate-900/90 border-l-8 rounded shadow-2xl px-8 py-4 transition-all duration-300 scale-150 origin-top flex flex-col items-center ${showToast ? 'translate-y-0 opacity-100' : '-translate-y-10 opacity-0 pointer-events-none'} ${notification?.type === 'danger' ? 'border-red-500' : notification?.type === 'success' ? 'border-emerald-500' : 'border-sky-500'}`}>
                    <div className="flex items-center gap-4">
                        <Lucide icon={notification?.type === 'danger' ? 'alert-triangle' : notification?.type === 'success' ? 'check-circle' : 'info'} className={`w-8 h-8 ${notification?.type === 'danger' ? 'text-red-500' : notification?.type === 'success' ? 'text-emerald-500' : 'text-sky-500'}`} />
                        <span className="font-bold text-white text-2xl tracking-wide">{notification?.msg}</span>
                    </div>
                </div>

                {/* --- DEFIB FRAME --- */}
                {defibOpen && (
                    <div className="absolute inset-0 z-[100] bg-black flex flex-col animate-fadeIn">
                        <iframe id="defib-frame" src="defib/index.html" className="w-full h-full border-0 bg-slate-900" title="Defibrillator" />
                    </div>
                )}

                {/* --- MAIN MONITOR LAYOUT --- */}
                <div className="flex-grow flex flex-col p-2 md:p-4 gap-2 h-full">
                    <div className="flex-grow relative border border-slate-800 rounded overflow-hidden flex flex-col">
                        {hasMonitoring ? (
                            <ECGMonitor rhythmType={rhythm} hr={vitals.hr} rr={vitals.rr} spO2={vitals.spO2} isPaused={false} showEtco2={etco2Enabled} showTraces={true} showArt={hasArtLine} isCPR={cprInProgress} className="h-full" rhythmLabel="ECG" />
                        ) : (
                            <div className="flex items-center justify-center h-full text-slate-600 font-mono text-xl">NO SENSOR DETECTED</div>
                        )}
                    </div>

                    <div className="flex-none grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 h-auto md:h-[30vh]">
                        <VitalDisplay label="Heart Rate" value={vitals.hr} prev={prevVitals.hr} unit="bpm" alert={vitals.hr > 140 || vitals.hr < 40} visible={hasMonitoring} isMonitor={true} hideTrends={true} />
                        
                        {/* BP DISPLAY WITH CONTROLS */}
                        <div className="relative h-full">
                            <VitalDisplay label="ABP/NIBP" value={vitals.bpSys} value2={vitals.bpDia} unit="mmHg" alert={vitals.bpSys < 90} visible={hasMonitoring} isMonitor={true} hideTrends={true} />
                            {hasMonitoring && (
                                <div className="absolute bottom-2 right-2 flex gap-1 z-20">
                                    <button onClick={triggerNIBP} className="bg-slate-700 hover:bg-slate-600 text-white text-[10px] px-2 py-1 rounded border border-slate-500 uppercase font-bold tracking-wide">{nibp.inflating ? 'Inflating...' : 'Cycle'}</button>
                                    <button onClick={toggleNIBPMode} className={`text-[10px] px-2 py-1 rounded border uppercase font-bold tracking-wide ${nibp.mode === 'auto' ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-400'}`}>Auto</button>
                                </div>
                            )}
                        </div>

                        <VitalDisplay label="SpO2" value={vitals.spO2} prev={prevVitals.spO2} unit="%" alert={vitals.spO2 < 90} visible={hasMonitoring} isMonitor={true} hideTrends={true} />
                        <VitalDisplay label="Resp Rate" value={vitals.rr} prev={prevVitals.rr} unit="/min" alert={vitals.rr > 30 || vitals.rr < 8} visible={hasMonitoring} isMonitor={true} hideTrends={true} />
                    </div>
                </div>

                {/* --- WETFLAG SIDEBAR (PAEDS) --- */}
                {isPaeds && scenario.wetflag && (
                    <div className="w-48 bg-slate-900 border-l border-slate-700 p-2 flex flex-col gap-2 shadow-2xl z-40">
                         <div className="bg-purple-900/20 border border-purple-500/50 p-2 rounded mb-2">
                             <h3 className="text-purple-400 font-bold text-center text-sm">WETFLAG</h3>
                             <div className="text-center text-white font-mono text-xl font-bold">{scenario.wetflag.weight}kg</div>
                         </div>
                         <div className="flex-1 flex flex-col gap-1 overflow-y-auto">
                             <WetFlagItem label="Energy" value={`${scenario.wetflag.energy}J`} />
                             <WetFlagItem label="Tube" value={scenario.wetflag.tube} />
                             <WetFlagItem label="Fluids" value={`${scenario.wetflag.fluids}ml`} />
                             <WetFlagItem label="Loraz" value={`${scenario.wetflag.lorazepam}mg`} />
                             <WetFlagItem label="Adren" value={`${scenario.wetflag.adrenaline}mcg`} />
                             <WetFlagItem label="Gluc" value={`${scenario.wetflag.glucose}ml`} />
                         </div>
                    </div>
                )}
            </div>
        );
    };

    const WetFlagItem = ({label, value}) => (
        <div className="bg-slate-800 p-2 rounded flex flex-col items-center justify-center">
            <span className="text-[10px] text-slate-500 uppercase font-bold">{label}</span>
            <span className="font-mono text-lg font-bold text-white">{value}</span>
        </div>
    );

    const MonitorContainer = ({ sessionID }) => { 
        const { Lucide } = window;
        const sim = useSimulation(null, true, sessionID); 
        if (!sessionID) return null; 
        if (!sim.state.vitals || !sim.state.vitals.hr) {
            return (
                <div className="h-full flex flex-col items-center justify-center bg-black text-slate-500 gap-4 animate-fadeIn">
                    <Lucide icon="wifi" className="w-12 h-12 animate-pulse text-sky-500" />
                    <div className="text-xl font-mono tracking-widest">WAITING FOR CONTROLLER</div>
                    <div className="bg-slate-900 px-4 py-2 rounded border border-slate-800 font-bold text-sky-500">SESSION: {sessionID}</div>
                </div>
            ); 
        }
        return <MonitorScreen sim={sim} />; 
    };
    
    window.MonitorScreen = MonitorScreen;
    window.MonitorContainer = MonitorContainer;
})();
