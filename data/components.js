(() => {
    const { useState, useEffect, useRef } = React;

    const BUFFER_SIZE = 1000;
    const precomputed = { ecg: {}, spo2: new Float32Array(BUFFER_SIZE), resp: new Float32Array(BUFFER_SIZE), co2: { normal: new Float32Array(BUFFER_SIZE), bronchospastic: new Float32Array(BUFFER_SIZE) }, art: new Float32Array(BUFFER_SIZE) };

    const pWave = (t) => 5 * Math.exp(-Math.pow(t - 0.1, 2) / 0.002);
    const qrsComplex = (t) => {
        let val = 0;
        val -= 5 * Math.exp(-Math.pow(t - 0.18, 2) / 0.0005);
        val += 40 * Math.exp(-Math.pow(t - 0.2, 2) / 0.0005);
        val -= 10 * Math.exp(-Math.pow(t - 0.22, 2) / 0.0005);
        return val;
    };
    const tWave = (t) => 8 * Math.exp(-Math.pow(t - 0.45, 2) / 0.005);

    const rhythms = ['Sinus Rhythm', 'Sinus Tachycardia', 'Sinus Bradycardia', 'SVT', 'PEA', '1st Deg Heart Block', 'Complete Heart Block', 'Atrial Flutter', 'VT'];
    rhythms.forEach(r => {
        precomputed.ecg[r] = new Float32Array(BUFFER_SIZE);
        for(let i=0; i<BUFFER_SIZE; i++) {
            const t = i / BUFFER_SIZE;
            let val = 0;
            if(r.includes('Sinus') || r==='PEA') val = pWave(t) + qrsComplex(t) + tWave(t);
            if(r==='SVT') val = qrsComplex(t) + tWave(t);
            if(r==='1st Deg Heart Block') val = pWave(t - 0.1) + qrsComplex(t) + tWave(t);
            if(r==='Complete Heart Block') val = pWave((t * 1.5) % 1) + qrsComplex(t) + tWave(t);
            if(r==='Atrial Flutter') val = (Math.sin(t * 30) * 5) + qrsComplex(t);
            if(r==='VT') val = 35 * Math.sin(t * 20);
            precomputed.ecg[r][i] = val;
        }
    });

    for(let i=0; i<BUFFER_SIZE; i++) {
        const t = i / BUFFER_SIZE;
        let spo2Val = Math.sin(t * Math.PI * 2) > 0 ? Math.sin(t * Math.PI * 2) * 20 : Math.sin(t * Math.PI * 2) * 5;
        spo2Val += Math.sin((t - 0.1) * Math.PI * 2 * 2) * 5;
        precomputed.spo2[i] = spo2Val;
        
        precomputed.resp[i] = Math.sin(t * Math.PI * 2) * 15;
        
        let co2N = 0;
        let co2B = 0;
        if (t < 0.1) { co2N = (t / 0.1) * 20; co2B = (t / 0.1) * 20; }
        else if (t < 0.5) { co2N = 20; co2B = 20 + ((t - 0.1) / 0.4) * 5; }
        else if (t < 0.6) { co2N = 20 - ((t - 0.5) / 0.1) * 20; co2B = 20 - ((t - 0.5) / 0.1) * 20; }
        precomputed.co2.normal[i] = co2N;
        precomputed.co2.bronchospastic[i] = co2B;
        
        let artVal = Math.sin(t * Math.PI * 2) > 0 ? Math.sin(t * Math.PI * 2) * 25 : Math.sin(t * Math.PI * 2) * 5;
        if (t > 0.3 && t < 0.5) artVal += 5;
        precomputed.art[i] = artVal;
    }

    const Lucide = ({ icon, className, onClick }) => {
        const icons = {
            'activity': '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>',
            'heart-pulse': '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M12 5 9.04 11H6"/><path d="M12 5l3 6h3"/>',
            'zap': '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>',
            'wind': '<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>',
            'droplet': '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"></path>',
            'thermometer': '<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"></path>',
            'loader-2': '<path d="M21 12a9 9 0 1 1-6.219-8.56"></path>',
            'alert-triangle': '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>',
            'check-circle': '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>',
            'x': '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
            'menu': '<line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="6" x2="20" y2="6"></line><line x1="4" y1="18" x2="20" y2="18"></line>',
            'play': '<polygon points="5 3 19 12 5 21 5 3"></polygon>',
            'pause': '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>',
            'square': '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>',
            'volume-2': '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>',
            'volume-x': '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line>',
            'arrow-left': '<line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline>',
            'clock': '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>',
            'list': '<line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line>',
            'monitor': '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line>',
            'user': '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle>',
            'info': '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>',
            'mic': '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line>',
            'message-square': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>',
            'minus': '<line x1="5" y1="12" x2="19" y2="12"></line>',
            'flag': '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line>',
            'stethoscope': '<path d="M4.8 2.3A5 5 0 0 0 3.8 7C2 7 0 9 0 12c0 2.2 1.6 4.3 3.5 4.9a5 5 0 0 0 .5-3.6"></path><path d="M22 10v7a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-7"></path><path d="M17 10V6a2 2 0 0 0-2-2h-3a2 2 0 0 0-2 2v1"></path><path d="M7 3v4a2 2 0 0 1-2 2H4"></path>',
            'ambulance': '<rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle>',
            'baby': '<path d="M9 12h.01"></path><path d="M15 12h.01"></path><path d="M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5"></path><path d="M19 6.3a9 9 0 0 1 1.8 3.9 2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 4 .5 5.7 1.6"></path><path d="M12 2v1"></path>',
            'skull': '<path d="m11.5 13.5-3.5 4"></path><path d="m12.5 13.5 3.5 4"></path><circle cx="9" cy="7" r="1.5"></circle><circle cx="15" cy="7" r="1.5"></circle><path d="M8 11.5v-1a4 4 0 0 1 8 0v1"></path><path d="M10.5 16.5h3"></path><path d="M22 12c0 5.5-4.5 10-10 10S2 17.5 2 12 6.5 2 12 2s10 4.5 10 10Z"></path>',
            'brain': '<path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"></path><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"></path>',
            'clipboard-check': '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path><path d="M14 13l2 2 4-4"></path>',
            'external-link': '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line>',
            'scan': '<path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path>',
            'image': '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path>',
            'flask-conical': '<path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"></path><line x1="8.5" y1="2" x2="15.5" y2="2"></line><line x1="8.5" y1="14" x2="15.5" y2="14"></line>',
            'waves': '<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"></path><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"></path><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"></path>',
            'check-square': '<polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>',
            'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>',
            'wifi': '<path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line>',
            'pill': '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"></path><path d="m8.5 8.5 7 7"></path>',
            'bell': '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
            'settings': '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle>',
            'check': '<polyline points="20 6 9 17 4 12"></polyline>',
            'heart': '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
            'upload': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line>'
        };

        return (
            <svg 
                xmlns="http://www.w3.org/2000/svg" 
                width="24" height="24" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2" 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                className={className}
                onClick={onClick}
                dangerouslySetInnerHTML={{ __html: icons[icon] || '' }}
            />
        );
    };

    const Button = ({ children, onClick, variant = 'primary', className = '', disabled = false, size = 'md' }) => {
        const baseClass = "rounded font-bold transition-all active:scale-95 flex items-center justify-center";
        const variants = {
            primary: "bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-900/50 border border-sky-500",
            secondary: "bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600",
            danger: "bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/50 border border-red-500",
            success: "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/50 border border-emerald-500",
            warning: "bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-900/50 border border-amber-500",
            outline: "bg-transparent border border-slate-600 text-slate-400 hover:border-slate-400 hover:text-slate-200"
        };
        const sizes = {
            sm: "px-2 py-1 text-xs",
            md: "px-4 py-2 text-sm",
            lg: "px-6 py-3 text-lg"
        };
        return (
            <button 
                onClick={onClick} 
                disabled={disabled} 
                className={`${baseClass} ${variants[variant]} ${sizes[size]} ${className} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                {children}
            </button>
        );
    };

    const Card = ({ children, title, className = '' }) => (
        <div className={`bg-slate-800 rounded border border-slate-700 p-4 ${className}`}>
            {title && <h3 className="text-sm font-bold text-slate-400 uppercase mb-2">{title}</h3>}
            {children}
        </div>
    );

    const ECGMonitor = ({ rhythmType, hr, rr, spO2, isPaused, showTraces, showEtco2, showArt, co2Pathology = 'normal', isCPR = false, className = '', rhythmLabel }) => {
        const canvasRef = useRef(null);
        const [width, setWidth] = useState(0);

        // Safety normalisation — maps legacy/shorthand rhythm names to canonical precomputed keys
        const ECG_NORM = {
            'Sinus Tachy': 'Sinus Tachycardia', 'Sinus Brady': 'Sinus Bradycardia',
            '1st Deg Block': '1st Deg Heart Block', '3rd Deg Block': 'Complete Heart Block',
            'STEMI': 'Sinus Tachycardia', 'NSR': 'Sinus Rhythm', 'Normal Sinus': 'Sinus Rhythm',
            'CHB': 'Complete Heart Block', 'chb': 'Complete Heart Block',
            'sinus_tach': 'Sinus Tachycardia', 'sinus_brady': 'Sinus Bradycardia', 'nsr': 'Sinus Rhythm',
        };
        const getECGValue = (t, type) => {
            const normType = ECG_NORM[type] || type;
            if (isCPR) return Math.sin(t * 15) * 25 + (Math.random() - 0.5) * 10;
            if (normType === 'VF') return (Math.sin(t * 15) * 15) + (Math.sin(t * 43) * 10) + (Math.random() * 5);
            if (normType === 'Asystole') return (Math.random() - 0.5) * 1;
            const idx = Math.floor(t * BUFFER_SIZE) % BUFFER_SIZE;
            if (normType === 'AF') return (Math.random() * 2) + (precomputed.ecg['SVT'] ? precomputed.ecg['SVT'][idx] : 0);
            return precomputed.ecg[normType] ? precomputed.ecg[normType][idx] : precomputed.ecg['Sinus Rhythm'][idx];
        };

        const getSPO2Value = (t) => {
            if (spO2 < 10) return 0;
            const idx = Math.floor(t * BUFFER_SIZE) % BUFFER_SIZE;
            return precomputed.spo2[idx];
        };

        const getRespValue = (t) => {
            const idx = Math.floor(t * BUFFER_SIZE) % BUFFER_SIZE;
            return precomputed.resp[idx];
        };
        
        const getCO2Value = (t) => {
            const idx = Math.floor(t * BUFFER_SIZE) % BUFFER_SIZE;
            return precomputed.co2[co2Pathology] ? precomputed.co2[co2Pathology][idx] : precomputed.co2.normal[idx];
        };
        
        const getArtValue = (t) => {
            const idx = Math.floor(t * BUFFER_SIZE) % BUFFER_SIZE;
            return precomputed.art[idx];
        };

        useEffect(() => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            
            const ctx = canvas.getContext('2d');
            let animationFrameId;
            let time = 0;
            let xPos = 0;
            const speed = 2; 

            let lastY = { ecg: null, spo2: null, art: null, resp: null, co2: null };
            
            const render = () => {
                if (!canvas.parentElement) return;
                const newWidth = canvas.parentElement.clientWidth;
                const newHeight = canvas.parentElement.clientHeight;
                if (canvas.width !== newWidth || canvas.height !== newHeight) {
                    canvas.width = newWidth;
                    canvas.height = newHeight;
                    setWidth(newWidth);
                    ctx.fillStyle = '#000';
                    ctx.fillRect(0, 0, newWidth, newHeight);
                }

                if (isPaused) return;

                ctx.fillStyle = 'rgba(0,0,0,1)';
                ctx.fillRect(xPos, 0, 10, canvas.height); 

                let numTraces = 1;
                if (showTraces) {
                    numTraces = 3;
                    if (showArt) numTraces++;
                    if (showEtco2) numTraces++;
                }
                const traceHeight = canvas.height / numTraces;
                let traceIdx = 0;

                const getBaseY = () => {
                    const y = traceHeight * (traceIdx + 0.5);
                    traceIdx++;
                    return y;
                };
                
                let ecgFreq = (hr > 0 ? hr : 60) / 60;
                if (rhythmType === 'VF') ecgFreq = 4; 
                if (rhythmType === 'Asystole') ecgFreq = 0.1;

                const cycleT = (time * ecgFreq) % 1;
                const ecgBaseY = getBaseY();
                const ecgY = ecgBaseY - getECGValue(cycleT, rhythmType) * (rhythmType === 'VF' ? 0.5 : 1);
                
                ctx.strokeStyle = '#22c55e'; 
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(xPos - speed, (lastY.ecg !== null ? lastY.ecg : ecgY));
                ctx.lineTo(xPos, ecgY);
                ctx.stroke();
                lastY.ecg = ecgY;

                if (showTraces) {
                    const spo2BaseY = getBaseY();
                    const spo2Cycle = (time * ecgFreq) % 1; 
                    const spo2Y = spo2BaseY - getSPO2Value(spo2Cycle);
                    
                    ctx.strokeStyle = '#3b82f6'; 
                    ctx.beginPath();
                    ctx.moveTo(xPos - speed, (lastY.spo2 !== null ? lastY.spo2 : spo2Y));
                    ctx.lineTo(xPos, spo2Y);
                    ctx.stroke();
                    lastY.spo2 = spo2Y;

                    if (showArt) {
                        const artBaseY = getBaseY();
                        const artCycle = (time * ecgFreq) % 1; 
                        const artY = artBaseY - getArtValue(artCycle);

                        ctx.strokeStyle = '#ef4444'; 
                        ctx.beginPath();
                        ctx.moveTo(xPos - speed, (lastY.art !== null ? lastY.art : artY));
                        ctx.lineTo(xPos, artY);
                        ctx.stroke();
                        lastY.art = artY;
                    }

                    const respBaseY = getBaseY();
                    const respFreq = (rr > 0 ? rr : 12) / 60;
                    const respCycle = (time * respFreq) % 1;
                    const respY = respBaseY - getRespValue(respCycle);
                    
                    ctx.strokeStyle = '#eab308'; 
                    ctx.beginPath();
                    ctx.moveTo(xPos - speed, (lastY.resp !== null ? lastY.resp : respY));
                    ctx.lineTo(xPos, respY);
                    ctx.stroke();
                    lastY.resp = respY;
                    
                    if (showEtco2) {
                        const co2BaseY = getBaseY();
                        const co2Freq = (rr > 0 ? rr : 12) / 60;
                        const co2Cycle = (time * co2Freq) % 1;
                        const shiftedCycle = (co2Cycle + 0.5) % 1; 
                        const co2Y = co2BaseY - getCO2Value(shiftedCycle);
                        
                        ctx.strokeStyle = '#a855f7'; 
                        ctx.beginPath();
                        ctx.moveTo(xPos - speed, (lastY.co2 !== null ? lastY.co2 : co2Y));
                        ctx.lineTo(xPos, co2Y); 
                        ctx.stroke();
                        lastY.co2 = co2Y;
                    }
                }

                xPos += speed;
                if (xPos >= canvas.width) {
                    xPos = 0;
                }
                
                time += 0.016; 
                animationFrameId = requestAnimationFrame(render);
            };
            
            animationFrameId = requestAnimationFrame(render);
            return () => cancelAnimationFrame(animationFrameId);
        }, [rhythmType, hr, rr, spO2, isPaused, showTraces, showEtco2, showArt, co2Pathology, isCPR]);

        let numTraces = 1;
        if (showTraces) {
            numTraces = 3;
            if (showArt) numTraces++;
            if (showEtco2) numTraces++;
        }

        const getTop = (idx) => `calc(${(100 / numTraces) * idx}% + 4px)`;

        return (
            <div className={`relative w-full bg-black ${className}`}>
                <canvas ref={canvasRef} className="block w-full h-full" />
                <div className="absolute left-2 text-green-500 font-mono text-xs font-bold" style={{ top: '4px' }}>{rhythmLabel || "LEAD II"}</div>
                {showTraces && <div className="absolute left-2 text-blue-500 font-mono text-xs font-bold" style={{ top: getTop(1) }}>PLETH</div>}
                {showTraces && showArt && <div className="absolute left-2 text-red-500 font-mono text-xs font-bold" style={{ top: getTop(2) }}>ART</div>}
                {showTraces && <div className="absolute left-2 text-yellow-500 font-mono text-xs font-bold" style={{ top: getTop(showArt ? 3 : 2) }}>RESP</div>}
                {showTraces && showEtco2 && <div className="absolute left-2 text-purple-500 font-mono text-xs font-bold" style={{ top: getTop(showArt ? 4 : 3) }}>CO2</div>}
                {isCPR && <div className="absolute top-2 right-2 bg-red-600 text-white px-2 py-1 text-xs font-bold animate-pulse">CPR DETECTED</div>}
            </div>
        );
    };

    const VitalDisplay = ({ label, value, value2, unit, alert, prev, visible, onClick, trend, isMonitor, hideTrends, isNIBP, lastNIBP }) => {
        if (!visible) return (
            <div className="bg-slate-900 border border-slate-800 rounded flex items-center justify-center opacity-50">
                <span className="text-slate-600 text-xs uppercase">{label} Off</span>
            </div>
        );

        let color = "text-green-500";
        if (label === 'SpO2') color = "text-blue-500";
        if (label === 'BP' || label === 'ABP' || label === 'NIBP') color = "text-red-500";
        if (label === 'RR') color = "text-yellow-500";
        if (label === 'ETCO2') color = "text-purple-500";
        if (label === 'Temp') color = "text-white";
        if (label === 'Glucose') color = "text-white";

        const trendIcon = trend ? (trend.progress > 0 ? (value > (prev || value) ? '↑' : '↓') : '') : '';

        if (isNIBP && isMonitor) {
            return (
                <div onClick={onClick} className={`relative bg-slate-900 border-2 rounded p-2 flex flex-col justify-between cursor-pointer transition-colors ${alert ? 'border-red-500 bg-red-900/20' : 'border-slate-800'}`}>
                     <div className="flex justify-between items-start">
                        <span className={`text-sm font-bold uppercase ${color}`}>{label}</span>
                        <span className="text-xs text-slate-400">{unit}</span>
                     </div>
                     <div className="flex items-end justify-center gap-1 my-1">
                         <span className={`text-5xl md:text-6xl lg:text-7xl font-mono font-bold leading-none ${color}`}>{value || '--'}</span>
                         <span className="text-2xl text-slate-500 font-bold mb-1">/</span>
                         <span className={`text-4xl md:text-5xl lg:text-6xl font-mono font-bold leading-none ${color}`}>{value2 || '--'}</span>
                     </div>
                     <div className="text-right text-[10px] text-slate-500 uppercase font-mono mt-auto">
                         {lastNIBP ? `Last: ${new Date(lastNIBP).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}` : 'No reading'}
                     </div>
                </div>
            );
        }

        return (
            <div onClick={onClick} className={`relative bg-slate-900 border-2 rounded p-2 flex flex-col justify-between cursor-pointer transition-colors overflow-hidden ${alert ? 'border-red-500 bg-red-900/20 animate-pulse' : 'border-slate-800 hover:border-slate-600'}`}>
                <div className="flex justify-between items-start">
                    <span className={`text-xs md:text-sm font-bold uppercase ${color}`}>{label}</span>
                    <span className="text-[10px] md:text-xs text-slate-400">{unit}</span>
                </div>
                
                <div className="flex items-baseline justify-center gap-1 h-full mt-2">
                    <span className={`text-5xl md:text-7xl lg:text-8xl font-mono font-bold tracking-tight ${color}`}>
                        {value2 ? `${value}/${value2}` : (value !== null ? value : '--')}
                    </span>
                    {trendIcon && <span className="text-xl md:text-3xl text-sky-400 absolute right-2 top-1/2 -translate-y-1/2">{trendIcon}</span>}
                </div>

                {!hideTrends && trend && trend.active && (
                    <div className="w-full bg-slate-800 h-1 mt-2 rounded overflow-hidden">
                        <div className="bg-sky-500 h-full transition-all duration-1000" style={{width: `${trend.progress * 100}%`}}></div>
                    </div>
                )}
            </div>
        );
    };

    window.Lucide = Lucide;
    window.Button = Button;
    window.Card = Card;
    window.ECGMonitor = ECGMonitor;
    window.VitalDisplay = VitalDisplay;
})();
