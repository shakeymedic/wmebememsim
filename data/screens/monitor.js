// data/screens/monitor.js - Monitor Display Screen
// Full implementation with WETFLAG, timer toggle, investigation toasts, and off state

window.MonitorScreen = ({ sim, sessionID }) => {
    const { useState, useEffect, useRef, useCallback } = React;
    const { state } = sim;
    const { scenario, vitals, elapsedTime, isPaused, isFinished, notifications, showWetflag, showTimerOnMonitor, arrestPanelOpen, audioRouting } = state;

    // Audio state
    const [audioEnabled, setAudioEnabled] = useState(false);
    const audioContextRef = useRef(null);
    const lastBeepTimeRef = useRef(0);

    // Investigation toast state
    const [invToast, setInvToast] = useState(null);

    // Flash state for critical values
    const [flash, setFlash] = useState(null);

    // Format time
    const formatTime = (seconds) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    // Enable audio on user interaction
    const handleEnableAudio = useCallback(() => {
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume();
        }
        setAudioEnabled(true);
    }, []);

    // Play beep sound
    const playBeep = useCallback((type = 'normal') => {
        if (!audioEnabled || !audioContextRef.current) return;
        if (audioRouting === 'controller') return; // Don't play on monitor if routed to controller only

        const now = Date.now();
        if (now - lastBeepTimeRef.current < 200) return; // Debounce
        lastBeepTimeRef.current = now;

        const ctx = audioContextRef.current;
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        switch (type) {
            case 'critical':
                oscillator.frequency.setValueAtTime(440, ctx.currentTime);
                gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
                oscillator.start(ctx.currentTime);
                oscillator.stop(ctx.currentTime + 0.15);
                break;
            case 'alarm':
                oscillator.frequency.setValueAtTime(880, ctx.currentTime);
                gainNode.gain.setValueAtTime(0.4, ctx.currentTime);
                oscillator.start(ctx.currentTime);
                oscillator.stop(ctx.currentTime + 0.3);
                break;
            default:
                oscillator.frequency.setValueAtTime(1000, ctx.currentTime);
                gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
                oscillator.start(ctx.currentTime);
                oscillator.stop(ctx.currentTime + 0.05);
        }
    }, [audioEnabled, audioRouting]);

    // Heart beat beep effect
    useEffect(() => {
        if (!vitals?.hr || isPaused || isFinished) return;
        
        const interval = 60000 / vitals.hr;
        const timer = setInterval(() => {
            if (vitals.hr < 50 || vitals.hr > 150) {
                playBeep('critical');
            } else {
                playBeep('normal');
            }
        }, interval);

        return () => clearInterval(timer);
    }, [vitals?.hr, isPaused, isFinished, playBeep]);

    // Critical value flash effect
    useEffect(() => {
        if (!vitals) return;
        
        const isCritical = vitals.hr < 40 || vitals.hr > 180 || 
                          vitals.spo2 < 85 || 
                          vitals.bpSys < 70 || vitals.bpSys > 200;
        
        if (isCritical) {
            const flashInterval = setInterval(() => {
                setFlash(prev => prev === 'red' ? null : 'red');
            }, 500);
            return () => clearInterval(flashInterval);
        } else {
            setFlash(null);
        }
    }, [vitals]);

    // Investigation toast effect
    useEffect(() => {
        if (notifications?.investigation) {
            setInvToast(notifications.investigation);
        } else {
            setInvToast(null);
        }
    }, [notifications?.investigation]);

    // Check if paediatric
    const isPaeds = scenario && scenario.age !== undefined && scenario.age < 16;

    // If scenario is finished, show off state
    if (isFinished) {
        return (
            <div className="h-screen w-screen bg-black flex items-center justify-center">
                <div className="text-slate-700 text-2xl font-mono">MONITOR OFF</div>
            </div>
        );
    }

    return (
        <div className={`h-screen w-screen bg-black text-white overflow-hidden ${flash === 'red' ? 'flash-red' : ''} relative`}>
            {/* Audio Enable Overlay */}
            {!audioEnabled && (
                <div 
                    className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm cursor-pointer"
                    onClick={handleEnableAudio}
                >
                    <div className="bg-slate-800 border border-sky-500 p-8 rounded-xl shadow-2xl text-center animate-pulse">
                        <svg className="w-16 h-16 text-sky-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M9 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <h2 className="text-2xl font-bold text-white mb-2">Tap to Enable Sound</h2>
                        <p className="text-slate-400">Audio requires user interaction to start</p>
                    </div>
                </div>
            )}

            {/* Investigation Toast (Top Right) */}
            {invToast && (
                <div className="absolute top-4 right-4 z-40 max-w-md animate-slide-in-right">
                    <div className="bg-slate-800 border-2 border-amber-500 rounded-lg shadow-2xl overflow-hidden">
                        <div className="bg-amber-500 px-4 py-2">
                            <h3 className="text-black font-bold text-lg">{invToast.title}</h3>
                        </div>
                        <div className="p-4 max-h-64 overflow-y-auto">
                            <pre className="text-white text-sm whitespace-pre-wrap font-mono">{invToast.content}</pre>
                        </div>
                    </div>
                </div>
            )}

            {/* Timer (Top Left) - Conditional */}
            {showTimerOnMonitor && (
                <div className="absolute top-4 left-4 z-30">
                    <div className="bg-slate-900/80 border border-slate-600 px-4 py-2 rounded-lg">
                        <span className="text-3xl font-mono font-bold text-sky-400">{formatTime(elapsedTime)}</span>
                    </div>
                </div>
            )}

            {/* WETFLAG Display (Bottom Left) - Conditional */}
            {isPaeds && scenario.wetflag && showWetflag && (
                <div className="absolute bottom-4 left-4 z-30">
                    <div className="bg-slate-900/90 border border-sky-500 rounded-lg p-4 shadow-xl">
                        <h3 className="text-sky-400 font-bold text-lg mb-2 border-b border-sky-500/50 pb-2">
                            WETFLAG - Age: {scenario.wetflag.age}
                        </h3>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                            <div className="flex justify-between">
                                <span className="text-slate-400 font-medium">W</span>
                                <span className="text-white font-bold">{scenario.wetflag.weight} kg</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-400 font-medium">E</span>
                                <span className="text-white font-bold">{scenario.wetflag.energy} J</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-400 font-medium">T</span>
                                <span className="text-white font-bold">{scenario.wetflag.tube}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-400 font-medium">F</span>
                                <span className="text-white font-bold">{scenario.wetflag.fluids} ml</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-400 font-medium">L</span>
                                <span className="text-white font-bold">{scenario.wetflag.lorazepam} mg</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-400 font-medium">A</span>
                                <span className="text-white font-bold">{scenario.wetflag.adrenaline} ml</span>
                            </div>
                            <div className="flex justify-between col-span-2">
                                <span className="text-slate-400 font-medium">G</span>
                                <span className="text-white font-bold">{scenario.wetflag.glucose} ml (10%)</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Vitals Display */}
            <div className="h-full flex flex-col">
                {/* ECG Waveform Area */}
                <div className="flex-1 relative border-b border-slate-800">
                    <ECGCanvas vitals={vitals} isPaused={isPaused} />
                </div>

                {/* Vitals Numbers */}
                <div className="h-1/3 flex">
                    {/* HR */}
                    <div className="flex-1 border-r border-slate-800 p-4 flex flex-col justify-center items-center">
                        <div className="text-green-500 text-sm font-medium mb-1">HR</div>
                        <div className={`text-7xl font-bold font-mono ${vitals?.hr < 50 || vitals?.hr > 150 ? 'text-red-500 animate-pulse' : 'text-green-400'}`}>
                            {vitals?.hr || '--'}
                        </div>
                        <div className="text-green-600 text-xs mt-1">bpm</div>
                    </div>

                    {/* SpO2 */}
                    <div className="flex-1 border-r border-slate-800 p-4 flex flex-col justify-center items-center">
                        <div className="text-cyan-500 text-sm font-medium mb-1">SpO₂</div>
                        <div className={`text-7xl font-bold font-mono ${vitals?.spo2 < 90 ? 'text-red-500 animate-pulse' : 'text-cyan-400'}`}>
                            {vitals?.spo2 || '--'}
                        </div>
                        <div className="text-cyan-600 text-xs mt-1">%</div>
                    </div>

                    {/* NIBP */}
                    <div className="flex-1 border-r border-slate-800 p-4 flex flex-col justify-center items-center">
                        <div className="text-red-500 text-sm font-medium mb-1">NIBP</div>
                        <div className={`text-5xl font-bold font-mono ${vitals?.bpSys < 80 || vitals?.bpSys > 180 ? 'text-red-500 animate-pulse' : 'text-red-400'}`}>
                            {vitals?.bpSys || '--'}/{vitals?.bpDia || '--'}
                        </div>
                        <div className="text-red-600 text-xs mt-1">mmHg</div>
                        {vitals?.nibpTime && (
                            <div className="text-slate-500 text-xs mt-2">{vitals.nibpTime}</div>
                        )}
                    </div>

                    {/* RR */}
                    <div className="flex-1 border-r border-slate-800 p-4 flex flex-col justify-center items-center">
                        <div className="text-yellow-500 text-sm font-medium mb-1">RR</div>
                        <div className={`text-7xl font-bold font-mono ${vitals?.rr < 8 || vitals?.rr > 30 ? 'text-red-500 animate-pulse' : 'text-yellow-400'}`}>
                            {vitals?.rr || '--'}
                        </div>
                        <div className="text-yellow-600 text-xs mt-1">/min</div>
                    </div>

                    {/* EtCO2 */}
                    <div className="flex-1 p-4 flex flex-col justify-center items-center">
                        <div className="text-purple-500 text-sm font-medium mb-1">EtCO₂</div>
                        <div className={`text-7xl font-bold font-mono ${vitals?.etco2 < 3 || vitals?.etco2 > 6 ? 'text-amber-500' : 'text-purple-400'}`}>
                            {vitals?.etco2?.toFixed(1) || '--'}
                        </div>
                        <div className="text-purple-600 text-xs mt-1">kPa</div>
                    </div>
                </div>
            </div>

            {/* Defibrillator Overlay */}
            {arrestPanelOpen && (
                <div className="absolute inset-0 z-30">
                    <iframe 
                        src={`defib/index.html?session=${sessionID}&mode=defib`}
                        className="w-full h-full border-0"
                        title="Defibrillator"
                    />
                </div>
            )}

            {/* Pause Overlay */}
            {isPaused && !isFinished && (
                <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="text-center">
                        <svg className="w-24 h-24 text-amber-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <h2 className="text-4xl font-bold text-white">PAUSED</h2>
                    </div>
                </div>
            )}

            {/* CSS for animations */}
            <style>{`
                @keyframes flash-red {
                    0%, 100% { background-color: black; }
                    50% { background-color: rgba(220, 38, 38, 0.3); }
                }
                .flash-red {
                    animation: flash-red 0.5s ease-in-out infinite;
                }
                @keyframes slide-in-right {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                .animate-slide-in-right {
                    animation: slide-in-right 0.3s ease-out;
                }
            `}</style>
        </div>
    );
};

