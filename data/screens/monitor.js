// data/screens/monitor.js
(() => {
    const { useState, useEffect, useRef } = React;

    const InvBtn = ({ label, icon, onClick, loading }) => {
        const { Lucide } = window;
        return (
            <button onClick={onClick} disabled={loading} className="flex flex-col items-center justify-center p-1 md:p-2 bg-slate-900 hover:bg-slate-800 border-r border-slate-800 last:border-0 text-slate-400 hover:text-sky-400 hover:bg-slate-800/50 transition-all flex-1 disabled:opacity-50 disabled:cursor-wait group">
                {loading ? <Lucide icon="loader-2" className="w-5 h-5 md:w-6 md:h-6 animate-spin mb-1"/> : <Lucide icon={icon} className="w-5 h-5 md:w-6 md:h-6 mb-1 text-slate-500 group-hover:text-sky-400 transition-colors"/>}
                <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-wider">{label}</span>
            </button>
        );
    };

    const MonitorScreen = ({ sim }) => {
        const { VitalDisplay, ECGMonitor, Lucide, Button } = window;
        const { state, enableAudio, triggerNIBP, toggleNIBPMode, revealInvestigation } = sim;
        const { vitals, prevVitals, rhythm, flash, activeInterventions, etco2Enabled, cprInProgress, scenario, nibp, monitorPopup, notification, arrestPanelOpen, loadingInvestigations } = state;
        const hasMonitoring = activeInterventions.has('Obs'); const hasArtLine = activeInterventions.has('ArtLine');
        
        const [audioEnabled, setAudioEnabled] = useState(false);
        const [defibOpen, setDefibOpen] = useState(false);
        const [showToast, setShowToast] = useState(false);
        const [invModal, setInvModal] = useState(null);
        
        // Track unique notification ID to prevent infinite loop
        const lastNotifId = useRef(null);

        // Toast Logic - Fixed to prevent persistent old notifications
        useEffect(() => {
            if(notification && notification.id && notification.id !== lastNotifId.current) {
                lastNotifId.current = notification.id;
                // Only show if notification is recent (< 5 seconds old)
                if (Date.now() - notification.id < 5000) {
                    setShowToast(true);
                    const timer = setTimeout(() => {
                        setShowToast(false);
                    }, 3000); 
                    return () => clearTimeout(timer);
                }
            }
        }, [notification]);

        // Sync Defib Panel
        useEffect(() => {
             if (arrestPanelOpen && !defibOpen) setDefibOpen(true);
             if (!arrestPanelOpen && defibOpen) setDefibOpen(false);
        }, [arrestPanelOpen]);

        // Handle Monitor Popups (Investigations)
        useEffect(() => {
            if (monitorPopup && monitorPopup.type) {
                const type = monitorPopup.type;
                let title = type;
                let content = "No result available.";
                
                if (scenario) {
                    if (type === 'ECG' && scenario.ecg) content = scenario.ecg.findings;
                    else if (type === 'X-ray' && scenario.chestXray) content = scenario.chestXray.findings;
                    else if (type === 'CT' && scenario.ct) content = scenario.ct.findings;
                    else if (type === 'Urine' && scenario.urine) content = scenario.urine.findings;
                    else if (type === 'POCUS' && scenario.pocus) content = scenario.pocus.findings;
                    else if (type === 'VBG' && scenario.vbg) {
                        const v = scenario.vbg;
                        content = (
                            <div className="grid grid-cols-2 gap-x-8 gap-y-2 font-mono text-lg">
                                <div className="flex justify-between border-b border-slate-700 pb-1"><span>pH</span> <span className={v.pH < 7.35 || v.pH > 7.45 ? "text-red-400 font-bold" : "text-emerald-400"}>{v.pH.toFixed(2)}</span></div>
                                <div className="flex justify-between border-b border-slate-700 pb-1"><span>pCO2</span> <span className={v.pCO2 > 6.0 || v.pCO2 < 4.5 ? "text-red-400 font-bold" : "text-emerald-400"}>{v.pCO2.toFixed(1)} <span className="text-xs text-slate-500">kPa</span></span></div>
                                <div className="flex justify-between border-b border-slate-700 pb-1"><span>pO2</span> <span className={v.pO2 < 8.0 ? "text-red-400 font-bold" : "text-emerald-400"}>{v.pO2 ? v.pO2.toFixed(1) : '5.5'} <span className="text-xs text-slate-500">kPa</span></span></div>
                                <div className="flex justify-between border-b border-slate-700 pb-1"><span>HCO3</span> <span className={v.HCO3 < 22 ? "text-red-400 font-bold" : "text-emerald-400"}>{v.HCO3.toFixed(1)}</span></div>
                                <div className="flex justify-between border-b border-slate-700 pb-1"><span>BE</span> <span className={Math.abs(v.BE) > 2 ? "text-red-400 font-bold" : "text-emerald-400"}>{v.BE > 0 ? '+' : ''}{v.BE.toFixed(1)}</span></div>
                                <div className="flex justify-between border-b border-slate-700 pb-1"><span>Lac</span> <span className={v.Lac > 2 ? "text-red-400 font-bold" : "text-emerald-400"}>{v.Lac.toFixed(1)}</span></div>
                                <div className="flex justify-between border-b border-slate-700 pb-1"><span>K+</span> <span className={v.K > 5.5 || v.K < 3.5 ? "text-red-400 font-bold" : "text-emerald-400"}>{v.K.toFixed(1)}</span></div>
                                <div className="flex justify-between border-b border-slate-700 pb-1"><span>Glu</span> <span className={v.Glu > 11 || v.Glu < 4 ? "text-red-400 font-bold" : "text-emerald-400"}>{v.Glu.toFixed(1)}</span></div>
                            </div>
                        );
                    }
                }
                setInvModal({ title, content });
            }
        }, [monitorPopup, scenario]);

        const handleEnableAudio = () => { enableAudio(); setAudioEnabled(true); };
        const isPaeds = scenario && (scenario.ageRange === 'Paediatric' || scenario.wetflag);

        return (
            <div className={`h-full w-full flex flex-col bg-black text-white transition-colors duration-200 ${flash === 'red' ? 'flash-red' : (flash === 'green' ? 'flash-green' : '')} relative overflow-hidden`}>
                {!audioEnabled && (<div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={handleEnableAudio}><div className="bg-slate-800 border border-sky-500 p-6 rounded-lg shadow-2xl animate-bounce cursor-pointer text-center"><Lucide icon="volume-2" className="w-12 h-12 text-sky-400 mx-auto mb-2"/><h2 className="text-xl font-bold text-white">Tap to Enable Sound</h2></div></div>)}
                
                {/* TOAST NOTIFICATION */}
                <div className={`absolute top-20 left-1/2 -translate-x-1/2 z-[60] bg-slate-900/95 border-l-8 rounded shadow-2xl px-8 py-4 transition-all duration-300 scale-150 origin-top flex flex-col items-center pointer-events-none ${showToast ? 'translate-y-0 opacity-100' : '-translate-y-10 opacity-0'} ${notification?.type === 'danger' ? 'border-red-500' : notification?.type === 'success' ? 'border-emerald-500' : 'border-sky-500'}`}>
                    <div className="flex items-center gap-4">
                        <Lucide icon={notification?.type === 'danger' ? 'alert-triangle' : notification?.type === 'success' ? 'check-circle' : 'info'} className={`w-8 h-8 ${notification?.type === 'danger' ? 'text-red-500' : notification?.type === 'success' ? 'text-emerald-500' : 'text-sky-500'}`} />
                        <span className="font-bold text-white text-2xl tracking-wide">{notification?.msg}</span>
                    </div>
                </div>

                {/* INVESTIGATIONS MODAL */}
                {invModal && (
                    <div className="absolute inset-0 z-[110] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn" onClick={() => setInvModal(null)}>
                        <div className="bg-slate-900 border border-slate-600 rounded-lg shadow-2xl w-full max-w-xl overflow-hidden" onClick={e => e.stopPropagation()}>
                            <div className="bg-slate-800 p-4 border-b border-slate-700 flex justify-between items-center">
                                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                    <Lucide icon="activity" className="text-sky-400"/> {invModal.title} Result
                                </h2>
                                <button onClick={() => setInvModal(null)} className="text-slate-400 hover:text-white p-2"><Lucide icon="x" className="w-6 h-6"/></button>
                            </div>
                            <div className="p-6 text-slate-200 text-lg leading-relaxed">
                                {invModal.content}
                            </div>
                            <div className="bg-slate-950 p-3 text-center text-[10px] text-slate-600 uppercase font-bold tracking-widest border-t border-slate-800">
                                Clinical Investigation Result • Simulated Data
                            </div>
                        </div>
                    </div>
                )}

                {/* --- DEFIB FRAME --- */}
                {defibOpen && (
                    <div className="absolute inset-0 z-[100] bg-black flex flex-col animate-fadeIn">
                        <iframe id="defib-frame" src="defib/index.html" className="w-full h-full border-0 bg-slate-900" title="Defibrillator" />
                    </div>
                )}

                {/* --- MAIN MONITOR LAYOUT --- */}
                <div className="flex-grow flex flex-col p-2 md:p-3 gap-2 h-full relative z-10">
                    {/* ECG Area */}
                    <div className="flex-grow relative border border-slate-800 rounded overflow-hidden flex flex-col min-h-0 bg-black">
                        {hasMonitoring ? (
                            <ECGMonitor rhythmType={rhythm} hr={vitals.hr} rr={vitals.rr} spO2={vitals.spO2} isPaused={false} showEtco2={etco2Enabled} showTraces={true} showArt={hasArtLine} isCPR={cprInProgress} className="h-full" rhythmLabel="ECG" />
                        ) : (
                            <div className="flex items-center justify-center h-full text-slate-700 font-mono text-xl animate-pulse">NO SENSOR DETECTED</div>
                        )}
                    </div>

                    {/* Vitals Grid */}
                    <div className="flex-none grid grid-cols-2 md:grid-cols-4 gap-2 h-[25vh] md:h-[28vh]">
                        <VitalDisplay label="Heart Rate" value={vitals.hr} prev={prevVitals.hr} unit="bpm" alert={vitals.hr > 140 || vitals.hr < 40} visible={hasMonitoring} isMonitor={true} hideTrends={true} />
                        
                        <div className="relative h-full">
                            <VitalDisplay label="ABP/NIBP" value={vitals.bpSys} value2={vitals.bpDia} unit="mmHg" alert={vitals.bpSys < 90} visible={hasMonitoring} isMonitor={true} hideTrends={true} isNIBP={true} lastNIBP={nibp.lastTaken} onClick={triggerNIBP} />
                            {hasMonitoring && (
                                <div className="absolute bottom-2 right-2 flex gap-1 z-20">
                                    <button onClick={triggerNIBP} className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-[9px] px-2 py-1 rounded border border-slate-600 uppercase font-bold tracking-wide transition-colors">{nibp.inflating ? 'Inflating...' : 'Cycle'}</button>
                                    <button onClick={toggleNIBPMode} className={`text-[9px] px-2 py-1 rounded border uppercase font-bold tracking-wide transition-colors ${nibp.mode === 'auto' ? 'bg-emerald-900/50 border-emerald-500 text-emerald-400' : 'bg-slate-800 border-slate-600 text-slate-500'}`}>Auto</button>
                                </div>
                            )}
                        </div>

                        <VitalDisplay label="SpO2" value={vitals.spO2} prev={prevVitals.spO2} unit="%" alert={vitals.spO2 < 90} visible={hasMonitoring} isMonitor={true} hideTrends={true} />
                        <VitalDisplay label="Resp Rate" value={vitals.rr} prev={prevVitals.rr} unit="/min" alert={vitals.rr > 30 || vitals.rr < 8} visible={hasMonitoring} isMonitor={true} hideTrends={true} />
                    </div>

                    {/* Investigations Toolbar */}
                    <div className="flex-none h-14 md:h-16 bg-slate-950 border border-slate-800 rounded flex overflow-hidden shadow-lg mt-1">
                        <InvBtn label="12-Lead" icon="activity" onClick={() => revealInvestigation('ECG')} loading={loadingInvestigations?.['ECG']} />
                        <InvBtn label="VBG" icon="droplet" onClick={() => revealInvestigation('VBG')} loading={loadingInvestigations?.['VBG']} />
                        <InvBtn label="CXR" icon="image" onClick={() => revealInvestigation('X-ray')} loading={loadingInvestigations?.['X-ray']} />
                        <InvBtn label="Urine" icon="flask-conical" onClick={() => revealInvestigation('Urine')} loading={loadingInvestigations?.['Urine']} />
                        <InvBtn label="POCUS" icon="waves" onClick={() => revealInvestigation('POCUS')} loading={loadingInvestigations?.['POCUS']} />
                        <InvBtn label="CT Head" icon="scan" onClick={() => revealInvestigation('CT')} loading={loadingInvestigations?.['CT']} />
                    </div>
                </div>

                {/* --- WETFLAG SIDEBAR (PAEDS) --- */}
                {isPaeds && scenario.wetflag && (
                    <div className="absolute top-0 right-0 h-full w-48 bg-slate-900/95 backdrop-blur border-l border-slate-700 p-2 flex flex-col gap-2 shadow-2xl z-40">
                         <div className="bg-purple-900/40 border border-purple-500/50 p-2 rounded mb-2">
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
