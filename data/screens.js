// data/screens.js
(() => {
    const { useState, useEffect, useRef } = React;

    // --- SCREEN 1: SETUP ---
    const SetupScreen = window.SetupScreen; // Re-use existing if already loaded, but for this file replace assumes full overwrite.
    
    // --- SCREEN 4: LIVE SIM CONTROLLER ---
    const LiveSimScreen = ({ sim, onFinish, onBack, sessionID }) => {
        const { INTERVENTIONS, Button, Lucide, Card, VitalDisplay, ECGMonitor, InvestigationButton } = window;
        const { state, start, pause, stop, applyIntervention, addLogEntry, manualUpdateVital, triggerArrest, triggerROSC, revealInvestigation, nextCycle, enableAudio, speak, startTrend, toggleAudioLoop, playSound } = sim;
        const { scenario, time, cycleTimer, isRunning, vitals, prevVitals, log, flash, activeInterventions, interventionCounts, activeDurations, isMuted, rhythm, etco2Enabled, queuedRhythm, cprInProgress, nibp, audioOutput, trends, arrestPanelOpen, waveformGain, noise, remotePacerState, notification, activeLoops, investigationsRevealed, loadingInvestigations } = state;
        
        const [activeTab, setActiveTab] = useState("Common");
        const [customLog, setCustomLog] = useState("");
        const [searchResults, setSearchResults] = useState([]);
        const [showMonitorControls, setShowMonitorControls] = useState(false); // Collapsible Monitor Toggle
        const [expandArrest, setExpandArrest] = useState(false); 
        const [customSpeech, setCustomSpeech] = useState("");
        const [showLogModal, setShowLogModal] = useState(false);
        const [modalVital, setModalVital] = useState(null); 
        const [modalTarget, setModalTarget] = useState("");
        const [modalTarget2, setModalTarget2] = useState(""); 
        const [trendDuration, setTrendDuration] = useState(30);
        const [gainVal, setGainVal] = useState(waveformGain || 1.0);
        
        // Search Logic Fix
        useEffect(() => { 
            if (customLog.length > 1) { 
                const results = Object.keys(INTERVENTIONS).filter(key => (INTERVENTIONS[key].label).toLowerCase().includes(customLog.toLowerCase())); 
                setSearchResults(results); 
            } else { 
                setSearchResults([]); 
            } 
        }, [customLog]);

        const handleGhost = (btnId) => { const channel = new BroadcastChannel('sim_channel'); channel.postMessage({ type: 'GHOST_PRESS', payload: btnId }); };
        const updateGain = (e) => { const v = parseFloat(e.target.value); setGainVal(v); sim.dispatch({ type: 'SET_GAIN', payload: v }); };

        const drugCats = { "Arrest": ['AdrenalineIV', 'Amiodarone', 'Calcium', 'MagSulph', 'SodiumBicarb', 'Atropine'], "Sedation": ['Midazolam', 'Lorazepam', 'Ketamine', 'Morphine', 'Fentanyl', 'Roc', 'Sux', 'Propofol'], "Trauma": ['TXA', 'Blood', 'Fluids'], "Infusions": ['FluidInfusion', 'InsulinInfusion', 'GTNInfusion', 'Noradrenaline'], "General": ['Paracetamol', 'Ondansetron', 'Antibiotics', 'Hydrocortisone', 'Dexamethasone', 'Nebs', 'AdrenalineIM'] };
        const mapVoice = (txt) => { if (txt.includes('Cough')) return 'Cough, cough, cough'; if (txt.includes('Scream')) return 'Ahhhhh! Help me!'; if (txt.includes('Moan')) return 'Ohhhhhh...'; return txt.replace(/\*/g, ''); };
        
        const getInterventionsByCat = (cat) => {
            if (cat === 'Handover' || cat === 'Voice' || cat === 'Investigations') return [];
            let keys = [];
            if (cat === 'Common') keys = ['Obs', 'Oxygen', 'IV Access', 'Fluids', 'Analgesia', 'Antiemetic', 'Antibiotics', 'Nebs', 'AdrenalineIM', 'Blood', 'TXA', 'ArtLine']; 
            else if (cat === 'Drugs') keys = Object.keys(INTERVENTIONS).filter(key => INTERVENTIONS[key].category === 'Drugs'); 
            else keys = Object.keys(INTERVENTIONS).filter(key => INTERVENTIONS[key].category === cat);
            return keys.sort((a, b) => INTERVENTIONS[a].label.localeCompare(INTERVENTIONS[b].label));
        };
        
        const formatTime = (s) => `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
        const toggleCPR = () => { sim.dispatch({ type: 'TOGGLE_CPR', payload: !cprInProgress }); addLogEntry(!cprInProgress ? 'CPR Started' : 'CPR Stopped', 'action'); };
        const handleShock = () => { applyIntervention('Defib'); if (!cprInProgress) toggleCPR(); };
        const generateSBAR = () => `S: ${scenario.title}.\nB: ${scenario.patientProfileTemplate.replace('{age}', scenario.patientAge)}.\nA: HR ${vitals.hr}, BP ${vitals.bpSys}/${vitals.bpDia}, SpO2 ${vitals.spO2}%.\nR: Review.`;
        const openVitalControl = (key) => { setModalVital(key); setModalTarget(vitals[key === 'bp' ? 'bpSys' : key]); if (key === 'bp') setModalTarget2(vitals.bpDia); setTrendDuration(30); };
        const quickAdjust = (amt) => { let current = parseFloat(modalTarget) || 0; setModalTarget(current + amt); if (modalVital === 'bp') { let currentDia = parseFloat(modalTarget2) || 0; setModalTarget2(currentDia + (amt * 0.6)); } };
        const confirmVitalUpdate = () => { const targets = {}; if (modalVital === 'bp') { targets.bpSys = parseFloat(modalTarget); targets.bpDia = parseFloat(modalTarget2); } else { targets[modalVital] = (modalVital === 'pupils' || modalVital === 'gcs') ? modalTarget : parseFloat(modalTarget); } if (trendDuration === 0) { Object.keys(targets).forEach(k => manualUpdateVital(k, targets[k])); } else { startTrend(targets, trendDuration); } setModalVital(null); };
        const [annotationText, setAnnotationText] = useState("");
        const addAnnotation = () => { if(annotationText) { addLogEntry(`[NOTE] ${annotationText}`, 'manual'); setAnnotationText(""); } };

        return (
            <div className={`h-full overflow-hidden flex flex-col p-2 bg-slate-900 relative ${flash === 'red' ? 'flash-red' : (flash === 'green' ? 'flash-green' : '')}`}>
                
                {/* --- HEADER --- */}
                <div className="flex justify-between items-center bg-slate-800 p-2 rounded mb-2 border border-slate-700">
                    <div className="flex gap-2 items-center">
                        <Button variant="secondary" onClick={onBack} className="h-8 px-2"><Lucide icon="arrow-left"/> Back</Button>
                        {!isRunning ? ( <Button variant="success" onClick={start} className="h-8 px-4 font-bold"><Lucide icon="play"/> START</Button> ) : ( <Button variant="warning" onClick={pause} className="h-8 px-4"><Lucide icon="pause"/> PAUSE</Button> )}
                        <Button variant="danger" onClick={() => { if(window.confirm("End scenario and go to debrief?")) onFinish(); }} className="h-8 px-4 font-bold border border-red-500 bg-red-900/50 hover:bg-red-800"><Lucide icon="square" className="fill-current"/> FINISH</Button>
                        <div className="h-8 w-px bg-slate-600 mx-1"></div>
                        <Button onClick={() => sim.dispatch({ type: 'SET_MUTED', payload: !isMuted })} variant={isMuted ? "danger" : "secondary"} className="h-8 px-2"><Lucide icon={isMuted ? "volume-x" : "volume-2"} /></Button>
                    </div>
                    <div className="hidden md:flex flex-col ml-4 px-3 border-l border-slate-600"><span className="text-[10px] text-slate-400 uppercase font-bold">Patient</span><span className="text-white font-bold">{scenario.patientAge}y {scenario.sex}</span></div>
                </div>

                <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-2 overflow-hidden min-h-0">
                    <div className="lg:col-span-4 flex flex-col gap-2 overflow-y-auto">
                        <Card className="bg-black border-slate-800 flex-shrink-0">
                             <ECGMonitor rhythmType={rhythm} hr={vitals.hr} rr={vitals.rr} spO2={vitals.spO2} isPaused={!isRunning} showEtco2={etco2Enabled} pathology={scenario?.deterioration?.type} showTraces={activeInterventions.has('Obs')} showArt={activeInterventions.has('ArtLine')} isCPR={cprInProgress} className="h-32"/>
                             <div className="grid grid-cols-4 gap-1 p-1 bg-black">
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
                        </Card>
                        
                        {/* --- COLLAPSIBLE MONITOR CONTROLS --- */}
                        <div className="bg-slate-800 rounded border border-slate-600">
                            <button onClick={() => setShowMonitorControls(!showMonitorControls)} className="w-full p-2 flex justify-between items-center bg-slate-700 hover:bg-slate-600 text-xs font-bold text-white transition-colors">
                                <span>Monitor Controls (ECG / Pacing)</span>
                                <Lucide icon={showMonitorControls ? "chevron-up" : "chevron-down"} className="w-4 h-4"/>
                            </button>
                            
                            {showMonitorControls && (
                                <div className="p-2 space-y-2 border-t border-slate-600 animate-fadeIn">
                                    {/* Waveform Controls */}
                                    <div className="p-2 bg-slate-900/50 rounded border border-slate-700">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-[10px] text-slate-400">Gain: {gainVal}x</span>
                                            <input type="range" min="0.5" max="2.0" step="0.1" value={gainVal} onChange={updateGain} className="flex-1 h-2 bg-slate-600 rounded-lg appearance-none cursor-pointer" />
                                        </div>
                                        <label className="flex items-center gap-2 text-[10px] cursor-pointer text-slate-300">
                                            <input type="checkbox" checked={noise?.interference || false} onChange={() => sim.dispatch({ type: 'TOGGLE_INTERFERENCE' })} className="rounded bg-slate-700" />
                                            60Hz Interference
                                        </label>
                                    </div>

                                    {/* Rhythm Selection */}
                                    <div className="p-2 bg-slate-900/50 rounded border border-slate-700">
                                        <div className="grid grid-cols-2 gap-1 mb-2">
                                            <Button onClick={() => setExpandArrest(!expandArrest)} variant="danger" className="h-8 text-xs w-full">Arrest...</Button>
                                            <Button onClick={triggerROSC} variant="success" className="h-8 text-xs">ROSC</Button>
                                        </div>
                                        {expandArrest && (
                                            <div className="grid grid-cols-2 gap-1 mb-2">
                                                {['VF', 'PEA', 'pVT', 'Asystole'].map(t => <button key={t} onClick={() => { triggerArrest(t); setExpandArrest(false); }} className="bg-red-900/50 hover:bg-red-800 text-white text-[10px] py-1 rounded border border-red-700">{t}</button>)}
                                            </div>
                                        )}
                                        <select className="w-full bg-slate-800 border border-slate-600 text-white text-xs p-1 rounded" value={rhythm} onChange={(e) => sim.dispatch({type: 'UPDATE_RHYTHM', payload: e.target.value})}>
                                            {['Sinus Rhythm', 'Sinus Tachycardia', 'Sinus Bradycardia', 'AF', 'SVT', 'VT', 'VF', 'Asystole', 'PEA', '1st Deg Block', '3rd Deg Block'].map(r => <option key={r} value={r}>{r}</option>)}
                                        </select>
                                    </div>

                                    {/* Pacing Info */}
                                    <div className="p-2 bg-slate-900/50 rounded border border-slate-700 flex justify-between items-center">
                                        <span className="text-[10px] text-slate-400 font-bold uppercase">Pacer Status</span>
                                        <div className="text-right">
                                            <div className="text-xs text-green-400 font-mono">{remotePacerState?.rate || 0} ppm</div>
                                            <div className="text-[10px] text-slate-500">{remotePacerState?.output || 0} mA</div>
                                        </div>
                                    </div>
                                    
                                    {/* Ghost Controls */}
                                    <div className="grid grid-cols-4 gap-1">
                                        <button onClick={() => handleGhost('chargeBtn')} className="bg-slate-700 text-[9px] text-white py-1 rounded">Chg</button>
                                        <button onClick={() => handleGhost('shockBtn')} className="bg-slate-700 text-[9px] text-white py-1 rounded">Shk</button>
                                        <button onClick={() => handleGhost('syncBtn')} className="bg-slate-700 text-[9px] text-white py-1 rounded">Sync</button>
                                        <button onClick={() => handleGhost('analyseBtn')} className="bg-slate-700 text-[9px] text-white py-1 rounded">Alz</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                    
                    <div className="lg:col-span-8 flex flex-col bg-slate-800 rounded border border-slate-700 overflow-hidden">
                        <div className="flex overflow-x-auto bg-slate-900 border-b border-slate-700 no-scrollbar">
                            {['Common', 'Investigations', 'Airway', 'Breathing', 'Circulation', 'Drugs', 'Procedures', 'Voice', 'Handover'].map(cat => (
                                <button key={cat} onClick={() => setActiveTab(cat)} className={`px-4 py-3 text-xs font-bold uppercase tracking-wider transition-colors whitespace-nowrap ${activeTab === cat ? 'bg-slate-800 text-sky-400 border-t-2 border-sky-400' : 'text-slate-500 hover:text-slate-300'}`}>{cat}</button>
                            ))}
                        </div>
                        
                        <div className="flex-1 p-2 overflow-y-auto bg-slate-800 relative">
                            {scenario.recommendedActions && (
                                <div className="mb-2 p-2 bg-sky-900/20 border border-sky-600/30 rounded flex flex-wrap gap-1">
                                    {scenario.recommendedActions.map(key => (
                                        <Button key={key} onClick={() => applyIntervention(key)} variant={activeInterventions.has(key) ? "success" : "outline"} className="h-6 text-[10px] px-2">{INTERVENTIONS[key]?.label || key}</Button>
                                    ))}
                                </div>
                            )}

                            {activeTab === 'Investigations' ? (
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                    <InvestigationButton type="VBG" icon="test-tube" label="VBG" isRevealed={investigationsRevealed['VBG']} isLoading={loadingInvestigations['VBG']} revealInvestigation={revealInvestigation} isRunning={isRunning} scenario={scenario} />
                                    <InvestigationButton type="ECG" icon="activity" label="12-Lead ECG" isRevealed={investigationsRevealed['ECG']} isLoading={loadingInvestigations['ECG']} revealInvestigation={revealInvestigation} isRunning={isRunning} scenario={scenario} />
                                    <InvestigationButton type="X-ray" icon="file-image" label="Chest X-Ray" isRevealed={investigationsRevealed['X-ray']} isLoading={loadingInvestigations['X-ray']} revealInvestigation={revealInvestigation} isRunning={isRunning} scenario={scenario} />
                                    <InvestigationButton type="CT" icon="scan" label="CT Scan" isRevealed={investigationsRevealed['CT']} isLoading={loadingInvestigations['CT']} revealInvestigation={revealInvestigation} isRunning={isRunning} scenario={scenario} />
                                    <InvestigationButton type="Urine" icon="droplet" label="Urinalysis" isRevealed={investigationsRevealed['Urine']} isLoading={loadingInvestigations['Urine']} revealInvestigation={revealInvestigation} isRunning={isRunning} scenario={scenario} />
                                    <InvestigationButton type="POCUS" icon="wifi" label="POCUS" isRevealed={investigationsRevealed['POCUS']} isLoading={loadingInvestigations['POCUS']} revealInvestigation={revealInvestigation} isRunning={isRunning} scenario={scenario} />
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
                                                    return (
                                                        <button key={key} onClick={() => applyIntervention(key)} className={`relative h-14 p-2 rounded text-left bg-slate-700 hover:bg-slate-600 border border-slate-600 flex flex-col justify-between overflow-hidden`}>
                                                            <span className="text-xs font-bold leading-tight">{action.label}</span>
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
                                                {isActive && action.type === 'continuous' && (
                                                    <div className="absolute top-1 right-1 text-red-500 bg-black/50 rounded-full w-5 h-5 flex items-center justify-center border border-red-500 hover:bg-red-500 hover:text-white transition-colors" title="Remove">
                                                        <Lucide icon="x" className="w-3 h-3" />
                                                    </div>
                                                )}
                                                {activeDurations[key] && (<div className="absolute bottom-0 left-0 h-1 bg-emerald-400 transition-all duration-1000" style={{width: `${Math.max(0, 100 - ((time - activeDurations[key].startTime)/activeDurations[key].duration*100))}%`}}></div>)}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        
                        {/* Search Bar - Fixed Logic */}
                        <div className="bg-slate-900 p-2 border-t border-slate-700 flex gap-2 relative">
                            <div className="flex-1 relative">
                                <input type="text" className="w-full bg-slate-800 border border-slate-600 rounded px-3 h-8 text-xs text-white" placeholder="Search interventions..." value={customLog} onChange={e=>setCustomLog(e.target.value)} />
                                {searchResults.length > 0 && (
                                    <div className="absolute bottom-full mb-1 left-0 w-full bg-slate-800 border border-slate-600 rounded max-h-48 overflow-y-auto shadow-2xl z-50">
                                        {searchResults.map(key => (
                                            <button key={key} onClick={() => { applyIntervention(key); setCustomLog(""); setSearchResults([]); }} className="w-full text-left px-3 py-2 text-xs text-white hover:bg-slate-700 border-b border-slate-700">
                                                {INTERVENTIONS[key].label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <Button onClick={() => {sim.dispatch({type: 'TRIGGER_IMPROVE'}); addLogEntry("Patient Improving (Trend)", "success")}} className="h-8 text-xs px-2 bg-emerald-900 border border-emerald-500 text-emerald-100">Improve</Button>
                            <Button onClick={() => {sim.dispatch({type: 'TRIGGER_DETERIORATE'}); addLogEntry("Patient Deteriorating (Trend)", "danger")}} className="h-8 text-xs px-2 bg-red-900 border border-red-500 text-red-100">Worsen</Button>
                        </div>
                    </div>
                </div>

                {modalVital && (
                    <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn">
                        <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-sm shadow-2xl">
                            <h3 className="text-lg font-bold text-white mb-4 uppercase tracking-wider">Control: {modalVital}</h3>
                            <div className="space-y-4">
                                <div className="flex gap-2 justify-center mb-4">
                                    {[-10, -5, 5, 10].map(step => (
                                        <Button key={step} onClick={()=>quickAdjust(step)} variant="secondary" className="w-12 text-sm font-bold">{step > 0 ? `+${step}` : step}</Button>
                                    ))}
                                </div>
                                <div><input type={modalVital === 'pupils' ? "text" : "number"} value={modalTarget} onChange={e=>setModalTarget(e.target.value)} className="w-full bg-slate-900 border border-slate-500 rounded p-3 text-xl font-mono text-white text-center font-bold" autoFocus /></div>
                                {modalVital === 'bp' && <div><input type="number" value={modalTarget2} onChange={e=>setModalTarget2(e.target.value)} className="w-full bg-slate-900 border border-slate-500 rounded p-3 text-xl font-mono text-white text-center font-bold mt-2" placeholder="Diastolic" /></div>}
                                <Button onClick={confirmVitalUpdate} variant="success" className="w-full mt-4 h-12 text-lg font-bold">CONFIRM & SEND</Button>
                                <Button onClick={()=>setModalVital(null)} variant="outline" className="w-full">Cancel</Button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    // --- SCREEN 6: DEBRIEF (UPDATED GRAPH) ---
    const DebriefScreen = ({ sim, onRestart }) => {
        const { Button, Lucide, Card } = window;
        const { state } = sim; const { log, scenario, history, completedObjectives } = state; const chartRef = useRef(null);
        
        useEffect(() => { 
            if (!chartRef.current || !history.length) return; 
            if (!window.Chart) return;
            const ctx = chartRef.current.getContext('2d'); 
            if (window.myChart) window.myChart.destroy(); 
            
            // Prepare Data
            const vitalData = {
                hr: history.map(h => ({x: h.time, y: h.hr})),
                bp: history.map(h => ({x: h.time, y: h.bp})),
                spo2: history.map(h => ({x: h.time, y: h.spo2})),
                etco2: history.map(h => ({x: h.time, y: h.etco2})),
                rr: history.map(h => ({x: h.time, y: h.rr}))
            };
            
            const interventionData = log
                .filter(l => l.type === 'action' || l.type === 'manual')
                .map(l => ({ x: l.timeSeconds, y: 10, label: l.msg })); 

            window.myChart = new window.Chart(ctx, { 
                type: 'line', 
                data: { 
                    datasets: [ 
                        { label: 'HR', data: vitalData.hr, borderColor: '#ef4444', borderWidth: 2, pointRadius: 0, tension: 0.1, yAxisID: 'y' }, 
                        { label: 'Sys BP', data: vitalData.bp, borderColor: '#3b82f6', borderWidth: 2, pointRadius: 0, tension: 0.1, yAxisID: 'y' },
                        { label: 'SpO2', data: vitalData.spo2, borderColor: '#22d3ee', borderWidth: 2, pointRadius: 0, tension: 0.1, yAxisID: 'y' },
                        { label: 'RR', data: vitalData.rr, borderColor: '#facc15', borderWidth: 2, pointRadius: 0, tension: 0.1, yAxisID: 'y1' },
                        { label: 'ETCO2', data: vitalData.etco2, borderColor: '#fbbf24', borderWidth: 2, borderDash: [5, 5], pointRadius: 0, tension: 0.1, yAxisID: 'y1' },
                        { label: 'Interventions', data: interventionData, showLine: false, pointStyle: 'triangle', pointRadius: 6, backgroundColor: 'white', yAxisID: 'y' }
                    ] 
                }, 
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    interaction: { mode: 'nearest', intersect: false },
                    scales: { 
                        x: {
                            type: 'linear',
                            position: 'bottom',
                            ticks: {
                                callback: function(value) {
                                    return `${Math.floor(value/60).toString().padStart(2,'0')}:${(value%60).toString().padStart(2,'0')}`;
                                }
                            }
                        },
                        y: { type: 'linear', display: true, position: 'left', min: 0, max: 220 },
                        y1: { type: 'linear', display: true, position: 'right', min: 0, max: 60, grid: { drawOnChartArea: false } }
                    },
                    plugins: {
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    if (context.dataset.label === 'Interventions') {
                                        return context.raw.label;
                                    }
                                    return `${context.dataset.label}: ${context.raw.y}`;
                                }
                            }
                        }
                    }
                } 
            }); 
            return () => { if (window.myChart) window.myChart.destroy(); }; 
        }, [history]);
        
        return (
            <div className="max-w-6xl mx-auto space-y-6 animate-fadeIn p-4 h-full overflow-y-auto">
                <div className="flex justify-between bg-slate-800 p-4 rounded-lg border border-slate-700">
                    <h2 className="text-2xl font-bold text-white">Simulation Debrief</h2>
                    <div className="flex gap-2"><Button onClick={onRestart} variant="primary"><Lucide icon="rotate-ccw"/> New Sim</Button></div>
                </div>
                
                <Card title="Physiological Trends & Interventions" icon="activity">
                    <div className="bg-slate-900 p-2 rounded h-80 relative">
                        <canvas ref={chartRef}></canvas>
                    </div>
                </Card>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card title="Action Log" icon="clock">
                        <div className="space-y-1 max-h-80 overflow-y-auto font-mono text-xs p-2">
                            {log.map((l, i) => (
                                <div key={i} className="flex gap-4 border-b border-slate-700 pb-1">
                                    <span className="text-sky-400 w-12 flex-shrink-0">{l.simTime}</span>
                                    <span className={`${l.type==='action'?'text-emerald-400':l.type==='danger'?'text-red-400':'text-slate-300'}`}>{l.msg}</span>
                                </div>
                            ))}
                        </div>
                    </Card>
                    <Card title="Learning Objectives" icon="check-square">
                        <div className="p-2 space-y-2">
                            {scenario?.instructorBrief?.learningObjectives?.map((obj, i) => (
                                <div key={i} className="flex items-center gap-2 text-sm text-slate-300">
                                    <div className="w-4 h-4 border rounded border-slate-500 bg-slate-800"></div>
                                    <span>{obj}</span>
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>
            </div>
        );
    };

    const LiveSimContainer = ({ sim, view, setView, resumeData, onRestart, sessionID }) => { 
        const { state, stop, reset } = sim; const { scenario } = state; 
        useEffect(() => { if (view === 'resume' && resumeData) { sim.dispatch({ type: 'RESTORE_SESSION', payload: resumeData }); } else if (!scenario) { setView('setup'); } }, []); 
        if (!scenario) return <div className="flex flex-col items-center justify-center h-full text-slate-400">Loading...</div>; 
        if (view === 'live' || view === 'resume') return <LiveSimScreen sim={sim} onFinish={() => { stop(); setView('debrief'); }} onBack={() => setView('briefing')} sessionID={sessionID} />; 
        if (view === 'debrief') return <DebriefScreen sim={sim} onRestart={() => { reset(); setView('setup'); }} />; 
        return null; 
    };
    window.LiveSimContainer = LiveSimContainer;
    window.LiveSimScreen = LiveSimScreen;
    window.DebriefScreen = DebriefScreen;

})();