// ECG Canvas Component
window.ECGCanvas = ({ vitals, isPaused }) => {
    const { useRef, useEffect } = React;
    const canvasRef = useRef(null);
    const animationRef = useRef(null);
    const dataRef = useRef({ ecg: [], spo2: [], x: 0 });

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width = canvas.offsetWidth * 2;
        const height = canvas.height = canvas.offsetHeight * 2;
        ctx.scale(2, 2);

        const drawWidth = width / 2;
        const drawHeight = height / 2;

        // Generate ECG waveform point
        const generateECGPoint = (phase, hr) => {
            const normalizedPhase = phase % 1;
            const baseAmplitude = 40;
            
            // P wave (0.0 - 0.1)
            if (normalizedPhase < 0.1) {
                return Math.sin(normalizedPhase * Math.PI / 0.1) * baseAmplitude * 0.15;
            }
            // PR segment (0.1 - 0.15)
            else if (normalizedPhase < 0.15) {
                return 0;
            }
            // Q wave (0.15 - 0.17)
            else if (normalizedPhase < 0.17) {
                return -baseAmplitude * 0.1;
            }
            // R wave (0.17 - 0.22)
            else if (normalizedPhase < 0.22) {
                const rPhase = (normalizedPhase - 0.17) / 0.05;
                return rPhase < 0.5 
                    ? rPhase * 2 * baseAmplitude 
                    : (1 - (rPhase - 0.5) * 2) * baseAmplitude;
            }
            // S wave (0.22 - 0.25)
            else if (normalizedPhase < 0.25) {
                return -baseAmplitude * 0.2;
            }
            // ST segment (0.25 - 0.35)
            else if (normalizedPhase < 0.35) {
                return 0;
            }
            // T wave (0.35 - 0.5)
            else if (normalizedPhase < 0.5) {
                return Math.sin((normalizedPhase - 0.35) * Math.PI / 0.15) * baseAmplitude * 0.25;
            }
            // Baseline
            return 0;
        };

        // Animation loop
        const animate = () => {
            if (isPaused) {
                animationRef.current = requestAnimationFrame(animate);
                return;
            }

            ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
            ctx.fillRect(0, 0, drawWidth, drawHeight);

            const hr = vitals?.hr || 75;
            const spo2 = vitals?.spo2 || 98;
            
            // Calculate position
            const speed = 2;
            dataRef.current.x = (dataRef.current.x + speed) % drawWidth;
            const x = dataRef.current.x;

            // ECG trace (top half)
            const ecgY = drawHeight * 0.25;
            const phase = (Date.now() / 1000) * (hr / 60);
            const ecgValue = generateECGPoint(phase, hr);
            
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x - speed, ecgY - (dataRef.current.ecg[dataRef.current.ecg.length - 1] || 0));
            ctx.lineTo(x, ecgY - ecgValue);
            ctx.stroke();
            
            dataRef.current.ecg.push(ecgValue);
            if (dataRef.current.ecg.length > drawWidth / speed) {
                dataRef.current.ecg.shift();
            }

            // SpO2 pleth trace (bottom half)
            const plethY = drawHeight * 0.75;
            const plethPhase = (Date.now() / 1000) * (hr / 60);
            const plethValue = Math.sin(plethPhase * Math.PI * 2) * 20 * (spo2 / 100);
            
            ctx.strokeStyle = '#06b6d4';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x - speed, plethY - (dataRef.current.spo2[dataRef.current.spo2.length - 1] || 0));
            ctx.lineTo(x, plethY - plethValue);
            ctx.stroke();
            
            dataRef.current.spo2.push(plethValue);
            if (dataRef.current.spo2.length > drawWidth / speed) {
                dataRef.current.spo2.shift();
            }

            // Clear line ahead
            ctx.fillStyle = 'black';
            ctx.fillRect(x, 0, 30, drawHeight);

            // Draw labels
            ctx.fillStyle = '#22c55e';
            ctx.font = '12px sans-serif';
            ctx.fillText('II', 10, 20);
            
            ctx.fillStyle = '#06b6d4';
            ctx.fillText('PLETH', 10, drawHeight * 0.5 + 20);

            animationRef.current = requestAnimationFrame(animate);
        };

        animate();

        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [vitals?.hr, vitals?.spo2, isPaused]);

    return (
        <canvas 
            ref={canvasRef} 
            className="w-full h-full"
            style={{ background: 'black' }}
        />
    );
};

// Monitor Container - handles joining session
window.MonitorContainer = ({ sessionID }) => {
    const { useState, useEffect } = React;
    const [connected, setConnected] = useState(false);
    const [error, setError] = useState(null);

    // Create simulation hook for monitor mode
    const sim = window.useSimulation(null, true, sessionID);

    useEffect(() => {
        if (sim && sim.state) {
            setConnected(true);
        }
    }, [sim]);

    if (error) {
        return (
            <div className="h-screen w-screen bg-black flex items-center justify-center">
                <div className="text-red-500 text-xl">{error}</div>
            </div>
        );
    }

    if (!connected || !sim.state.scenario) {
        return (
            <div className="h-screen w-screen bg-black flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin w-16 h-16 border-4 border-sky-500 border-t-transparent rounded-full mx-auto mb-4"></div>
                    <div className="text-white text-xl">Connecting to session {sessionID}...</div>
                    <div className="text-slate-500 text-sm mt-2">Waiting for scenario to start</div>
                </div>
            </div>
        );
    }

    return <window.MonitorScreen sim={sim} sessionID={sessionID} />;
};
