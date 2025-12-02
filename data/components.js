const { useState, useEffect, useRef, useReducer } = React;

    // SAFE LUCIDE COMPONENT - Fixed to prevent React reconciliation crashes
    const Lucide = React.memo(({ icon, className = "" }) => {
        const ref = useRef(null);

        useEffect(() => {
            if (!ref.current || !window.lucide) return;
            
            // Convert kebab-case (arrow-left) to PascalCase (ArrowLeft) for lookup if needed,
            // but lucide.icons usually stores them as PascalCase.
            // Some versions of Lucide global object have createIcons that scans DOM,
            // others provide createElement.
            
            // Clear container safely
            ref.current.innerHTML = '';

            const kebabToPascal = (str) => str.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
            const iconName = kebabToPascal(icon);
            
            if (window.lucide.icons && window.lucide.icons[iconName]) {
                 // Modern UMD approach if available
                 const iconNode = window.lucide.icons[iconName];
                 if (window.lucide.createElement) {
                     const svg = window.lucide.createElement(iconNode);
                     if (className) svg.setAttribute('class', className);
                     ref.current.appendChild(svg);
                     return;
                 }
            }

            // Fallback for older UMD or if direct lookup fails
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

        return (
            <button onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${className}`}>
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
                    <div 
                        className={`bg-slate-800/50 p-3 border-b border-slate-700 flex items-center justify-between flex-shrink-0 ${collapsible ? 'cursor-pointer hover:bg-slate-700/50 transition-colors' : ''}`}
                        onClick={() => collapsible && setIsOpen(!isOpen)}
                    >
                        <div className="flex items-center gap-2">
                            {icon && <Lucide icon={icon} className="w-5 h-5 text-sky-400" />}
                            <h3 className="font-bold text-slate-200">{title}</h3>
                        </div>
                        {collapsible && (
                            <Lucide icon="chevron-down" className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                        )}
                    </div>
                )}
                {(!collapsible || isOpen) && (
                    <div className="p-4 animate-fadeIn flex-grow overflow-auto min-h-0">{children}</div>
                )}
            </div>
        );
    };
    
    // Updated VitalDisplay to handle BP explicitly
    const VitalDisplay = ({ label, value, value2, prev, unit, lowIsBad = true, onUpdate, alert, isText = false, visible = true, isMonitor = false, hideTrends = false }) => {
        const [isEditing, setIsEditing] = useState(false);
        const [editVal, setEditVal] = useState(value);
        useEffect(() => { if (!isEditing) setEditVal(value); }, [value, isEditing]);
        const handleBlur = () => { setIsEditing(false); if (editVal !== value) onUpdate(isText ? editVal : parseFloat(editVal)); };

        const isBP = label === "BP" || label === "NIBP" || label === "ABP";
        
        // --- MONITOR MODE (LARGE) ---
        if (isMonitor) {
            if (!visible) return <div className="flex flex-col items-center justify-center h-full bg-slate-900/20 rounded border border-slate-800 opacity-20"><span className="text-2xl font-bold text-slate-600">{label}</span><span className="text-4xl font-mono text-slate-700">--</span></div>;
            
            return (
                <div className={`flex flex-col items-center justify-center h-full rounded border-2 transition-colors duration-500 ${alert ? 'bg-red-900/40 border-red-500 animate-pulse' : 'bg-slate-900/40 border-slate-700'}`}>
                    <span className="text-xl font-bold text-slate-400 uppercase tracking-widest mb-2">{label}</span>
                    <div className="flex items-baseline gap-2">
                        <span className={`font-mono font-bold text-white ${isText ? 'text-4xl' : 'text-7xl'}`}>
                            {value === '?' ? '--' : (isText ? value : Math.round(value * 10) / 10)}
                            {isBP && <span className="text-5xl text-slate-400">/{value2 !== undefined ? Math.round(value2) : '--'}</span>}
                        </span>
                        {!hideTrends && !isText && !isBP && value !== '?' && prev !== '?' && <span className={`text-2xl font-bold ${value === prev ? 'text-slate-600' : (lowIsBad ? (value > prev ? 'text-emerald-500' : 'text-red-500') : (value > prev ? 'text-red-500' : 'text-emerald-500'))}`}>{value > prev ? '▲' : value < prev ? '▼' : '▬'}</span>}
                    </div>
                    <span className="text-lg text-slate-500 mt-2">{unit}</span>
                </div>
            );
        }

        // --- CONTROLLER MODE (COMPACT) ---
        if (!visible) {
             return (
                <div className="bg-slate-900/50 p-1 md:p-2 rounded border border-slate-800 flex flex-col items-center justify-center h-20 relative opacity-40">
                    <span className="text-[9px] md:text-[10px] font-bold text-slate-600 uppercase tracking-wider">{label}</span>
                    <span className="text-xl font-mono text-slate-700">--</span>
                </div>
             );
        }

        return (
            <div className={`bg-slate-900/50 p-1 md:p-2 rounded border flex flex-col items-center justify-center h-20 relative touch-manipulation transition-colors duration-300 ${alert ? 'border-red-500 bg-red-900/20' : 'border-slate-700'}`}>
                <span className="text-[9px] md:text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">{label}</span>
                {isEditing ? (
                    <input type={isText ? "text" : "number"} value={editVal} onChange={(e) => setEditVal(e.target.value)} onBlur={handleBlur} onKeyDown={(e) => e.key === 'Enter' && handleBlur()} className="text-lg font-mono font-bold text-white bg-slate-800 border border-slate-500 rounded w-full text-center" autoFocus />
                ) : (
                    <div className="flex items-baseline gap-1 cursor-pointer hover:bg-slate-800/50 rounded px-2 py-0.5" onClick={() => { setEditVal(value); setIsEditing(true); }}>
                        <span className={`font-mono font-bold text-white ${isText ? 'text-lg' : 'text-2xl'}`}>
                            {value === '?' ? '--' : (isText ? value : Math.round(value * 10) / 10)}
                            {isBP && <span className="text-lg text-slate-400 ml-0.5">/{value2 !== undefined ? Math.round(value2) : '--'}</span>}
                        </span>
                        {!isText && !isBP && value !== '?' && prev !== '?' && <span className={`text-[10px] font-bold ${value === prev ? 'text-slate-500' : (lowIsBad ? (value > prev ? 'text-emerald-400' : 'text-red-400') : (value > prev ? 'text-red-400' : 'text-emerald-400'))}`}>{value > prev ? '▲' : value < prev ? '▼' : '▬'}</span>}
                    </div>
                )}
                <span className="text-[8px] md:text-[9px] text-slate-600 leading-none">{unit}</span>
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
                // Large CPR Artifact
                const compression = Math.sin(t * 12) * 45; 
                return baseline + compression + (Math.random() * 10 - 5);
            }

            if (type === 'Asystole') return baseline + noise;
            
            // VF / VT
            if (type === 'VF' || type === 'Coarse VF') return baseline + Math.sin(t * 20) * 25 + Math.sin(t * 7) * 30 + noise * 3;
            if (type === 'Fine VF') return baseline + Math.sin(t * 25) * 8 + Math.sin(t * 10) * 10 + noise;
            if (type === 'VT') {
                let y = baseline;
                if (t < 0.2) y += Math.sin(t * 5 * Math.PI) * 50; 
                else if (t < 0.6) y -= Math.sin((t-0.2) * 2.5 * Math.PI) * 50; 
                return y + noise;
            }

            // Complex Rhythms
            let y = baseline;
            
            // P-Wave (Skip for AF, SVT, etc)
            const hasP = !['AF', 'SVT', 'VT', 'VF', 'Asystole'].includes(type);
            if (hasP) {
                if (t < 0.1) y -= Math.sin(t/0.1 * Math.PI) * 4;
            } else if (type === 'AF') {
                // Fibrillatory baseline for AF (f-waves)
                y += Math.sin(t * 60) * 2 + Math.sin(t * 37) * 1.5; 
            }

            // QRS Complex
            if (t > 0.12 && t < 0.14) y += 3; // Q
            else if (t >= 0.14 && t < 0.18) y -= 55; // R (Up is negative)
            else if (t >= 0.18 && t < 0.20) y += 12; // S

            // ST Segment / T Wave
            if (type === 'STEMI') {
                // Elevated ST
                if (t >= 0.20 && t < 0.4) {
                    y -= 15; // Elevation
                    y -= Math.sin((t-0.20)/0.2 * Math.PI) * 8; // T wave merged
                }
            } else {
                // Normal ST/T
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
             // Realistic arterial pressure waveform
             let y = 0;
             if (t < 0.15) {
                 y = Math.sin((t/0.15) * Math.PI/2); // Steep rise
             } else if (t < 0.4) {
                 y = Math.cos(((t-0.15)/0.25) * Math.PI/2) * 0.8 + 0.2; // Fall to notch
             } else if (t < 0.5) {
                 y = 0.2 + Math.sin(((t-0.4)/0.1) * Math.PI) * 0.1; // Dicrotic notch
             } else {
                 y = 0.2 * (1 - (t-0.5)/0.5); // Diastolic runoff
             }
             return y;
        };

        const getEtco2Wave = (t, pathology, rr) => {
            if (rr <= 0) return 0; 
            if (t < 0.1 || t > 0.6) return 0; 
            if (t >= 0.1 && t < 0.15) return ((t - 0.1) / 0.05); // Rise
            if (t >= 0.15 && t < 0.5) {
                if (pathology === 'respiratory') return 0.5 + ((t - 0.15)/0.35)*0.5; // Shark fin
                return 1.0; 
            }
            if (t >= 0.5 && t <= 0.6) return 1.0 - ((t - 0.5) / 0.1); // Fall
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
                    // Calc Y positions dynamically based on height
                    // ECG at 30% height, CO2 at 60%, Art at 80%, Pleth at 95%
                    drawState.current.lastY = canvas.height * 0.30;
                    drawState.current.lastYCO2 = canvas.height * 0.60;
                    drawState.current.lastYArt = canvas.height * 0.80;
                    drawState.current.lastYPleth = canvas.height - 10;
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
                
                // --- GLITCH FIX ---
                let dt = (timestamp - state.lastTime) / 1000;
                if (dt > 0.05) dt = 0.05; 
                state.lastTime = timestamp;

                if (props.isPaused) { requestRef.current = requestAnimationFrame(animate); return; }

                // Eraser Bar
                const ecgSpeed = 150; 
                const dx = ecgSpeed * dt;
                const prevX = state.x;
                state.x += dx;
                const eraserWidth = 30;
                
                ctx.fillStyle = '#000000';
                if (state.x + eraserWidth < canvas.width) { ctx.fillRect(state.x, 0, eraserWidth + 5, canvas.height); } 
                else { ctx.fillRect(state.x, 0, canvas.width - state.x, canvas.height); ctx.fillRect(0, 0, eraserWidth, canvas.height); }

                const baselineECG = canvas.height * 0.30;

                if (!props.showTraces) {
                    // Draw faint flatline
                    ctx.strokeStyle = '#111'; ctx.beginPath(); ctx.moveTo(prevX, baselineECG); ctx.lineTo(state.x, baselineECG); ctx.stroke();
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
                    state.lastYCO2 = canvas.height * 0.60;
                    state.lastYArt = canvas.height * 0.80;
                    state.lastYPleth = canvas.height - 10;
                }

                // 1. ECG (Green)
                const yECG = getWaveform(currentRhythm, state.beatProgress, props.isCPR, baselineECG);
                if (state.x > prevX) {
                    ctx.strokeStyle = '#00ff00'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.beginPath();
                    ctx.moveTo(prevX, state.lastY); ctx.lineTo(state.x, yECG); ctx.stroke();
                }
                state.lastY = yECG;

                // 2. ETCO2 (Yellow)
                if (props.showEtco2) {
                    const normCO2 = getEtco2Wave(state.breathProgress, props.pathology, props.rr);
                    const co2MaxHeight = canvas.height * 0.12; const co2BaseY = (canvas.height * 0.60); const yCO2 = co2BaseY - (normCO2 * co2MaxHeight);
                    if (state.x > prevX) {
                         ctx.strokeStyle = '#facc15'; ctx.lineWidth = 2.5; ctx.beginPath();
                         ctx.moveTo(prevX, state.lastYCO2); ctx.lineTo(state.x, yCO2); ctx.stroke();
                    }
                    state.lastYCO2 = yCO2;
                }

                // 3. ART LINE (Red)
                if (props.showArt && !props.isCPR && currentRate > 0) {
                     const normArt = getArtWave(state.beatProgress);
                     const artHeight = canvas.height * 0.12; const artBaseY = (canvas.height * 0.80); const yArt = artBaseY - (normArt * artHeight);
                     if (state.x > prevX) {
                        ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2.5; ctx.beginPath();
                        ctx.moveTo(prevX, state.lastYArt); ctx.lineTo(state.x, yArt); ctx.stroke();
                     }
                     state.lastYArt = yArt;
                }

                // 4. PLETH (Blue)
                if (currentRate > 0 && !props.isCPR && props.spO2 > 10) {
                    const normPleth = getPlethWave(state.beatProgress, props.spO2);
                    const plethHeight = canvas.height * 0.10; const plethBaseY = canvas.height - 10; const yPleth = plethBaseY - (normPleth * plethHeight);
                    if (state.x > prevX) {
                        ctx.strokeStyle = '#0ea5e9'; ctx.lineWidth = 2.5; ctx.beginPath();
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
            <div className={`w-full bg-black rounded border border-slate-700 relative overflow-hidden ${className}`}>
                <canvas ref={canvasRef} className="block w-full h-full"></canvas>
                
                {/* NEAT LABELS: Positioned in "Lanes" on the right side with background pills */}
                
                {/* Lane 1: ECG (Top) */}
                {showTraces && (
                    <div className="absolute top-[5%] right-2 bg-black/60 px-2 py-0.5 rounded border-l-2 border-green-500">
                        <span className="text-lg font-mono text-green-500 font-bold shadow-black drop-shadow-md">
                            {propsRef.current.rhythmLabel || rhythmType}
                        </span>
                    </div>
                )}
                
                {/* Lane 2: ETCO2 (Middle) */}
                {showEtco2 && showTraces && (
                    <div className="absolute top-[45%] right-2 bg-black/60 px-2 py-0.5 rounded border-l-2 border-yellow-500">
                        <span className="text-sm font-mono text-yellow-500 font-bold shadow-black drop-shadow-md">ETCO2</span>
                    </div>
                )}
                
                {/* Lane 3: ABP (Lower Middle) */}
                {showArt && showTraces && (
                    <div className="absolute top-[65%] right-2 bg-black/60 px-2 py-0.5 rounded border-l-2 border-red-500">
                        <span className="text-sm font-mono text-red-500 font-bold shadow-black drop-shadow-md">ABP</span>
                    </div>
                )}
                
                {/* Lane 4: PLETH (Bottom) */}
                {showTraces && (
                    <div className="absolute bottom-[5%] right-2 bg-black/60 px-2 py-0.5 rounded border-l-2 border-sky-500">
                        <span className="text-sm font-mono text-sky-500 font-bold shadow-black drop-shadow-md">PLETH</span>
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
