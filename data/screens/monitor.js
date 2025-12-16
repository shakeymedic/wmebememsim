(() => {
    const { useState, useEffect } = React;

    // --- SCREEN 4: LIVE SIM CONTROLLER ---
    const LiveSimScreen = ({ sim, onFinish, onBack, sessionID }) => {
        const { INTERVENTIONS, Button, Lucide, Card, VitalDisplay, ECGMonitor, InvestigationButton } = window;
        const { state, start, pause, stop, applyIntervention, addLogEntry, manualUpdateVital, triggerArrest, triggerROSC, revealInvestigation, nextCycle, enableAudio, speak, startTrend, toggleAudioLoop, playSound } = sim;
        const { scenario, time, cycleTimer, isRunning, vitals, prevVitals, log, flash, activeInterventions, interventionCounts, activeDurations, isMuted, rhythm, etco2Enabled, queuedRhythm, cprInProgress, nibp, audioOutput, trends, arrestPanelOpen, waveformGain, noise, remotePacerState, notification, activeLoops, isOffline } = state;
        
        const [activeTab, setActiveTab] = useState("Common");
        const [customLog, setCustomLog] = useState("");
        const [searchResults, setSearchResults] = useState([]);
        const [expandRhythm, setExpandRhythm] = useState(false);
        const [expandArrest, setExpandArrest] = useState(false); 
        const [customSpeech, setCustomSpeech] = useState("");
        const [showLogModal, setShowLogModal] = useState(false);
        const [modalVital, setModalVital] = useState(null); 
        const [modalTarget, setModalTarget] = useState("");
        const [modalTarget2, setModalTarget2] = useState(""); 
        const [trendDuration, setTrendDuration] = useState(30);
        const [gainVal, setGainVal] = useState(waveformGain || 1.0);
        const [showEcg, setShowEcg] = useState(true);

        const tabs = [
            { id: 'Common', icon: 'star' },
            { id: 'Airway', icon: 'wind' },
            { id: 'Breathing', icon: 'activity' }, 
            { id: 'Circulation', icon: 'heart' },
            { id: 'Drugs', icon: 'pill' },
            { id: 'Procedures', icon: 'syringe' },
            { id: 'Voice', icon: 'mic' },
            { id: 'Handover', icon: 'clipboard' }
        ];

        useEffect(() => { window.waveformGain = waveformGain; }, [waveformGain]);
        
        const [showToast, setShowToast] = useState(false);
        useEffect(() => {
            if(notification && notification.id) {
                setShowToast(true);
                const timer = setTimeout(() => setShowToast(false), 3000);
                return () => clearTimeout(timer);
            }
        }, [notification]);

        useEffect(() => {
            const handleKey = (e) => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                if (e.code === 'Space') { e.preventDefault(); }
                if (e.key === 'm') sim.dispatch({ type: 'SET_MUTED', payload: !isMuted });
                if (e.key === 'l') setShowLogModal(true);
            };
            window.addEventListener('keydown', handleKey);
            return () => window.removeEventListener('keydown', handleKey);
        }, [isMuted]);

        const handleGhost = (btnId) => {
            const channel = new BroadcastChannel('sim_channel');
            channel.postMessage({ type: 'GHOST_PRESS', payload: btnId });
        };

        const drugCats = {
            "Arrest": ['AdrenalineIV', 'Amiodarone', 'Calcium', 'MagSulph', 'SodiumBicarb', 'Atropine'],
            "Sedation": ['Midazolam', 'Lorazepam', 'Ketamine', 'Morphine', 'Fentanyl', 'Roc', 'Sux', 'Propofol'],
            "Trauma": ['TXA', 'Blood', 'Fluids'],
            "Infusions": ['FluidInfusion', 'InsulinInfusion', 'GTNInfusion', 'Noradrenaline'], 
            "General": ['Paracetamol', 'Ondansetron', 'Antibiotics', 'Hydrocortisone', 'Dexamethasone', 'Nebs', 'AdrenalineIM']
        };
        const mapVoice = (txt) => {
            if (txt.includes('Cough')) return 'Cough, cough, cough';
            if (txt.includes('Scream')) return 'Ahhhhh! Help me!';
            if (txt.includes('Moan')) return 'Ohhhhhh...';
            return txt.replace(/\*/g, '');
        };
        useEffect(() => { if (customLog.length > 1) { const results = Object.keys(INTERVENTIONS).filter(key => (key + INTERVENTIONS[key].label).toLowerCase().includes(customLog.toLowerCase())); setSearchResults(results); } else { setSearchResults([]); } }, [customLog]);
        
        const getInterventionsByCat = (cat) => {
            if (cat === 'Handover' || cat === 'Voice') return [];
            let keys = [];
            if (cat === 'Common') keys = ['Obs', 'Oxygen', 'IV Access', 'Fluids', 'Analgesia', 'Antiemetic', 'Antibiotics', 'Nebs', 'AdrenalineIM', 'Blood', 'TXA', 'ArtLine']; 
            else if (cat === 'Drugs') keys = Object.keys(INTERVENTIONS).filter(key => INTERVENTIONS[key].category === 'Drugs'); 
            else keys = Object.keys(INTERVENTIONS).filter(key => INTERVENTIONS[key].category === cat);
            return keys.sort((a, b) => INTERVENTIONS[a].label.localeCompare(INTERVENTIONS[b].label));
        };
        
        const formatTime = (s) => `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
        const toggleCPR = () => { sim.dispatch({ type: 'TOGGLE_CPR', payload: !cprInProgress }); addLogEntry(!cprInProgress ? 'CPR Started' : 'CPR Stopped', 'action'); };
        const handleShock = () => { applyIntervention('Defib'); if (!cprInProgress) toggleCPR(); };
        const hasMonitoring = activeInterventions.has('Obs'); const hasArtLine = activeInterventions.has('ArtLine');
        const generateSBAR = () => `S: ${scenario.title}.\nB: ${scenario.patientProfileTemplate.replace('{age}', scenario.patientAge)}.\nA: HR ${vitals.hr}, BP ${vitals.bpSys}/${vitals.bpDia}, SpO2 ${vitals.spO2}%.\nR: Review.`;
        const openVitalControl = (key) => { setModalVital(key); setModalTarget(vitals[key === 'bp' ? 'bpSys' : key]); if (key === 'bp') setModalTarget2(vitals.bpDia); setTrendDuration(30); };
        
        const quickAdjust = (amt) => { let current = parseFloat(modalTarget) || 0; setModalTarget(current + amt); if (modalVital === 'bp') { let currentDia = parseFloat(modalTarget2) || 0; setModalTarget2(currentDia + (amt * 0.6)); } };
        
        const confirmVitalUpdate = () => { 
            const targets = {}; 
            const isFloat = ['temp', 'bm', 'etco2', 'pH', 'K', 'Lac'].includes(modalVital);
            
            if (modalVital === 'bp') { 
                targets.bpSys = Math.round(parseFloat(modalTarget)); 
                targets.bpDia = Math.round(parseFloat(modalTarget2)); 
            } else if (modalVital === 'pupils' || modalVital === 'gcs') {
                targets[modalVital] = modalTarget; 
            } else { 
                const raw = parseFloat(modalTarget);
                targets[modalVital] = isFloat ? parseFloat(raw.toFixed(1)) : Math.round(raw); 
            } 
            
            if (trendDuration === 0) { 
                Object.keys(targets).forEach(k => manualUpdateVital(k, targets[k])); 
            } else { 
                startTrend(targets, trendDuration); 
            } 
            setModalVital(null); 
        };
        
        const [annotationText, setAnnotationText] = useState("");
        const addAnnotation = () => { if(annotationText) { addLogEntry(`[NOTE] ${annotationText}`, 'manual'); setAnnotationText(""); } };

        return (
            <div className={`h-full overflow-hidden flex flex-col p-2 bg-slate-900 relative ${flash === 'red' ? 'flash-red' : (flash === 'green' ? 'flash-green' : '')}`}>
                <div className={`absolute top-24 left-1/2 -translate-x-1/2 z-50 pointer-events-none transition-all duration-300 ${showToast ? 'translate-y-0 opacity-100 scale-100' : '-translate-y-10 opacity-0 scale-90'}`}>
                    {notification && (
                        <div className={`px-8 py-4 rounded-xl shadow-2xl flex items-center gap-4 border-2 ${notification.type === 'danger' ? 'bg-red-900/90 border-red-500 text-red-100' : notification.type === 'success' ? 'bg-emerald-900/90 border-emerald-400 text-emerald-100' : 'bg-slate-800/90 border-sky-500 text-sky-100'}`}>
                            {notification.type === 'success' && <Lucide icon="check-circle" className="w-10 h-10 text-emerald-400" />}
                            {notification.type === 'danger' && <Lucide icon="alert-triangle" className="w-10 h-10 text-red-500" />}
                            <div><div className="text-[10px] uppercase font-bold opacity-80 tracking-widest">System Notification</div><div className="text-3xl font-bold font-mono tracking-tight">{notification.msg}</div></div>
                        </div>
                    )}
                </div>

                <div className="flex justify-between items-center bg-slate-800 p-2 rounded mb-2 border border-slate-700">
                    <div className="flex gap-2 items-center">
                        <Button variant="secondary" onClick={onBack} className="h-8 px-2"><Lucide icon="arrow-left"/> Back</Button>
                        {!isRunning ? ( <Button variant="success" onClick={start} className="h-8 px-4 font-bold"><Lucide icon="play"/> START</Button> ) : ( <Button variant="warning" onClick={pause} className="h-8 px-4"><Lucide icon="pause"/> PAUSE</Button> )}
                        <Button variant="danger" onClick={() => { if(window.confirm("End scenario and go to debrief?")) onFinish(); }} className="h-8 px-4 font-bold border border-red-500 bg-red-900/50 hover:bg-red-800"><Lucide icon="square" className="fill-current"/> FINISH</Button>
                        <div className="h-8 w-px bg-slate-600 mx-1"></div>
                        <Button onClick={() => sim.dispatch({ type: 'SET_MUTED', payload: !isMuted })} variant={isMuted ? "danger" : "secondary"} className="h-8 px-2" title="Toggle Mute (M)"><Lucide icon={isMuted ? "volume-x" : "volume-2"} /></Button>
                        <Button onClick={() => { const modes = ['monitor', 'controller', 'both']; const next = modes[(modes.indexOf(audioOutput || 'monitor') + 1) % modes.length]; sim.dispatch({ type: 'SET_AUDIO_OUTPUT', payload: next }); }} variant="outline" className="h-8 px-2 text-[10px] w-24" title="Audio Output Source"><span className="truncate">{audioOutput === 'both' ? 'Sound: ALL' : audioOutput === 'controller' ? 'Sound: PAD' : 'Sound: MON'}</span></Button>
                        <Button onClick={() => setShowLogModal(true)} variant="secondary" className="h-8 px-2" title="View Log (L)"><Lucide icon="scroll-text" /></Button>
                        <Button variant="outline" onClick={() => window.open(window.location.href.split('?')[0] + '?mode=monitor&session=' + sessionID, '_blank', 'width=1280,height=720')} className="h-8 px-2 text-xs"><Lucide icon="external-link"/> Monitor</Button>
                        {isOffline && (<div className="flex items-center gap-1 bg-red-500/20 text-red-400 px-2 py-1 rounded border border-red-500/50 text-[10px] font-bold uppercase animate-pulse"><Lucide icon="wifi-off" className="w-3 h-3" /> OFFLINE</div>)}
                    </div>
                    <div className="hidden md:flex flex-col ml-4 px-3 border-l border-slate-600"><span className="text-[10px] text-slate-400 uppercase font-bold">Patient</span><span className="text-white font-bold">{scenario.patientAge}y {scenario.sex}</span></div>
                </div>

                {arrestPanelOpen && (
                    <div className="lg:col-span-3 bg-red-900/20 border border-red-500 p-4 rounded-lg flex flex-col md:flex-row gap-4 animate-fadeIn mb-2 shadow-2xl">
                        <div className="flex-1 flex flex-col justify-center items-center bg-slate-900/80 p-4 rounded border border-red-500/50">
                            <h3 className="text-red-500 font-bold uppercase tracking-widest mb-1">Cycle Timer</h3>
                            <div className={`text-5xl font-mono font-bold ${cycleTimer > 120 ? 'text-red-500 animate-pulse' : 'text-white'}`}>{formatTime(cycleTimer)}</div>
                            <div className="flex gap-2 mt-2"><Button variant="secondary" onClick={() => sim.dispatch({type: 'RESET_CYCLE_TIMER'})} className="h-8 text-xs">Reset</Button><Button variant="secondary" onClick={() => { const remaining = Math.max(0, 120 - cycleTimer); if(remaining > 0) sim.dispatch({type: 'FAST_FORWARD', payload: remaining}); sim.dispatch({type: 'RESET_CYCLE_TIMER'}); addLogEntry("Cycle Skipped / Finished", "system"); }} className="h-8 text-xs">Finish Cycle</Button></div>
                        </div>
                        <div className="flex-[3] grid grid-cols-2 md:grid-cols-4 gap-3">
                            <Button onClick={toggleCPR} variant={cprInProgress ? "warning" : "danger"} className="h-16 text-xl font-bold border-4 border-double">{cprInProgress ? "STOP CPR" : "START CPR"}</Button>
                            <Button onClick={handleShock} variant="warning" className="h-16 text-xl font-bold flex flex-col"><Lucide icon="zap" /> SHOCK</Button>
                            <Button onClick={() => applyIntervention('AdrenalineIV')} variant={interventionCounts['AdrenalineIV'] > 0 ? "success" : "outline"} className="h-16 font-bold flex flex-col"><span>Adrenaline</span><span className="text-[10px] opacity-70">1mg 1:10k</span>{interventionCounts['AdrenalineIV'] > 0 && <span className="absolute top-1 right-1 bg-white text-black text-[9px] px-1 rounded-full">x{interventionCounts['AdrenalineIV']}</span>}</Button>
                            <Button onClick={() => applyIntervention('Amiodarone')} variant={interventionCounts['Amiodarone'] > 0 ? "success" : "outline"} className="h-16 font-bold flex flex-col"><span>Amiodarone</span><span className="text-[10px] opacity-70">300mg</span>{interventionCounts['Amiodarone'] > 0 && <span className="absolute top-1 right-1 bg-white text-black text-[9px] px-1 rounded-full">x{interventionCounts['Amiodarone']}</span>}</Button>
                        </div>
                        <div className="flex-1 flex flex-col gap-2">
                            <h4 className="text-xs font-bold text-red-400 uppercase">4 H's & 4 T's</h4>
                            <div className="grid grid-cols-2 gap-1 text-[10px] text-slate-300"><div>Hypoxia</div><div>Thrombosis</div><div>Hypovolaemia</div><div>Tension #</div><div>Hyper/Hypo-K</div><div>Tamponade</div><div>Hypothermia</div><div>Toxins</div></div>
                            <Button onClick={() => sim.dispatch({type: 'SET_ARREST_PANEL', payload: false})} variant="secondary" className="mt-auto">Exit Arrest Mode</Button>
                        </div>
                    </div>
                )}

                <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-2 overflow-hidden min-h-0">
                    <div className="lg:col-span-4 flex flex-col gap-2 overflow-y-auto">
                        <div className="bg-slate-800 p-2 rounded border border-slate-600 flex-shrink-0">
                            <h4 className="text-[10px] font-bold text-sky-400 uppercase mb-1 flex items-center gap-2"><Lucide icon="user" className="w-3 h-3"/> {scenario.patientName} ({scenario.patientAge} {scenario.sex})</h4>
                            <div className="grid grid-cols-1 gap-1 text-[10px] text-slate-300">
                                <div className="truncate"><span className="text-slate-500 font-bold">PMH:</span> {scenario.pmh ? scenario.pmh.join(', ') : 'Nil'}</div>
                                <div className="truncate"><span className="text-slate-500 font-bold">Rx:</span> {scenario.dhx ? scenario.dhx.join(', ') : 'Nil'}</div>
                                <div className="truncate"><span className="text-slate-500 font-bold">All:</span> <span className="text-red-400 font-bold">{scenario.allergies ? scenario.allergies.join(', ') : 'NKDA'}</span></div>
                            </div>
                        </div>

                        <div className="bg-slate-800 p-2 rounded border border-slate-600 relative z-10 flex-shrink-0">
                            <div className="flex justify-between items-center mb-1">
                                <h4 className="text-[10px] font-bold text-sky-400 uppercase flex items-center gap-2"><Lucide icon="activity" className="w-3 h-3"/> Monitor</h4>
                                <button onClick={() => setShowEcg(!showEcg)} className="text-slate-400 hover:text-white"><Lucide icon={showEcg ? "minimize-2" : "maximize-2"} className="w-3 h-3" /></button>
                            </div>
                            <div className={`transition-all duration-300 overflow-hidden ${showEcg ? 'h-32 opacity-100' : 'h-0 opacity-0'}`}>
                                <ECGMonitor rhythmType={rhythm} hr={vitals.hr} rr={vitals.rr} spO2={vitals.spO2} isPaused={!isRunning} showEtco2={etco2Enabled} pathology={scenario?.deterioration?.type} showTraces={hasMonitoring} showArt={hasArtLine} isCPR={cprInProgress} className="h-full"/>
                            </div>
                            <div className="grid grid-cols-4 gap-1 p-1 bg-black rounded mt-1">
                                <VitalDisplay label="HR" value={vitals.hr} onClick={()=>openVitalControl('hr')} visible={true} />
                                <VitalDisplay label="BP" value={vitals.bpSys} value2={vitals.bpDia} onClick={()=>openVitalControl('bp')} visible={true} />
                                <VitalDisplay label="SpO2" value={vitals.spO2} onClick={()=>openVitalControl('spO2')} visible={true} />
                                <VitalDisplay label="RR" value={vitals.rr} onClick={()=>openVitalControl('rr')} visible={true} />
                            </div>
                            <div className="grid grid-cols-4 gap-1 p-1 bg-black border-t border-slate-900">
                                <VitalDisplay label="Temp" value={vitals.temp} unit="°C" onClick={()=>openVitalControl('temp')} visible={true} />
                                <VitalDisplay label="BM" value={vitals.bm} unit="mmol" onClick={()=>openVitalControl('bm')} visible={true} />
                                <VitalDisplay label="GCS" value={vitals.gcs} unit="" onClick={()=>openVitalControl('gcs')} visible={true} />
                                {etco2Enabled ? (<VitalDisplay label="ETCO2" value={vitals.etco2} unit="kPa" onClick={()=>openVitalControl('etco2')} visible={true} />) : (<VitalDisplay label="Pupils" value={vitals.pupils} unit="" isText={true} onClick={()=>openVitalControl('pupils')} visible={true} />)}
                            </div>
                        </div>
                        
                        {scenario.ageRange === 'Paediatric' && scenario.wetflag && (
                            <div className="bg-purple-900/30 p-2 rounded border border-purple-500/50">
                                <h4 className="text-[10px] font-bold text-purple-400 uppercase mb-1">WETFLAG Safety (Wt: {scenario.wetflag.weight}kg)</h4>
                                <div className="grid grid-cols-3 gap-1 text-[10px] text-slate-300">
                                    <div className="bg-slate-900 px-2 py-1 rounded flex justify-between"><span>Energy</span><span className="font-bold text-white">{scenario.wetflag.energy}J</span></div>
                                    <div className="bg-slate-900 px-2 py-1 rounded flex justify-between"><span>Fluid</span><span className="font-bold text-white">{scenario.wetflag.fluids}ml</span></div>
                                    <div className="bg-slate-900 px-2 py-1 rounded flex justify-between"><span>Adren</span><span className="font-bold text-white">{scenario.wetflag.adrenaline}mcg</span></div>
                                </div>
                            </div>
                        )}

                        <div className="bg-slate-800 p-2 rounded border border-slate-600">
                            <h4 className="text-[10px] font-bold text-sky-400 uppercase mb-2">Continuous Sounds</h4>
                            <div className="flex gap-2">
                                <Button onClick={() => toggleAudioLoop('Wheeze')} variant={activeLoops['Wheeze'] ? "warning" : "outline"} className="flex-1 h-8 text-xs">Wheeze {activeLoops['Wheeze'] && <Lucide icon="activity" className="animate-pulse w-3 h-3 ml-2"/>}</Button>
                                <Button onClick={() => toggleAudioLoop('Stridor')} variant={activeLoops['Stridor'] ? "warning" : "outline"} className="flex-1 h-8 text-xs">Stridor {activeLoops['Stridor'] && <Lucide icon="activity" className="animate-pulse w-3 h-3 ml-2"/>}</Button>
                            </div>
                        </div>

                        <div className="bg-slate-800 p-2 rounded border border-slate-600">
                            <h4 className="text-[10px] font-bold text-purple-400 uppercase mb-2">Remote Demo (Ghost)</h4>
                            <div className="grid grid-cols-2 gap-2">
                                <button onClick={() => handleGhost('chargeBtn')} className="bg-slate-700 hover:bg-slate-600 text-xs py-1 rounded border border-slate-500 transition-colors">Press Charge</button>
                                <button onClick={() => handleGhost('shockBtn')} className="bg-slate-700 hover:bg-slate-600 text-xs py-1 rounded border border-slate-500 transition-colors">Press Shock</button>
                                <button onClick={() => handleGhost('syncBtn')} className="bg-slate-700 hover:bg-slate-600 text-xs py-1 rounded border border-slate-500 transition-colors">Toggle Sync</button>
                                <button onClick={() => handleGhost('analyseBtn')} className="bg-slate-700 hover:bg-slate-600 text-xs py-1 rounded border border-slate-500 transition-colors">Press Analyse</button>
                            </div>
                        </div>

                        <div className="bg-slate-900/50 p-2 rounded border border-slate-700">
                            <h4 className="text-[10px] font-bold text-slate-500 uppercase">Remote Pacer State</h4>
                            <div className="flex justify-between text-xs font-mono text-green-400 mt-1"><span>Rate: {remotePacerState?.rate || 0} ppm</span><span>Output: {remotePacerState?.output || 0} mA</span></div>
                        </div>

                        <div className="bg-slate-800 p-2 rounded border border-slate-600 relative z-10">
                            <h4 className="text-[10px] font-bold text-green-400 uppercase mb-1">Rhythm & Arrest</h4>
                            <div className="grid grid-cols-2 gap-1 mb-2">
                                <div className="relative">
                                     <Button onClick={() => setExpandArrest(!expandArrest)} variant="danger" className="h-8 text-xs w-full justify-between">Trigger Arrest... <Lucide icon="chevron-down" className="w-3 h-3"/></Button>
                                     {expandArrest && (
                                         <div className="absolute top-full left-0 w-full bg-slate-800 border border-slate-500 rounded shadow-xl mt-1 z-50">
                                             {['VF', 'PEA', 'pVT', 'Asystole'].map(type => (<button key={type} onClick={() => { triggerArrest(type); setExpandArrest(false); }} className="block w-full text-left px-3 py-2 text-xs text-white hover:bg-red-900 border-b border-slate-700">{type}</button>))}
                                         </div>
                                     )}
                                </div>
                                <Button onClick={triggerROSC} variant="success" className="h-8 text-xs">ROSC</Button>
                            </div>
                            
                            <div className="bg-slate-900/50 p-2 rounded border border-slate-700 mb-2">
                                <h5 className="text-[9px] font-bold text-slate-400 uppercase mb-1">Next Shock Outcome</h5>
                                <div className="grid grid-cols-2 gap-1">
                                    <button onClick={() => sim.dispatch({type: 'SET_QUEUED_RHYTHM', payload: 'ROSC'})} className={`text-[10px] p-1 rounded border ${queuedRhythm === 'ROSC' ? 'bg-green-700 border-green-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-400'}`}>Convert (ROSC)</button>
                                    <button onClick={() => sim.dispatch({type: 'SET_QUEUED_RHYTHM', payload: 'VF'})} className={`text-[10px] p-1 rounded border ${queuedRhythm === 'VF' ? 'bg-red-700 border-red-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-400'}`}>Fail (Refractory)</button>
                                    <button onClick={() => sim.dispatch({type: 'SET_QUEUED_RHYTHM', payload: 'Asystole'})} className={`text-[10px] p-1 rounded border ${queuedRhythm === 'Asystole' ? 'bg-slate-700 border-slate-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-400'}`}>To Asystole</button>
                                    <button onClick={() => sim.dispatch({type: 'SET_QUEUED_RHYTHM', payload: 'PEA'})} className={`text-[10px] p-1 rounded border ${queuedRhythm === 'PEA' ? 'bg-amber-700 border-amber-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-400'}`}>To PEA</button>
                                </div>
                                {queuedRhythm && <div className="text-[9px] text-sky-400 text-center mt-1">Pending: {queuedRhythm}</div>}
                            </div>

                            <div className="relative">
                                <Button onClick={() => setExpandRhythm(!expandRhythm)} variant="secondary" className="w-full h-8 text-xs justify-between">{rhythm} <Lucide icon="chevron-down" className="w-3 h-3"/></Button>
                                {expandRhythm && (<div className="absolute top-full left-0 w-full bg-slate-800 border border-slate-500 rounded shadow-xl max-h-60 overflow-y-auto mt-1 z-50">{['Sinus Rhythm', 'Sinus Tachycardia', 'Sinus Bradycardia', 'AF', 'SVT', 'VT', 'VF', 'Asystole', 'PEA', '1st Deg Block', '3rd Deg Block'].map(r => (<button key={r} onClick={() => {sim.dispatch({type: 'UPDATE_RHYTHM', payload: r}); setExpandRhythm(false);}} className="block w-full text-left px-3 py-2 text-xs text-white hover:bg-sky-600 border-b border-slate-700">{r}</button>))}</div>)}
                            </div>
                            <Button onClick={() => sim.dispatch({type: 'SET_ARREST_PANEL', payload: !arrestPanelOpen})} variant={arrestPanelOpen ? "danger" : "outline"} className="w-full h-8 mt-2 text-xs">{arrestPanelOpen ? "Close Arrest Panel" : "Open Arrest Panel"}</Button>
                        </div>
                    </div>
                    
                    <div className="lg:col-span-8 flex flex-col bg-slate-800 rounded border border-slate-700 overflow-hidden">
                        <div className="flex overflow-x-auto bg-slate-900 border-b border-slate-700 no-scrollbar">
                            {tabs.map(tab => (
                                <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex-1 min-w-[80px] py-3 flex flex-col items-center justify-center gap-1 transition-colors ${activeTab === tab.id ? 'bg-slate-800 text-sky-400 border-t-4 border-sky-400' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'}`}>
                                    <Lucide icon={tab.icon} className={`w-5 h-5 ${activeTab === tab.id ? 'stroke-2' : 'stroke-1'}`} />
                                    <span className="text-[10px] font-bold uppercase tracking-wider">{tab.id}</span>
                                </button>
                            ))}
                        </div>
                        
                        <div className="flex-1 p-2 overflow-y-auto bg-slate-800 relative">
                            {scenario.recommendedActions && (
                                <div className="mb-2 p-2 bg-sky-900/20 border border-sky-600/30 rounded">
                                    <h4 className="text-[10px] font-bold text-sky-400 uppercase mb-1">Recommended Actions</h4>
                                    <div className="flex flex-wrap gap-1">
                                        {scenario.recommendedActions.map(key => (
                                            <Button key={key} onClick={() => applyIntervention(key)} variant={activeInterventions.has(key) ? "success" : "outline"} className="h-6 text-[10px] px-2">{INTERVENTIONS[key]?.label || key}</Button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {activeTab === 'Handover' ? (
                                <div className="space-y-4 p-2"><div className="bg-slate-900 p-4 rounded border border-slate-600 font-mono text-sm text-green-400 whitespace-pre-wrap">{generateSBAR()}</div><div className="flex gap-2"><Button onClick={() => speak(generateSBAR())} variant="secondary">Read Aloud</Button><Button onClick={() => navigator.clipboard.writeText(generateSBAR())} variant="outline">Copy</Button></div></div>
                            ) : activeTab === 'Voice' ? (
                                <div className="space-y-4 p-4">
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                        {["I can't breathe", "My chest hurts", "I feel sick", "My head hurts", "I'm scared", "Can I have some water?", "Yes", "No", "I don't know", "*Coughing*", "*Screaming*", "*Moaning*"].map(txt => (<Button key={txt} onClick={() => speak(mapVoice(txt))} variant="secondary" className="h-12 text-xs">{txt}</Button>))}
                                    </div>
                                    <div className="flex gap-2 pt-4 border-t border-slate-700 mt-4"><input type="text" value={customSpeech} onChange={e => setCustomSpeech(e.target.value)} placeholder="Type custom phrase..." className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 text-white" /><Button onClick={() => { speak(customSpeech); setCustomSpeech(""); }}>Speak</Button></div>
                                </div>
                            ) : activeTab === 'Drugs' ? (
                                <div className="space-y-4">
                                    {Object.keys(drugCats).map(subCat => (
                                        <div key={subCat}>
                                            <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-1 px-1">{subCat}</h4>
                                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                                {drugCats[subCat].map(key => {
                                                    const action = INTERVENTIONS[key];
                                                    if(!action) return null;
                                                    const count = interventionCounts[key] || 0;
                                                    const isActive = activeInterventions.has(key);
                                                    return (
                                                        <button key={key} onClick={() => applyIntervention(key)} className={`relative h-14 p-2 rounded text-left bg-slate-700 hover:bg-slate-600 border border-slate-600 flex flex-col justify-between overflow-hidden`}>
                                                            <span className="text-xs font-bold leading-tight">{action.label}</span>
                                                            {isActive && action.type === 'continuous' && <div className="absolute top-1 right-1 text-red-400 bg-slate-900 rounded-full p-0.5"><Lucide icon="x" className="w-3 h-3"/></div>}
                                                            {count > 0 && <span className="absolute bottom-1 right-1 bg-white text-black text-[9px] font-bold px-1.5 rounded-full">x{count}</span>}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                                    {getInterventionsByCat(activeTab).map(key => {
                                        const action = INTERVENTIONS[key];
                                        if (!action) return null;
                                        const count = interventionCounts[key] || 0;
                                        const isActive = activeInterventions.has(key);
                                        return (
                                            <button key={key} onClick={() => applyIntervention(key)} className={`relative h-14 p-2 rounded text-left bg-slate-700 hover:bg-slate-600 border border-slate-600 flex flex-col justify-between overflow-hidden`}>
                                                <span className="text-xs font-bold leading-tight">{action.label}</span>
                                                <div className="flex justify-between items-end w-full"><span className="text-[10px] opacity-70 italic truncate">{action.category}</span>{count > 0 && action.type !== 'continuous' && <span className="bg-white text-black text-[9px] font-bold px-1.5 rounded-full">x{count}</span>}</div>
                                                {isActive && action.type === 'continuous' && (<div className="absolute top-1 right-1 text-red-500 bg-black/50 rounded-full w-5 h-5 flex items-center justify-center border border-red-500 hover:bg-red-500 hover:text-white transition-colors" title="Remove"><Lucide icon="x" className="w-3 h-3" /></div>)}
                                                {activeDurations[key] && (<div className="absolute bottom-0 left-0 h-1 bg-emerald-400 transition-all duration-1000" style={{width: `${Math.max(0, 100 - ((time - activeDurations[key].startTime)/activeDurations[key].duration*100))}%`}}></div>)}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        <div className="bg-slate-900 p-2 border-t border-slate-700 flex gap-2">
                            <input type="text" className="bg-slate-800 border border-slate-600 rounded px-3 text-xs flex-1 text-white" placeholder="Search..." value={customLog} onChange={e=>setCustomLog(e.target.value)} onKeyDown={e => e.key === 'Enter' && (addLogEntry(customLog, 'manual') || setCustomLog(""))} />
                            <Button onClick={() => {sim.dispatch({type: 'TRIGGER_IMPROVE'}); addLogEntry("Patient Improving (Trend)", "success")}} className="h-8 text-xs px-2 bg-emerald-900 border border-emerald-500 text-emerald-100 relative overflow-hidden">{trends.active && flash === 'green' && (<div className="absolute inset-0 bg-emerald-500/30 z-0 transition-all duration-1000" style={{ width: `${Math.min(100, (trends.elapsed / trends.duration) * 100)}%` }}></div>)}<span className="relative z-10">Improve</span></Button>
                            <Button onClick={() => {sim.dispatch({type: 'TRIGGER_DETERIORATE'}); addLogEntry("Patient Deteriorating (Trend)", "danger")}} className="h-8 text-xs px-2 bg-red-900 border border-red-500 text-red-100 relative overflow-hidden">{trends.active && flash === 'red' && (<div className="absolute inset-0 bg-red-500/30 z-0 transition-all duration-1000" style={{ width: `${Math.min(100, (trends.elapsed / trends.duration) * 100)}%` }}></div>)}<span className="relative z-10">Worsen</span></Button>
                        </div>
                    </div>
                </div>

                {modalVital && (
                    <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn">
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-sm shadow-2xl">
                            <h3 className="text-lg font-bold text-white mb-4 uppercase tracking-wider">Control: {modalVital}</h3>
                            <div className="space-y-4">
                                <div className="flex gap-2 justify-center mb-4">
                                    {(() => {
                                        let steps = [-20, -10, 10, 20];
                                        if (['temp', 'bm', 'etco2', 'pH', 'K', 'Lac'].includes(modalVital)) steps = [-1, -0.5, 0.5, 1];
                                        if (['gcs', 'rr', 'pupils'].includes(modalVital)) steps = [-2, -1, 1, 2];
                                        if (modalVital === 'spO2') steps = [-5, -2, 2, 5];
                                        return steps.map(step => (<Button key={step} onClick={()=>quickAdjust(step)} variant="secondary" className="w-12 text-sm font-bold">{step > 0 ? `+${step}` : step}</Button>));
                                    })()}
                                </div>
                                <div><label className="text-xs text-slate-400 font-bold uppercase">Target Value</label><input type={modalVital === 'pupils' ? "text" : "number"} value={modalTarget} onChange={e=>setModalTarget(e.target.value)} className="w-full bg-slate-900 border border-slate-500 rounded p-3 text-xl font-mono text-white text-center font-bold" autoFocus /></div>
                                {modalVital === 'bp' && <div><label className="text-xs text-slate-400 font-bold uppercase">Diastolic</label><input type="number" value={modalTarget2} onChange={e=>setModalTarget2(e.target.value)} className="w-full bg-slate-900 border border-slate-500 rounded p-3 text-xl font-mono text-white text-center font-bold" /></div>}
                                <div className="grid grid-cols-4 gap-1 mt-2">
                                    <button onClick={()=>setTrendDuration(0)} className={`p-2 rounded text-[10px] font-bold border ${trendDuration===0 ? 'bg-sky-600 text-white border-sky-400' : 'bg-slate-700 text-slate-400 border-slate-600'}`}>Instant</button>
                                    <button onClick={()=>setTrendDuration(30)} className={`p-2 rounded text-[10px] font-bold border ${trendDuration===30 ? 'bg-sky-600 text-white border-sky-400' : 'bg-slate-700 text-slate-400 border-slate-600'}`}>30s</button>
                                    <button onClick={()=>setTrendDuration(120)} className={`p-2 rounded text-[10px] font-bold border ${trendDuration===120 ? 'bg-sky-600 text-white border-sky-400' : 'bg-slate-700 text-slate-400 border-slate-600'}`}>2m</button>
                                    <button onClick={()=>setTrendDuration(300)} className={`p-2 rounded text-[10px] font-bold border ${trendDuration===300 ? 'bg-sky-600 text-white border-sky-400' : 'bg-slate-700 text-slate-400 border-slate-600'}`}>5m</button>
                                </div>
                                <Button onClick={confirmVitalUpdate} variant="success" className="w-full mt-4 h-12 text-lg font-bold">CONFIRM & SEND</Button>
                                <Button onClick={()=>setModalVital(null)} variant="outline" className="w-full">Cancel</Button>
                            </div>
                        </div>
                    </div>
                )}
                {showLogModal && (
                    <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn">
                        <div className="bg-slate-800 rounded-lg border border-slate-600 w-full max-w-2xl h-[80vh] flex flex-col shadow-2xl">
                            <div className="p-4 border-b border-slate-700 flex justify-between items-center"><h3 className="text-lg font-bold text-white">Simulation Log</h3><Button onClick={()=>setShowLogModal(false)} variant="secondary" className="h-8 w-8 p-0"><Lucide icon="x" className="w-4 h-4" /></Button></div>
                            <div className="p-2 border-b border-slate-700 flex gap-2">
                                <input type="text" value={annotationText} onChange={e=>setAnnotationText(e.target.value)} placeholder="Add annotation..." className="flex-1 bg-slate-900 border border-slate-600 rounded px-2 text-white" />
                                <Button onClick={addAnnotation} variant="primary" className="h-8 text-xs">Add Note</Button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-sm">{log.map((l, i) => (<div key={i} className="flex gap-4 border-b border-slate-700/50 pb-1"><span className="text-sky-400 w-16 flex-shrink-0">{l.simTime}</span><span className={`${l.type === 'action' ? 'text-emerald-300' : l.type === 'manual' ? 'text-amber-300' : 'text-slate-300'}`}>{l.msg}</span></div>))}</div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    window.LiveSimScreen = LiveSimScreen;
})();
