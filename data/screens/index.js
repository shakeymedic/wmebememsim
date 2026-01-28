// data/screens/index.js - Screen Container Components
// Handles transitions between live simulation and debrief

// Join Screen for Monitor Mode
window.JoinScreen = ({ onJoin }) => {
    const { useState } = React;
    const [sessionCode, setSessionCode] = useState('');
    const [error, setError] = useState('');

    const handleJoin = () => {
        const code = sessionCode.trim().toUpperCase();
        if (code.length !== 4) {
            setError('Please enter a valid 4-character session code');
            return;
        }
        onJoin(code);
    };

    return (
        <div className="h-full flex items-center justify-center bg-slate-900">
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 w-full max-w-md shadow-2xl">
                <h2 className="text-2xl font-bold text-white text-center mb-2">Join as Monitor</h2>
                <p className="text-slate-400 text-center mb-6">Enter the session code from the controller</p>
                
                <div className="space-y-4">
                    <div>
                        <label className="text-slate-400 text-sm mb-1 block">Session Code</label>
                        <input
                            type="text"
                            value={sessionCode}
                            onChange={(e) => {
                                setSessionCode(e.target.value.toUpperCase().slice(0, 4));
                                setError('');
                            }}
                            placeholder="XXXX"
                            maxLength={4}
                            className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white text-center text-2xl font-mono tracking-widest placeholder-slate-500 focus:outline-none focus:border-sky-500"
                        />
                        {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
                    </div>

                    <button
                        onClick={handleJoin}
                        disabled={sessionCode.length !== 4}
                        className="w-full px-4 py-3 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-medium transition-colors"
                    >
                        Connect to Session
                    </button>
                </div>

                <div className="mt-6 p-4 bg-slate-900 rounded-lg">
                    <h3 className="text-slate-300 font-medium mb-2">Alternative: Direct URL</h3>
                    <p className="text-slate-500 text-sm">
                        You can also access the monitor directly by adding <code className="text-sky-400">?mode=monitor&session=XXXX</code> to the URL.
                    </p>
                </div>
            </div>
        </div>
    );
};

// Briefing Screen
window.BriefingScreen = ({ scenario, onStart, onBack }) => {
    const { useState } = React;
    const [acknowledged, setAcknowledged] = useState(false);

    // Check if paediatric
    const isPaeds = scenario && scenario.age !== undefined && scenario.age < 16;

    return (
        <div className="h-full flex items-center justify-center bg-slate-900 p-4 overflow-y-auto">
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full max-w-2xl shadow-2xl">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-white">Scenario Briefing</h2>
                    <button
                        onClick={onBack}
                        className="text-slate-400 hover:text-white transition-colors"
                    >
                        ← Back
                    </button>
                </div>

                {/* Patient Info */}
                <div className="bg-slate-900 rounded-lg p-4 mb-4">
                    <h3 className="text-sky-400 font-semibold mb-3">Patient Information</h3>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                            <span className="text-slate-400">Name:</span>
                            <span className="text-white ml-2">{scenario.patientName || 'Unknown'}</span>
                        </div>
                        <div>
                            <span className="text-slate-400">Age:</span>
                            <span className="text-white ml-2">{scenario.age} years</span>
                        </div>
                        <div>
                            <span className="text-slate-400">Sex:</span>
                            <span className="text-white ml-2">{scenario.sex || 'Unknown'}</span>
                        </div>
                        <div>
                            <span className="text-slate-400">Weight:</span>
                            <span className="text-white ml-2">{scenario.weight ? `${scenario.weight}kg` : 'Unknown'}</span>
                        </div>
                    </div>
                </div>

                {/* Presenting Complaint */}
                <div className="bg-slate-900 rounded-lg p-4 mb-4">
                    <h3 className="text-amber-400 font-semibold mb-2">Presenting Complaint</h3>
                    <p className="text-white">{scenario.chiefComplaint || 'No information available'}</p>
                </div>

                {/* History */}
                {scenario.history && (
                    <div className="bg-slate-900 rounded-lg p-4 mb-4">
                        <h3 className="text-green-400 font-semibold mb-2">Brief History</h3>
                        <p className="text-slate-300">{scenario.history}</p>
                    </div>
                )}

                {/* Initial Observations */}
                <div className="bg-slate-900 rounded-lg p-4 mb-4">
                    <h3 className="text-red-400 font-semibold mb-3">Initial Observations</h3>
                    <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                            <div className="text-slate-400 text-xs">HR</div>
                            <div className="text-green-400 font-bold text-xl">{scenario.initialVitals?.hr || '--'}</div>
                        </div>
                        <div>
                            <div className="text-slate-400 text-xs">BP</div>
                            <div className="text-red-400 font-bold text-xl">
                                {scenario.initialVitals?.bpSys || '--'}/{scenario.initialVitals?.bpDia || '--'}
                            </div>
                        </div>
                        <div>
                            <div className="text-slate-400 text-xs">SpO₂</div>
                            <div className="text-cyan-400 font-bold text-xl">{scenario.initialVitals?.spo2 || '--'}%</div>
                        </div>
                        <div>
                            <div className="text-slate-400 text-xs">RR</div>
                            <div className="text-yellow-400 font-bold text-xl">{scenario.initialVitals?.rr || '--'}</div>
                        </div>
                        <div>
                            <div className="text-slate-400 text-xs">GCS</div>
                            <div className="text-purple-400 font-bold text-xl">{scenario.initialVitals?.gcs || '--'}</div>
                        </div>
                        <div>
                            <div className="text-slate-400 text-xs">Temp</div>
                            <div className="text-orange-400 font-bold text-xl">{scenario.initialVitals?.temp || '--'}°C</div>
                        </div>
                    </div>
                </div>

                {/* WETFLAG for Paeds */}
                {isPaeds && scenario.wetflag && (
                    <div className="bg-sky-900/30 border border-sky-500/50 rounded-lg p-4 mb-4">
                        <h3 className="text-sky-400 font-semibold mb-3">WETFLAG - Age: {scenario.wetflag.age}</h3>
                        <div className="grid grid-cols-4 gap-3 text-sm">
                            <div>
                                <span className="text-slate-400">W:</span>
                                <span className="text-white ml-1">{scenario.wetflag.weight}kg</span>
                            </div>
                            <div>
                                <span className="text-slate-400">E:</span>
                                <span className="text-white ml-1">{scenario.wetflag.energy}J</span>
                            </div>
                            <div>
                                <span className="text-slate-400">T:</span>
                                <span className="text-white ml-1">{scenario.wetflag.tube}</span>
                            </div>
                            <div>
                                <span className="text-slate-400">F:</span>
                                <span className="text-white ml-1">{scenario.wetflag.fluids}ml</span>
                            </div>
                            <div>
                                <span className="text-slate-400">L:</span>
                                <span className="text-white ml-1">{scenario.wetflag.lorazepam}mg</span>
                            </div>
                            <div>
                                <span className="text-slate-400">A:</span>
                                <span className="text-white ml-1">{scenario.wetflag.adrenaline}ml</span>
                            </div>
                            <div className="col-span-2">
                                <span className="text-slate-400">G:</span>
                                <span className="text-white ml-1">{scenario.wetflag.glucose}ml (10%)</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Acknowledgement */}
                <div className="flex items-center gap-3 mb-6">
                    <input
                        type="checkbox"
                        id="acknowledge"
                        checked={acknowledged}
                        onChange={(e) => setAcknowledged(e.target.checked)}
                        className="w-5 h-5 rounded border-slate-600 bg-slate-900 text-sky-500 focus:ring-sky-500"
                    />
                    <label htmlFor="acknowledge" className="text-slate-300 text-sm cursor-pointer">
                        I have reviewed the patient information and am ready to begin
                    </label>
                </div>

                {/* Start Button */}
                <button
                    onClick={onStart}
                    disabled={!acknowledged}
                    className="w-full px-6 py-4 bg-green-600 hover:bg-green-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg font-bold text-lg transition-colors"
                >
                    Start Scenario
                </button>
            </div>
        </div>
    );
};

// Live Sim Container - handles live sim and debrief
window.LiveSimContainer = ({ sim, view, setView, resumeData, onRestart, sessionID }) => {
    const { useState, useEffect } = React;
    const { state, dispatch } = sim;

    // Handle end scenario
    const handleEndScenario = () => {
        dispatch({ type: 'END_SCENARIO' });
        setView('debrief');
    };

    // Handle main menu
    const handleMainMenu = () => {
        dispatch({ type: 'RESET' });
        setView('setup');
    };

    // Handle restart
    const handleRestart = () => {
        onRestart();
    };

    // Resume from saved state
    useEffect(() => {
        if (resumeData && view === 'live') {
            dispatch({ type: 'RESTORE_STATE', payload: resumeData });
        }
    }, [resumeData, view, dispatch]);

    if (view === 'debrief' || state.isFinished) {
        return (
            <window.DebriefScreen 
                sim={sim} 
                onRestart={handleRestart}
                onMainMenu={handleMainMenu}
            />
        );
    }

    return (
        <window.LiveSimScreen 
            sim={sim} 
            onEnd={handleEndScenario}
            onRestart={handleRestart}
            sessionID={sessionID}
        />
    );
};
