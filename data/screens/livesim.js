// data/screens/livesim.js - Live Simulation Controller Screen
// Full implementation with investigation sending, NIBP control, intervention search

window.LiveSimScreen = ({ sim, onEnd, onRestart, sessionID }) => {
    const { useState, useEffect, useRef, useMemo } = React;
    const { state, dispatch, applyIntervention, setGoalVitals, sendInvestigation, triggerNIBP } = sim;
    const { scenario, vitals, interventionsApplied, elapsedTime, isPaused, isFinished, notifications } = state;

    // Local UI state
    const [activeTab, setActiveTab] = useState('actions');
    const [searchTerm, setSearchTerm] = useState('');
    const [showGoalModal, setShowGoalModal] = useState(false);
    const [showInvestigationModal, setShowInvestigationModal] = useState(false);
    const [selectedInvestigation, setSelectedInvestigation] = useState(null);
    const [customInvestigationText, setCustomInvestigationText] = useState('');
    const [goalVitalsForm, setGoalVitalsForm] = useState({ hr: '', bp: '', spo2: '', rr: '', temp: '', etco2: '', duration: 60 });
    const [showDefib, setShowDefib] = useState(false);
    const [expandedCategories, setExpandedCategories] = useState({ Airway: true, Breathing: true, Circulation: true, Drugs: true, Procedures: true });

    // Get interventions from window
    const ALL_INTERVENTIONS = window.ALL_INTERVENTIONS || [];
    const INVESTIGATION_PRESETS = window.INVESTIGATION_PRESETS || {};

    // Format time helper
    const formatTime = (seconds) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    // Filter interventions based on search
    const filteredInterventions = useMemo(() => {
        if (!searchTerm.trim()) return ALL_INTERVENTIONS;
        const term = searchTerm.toLowerCase();
        return ALL_INTERVENTIONS.filter(i => 
            i.label.toLowerCase().includes(term) || 
            i.category.toLowerCase().includes(term) ||
            (i.tags && i.tags.some(t => t.toLowerCase().includes(term)))
        );
    }, [searchTerm, ALL_INTERVENTIONS]);

    // Group interventions by category
    const groupedInterventions = useMemo(() => {
        const groups = {};
        filteredInterventions.forEach(intervention => {
            const cat = intervention.category || 'Other';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(intervention);
        });
        return groups;
    }, [filteredInterventions]);

    // Get recommended actions
    const recommendedActions = useMemo(() => {
        if (!scenario?.recommendedActions) return [];
        return scenario.recommendedActions.filter(actionId => {
            const intervention = ALL_INTERVENTIONS.find(i => i.id === actionId);
            if (!intervention) return false;
            // Filter by search if active
            if (searchTerm.trim()) {
                const term = searchTerm.toLowerCase();
                return intervention.label.toLowerCase().includes(term) || 
                       intervention.category.toLowerCase().includes(term);
            }
            return true;
        }).map(actionId => ALL_INTERVENTIONS.find(i => i.id === actionId));
    }, [scenario, searchTerm, ALL_INTERVENTIONS]);

    // Handle applying intervention
    const handleApplyIntervention = (intervention) => {
        applyIntervention(intervention);
    };

    // Handle goal vitals submission
    const handleSetGoalVitals = () => {
        const goals = {};
        if (goalVitalsForm.hr) goals.hr = parseInt(goalVitalsForm.hr);
        if (goalVitalsForm.bp) {
            const parts = goalVitalsForm.bp.split('/');
            if (parts.length === 2) {
                goals.bpSys = parseInt(parts[0]);
                goals.bpDia = parseInt(parts[1]);
            }
        }
        if (goalVitalsForm.spo2) goals.spo2 = parseInt(goalVitalsForm.spo2);
        if (goalVitalsForm.rr) goals.rr = parseInt(goalVitalsForm.rr);
        if (goalVitalsForm.temp) goals.temp = parseFloat(goalVitalsForm.temp);
        if (goalVitalsForm.etco2) goals.etco2 = parseFloat(goalVitalsForm.etco2);

        if (Object.keys(goals).length > 0) {
            setGoalVitals(goals, parseInt(goalVitalsForm.duration) || 60);
        }
        setShowGoalModal(false);
        setGoalVitalsForm({ hr: '', bp: '', spo2: '', rr: '', temp: '', etco2: '', duration: 60 });
    };

    // Handle sending investigation result
    const handleSendInvestigation = (title, content) => {
        sendInvestigation(title, content);
        setShowInvestigationModal(false);
        setSelectedInvestigation(null);
        setCustomInvestigationText('');
    };

    // Handle NIBP trigger
    const handleTriggerNIBP = () => {
        triggerNIBP();
    };

    // Toggle WETFLAG visibility
    const handleToggleWetflag = () => {
        dispatch({ type: 'TOGGLE_WETFLAG' });
    };

    // Toggle timer on monitor
    const handleToggleTimer = () => {
        dispatch({ type: 'TOGGLE_TIMER_ON_MONITOR' });
    };

    // Close investigation on monitor
    const handleCloseInvestigation = () => {
        dispatch({ type: 'CLOSE_INVESTIGATION' });
    };

    // Toggle defib panel
    const handleToggleDefib = () => {
        setShowDefib(!showDefib);
        dispatch({ type: 'SET_ARREST_PANEL', payload: !showDefib });
    };

    // Investigation types for dropdown
    const investigationTypes = [
        { id: 'ct_head', label: 'CT Head', presets: INVESTIGATION_PRESETS.CT_HEAD || [] },
        { id: 'ct_chest', label: 'CT Chest', presets: INVESTIGATION_PRESETS.CT_CHEST || [] },
        { id: 'ct_abdo', label: 'CT Abdomen/Pelvis', presets: INVESTIGATION_PRESETS.CT_ABDO || [] },
        { id: 'cxr', label: 'Chest X-Ray', presets: INVESTIGATION_PRESETS.CXR || [] },
        { id: 'ecg', label: '12-Lead ECG', presets: INVESTIGATION_PRESETS.ECG || [] },
        { id: 'vbg', label: 'VBG/ABG', presets: INVESTIGATION_PRESETS.VBG || [] },
        { id: 'bloods', label: 'Blood Results', presets: INVESTIGATION_PRESETS.BLOODS || [] },
        { id: 'urine', label: 'Urinalysis', presets: INVESTIGATION_PRESETS.URINE || [] },
        { id: 'pocus', label: 'POCUS/Echo', presets: INVESTIGATION_PRESETS.POCUS || [] },
        { id: 'custom', label: 'Free Text', presets: [] }
    ];

    // Check if scenario is paediatric
    const isPaeds = scenario && scenario.age !== undefined && scenario.age < 16;

    return (
        <div className="h-full flex flex-col bg-slate-900">
            {/* Top Bar - Vitals Summary & Controls */}
            <div className="bg-slate-800 border-b border-slate-700 p-3">
                <div className="flex items-center justify-between gap-4">
                    {/* Time */}
                    <div className="flex items-center gap-3">
                        <div className="bg-slate-900 px-4 py-2 rounded-lg border border-slate-600">
                            <span className="text-2xl font-mono font-bold text-sky-400">{formatTime(elapsedTime)}</span>
                        </div>
                        <button 
                            onClick={() => dispatch({ type: isPaused ? 'RESUME' : 'PAUSE' })}
                            className={`px-4 py-2 rounded-lg font-medium transition-colors ${isPaused ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-amber-600 hover:bg-amber-500 text-white'}`}
                        >
                            {isPaused ? 'Resume' : 'Pause'}
                        </button>
                    </div>

                    {/* Quick Vitals */}
                    <div className="flex items-center gap-4 text-sm">
                        <div className="text-center">
                            <div className="text-slate-400 text-xs">HR</div>
                            <div className="text-green-400 font-bold text-lg">{vitals?.hr || '--'}</div>
                        </div>
                        <div className="text-center">
                            <div className="text-slate-400 text-xs">BP</div>
                            <div className="text-red-400 font-bold text-lg">{vitals?.bpSys || '--'}/{vitals?.bpDia || '--'}</div>
                        </div>
                        <div className="text-center">
                            <div className="text-slate-400 text-xs">SpO₂</div>
                            <div className="text-cyan-400 font-bold text-lg">{vitals?.spo2 || '--'}%</div>
                        </div>
                        <div className="text-center">
                            <div className="text-slate-400 text-xs">RR</div>
                            <div className="text-yellow-400 font-bold text-lg">{vitals?.rr || '--'}</div>
                        </div>
                        <div className="text-center">
                            <div className="text-slate-400 text-xs">GCS</div>
                            <div className="text-purple-400 font-bold text-lg">{vitals?.gcs || '--'}</div>
                        </div>
                    </div>

                    {/* End Controls */}
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={onEnd}
                            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium transition-colors"
                        >
                            End Scenario
                        </button>
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex overflow-hidden">
                {/* Left Panel - Interventions */}
                <div className="w-2/3 border-r border-slate-700 flex flex-col overflow-hidden">
                    {/* Tabs */}
                    <div className="flex border-b border-slate-700 bg-slate-800/50">
                        <button 
                            onClick={() => setActiveTab('actions')}
                            className={`flex-1 px-4 py-3 font-medium transition-colors ${activeTab === 'actions' ? 'text-sky-400 border-b-2 border-sky-400 bg-slate-800' : 'text-slate-400 hover:text-white'}`}
                        >
                            Interventions
                        </button>
                        <button 
                            onClick={() => setActiveTab('investigations')}
                            className={`flex-1 px-4 py-3 font-medium transition-colors ${activeTab === 'investigations' ? 'text-sky-400 border-b-2 border-sky-400 bg-slate-800' : 'text-slate-400 hover:text-white'}`}
                        >
                            Investigations
                        </button>
                        <button 
                            onClick={() => setActiveTab('controls')}
                            className={`flex-1 px-4 py-3 font-medium transition-colors ${activeTab === 'controls' ? 'text-sky-400 border-b-2 border-sky-400 bg-slate-800' : 'text-slate-400 hover:text-white'}`}
                        >
                            Monitor Controls
                        </button>
                    </div>

                    {/* Tab Content */}
                    <div className="flex-1 overflow-y-auto p-4">
                        {activeTab === 'actions' && (
                            <div className="space-y-4">
                                {/* Search Bar */}
                                <div className="relative">
                                    <input
                                        type="text"
                                        placeholder="Search interventions..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="w-full px-4 py-3 pl-10 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:border-sky-500"
                                    />
                                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                    </svg>
                                    {searchTerm && (
                                        <button 
                                            onClick={() => setSearchTerm('')}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                                        >
                                            ✕
                                        </button>
                                    )}
                                </div>

                                {/* Recommended Actions */}
                                {recommendedActions.length > 0 && (
                                    <div className="bg-sky-900/30 border border-sky-600/50 rounded-lg p-4">
                                        <h3 className="text-sky-400 font-semibold mb-3 flex items-center gap-2">
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            Recommended Actions
                                        </h3>
                                        <div className="grid grid-cols-2 gap-2">
                                            {recommendedActions.map(intervention => (
                                                <button
                                                    key={intervention.id}
                                                    onClick={() => handleApplyIntervention(intervention)}
                                                    className="px-4 py-3 bg-sky-700/50 hover:bg-sky-600/50 border border-sky-500/50 rounded-lg text-white text-left transition-colors"
                                                >
                                                    <div className="font-medium">{intervention.label}</div>
                                                    {intervention.dose && <div className="text-xs text-sky-300 mt-1">{intervention.dose}</div>}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Goal Vitals Button */}
                                <button
                                    onClick={() => setShowGoalModal(true)}
                                    className="w-full px-4 py-3 bg-purple-600/30 hover:bg-purple-600/50 border border-purple-500/50 rounded-lg text-purple-300 font-medium transition-colors flex items-center justify-center gap-2"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                    </svg>
                                    Set Goal Vitals Over Time
                                </button>

                                {/* Intervention Categories */}
                                {Object.entries(groupedInterventions).map(([category, interventions]) => (
                                    <div key={category} className="border border-slate-700 rounded-lg overflow-hidden">
                                        <button
                                            onClick={() => setExpandedCategories(prev => ({ ...prev, [category]: !prev[category] }))}
                                            className="w-full px-4 py-3 bg-slate-800 flex items-center justify-between text-white font-medium hover:bg-slate-700 transition-colors"
                                        >
                                            <span>{category}</span>
                                            <svg className={`w-5 h-5 transition-transform ${expandedCategories[category] ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                            </svg>
                                        </button>
                                        {expandedCategories[category] && (
                                            <div className="p-3 grid grid-cols-2 gap-2 bg-slate-900/50">
                                                {interventions.map(intervention => {
                                                    const isApplied = interventionsApplied?.some(i => i.id === intervention.id);
                                                    return (
                                                        <button
                                                            key={intervention.id}
                                                            onClick={() => handleApplyIntervention(intervention)}
                                                            className={`px-4 py-3 rounded-lg text-left transition-colors ${
                                                                isApplied 
                                                                    ? 'bg-green-700/30 border border-green-500/50 text-green-300' 
                                                                    : 'bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white'
                                                            }`}
                                                        >
                                                            <div className="font-medium">{intervention.label}</div>
                                                            {intervention.dose && <div className="text-xs text-slate-400 mt-1">{intervention.dose}</div>}
                                                            {isApplied && <div className="text-xs text-green-400 mt-1">✓ Applied</div>}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        {activeTab === 'investigations' && (
                            <div className="space-y-4">
                                <p className="text-slate-400 text-sm mb-4">Select an investigation type and choose a preset result or enter custom text.</p>
                                
                                <div className="grid grid-cols-2 gap-3">
                                    {investigationTypes.map(inv => (
                                        <button
                                            key={inv.id}
                                            onClick={() => {
                                                setSelectedInvestigation(inv);
                                                setShowInvestigationModal(true);
                                            }}
                                            className="px-4 py-4 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-lg text-white text-left transition-colors"
                                        >
                                            <div className="font-medium">{inv.label}</div>
                                            <div className="text-xs text-slate-400 mt-1">
                                                {inv.presets.length > 0 ? `${inv.presets.length} presets available` : 'Free text entry'}
                                            </div>
                                        </button>
                                    ))}
                                </div>

                                {/* Active investigation notification */}
                                {notifications?.investigation && (
                                    <div className="mt-6 p-4 bg-amber-900/30 border border-amber-500/50 rounded-lg">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <div className="text-amber-400 font-medium">Active Investigation Result</div>
                                                <div className="text-white mt-1">{notifications.investigation.title}</div>
                                            </div>
                                            <button
                                                onClick={handleCloseInvestigation}
                                                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-medium transition-colors"
                                            >
                                                Close on Monitor
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'controls' && (
                            <div className="space-y-4">
                                {/* NIBP Control */}
                                <div className="bg-slate-800 border border-slate-600 rounded-lg p-4">
                                    <h3 className="text-white font-medium mb-3">NIBP Control</h3>
                                    <div className="flex items-center gap-4">
                                        <button
                                            onClick={handleTriggerNIBP}
                                            className="flex-1 px-4 py-3 bg-red-600/30 hover:bg-red-600/50 border border-red-500/50 rounded-lg text-red-300 font-medium transition-colors"
                                        >
                                            Trigger NIBP Reading
                                        </button>
                                        <div className="text-center">
                                            <div className="text-slate-400 text-xs">Current</div>
                                            <div className="text-red-400 font-bold text-xl">{vitals?.bpSys || '--'}/{vitals?.bpDia || '--'}</div>
                                        </div>
                                    </div>
                                </div>

                                {/* Timer Toggle */}
                                <div className="bg-slate-800 border border-slate-600 rounded-lg p-4">
                                    <h3 className="text-white font-medium mb-3">Monitor Timer</h3>
                                    <button
                                        onClick={handleToggleTimer}
                                        className={`w-full px-4 py-3 rounded-lg font-medium transition-colors ${
                                            state.showTimerOnMonitor 
                                                ? 'bg-green-600/30 border border-green-500/50 text-green-300' 
                                                : 'bg-slate-700 border border-slate-500 text-slate-300'
                                        }`}
                                    >
                                        {state.showTimerOnMonitor ? 'Timer Visible on Monitor' : 'Timer Hidden on Monitor'}
                                    </button>
                                </div>

                                {/* WETFLAG Toggle (Paeds only) */}
                                {isPaeds && scenario.wetflag && (
                                    <div className="bg-slate-800 border border-slate-600 rounded-lg p-4">
                                        <h3 className="text-white font-medium mb-3">WETFLAG Display</h3>
                                        <button
                                            onClick={handleToggleWetflag}
                                            className={`w-full px-4 py-3 rounded-lg font-medium transition-colors ${
                                                state.showWetflag 
                                                    ? 'bg-green-600/30 border border-green-500/50 text-green-300' 
                                                    : 'bg-slate-700 border border-slate-500 text-slate-300'
                                            }`}
                                        >
                                            {state.showWetflag ? 'WETFLAG Visible on Monitor' : 'WETFLAG Hidden on Monitor'}
                                        </button>
                                        {state.showWetflag && (
                                            <div className="mt-3 p-3 bg-slate-900 rounded text-sm">
                                                <div className="grid grid-cols-2 gap-2 text-slate-300">
                                                    <div><span className="text-slate-500">Age:</span> {scenario.wetflag.age}</div>
                                                    <div><span className="text-slate-500">W:</span> {scenario.wetflag.weight}kg</div>
                                                    <div><span className="text-slate-500">E:</span> {scenario.wetflag.energy}J</div>
                                                    <div><span className="text-slate-500">T:</span> {scenario.wetflag.tube}</div>
                                                    <div><span className="text-slate-500">F:</span> {scenario.wetflag.fluids}ml</div>
                                                    <div><span className="text-slate-500">L:</span> {scenario.wetflag.lorazepam}mg</div>
                                                    <div><span className="text-slate-500">A:</span> {scenario.wetflag.adrenaline}ml</div>
                                                    <div><span className="text-slate-500">G:</span> {scenario.wetflag.glucose}ml</div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Defib Control */}
                                <div className="bg-slate-800 border border-slate-600 rounded-lg p-4">
                                    <h3 className="text-white font-medium mb-3">Defibrillator</h3>
                                    <button
                                        onClick={handleToggleDefib}
                                        className={`w-full px-4 py-3 rounded-lg font-medium transition-colors ${
                                            showDefib 
                                                ? 'bg-amber-600/30 border border-amber-500/50 text-amber-300' 
                                                : 'bg-slate-700 border border-slate-500 text-slate-300'
                                        }`}
                                    >
                                        {showDefib ? 'Hide Defibrillator' : 'Show Defibrillator on Monitor'}
                                    </button>
                                </div>

                                {/* Audio Routing */}
                                <div className="bg-slate-800 border border-slate-600 rounded-lg p-4">
                                    <h3 className="text-white font-medium mb-3">Audio Output</h3>
                                    <div className="flex gap-2">
                                        {['controller', 'monitor', 'both'].map(option => (
                                            <button
                                                key={option}
                                                onClick={() => dispatch({ type: 'SET_AUDIO_OUTPUT', payload: option })}
                                                className={`flex-1 px-3 py-2 rounded-lg font-medium capitalize transition-colors ${
                                                    state.audioOutput === option 
                                                        ? 'bg-sky-600 text-white' 
                                                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                                                }`}
                                            >
                                                {option}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Panel - Log */}
                <div className="w-1/3 flex flex-col overflow-hidden bg-slate-950">
                    <div className="p-3 border-b border-slate-700 bg-slate-800">
                        <h3 className="text-white font-medium">Activity Log</h3>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-2">
                        {interventionsApplied && interventionsApplied.length > 0 ? (
                            [...interventionsApplied].reverse().map((entry, idx) => (
                                <div key={idx} className="p-3 bg-slate-800/50 border border-slate-700 rounded-lg">
                                    <div className="flex items-center justify-between">
                                        <span className="text-white font-medium">{entry.label || entry.id}</span>
                                        <span className="text-slate-400 text-xs font-mono">{formatTime(entry.time)}</span>
                                    </div>
                                    {entry.dose && <div className="text-xs text-slate-400 mt-1">{entry.dose}</div>}
                                </div>
                            ))
                        ) : (
                            <div className="text-slate-500 text-center py-8">No interventions yet</div>
                        )}
                    </div>
                </div>
            </div>

            {/* Goal Vitals Modal */}
            {showGoalModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                    <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 w-full max-w-md shadow-2xl">
                        <h2 className="text-xl font-bold text-white mb-4">Set Goal Vitals</h2>
                        <p className="text-slate-400 text-sm mb-4">Enter target values. Leave blank to keep current. Vitals will trend smoothly to these targets over the specified duration.</p>
                        
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-slate-400 text-xs">Heart Rate</label>
                                    <input
                                        type="number"
                                        placeholder={vitals?.hr || ''}
                                        value={goalVitalsForm.hr}
                                        onChange={(e) => setGoalVitalsForm(prev => ({ ...prev, hr: e.target.value }))}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white"
                                    />
                                </div>
                                <div>
                                    <label className="text-slate-400 text-xs">BP (sys/dia)</label>
                                    <input
                                        type="text"
                                        placeholder={`${vitals?.bpSys || ''}/${vitals?.bpDia || ''}`}
                                        value={goalVitalsForm.bp}
                                        onChange={(e) => setGoalVitalsForm(prev => ({ ...prev, bp: e.target.value }))}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-slate-400 text-xs">SpO₂ (%)</label>
                                    <input
                                        type="number"
                                        placeholder={vitals?.spo2 || ''}
                                        value={goalVitalsForm.spo2}
                                        onChange={(e) => setGoalVitalsForm(prev => ({ ...prev, spo2: e.target.value }))}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white"
                                    />
                                </div>
                                <div>
                                    <label className="text-slate-400 text-xs">Resp Rate</label>
                                    <input
                                        type="number"
                                        placeholder={vitals?.rr || ''}
                                        value={goalVitalsForm.rr}
                                        onChange={(e) => setGoalVitalsForm(prev => ({ ...prev, rr: e.target.value }))}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-slate-400 text-xs">Temp (°C)</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        placeholder={vitals?.temp || ''}
                                        value={goalVitalsForm.temp}
                                        onChange={(e) => setGoalVitalsForm(prev => ({ ...prev, temp: e.target.value }))}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white"
                                    />
                                </div>
                                <div>
                                    <label className="text-slate-400 text-xs">EtCO₂ (kPa)</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        placeholder={vitals?.etco2 || ''}
                                        value={goalVitalsForm.etco2}
                                        onChange={(e) => setGoalVitalsForm(prev => ({ ...prev, etco2: e.target.value }))}
                                        className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-slate-400 text-xs">Duration (seconds)</label>
                                <input
                                    type="number"
                                    value={goalVitalsForm.duration}
                                    onChange={(e) => setGoalVitalsForm(prev => ({ ...prev, duration: e.target.value }))}
                                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white"
                                />
                            </div>
                        </div>

                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={() => setShowGoalModal(false)}
                                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSetGoalVitals}
                                className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors"
                            >
                                Apply
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Investigation Modal */}
            {showInvestigationModal && selectedInvestigation && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                    <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 w-full max-w-lg shadow-2xl max-h-[80vh] overflow-y-auto">
                        <h2 className="text-xl font-bold text-white mb-4">{selectedInvestigation.label}</h2>
                        
                        {selectedInvestigation.presets.length > 0 && (
                            <div className="mb-4">
                                <label className="text-slate-400 text-sm mb-2 block">Preset Results</label>
                                <div className="grid grid-cols-1 gap-2">
                                    {selectedInvestigation.presets.map((preset, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => handleSendInvestigation(selectedInvestigation.label, preset.content)}
                                            className="px-4 py-3 bg-slate-700 hover:bg-slate-600 border border-slate-500 rounded-lg text-white text-left transition-colors"
                                        >
                                            <div className="font-medium">{preset.label}</div>
                                            <div className="text-xs text-slate-400 mt-1 truncate">{preset.content.substring(0, 100)}...</div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div>
                            <label className="text-slate-400 text-sm mb-2 block">Custom Result (Free Text)</label>
                            <textarea
                                value={customInvestigationText}
                                onChange={(e) => setCustomInvestigationText(e.target.value)}
                                placeholder="Enter custom investigation result..."
                                rows={4}
                                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white placeholder-slate-500"
                            />
                            <button
                                onClick={() => handleSendInvestigation(selectedInvestigation.label, customInvestigationText)}
                                disabled={!customInvestigationText.trim()}
                                className="mt-2 w-full px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg transition-colors"
                            >
                                Send Custom Result
                            </button>
                        </div>

                        <button
                            onClick={() => {
                                setShowInvestigationModal(false);
                                setSelectedInvestigation(null);
                                setCustomInvestigationText('');
                            }}
                            className="mt-4 w-full px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
