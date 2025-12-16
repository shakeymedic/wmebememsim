// data/screens/livesim.js
(() => {
    const { useState, useEffect, useRef } = React;

    const VitalControl = ({ label, value, value2, onChange, step = 1, min = 0, max = 300 }) => {
        const { Button, Lucide } = window;
        return (
            <div className="flex flex-col gap-1 p-2 bg-slate-800 rounded border border-slate-700">
                <div className="text-xs text-slate-400 font-bold uppercase">{label}</div>
                <div className="flex items-center gap-2">
                    <Button variant="secondary" className="px-2 py-1 h-8" onClick={() => onChange(Math.max(min, value - step))}><Lucide icon="minus" className="w-4 h-4" /></Button>
                    <div className="flex-1 text-center font-mono text-xl font-bold">{value}{value2 !== undefined ? `/${value2}` : ''}</div>
                    <Button variant="secondary" className="px-2 py-1 h-8" onClick={() => onChange(Math.min(max, value + step))}><Lucide icon="plus" className="w-4 h-4" /></Button>
                </div>
                <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(parseInt(e.target.value))} className="w-full accent-sky-500" />
            </div>
        );
    };

    const LiveSimScreen = ({ sim, onFinish, onBack, sessionID }) => {
        const { state, updateVital, dispatch, stop, start, togglePause } = sim;
        const { vitals, rhythm, etco2Enabled, cprInProgress, arrestPanelOpen, cycleTimer, noise, isRunning, scenario } = state;
        const { VitalDisplay, Button, Lucide, Card, ECGMonitor, InvestigationButton } = window;

        const [selectedVital, setSelectedVital] = useState(null);
        const [activeTab, setActiveTab] = useState('overview'); 

        const handleShock = () => {
            dispatch({ type: 'SHOCK_DELIVERED', energy: 200 });
        };

        return (
            <div className="h-full flex flex-col bg-slate-900">
                {/* HEADER */}
                <div className="bg-slate-800 p-2 border-b border-slate-700 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-4">
                        <Button variant="secondary" onClick={onBack}><Lucide icon="arrow-left" /> Back</Button>
                        <div className="flex flex-col">
                            <span className="font-bold text-white text-lg">{scenario ? scenario.title : "Free Mode"}</span>
                            <span className="text-xs text-slate-400 font-mono">ID: {sessionID}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="font-mono text-xl text-sky-400 bg-slate-900 px-3 py-1 rounded border border-slate-700">
                            {Math.floor(state.time / 60)}:{(state.time % 60).toString().padStart(2, '0')}
                        </div>
                        <Button variant={isRunning ? "warning" : "success"} onClick={togglePause}>
                            <Lucide icon={isRunning ? "pause" : "play"} /> {isRunning ? "Pause" : "Resume"}
                        </Button>
                        <Button variant="danger" onClick={onFinish}><Lucide icon="square" /> End</Button>
                    </div>
                </div>

                {/* MAIN CONTENT */}
                <div className="flex-grow flex overflow-hidden">
                    
                    {/* LEFT COLUMN: MONITOR PREVIEW & VITALS */}
                    <div className="w-1/3 flex flex-col border-r border-slate-800 bg-black/20 p-2 gap-2 overflow-y-auto">
                        
                        {/* MINI MONITOR STACK */}
                        <div className="bg-black rounded border border-slate-700 overflow-hidden flex flex-col h-48 shrink-0">
                            <div className="flex-1 relative border-b border-slate-800/50">
                                <ECGMonitor rhythmType={rhythm} hr={vitals.hr} isCPR={cprInProgress} showTraces={true} className="w-full h-full" color="#39ff14" speed={1.2} />
                            </div>
                            <div className="h-1/3 relative">
                                <ECGMonitor rhythmType="sinus" hr={vitals.hr} isCPR={cprInProgress} showTraces={vitals.spO2 > 0} className="w-full h-full" color="#22d3ee" speed={1.2} flatline={vitals.spO2 === 0} />
                            </div>
                        </div>

                        {/* VITAL TILES */}
                        <div className="grid grid-cols-2 gap-2">
                            <VitalDisplay label="HR" value={vitals.hr} unit="bpm" onClick={() => setSelectedVital('HR')} alert={vitals.hr < 40} />
                            <VitalDisplay label="SpO2" value={vitals.spO2} unit="%" onClick={() => setSelectedVital('SpO2')} alert={vitals.spO2 < 90} />
                            <VitalDisplay label="BP" value={vitals.bpSys} value2={vitals.bpDia} unit="mmHg" onClick={() => setSelectedVital('BP')} alert={vitals.bpSys < 90} />
                            <VitalDisplay label="RR" value={vitals.rr} unit="rpm" onClick={() => setSelectedVital('RR')} alert={vitals.rr > 30} />
                            <VitalDisplay label="ETCO2" value={etco2Enabled ? vitals.etco2 : '--'} unit="kPa" onClick={() => setSelectedVital('ETCO2')} />
                            <VitalDisplay label="TEMP" value={vitals.temp} unit="°C" onClick={() => setSelectedVital('TEMP')} />
                            <VitalDisplay label="GLUCOSE" value={vitals.glucose} unit="mmol/L" onClick={() => setSelectedVital('GLUCOSE')} isText={false} />
                        </div>

                        {/* RHYTHM SELECTOR */}
                        <Card title="Rhythm" icon="activity" className="mt-2" collapsible={true}>
                            <div className="grid grid-cols-2 gap-2">
                                {['NSR', 'Sinus Tach', 'Sinus Brady', 'AFib', 'AFlutter', 'SVT', 'VT', 'VF', 'Asystole', 'PEA'].map(r => (
                                    <button key={r} onClick={() => dispatch({ type: 'SET_RHYTHM', payload: r })} className={`px-2 py-1 text-xs rounded border ${rhythm === r ? 'bg-sky-600 text-white border-sky-400' : 'bg-slate-700 text-slate-300 border-slate-600 hover:bg-slate-600'}`}>
                                        {r}
                                    </button>
                                ))}
                            </div>
                        </Card>
                    </div>

                    {/* CENTER COLUMN: CONTROLS */}
                    <div className="w-1/3 flex flex-col p-2 gap-2 border-r border-slate-800 overflow-y-auto">
                        {/* VITAL EDITOR */}
                        {selectedVital ? (
                            <Card title={`Adjust ${selectedVital}`} icon="sliders" className="border-sky-500">
                                {selectedVital === 'BP' ? (
                                    <div className="flex flex-col gap-2">
                                        <VitalControl label="Systolic" value={vitals.bpSys} onChange={(v) => updateVital('bpSys', v)} min={0} max={300} />
                                        <VitalControl label="Diastolic" value={vitals.bpDia} onChange={(v) => updateVital('bpDia', v)} min={0} max={200} />
                                    </div>
                                ) : (
                                    <VitalControl 
                                        label={selectedVital} 
                                        value={vitals[selectedVital === 'HR' ? 'hr' : selectedVital === 'SpO2' ? 'spO2' : selectedVital === 'RR' ? 'rr' : selectedVital === 'ETCO2' ? 'etco2' : selectedVital === 'TEMP' ? 'temp' : 'glucose']} 
                                        onChange={(v) => updateVital(selectedVital === 'HR' ? 'hr' : selectedVital === 'SpO2' ? 'spO2' : selectedVital === 'RR' ? 'rr' : selectedVital === 'ETCO2' ? 'etco2' : selectedVital === 'TEMP' ? 'temp' : 'glucose', v)} 
                                        min={0} max={selectedVital === 'TEMP' ? 45 : 200} step={selectedVital === 'TEMP' ? 0.1 : 1}
                                    />
                                )}
                                <Button className="mt-2 w-full" variant="secondary" onClick={() => setSelectedVital(null)}>Close Control</Button>
                            </Card>
                        ) : (
                            <div className="p-4 text-center text-slate-500 italic border border-dashed border-slate-700 rounded">Select a vital to adjust</div>
                        )}

                        {/* ARREST PANEL */}
                        <Card title="Cardiac Arrest" icon="zap" className={arrestPanelOpen ? "border-red-500" : ""}>
                            <div className="flex flex-col gap-2">
                                <Button variant={arrestPanelOpen ? "danger" : "secondary"} onClick={() => dispatch({ type: 'TOGGLE_ARREST_PANEL' })}>{arrestPanelOpen ? "Close Protocol" : "Open Protocol"}</Button>
                                {arrestPanelOpen && (
                                    <>
                                        <div className="flex gap-2">
                                            <Button className="flex-1 h-16 text-lg" variant={cprInProgress ? "warning" : "primary"} onClick={() => dispatch({ type: 'TOGGLE_CPR' })}>{cprInProgress ? "STOP CPR" : "START CPR"}</Button>
                                            <Button className="flex-1 h-16 text-lg" variant="danger" onClick={handleShock}><Lucide icon="zap" /> SHOCK</Button>
                                        </div>
                                        <div className="flex justify-between items-center bg-slate-900 p-2 rounded">
                                            <span className="text-slate-400 text-xs uppercase">Cycle Timer</span>
                                            <span className="font-mono text-2xl font-bold">{Math.floor(cycleTimer / 60)}:{(cycleTimer % 60).toString().padStart(2, '0')}</span>
                                            <Button size="sm" variant="secondary" onClick={() => dispatch({ type: 'RESET_CYCLE' })}><Lucide icon="refresh-cw" className="w-3 h-3" /></Button>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <Button variant="outline" onClick={() => dispatch({ type: 'LOG_ACTION', payload: 'Adrenaline 1mg' })}>Adrenaline</Button>
                                            <Button variant="outline" onClick={() => dispatch({ type: 'LOG_ACTION', payload: 'Amiodarone 300mg' })}>Amiodarone</Button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </Card>
                    </div>

                    {/* RIGHT COLUMN: LOGS & ACTIONS */}
                    <div className="w-1/3 flex flex-col p-2 bg-slate-900 overflow-hidden">
                        <div className="flex gap-1 mb-2">
                            <Button className={`flex-1 ${activeTab==='actions'?'bg-sky-600':''}`} onClick={()=>setActiveTab('actions')}>Actions</Button>
                            <Button className={`flex-1 ${activeTab==='logs'?'bg-sky-600':''}`} onClick={()=>setActiveTab('logs')}>Log</Button>
                        </div>
                        
                        <div className="flex-grow overflow-y-auto bg-slate-800 rounded border border-slate-700 p-2">
                            {activeTab === 'logs' ? (
                                <div className="flex flex-col gap-1">
                                    {state.logs.map((log, i) => (
                                        <div key={i} className={`text-xs p-1 border-b border-slate-700 font-mono ${log.type === 'danger' ? 'text-red-400' : 'text-slate-300'}`}>
                                            <span className="opacity-50 mr-2">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                                            {log.message}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 gap-2">
                                    {/* Action Buttons based on scenario */}
                                     <Button variant="outline" onClick={() => dispatch({ type: 'LOG_ACTION', payload: 'IV Access' })}>IV Access</Button>
                                     <Button variant="outline" onClick={() => dispatch({ type: 'LOG_ACTION', payload: 'O2 15L NRB' })}>Oxygen 15L</Button>
                                     <Button variant="outline" onClick={() => dispatch({ type: 'LOG_ACTION', payload: 'Fluids 500ml' })}>Fluids</Button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    window.LiveSimScreen = LiveSimScreen;
})();
