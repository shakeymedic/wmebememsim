(() => {
    const { useState, useEffect, useRef } = React;

    const BUFFER_SIZE = 1000;
    const precomputed = { ecg: {}, spo2: new Float32Array(BUFFER_SIZE), resp: new Float32Array(BUFFER_SIZE), art: new Float32Array(BUFFER_SIZE) };

    // --- WAVE 3: waveforms now come from THE SHARED RHYTHM REGISTRY (data/rhythms.js) ---
    // Every cycle-normalised morphology lives in window.RHYTHMS.waveforms and is shared verbatim
    // with the standalone defibrillator page. Previously this file carried its own private list of
    // 10 rhythm names and its own ECG_NORM alias table, while defib/index.html carried a different
    // list with different aliases; 115/254 scenarios fell through to a generic sinus complex and
    // PEA was drawn as a normal sinus rhythm.
    const RG = window.RHYTHMS;
    if (!RG) throw new Error('data/rhythms.js must load before data/components.js');

    // Precompute one buffer per WAVEFORM (not per rhythm name), so rhythms that legitimately share
    // a morphology (VT / pulseless VT) share one buffer and can never diverge.
    Object.keys(RG.waveforms).forEach(wf => {
        const fn = RG.waveforms[wf];
        const buf = new Float32Array(BUFFER_SIZE);
        for (let i = 0; i < BUFFER_SIZE; i++) buf[i] = fn(i / BUFFER_SIZE);
        precomputed.ecg[wf] = buf;
    });

    for(let i=0; i<BUFFER_SIZE; i++) {
        const t = i / BUFFER_SIZE;
        let spo2Val = Math.sin(t * Math.PI * 2) > 0 ? Math.sin(t * Math.PI * 2) * 20 : Math.sin(t * Math.PI * 2) * 5;
        spo2Val += Math.sin((t - 0.1) * Math.PI * 2 * 2) * 5;
        precomputed.spo2[i] = spo2Val;
        
        precomputed.resp[i] = Math.sin(t * Math.PI * 2) * 15;
        
        // WAVE 7: the old precomputed capnography buffers (a 20-unit trapezoid with no relation to
        // the numeric ETCO2 and no correct phase III) are GONE. Capnography is now generated from
        // RHYTHMS.capnogram(phase, kPa, pattern) at draw time so its amplitude equals the displayed
        // ETCO2 and abnormal patterns (shark fin, rebreathing, curare cleft) are expressible.

        // --- Arterial line (radial) ---
        // Anchored to ECG cycle: R wave at t≈0.205. Mechanical pulse arrives ~210 ms later
        // at the radial artery (peak at t≈0.42 of the cardiac cycle at 60 bpm).
        // Phases: end-diastolic plateau → anacrotic limb → systolic peak → systolic decline
        //         → dicrotic notch (aortic valve closure) → dicrotic wave (elastic recoil) → diastolic runoff
        const dia = 6;        // end-diastolic baseline
        let artVal;

        if (t < 0.30) {
            // Late-diastolic plateau (wraps continuously from prior beat's runoff)
            artVal = dia;
        } else if (t < 0.42) {
            // Anacrotic (ascending) limb — sharp rise
            const x = (t - 0.30) / 0.12;
            const ease = 1 - Math.pow(1 - x, 2.5);
            artVal = dia + 26 * ease;                                 // peaks at 32
        } else if (t < 0.62) {
            // Systolic decline (ease-out from peak toward J-point of art waveform)
            const x = (t - 0.42) / 0.20;
            artVal = 32 - 14 * (x * (2 - x));                         // 32 → 18
        } else if (t < 0.68) {
            // Dicrotic notch — brief dip at aortic valve closure
            const x = (t - 0.62) / 0.06;
            artVal = 18 - 3.5 * Math.sin(x * Math.PI);                // 18 → 14.5 → 18
        } else if (t < 0.78) {
            // Dicrotic wave — secondary rise from elastic recoil of the aorta
            const x = (t - 0.68) / 0.10;
            artVal = 18 + 4 * Math.sin(x * Math.PI);                  // 18 → 22 → 18
        } else {
            // Diastolic runoff — exponential decay back to baseline
            const x = (t - 0.78) / 0.22;
            artVal = dia + (18 - dia) * Math.exp(-3 * x);
        }

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
            // WAVE 5 / ITEM 2: the "partly done" state of a multi-component learning objective. Lucide
            // returns an EMPTY glyph for an unknown name, so a missing icon renders as blank space.
            'minus-square': '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="8" y1="12" x2="16" y2="12"></line>',
            'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>',
            'wifi': '<path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line>',
            'pill': '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"></path><path d="m8.5 8.5 7 7"></path>',
            'bell': '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
            'settings': '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle>',
            'check': '<polyline points="20 6 9 17 4 12"></polyline>',
            'heart': '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
            // WAVE 4b / D6: these were referenced by Wave 3 code (the presence badge and sync
            // badge) and by the new account UI, but had no glyph, so they rendered as an empty
            // <svg>. Silently-blank icons are exactly the misleading dead code this wave removes.
            'wifi-off': '<line x1="2" y1="2" x2="22" y2="22"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 4.17-2.65"/><path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76"/><path d="M16.85 11.25a10 10 0 0 1 2.22 1.68"/><path d="M5 13a10 10 0 0 1 5.24-2.76"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
            'monitor-off': '<path d="M17 17H4a2 2 0 0 1-2-2V5c0-1.5 1-2 1-2"/><path d="M22 15V5a2 2 0 0 0-2-2H9"/><path d="M8 21h8"/><path d="M12 17v4"/><line x1="2" y1="2" x2="22" y2="22"/>',
            'shield': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
            'log-in': '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>',
            'lock': '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
            'unlock': '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
            'sliders': '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
            'upload': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line>',
            'maximize': '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
            'minimize': '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
            'qr-code': '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3z"/><path d="M20 14v7"/><path d="M14 20h3"/>',
            'printer': '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
            'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M17.66 17.66l1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M6.34 17.66l-1.41 1.41"/><path d="M19.07 4.93l-1.41 1.41"/>'
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

    // WAVE 4b: `type` is threaded through so a Button can be a real form submit control (the
    // account sign-in form). Default stays 'button' so no existing Button inside a form can
    // accidentally start submitting.
    const Button = ({ children, onClick, variant = 'primary', className = '', disabled = false, size = 'md', href = null, target = null, ariaLabel = null, type = 'button' }) => {
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
        const classes = `${baseClass} ${variants[variant]} ${sizes[size]} ${className} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`;
        // Navigation buttons render as real anchors: browsers treat an anchor click as a
        // genuine user navigation, whereas a programmatic window.open() is silently blocked
        // by popup blockers (Safari, hardened Chrome, kiosk webviews).
        if (href && !disabled) {
            return (
                <a
                    href={href}
                    target={target || '_blank'}
                    rel="noopener noreferrer"
                    onClick={onClick}
                    className={classes}
                    aria-label={ariaLabel || undefined}
                >
                    {children}
                </a>
            );
        }
        return (
            <button
                type={type}
                onClick={onClick}
                disabled={disabled}
                className={classes}
                aria-label={ariaLabel || undefined}
            >
                {children}
            </button>
        );
    };



    // Shared modal shell: gives every overlay a dialog contract, keeps focus inside it, and restores
    // the invoking control when it closes. The visually-hidden label works even where a modal has a
    // custom visible heading.
    const Modal = ({ label, onClose, children, className = '' }) => {
        const dialogRef = useRef(null);
        const returnFocusRef = useRef(null);
        const closeRef = useRef(onClose);
        closeRef.current = onClose;
        const labelIdRef = useRef(`modal-label-${Math.random().toString(36).slice(2)}`);
        useEffect(() => {
            returnFocusRef.current = document.activeElement;
            const focusDialog = () => {
                const focusable = dialogRef.current?.querySelector('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
                (focusable || dialogRef.current)?.focus();
            };
            const timer = setTimeout(focusDialog, 0);
            const onKeyDown = (event) => {
                if (event.key === 'Escape') { event.preventDefault(); closeRef.current?.(); return; }
                if (event.key !== 'Tab' || !dialogRef.current) return;
                const focusables = Array.from(dialogRef.current.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
                if (!focusables.length) { event.preventDefault(); dialogRef.current.focus(); return; }
                const first = focusables[0], last = focusables[focusables.length - 1];
                if (!focusables.includes(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
                else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            };
            document.addEventListener('keydown', onKeyDown);
            return () => {
                clearTimeout(timer);
                document.removeEventListener('keydown', onKeyDown);
                returnFocusRef.current?.focus?.();
            };
        }, []);
        return (
            <div className="absolute inset-0 z-50 bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm">
                <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={labelIdRef.current} tabIndex="-1" className={className}>
                    <span id={labelIdRef.current} className="sr-only">{label}</span>
                    {children}
                </div>
            </div>
        );
    };

    const formatVitalValue = (value, decimals) => {
        if (!Number.isFinite(value)) return '--';
        return Number.isInteger(decimals) ? (Math.round(value * (10 ** decimals)) / (10 ** decimals)).toFixed(decimals) : value;
    };

    const Card = ({ children, title, className = '' }) => (
        <div className={`bg-slate-800 rounded border border-slate-700 p-4 ${className}`}>
            {title && <h3 className="text-sm font-bold text-slate-400 uppercase mb-2">{title}</h3>}
            {children}
        </div>
    );

    // =========================================================================================
    // WAVE 7 — ECGMonitor
    //
    // ROOT CAUSE OF THE REPORTED "ECG LOOKS IRREGULAR WHILE THE RATE RAMPS":
    // every trace derived its cycle position from ABSOLUTE animation time multiplied by the
    // CURRENT instantaneous rate — `const cycleT = (time * ecgFreq) % 1;`, with
    // `ecgFreq = live.hr / 60`. With a static HR that is fine. The moment the HR changes, the
    // WHOLE history is retroactively reinterpreted at the new rate: at t = 20 s, HR 75 puts the
    // cycle at phase 0.00 and HR 76 puts it at 0.33. Measured on the real draw loop, a
    // 75 -> 130 bpm ramp over 30 s produced a single-frame phase jump of up to 0.505 cycle and an
    // R-R coefficient of variation of 41.8% (0.4% at a static rate) with 13 of 51 intervals
    // getting LONGER while the rate rose. Sinus rhythm looked irregular because it WAS being
    // drawn irregular. The pleth (28.2% CV) and the resp trace (36.9% CV through an RR ramp) had
    // exactly the same defect.
    //
    // THE FIX: PHASE ACCUMULATORS. `ecgPhase` and `respPhase` increase monotonically and are
    // advanced each frame by `deltaTime * currentRate`, so a beat that has been drawn can never
    // move and only the spacing of FUTURE beats responds to a rate change — which is what a real
    // monitor does. The integer part of `ecgPhase` is the beat index, which is also what makes
    // per-beat irregularity (AF, flutter with variable block, Mobitz II dropped beats) expressible
    // and stable: see RHYTHMS.beatIntervalFactor / RHYTHMS.droppedBeat.
    //
    // ALSO WAVE 7: PER-TRACE TIME BASES. Real monitors run capnography far slower than the ECG
    // (~6.25-12.5 mm/s vs 25 mm/s) so several breaths are visible at once. Each trace is now a
    // LANE with its own sweep duration and its own sweep cursor: ECG/pleth/art/resp keep the 8 s
    // sweep, CO2 sweeps 30 s. Phase accumulation is completely independent of sweep speed, so a
    // slower time base cannot reintroduce the phase defect.
    // =========================================================================================
    const SWEEP_SECONDS = { ecg: 8, pleth: 8, art: 8, resp: 8, co2: 30 };

    const ECGMonitor = ({ rhythmType, hr, rr, spO2, etco2, isPaused, showTraces, showEtco2, showArt,
                          // WAVE 8 / FINDING 1: how obstructed the patient is, 0-1. Supplied by the
                          // engine's bronchospasm model (window.getObstruction); it scales the
                          // capnogram continuously from a normal trapezoid to a full shark fin.
                          co2Pathology = 'normal', co2Severity = 0,
                          ventilating = true, isCPR = false, className = '',
                          rhythmLabel, showSyncMarkers = false,
                          // WAVE 7 / ITEM 4: individually attachable sensors. Each trace can now be
                          // gated on its own sensor instead of one all-or-nothing flag. They default
                          // to the legacy behaviour (`showTraces` drives pleth + resp) so every
                          // existing call site keeps working unchanged.
                          showEcg = true, showPleth, showResp,
                          // Lanes that keep their place when their sensor is removed: the lane
                          // stays in the layout, goes BLANK immediately and is labelled as off,
                          // exactly as a real monitor shows "LEADS OFF" / "NO PROBE" rather than
                          // silently re-flowing the other traces. Default [] = legacy behaviour.
                          reserveLanes = [] }) => {
        const canvasRef = useRef(null);
        const [width, setWidth] = useState(0);

        const plethOn = showPleth === undefined ? !!showTraces : !!showPleth;
        const respOn = showResp === undefined ? !!showTraces : !!showResp;
        const artOn = !!showTraces && !!showArt;
        const co2On = !!showTraces && !!showEtco2;
        const drawn = { ecg: !!showEcg, pleth: plethOn, art: artOn, resp: respOn, co2: co2On };
        const reserved = (reserveLanes || []).reduce((m, k) => { m[k] = true; return m; }, {});
        // ONE lane order, shared by the draw loop and the labels, so a label can never sit over
        // the wrong trace. A lane is laid out if its trace is drawn OR it is reserved.
        const LANE_ORDER = ['ecg', 'pleth', 'art', 'resp', 'co2'];
        const layoutKeys = LANE_ORDER.filter(k => drawn[k] || reserved[k]);
        const drawnKeys = layoutKeys.filter(k => drawn[k]);
        const layoutSig = layoutKeys.join(',');
        const drawnSig = drawnKeys.join(',');

        // The animation state outlives any single run of the draw effect. Attaching or detaching a
        // sensor re-runs the effect; previously every re-run restarted the phase accumulators and
        // the sweep cursors from zero AND left the old picture on the canvas, so a removed trace
        // stayed on screen until the sweep happened to overwrite it (8 s, 30 s for CO2) — and
        // stayed FOREVER when no drawn lane was left to sweep over it.
        const animRef = useRef(null);
        if (animRef.current === null) animRef.current = { time: 0, ecgPhase: 0, respPhase: 0, lanes: {}, layoutSig: null, drawnSig: '' };

        // Keep frequently-changing values in refs so vitals updates don't tear down
        // and restart the animation loop (which would reset the sweep cursors and leave stale
        // trace to the right of the sweep).
        const liveRef = useRef({ rhythmType, hr, rr, spO2, etco2, co2Pathology, co2Severity, ventilating, isCPR, showSyncMarkers });
        liveRef.current = { rhythmType, hr, rr, spO2, etco2, co2Pathology, co2Severity, ventilating, isCPR, showSyncMarkers };

        // Rhythm resolution and waveform evaluation are delegated ENTIRELY to the registry
        // (data/rhythms.js). WAVE 7 removed the last of the duplicated evaluation logic that used
        // to live here — including a local Mobitz II branch that keyed the dropped beat to
        // `Math.floor(absTime / 1.2)` and produced a DIFFERENT dropped complex from the registry's.
        // `beat` is the beat index from the phase accumulator, so the drop is correct at any rate.
        const getECGValue = (cyclePhase, type, cpr, absTime = 0, beat = 0) =>
            RG.ecgValue(cyclePhase, absTime, type, { cpr, beat });

        // R-wave sync markers for synchronised cardioversion (C6). The registry knows where the R
        // wave sits in the cycle for every organised waveform, so the marker is drawn at the same
        // phase the complex actually peaks at.
        const R_PHASE = { sinus: 0.205, svt: 0.205, junctional: 0.205, af: 0.205, flutter: 0.205,
                          first_degree: 0.305, mobitz2: 0.205, chb: 0.205, vt: 0.20, pea: 0.26,
                          agonal: 0.30, paced: 0.205, stemi: 0.205, hyperkalaemia: 0.205, bbb: 0.200 };

        const getSPO2Value = (t, sat) => {
            if (sat < 10) return 0;
            const idx = Math.floor((t % 1) * BUFFER_SIZE) % BUFFER_SIZE;
            return precomputed.spo2[idx];
        };

        const getRespValue = (t) => {
            const idx = Math.floor((t % 1) * BUFFER_SIZE) % BUFFER_SIZE;
            return precomputed.resp[idx];
        };

        const getArtValue = (t) => {
            const idx = Math.floor((t % 1) * BUFFER_SIZE) % BUFFER_SIZE;
            return precomputed.art[idx];
        };

        useEffect(() => {
            const canvas = canvasRef.current;
            if (!canvas) return;

            const ctx = canvas.getContext('2d');
            let animationFrameId;
            const anim = animRef.current;
            let time = anim.time;    // absolute animation seconds — chaotic (VF) and dissociated
                                     // (AF baseline, CHB P waves, flutter sawtooth) components only
            let lastTs = null;

            // ---- PHASE ACCUMULATORS (the Wave 7 fix). Monotonically increasing, never recomputed
            // from absolute time, so past beats are immutable. Carried across effect re-runs.
            let ecgPhase = anim.ecgPhase;   // cardiac cycles since mount; Math.floor() is the beat index
            let respPhase = anim.respPhase; // respiratory cycles since mount

            // ---- per-lane sweep cursors. Each trace sweeps at its own speed, so they must not
            // share an x position or a lastY. Carried across re-runs so toggling one sensor does not
            // restart every other trace's sweep.
            const lanes = anim.lanes;
            const laneState = (key) => lanes[key] || (lanes[key] = { x: 0, lastY: null });

            // ---- BLANK WHAT WAS REMOVED, IMMEDIATELY (paused or not).
            // Layout changed (a lane added or dropped) -> the whole picture is stale: clear it and
            // restart every cursor. Same layout, a trace switched off -> clear just that lane.
            if (canvas.width > 0 && canvas.height > 0) {
                const prevDrawn = anim.drawnSig ? anim.drawnSig.split(',') : [];
                if (anim.layoutSig !== null && anim.layoutSig !== layoutSig) {
                    ctx.fillStyle = '#000';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    Object.keys(lanes).forEach(k => delete lanes[k]);
                } else if (anim.layoutSig === layoutSig) {
                    const h = canvas.height / Math.max(1, layoutKeys.length);
                    prevDrawn.filter(k => drawnKeys.indexOf(k) === -1).forEach(k => {
                        const i = layoutKeys.indexOf(k);
                        if (i !== -1) { ctx.fillStyle = '#000'; ctx.fillRect(0, h * i, canvas.width, h); }
                        delete lanes[k];
                    });
                }
            }
            anim.layoutSig = layoutSig;
            anim.drawnSig = drawnSig;

            const render = (ts) => {
                if (!canvas.parentElement) return;
                const newWidth = canvas.parentElement.clientWidth;
                const newHeight = canvas.parentElement.clientHeight;
                if (canvas.width !== newWidth || canvas.height !== newHeight) {
                    canvas.width = newWidth;
                    canvas.height = newHeight;
                    setWidth(newWidth);
                    ctx.fillStyle = '#000';
                    ctx.fillRect(0, 0, newWidth, newHeight);
                    // WAVE 7 / resizable controller panel: a resize invalidates every sweep cursor.
                    // Without this, a cursor left beyond the new width drew nothing until it wrapped
                    // and a stale lastY drew one long diagonal across the strip.
                    Object.keys(lanes).forEach(k => { lanes[k].x = Math.min(lanes[k].x, Math.max(0, newWidth - 1)); lanes[k].lastY = null; });
                }

                if (isPaused) return;

                // Frame-rate-independent timing
                if (lastTs === null) { lastTs = ts; animationFrameId = requestAnimationFrame(render); return; }
                const elapsed = Math.min((ts - lastTs) / 1000, 0.05); // seconds, capped to handle tab blur
                lastTs = ts;

                const live = liveRef.current;
                const W = canvas.width, Hgt = canvas.height;

                // -------- trace layout: one lane per drawn or reserved trace, top to bottom
                const numTraces = Math.max(1, layoutKeys.length);
                const traceHeight = Hgt / numTraces;
                const laneIdx = {};
                layoutKeys.forEach((k, i) => { laneIdx[k] = i; });

                // Draws one frame's worth of one lane, advancing that lane's own cursor.
                // `colour` is set immediately before the stroke so a recording context can attribute
                // each stroke to its trace.
                //
                // WAVE 8 (lower-priority live finding): A COMPLEX SITTING EXACTLY AT THE SWEEP CURSOR
                // RENDERED AS A ROUNDED HUMP. Two causes, both here, both fixed:
                //
                //  1. THE WRAP SEAM. The cursor was advanced past the right edge, the segment was
                //     drawn to that off-canvas x, and then `lastY` was thrown away (`lastY = null`)
                //     so the next frame restarted at the left edge from nowhere. A complex straddling
                //     the wrap therefore lost its steep limb and was drawn as a short near-horizontal
                //     stub — which, with `lineCap: 'round'` on a 2 px line, is exactly a rounded hump.
                //     The frame's travel is now SPLIT at the edge: the part before the wrap is drawn to
                //     x = W with the y interpolated at that instant, and drawing continues from x = 0
                //     at the SAME y. Continuity is preserved, nothing is drawn off-canvas, and the
                //     whole frame is still one path and one `stroke()` (two subpaths), so stroke
                //     accounting is unchanged.
                //
                //  2. FRAME-RATE ALIASING OF A NARROW R WAVE. One sample per frame means the R peak
                //     is hit only when a frame lands on it; at 60 bpm/60 fps a frame advances 1.7% of
                //     the cardiac cycle while the R wave occupies ~1%, so some beats were drawn tall
                //     and others clipped — the beat-to-beat amplitude variation the live tester saw.
                //     Callers may now pass SUB-SAMPLES for the frame (see the ECG lane below): the
                //     waveform is evaluated several times within the frame and drawn as a polyline,
                //     so the peak is captured whatever the frame rate.
                //
                // `samples` is an ordered array of y values across this frame; the last one is the
                // value AT the new cursor position. Omitted = one sample, as before.
                const drawLane = (key, colour, y, samples) => {
                    const st = laneState(key);
                    const sweep = SWEEP_SECONDS[key] || 8;
                    const speed = (W / sweep) * elapsed;
                    const top = traceHeight * laneIdx[key];
                    const eraseW = Math.max(3, (W / sweep) * 0.12);
                    // erase bar ahead of this lane's cursor, inside this lane only (wrapping round the
                    // right edge so the bar never disappears for a frame)
                    ctx.fillStyle = 'rgba(0,0,0,1)';
                    ctx.fillRect(st.x, top, eraseW, traceHeight);
                    if (st.x + eraseW > W) ctx.fillRect(0, top, st.x + eraseW - W, traceHeight);

                    const ys = (samples && samples.length) ? samples : [y];
                    const x0 = st.x;                       // where the previous frame left the cursor
                    ctx.strokeStyle = colour;
                    ctx.lineWidth = 2;
                    ctx.lineJoin = 'round';
                    ctx.lineCap = 'round';
                    ctx.beginPath();
                    let px = x0, py = st.lastY !== null ? st.lastY : ys[0];
                    ctx.moveTo(px, py);
                    for (let i = 0; i < ys.length; i++) {
                        const nx = x0 + speed * ((i + 1) / ys.length);
                        const ny = ys[i];
                        if (nx >= W && px < W) {
                            // split this sub-segment at the right edge, interpolating y at the edge
                            const f = (W - px) / Math.max(1e-6, nx - px);
                            const edgeY = py + (ny - py) * f;
                            ctx.lineTo(W, edgeY);
                            ctx.moveTo(0, edgeY);          // same path, new subpath: one stroke, no seam
                            px = 0; py = edgeY;
                            ctx.lineTo(nx - W, ny);
                        } else {
                            ctx.lineTo(nx >= W ? nx - W : nx, ny);
                        }
                        px = nx >= W ? nx - W : nx; py = ny;
                    }
                    ctx.stroke();
                    st.lastY = ys[ys.length - 1];
                    st.x = x0 + speed;
                    if (st.x >= W) st.x -= W;
                    return st;
                };

                // -------- RATE SELECTION (registry-driven).
                // A pulseless ORGANISED rhythm displays HR 0 but still has electrical activity, so it
                // must be drawn at a rhythm-appropriate intrinsic rate instead of silently defaulting
                // to 60/min (PEA previously drew a perfusing-looking trace at whatever rate the
                // numbers happened to hold).
                const rid = RG.canonical(live.rhythmType);
                const INTRINSIC = { 'PEA': 38, 'Agonal Rhythm': 14, 'pVT': 180, 'Paced': 70 };
                let ecgFreq;
                if (rid === 'VF') ecgFreq = 4;
                else if (rid === 'Fine VF') ecgFreq = 5;
                else if (rid === 'Asystole') ecgFreq = 0.1;
                else if (live.hr > 0) ecgFreq = live.hr / 60;
                else ecgFreq = (INTRINSIC[rid] || 60) / 60;

                // ---- ADVANCE THE PHASE. `beatIntervalFactor` lengthens or shortens INDIVIDUAL beats
                // for the rhythms that are supposed to be irregular; it returns exactly 1 for
                // everything that must stay regular, so a regular rhythm advances at precisely
                // deltaTime * rate and cannot drift.
                const prevEcgPhase = ecgPhase;
                const beatIdx = Math.floor(ecgPhase);
                const factor = RG.beatIntervalFactor ? RG.beatIntervalFactor(rid, beatIdx) : 1;
                ecgPhase += elapsed * ecgFreq / (factor > 0 ? factor : 1);
                const cycleT = ecgPhase - Math.floor(ecgPhase);

                const respFreq = (live.rr > 0 ? live.rr : 12) / 60;
                respPhase += elapsed * respFreq;
                const respCycle = respPhase - Math.floor(respPhase);

                // -------------------------------------------------- ECG
                let ecgBaseY = 0;
                if (showEcg) {
                    ecgBaseY = traceHeight * (laneIdx.ecg + 0.5);
                    const ecgAmp = (rid === 'VF' || rid === 'Fine VF') ? 0.5 : 1;
                    // WAVE 8: sub-sample the cardiac cycle WITHIN the frame. The R wave occupies about
                    // 1% of the cycle, so one sample per frame could straddle it and clip the peak —
                    // the beat-to-beat amplitude wobble seen live. One sample per <=0.4% of the cycle
                    // (up to 8) captures the peak at any heart rate and any frame rate, and the whole
                    // frame is still drawn as a single path with a single stroke().
                    const phaseAdvance = ecgPhase - prevEcgPhase;
                    const nSub = Math.max(1, Math.min(8, Math.ceil(phaseAdvance / 0.004)));
                    const ecgSamples = [];
                    for (let i = 1; i <= nSub; i++) {
                        const f = i / nSub;
                        const ph = prevEcgPhase + phaseAdvance * f;
                        const bi = Math.floor(ph);
                        ecgSamples.push(ecgBaseY - getECGValue(ph - bi, live.rhythmType, live.isCPR, time + elapsed * f, bi) * ecgAmp);
                    }
                    const ecgY = ecgSamples[ecgSamples.length - 1];
                    drawLane('ecg', '#22c55e', ecgY, ecgSamples);

                    // C6: R-wave synchronisation markers. When the defibrillator is in SYNC mode the
                    // device must visibly mark the R waves it will fire on, otherwise "synchronised"
                    // is an invisible flag (which is exactly what it was before Wave 3).
                    if (live.showSyncMarkers && !live.isCPR) {
                        const rPhase = R_PHASE[RG.waveformFor(rid)];
                        if (rPhase !== undefined) {
                            // Phase is monotonic now, so "did we cross the R wave this frame?" is a
                            // plain comparison on the accumulator instead of modulo gymnastics.
                            const crossed = Math.floor(prevEcgPhase - rPhase + 1) !== Math.floor(ecgPhase - rPhase + 1);
                            if (crossed && !(RG.droppedBeat && RG.droppedBeat(rid, beatIdx))) {
                                const st = laneState('ecg');
                                ctx.save();
                                ctx.strokeStyle = '#facc15';
                                ctx.lineWidth = 2;
                                ctx.beginPath();
                                ctx.moveTo(st.x, ecgBaseY - traceHeight * 0.42);
                                ctx.lineTo(st.x, ecgBaseY - traceHeight * 0.30);
                                ctx.stroke();
                                ctx.restore();
                            }
                        }
                    }
                }

                // -------------------------------------------------- PLETH
                // Driven by the SAME cardiac phase accumulator as the ECG, so there is exactly one
                // pulse wave per QRS and the pleth tracks the heart rate through a ramp by
                // construction rather than by coincidence.
                if (plethOn) {
                    const spo2BaseY = traceHeight * (laneIdx.pleth + 0.5);
                    const spo2Y = spo2BaseY - getSPO2Value(cycleT, live.spO2);
                    drawLane('pleth', '#3b82f6', spo2Y);
                }

                // -------------------------------------------------- ARTERIAL LINE
                if (artOn) {
                    const artBaseY = traceHeight * (laneIdx.art + 0.5);
                    const artY = artBaseY - getArtValue(cycleT);
                    drawLane('art', '#ef4444', artY);
                }

                // -------------------------------------------------- RESP (chest-wall impedance)
                // A smooth sinusoid is the CORRECT shape for a thoracic impedance trace. It is a
                // different measurement from capnography, which is drawn below with a real
                // capnogram morphology on its own slower time base.
                if (respOn) {
                    const respBaseY = traceHeight * (laneIdx.resp + 0.5);
                    const respY = respBaseY - getRespValue(respCycle);
                    drawLane('resp', '#eab308', respY);
                }

                // -------------------------------------------------- CAPNOGRAPHY (ETCO2)
                // 30 s sweep, real trapezoidal capnogram, amplitude scaled from the DISPLAYED
                // numeric ETCO2 so the plateau and the number always agree. No ventilation means no
                // capnogram at all (oesophageal intubation / disconnection / apnoea): a flat line is
                // the teaching point, and drawing a waveform there would teach the opposite.
                if (co2On) {
                    const co2Lane = traceHeight * laneIdx.co2;
                    const co2ZeroY = co2Lane + traceHeight * 0.86;     // zero baseline near lane floor
                    const co2Scale = (traceHeight * 0.72) / 8;         // px per kPa (8 kPa full scale)
                    const kPa = Number.isFinite(live.etco2) ? live.etco2 : 5.0;
                    let co2Y;
                    if (!live.ventilating || !(kPa > 0)) {
                        co2Y = co2ZeroY;                                // flat zero, no waveform
                    } else {
                        // Capnography lags the compression/breath cycle in the airway, hence the
                        // half-cycle offset kept from the previous implementation.
                        const phase = (respCycle + 0.5) % 1;
                        // WAVE 8 / FINDING 1: the obstruction severity scales the shape continuously
                        // from a normal trapezoid (0) to an unmistakable shark fin (1). Treating the
                        // bronchospasm lowers the severity, so the trace visibly normalises.
                        let v = RG.capnogram(phase, kPa, live.co2Pathology, live.co2Severity);
                        // During CPR the capnogram is small and shows the compression rate; ETCO2
                        // RISING is the classic sign of ROSC, and that falls out of the numeric
                        // value driving the amplitude.
                        if (live.isCPR) v += Math.max(0, kPa * 0.10) * Math.sin(time * 2 * Math.PI * 1.83);
                        co2Y = co2ZeroY - v * co2Scale;
                    }
                    drawLane('co2', '#a855f7', co2Y);
                }

                time += elapsed;
                anim.time = time; anim.ecgPhase = ecgPhase; anim.respPhase = respPhase;
                animationFrameId = requestAnimationFrame(render);
            };

            animationFrameId = requestAnimationFrame(render);
            return () => cancelAnimationFrame(animationFrameId);
        }, [isPaused, layoutSig, drawnSig]);

        // Labels follow the SAME lane order the draw loop uses, so a label can never sit over the
        // wrong trace when a sensor is attached or detached mid-session.
        const numTraces = Math.max(1, layoutKeys.length);
        const topOf = (key) => `calc(${(100 / numTraces) * layoutKeys.indexOf(key)}% + 4px)`;
        // A reserved lane whose sensor is off: blank, with the reason in dim grey.
        const OFF_TEXT = { ecg: `${rhythmLabel || 'LEAD II'} \u2014 leads off`, pleth: 'PLETH \u2014 no probe', art: 'ART \u2014 off', resp: 'RESP \u2014 leads off', co2: 'CO2 \u2014 off' };
        const offLanes = layoutKeys.filter(k => !drawn[k]);
        // WAVE 7 / BUG 2: the trace labels carry their own opaque chip. The previous fix nudged the
        // controller's overlay buttons sideways, which still clipped "LEAD II" at narrow panel
        // widths; the buttons have now moved OUT of the canvas entirely (see livesim.js) and the
        // chip guarantees the label stays legible against any trace behind it.
        const labelClass = 'absolute left-2 font-mono text-xs font-bold px-1 rounded bg-black/70 pointer-events-none z-20';

        return (
            <div className={`relative w-full bg-black ${className}`}>
                <canvas ref={canvasRef} className="block w-full h-full" />
                {offLanes.map(k => <div key={`off-${k}`} className={`${labelClass} text-slate-500 uppercase tracking-wider`} style={{ top: topOf(k) }}>{OFF_TEXT[k]}</div>)}
                {showEcg && <div className={`${labelClass} text-green-500`} style={{ top: topOf('ecg') }}>{rhythmLabel || "LEAD II"}</div>}
                {plethOn && <div className={`${labelClass} text-blue-500`} style={{ top: topOf('pleth') }}>PLETH</div>}
                {artOn && <div className={`${labelClass} text-red-500`} style={{ top: topOf('art') }}>ART</div>}
                {respOn && <div className={`${labelClass} text-yellow-500`} style={{ top: topOf('resp') }}>RESP</div>}
                {co2On && <div className={`${labelClass} text-purple-500`} style={{ top: topOf('co2') }}>CO2 <span className="text-purple-300/70 font-normal">30s</span></div>}
                {co2On && !ventilating && <div className="absolute right-2 text-purple-300 font-mono text-[10px] font-bold uppercase tracking-wider" style={{ top: topOf('co2') }}>no capnogram — not ventilating</div>}
                {isCPR && <div className="absolute top-2 right-2 bg-red-600 text-white px-2 py-1 text-xs font-bold animate-pulse">CPR IN PROGRESS</div>}
                {showSyncMarkers && !isCPR && <div className="absolute bottom-1 right-2 text-yellow-400 font-mono text-[10px] font-bold tracking-widest">SYNC</div>}
            </div>
        );
    };

    const VitalDisplay = ({ label, value, value2, unit, alert, prev, visible, onClick, trend, isMonitor, hideTrends, isNIBP, lastNIBP,
                            // Controller-only hint (e.g. "not on monitor"): the facilitator always sees the
                            // true value, and this says whether the team can currently see it too.
                            note }) => {
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
        if (label === 'pH') color = "text-white";

        const trendIcon = trend?.active && Number.isFinite(trend.target) && Number.isFinite(value)
            ? (trend.target > value ? '↑' : trend.target < value ? '↓' : '') : '';

        // A pulseless arrest legitimately reads 0/0, so truthiness is the wrong test here. All
        // numeric fields use one finite-value formatter; the only text vital is the pupil descriptor.
        const hasValue2 = Number.isFinite(value2);
        const show = (v) => label === 'Pupils' && typeof v === 'string'
            // pH needs 2 dp and temp/glucose 1 dp, otherwise a modelled value like 7.35 or 36.85
            // would render at full float precision on the tile.
            ? v : formatVitalValue(v, label === 'pH' ? 2 : (label === 'ETCO2' || label === 'Temp' || label === 'Glucose') ? 1 : undefined);

        const Tile = onClick ? 'button' : 'div';
        const tileProps = onClick ? { type: 'button', onClick, 'aria-label': `Adjust ${label}` } : {};
        if (isNIBP && isMonitor) {
            return (
                <Tile {...tileProps} className={`relative bg-slate-900 border-2 rounded p-2 flex flex-col justify-between ${onClick ? 'cursor-pointer' : ''} transition-colors ${alert ? 'border-red-500 bg-red-900/20' : 'border-slate-800'}`}>
                     <div className="flex justify-between items-start">
                        <span className={`text-sm font-bold uppercase ${color}`}>{label}</span>
                        <span className="text-xs text-slate-400">{unit}</span>
                     </div>
                     <div className="flex items-end justify-center gap-1 my-1">
                         <span className={`text-5xl md:text-6xl lg:text-7xl font-mono font-bold leading-none ${color}`}>{show(value)}</span>
                         <span className="text-2xl text-slate-500 font-bold mb-1">/</span>
                         <span className={`text-4xl md:text-5xl lg:text-6xl font-mono font-bold leading-none ${color}`}>{show(value2)}</span>
                     </div>
                     <div className="text-right text-[10px] text-slate-500 uppercase font-mono mt-auto">
                         {note && <span className="mr-2 px-1 rounded border border-slate-600 text-slate-300 font-bold tracking-wider">{note}</span>}
                         {lastNIBP ? `Last: ${new Date(lastNIBP).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}` : 'No reading'}
                     </div>
                </Tile>
            );
        }

        return (
            <Tile {...tileProps} className={`relative bg-slate-900 border-2 rounded p-2 flex flex-col justify-between ${onClick ? 'cursor-pointer' : ''} transition-colors overflow-hidden ${alert ? 'border-red-500 bg-red-900/20 animate-pulse' : 'border-slate-800 hover:border-slate-600'}`}>
                <div className="flex justify-between items-start">
                    <span className={`text-xs md:text-sm font-bold uppercase ${color}`}>{label}</span>
                    <span className="text-[10px] md:text-xs text-slate-400">{unit}</span>
                </div>
                
                <div className="flex items-baseline justify-center gap-1 h-full mt-2">
                    <span className={`${hasValue2 ? 'text-3xl md:text-4xl lg:text-5xl' : 'text-5xl md:text-7xl lg:text-8xl'} font-mono font-bold tracking-tight ${color}`}>
                        {hasValue2 ? `${show(value)}/${show(value2)}` : show(value)}
                    </span>
                    {trendIcon && <span className="text-xl md:text-3xl text-sky-400 absolute right-2 top-1/2 -translate-y-1/2">{trendIcon}</span>}
                </div>

                {note && <span className="absolute right-2 top-6 md:top-7 text-right text-[9px] leading-none uppercase tracking-wider font-bold text-amber-400/90 pointer-events-none">{note}</span>}
                {!hideTrends && trend && trend.active && (
                    <div className="w-full bg-slate-800 h-1 mt-2 rounded overflow-hidden">
                        <div className="bg-sky-500 h-full transition-all duration-1000" style={{width: `${trend.progress * 100}%`}}></div>
                    </div>
                )}
            </Tile>
        );
    };

    // A render error anywhere below React's root unmounts the whole tree and leaves a blank page
    // that only a reload recovers from. This keeps the facilitator in the app with a way out.
    class ErrorBoundary extends React.Component {
        constructor(props) { super(props); this.state = { error: null }; }
        static getDerivedStateFromError(error) { return { error }; }
        componentDidCatch(error, info) { console.error("Render error caught by boundary:", error, info); }
        render() {
            if (!this.state.error) return this.props.children;
            return (
                <div className="h-full w-full flex items-center justify-center p-6 bg-slate-900">
                    <div className="max-w-lg w-full bg-slate-800 border border-red-500/60 rounded-lg p-6 shadow-2xl space-y-4">
                        <h2 className="text-xl font-bold text-red-400">Something went wrong</h2>
                        <p className="text-sm text-slate-300">
                            This screen failed to render. Your session was not lost — you can return to the main menu and start or reload a scenario.
                        </p>
                        <pre className="text-[11px] text-slate-500 bg-slate-900 border border-slate-700 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                            {String(this.state.error && this.state.error.message || this.state.error)}
                        </pre>
                        <div className="flex gap-2">
                            <Button variant="primary" className="flex-1" onClick={() => {
                                this.setState({ error: null });
                                if (this.props.onReset) this.props.onReset();
                            }}>Return to Main Menu</Button>
                            <Button variant="outline" className="flex-1" onClick={() => window.location.reload()}>Reload App</Button>
                        </div>
                    </div>
                </div>
            );
        }
    }

    // Human factors modifier indicator — must stay visible for the whole sim so the facilitator
    // does not forget which constraint the team is working under.
    const HumanFactorBadge = ({ hf, className = "" }) => {
        if (!hf || !hf.type || hf.id === 'hf0') return null;
        return (
            <span
                title={hf.description || ''}
                className={`inline-flex items-center gap-1 bg-fuchsia-900/40 border border-fuchsia-500/60 text-fuchsia-300 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${className}`}
            >
                <Lucide icon="user" className="w-3 h-3" />
                Human Factor: {hf.type}
            </span>
        );
    };

    window.Lucide = Lucide;
    window.ErrorBoundary = ErrorBoundary;
    window.HumanFactorBadge = HumanFactorBadge;
    window.Button = Button;
    window.Modal = Modal;
    window.Card = Card;
    window.ECGMonitor = ECGMonitor;
    window.VitalDisplay = VitalDisplay;
})();
