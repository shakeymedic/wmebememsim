// data/screens/livesim.js
(() => {
    const { useState, useEffect } = React;

    const LiveSimScreen = ({ sim, onFinish, onBack, sessionID }) => {
        const { INTERVENTIONS, Button, Lucide, Card, VitalDisplay, ECGMonitor } = window;
        // Removed 'trends' from here
const { state, start, pause, applyIntervention, addLogEntry, manualUpdateVital, triggerArrest, triggerROSC, startTrend } = sim; 

// Added 'trends' here
const { scenario, time, isRunning, vitals, prevVitals, activeInterventions, interventionCounts, activeDurations, arrestPanelOpen, cprInProgress, flash, notification, trends } = state;
        // Tabs - "Continuous Sounds" removed
        const [activeTab, setActiveTab] = useState("Common");
        const [customLog, setCustomLog] = useState("");
        const [modalVital, setModalVital] = useState(null); 
        const [modalTarget, setModalTarget] = useState("");
        const [modalTarget2, setModalTarget2] = useState(""); 
        const [trendDuration, setTrendDuration] = useState(30);

        const [showToast, setShowToast] = useState(false);
        useEffect(() => {
            if(notification && notification.id) {
                setShowToast(true);
                const timer = setTimeout(() => setShowToast(false), 3000);
                return () => clearTimeout(timer);
            }
        }, [notification]);

        const formatTime = (s) => `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
        
        const getInterventionsByCat = (cat) => {
            let keys = [];
            if (cat === 'Common') keys = ['Obs', 'Oxygen', 'IV Access', 'Fluids', 'Analgesia', 'Antiemetic', 'Antibiotics', 'Nebs', 'AdrenalineIM', 'Blood', 'TXA', 'ArtLine']; 
            else keys = Object.keys(INTERVENTIONS).filter(key => INTERVENTIONS[key].category === cat);
            return keys.sort((a, b) => INTERVENTIONS[a].label.localeCompare(INTERVENTIONS[b].label));
        };

        const renderActionBtn = (key) => {
             const action = INTERVENTIONS[key];
             if (!action) return null;
             const count = interventionCounts[key] || 0;
             const isActive = activeInterventions.has(key);
             const variant = (count > 0 || isActive) ? "success" : "outline";
             return (
                 <button key={key} onClick={() => applyIntervention(key)} className={`relative h-14 p-2 rounded text-left bg-slate-700 hover:bg-slate-600 border border-slate-600 flex flex-col justify-between overflow-hidden`}>
                     <span className={`text-xs font-bold leading-tight ${variant === 'success' ? 'text-emerald-400' : 'text-slate-200'}`}>{action.label}</span>
                     <div className="flex justify-between items-end w-full">
                        <span className="text-[10px] opacity-70 italic truncate">{action.category}</span>
                        {count > 0 && action.type !== 'continuous' && <span className="bg-emerald-500 text-white text-[9px] font-bold px-1.5 rounded-full shadow-md">x{count}</span>}
                     </div>
                     {isActive && action.type === 'continuous' && <div className="absolute top-1 right-1 text-red-400 bg-slate-900 rounded-full p-0.5"><Lucide icon="x" className="w-3 h-3"/></div>}
                     {activeDurations[key] && (<div className="absolute bottom-0 left-0 h-1 bg-emerald-400 transition-all duration-1000" style={{width: `${Math.max(0, 100 - ((time - activeDurations[key].startTime)/activeDurations[key].duration*100))}%`}}></div>)}
                 </button>
             );
        }

        const openVitalControl = (key) => { setModalVital(key); setModalTarget(vitals[key === 'bp' ? 'bpSys' : key]); if (key === 'bp') setModalTarget2(vitals.bpDia); setTrendDuration(30); };
        const confirmVitalUpdate = () => { 
            const targets = {}; 
            if (modalVital === 'bp') { targets.bpSys = parseFloat(modalTarget); targets.bpDia = parseFloat(modalTarget2); } 
            else { targets[modalVital] = (modalVital === 'pupils' || modalVital === 'gcs') ? modalTarget : parseFloat(modalTarget); } 
            
            if (trendDuration === 0) Object.keys(targets).forEach(k => manualUpdateVital(k, targets[k]));
            else startTrend(targets, trendDuration); 
            
            setModalVital(null); 
        };

        // Request 10: Loading bar logic
        const trendProp = trends.active ? { active: true, progress: trends.elapsed / trends.duration } : null;

        return (
            <div className={`h-full overflow-hidden flex flex-col p-2 bg-slate-900 relative ${flash === 'red' ? 'flash-red' : (flash === 'green' ? 'flash-green' : '')}`}>
                {/* Controller Toast */}
                <div className={`absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-slate-800 border-l-4 rounded shadow-2xl px-6 py-3 transition-all duration-300 ${showToast ? 'translate-y-0 opacity-100' : '-translate-y-10 opacity-0 pointer-events-none'} ${notification?.type === 'danger' ? 'border-red-500' : notification?.type === 'success' ? 'border-emerald-500' : 'border-sky-500'}`}>
                    <div className="flex items-center gap-3">
                        <Lucide icon={notification?.type === 'danger' ? 'alert-triangle' : notification?.type === 'success' ? 'check-circle' : 'info'} className={`w-5 h-5 ${notification?.type === 'danger' ? 'text-red-500' : notification?.type === 'success' ? 'text-emerald-500' : 'text-sky-500'}`} />
                        <span className="font-bold text-white">{notification?.msg}</span>
                    </div>
                </div>

                <div className="flex justify-between items-center bg-slate-800 p-2 rounded mb-2 border border-slate-700">
                    <div className="flex gap-2 items-center">
                        <Button variant="secondary" onClick={onBack} className="h-8 px-2"><Lucide icon="arrow-left"/> Back</Button>
                        {!isRunning ? ( <Button variant="success" onClick={start} className="h-8 px-4 font-bold"><Lucide icon="play"/> START</Button> ) : ( <Button variant="warning" onClick={pause} className="h-8 px-4"><Lucide icon="pause"/> PAUSE</Button> )}
                        <Button variant="danger" onClick={() => { if(window.confirm("End scenario?")) onFinish(); }} className="h-8 px-4 font-bold border border-red-500 bg-red-900/50 hover:bg-red-800"><Lucide icon="square" className="fill-current"/> FINISH</Button>
                    </div>
                    <div className="font-mono text-2xl font-bold text-white">{formatTime(time)}</div>
                </div>

                <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-2 overflow-hidden min-h-0">
                    {/* LEFT COLUMN: Patient Info, Obs, Defib */}
                    <div className="lg:col-span-4 flex flex-col gap-2 overflow-y-auto">
                        
                         {/* Request 9: Patient Details Box */}
                         <div className="bg-slate-800 p-3 rounded border-l-4 border-sky-500 shadow-md">
                            <h3 className="text-xs font-bold text-sky-400 uppercase mb-1 flex items-center gap-2"><Lucide icon="user" className="w-3 h-3"/> Patient Details</h3>
                            <div className="text-sm text-white font-bold">{scenario.patientName} ({scenario.patientAge}y {scenario.sex})</div>
                            <div className="text-xs text-slate-300 mt-1 line-clamp-2">{scenario.patientProfileTemplate.replace('{age}', scenario.patientAge).replace('{sex}', scenario.sex)}</div>
                            <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-700">
                                <div><span className="text-[10px] text-slate-500 uppercase block">PMH</span><span className="text-xs text-slate-300">{scenario.pmh ? scenario.pmh.join(", ") : "Nil"}</span></div>
                                <div><span className="text-[10px] text-slate-500 uppercase block">Allergies</span><span className="text-xs text-red-300">{scenario.allergies ? scenario.allergies.join(", ") : "NKDA"}</span></div>
                            </div>
                         </div>

                        {/* Request 10: Obs Controller (with loading bar) */}
                        <div className="bg-black border border-slate-800 rounded relative overflow-hidden">
                             {/* Global Trend Loading Bar */}
                             {trends.active && (
                                 <div className="absolute top-0 left-0 right-0 h-1 bg-slate-800 z-20">
                                     <div className="h-full bg-sky-500 transition-all duration-1000 ease-linear" style={{ width: `${(trends.elapsed / trends.duration) * 100}%` }}></div>
                                 </div>
                             )}
                             
                             <ECGMonitor rhythmType={state.rhythm} hr={vitals.hr} rr={vitals.rr} spO2={vitals.spO2} isPaused={!isRunning} showTraces={true} className="h-24"/>
                             <div className="grid grid-cols-2 gap-1 p-1 bg-black">
                                 <VitalDisplay label="HR" value={vitals.hr} onClick={()=>openVitalControl('hr')} visible={true} trend={trendProp} />
                                 <VitalDisplay label="BP" value={vitals.bpSys} value2={vitals.bpDia} onClick={()=>openVitalControl('bp')} visible={true} trend={trendProp} />
                                 <VitalDisplay label="SpO2" value={vitals.spO2} onClick={()=>openVitalControl('spO2')} visible={true} trend={trendProp} />
                                 <VitalDisplay label="RR" value={vitals.rr} onClick={()=>openVitalControl('rr')} visible={true} trend={trendProp} />
                             </div>
                        </div>

                        {/* Request 4: Defib Controls - Minimized Logic */}
                        {arrestPanelOpen && (
                             <div className="bg-red-900/20 border-2 border-red-500 p-2 rounded-lg animate-fadeIn shadow-2xl shadow-red-900/50">
                                 <div className="flex justify-between items-center mb-2">
                                     <h3 className="text-red-400 font-bold uppercase text-xs flex items-center gap-1"><Lucide icon="zap" className="w-3 h-3"/> Defibrillator Active</h3>
                                     <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => sim.dispatch({type: 'SET_ARREST_PANEL', payload: false})}>Hide</Button>
                                 </div>
                                 <div className="grid grid-cols-2 gap-2">
                                     <Button onClick={() => sim.dispatch({type: 'CHARGE_INIT', payload: {energy: 150}})} variant="warning" className="h-10 text-xs">Charge</Button>
                                     <Button onClick={() => sim.dispatch({type: 'SHOCK_DELIVERED', payload: {energy: 150}})} variant="danger" className="h-10 text-xs font-bold">SHOCK</Button>
                                 </div>
                                 <div className="mt-2 flex items-center justify-between bg-black/50 p-2 rounded">
                                     <span className="text-slate-400 text-[10px] uppercase">CPR Timer</span>
                                     <span className="font-mono text-xl font-bold text-white">{formatTime(state.cycleTimer)}</span>
                                 </div>
                             </div>
                        )}
                        {!arrestPanelOpen && (
                             <div className="text-center p-2 opacity-50 text-[10px] text-slate-500 uppercase tracking-widest border border-dashed border-slate-700 rounded select-none">
                                 Defib Panel Minimized
                             </div>
                        )}
                    </div>
                    
                    {/* RIGHT COLUMN: Interventions */}
                    <div className="lg:col-span-8 flex flex-col bg-slate-800 rounded border border-slate-700 overflow-hidden">
                        {/* Request 3 & 5: Waveform and Continuous Sounds REMOVED */}
                        <div className="flex overflow-x-auto bg-slate-900 border-b border-slate-700 no-scrollbar">
                             {['Common', 'Airway', 'Breathing', 'Circulation', 'Drugs', 'Procedures'].map(cat => (
                                 <button key={cat} onClick={() => setActiveTab(cat)} className={`px-4 py-3 text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${activeTab === cat ? 'bg-slate-800 text-sky-400 border-t-2 border-sky-400' : 'text-slate-500 hover:text-slate-300'}`}>{cat}</button>
                             ))}
                        </div>
                        
                        <div className="flex-1 p-2 overflow-y-auto bg-slate-800 relative">
                            {/* Request 6: Recommended Actions - Green Flash & Counts */}
                            {scenario.recommendedActions && (
                                <div className="mb-2 p-2 bg-sky-900/20 border border-sky-600/30 rounded">
                                    <h4 className="text-[10px] font-bold text-sky-400 uppercase mb-1">Recommended Actions</h4>
                                    <div className="flex flex-wrap gap-1">
                                        {scenario.recommendedActions.map(key => {
                                            const action = INTERVENTIONS[key];
                                            const count = interventionCounts[key] || 0;
                                            const isActive = activeInterventions.has(key);
                                            const isUsed = count > 0 || isActive;
                                            
                                            return (
                                                <Button key={key} onClick={() => applyIntervention(key)} variant={isUsed ? "success" : "outline"} className="h-6 text-[10px] px-2 transition-colors duration-200">
                                                    {action?.label || key} {count > 0 && <span className="ml-1 bg-white/20 px-1 rounded-full font-bold">{count}</span>}
                                                </Button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                                {getInterventionsByCat(activeTab).map(key => renderActionBtn(key))}
                            </div>
                        </div>

                        <div className="bg-slate-900 p-2 border-t border-slate-700 flex gap-2">
                            <input type="text" className="bg-slate-800 border border-slate-600 rounded px-3 text-xs flex-1 text-white" placeholder="Search / Log..." value={customLog} onChange={e=>setCustomLog(e.target.value)} onKeyDown={e => e.key === 'Enter' && (addLogEntry(customLog, 'manual') || setCustomLog(""))} />
                            <Button onClick={() => {sim.dispatch({type: 'TRIGGER_IMPROVE'}); addLogEntry("Patient Improving (Trend)", "success")}} className="h-8 text-xs px-2 bg-emerald-900 border border-emerald-500 text-emerald-100">Improve</Button>
                            <Button onClick={() => {sim.dispatch({type: 'TRIGGER_DETERIORATE'}); addLogEntry("Patient Deteriorating (Trend)", "danger")}} className="h-8 text-xs px-2 bg-red-900 border border-red-500 text-red-100">Worsen</Button>
                        </div>
                    </div>
                </div>

                {modalVital && (
                    <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm">
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-sm shadow-2xl">
                            <h3 className="text-lg font-bold text-white mb-4 uppercase tracking-wider">Control: {modalVital}</h3>
                            <div className="space-y-4">
                                <div><label className="text-xs text-slate-400 font-bold uppercase">Target</label><input type="number" value={modalTarget} onChange={e=>setModalTarget(e.target.value)} className="w-full bg-slate-900 border border-slate-500 rounded p-3 text-xl font-mono text-white text-center font-bold" autoFocus /></div>
                                {modalVital === 'bp' && <div><label className="text-xs text-slate-400 font-bold uppercase">Diastolic</label><input type="number" value={modalTarget2} onChange={e=>setModalTarget2(e.target.value)} className="w-full bg-slate-900 border border-slate-500 rounded p-3 text-xl font-mono text-white text-center font-bold" /></div>}
                                <div className="grid grid-cols-4 gap-1 mt-2">
                                    {[0, 30, 120, 300].map(d => <button key={d} onClick={()=>setTrendDuration(d)} className={`p-2 rounded text-[10px] font-bold border ${trendDuration===d ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-400'}`}>{d}s</button>)}
                                </div>
                                <Button onClick={confirmVitalUpdate} variant="success" className="w-full mt-4 h-12 text-lg font-bold">CONFIRM</Button>
                                <Button onClick={()=>setModalVital(null)} variant="outline" className="w-full">Cancel</Button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    };
    window.LiveSimScreen = LiveSimScreen;
})();
