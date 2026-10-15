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

        // Back to the menu pauses the run, so it does not carry on unseen; the menu offers a way
        // straight back into it.
        const goBack = () => { if (sim.state.isRunning) sim.pause(); setView('setup'); };
        // Finish ends the run for good, so it is not offered for resuming after a reload.
        const finish = () => { sim.stop(); try { localStorage.removeItem('wmebem_sim_state'); } catch (e) {} setView('debrief'); };

        // Finish pressed by mistake: the debrief offers the way back into the same run (paused, so
        // the facilitator presses START when ready). The patient screens come back with it.
        const returnToScenario = () => {
            sim.dispatch({ type: 'UNDO_FINISH' });
            sim.addLogEntry('Back to the scenario after Finish (facilitator)', 'system');
            setView('livesim');
        };

        if (view === 'debrief') {
            return <DebriefScreen sim={sim} onExit={onRestart} onReturn={returnToScenario} />;
        }

        // Defib Sim scenarios get their own controller, on the same engine.
        if (sim.state.scenario && sim.state.scenario.defibSim && window.DefibSimScreen) {
            const DefibSimScreen = window.DefibSimScreen;
            return (
                <DefibSimScreen
                    sim={sim}
                    onFinish={finish}
                    onBack={goBack}
                    sessionID={sessionID}
                />
            );
        }

        return (
            <LiveSimScreen 
                sim={sim} 
                onFinish={finish}
                onBack={goBack}
                sessionID={sessionID}
            />
        );
    };

    window.LiveSimContainer = LiveSimContainer;
})();
