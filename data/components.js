// data/components.js
(() => {
    const { useState, useEffect, useRef } = React;

    // --- HELPERS (Must be first) ---
    const getColors = (lbl) => {
        if (!lbl) return "text-slate-200";
        if (lbl.includes("Heart") || lbl.includes("HR")) return "text-green-500";
        if (lbl.includes("SpO2") || lbl.includes("Pleth")) return "text-cyan-400"; 
        if (lbl.includes("BP") || lbl.includes("NIBP") || lbl.includes("ABP")) return "text-red-500";
        if (lbl.includes("Resp") || lbl.includes("RR")) return "text-yellow-400"; 
        if (lbl.includes("CO2") || lbl.includes("ETCO2")) return "text-yellow-500";
        return "text-slate-200";
    };

    // --- UTILITIES ---
    const Lucide = React.memo(({ icon, className = "" }) => {
        const ref = useRef(null);
        useEffect(() => {
            if (!ref.current || !window.lucide) return;
            ref.current.innerHTML = '';
            const i = document.createElement('i');
            i.setAttribute('data-lucide', icon);
            if (className) i.setAttribute('class', className);
            ref.current.appendChild(i);
            if(window.lucide.createIcons) window.lucide.createIcons({ root: ref.current });
        }, [icon, className]);
        return <span ref={ref} className="inline-flex items-center justify-center"></span>;
    });

    const Button = ({ onClick, children, variant = 'primary', className = '', disabled = false, progress = 0 }) => {
        const [isFlashing, setIsFlashing] = useState(false);
        const handleClick = (e) => {
            if (disabled) return;
            setIsFlashing(true);
            setTimeout(() => setIsFlashing(false), 150);
            if (onClick) onClick(e);
        };
        let variants = {
            primary: "bg-sky-600 hover:bg-sky-500 text-white",
            secondary: "bg-slate-700 hover:bg-slate-600 text-slate-200",
            danger: "bg-red-600 hover:bg-red-500 text-white",
            success: "bg-emerald-600 hover:bg-emerald-500 text-white",
            warning: "bg-amber-500 hover:bg-amber-600 text-white",
            outline: "border border-slate-600 text-slate-300 hover:bg-slate-800"
        };
        let base = "px-4 py-3 rounded font-semibold transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm relative overflow-hidden touch-manipulation z-0";
        if (className.includes("h-16")) { base += " text-xl px-8"; } 
        else if (className.includes("h-14")) { base += " text-lg px-4"; } 
        else { base += " text-xs"; }
        const finalClass = `${base} ${variants[variant]} ${className} ${isFlashing ? 'flash-active' : ''}`;
        return (
            <button onClick={handleClick} disabled={disabled} className={finalClass}>
                {progress > 0 && (
                    <div className="absolute top-0 left-0 bottom-0 bg-emerald-500/50 z-[-1] transition-all duration-1000 ease-linear" style={{ width: `${progress}%` }}></div>
                )}
                <span className="relative z-10 flex items-center gap-2 whitespace-nowrap w-full justify-center">{children}</span>
            </button>
        );
    };

    const Card = ({ title, icon, children, className = "", collapsible = false, defaultOpen = true }) => {
        const [isOpen, setIsOpen] = useState(defaultOpen);
        return (
            <div className={`bg-slate-800 border border-slate-700 rounded-lg overflow-hidden shadow-lg flex flex-col ${className}`}>
                {title && (
                    <div className={`bg-slate-800/50 p-3 border-b border-slate-700 flex items-center justify-between flex-shrink-0 ${collapsible ? 'cursor-pointer hover:bg-slate-700/50 transition-colors' : ''}`} onClick={() => collapsible && setIsOpen(!isOpen)}>
                        <div className="flex items-center gap-2">
                            {icon && <Lucide icon={icon} className="w-5 h-5 text-sky-400" />}
                            <h3 className="font-bold text-slate-200">{title}</h3>
                        </div>
                        {collapsible && (<Lucide icon="chevron-down" className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />)}
                    </div>
                )}
                {(!collapsible || isOpen) && (
                    <div className="p-4 animate-fadeIn flex-grow overflow-auto min-h-0">{children}</div>
                )}
            </div>
        );
    };

    // --- HYBRID VITAL DISPLAY (Monitor & Controller) ---
    const VitalDisplay = ({ label, value, value2, prev, unit, lowIsBad = true, onUpdate, onClick, alert, isText = false, visible = true, isMonitor = false, hideTrends = false, isNIBP = false, lastNIBP = null, trend = null, history = [] }) => {
        // Monitor View
        if (isMonitor) {
            if (!visible) return <div className="flex flex-col items-center justify-center h-full bg-slate-900/20 rounded border border-slate-800 opacity-20"><span className="text-2xl font-bold text-slate-600">{label}</span><span className="text-4xl font-mono text-slate-700">--</span></div>;
            return (
                <div className={`relative flex flex-col p-2 h-full bg-black overflow-hidden ${alert ? 'animate-pulse bg-red-900/30' : ''}`}>
                    {isNIBP && (<button onClick={onClick} className="absolute inset-0 z-20 w-full h-full cursor-pointer opacity-0 hover:opacity-10 transition-opacity bg-white" title="Cycle NIBP"></button>)}
                    <div className="flex justify-between items-start"><span className={`text-sm md:text-base font-bold ${getColors(label)} uppercase tracking-tight`}>{label}</span></div>
                    <div className="flex-grow flex items-center justify-center">
                        <div className={`flex items-baseline ${getColors(label)} font-mono font-bold leading-none`}>
                            <span className={isText ? "text-4xl" : "text-6xl md:text-7xl tracking-tighter"}>{value === null ? '--' : value}</span>
                            {value2 !== undefined && <span className="text-3xl md:text-4xl ml-1 text-slate-300 opacity-80">/{value2}</span>}
                        </div>
                    </div>
                    {isNIBP && history.length > 0 && <div className="absolute bottom-1 left-2 text-[10px] font-mono text-slate-500">{history[0].sys}/{history[0].dia} ({history[0].time})</div>}
                    <div className="flex justify-between items-end mt-1"><span className="text-xs text-slate-400 font-bold">{unit}</span></div>
                </div>
            );
        }

        // Controller View
        const [isEditing, setIsEditing] = useState(false);
        const [editVal, setEditVal] = useState(value);
        useEffect(() => { if (!isEditing) setEditVal(value); }, [value, isEditing]);
        const handleBlur = () => { setIsEditing(false); if (editVal !== value && onUpdate) onUpdate(isText ? editVal : parseFloat(editVal)); };
        
        if (!visible) return (<div className="bg-slate-900/50 p-1 md:p-2 rounded border border-slate-800 flex flex-col items-center justify-center h-20 relative opacity-40"><span className="text-[9px] md:text-[10px] font-bold text-slate-600 uppercase tracking-wider">{label}</span><span className="text-xl font-mono text-slate-700">--</span></div>);
        
        const handleInteraction = () => { if (onClick) { onClick(); } else { setEditVal(value); setIsEditing(true); } };
        
        return (
            <div className={`bg-slate-900/50 p-1 md:p-2 rounded border flex flex-col items-center justify-center h-20 relative touch-manipulation transition-colors duration-300 overflow-hidden group ${alert ? 'border-red-500 bg-red-900/20' : 'border-slate-700 hover:border-sky-500 hover:bg-slate-800'}`} onClick={handleInteraction}>
                <div className="absolute top-1 right-1 text-slate-600 group-hover:text-sky-400 transition-colors"><Lucide icon="settings-2" className="w-3 h-3" /></div>
                {trend && trend.active && (<div className="absolute bottom-0 left-0 h-1.5 bg-sky-500/50 z-0 transition-all duration-1000 ease-linear" style={{ width: `${trend.progress * 100}%` }}></div>)}
                <span className="text-[9px] md:text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5 relative z-10 group-hover:text-sky-400 transition-colors">{label}</span>
                {isEditing ? (<input type={isText ? "text" : "number"} value={editVal} onChange={(e) => setEditVal(e.target.value)} onBlur={handleBlur} onKeyDown={(e) => e.key === 'Enter' && handleBlur()} className="text-lg font-mono font-bold text-white bg-slate-800 border border-slate-500 rounded w-full text-center relative z-10" autoFocus />) : (<div className="flex items-baseline gap-1 cursor-pointer hover:bg-slate-800/50 rounded px-2 py-0.5 relative z-10"><span className={`font-mono font-bold text-white ${isText ? 'text-lg' : 'text-2xl'}`}>{value}{value2 !== undefined && <span className="text-lg text-slate-400 ml-0.5">/{value2}</span>}</span></div>)}
                <span className="text-[8px] md:text-[9px] text-slate-600 leading-none relative z-10">{unit}</span>
            </div>
        );
    };

    // --- ENHANCED ECG MONITOR (SWEEP) ---
    const ECGMonitor = ({ rhythmType, hr, isCPR, showTraces, className = "h-40", color = "#00ff00", speed = 1.0, flatline = false }) => {
        const canvasRef = useRef(null);
        const containerRef = useRef(null);
        const reqRef = useRef(null);
        const state = useRef({ x: 0, lastY: 0, lastTime: 0 });

        useEffect(() => {
            const canvas = canvasRef.current;
            const container = containerRef.current;
            if(!canvas || !container) return;
            const ctx = canvas.getContext('2d');
            
            const updateSize = () => {
                const rect = container.getBoundingClientRect();
                canvas.width = rect.width * window.devicePixelRatio;
                canvas.height = rect.height * window.devicePixelRatio;
                state.current.lastY = canvas.height / 2;
                ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
                canvas.style.width = `${rect.width}px`;
                canvas.style.height = `${rect.height}px`;
            };
            const observer = new ResizeObserver(updateSize);
            observer.observe(container);
            updateSize();

            const draw = (time) => {
                if (!state.current.lastTime) state.current.lastTime = time;
                const dt = Math.min((time - state.current.lastTime) / 1000, 0.1);
                state.current.lastTime = time;
                const width = canvas.width / window.devicePixelRatio;
                const height = canvas.height / window.devicePixelRatio;
                const baseline = height / 2;
                const pxSpeed = 150 * speed;
                const dx = pxSpeed * dt;
                const prevX = state.current.x;
                state.current.x += dx;

                if (state.current.x > width) {
                    state.current.x = 0;
                    ctx.fillStyle = '#000';
                    ctx.fillRect(0, 0, 20, height);
                }
                const clearBarWidth = 30;
                ctx.fillStyle = '#000';
                ctx.fillRect(state.current.x, 0, clearBarWidth, height);

                if (showTraces) {
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 2.5;
                    ctx.lineJoin = 'round';
                    ctx.lineCap = 'round';
                    ctx.shadowBlur = 4;
                    ctx.shadowColor = color;
                    ctx.beginPath();
                    if (state.current.x < prevX) ctx.moveTo(state.current.x, baseline);
                    else ctx.moveTo(prevX, state.current.lastY);

                    let y = 0;
                    if (flatline) y = 0;
                    else if (isCPR) y = Math.sin(time * 0.01) * 30 + (Math.random() - 0.5) * 10;
                    else {
                        const rate = Math.max(1, hr || 75); // Prevent divide by zero
                        const beatDur = 60 / rate; 
                        const t = (time / 1000) % beatDur;
                        const amp = 40; 
                        const rLow = rhythmType ? rhythmType.toLowerCase() : 'nsr';
                        if (rLow.includes('vf')) y = (Math.sin(time * 0.01) + Math.sin(time * 0.023) * 0.5) * amp;
                        else if (rLow.includes('vt') && !rLow.includes('pvt')) y = Math.sin(time * 0.015) * amp * 1.5;
                        else if (rLow.includes('asystole')) y = Math.sin(time * 0.005) * 2;
                        else {
                            const pLoc = 0.1 * beatDur;
                            const qrsLoc = 0.2 * beatDur;
                            const tLoc = 0.5 * beatDur;
                            const gauss = (x, c, w, h) => h * Math.exp(-Math.pow(x - c, 2) / (2 * w * w));
                            y -= gauss(t, pLoc, 0.02, amp * 0.15);
                            y += gauss(t, qrsLoc, 0.01, amp * 1.5);
                            y -= gauss(t, qrsLoc - 0.02, 0.005, amp * 0.3);
                            y -= gauss(t, qrsLoc + 0.02, 0.005, amp * 0.5);
                            y -= gauss(t, tLoc, 0.05, amp * 0.25);
                        }
                    }
                    const targetY = baseline - y;
                    ctx.lineTo(state.current.x, targetY);
                    ctx.stroke();
                    state.current.lastY = targetY;
                }
                reqRef.current = requestAnimationFrame(draw);
            };
            reqRef.current = requestAnimationFrame(draw);
            return () => { observer.disconnect(); cancelAnimationFrame(reqRef.current); };
        }, [rhythmType, hr, isCPR, showTraces, color, speed, flatline]);

        return <div ref={containerRef} className={className}><canvas ref={canvasRef} className="block" /></div>;
    };

    const InvestigationButton = ({ type, icon, label, isRevealed, isLoading, revealInvestigation, isRunning, scenario }) => {
        const [isFlashing, setIsFlashing] = useState(false);
        const handleClick = () => {
            if (!isRunning) return;
            setIsFlashing(true); setTimeout(() => setIsFlashing(false), 150);
            revealInvestigation(type);
        };
        const getResult = () => {
             if (!scenario) return "No data";
             if (type === 'ECG') return scenario.ecg ? scenario.ecg.findings : "Normal";
             if (type === 'VBG') return scenario.vbg ? `pH: ${scenario.vbg.pH.toFixed(2)} Lac: ${scenario.vbg.Lac}` : "Normal";
             if (type === 'X-ray') return scenario.chestXray ? scenario.chestXray.findings : "Normal";
             return "Result Available";
        }
        return (
            <div className="flex flex-col bg-slate-900 border border-slate-700 rounded overflow-hidden">
                <button onClick={handleClick} className={`p-2 flex items-center justify-between text-xs font-bold w-full transition-colors ${isFlashing ? 'flash-active' : ''} bg-slate-700 hover:bg-slate-600 text-white`}>
                    <span className="flex items-center gap-2"><Lucide icon={icon} className="w-3 h-3" /> {label}</span>
                    {isLoading && <Lucide icon="loader-2" className="w-3 h-3 animate-spin" />}
                </button>
                {isRevealed && <div className="p-2 text-[10px] text-slate-300 bg-slate-800/50">{getResult()}</div>}
            </div>
        );
    };

    window.Lucide = Lucide; 
    window.Button = Button; 
    window.Card = Card; 
    window.VitalDisplay = VitalDisplay; 
    window.ECGMonitor = ECGMonitor; 
    window.InvestigationButton = InvestigationButton;
})();
