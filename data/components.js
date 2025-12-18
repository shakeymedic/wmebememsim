// data/components.js
(() => {
    const { useState, useEffect, useRef } = React;

    // SAFE LUCIDE COMPONENT
    const Lucide = React.memo(({ icon, className = "" }) => {
        const ref = useRef(null);
        useEffect(() => {
            const renderIcon = () => {
                if (!ref.current || !window.lucide) return;
                ref.current.innerHTML = '';
                const kebabToPascal = (str) => str.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
                const iconName = kebabToPascal(icon);
                if (window.lucide.icons && window.lucide.icons[iconName] && window.lucide.createElement) {
                    const svg = window.lucide.createElement(window.lucide.icons[iconName]);
                    if (className) svg.setAttribute('class', className);
                    ref.current.appendChild(svg);
                    return;
                }
                const i = document.createElement('i');
                i.setAttribute('data-lucide', icon);
                if (className) i.setAttribute('class', className);
                ref.current.appendChild(i);
                if (window.lucide.createIcons) {
                    window.lucide.createIcons({ root: ref.current, nameAttr: 'data-lucide', attrs: { class: className } });
                }
            };
            renderIcon();
            const timer = setTimeout(renderIcon, 500);
            return () => clearTimeout(timer);
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
    
    const VitalDisplay = ({ label, value, value2, prev, unit, lowIsBad = true, onUpdate, onClick, alert, isText = false, visible = true, isMonitor = false, hideTrends = false, isNIBP = false, lastNIBP = null, trend = null }) => {
        const [isEditing, setIsEditing] = useState(false);
        const [editVal, setEditVal] = useState(value);
        useEffect(() => { if (!isEditing) setEditVal(value); }, [value, isEditing]);
        const handleBlur = () => { setIsEditing(false); if (editVal !== value && onUpdate) onUpdate(isText ? editVal : parseFloat(editVal)); };

        const isBP = label.includes("BP") || label.includes("NIBP") || label.includes("ABP");
        const getColors = (lbl) => {
            if (lbl.includes("Heart") || lbl.includes("HR")) return "text-green-500";
            if (lbl.includes("SpO2") || lbl.includes("Pleth")) return "text-cyan-400"; 
            if (lbl.includes("BP") || lbl.includes("NIBP") || lbl.includes("ABP")) return "text-red-500";
            if (lbl.includes("Resp") || lbl.includes("RR")) return "text-yellow-400"; 
            if (lbl.includes("CO2") || lbl.includes("ETCO2")) return "text-yellow-500";
            return "text-slate-200";
        };
        const colorClass = getColors(label);
        const handleInteraction = () => { if (onClick) { onClick(); } else { setEditVal(value); setIsEditing(true); } };
        
        const displayValue = () => {
            if (label === "Pupils") return (typeof value === 'number') ? `${Math.round(value)}mm` : value;
            if (value === null || value === undefined) return '--';
            if (typeof value === 'string' && !isText) return value;
            return isText ? value : Math.round(value);
        };
        const displayValue2 = () => {
            if (value2 === undefined || value2 === null) return '--';
            if (typeof value2 === 'string' && !isText) return value2;
            return typeof value2 === 'number' ? Math.round(value2) : value2;
        };
        
        if (isMonitor) {
            if (!visible) return <div className="flex flex-col items-center justify-center h-full bg-slate-900/20 rounded border border-slate-800 opacity-20"><span className="text-2xl font-bold text-slate-600">{label}</span><span className="text-4xl font-mono text-slate-700">--</span></div>;
            return (
                <div className={`relative flex flex-col p-2 h-full bg-black overflow-hidden ${alert ? 'animate-pulse bg-red-900/30' : ''}`}>
                    {isNIBP && (<button onClick={onClick} className="absolute inset-0 z-20 w-full h-full cursor-pointer opacity-0 hover:opacity-10 transition-opacity bg-white" title="Cycle NIBP"></button>)}
                    <div className="flex justify-between items-start"><span className={`text-sm md:text-base font-bold ${colorClass} uppercase tracking-tight`}>{label}</span>{!isText && <div className="text-[10px] text-slate-500 flex flex-col items-end leading-tight"><span>150</span><span>50</span></div>}</div>
                    <div className="flex-grow flex items-center justify-center"><div className={`flex items-baseline ${colorClass} font-mono font-bold leading-none`}><span className={isText ? "text-4xl" : "text-6xl md:text-7xl tracking-tighter"}>{displayValue()}</span>{isBP && <span className="text-3xl md:text-4xl ml-1 text-slate-300 opacity-80">/{displayValue2()}</span>}</div></div>
                    <div className="flex justify-between items-end mt-1"><span className="text-xs text-slate-400 font-bold">{unit}</span>{isNIBP && (<div className="flex flex-col items-end"><span className="text-[10px] text-slate-500 font-mono">{lastNIBP ? `Last: ${Math.floor((Date.now() - lastNIBP)/60000)}m ago` : 'MANUAL'}</span><div className="text-[10px] bg-slate-800 text-slate-300 px-1 rounded border border-slate-600 mt-1 pointer-events-none">CYCLE</div></div>)}{!hideTrends && !isText && !isBP && value !== '?' && prev !== '?' && <span className={`text-lg font-bold ${value > prev ? 'text-emerald-500' : value < prev ? 'text-red-500' : 'text-slate-800'}`}>{value > prev ? '↑' : value < prev ? '↓' : ''}</span>}</div>
                </div>
            );
        }
        if (!visible) return (<div className="bg-slate-900/50 p-1 md:p-2 rounded border border-slate-800 flex flex-col items-center justify-center h-20 relative opacity-40"><span className="text-[9px] md:text-[10px] font-bold text-slate-600 uppercase tracking-wider">{label}</span><span className="text-xl font-mono text-slate-700">--</span></div>);
        const showEditHint = !isMonitor && visible;

        return (
            <div className={`bg-slate-900/50 p-1 md:p-2 rounded border flex flex-col items-center justify-center h-20 relative touch-manipulation transition-colors duration-300 overflow-hidden group ${alert ? 'border-red-500 bg-red-900/20' : 'border-slate-700 hover:border-sky-500 hover:bg-slate-800'}`} onClick={handleInteraction}>
                {showEditHint && (<div className="absolute top-1 right-1 text-slate-600 group-hover:text-sky-400 transition-colors"><Lucide icon="settings-2" className="w-3 h-3" /></div>)}
                {trend && trend.active && (<div className="absolute bottom-0 left-0 h-1.5 bg-sky-500/50 z-0 transition-all duration-1000 ease-linear" style={{ width: `${trend.progress * 100}%` }}></div>)}
                <span className="text-[9px] md:text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-0.5 relative z-10 group-hover:text-sky-400 transition-colors">{label}</span>
                {isEditing ? (<input type={isText ? "text" : "number"} value={editVal} onChange={(e) => setEditVal(e.target.value)} onBlur={handleBlur} onKeyDown={(e) => e.key === 'Enter' && handleBlur()} className="text-lg font-mono font-bold text-white bg-slate-800 border border-slate-500 rounded w-full text-center relative z-10" autoFocus />) : (<div className="flex items-baseline gap-1 cursor-pointer hover:bg-slate-800/50 rounded px-2 py-0.5 relative z-10" onClick={handleInteraction}><span className={`font-mono font-bold text-white ${isText ? 'text-lg' : 'text-2xl'}`}>{displayValue()}{isBP && <span className="text-lg text-slate-400 ml-0.5">/{displayValue2()}</span>}</span>{!isText && !isBP && value !== '?' && prev !== '?' && <span className={`text-[10px] font-bold ${value === prev ? 'text-slate-500' : (lowIsBad ? (value > prev ? 'text-emerald-400' : 'text-red-400') : (value > prev ? 'text-red-400' : 'text-emerald-400'))}`}>{value > prev ? '▲' : value < prev ? '▼' : '▬'}</span>}</div>)}
                <span className="text-[8px] md:text-[9px] text-slate-600 leading-none relative z-10">{unit}</span>
            </div>
        );
    };

    const ECGMonitor = ({ rhythmType, hr, isPaused, showEtco2, rr, pathology, co2Pathology, spO2, showTraces, showArt, isCPR, className = "h-40", rhythmLabel = null }) => {
        const canvasRef = useRef(null);
        const requestRef = useRef(null);
        const jitterRef = useRef(0);
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

        const propsRef = useRef({ rhythmType, hr, rr, showEtco2, pathology, co2Pathology, isPaused, spO2, showTraces, showArt, isCPR, rhythmLabel });

        useEffect(() => { 
            propsRef.current = { rhythmType, hr, rr, showEtco2, pathology, co2Pathology, isPaused, spO2, showTraces, showArt, isCPR, rhythmLabel }; 
        }, [rhythmType, hr, rr, showEtco2, pathology, co2Pathology, isPaused, spO2, showTraces, showArt, isCPR, rhythmLabel]);
        
        // --- IMPROVED WAVEFORM GENERATORS ---
        const getECGValue = (t, type, pathology, cpr) => {
            // t is 0..1 (progress through one beat)
            if (cpr) return (Math.sin(t * 2 * Math.PI) * 45) + (Math.random() * 5); // Consistent CPR oscillation
            
            // Stable baseline noise
            let noise = (Math.random() - 0.5) * 1.5; 
            
            if (type === 'Asystole') return noise;
            
            if (type === 'VF' || type === 'Coarse VF') {
                // Chaotic but continuous
                return (Math.sin(t * 20) * 15) + (Math.sin(t * 7) * 10) + noise * 5;
            }
            if (type === 'Fine VF') {
                return (Math.sin(t * 25) * 4) + (Math.sin(t * 10) * 3) + noise * 3;
            }
            if (type === 'VT' || type === 'pVT') {
                // Monomorphic VT - large sine-like waves
                return Math.sin(t * 2 * Math.PI) * 35;
            }
            
            // Standard P-QRS-T construction
            let y = 0;
            
            // P Wave (at 0.1)
            if (['Sinus Rhythm', 'Sinus Tachycardia', 'Sinus Bradycardia', '1st Deg Heart Block'].includes(type)) {
                y += 4 * Math.exp(-Math.pow(t - 0.1, 2) / 0.002);
            }
            // Flutter waves (sawtooth)
            if (type === 'Atrial Flutter') {
                y += 6 * Math.sin(t * 15);
            }
            // AF (fibrillatory baseline)
            if (type === 'AF') {
                y += (Math.random() - 0.5) * 3;
            }

            // QRS Complex (centered at 0.35)
            // Q
            y -= 5 * Math.exp(-Math.pow(t - 0.33, 2) / 0.0005);
            // R
            y += 50 * Math.exp(-Math.pow(t - 0.35, 2) / 0.0008);
            // S
            y -= 12 * Math.exp(-Math.pow(t - 0.37, 2) / 0.0005);

            // ST Segment & Pathology
            if (pathology === 'STEMI' || type === 'STEMI') {
                if (t > 0.38 && t < 0.6) {
                    y += 12 * Math.exp(-Math.pow(t - 0.48, 2) / 0.02); // Elevation
                }
            }

            // T Wave (at 0.6)
            y += 8 * Math.exp(-Math.pow(t - 0.6, 2) / 0.012);

            return y + noise;
        };

        const getPlethValue = (t) => {
            let y = 0;
            if (t < 0.2) { y = 30 * Math.sin((t / 0.2) * (Math.PI / 2)); } 
            else { y = 30 * Math.exp(-(t - 0.2) * 2.5); y += 5 * Math.exp(-Math.pow(t - 0.45, 2) / 0.01); }
            return y;
        };

        const getArtValue = (t) => {
            let y = 0;
            if (t < 0.15) { y = 40 * Math.sin((t / 0.15) * (Math.PI / 2)); } 
            else { y = 40 * Math.exp(-(t - 0.15) * 2.0); y += 8 * Math.exp(-Math.pow(t - 0.4, 2) / 0.005); }
            return y;
        };

        const getCO2Value = (t, pathology) => {
            // t is breath cycle 0..1
            // 0.0 - 0.4: Inspiration (CO2 ~ 0)
            // 0.4 - 0.5: Expiration Upstroke
            // 0.5 - 0.9: Alveolar Plateau
            // 0.9 - 1.0: Inspiration Downstroke
            
            let y = 0;
            const isObstructive = pathology === 'bronchospastic' || pathology === 'obstructive';

            if (t < 0.4) {
                y = 0; // Inspiration baseline
            } else if (t < 0.9) {
                // Expiration phase
                if (isObstructive) {
                    // Shark fin: slow exponential rise, no flat plateau
                    const phase = (t - 0.4) / 0.5;
                    y = 35 * (1 - Math.exp(-phase * 4)); 
                } else {
                    // Normal square wave
                    if (t < 0.45) {
                        // Sharp upstroke
                        y = 35 * ((t - 0.4) / 0.05);
                    } else {
                        // Slight incline plateau
                        y = 35 + (2 * (t - 0.45));
                    }
                }
            } else {
                // Rapid drop (Inspiration start)
                y = 37 * (1 - ((t - 0.9) / 0.1));
                if (y < 0) y = 0;
            }
            return y;
        };

        useEffect(() => {
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            const setSize = () => { 
                const parent = canvas.parentElement; 
                if(parent) { 
                    canvas.width = parent.clientWidth; 
                    canvas.height = parent.clientHeight; 
                    drawState.current.lastY = canvas.height * 0.30; 
                    drawState.current.lastYCO2 = canvas.height * 0.60; 
                    drawState.current.lastYArt = canvas.height * 0.80; 
                    drawState.current.lastYPleth = canvas.height - 20; 
                    ctx.fillStyle = '#000000'; 
                    ctx.fillRect(0,0, canvas.width, canvas.height); 
                } 
            };
            setSize(); window.addEventListener('resize', setSize);

            const animate = (timestamp) => {
                const state = drawState.current; 
                const props = propsRef.current;
                window.waveformGain = window.waveformGain || 1.0; 
                window.noise = window.noise || {};

                if (!state.lastTime) state.lastTime = timestamp;
                let dt = Math.min((timestamp - state.lastTime) / 1000, 0.05); 
                state.lastTime = timestamp;

                if (props.isPaused) { requestRef.current = requestAnimationFrame(animate); return; }

                const ecgSpeed = 150; 
                state.x += ecgSpeed * dt;
                const prevX = state.x - (ecgSpeed * dt);
                
                if (state.x + 30 < canvas.width) ctx.fillRect(state.x, 0, 35, canvas.height); 
                else { ctx.fillRect(state.x, 0, canvas.width - state.x, canvas.height); ctx.fillRect(0, 0, 30, canvas.height); }
                
                const baselineECG = canvas.height * 0.30;
                
                if (!props.showTraces) { 
                    ctx.strokeStyle = '#111'; ctx.beginPath(); ctx.moveTo(prevX, baselineECG); ctx.lineTo(state.x, baselineECG); ctx.stroke(); 
                    requestRef.current = requestAnimationFrame(animate); return; 
                }

                // Smooth HR jitter for AF
                let effectiveHR = props.hr;
                if (props.rhythmType === 'AF') {
                    if (state.beatProgress < 0.05 && Math.random() < 0.1) {
                         jitterRef.current = (Math.random() - 0.5) * 20; // Change rate slightly per beat
                    }
                    effectiveHR += jitterRef.current;
                }
                
                if (props.isCPR) effectiveHR = 110;
                else if (effectiveHR === 0 && ['VF','VT','pVT','PEA'].includes(props.rhythmType)) effectiveHR = 150; // Intrinsic rate of arrhythmia
                
                let beatDuration = 60 / Math.max(10, effectiveHR); 
                state.beatProgress += dt / beatDuration; 
                if (state.beatProgress >= 1) state.beatProgress = 0;

                let breathDuration = 60 / (Math.max(1, props.rr) || 12); 
                state.breathProgress += dt / breathDuration; 
                if (state.breathProgress >= 1) state.breathProgress = 0;

                if (state.x > canvas.width) { state.x = 0; state.lastY = baselineECG; }

                let rawECG = getECGValue(state.beatProgress, props.rhythmType, props.pathology, props.isCPR);
                const gain = window.waveformGain;
                let yECG = baselineECG - (rawECG * gain);
                if (window.noise.interference) yECG += Math.sin(timestamp / 20) * 5;

                if (state.x > prevX) { 
                    ctx.strokeStyle = '#00ff00'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; 
                    ctx.beginPath(); ctx.moveTo(prevX, state.lastY); ctx.lineTo(state.x, yECG); ctx.stroke(); 
                    
                    if (props.showEtco2) {
                        const baseCO2 = canvas.height * 0.60;
                        const rawCO2 = getCO2Value(state.breathProgress, props.co2Pathology);
                        const yCO2 = baseCO2 - rawCO2;
                        ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2; 
                        ctx.beginPath(); ctx.moveTo(prevX, state.lastYCO2); ctx.lineTo(state.x, yCO2); ctx.stroke();
                        state.lastYCO2 = yCO2;
                    }
                    if (props.showArt) {
                        const baseArt = canvas.height * 0.80;
                        const rawArt = getArtValue(state.beatProgress);
                        const yArt = baseArt - rawArt;
                        ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2; 
                        ctx.beginPath(); ctx.moveTo(prevX, state.lastYArt); ctx.lineTo(state.x, yArt); ctx.stroke();
                        state.lastYArt = yArt;
                    }
                    if (props.spO2 > 10) {
                        const basePleth = canvas.height - 15;
                        const rawPleth = getPlethValue(state.beatProgress);
                        const ampScale = Math.max(0.3, props.spO2 / 100); 
                        const yPleth = basePleth - (rawPleth * ampScale);
                        ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; 
                        ctx.beginPath(); ctx.moveTo(prevX, state.lastYPleth); ctx.lineTo(state.x, yPleth); ctx.stroke();
                        state.lastYPleth = yPleth;
                    }
                }
                state.lastY = yECG;
                requestRef.current = requestAnimationFrame(animate);
            };
            requestRef.current = requestAnimationFrame(animate);
            return () => { window.removeEventListener('resize', setSize); if (requestRef.current) cancelAnimationFrame(requestRef.current); };
        }, []);

        return (
            <div className={`w-full bg-black rounded border border-slate-700 relative overflow-hidden ${className} min-h-[150px]`}>
                <canvas ref={canvasRef} className="block w-full h-full"></canvas>
                {showTraces && <div className="absolute top-[5%] right-2 bg-black/60 px-2 py-0.5 rounded border-l-2 border-green-500"><span className="text-lg font-mono text-green-500 font-bold shadow-black drop-shadow-md">{propsRef.current.rhythmLabel || rhythmType}</span></div>}
            </div>
        );
    };

    const InvestigationButton = ({ type, icon, label, isRevealed, isLoading, revealInvestigation, isRunning, scenario }) => {
        const [isFlashing, setIsFlashing] = useState(false);
        const getResult = () => {
            if (!scenario) return "No data";
            if (type === 'ECG') return scenario.ecg ? scenario.ecg.findings : "Normal";
            if (type === 'VBG') {
                if (!scenario.vbg) return "Normal";
                const v = scenario.vbg;
                return `pH: ${v.pH.toFixed(2)} | pCO2: ${v.pCO2.toFixed(1)} | pO2: 5.5 | HCO3: ${v.HCO3.toFixed(1)} | BE: ${v.BE.toFixed(1)} | Lac: ${v.Lac.toFixed(1)} | K+: ${v.K.toFixed(1)} | Glu: ${v.Glu.toFixed(1)} | Ket: ${v.Ketones ? v.Ketones.toFixed(1) : '0.1'}`;
            }
            if (type === 'X-ray') return scenario.chestXray ? scenario.chestXray.findings : "Normal";
            if (type === 'Urine') return scenario.urine ? scenario.urine.findings : "Normal";
            if (type === 'CT') return scenario.ct ? scenario.ct.findings : "CT Head: No acute intracranial abnormality.";
            if (type === 'POCUS') return scenario.pocus ? scenario.pocus.findings : "No free fluid. Normal lung sliding.";
            return "No significant abnormalities.";
        };
        const isRepeatable = ['VBG', 'ECG', 'Obs', 'POCUS'].includes(type);
        const isDisabled = !isRunning || isLoading || (!isRepeatable && isRevealed);
        const handleClick = () => {
            if (isDisabled) return;
            setIsFlashing(true);
            setTimeout(() => setIsFlashing(false), 150);
            if (!isLoading) revealInvestigation(type);
        };
        return (
            <div className="flex flex-col bg-slate-900 border border-slate-700 rounded overflow-hidden">
                <button onClick={handleClick} disabled={isDisabled} className={`p-2 flex items-center justify-between text-xs font-bold w-full transition-colors duration-100 ${isFlashing ? 'flash-active' : ''} ${(!isRepeatable && isRevealed) ? 'bg-slate-800 text-slate-400' : 'bg-slate-700 hover:bg-slate-600 text-white'}`}>
                    <span className="flex items-center gap-2"><Lucide icon={icon} className="w-3 h-3" /> {isRevealed && isRepeatable ? `Repeat ${label}` : label}</span>
                    {isLoading && <Lucide icon="loader-2" className="w-3 h-3 animate-spin" />}
                </button>
                {isRevealed && (<div className="p-2 text-[10px] text-slate-300 bg-slate-800/50 leading-tight border-t border-slate-700 animate-fadeIn">{getResult()}</div>)}
            </div>
        );
    };

    window.Lucide = Lucide; window.Button = Button; window.Card = Card; window.VitalDisplay = VitalDisplay; window.ECGMonitor = ECGMonitor; window.InvestigationButton = InvestigationButton;
})();
