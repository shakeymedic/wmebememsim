// data/ui.js
(() => {
    const { useState, useEffect, useRef } = React;

    // Button Component
    const Button = ({ children, onClick, variant = 'primary', className = '', disabled = false, ...props }) => {
        const variants = {
            primary: 'bg-sky-600 hover:bg-sky-700 text-white border-sky-500',
            secondary: 'bg-slate-700 hover:bg-slate-600 text-white border-slate-600',
            success: 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-500',
            danger: 'bg-red-600 hover:bg-red-700 text-white border-red-500',
            warning: 'bg-amber-600 hover:bg-amber-700 text-white border-amber-500',
            outline: 'bg-transparent hover:bg-slate-800 text-slate-300 border-slate-600',
            ghost: 'bg-transparent hover:bg-slate-800 text-slate-400 border-transparent'
        };
        return (
            <button
                onClick={onClick}
                disabled={disabled}
                className={`flex items-center justify-center gap-2 px-4 py-2 rounded border font-bold text-sm transition-all duration-200 ${variants[variant]} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${className}`}
                {...props}
            >
                {children}
            </button>
        );
    };

    // Lucide Icon Wrapper
    const Lucide = ({ icon, className = '' }) => {
        const IconComponent = lucide[icon.charAt(0).toUpperCase() + icon.slice(1).replace(/-([a-z])/g, g => g[1].toUpperCase())];
        if (!IconComponent) return <span className={className}>?</span>;
        return <IconComponent className={className} />;
    };

    // Vital Display Component
    const VitalDisplay = ({ label, value, value2, unit, alert, visible, isMonitor, hideTrends, prev, isNIBP, lastNIBP, onClick }) => {
        const [trend, setTrend] = useState(null);
        
        useEffect(() => {
            if (!hideTrends && prev !== undefined && value !== prev) {
                setTrend(value > prev ? 'up' : 'down');
                const timer = setTimeout(() => setTrend(null), 2000);
                return () => clearTimeout(timer);
            }
        }, [value, prev, hideTrends]);

        const textSize = isMonitor ? 'text-4xl md:text-5xl' : 'text-3xl';
        const alertColor = alert ? 'text-red-500 animate-pulse' : 'text-white';

        if (!visible) {
            return (
                <div className="bg-slate-900 p-3 rounded border border-slate-800 flex flex-col items-center justify-center h-full">
                    <span className="text-[10px] text-slate-600 uppercase font-bold">{label}</span>
                    <span className="text-3xl font-mono text-slate-700">--</span>
                </div>
            );
        }

        return (
            <div 
                className={`bg-slate-900 p-2 md:p-3 rounded border ${alert ? 'border-red-500/50' : 'border-slate-800'} flex flex-col items-center justify-center h-full relative ${onClick ? 'cursor-pointer hover:bg-slate-800' : ''}`}
                onClick={onClick}
            >
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">{label}</span>
                <div className="flex items-baseline gap-1">
                    <span className={`font-mono font-bold ${textSize} ${alertColor}`}>
                        {value2 !== undefined ? `${value}/${value2}` : value}
                    </span>
                    {trend && !hideTrends && (
                        <Lucide icon={trend === 'up' ? 'trending-up' : 'trending-down'} className={`w-4 h-4 ${trend === 'up' ? 'text-red-400' : 'text-emerald-400'}`} />
                    )}
                </div>
                <span className="text-[10px] text-slate-600 uppercase">{unit}</span>
                {isNIBP && lastNIBP && (
                    <div className="absolute bottom-1 left-1 text-[8px] text-slate-500">
                        {Math.floor((Date.now() - lastNIBP) / 60000)}m ago
                    </div>
                )}
            </div>
        );
    };

    // ECG Monitor Component with realistic waveforms
    const ECGMonitor = ({ rhythmType, hr, rr, spO2, isPaused, showEtco2, showTraces, showArt, isCPR, className, rhythmLabel }) => {
        const canvasRef = useRef(null);
        const animationRef = useRef(null);
        const dataRef = useRef({ ecgX: 0, spO2X: 0, etco2X: 0, artX: 0, lastBeat: 0, lastBreath: 0 });

        useEffect(() => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const width = canvas.width;
            const height = canvas.height;
            
            // ECG waveform generation
            const getECGValue = (phase, rhythm) => {
                if (rhythm === 'Asystole') return 0;
                if (rhythm === 'VF' || rhythm === 'Coarse VF' || rhythm === 'Fine VF') {
                    return (Math.random() - 0.5) * (rhythm === 'Fine VF' ? 0.3 : 0.8);
                }
                if (rhythm === 'VT' || rhythm === 'pVT') {
                    return Math.sin(phase * 8) * 0.6;
                }
                
                // Normal/sinus rhythms
                const p = phase % 1;
                if (p < 0.1) return Math.sin(p * 31.4) * 0.15; // P wave
                if (p < 0.15) return 0;
                if (p < 0.18) return -0.1; // Q
                if (p < 0.22) return 0.9; // R
                if (p < 0.26) return -0.2; // S
                if (p < 0.45) return 0.05 * Math.sin((p - 0.26) * 16.5); // ST
                if (p < 0.55) return Math.sin((p - 0.45) * 31.4) * 0.2; // T wave
                return 0;
            };

            const animate = () => {
                ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
                ctx.fillRect(0, 0, width, height);

                const data = dataRef.current;
                const now = Date.now();
                const beatInterval = hr > 0 ? 60000 / hr : 99999;
                const breathInterval = rr > 0 ? 60000 / rr : 99999;

                // ECG trace
                if (showTraces !== false) {
                    const ecgY = height * 0.25;
                    const ecgHeight = height * 0.2;
                    ctx.strokeStyle = '#22c55e';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    
                    const phase = (now % beatInterval) / beatInterval;
                    const val = getECGValue(phase, rhythmType);
                    const y = ecgY - val * ecgHeight;
                    
                    if (data.ecgX === 0) ctx.moveTo(data.ecgX, y);
                    else ctx.lineTo(data.ecgX, y);
                    ctx.stroke();
                    
                    data.ecgX = (data.ecgX + 2) % width;
                    
                    // Clear ahead
                    ctx.fillStyle = 'black';
                    ctx.fillRect(data.ecgX, 0, 20, height * 0.5);
                }

                // SpO2 trace
                if (showTraces !== false) {
                    const spO2Y = height * 0.55;
                    const spO2Height = height * 0.15;
                    ctx.strokeStyle = '#3b82f6';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    
                    const beatPhase = (now % beatInterval) / beatInterval;
                    let val = 0;
                    if (beatPhase < 0.3) val = Math.sin(beatPhase * 10.5) * 0.8;
                    else if (beatPhase < 0.6) val = Math.pow(1 - (beatPhase - 0.3) / 0.3, 2) * 0.6;
                    
                    const y = spO2Y - val * spO2Height;
                    if (data.spO2X === 0) ctx.moveTo(data.spO2X, y);
                    else ctx.lineTo(data.spO2X, y);
                    ctx.stroke();
                    
                    data.spO2X = (data.spO2X + 2) % width;
                    ctx.fillStyle = 'black';
                    ctx.fillRect(data.spO2X, height * 0.4, 20, height * 0.35);
                }

                // ETCO2 trace
                if (showEtco2) {
                    const etco2Y = height * 0.85;
                    const etco2Height = height * 0.12;
                    ctx.strokeStyle = '#eab308';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    
                    const breathPhase = (now % breathInterval) / breathInterval;
                    let val = 0;
                    if (breathPhase < 0.1) val = breathPhase / 0.1;
                    else if (breathPhase < 0.4) val = 1;
                    else if (breathPhase < 0.5) val = 1 - (breathPhase - 0.4) / 0.1;
                    
                    const y = etco2Y - val * etco2Height;
                    if (data.etco2X === 0) ctx.moveTo(data.etco2X, y);
                    else ctx.lineTo(data.etco2X, y);
                    ctx.stroke();
                    
                    data.etco2X = (data.etco2X + 1.5) % width;
                    ctx.fillStyle = 'black';
                    ctx.fillRect(data.etco2X, height * 0.7, 20, height * 0.3);
                }

                // Labels
                ctx.fillStyle = '#22c55e';
                ctx.font = '10px monospace';
                ctx.fillText('ECG II', 5, 15);
                ctx.fillStyle = '#3b82f6';
                ctx.fillText('SpO2', 5, height * 0.45);
                if (showEtco2) {
                    ctx.fillStyle = '#eab308';
                    ctx.fillText('ETCO2', 5, height * 0.75);
                }

                animationRef.current = requestAnimationFrame(animate);
            };

            animate();
            return () => {
                if (animationRef.current) cancelAnimationFrame(animationRef.current);
            };
        }, [rhythmType, hr, rr, showEtco2, showTraces, isPaused]);

        return (
            <div className={`bg-black rounded overflow-hidden ${className}`}>
                <canvas ref={canvasRef} width={600} height={300} className="w-full h-full" />
            </div>
        );
    };

    // Export components
    window.Button = Button;
    window.Lucide = Lucide;
    window.VitalDisplay = VitalDisplay;
    window.ECGMonitor = ECGMonitor;
})();
