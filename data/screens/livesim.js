// data/screens/livesim.js
(() => {
    const { useState, useEffect } = React;

    const LiveSimScreen = ({ sim, onFinish, onBack, sessionID }) => {
        const { INTERVENTIONS, Button, Lucide, Card, VitalDisplay, ECGMonitor } = window;
        const { state, start, pause, applyIntervention, addLogEntry, manualUpdateVital, triggerArrest, triggerROSC, startTrend, speak } = sim; 

        const { scenario, time, isRunning, vitals, prevVitals, activeInterventions, interventionCounts, activeDurations, arrestPanelOpen, cprInProgress, flash, notification, trends, audioOutput, isMuted, etco2Enabled } = state;
        
        const [activeTab, setActiveTab] = useState("Common");
        const [customLog, setCustomLog] = useState("");
        const [speechText, setSpeechText] = useState(""); 
        const [modalVital, setModalVital] = useState(null); 
        const [modalTarget, setModalTarget] = useState("");
        const [modalTarget2, setModalTarget2] = useState(""); 
        const [trendDuration, setTrendDuration] = useState(30);
        const [showLogModal, setShowLogModal] = useState(false);
        
        // ETCO2 Shape Control
        const [etco2Shape, setEtco2Shape] = useState("normal"); // normal, bronchospastic

        const [showRhythmModal, setShowRhythmModal] = useState(false);
        const [showArrestMenu, setShowArrestMenu] = useState(false);
        const [showROSCMenu, setShowROSCMenu] = useState(false);

        const RHYTHMS = ["Sinus Rhythm", "Sinus Tachycardia", "Sinus Bradycardia", "AF", "Atrial Flutter", "SVT", "VT", "VF", "PEA", "Asystole", "1st Deg Heart Block", "Complete Heart Block"];
        const ARREST_RHYTHMS = ["VF", "pVT", "PEA", "Asystole"];
        const ROSC_RHYTHMS = ["Sinus Rhythm", "Sinus Tachycardia", "Sinus Bradycardia", "AF", "SVT"];
        const VOICE_PHRASES = ["My chest hurts", "I can't breathe", "I feel sick", "Who are you?", "My tummy hurts", "I feel dizzy", "Am I going to die?", "Yes", "No", "I'm thirsty", "Where am I?", "Please help me"];
        
        // Drug Categorization
        const DRUG_GROUPS = {
            "Resus / Cardiac": ["AdrenalineIV", "Amiodarone", "Atropine", "Adenosine", "MagSulph", "Calcium", "SodiumBicarb", "AdrenalineIM"],
            "Sedation / Analgesia": ["Morphine", "Fentanyl", "Ketamine", "Midazolam", "Lorazepam", "Propofol", "Roc", "Sux", "Paracetamol", "Analgesia"],
            "Vasoactive": ["Metaraminol", "Noradrenaline", "Labetalol", "Phentolamine"],
            "Antibiotics": ["Antibiotics", "Ceftriaxone", "Tazocin", "Gentamicin"],
            "Other": [] // Catch-all
        };
        
        // Helper to flatten groups for check
        const KNOWN_DRUGS = new Set(Object.values(DRUG_GROUPS).flat());

        const [showToast, setShowToast] = useState(false);
        useEffect(() => {
            if(notification && notification.id) {
                setShowToast(true);
                const timer = setTimeout(() => setShowToast(false), 3000);
                return () => clearTimeout(timer);
            }
        }, [notification]);

        const formatTime = (s) => `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
        
        // Logic to hide traces if no monitoring applied
        const isMonitoringApplied = activeInterventions.has('Obs'); 
        const showEtco2 = etco2Enabled;
        const showArt = activeInterventions.has('ArtLine');
        const isPaeds = scenario.ageRange === 'Paediatric' || scenario.wetflag;

        const cycleAudioOutput = () => {
             const next = audioOutput === 'controller' ? 'monitor' : (audioOutput === 'monitor' ? 'both' : 'controller');
             sim.dispatch({type: 'SET_AUDIO_OUTPUT', payload: next});
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
        };
        
        const renderDrugsTab = () => {
             const allDrugs = Object.keys(INTERVENTIONS).filter(k => INTERVENTIONS[k].category === 'Drugs').sort();
             // Categorize
             const groups = { ...DRUG_GROUPS, "Other": allDrugs.filter(d => !KNOWN_DRUGS.has(d)) };
             
             return (
                 <div className="space-y-4">
                     {Object.keys(groups).map(group => {
                         if (groups[group].length === 0) return null;
                         return (
                             <div key={group}>
                                 <h4 className="text-xs font-bold text-slate-500 uppercase mb-1 border-b border-slate-700 pb-1">{group}</h4>
                                 <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                                     {groups[group].map(key => renderActionBtn(key))}
                                 </div>
                             </div>
                         );
                     })}
                 </div>
             );
        };

        const openVitalControl = (key) => { setModalVital(key); setModalTarget(vitals[key === 'bp' ? 'bpSys' : key]); if (key === 'bp') setModalTarget2(vitals.bpDia); setTrendDuration(30); };
        const confirmVitalUpdate = () => { 
            const targets = {}; 
            if (modalVital === 'bp') { targets.bpSys = parseFloat(modalTarget); targets.bpDia = parseFloat(modalTarget2); } 
            else { targets[modalVital] = (modalVital === 'pupils' || modalVital === 'gcs') ? modalTarget : parseFloat(modalTarget); } 
            if (trendDuration === 0) Object.keys(targets).forEach(k => manualUpdateVital(k, targets[k]));
            else startTrend(targets, trendDuration); 
            setModalVital(null); 
        };

        const getTrend = (key) => trends.active && trends.targets[key] !== undefined ? { active: true, progress: trends.elapsed / trends.duration } : null;

        return (
            <div className={`h-full overflow-hidden flex flex-col p-2 bg-slate-900 relative ${flash === 'red' ? 'flash-red' : (flash === 'green' ? 'flash-green' : '')}`}>
                {/* Controller Toast */}
                <div className={`absolute top-20 left-1/2 -translate-x-1/2 z-50 bg-slate-800 border-l-4 rounded shadow-2xl px-6 py-3 transition-all duration-300 ${showToast ? 'translate-y-0 opacity-100' : '-translate-y-10 opacity-0 pointer-events-none'} ${notification?.type === 'danger' ? 'border-red-500' : notification?.type === 'success' ? 'border-emerald-500' : 'border-sky-500'}`}>
                    <div className="flex items-center gap-3">
                        <Lucide icon={notification?.type === 'danger' ? 'alert-triangle' : notification?.type === 'success' ? 'check-circle' : 'info'} className={`w-5 h-5 ${notification?.type === 'danger' ? 'text-red-500' : notification?.type === 'success' ? 'text-emerald-500' : 'text-sky-500'}`} />
                        <span className="font-bold text-white">{notification?.msg}</span>
                    </div>
                </div>

                {/* Top Bar */}
                <div className="flex justify-between items-center bg-slate-800 p-2 rounded mb-2 border border-slate-700">
                    <div className="flex gap-2 items-center relative z-20">
                        <Button variant="secondary" onClick={onBack} className="h-8 px-2"><Lucide icon="arrow-left"/> Back</Button>
                        <Button variant="danger" onClick={onFinish} className="h-8 px-2 font-bold"><Lucide icon="square"/> Finish</Button>
                        {!isRunning ? ( <Button variant="success" onClick={start} className="h-8 px-4 font-bold"><Lucide icon="play"/> START</Button> ) : ( <Button variant="warning" onClick={pause} className="h-8 px-4"><Lucide icon="pause"/> PAUSE</Button> )}
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Audio Output Toggle */}
                        <Button variant="secondary" onClick={cycleAudioOutput} className="h-8 px-2 text-[10px] uppercase font-bold w-32 justify-between">
                            <Lucide icon="speaker" className="w-3 h-3"/> {audioOutput === 'both' ? 'Audio: Both' : (audioOutput === 'controller' ? 'Audio: Ctrl' : 'Audio: Mon')}
                        </Button>
                        {/* Mute */}
                        <Button variant={isMuted ? "danger" : "secondary"} onClick={() => sim.dispatch({type: 'SET_MUTED', payload: !isMuted})} className="h-8 px-2">
                            <Lucide icon={isMuted ? "volume-x" : "volume-2"} className="w-4 h-4"/>
                        </Button>
                         {/* View Log */}
                        <Button variant="secondary" onClick={() => setShowLogModal(true)} className="h-8 px-2"><Lucide icon="list" className="w-4 h-4"/></Button>

                        <div className="w-px h-6 bg-slate-600 mx-1"></div>
                        <Button variant="outline" onClick={() => window.open(`?mode=monitor&session=${sessionID}`, '_blank')} className="h-8 px-3 text-sky-400 border-sky-500/50 hover:bg-sky-900/30"><Lucide icon="monitor" className="w-4 h-4 mr-1"/> Launch Monitor</Button>
                        <div className="font-mono text-2xl font-bold text-white ml-2">{formatTime(time)}</div>
                    </div>
                </div>

                <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-2 overflow-hidden min-h-0">
                    {/* LEFT COL */}
                    <div className="lg:col-span-4 flex flex-col gap-2 overflow-y-auto">
                         <div className="bg-slate-800 p-3 rounded border-l-4 border-sky-500 shadow-md">
                            <h3 className="text-xs font-bold text-sky-400 uppercase mb-1 flex items-center gap-2"><Lucide icon="user" className="w-3 h-3"/> Patient Details</h3>
                            <div className="text-sm text-white font-bold">{scenario.patientName} ({scenario.patientAge}y {scenario.sex})</div>
                            {scenario.title && <div className="text-xs text-emerald-400 font-bold uppercase mt-0.5">{scenario.title}</div>}
                            {scenario.deterioration && scenario.deterioration.type && <div className="text-[10px] text-slate-400 uppercase tracking-widest mt-0.5">Dx: {scenario.deterioration.type}</div>}
                            <div className="text-xs text-slate-300 mt-1 line-clamp-2">{scenario.patientProfileTemplate.replace('{age}', scenario.patientAge).replace('{sex}', scenario.sex)}</div>
                            <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-700">
                                <div><span className="text-[10px] text-slate-500 uppercase block">PMH</span><span className="text-xs text-slate-300">{scenario.pmh ? scenario.pmh.join(", ") : "Nil"}</span></div>
                                <div><span className="text-[10px] text-slate-500 uppercase block">Allergies</span><span className="text-xs text-red-300">{scenario.allergies ? scenario.allergies.join(", ") : "NKDA"}</span></div>
                            </div>
                         </div>
                         
                         {/* WETFLAG DISPLAY */}
                         {isPaeds && scenario.wetflag && (
                             <div className="bg-slate-800 p-2 rounded border border-purple-500/30">
                                 <h3 className="text-[10px] font-bold text-purple-400 uppercase mb-1 flex items-center gap-2"><Lucide icon="baby" className="w-3 h-3"/> WETFLAG ({scenario.wetflag.weight}kg)</h3>
                                 <div className="grid grid-cols-3 gap-1 text-xs">
                                     <div className="bg-slate-900 p-1 rounded text-center"><span className="text-[8px] text-slate-500 block">ENERGY</span><span className="font-mono font-bold">{scenario.wetflag.energy}J</span></div>
                                     <div className="bg-slate-900 p-1 rounded text-center"><span className="text-[8px] text-slate-500 block">TUBE</span><span className="font-mono font-bold">{scenario.wetflag.tube}</span></div>
                                     <div className="bg-slate-900 p-1 rounded text-center"><span className="text-[8px] text-slate-500 block">FLUIDS</span><span className="font-mono font-bold">{scenario.wetflag.fluids}ml</span></div>
                                     <div className="bg-slate-900 p-1 rounded text-center"><span className="text-[8px] text-slate-500 block">LORAZ</span><span className="font-mono font-bold">{scenario.wetflag.lorazepam}mg</span></div>
                                     <div className="bg-slate-900 p-1 rounded text-center"><span className="text-[8px] text-slate-500 block">ADREN</span><span className="font-mono font-bold">{scenario.wetflag.adrenaline}mcg</span></div>
                                     <div className="bg-slate-900 p-1 rounded text-center"><span className="text-[8px] text-slate-500 block">GLUC</span><span className="font-mono font-bold">{scenario.wetflag.glucose}ml</span></div>
                                 </div>
                             </div>
                         )}

                        <div className="bg-black border border-slate-800 rounded relative overflow-hidden">
                             <div className="relative">
                                 {/* TALLER MONITOR */}
                                 <ECGMonitor rhythmType={state.rhythm} hr={vitals.hr} rr={vitals.rr} spO2={vitals.spO2} isPaused={!isRunning} showTraces={isMonitoringApplied} showEtco2={showEtco2} showArt={showArt} co2Pathology={etco2Shape} className="h-72"/>
                                 {!isMonitoringApplied && (
                                     <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-slate-500 text-xs font-mono uppercase tracking-widest z-10 pointer-events-none">
                                         No Monitoring
                                     </div>
                                 )}
                                 <button onClick={()=>setShowRhythmModal(true)} className="absolute top-1 right-1 bg-slate-800/80 hover:bg-slate-700 border border-slate-600 px-2 py-1 text-[10px] text-white rounded z-30 font-bold uppercase tracking-wider backdrop-blur-sm">Change Rhythm</button>
                             </div>

                             <div className="grid grid-cols-2 gap-1 p-1 bg-black">
                                 <VitalDisplay label="HR" value={vitals.hr} onClick={()=>openVitalControl('hr')} visible={true} trend={getTrend('hr')} />
                                 <VitalDisplay label="BP" value={vitals.bpSys} value2={vitals.bpDia} onClick={()=>openVitalControl('bp')} visible={true} trend={getTrend('bpSys')} />
                                 <VitalDisplay label="SpO2" value={vitals.spO2} onClick={()=>openVitalControl('spO2')} visible={true} trend={getTrend('spO2')} />
                                 <VitalDisplay label="RR" value={vitals.rr} onClick={()=>openVitalControl('rr')} visible={true} trend={getTrend('rr')} />
                                 <VitalDisplay label="Temp" value={vitals.temp} unit="°C" onClick={()=>openVitalControl('temp')} visible={true} trend={getTrend('temp')} />
                                 <VitalDisplay label="Glucose" value={vitals.bm} unit="mmol" onClick={()=>openVitalControl('bm')} visible={true} trend={getTrend('bm')} />
                                 <VitalDisplay label="ETCO2" value={vitals.etco2} unit="kPa" onClick={()=>openVitalControl('etco2')} visible={true} trend={getTrend('etco2')} />
                                 <VitalDisplay label="GCS" value={vitals.gcs} onClick={()=>openVitalControl('gcs')} visible={true} trend={getTrend('gcs')} />
                             </div>
                        </div>
                        
                        {/* ARREST / ROSC / DEFIB BUTTONS */}
                        <div className="grid grid-cols-2 gap-2">
                            <div className="relative">
                                <Button variant="danger" onClick={()=>setShowArrestMenu(!showArrestMenu)} className="w-full font-bold animate-pulse"><Lucide icon="activity" className="w-4 h-4"/> ARREST</Button>
                                {showArrestMenu && (
                                    <div className="absolute bottom-12 left-0 bg-slate-800 border border-slate-600 rounded shadow-xl w-full flex flex-col p-1 z-50">
                                        {ARREST_RHYTHMS.map(r => (
                                            <button key={r} onClick={() => { triggerArrest(r); setShowArrestMenu(false); }} className="text-left px-3 py-2 text-sm text-red-300 hover:bg-slate-700 hover:text-white rounded">{r}</button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="relative">
                                <Button variant="success" onClick={()=>setShowROSCMenu(!showROSCMenu)} className="w-full font-bold"><Lucide icon="heart" className="w-4 h-4"/> ROSC</Button>
                                {showROSCMenu && (
                                    <div className="absolute bottom-12 right-0 bg-slate-800 border border-slate-600 rounded shadow-xl w-full flex flex-col p-1 z-50">
                                        {ROSC_RHYTHMS.map(r => (
                                            <button key={r} onClick={() => { triggerROSC(r); setShowROSCMenu(false); }} className="text-left px-3 py-2 text-sm text-emerald-300 hover:bg-slate-700 hover:text-white rounded">{r}</button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        
                        <Button variant="outline" onClick={() => sim.dispatch({type: 'SET_ARREST_PANEL', payload: !arrestPanelOpen})} className={`w-full ${arrestPanelOpen ? 'bg-red-900/30 border-red-500' : ''}`}>
                             <Lucide icon="zap" className="w-4 h-4"/> {arrestPanelOpen ? "Close Defib on Monitor" : "Open Defib on Monitor"}
                        </Button>

                        {arrestPanelOpen && (
                             <div className="bg-red-900/20 border-2 border-red-500 p-2 rounded-lg animate-fadeIn shadow-2xl shadow-red-900/50">
                                 <div className="flex justify-between items-center mb-2">
                                     <h3 className="text-red-400 font-bold uppercase text-xs flex items-center gap-1"><Lucide icon="zap" className="w-3 h-3"/> Defibrillator Active</h3>
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
                    </div>
                    
                    {/* RIGHT COL */}
                    <div className="lg:col-span-8 flex flex-col bg-slate-800 rounded border border-slate-700 overflow-hidden">
                        
                        {/* SEARCH / LOG BAR */}
                        <div className="bg-slate-900 p-3 border-b border-slate-700 flex gap-2">
                            <input type="text" className="bg-slate-800 border border-slate-600 rounded px-4 h-12 text-lg flex-1 text-white focus:border-sky-500 outline-none" placeholder="Search Action or Type Custom Log..." value={customLog} onChange={e=>setCustomLog(e.target.value)} onKeyDown={e => e.key === 'Enter' && (addLogEntry(customLog, 'manual') || setCustomLog(""))} />
                            <Button onClick={() => {addLogEntry(customLog, 'manual'); setCustomLog("");}} variant="secondary" className="h-12 w-24">Add Entry</Button>
                            <div className="w-px h-12 bg-slate-700 mx-2"></div>
                            <Button onClick={() => {sim.dispatch({type: 'TRIGGER_IMPROVE'}); addLogEntry("Patient Improving (Trend)", "success")}} className="h-12 w-20 text-xs px-2 bg-emerald-900 border border-emerald-500 text-emerald-100 flex-col gap-0 leading-tight"><span>Trend</span><span className="font-bold">Better</span></Button>
                            <Button onClick={() => {sim.dispatch({type: 'TRIGGER_DETERIORATE'}); addLogEntry("Patient Deteriorating (Trend)", "danger")}} className="h-12 w-20 text-xs px-2 bg-red-900 border border-red-500 text-red-100 flex-col gap-0 leading-tight"><span>Trend</span><span className="font-bold">Worse</span></Button>
                        </div>

                        {/* TABS */}
                        <div className="flex overflow-x-auto bg-slate-900 border-b border-slate-700 no-scrollbar">
                             {['Common', 'Drugs', 'Airway', 'Breathing', 'Circulation', 'Procedures', 'Voice'].map(cat => (
                                 <button key={cat} onClick={() => setActiveTab(cat)} className={`px-4 py-3 text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${activeTab === cat ? 'bg-slate-800 text-sky-400 border-t-2 border-sky-400' : 'text-slate-500 hover:text-slate-300'}`}>{cat}</button>
                             ))}
                        </div>
                        
                        <div className="flex-1 p-2 overflow-y-auto bg-slate-800 relative">
                            {/* VOICE TAB CONTENT */}
                            {activeTab === 'Voice' ? (
                                <div className="space-y-4">
                                    {/* TTS INPUT */}
                                    <div className="bg-slate-900 p-3 rounded border border-slate-700">
                                        <h3 className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-2"><Lucide icon="mic" className="w-3 h-3"/> Text to Speech</h3>
                                        <div className="flex gap-2">
                                            <input type="text" value={speechText} onChange={(e) => setSpeechText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (speak(speechText) || setSpeechText(""))} className="flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white text-sm" placeholder="Type what the patient says..."/>
                                            <Button onClick={() => {speak(speechText); setSpeechText("");}} variant="primary" className="h-10">Speak</Button>
                                        </div>
                                    </div>
                                    
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                        {VOICE_PHRASES.map(phrase => (
                                            <Button key={phrase} onClick={() => speak(phrase)} variant="secondary" className="h-12 text-sm normal-case justify-start px-4 text-left border border-slate-600 bg-slate-800">
                                                <Lucide icon="message-square" className="w-4 h-4 mr-2 opacity-50"/> "{phrase}"
                                            </Button>
                                        ))}
                                    </div>
                                </div>
                            ) : activeTab === 'Drugs' ? (
                                renderDrugsTab()
                            ) : (
                                <>
                                    {scenario.recommendedActions && activeTab === 'Common' && (
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
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* VITAL CONTROL MODAL */}
                {modalVital && (
                    <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm">
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-sm shadow-2xl">
                            <h3 className="text-lg font-bold text-white mb-4 uppercase tracking-wider">Control: {modalVital}</h3>
                            <div className="space-y-4">
                                <div><label className="text-xs text-slate-400 font-bold uppercase">Target</label><input type="number" value={modalTarget} onChange={e=>setModalTarget(e.target.value)} className="w-full bg-slate-900 border border-slate-500 rounded p-3 text-xl font-mono text-white text-center font-bold" autoFocus /></div>
                                {modalVital === 'bp' && <div><label className="text-xs text-slate-400 font-bold uppercase">Diastolic</label><input type="number" value={modalTarget2} onChange={e=>setModalTarget2(e.target.value)} className="w-full bg-slate-900 border border-slate-500 rounded p-3 text-xl font-mono text-white text-center font-bold" /></div>}
                                
                                {modalVital === 'etco2' && (
                                    <div>
                                        <label className="text-xs text-slate-400 font-bold uppercase mb-2 block">Waveform Shape</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button onClick={()=>setEtco2Shape('normal')} className={`p-2 rounded border text-xs font-bold ${etco2Shape==='normal' ? 'bg-sky-600 border-sky-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}`}>Normal</button>
                                            <button onClick={()=>setEtco2Shape('bronchospastic')} className={`p-2 rounded border text-xs font-bold ${etco2Shape==='bronchospastic' ? 'bg-sky-600 border-sky-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-300'}`}>Obstructive</button>
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-4 gap-1 mt-2">
                                    {[0, 30, 120, 300].map(d => <button key={d} onClick={()=>setTrendDuration(d)} className={`p-2 rounded text-[10px] font-bold border ${trendDuration===d ? 'bg-sky-600 text-white' : 'bg-slate-700 text-slate-400'}`}>{d}s</button>)}
                                </div>
                                <Button onClick={confirmVitalUpdate} variant="success" className="w-full mt-4 h-12 text-lg font-bold">CONFIRM</Button>
                                <Button onClick={()=>setModalVital(null)} variant="outline" className="w-full">Cancel</Button>
                            </div>
                        </div>
                    </div>
                )}
                
                {/* LOG MODAL */}
                {showLogModal && (
                    <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm">
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-2xl shadow-2xl h-[80vh] flex flex-col">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-bold text-white uppercase tracking-wider">Simulation Log</h3>
                                <Button onClick={()=>setShowLogModal(false)} size="sm" variant="outline">Close</Button>
                            </div>
                            <div className="flex-1 overflow-y-auto bg-slate-900 p-4 rounded border border-slate-700 font-mono text-sm space-y-2">
                                {state.log.map((entry, i) => (
                                    <div key={i} className="flex gap-4 border-b border-slate-800 pb-1">
                                        <span className="text-slate-500 w-20 flex-shrink-0">{entry.simTime}</span>
                                        <span className={`${entry.type==='danger' ? 'text-red-400 font-bold' : entry.type==='success' ? 'text-emerald-400 font-bold' : 'text-slate-300'}`}>{entry.msg}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {showRhythmModal && (
                    <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm">
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-2xl shadow-2xl">
                            <h3 className="text-lg font-bold text-white mb-4 uppercase tracking-wider">Select Rhythm</h3>
                            <div className="grid grid-cols-3 gap-2">
                                {RHYTHMS.map(r => (
                                    <button key={r} onClick={() => { sim.dispatch({type: 'UPDATE_RHYTHM', payload: r}); addLogEntry(`Rhythm changed to ${r}`, 'manual'); setShowRhythmModal(false); }} className={`p-3 text-sm font-bold rounded border ${state.rhythm === r ? 'bg-sky-600 border-sky-400 text-white' : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'}`}>
                                        {r}
                                    </button>
                                ))}
                            </div>
                            <Button onClick={()=>setShowRhythmModal(false)} variant="outline" className="w-full mt-4">Cancel</Button>
                        </div>
                    </div>
                )}
            </div>
        );
    };
    window.LiveSimScreen = LiveSimScreen;
})();
