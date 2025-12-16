(() => {
    const { useEffect } = React;

    const LiveSimContainer = ({ sim, view, setView, resumeData, onRestart, sessionID }) => {
        const { state, stop, reset } = sim;
        const { scenario } = state;
        const { Lucide, LiveSimScreen, DebriefScreen } = window; // Note: accessing LiveSimScreen from window now

        useEffect(() => {
            if (view === 'resume' && resumeData) {
                sim.dispatch({ type: 'RESTORE_SESSION', payload: resumeData });
            } else if (!scenario) {
                setView('setup');
            }
        }, []);

        if (!scenario) return <div className="flex flex-col items-center justify-center h-full text-slate-400 animate-pulse"><Lucide icon="loader-2" className="w-8 h-8 mb-4 animate-spin text-sky-500" /></div>;
        
        if (view === 'live' || view === 'resume') {
            return <LiveSimScreen sim={sim} onFinish={() => { stop(); setView('debrief'); }} onBack={() => setView('briefing')} sessionID={sessionID} />;
        }
        
        if (view === 'debrief') {
            return <DebriefScreen sim={sim} onRestart={() => { reset(); setView('setup'); }} />;
        }
        
        return null;
    };

    window.LiveSimContainer = LiveSimContainer;
})();
