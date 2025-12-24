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

    const render12Lead = (canvas, rhythm, scenario) => {
        if (!canvas) return;
        try {
            const ctx = canvas.getContext('2d');
            const w = canvas.width;
            const h = canvas.height;
            
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = '#ffcccc'; 
            ctx.lineWidth = 1;
            
            ctx.beginPath();
            for(let x=0; x<=w; x+=10) { ctx.moveTo(x,0); ctx.lineTo(x,h); }
            for(let y=0; y<=h; y+=10) { ctx.moveTo(0,y); ctx.lineTo(w,y); }
            ctx.stroke();
            
            ctx.strokeStyle = '#ff9999';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            for(let x=0; x<=w; x+=50) { ctx.moveTo(x,0); ctx.lineTo(x,h); }
            for(let y=0; y<=h; y+=50) { ctx.moveTo(0,y); ctx.lineTo(w,y); }
            ctx.stroke();

            ctx.strokeStyle = 'black';
            ctx.lineWidth = 1.2;
            ctx.lineJoin = 'round';

            const leads = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
            
            let stElev = 0; 
            if (rhythm === 'STEMI' || (scenario && scenario.ecg && scenario.ecg.type === 'STEMI')) stElev = 1.5;
            if (rhythm === 'Sinus Rhythm (Post-MI)') stElev = 0.2; 

            const getComplex = (t, leadIndex) => {
                let y = 0;
                y -= 5 * Math.exp(-Math.pow(t - 0.1, 2) / 0.002);
                y += 20 * Math.exp(-Math.pow(t - 0.22, 2) / 0.001); 
                y -= 8 * Math.exp(-Math.pow(t - 0.24, 2) / 0.001); 
                y -= 8 * Math.exp(-Math.pow(t - 0.45, 2) / 0.005); 

                if (stElev > 0 && leadIndex >= 6 && leadIndex <= 9) {
                    if (t > 0.26 && t < 0.45) {
                        y -= stElev * 10;
                    }
                }
                return y;
            };

            const colW = w / 4;
            const rowH = h / 3;
            
            leads.forEach((lead, i) => {
                const col = Math.floor(i / 3);
                const row = i % 3;
                const originX = col * colW;
                const originY = row * rowH + (rowH / 2);
                
                ctx.fillStyle = 'black';
                ctx.font = '12px sans-serif';
                ctx.fillText(lead, originX + 10, originY - 30);

                ctx.beginPath();
                for (let x = 0; x < colW; x++) {
                    const t = (x % 200) / 200; 
                    const y = getComplex(t, i);
                    if (x === 0) ctx.moveTo(originX + x, originY + y);
                    else ctx.lineTo(originX + x, originY + y);
                }
                ctx.stroke();
            });
            
            ctx.fillStyle = 'black';
            ctx.font = '14px monospace';
            ctx.fillText(`ID: ${scenario ? scenario.patientName : 'UNKNOWN'}   DATE: ${new Date().toLocaleDateString()}   Paper Speed: 25mm/s`, 20, h - 20);
        } catch (e) {
            console.error("12-Lead Render Error", e);
        }
    };

    const MonitorScreen = ({ sim }) => {
        const { VitalDisplay, ECGMonitor, Lucide, Button } = window;
        const { state, enableAudio, triggerNIBP, toggleNIBPMode, revealInvestigation } = sim;
        const { vitals, prevVitals, rhythm, flash, activeInterventions, etco2Enabled, cprInProgress, scenario, nibp, monitorPopup, notification, arrestPanelOpen, loadingInvestigations } = state;
        const hasMonitoring = activeInterventions.has('Obs'); 
        const hasArtLine = activeInterventions.has('ArtLine');
        
        const [audioEnabled, setAudioEnabled] = useState(false);
        const [defibOpen, setDefibOpen] = useState(false);
        const [showToast, setShowToast] = useState(false);
        const [invToast, setInvToast] = useState(null); 
        const [show12Lead, setShow12Lead] = useState(false);
        const canvasRef = useRef(null);
        
        const lastNotifId = useRef(null);
        const lastPopupTime = useRef(0);

        useEffect(() => {
            if(notification && notification.id && notification.id !== lastNotifId.current) {
                lastNotifId.current = notification.id;
                setShowToast(true);
                const timer = setTimeout(() => setShowToast(false), 4000); 
                return () => clearTimeout(timer);
            }
        }, [notification]);

        useEffect(() => {
             if (arrestPanelOpen && !defibOpen) setDefibOpen(true);
             if (!arrestPanelOpen && defibOpen) setDefibOpen(false);
        }, [arrestPanelOpen]);

        useEffect(() => {
            if (show12Lead && canvasRef.current) {
                render12Lead(canvasRef.current, state.rhythm, state.scenario);
            }
        }, [show12Lead, state.rhythm]);

        const simChannel = useRef(new BroadcastChannel('sim_channel'));
        useEffect(() => {
            simChannel.current.onmessage = (event) => {
                if (event.data.type === 'SHOW_12LEAD') {
                    setShow12Lead(true);
                }
            };
        }, []);

        // --- INVESTIGATION TOAST LOGIC ---
        useEffect(() => {
            if (monitorPopup && monitorPopup.type && monitorPopup.timestamp > lastPopupTime.current) {
                lastPopupTime.current = monitorPopup.timestamp;
                const type = monitorPopup.type;
                let title = type;
                let content = "No findings recorded.";
                
                if (scenario) {
                    if (type === 'ECG') content = (scenario.ecg && scenario.ecg.findings) ? scenario.ecg.findings : "Normal Sinus Rhythm"; 
                    else if (type === 'X-ray') content = (scenario.chestXray && scenario.chestXray.findings) ? scenario.chestXray.findings : "Lung fields clear.";
                    else if (type === 'CT') content = (scenario.ct && scenario.ct.findings) ? scenario.ct.findings : "No acute intracranial pathology.";
                    else if (type === 'Urine') content = (scenario.urine && scenario.urine.findings) ? scenario.urine.findings : "Urinalysis Normal.";
                    else if (type === 'POCUS') content = (scenario.pocus && scenario.pocus.findings) ? scenario.pocus.findings : "No free fluid seen.";
                    else if (type === 'VBG' && scenario.vbg) {
                        const v = scenario.vbg;
                        content = (
                            <div className="grid grid-cols-4 gap-2 text-xs font-mono">
                                <span>pH: <b className={v.pH < 7.35 || v.pH > 7.45 ? "text-red-400" : "text-emerald-400"}>{v.pH.toFixed(2)}</b></span>
                                <span>pCO2: <b className={v.pCO2 > 6.0 || v.pCO2 < 4.5 ? "text-red-400" : "text-emerald-400"}>{v.pCO2.toFixed(1)}</b></span>
                                <span>pO2: <b className={v.pO2 < 8.0 ? "text-red-400" : "text-emerald-400"}>{v.pO2 ? v.pO2.toFixed(1) : '5.5'}</b></span>
                                <span>Lac: <b className={v.Lac > 2 ? "text-red-400" : "text-emerald-400"}>{v.Lac.toFixed(1)}</b></span>
                                <span>K+: <b className={v.K > 5.5 ? "text-red-400" : "text-emerald-400"}>{v.K.toFixed(1)}</b></span>
                                <span>Glu: <b className={v.Glu > 11 ? "text-red-400" : "text-emerald-400"}>{v.Glu.toFixed(1)}</b></span>
                                <span>BE: <b>{v.BE.toFixed(1)}</b></span>
                                <span>HCO3: <b>{v.HCO3.toFixed(1)}</b></span>
                            </div>
                        );
                    }
                }
                setInvToast({ title, content });
                // Auto dismiss after 6 seconds
                const timer = setTimeout(() => setInvToast(null), 6000);
                return () => clearTimeout(timer);
            }
        }, [monitorPopup, scenario]);

        const handleEnableAudio = () => { enableAudio(); setAudioEnabled(true); };
        const isPaeds = scenario && (scenario.ageRange === 'Paediatric' || scenario.wetflag);

        return (
            <div className={`h-full w-full flex flex-col bg-black text-white transition-colors duration-200 ${flash === 'red' ? 'flash-red' : (flash === 'green' ? 'flash-green' : '')} relative overflow-hidden`}>
                {!audioEnabled && (<div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={handleEnableAudio}><div className="bg-slate-800 border border-sky-500 p-6 rounded-lg shadow-2xl animate-bounce cursor-pointer text-center"><Lucide icon="volume-2" className="w-12 h-12 text-sky-400 mx-auto mb-2"/><h2 className="text-xl font-bold text-white">Tap to Enable Sound</h2></div></div>)}
                
                {/* SYSTEM NOTIFICATION (CENTER TOP) */}
                <div className={`absolute top-20 left-1/2 -translate-x-1/2 z-[60] bg-slate-900/95 border-l-8 rounded shadow-2xl px-8 py-4 transition-all duration-300 scale-150 origin-top flex flex-col items-center pointer-events-none ${showToast ? 'translate-y-0 opacity-100' : '-translate-y-10 opacity-0'} ${notification?.type === 'danger' ? 'border-red-500' : notification?.type === 'success' ? 'border-emerald-500' : 'border-sky-500'}`}>
                    <div className="flex items-center gap-4">
                        <Lucide icon={notification?.type === 'danger' ? 'alert-triangle' : notification?.type === 'success' ? 'check-circle' : 'info'} className={`w-8 h-8 ${notification?.type === 'danger' ? 'text-red-500' : notification?.type === 'success' ? 'text-emerald-500' : 'text-sky-500'}`} />
                        <span className="font-bold text-white text-2xl tracking-wide">{notification?.msg}</span>
                    </div>
                </div>

                {/* INVESTIGATION TOAST (TOP RIGHT) */}
                <div className={`absolute top-4 right-4 z-[70] transition-all duration-500 ${invToast ? 'translate-x-0 opacity-100' : 'translate-x-10 opacity-0 pointer-events-none'}`}>
                    <div className="bg-slate-800 border-l-4 border-purple-500 rounded shadow-2xl p-4 w-96 max-w-[90vw]">
                        <div className="flex justify-between items-start mb-2">
                            <h3 className="text-purple-400 font-bold uppercase text-sm flex items-center gap-2"><Lucide icon="activity" className="w-4 h-4"/> {invToast?.title} Result</h3>
                            <button onClick={()=>setInvToast(null)} className="text-slate-500 hover:text-white pointer-events-auto"><Lucide icon="x" className="w-4 h-4"/></button>
                        </div>
                        <div className="text-white text-sm font-medium leading-relaxed">
                            {invToast?.content}
                        </div>
                    </div>
                </div>

                {/* DYNAMIC 12-LEAD OVERLAY */}
                {show12Lead && (
                    <div className="absolute inset-0 z-[120] bg-black/90 flex flex-col items-center justify-center p-4 animate-fadeIn" onClick={() => setShow12Lead(false)}>
                        <h2 className="text-white font-mono text-xl mb-2">12-LEAD ANALYSIS (Tap to Close)</h2>
                        <canvas ref={canvasRef} width="800" height="500" className="bg-white rounded shadow-lg max-w-full max-h-[80vh] cursor-pointer" onClick={() => setShow12Lead(false)} />
                        <div className="text-slate-400 text-xs mt-2">Analysis: {state.rhythm}</div>
                    </div>
                )}

                {/* --- DEFIB FRAME --- */}
                {defibOpen && (
                    <div className="absolute inset-0 z-[100] bg-black flex flex-col animate-fadeIn">
                        <iframe id="defib-frame" src="defib/index.html" className="w-full h-full border-0 bg-slate-900" title="Defibrillator" />
                        <button 
                            onClick={() => sim.dispatch({type: 'SET_ARREST_PANEL', payload: false})}
                            className="absolute top-4 right-4 z-[101] bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded shadow-lg border-2 border-white/20 uppercase tracking-widest text-sm"
                        >
                            Close Defib
                        </button>
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
                    <div className="flex-none grid grid-cols-2 md:grid-cols-5 gap-2 h-[25vh] md:h-[28vh]">
                        <VitalDisplay label="Heart Rate" value={vitals.hr} prev={prevVitals.hr} unit="bpm" alert={vitals.hr > 140 || vitals.hr < 40} visible={hasMonitoring} isMonitor={true} hideTrends={true} />
                        
                        {/* NIBP DISPLAY with Larger Buttons */}
                        <div className="relative h-full">
                            <VitalDisplay label="NIBP" value={nibp.sys} value2={nibp.dia} unit="mmHg" alert={nibp.sys && nibp.sys < 90} visible={hasMonitoring} isMonitor={true} hideTrends={true} isNIBP={true} lastNIBP={nibp.lastTaken} onClick={triggerNIBP} />
                            {hasMonitoring && (
                                <div className="absolute bottom-2 right-2 flex gap-2 z-20 w-full px-2 justify-end">
                                    <button onClick={(e) => { e.stopPropagation(); triggerNIBP(); }} className="bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs px-4 py-2 rounded border border-slate-600 uppercase font-bold tracking-wide transition-colors shadow-lg flex-1 max-w-[80px]">{nibp.inflating ? 'Stop' : 'Cycle'}</button>
                                    <button onClick={(e) => { e.stopPropagation(); toggleNIBPMode(); }} className={`text-xs px-4 py-2 rounded border uppercase font-bold tracking-wide transition-colors shadow-lg flex-1 max-w-[60px] ${nibp.mode === 'auto' ? 'bg-emerald-900/80 border-emerald-500 text-emerald-400' : 'bg-slate-800 border-slate-600 text-slate-500'}`}>Auto</button>
                                </div>
                            )}
                        </div>

                        {/* ABP or SpO2 */}
                        {hasArtLine ? (
                             <VitalDisplay label="ABP" value={vitals.bpSys} value2={vitals.bpDia} unit="mmHg" alert={vitals.bpSys < 90} visible={true} isMonitor={true} hideTrends={true} />
                        ) : (
                             <VitalDisplay label="SpO2" value={vitals.spO2} prev={prevVitals.spO2} unit="%" alert={vitals.spO2 < 90} visible={hasMonitoring} isMonitor={true} hideTrends={true} />
                        )}

                        {hasArtLine && (
                             <VitalDisplay label="SpO2" value={vitals.spO2} prev={prevVitals.spO2} unit="%" alert={vitals.spO2 < 90} visible={hasMonitoring} isMonitor={true} hideTrends={true} />
                        )}

                        <VitalDisplay label="Resp Rate" value={vitals.rr} prev={prevVitals.rr} unit="/min" alert={vitals.rr > 30 || vitals.rr < 8} visible={hasMonitoring} isMonitor={true} hideTrends={true} />

                        {/* ETCO2 Tile (Conditionally Rendered) */}
                        {etco2Enabled && (
                            <VitalDisplay label="ETCO2" value={vitals.etco2} prev={prevVitals.etco2} unit="kPa" alert={vitals.etco2 < 4.0 || vitals.etco2 > 6.5} visible={hasMonitoring} isMonitor={true} hideTrends={true} />
                        )}
                    </div>

                    {/* Investigations Toolbar */}
                    <div className="flex-none h-14 md:h-16 bg-slate-950 border border-slate-800 rounded flex overflow-hidden shadow-lg mt-1">
                        <InvBtn label="12-Lead" icon="activity" onClick={() => sim.dispatch({type: 'REQUEST_12LEAD'})} loading={loadingInvestigations?.['ECG']} />
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
        
        // Fix: Allow HR 0 (Cardiac Arrest) to be a valid state, don't show waiting screen
        if (!sim.state.vitals || (!sim.state.vitals.hr && sim.state.vitals.hr !== 0)) {
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
