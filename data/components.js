// data/components.js
(() => {
    const { useState, useEffect, useRef, useReducer } = React;

    // SAFE LUCIDE COMPONENT
    const Lucide = React.memo(({ icon, className = "" }) => {
        const ref = useRef(null);

        useEffect(() => {
            if (!ref.current || !window.lucide) return;
            ref.current.innerHTML = '';
            const kebabToPascal = (str) => str.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
            const iconName = kebabToPascal(icon);
            
            if (window.lucide.icons && window.lucide.icons[iconName]) {
                 const iconNode = window.lucide.icons[iconName];
                 if (window.lucide.createElement) {
                     const svg = window.lucide.createElement(iconNode);
                     if (className) svg.setAttribute('class', className);
                     ref.current.appendChild(svg);
                     return;
                 }
            }
            if (window.lucide.createIcons) {
                const i = document.createElement('i');
                i.setAttribute('data-lucide', icon);
                if (className) i.setAttribute('class', className);
                ref.current.appendChild(i);
                window.lucide.createIcons({ root: ref.current });
            }
        }, [icon, className]);

        return <span ref={ref} className="inline-flex items-center justify-center"></span>;
    });

    const Button = ({ onClick, children, variant = 'primary', className = '', disabled = false, progress = 0 }) => {
        let variants = {
            primary: "bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-900/20",
            secondary: "bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600",
            danger: "bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/20",
            success: "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20",
            warning: "bg-amber-500 hover:bg-amber-600 text-white",
            outline: "border-2 border-slate-600 text-slate-300 hover:bg-slate-800",
            ghost: "hover:bg-slate-800 text-slate-400"
        };
        let base = "px-4 py-3 rounded-md font-bold transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed relative overflow-hidden touch-manipulation z-0 active:scale-95";
        
        if (className.includes("h-16")) { base += " text-lg px-6"; } 
        else if (className.includes("h-14")) { base += " text-base px-4"; } 
        else { base += " text-xs"; }

        return (
            <button onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${className}`}>
                {progress > 0 && (
                    <div className="absolute top-0 left-0 bottom-0 bg-white/10 z-[-1] transition-all duration-1000 ease-linear" style={{ width: `${progress}%` }}></div>
                )}
                <span className="relative z-10 flex items-center gap-2 whitespace-nowrap w-full justify-center">{children}</span>
            </button>
        );
    };

    const Card = ({ title, icon, children, className = "", collapsible = false, defaultOpen = true }) => {
        const [isOpen, setIsOpen] = useState(defaultOpen);
        return (
            <div className={`bg-slate-900/80 border border-slate-700/50 rounded-xl overflow-hidden shadow-xl backdrop-blur-sm flex flex-col ${className}`}>
                {title && (
                    <div 
                        className={`bg-slate-900/90 p-3 border-b border-slate-700/50 flex items-center justify-between flex-shrink-0 ${collapsible ? 'cursor-pointer hover:bg-slate-800' : ''}`}
                        onClick={() => collapsible && setIsOpen(!isOpen)}
                    >
                        <div className="flex items-center gap-2">
                            {icon && <Lucide icon={icon} className="w-5 h-5 text-sky-500" />}
                            <h3 className="font-bold text-slate-100">{title}</h3>
                        </div>
                        {collapsible && (
                            <Lucide icon="chevron-down" className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                        )}
                    </div>
                )}
                {(!collapsible || isOpen) && (
                    <div className="p-4 animate-fadeIn flex-grow overflow-auto min-h-0">{children}</div>
                )}
            </div>
        );
    };
    
    // --- PHILIPS STYLE VITAL DISPLAY ---
    const VitalDisplay = ({ label, value, value2, prev, unit, lowIsBad = true, onUpdate, alert, isText = false, visible = true, isMonitor = false, hideTrends = false, isNIBP = false, lastNIBP = null }) => {
        const [isEditing, setIsEditing] = useState(false);
        const [editVal, setEditVal] = useState(value);
        useEffect(() => { if (!isEditing) setEditVal(value); }, [value, isEditing]);
        
        const handleBlur = () => { setIsEditing(false); if (editVal !== value) onUpdate(isText ? editVal : parseFloat(editVal)); };

        // Colors based on parameter type (Philips Standard)
        const getColors = (lbl) => {
            if (lbl.includes("Heart") || lbl.includes("HR")) return "text-green-500";
            if (lbl.includes("SpO2") || lbl.includes("Pleth")) return "text-cyan-400"; // Philips uses Cyan/Blue
            if (lbl.includes("BP") || lbl.includes("NIBP") || lbl.includes("ABP")) return "text-red-500";
            if (lbl.includes("Resp") || lbl.includes("RR")) return "text-yellow-400"; // Sometimes Yellow or White
            if (lbl.includes("CO2")) return "text-yellow-500";
            if (lbl.includes("Temp")) return "text-white";
            return "text-slate-200";
        };

        const colorClass = getColors(label);
        const isBP = label.includes("BP") || label.includes("NIBP") || label.includes("ABP");

        // --- MONITOR MODE (Large, Philips Style) ---
        if (isMonitor) {
            if (!visible) return <div className="flex flex-col p-2 h-full bg-black opacity-20"><span className="text-sm font-bold text-slate-600 uppercase">{label}</span></div>;
            
            return (
                <div className={`relative flex flex-col p-2 h-full bg-black overflow-hidden ${alert ? 'animate-pulse bg-red-900/30' : ''}`}>
                    {/* Label Top Left */}
                    <div className="flex justify-between items-start">
                        <span className={`text-sm md:text-base font-bold ${colorClass} uppercase tracking-tight`}>{label}</span>
                        {/* Limits Dummy (Static for look) */}
                        {!isText && <div className="text-[10px] text-slate-500 flex flex-col items-end leading-tight"><span>150</span><span>50</span></div>}
                    </div>

                    {/* Main Value Center */}
                    <div className="flex-grow flex items-center justify-center">
                         <div className={`flex items-baseline ${colorClass} font-mono font-bold leading-none`}>
                            <span className={isText ? "text-4xl" : "text-6xl md:text-7xl tracking-tighter"}>
                                {value === '?' ? '-?-' : (isText ? value : Math.round(value))}
                            </span>
                            {isBP && (
                                <span className="text-3xl md:text-4xl ml-1 text-slate-300 opacity-80">
                                    /{value2 !== undefined ? Math.round(value2) : '--'}
                                </span>
                            )}
                         </div>
                    </div>

                    {/* Footer: Units & NIBP Info */}
                    <div className="flex justify-between items-end mt-1">
                        <span className="text-xs text-slate-400 font-bold">{unit}</span>
                        {isNIBP && (
                            <span className="text-[10px] text-slate-500 font-mono">
                                {lastNIBP ? `Last: ${Math.floor((Date.now() - lastNIBP)/60000)}m ago` : 'MANUAL'}
                            </span>
                        )}
                        {!hideTrends && !isText && !isBP && value !== '?' && prev !== '?' && (
                            <span className={`text-lg font-bold ${value > prev ? 'text-emerald-500' : value < prev ? 'text-red-500' : 'text-slate-800'}`}>
                                {value > prev ? '↑' : value < prev ? '↓' : ''}
                            </span>
                        )}
                    </div>
                </div>
            );
        }

        // --- CONTROLLER MODE (Compact) ---
        return (
            <div className={`bg-slate-800/80 p-1 md:p-2 rounded border flex flex-col items-center justify-center h-20 relative touch-manipulation transition-colors duration-300 ${alert ? 'border-red-500 bg-red-900/20' : 'border-slate-600'}`}>
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">{label}</span>
                
                {isEditing ? (
                    <input 
                        type={isText ? "text" : "number"} 
                        value={editVal} 
                        onChange={(e) => setEditVal(e.target.value)} 
                        onBlur={handleBlur} 
                        onKeyDown={(e) => e.key === 'Enter' && handleBlur()} 
                        className="text-lg font-mono font-bold text-white bg-slate-700 border border-sky-500 rounded w-full text-center outline-none" 
                        autoFocus 
                    />
                ) : (
                    <div className="flex items-baseline gap-1 cursor-pointer hover:bg-slate-700/50 rounded px-2 py-0.5" onClick={() => { setEditVal(value); setIsEditing(true); }}>
                        <span className={`font-mono font-bold text-white ${isText ? 'text-sm leading-tight' : 'text-2xl'}`}>
                            {value === '?' ? '--' : (isText ? value : Math.round(value))}
                            {isBP && <span className="text-lg text-slate-400 ml-0.5">/{value2 !== undefined ? Math.round(value2) : '--'}</span>}
                        </span>
                    </div>
                )}
                <span className="text-[8px] text-slate-500 leading-none">{unit}</span>
            </div>
        );
    };
        
    const ECGMonitor = ({ rhythmType, hr, isPaused, showEtco2, rr, pathology, spO2, showTraces, showArt, isCPR, className = "h-40", rhythmLabel = null }) => {
        const canvasRef = useRef(null);
        const requestRef = useRef(null);
        
        const drawState = useRef({
            x: 0,
            lastY: 50,
            beatProgress: 0,
            breathProgress: 0,
            lastTime: 0,
            lastYCO2: 0,
            lastYPleth: 0,
            lastYArt: 0
        });

        const propsRef = useRef({ rhythmType, hr, rr, showEtco2, pathology, isPaused, spO2, showTraces, showArt, isCPR, rhythmLabel });

        useEffect(() => {
            propsRef.current = { rhythmType, hr, rr, showEtco2, pathology, isPaused, spO2, showTraces, showArt, isCPR, rhythmLabel };
        }, [rhythmType, hr, rr, showEtco2, pathology, isPaused, spO2, showTraces, showArt, isCPR, rhythmLabel]);

        // --- WAVEFORM GENERATORS ---
        const getWaveform = (type, t, cpr, baseline) => {
            const noise = (Math.random() - 0.5) * 1.5;
            
            if (cpr) {
                const compression = Math.sin(t * 12) * 45; 
                return baseline + compression + (Math.random() * 10 - 5);
            }

            if (type === 'Asystole') return baseline + noise;
            
            if (type === 'VF' || type === 'Coarse VF') return baseline + Math.sin(t * 20) * 25 + Math.sin(t * 7) * 30 + noise * 3;
            if (type === 'Fine VF') return baseline + Math.sin(t * 25) * 8 + Math.sin(t * 10) * 10 + noise;
            if (type === 'VT') {
                let y = baseline;
                if (t < 0.2) y += Math.sin(t * 5 * Math.PI) * 50; 
                else if (t < 0.6) y -= Math.sin((t-0.2) * 2.5 * Math.PI) * 50; 
                return y + noise;
            }

            let y = baseline;
            const hasP = !['AF', 'SVT', 'VT', 'VF', 'Asystole'].includes(type);
            if (hasP) {
                if (t < 0.1) y -= Math.sin(t/0.1 * Math.PI) * 4;
            } else if (type === 'AF') {
                y += Math.sin(t * 60) * 2 + Math.sin(t * 37) * 1.5; 
            }

            if (t > 0.12 && t < 0.14) y += 3; // Q
            else if (t >= 0.14 && t < 0.18) y -= 55; // R
            else if (t >= 0.18 && t < 0.20) y += 12; // S

            if (type === 'STEMI') {
                if (t >= 0.20 && t < 0.4) {
                    y -= 15; 
                    y -= Math.sin((t-0.20)/0.2 * Math.PI) * 8; 
                }
            } else {
                if (t > 0.3 && t < 0.5) y -= Math.sin((t-0.3)/0.2 * Math.PI) * 8;
            }

            return y + noise;
        };

        const getPlethWave = (t, spO2) => {
            if (!spO2 || spO2 < 10) return 0;
            let y = 0;
            if (t < 0.3) { y = Math.sin((t / 0.3) * Math.PI/2); } 
            else { y = Math.cos(((t - 0.3) / 0.7) * Math.PI/2); }
            return y * (spO2/100); 
        };

        const getArtWave = (t) => {
             let y = 0;
             if (t < 0.15) {
                 y = Math.sin((t/0.15) * Math.PI/2); 
             } else if (t < 0.4) {
                 y = Math.cos(((t-0.15)/0.25) * Math.PI/2) * 0.8 + 0.2; 
             } else if (t < 0.5) {
                 y = 0.2 + Math.sin(((t-0.4)/0.1) * Math.PI) * 0.1; 
             } else {
                 y = 0.2 * (1 - (t-0.5)/0.5); 
             }
             return y;
        };

        const getEtco2Wave = (t, pathology, rr) => {
            if (rr <= 0) return 0; 
            if (t < 0.1 || t > 0.6) return 0; 
            if (t >= 0.1 && t < 0.15) return ((t - 0.1) / 0.05); 
            if (t >= 0.15 && t < 0.5) {
                if (pathology === 'respiratory') return 0.5 + ((t - 0.15)/0.35)*0.5;
                return 1.0; 
            }
            if (t >= 0.5 && t <= 0.6) return 1.0 - ((t - 0.5) / 0.1); 
            return 0;
        };

        useEffect(() => {
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            
            const setSize = () => {
                const parent = canvas.parentElement;
                if(parent) {
                    canvas.width = parent.clientWidth;
                    canvas.height = parent.clientHeight;
                    // Philips Layout: Tighter spacing
                    drawState.current.lastY = canvas.height * 0.20;
                    drawState.current.lastYCO2 = canvas.height * 0.45;
                    drawState.current.lastYArt = canvas.height * 0.70;
                    drawState.current.lastYPleth = canvas.height * 0.90;
                    ctx.fillStyle = '#000000';
                    ctx.fillRect(0,0, canvas.width, canvas.height);
                }
            };
            setSize();
            window.addEventListener('resize', setSize);

            const animate = (timestamp) => {
                const state = drawState.current;
                const props = propsRef.current;
                
                if (!state.lastTime) state.lastTime = timestamp;
                let dt = (timestamp - state.lastTime) / 1000;
                if (dt > 0.05) dt = 0.05; 
                state.lastTime = timestamp;

                if (props.isPaused) { requestRef.current = requestAnimationFrame(animate); return; }

                const ecgSpeed = 150; 
                const dx = ecgSpeed * dt;
                const prevX = state.x;
                state.x += dx;
                const eraserWidth = 40; // Wider eraser for cleaner look
                
                ctx.fillStyle = '#000000';
                if (state.x + eraserWidth < canvas.width) { ctx.fillRect(state.x, 0, eraserWidth + 5, canvas.height); } 
                else { ctx.fillRect(state.x, 0, canvas.width - state.x, canvas.height); ctx.fillRect(0, 0, eraserWidth, canvas.height); }

                const baselineECG = canvas.height * 0.20;

                if (!props.showTraces) {
                    ctx.strokeStyle = '#222'; ctx.beginPath(); ctx.moveTo(prevX, baselineECG); ctx.lineTo(state.x, baselineECG); ctx.stroke();
                    requestRef.current = requestAnimationFrame(animate);
                    return;
                }

                // RHYTHM CALCS
                let currentRhythm = props.rhythmType || 'Sinus Rhythm'; 
                let currentRate = props.isCPR ? 110 : (props.hr || 60);
                
                let beatDuration = 60 / Math.max(10, currentRate);
                if (['VF', 'Coarse VF', 'Fine VF'].includes(currentRhythm)) beatDuration = 0.2; 

                state.beatProgress += dt / beatDuration;
                if (state.beatProgress >= 1) state.beatProgress = 0;

                let breathDuration = 60 / (Math.max(1, props.rr) || 12);
                state.breathProgress += dt / breathDuration;
                if (state.breathProgress >= 1) state.breathProgress = 0;

                if (state.x > canvas.width) {
                    state.x = 0;
                    state.lastY = getWaveform(currentRhythm, state.beatProgress, props.isCPR, baselineECG);
                    state.lastYCO2 = canvas.height * 0.45;
                    state.lastYArt = canvas.height * 0.70;
                    state.lastYPleth = canvas.height * 0.90;
                }

                // 1. ECG (Philips Green)
                const yECG = getWaveform(currentRhythm, state.beatProgress, props.isCPR, baselineECG);
                if (state.x > prevX) {
                    ctx.strokeStyle = '#00ff00'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
                    ctx.moveTo(prevX, state.lastY); ctx.lineTo(state.x, yECG); ctx.stroke();
                }
                state.lastY = yECG;

                // 2. ETCO2 (Philips Yellow)
                if (props.showEtco2) {
                    const normCO2 = getEtco2Wave(state.breathProgress, props.pathology, props.rr);
                    const co2MaxHeight = canvas.height * 0.10; const co2BaseY = (canvas.height * 0.45); const yCO2 = co2BaseY - (normCO2 * co2MaxHeight);
                    if (state.x > prevX) {
                         ctx.strokeStyle = '#facc15'; ctx.lineWidth = 2; ctx.beginPath();
                         ctx.moveTo(prevX, state.lastYCO2); ctx.lineTo(state.x, yCO2); ctx.stroke();
                    }
                    state.lastYCO2 = yCO2;
                }

                // 3. ART LINE (Philips Red)
                if (props.showArt && !props.isCPR && currentRate > 0) {
                     const normArt = getArtWave(state.beatProgress);
                     const artHeight = canvas.height * 0.10; const artBaseY = (canvas.height * 0.70); const yArt = artBaseY - (normArt * artHeight);
                     if (state.x > prevX) {
                        ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2; ctx.beginPath();
                        ctx.moveTo(prevX, state.lastYArt); ctx.lineTo(state.x, yArt); ctx.stroke();
                     }
                     state.lastYArt = yArt;
                }

                // 4. PLETH (Philips Cyan)
                if (currentRate > 0 && !props.isCPR && props.spO2 > 10) {
                    const normPleth = getPlethWave(state.beatProgress, props.spO2);
                    const plethHeight = canvas.height * 0.08; const plethBaseY = canvas.height * 0.95; const yPleth = plethBaseY - (normPleth * plethHeight);
                    if (state.x > prevX) {
                        ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.beginPath();
                        ctx.moveTo(prevX, state.lastYPleth); ctx.lineTo(state.x, yPleth); ctx.stroke();
                    }
                    state.lastYPleth = yPleth;
                }
                
                requestRef.current = requestAnimationFrame(animate);
            };

            requestRef.current = requestAnimationFrame(animate);
            return () => { window.removeEventListener('resize', setSize); if (requestRef.current) cancelAnimationFrame(requestRef.current); };
        }, []);

        return (
            <div className={`w-full bg-black rounded border border-slate-800 relative overflow-hidden ${className}`}>
                <canvas ref={canvasRef} className="block w-full h-full"></canvas>
                
                {/* PHILIPS STYLE LABELS: Clean text, no boxes */}
                {showTraces && (
                    <div className="absolute top-[2%] left-2 font-bold text-green-500 text-sm tracking-wider">
                        II <span className="text-xs font-normal text-slate-400 ml-1">MONITOR</span>
                    </div>
                )}
                {showEtco2 && showTraces && (
                    <div className="absolute top-[35%] left-2 font-bold text-yellow-500 text-sm tracking-wider">
                        CO2
                    </div>
                )}
                {showArt && showTraces && (
                    <div className="absolute top-[60%] left-2 font-bold text-red-500 text-sm tracking-wider">
                        ART
                    </div>
                )}
                {showTraces && (
                    <div className="absolute top-[85%] left-2 font-bold text-cyan-400 text-sm tracking-wider">
                        PLETH
                    </div>
                )}
            </div>
        );
    };

    const InvestigationButton = ({ type, icon, label, isRevealed, isLoading, revealInvestigation, isRunning, scenario }) => {
        const hasData = (type === 'ECG' && scenario.ecg) || (type === 'X-ray' && scenario.chestXray) || (type === 'POCUS' && scenario.ultrasound) || (type === 'VBG' && scenario.vbg) || (type === 'CT' && scenario.ct) || (type === 'Urine' && scenario.urine);
        return (
            <div className="flex flex-col gap-2">
                <Button variant={isRevealed ? "secondary" : "outline"} onClick={() => revealInvestigation(type)} disabled={!isRunning || isRevealed || isLoading} className="h-10 text-xs relative overflow-hidden">
                    {isLoading && <div className="loading-bar"></div>}
                    <div className="relative z-10 flex items-center gap-2"><Lucide icon={icon} className="w-3 h-3"/> {isLoading ? `Requesting...` : (isRevealed ? `View ${type}` : `Request ${type}`)}</div>
                </Button>
                {isRevealed && (
                    <div className="p-3 bg-slate-700/30 rounded text-xs border-l-2 border-sky-500 animate-fadeIn">
                        {hasData ? (
                            type === 'VBG' ? <div className="font-mono space-y-1"><div>pH: {scenario.vbg.pH.toFixed(2)}</div><div>pCO2: {scenario.vbg.pCO2} kPa</div><div>pO2: 12.0 kPa</div><div>HCO3: {scenario.vbg.HCO3}</div><div>BE: {scenario.vbg.BE}</div><div>Lac: {scenario.vbg.Lac}</div><div>K+: {scenario.vbg.K}</div><div className="font-bold text-sky-400">Glu: {scenario.vbg.Glu} mmol/L</div></div> : 
                            type === 'ECG' ? <div><p className="mb-1 font-bold">{scenario.ecg.findings}</p><p className="italic text-slate-400">See monitor for rhythm.</p></div> : 
                            type === 'X-ray' ? <div className="text-slate-200">{scenario.chestXray.findings}</div> : 
                            type === 'POCUS' ? <div className="text-slate-200">{scenario.ultrasound.findings}</div> : 
                            type === 'Urine' ? <div className="text-slate-200 font-mono">{scenario.urine.findings}</div> :
                            type === 'CT' ? <div className="text-slate-200">{scenario.ct.findings}</div> : 'Normal / Not Indicated'
                        ) : 'Normal / Not Indicated'}
                    </div>
                )}
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
