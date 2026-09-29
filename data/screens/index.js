(() => {
    // This container manages the active view between the live simulation and the debrief
    const LiveSimContainer = ({ sim, view, setView, resumeData, onRestart, sessionID }) => {
        const { LiveSimScreen, DebriefScreen } = window;

        // Auto-resume if data provided
        const { useEffect } = React;
        useEffect(() => {
            if (resumeData) {
                // Logic already handled in App level restore
            }
        }, [resumeData]);

        if (view === 'debrief') {
            return <DebriefScreen sim={sim} onExit={onRestart} />;
        }

        // Defib Sim scenarios get their own controller, on the same engine.
        if (sim.state.scenario && sim.state.scenario.defibSim && window.DefibSimScreen) {
            const DefibSimScreen = window.DefibSimScreen;
            return (
                <DefibSimScreen
                    sim={sim}
                    onFinish={() => { sim.stop(); setView('debrief'); }}
                    onBack={() => setView('setup')}
                    sessionID={sessionID}
                />
            );
        }

        return (
            <LiveSimScreen 
                sim={sim} 
                onFinish={() => {
                    sim.stop();
                    setView('debrief');
                }}
                onBack={() => setView('setup')}
                sessionID={sessionID}
            />
        );
    };

    window.LiveSimContainer = LiveSimContainer;
})();
