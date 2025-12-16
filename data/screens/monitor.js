// data/screens/monitor.js
(() => {
    const { useState, useEffect, useRef } = React;

    const MonitorScreen = ({ sim }) => {
        const { VitalDisplay, ECGMonitor, Lucide, Button } = window;
        const { state, enableAudio } = sim;
        const { vitals, prevVitals, rhythm, flash, activeInterventions, etco2Enabled, cprInProgress, scenario, nibp, monitorPopup, notification, arrestPanelOpen } = state;
        const hasMonitoring = activeInterventions.has('Obs'); const hasArtLine = activeInterventions.has('ArtLine');
        
        const [audioEnabled, setAudioEnabled] = useState(false);
        const [defibOpen, setDefibOpen] = useState(false);
        const [showToast, setShowToast] = useState(false);

        // Request 2: Monitor Toast Notification Logic with Timeout
        // This listens for a NEW notification object from engine.js
        useEffect(() => {
            if(notification && notification.id) {
                setShowToast(true);
                const timer = setTimeout(() => {
                    setShowToast(false);
                }, 3000); // Disappear after 3 seconds
                return () => clearTimeout(timer);
            }
        }, [notification]);

        const handleEnableAudio = () => { enableAudio(); setAudioEnabled(true); };

        return (
            <div className={`h-full w-full flex flex-col bg-black text-white p-2 md:p-4 transition-colors duration-200 ${flash === 'red' ? 'flash-red' : (flash === 'green' ? 'flash-green' : '')} relative`}>
                {!audioEnabled && (<div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={handleEnableAudio}><div className="bg-slate-800 border border-sky-500 p-6 rounded-lg shadow-2xl animate-bounce cursor-pointer text-center"><Lucide icon="volume-2" className="w-12 h-12 text-sky-400 mx-auto mb-2"/><h2 className="text-xl font-bold text-white">Tap to Enable Sound</h2></div></div>)}
                
                {/* TOAST NOTIFICATION */}
                <div className={`absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-slate-900/90 border-l-8 rounded shadow-2xl px-8 py-4 transition-all duration-300 scale-150 origin-top ${showToast ? 'translate-y-0 opacity-100' : '-translate-y-10 opacity-0 pointer-events-none'} ${notification?.type === 'danger' ? 'border-red-500' : notification?.type === 'success' ? 'border-emerald-500' : 'border-sky-500'}`}>
                    <div className="flex items-center gap-4">
                        <Lucide icon={notification?.type === 'danger' ? 'alert-triangle' : notification?.type === 'success' ? 'check-circle' : 'info'} className={`w-8 h-8 ${notification?.type === 'danger' ? 'text-red-500' : notification?.type === 'success' ? 'text-emerald-500' : 'text-sky-500'}`} />
                        <span className="font-bold text-white text-2xl tracking-wide">{notification?.msg}</span>
                    </div>
                </div>

                {/* --- DEFIB FRAME (Using existing logic) --- */}
                {defibOpen && (
                    <div className="absolute inset-0 z-[100] bg-black flex flex-col">
                         <div className="absolute top-4 right-4 z-[110]">
                            <Button onClick={() => {setDefibOpen(false); sim.dispatch({type: 'SET_ARREST_PANEL', payload: false})}} variant="destructive" className="h-10 text-sm uppercase font-bold shadow-xl border border-white/20">Close Defib</Button>
                        </div>
                        <iframe id="defib-frame" src="defib/index.html" className="w-full h-full border-0 bg-slate-900" title="Defibrillator" />
                    </div>
                )}

                {/* --- MAIN LAYOUT --- */}
                <div className="flex-grow relative border border-slate-800 rounded mb-2 overflow-hidden flex flex-col">
                    <div className="absolute top-2 right-2 z-30">
                        <Button onClick={() => {setDefibOpen(true); sim.dispatch({type: 'SET_ARREST_PANEL', payload: true})}} variant="destructive" className="h-8 text-[10px] uppercase font-bold shadow-xl border border-white/20 opacity-60 hover:opacity-100 transition-opacity">Open Defib</Button>
                    </div>

                    {hasMonitoring ? (
                        <ECGMonitor rhythmType={rhythm} hr={vitals.hr} rr={vitals.rr} spO2={vitals.spO2} isPaused={false} showEtco2={etco2Enabled} showTraces={true} showArt={hasArtLine} isCPR={cprInProgress} className="h-full" rhythmLabel="ECG" />
                    ) : (
                        <div className="flex items-center justify-center h-full text-slate-600 font-mono text-xl">NO SENSOR DETECTED</div>
                    )}
                </div>

                <div className="flex-none grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 h-auto md:h-[30vh]">
                    <VitalDisplay label="Heart Rate" value={vitals.hr} prev={prevVitals.hr} unit="bpm" alert={vitals.hr > 140 || vitals.hr < 40} visible={hasMonitoring} isMonitor={true} hideTrends={true} />
                    <VitalDisplay label="ABP/NIBP" value={vitals.bpSys} value2={vitals.bpDia} unit="mmHg" alert={vitals.bpSys < 90} visible={hasMonitoring} isMonitor={true} hideTrends={true} />
                    <VitalDisplay label="SpO2" value={vitals.spO2} prev={prevVitals.spO2} unit="%" alert={vitals.spO2 < 90} visible={hasMonitoring} isMonitor={true} hideTrends={true} />
                    <VitalDisplay label="Resp Rate" value={vitals.rr} prev={prevVitals.rr} unit="/min" alert={vitals.rr > 30 || vitals.rr < 8} visible={hasMonitoring} isMonitor={true} hideTrends={true} />
                </div>
            </div>
        );
    };

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
