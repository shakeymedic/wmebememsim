(() => {
    const { useState, useEffect, useRef, useContext, createContext } = React;

    // =========================================================================================
    // PATIENT SCREENS, NUMBERED AND CHOSEN FROM THE CONTROLLER (window.SimScreens has the roles).
    //
    // A patient screen joins with the session code and nothing else. It announces itself in
    // sessions/<CODE>/presence/<its id> (role "screen:<what it shows now>"), and the CONTROLLER is
    // the only writer of sessions/<CODE>/screens/<id> = { n, role, ts }: it gives every new screen
    // the lowest free number and "Everything", and changes the role whenever the facilitator picks
    // something else. While a Screens panel is open on the controller, sessions/<CODE>/
    // screenIdentify is true and every screen shows its big number (like Windows' Identify); it is
    // removed when the panel closes, or if the controller goes away.
    // =========================================================================================
    const ScreenLinkContext = createContext(null);
    const RECENT_MS = 10 * 60 * 1000;     // a screen that dropped out stays listed (greyed) this long
    const STALE_MS = 30000;               // no heartbeat for this long (local clock) = not connected

    const useScreenLinkController = (sessionID, enabled) => {
        const S = window.SimScreens;
        const [presence, setPresence] = useState({});
        const [assigns, setAssigns] = useState({});
        // Nothing is numbered until the existing numbers have been read: otherwise a controller that
        // reloads would renumber every screen (and reset what it shows) from an empty list.
        const [assignsLoaded, setAssignsLoaded] = useState(false);
        const [, setTick] = useState(0);
        const beats = useRef({});         // id -> { ts, at }: when THIS computer last saw its heartbeat change
        const firstSeen = useRef({});     // id -> when this controller first saw it connected
        const lastSeen = useRef({});      // id -> when this controller last saw it connected
        const pending = useRef({});       // numbering writes not yet echoed back
        const identifyRef = useRef(false);   // a Screens panel is open (numbers wanted on the screens)
        const codeRef = useRef(sessionID);
        codeRef.current = sessionID;
        const db = window.db;
        const on = !!(enabled && db && sessionID);

        useEffect(() => {
            if (!on) return;
            const pRef = db.ref(`sessions/${sessionID}/presence`);
            const sRef = db.ref(`sessions/${sessionID}/screens`);
            const onP = (snap) => {
                const v = snap.val() || {};
                const now = Date.now();
                Object.keys(v).forEach(id => {
                    const ts = Number((v[id] || {}).ts) || 0;
                    const b = beats.current[id];
                    // A row seen for the first time counts as live only if its heartbeat is recent
                    // (2 minutes allows for a tablet's clock being a little out). A leftover row from
                    // a tab that froze or never ran its onDisconnect must not be numbered as a
                    // connected screen; if it is really alive, its next heartbeat makes it live.
                    if (!b) beats.current[id] = { ts, at: Math.abs(now - ts) < 120000 ? now : 0 };
                    else if (b.ts !== ts) beats.current[id] = { ts, at: now };
                });
                setPresence(v);
            };
            const onS = (snap) => { pending.current = {}; setAssigns(snap.val() || {}); setAssignsLoaded(true); };
            const onErr = (e) => console.warn('Screens read failed', e);
            pRef.on('value', onP, onErr);
            sRef.on('value', onS, onErr);
            const t = setInterval(() => setTick(x => x + 1), 5000);
            // onDisconnect() is one-shot: after a network blip on the controller the server has
            // already removed screenIdentify, so put it back (and re-arm) while a panel is open.
            const connRef = db.ref('.info/connected');
            const onConn = (snap) => { if (snap.val() === true && identifyRef.current) showNumbers(true); };
            connRef.on('value', onConn);
            return () => {
                pRef.off('value', onP); sRef.off('value', onS); clearInterval(t); connRef.off('value', onConn);
                beats.current = {}; firstSeen.current = {}; lastSeen.current = {}; pending.current = {};
                setPresence({}); setAssigns({}); setAssignsLoaded(false);
                try { db.ref(`sessions/${sessionID}/screenIdentify`).remove().catch(() => {}); } catch (e) {}
            };
        }, [on, sessionID]);

        const now = Date.now();
        const live = (id) => !!(presence[id] && beats.current[id] && (now - beats.current[id].at) < STALE_MS);
        const roleOfPresence = (id) => String((presence[id] || {}).role || '');
        const connectedIds = Object.keys(presence).filter(id => /^screen:/.test(roleOfPresence(id)) && live(id));
        connectedIds.forEach(id => { lastSeen.current[id] = now; if (!firstSeen.current[id]) firstSeen.current[id] = now; });
        const ids = connectedIds.concat(Object.keys(assigns).filter(id => !connectedIds.includes(id) && lastSeen.current[id] && (now - lastSeen.current[id]) < RECENT_MS));
        const screens = ids.map(id => {
            const a = assigns[id] || null;
            const requested = roleOfPresence(id).replace(/^screen:/, '');
            return {
                id,
                n: a && Number(a.n) >= 1 ? Number(a.n) : null,
                role: a && S.isRole(a.role) ? a.role : S.roleOf(requested),
                connected: connectedIds.includes(id),
                display: (presence[id] || {}).display || null,
                requested
            };
        }).sort((a, b) => (a.n || 999) - (b.n || 999) || (firstSeen.current[a.id] || 0) - (firstSeen.current[b.id] || 0));
        const kindOf = (id) => roleOfPresence(id);
        const others = Object.keys(presence).filter(id => live(id) && ['defib', 'vent'].includes(kindOf(id))).map(id => ({ id, kind: kindOf(id) }));
        const legacy = Object.keys(presence).filter(id => live(id) && ['all', 'monitor', 'devices'].includes(kindOf(id))).length;

        // Number every new screen, and untangle two connected screens that came back with the same
        // number (one dropped out and its number was given away): the one that arrived later moves.
        const sig = screens.map(s => `${s.id}:${s.n}:${s.connected ? 1 : 0}`).join('|') + '#' + Object.keys(assigns).length;
        useEffect(() => {
            if (!on || !assignsLoaded) return;
            const code = sessionID;
            const used = new Set(screens.filter(s => s.n).map(s => s.n));
            const free = () => { let n = 1; while (used.has(n)) n++; used.add(n); return n; };
            const byN = {};
            screens.filter(s => s.connected && s.n).forEach(s => { (byN[s.n] = byN[s.n] || []).push(s); });
            Object.keys(byN).forEach(k => {
                const list = byN[k];
                if (list.length < 2) return;
                list.sort((a, b) => (firstSeen.current[a.id] || 0) - (firstSeen.current[b.id] || 0) || (Number((assigns[a.id] || {}).ts) || 0) - (Number((assigns[b.id] || {}).ts) || 0));
                list.slice(1).forEach(s => {
                    if (pending.current[s.id]) return;
                    pending.current[s.id] = true;
                    db.ref(`sessions/${code}/screens/${s.id}`).update({ n: free(), ts: Date.now() }).catch(e => console.warn('Screen renumber failed', e));
                });
            });
            screens.filter(s => s.connected && !assigns[s.id] && !pending.current[s.id]).forEach(s => {
                pending.current[s.id] = true;
                db.ref(`sessions/${code}/screens/${s.id}`).set({ n: free(), role: S.isRole(s.requested) ? s.requested : 'all', ts: Date.now() })
                    .catch(e => { pending.current[s.id] = false; console.warn('Screen numbering failed', e); });
            });
        }, [on, assignsLoaded, sig]);

        const ref = (id) => window.db.ref(`sessions/${codeRef.current}/screens/${id}`);
        const setRole = (id, role) => {
            if (!window.db || !S.isRole(role) || !assigns[id]) return;
            ref(id).update({ role }).catch(e => console.warn('Screen change failed', e));
        };
        const applyPreset = (preset) => {
            screens.filter(s => s.connected && s.n && assigns[s.id]).forEach((s, i) => setRole(s.id, S.presetRole(preset, i)));
        };
        const forget = (id) => {
            if (!window.db) return;
            delete lastSeen.current[id];
            ref(id).remove().catch(() => {});
        };
        const showNumbers = (show) => {
            if (!window.db || !codeRef.current) return;
            identifyRef.current = !!show;
            const r = window.db.ref(`sessions/${codeRef.current}/screenIdentify`);
            if (show) { r.set(true).catch(() => {}); try { r.onDisconnect().remove().catch(() => {}); } catch (e) {} }
            else r.remove().catch(() => {});
        };
        return { ready: on, sessionID, screens, others, legacy, setRole, applyPreset, forget, showNumbers };
    };

    // ---- On a patient screen: its number, what the controller chose for it, and whether to show
    // the number now.
    const useMyScreen = (sessionID, id) => {
        const [mine, setMine] = useState(null);
        const [identify, setIdentify] = useState(false);
        useEffect(() => {
            const db = window.db;
            if (!db || !sessionID || !id) return;
            const r1 = db.ref(`sessions/${sessionID}/screens/${id}`);
            const r2 = db.ref(`sessions/${sessionID}/screenIdentify`);
            const on1 = (snap) => setMine(snap.val() || null);
            const on2 = (snap) => setIdentify(snap.val() === true);
            r1.on('value', on1, () => {});
            r2.on('value', on2, () => {});
            return () => { r1.off('value', on1); r2.off('value', on2); setMine(null); setIdentify(false); };
        }, [sessionID, id]);
        const S = window.SimScreens;
        return {
            n: mine && Number(mine.n) >= 1 ? Number(mine.n) : null,
            role: mine && S.isRole(mine.role) ? mine.role : null,
            identify
        };
    };

    // The big number on a patient screen. It never takes a press: the screen underneath keeps working.
    const ScreenNumberOverlay = ({ n, role }) => {
        const S = window.SimScreens;
        return (
            <div className="absolute inset-0 z-[300] pointer-events-none flex items-center justify-center p-4" data-testid="screen-number" aria-live="polite">
                <div className="flex flex-col items-center gap-3 bg-black/75 border-4 border-white/80 rounded-3xl px-10 py-6 shadow-2xl animate-fadeIn">
                    <div className={`rounded-2xl px-10 font-black leading-none ${S.numberColour(n)}`} style={{ fontSize: 'min(38vh, 38vw)' }}>{n || '?'}</div>
                    <div className="text-white text-2xl md:text-4xl font-bold text-center">{n ? `Screen ${n}` : 'New screen'}</div>
                    <div className="text-slate-200 text-lg md:text-2xl text-center">{S.ROLES[S.roleOf(role)].short}</div>
                </div>
            </div>
        );
    };

    const qrSvg = (url) => {
        try { const q = window.qrcode(0, 'M'); q.addData(url); q.make(); return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }).replace('<svg ', '<svg style="width:100%;height:100%;display:block" role="img" aria-label="QR code to join as a patient screen" '); }
        catch (e) { return null; }
    };
    const DISPLAY = { 'patient monitor': 'the monitor', 'arrest view': 'the monitor (arrest view)', defib: 'the defib', ventilator: 'the ventilator' };

    // Which connected screens show each part. Used by the panel and by the live-sim warning.
    const coverage = (screens) => {
        const S = window.SimScreens;
        const live = screens.filter(s => s.connected && s.n);
        const out = {};
        S.PARTS.forEach(p => { out[p] = live.filter(s => S.partsOf(s.role).includes(p)).map(s => s.n); });
        return out;
    };

    // =========================================================================================
    // THE SCREENS PANEL (start screen, live sim, Defib Sim). Every screen shows its number while
    // it is open.
    // =========================================================================================
    const ScreensPanel = ({ sessionID }) => {
        const { Button, Lucide } = window;
        const S = window.SimScreens;
        const link = useContext(ScreenLinkContext);
        const [blocked, setBlocked] = useState(false);
        const ready = !!(link && link.ready);
        useEffect(() => {
            if (!ready) return;
            link.showNumbers(true);
            return () => link.showNumbers(false);
        }, [ready, sessionID]);

        const url = S.screenUrl(sessionID);
        const site = (window.location.origin + window.location.pathname).replace(/^https?:\/\//, '').replace(/index\.html$/, '').replace(/\/$/, '');
        const screens = link ? link.screens : [];
        const connected = screens.filter(s => s.connected && s.n);
        const presets = S.presetsFor(connected.length);
        const cover = coverage(screens);
        const missing = connected.length ? S.PARTS.filter(p => !cover[p].length) : [];

        const toggle = (s, part) => {
            const parts = S.partsOf(s.role);
            const next = parts.includes(part) ? parts.filter(p => p !== part) : parts.concat([part]);
            const role = S.roleFromParts(next);
            if (role) link.setRole(s.id, role);
        };
        const openHere = () => { setBlocked(!S.openScreenWindow(sessionID)); };
        const svg = qrSvg(url);

        return (
            <div className="space-y-4 text-left" data-testid="screens-panel">
                <div className="flex flex-col sm:flex-row gap-4 bg-slate-800/60 border border-slate-700 rounded-lg p-3">
                    {svg && <div className="bg-white p-1.5 rounded w-32 h-32 flex-none self-center" data-testid="screens-qr" title={url} dangerouslySetInnerHTML={{ __html: svg }} />}
                    <div className="space-y-2 min-w-0">
                        <div className="font-bold text-white">Add a patient screen</div>
                        <ol className="text-xs text-slate-300 list-decimal pl-4 space-y-0.5">
                            <li>On the tablet, laptop or TV, scan this code. Or go to <b className="font-mono text-slate-100 break-all">{site}</b>, choose <b>Patient screen</b> and type <b className="font-mono text-white tracking-widest">{sessionID}</b>.</li>
                            <li>The screen shows a big number.</li>
                            <li>Below, choose what each numbered screen shows. You can change it at any time.</li>
                        </ol>
                        <div className="flex flex-wrap items-center gap-2">
                            <Button variant="outline" onClick={openHere} className="h-9 text-xs gap-1.5"><Lucide icon="external-link" className="w-4 h-4"/> Open a patient screen on this computer</Button>
                            <span className="text-[11px] text-slate-400">For a monitor, TV or projector plugged into this computer: drag the new window onto it and make it full screen (<kbd className="font-mono">F11</kbd>).</span>
                        </div>
                        {blocked && <p className="text-xs text-amber-300">The browser blocked the new window. Allow pop-ups for this site, or <a href={url} target="_blank" rel="noopener" className="underline">open it in a new tab</a> and drag the tab out into its own window.</p>}
                    </div>
                </div>

                {!ready && <p className="text-sm text-amber-300">The live session is not connected, so screens cannot be listed. Check the internet connection.</p>}

                {ready && screens.length === 0 && (
                    <div className="text-center border-2 border-dashed border-slate-700 rounded-lg p-5 text-slate-400" data-testid="screens-empty">
                        <Lucide icon="monitor" className="w-8 h-8 mx-auto mb-2 text-slate-500"/>
                        <div className="font-bold text-slate-300">No patient screens yet</div>
                        <div className="text-xs mt-1">Each one appears here, numbered, as soon as it joins.</div>
                    </div>
                )}

                {presets.length > 0 && (
                    <div>
                        <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-1">Quick set-up for {connected.length} screens</div>
                        <div className="flex flex-wrap gap-2">
                            {presets.map(p => {
                                const active = connected.every((s, i) => s.role === S.presetRole(p, i));
                                return (
                                    <button key={p.key} type="button" data-preset={p.key} aria-pressed={active} onClick={() => link.applyPreset(p)}
                                            className={`text-left rounded-lg border-2 px-3 py-2 flex flex-col gap-1 ${active ? 'border-sky-400 bg-sky-950/40' : 'border-slate-600 bg-slate-800 hover:border-slate-400'}`}>
                                        <span className="text-xs font-bold text-white">{p.label}</span>
                                        <span className="flex flex-wrap gap-1">
                                            {connected.map((s, i) => (
                                                <span key={s.id} className="flex items-center gap-1 text-[10px] text-slate-300">
                                                    <span className={`w-4 h-4 rounded text-[10px] font-black flex items-center justify-center ${S.numberColour(s.n)}`}>{s.n}</span>{S.ROLES[S.presetRole(p, i)].short}
                                                </span>
                                            ))}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {screens.length > 0 && (
                    <ul className="space-y-2" aria-label="Patient screens">
                        {screens.map(s => {
                            const parts = S.partsOf(s.role);
                            const label = s.n ? `Screen ${s.n}` : 'New screen';
                            return (
                                <li key={s.id} data-testid={`screen-row-${s.n || 'new'}`} className={`flex flex-wrap items-center gap-3 border rounded-lg p-3 ${s.connected ? 'bg-slate-800 border-slate-600' : 'bg-slate-900 border-slate-700 opacity-70'}`}>
                                    <div className={`w-14 h-14 rounded-xl flex-none flex items-center justify-center text-3xl font-black ${S.numberColour(s.n)}`} aria-hidden="true">{s.n || '…'}</div>
                                    <div className="flex-1 min-w-[9rem]">
                                        <div className="font-bold text-white">{label}</div>
                                        <div className="text-xs text-slate-400">
                                            {!s.n ? 'Numbering…' : s.connected ? <>Connected{s.display ? <>, showing {DISPLAY[s.display] || s.display}</> : null}</> : 'Not connected. If it comes back it keeps its number.'}
                                        </div>
                                    </div>
                                    <div role="group" aria-label={`What ${label.toLowerCase()} shows`} className="flex gap-1">
                                        {S.PARTS.map(p => {
                                            const isOn = parts.includes(p);
                                            const last = isOn && parts.length === 1;
                                            return (
                                                <button key={p} type="button" data-part={p} aria-pressed={isOn} disabled={!s.n || last}
                                                        onClick={() => toggle(s, p)}
                                                        title={last ? 'A screen has to show something: turn another one on first.' : `${isOn ? 'Take the' : 'Show the'} ${S.PART_LABELS[p].toLowerCase()} ${isOn ? 'off' : 'on'} ${label.toLowerCase()}`}
                                                        className={`min-h-[44px] px-3 rounded-lg border-2 flex items-center gap-1.5 text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${isOn ? 'bg-sky-700 border-sky-400 text-white' : 'bg-slate-900 border-slate-600 text-slate-300 hover:border-slate-400'} ${last ? 'cursor-not-allowed' : ''}`}>
                                                    <Lucide icon={isOn ? 'check-square' : 'square'} className="w-4 h-4"/>
                                                    <Lucide icon={S.PART_ICONS[p]} className="w-4 h-4"/> {S.PART_LABELS[p]}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {!s.connected && <Button variant="outline" onClick={() => link.forget(s.id)} className="h-9 text-xs">Remove</Button>}
                                    <p className="w-full text-xs text-slate-400 leading-snug">{S.ROLES[s.role].text}</p>
                                </li>
                            );
                        })}
                    </ul>
                )}

                {connected.length > 0 && (
                    <div className="space-y-1" data-testid="screens-coverage">
                        <div className="flex flex-wrap gap-2 text-xs">
                            {S.PARTS.map(p => (
                                <span key={p} data-cover={p} className={`px-2 py-1 rounded border font-bold flex items-center gap-1 ${cover[p].length ? 'border-emerald-700 bg-emerald-950/30 text-emerald-300' : 'border-amber-600 bg-amber-950/40 text-amber-300'}`}>
                                    <Lucide icon={S.PART_ICONS[p]} className="w-3 h-3"/> {S.PART_LABELS[p]}: {cover[p].length ? `screen ${cover[p].join(', ')}` : 'on no screen'}
                                </span>
                            ))}
                        </div>
                        {missing.length > 0 && <p className="text-xs text-amber-300">If you bring in the {missing.filter(p => p !== 'monitor').map(p => S.PART_LABELS[p].toLowerCase()).join(' or the ') || 'monitor'}, no screen will show it. Turn it on for one of the screens above.</p>}
                    </div>
                )}

                {link && link.others.length > 0 && (
                    <p className="text-xs text-slate-400" data-testid="screens-others">Also linked: {link.others.map(o => o.kind === 'vent' ? 'a ventilator page' : 'a defib page').join(', ')}. A page opened from a defib or ventilator link always shows that device. To choose what it shows here, open it as a patient screen instead.</p>
                )}
                {link && link.legacy > 0 && (
                    <p className="text-xs text-amber-300">{link.legacy === 1 ? 'A patient screen' : `${link.legacy} patient screens`} from an older version {link.legacy === 1 ? 'is' : 'are'} linked. Reload {link.legacy === 1 ? 'it' : 'them'} to number {link.legacy === 1 ? 'it' : 'them'} here.</p>
                )}
            </div>
        );
    };

    // A short line for the start screen: how many screens, and what each shows.
    const screensSummary = (link) => {
        const S = window.SimScreens;
        const c = link ? link.screens.filter(s => s.connected && s.n) : [];
        if (!c.length) return null;
        return c.map(s => `${s.n}: ${S.ROLES[s.role].short}`).join(' · ');
    };

    // On the live controller: a device that has been brought in but is on no connected screen.
    const ScreenDeviceWarning = ({ state, onOpen }) => {
        const { Lucide } = window;
        const link = useContext(ScreenLinkContext);
        if (!link || !link.ready) return null;
        const live = link.screens.filter(s => s.connected && s.n);
        if (!live.length) return null;
        const cover = coverage(link.screens);
        const lost = [];
        // A defib or ventilator tablet linked on its own (link.others) counts as showing that device.
        const tablet = (kind) => link.others.some(o => o.kind === kind);
        if (state.defibPanelOpen && !cover.defib.length && !tablet('defib')) lost.push('defib');
        if (state.ventPanelOpen && !cover.vent.length && !tablet('vent')) lost.push('ventilator');
        if (!lost.length) return null;
        // role="alert" on the button itself would hide that it is a button from screen readers.
        return (
            <span role="status" className="contents">
                <button type="button" onClick={onOpen} data-testid="screens-warning"
                        className="h-8 px-2 flex items-center gap-1 rounded border border-amber-500 bg-amber-950/60 text-amber-200 text-[10px] uppercase font-bold whitespace-nowrap">
                    <Lucide icon="alert-triangle" className="w-3 h-3"/> {lost.join(' and ')} on no screen
                </button>
            </span>
        );
    };

    // =========================================================================================
    // "SCREENS SHOW: MONITOR | DEFIB | VENTILATOR", at the top of the live controller.
    // One press puts that view in front on every patient screen that has it (state.screenFront,
    // carried to the screens in the live defib object). Defib and Ventilator bring the device in
    // first if it is not in the room yet. Monitor only changes what is in front: a defib or
    // ventilator already in the room stays loaded behind it (the ventilator keeps ventilating),
    // and the small x beside a device takes it away. Beside the buttons (wide screens), what each
    // numbered screen reports it is showing now. It sits in the "Patient now" strip's top line
    // (PatientStatusPanel's `extra`), so it costs the controller no extra height on a laptop.
    // =========================================================================================
    const SHOW_LABELS = { monitor: 'Monitor', defib: 'Defib', vent: 'Ventilator' };
    const SHOW_ICONS = { monitor: 'activity', defib: 'zap', vent: 'wind' };
    const SHOW_TONES = {
        monitor: { on: 'bg-sky-700 border-sky-300 text-white', off: 'bg-slate-900 border-sky-700/70 text-sky-300 hover:border-sky-400' },
        defib: { on: 'bg-amber-500 border-amber-200 text-black', off: 'bg-slate-900 border-amber-600/70 text-amber-300 hover:border-amber-400' },
        vent: { on: 'bg-cyan-500 border-cyan-200 text-black', off: 'bg-slate-900 border-cyan-700/70 text-cyan-300 hover:border-cyan-400' }
    };
    const SHOWING = { 'patient monitor': 'Monitor', 'arrest view': 'Monitor', defib: 'Defib', ventilator: 'Ventilator' };

    // What the screens have in front, as far as the controller knows: the last request, if the
    // device it names is still in the room, else the device most recently brought in, else the monitor.
    const frontViewOf = (state) => {
        const open = { monitor: true, defib: !!state.defibPanelOpen, vent: !!state.ventPanelOpen };
        const f = state.screenFront;
        if (f && open[f.view]) return f.view;
        return open.defib ? 'defib' : (open.vent ? 'vent' : 'monitor');
    };

    const PatientScreenSwitch = ({ sim, addLogEntry, showVent = true, onOpenScreens }) => {
        const { Lucide } = window;
        const link = useContext(ScreenLinkContext);
        const { state } = sim;
        const log = addLogEntry || sim.addLogEntry || (() => {});
        const views = showVent ? ['monitor', 'defib', 'vent'] : ['monitor', 'defib'];
        const inRoom = { monitor: true, defib: !!state.defibPanelOpen, vent: !!state.ventPanelOpen };
        const front = frontViewOf(state);
        const live = link && link.ready ? link.screens.filter(s => s.connected && s.n) : [];
        const cover = coverage(live);
        // A device tablet linked on its own (not a numbered screen) shows its device as well.
        const tablet = (k) => !!(link && link.others.some(o => o.kind === k));
        const ventilating = Object.values(state.ventMirror || {}).some(m => m && m.state === 'ventilating');

        const show = (view) => {
            if (view === 'defib' && !inRoom.defib) sim.dispatch({ type: 'SET_DEFIB_PANEL', payload: true });
            if (view === 'vent' && !inRoom.vent) sim.dispatch({ type: 'SET_VENT_PANEL', payload: true });
            sim.dispatch({ type: 'SET_SCREEN_FRONT', payload: view });
            if (view !== front) log(`Patient screens switched to the ${view === 'vent' ? 'ventilator' : view} (facilitator)`, 'system');
        };
        const takeAway = (view) => {
            if (view === 'vent' && ventilating && !window.confirm('Take the ventilator away? It closes on every patient screen, so the patient stops being ventilated.')) return;
            sim.dispatch({ type: view === 'defib' ? 'SET_DEFIB_PANEL' : 'SET_VENT_PANEL', payload: false });
            log(`${view === 'defib' ? 'Defib' : 'Ventilator'} taken off the patient screens (facilitator)`, 'system');
        };
        // The chosen view is on no connected screen (and no tablet), so nobody would see it.
        const unseen = live.length > 0 && !cover[front].length && !(front !== 'monitor' && tablet(front));

        return (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0" data-testid="screen-show-switch">
                <span className="text-[9px] uppercase font-bold text-slate-300 tracking-wider flex items-center gap-1 whitespace-nowrap">
                    <Lucide icon="monitor" className="w-3.5 h-3.5"/> Screens show
                </span>
                <div role="group" aria-label="What the patient screens show" className="flex gap-1">
                    {views.map(v => {
                        const on = front === v;
                        const name = v === 'vent' ? 'ventilator' : v;
                        return (
                            <span key={v} className="inline-flex">
                                <button type="button" data-show={v} aria-pressed={on} onClick={() => show(v)}
                                        aria-label={`${SHOW_LABELS[v]} on the patient screens`}
                                        title={v === 'monitor'
                                            ? 'Put the monitor in front on the patient screens. A defib or ventilator already in the room stays ready behind it.'
                                            : `Bring the ${name} in${inRoom[v] ? '' : ' (if it is not already)'} and put it in front on the patient screens.`}
                                        className={`h-8 px-2.5 border-2 flex items-center gap-1 text-xs font-bold whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${v !== 'monitor' && inRoom[v] ? 'rounded-l-lg' : 'rounded-lg'} ${on ? SHOW_TONES[v].on : SHOW_TONES[v].off}`}>
                                    <Lucide icon={SHOW_ICONS[v]} className="w-4 h-4"/> {SHOW_LABELS[v]}
                                </button>
                                {v !== 'monitor' && inRoom[v] && (
                                    <button type="button" data-take-away={v} onClick={() => takeAway(v)}
                                            aria-label={`Take the ${name} away`}
                                            title={`Take the ${name} away: it closes on every patient screen.`}
                                            className={`h-8 px-1 border-2 border-l-0 rounded-r-lg flex items-center ${on ? SHOW_TONES[v].on : SHOW_TONES[v].off}`}>
                                        <Lucide icon="x" className="w-3.5 h-3.5"/>
                                    </button>
                                )}
                            </span>
                        );
                    })}
                </div>
                {/* What each numbered screen reports it is showing now (wide screens; the badge in the toolbar has it too). */}
                <div className="max-xl:hidden flex flex-wrap items-center gap-1.5 text-[11px] text-slate-300 min-w-0" data-testid="screen-show-now">
                    {link && link.ready && live.length === 0 && (
                        <button type="button" onClick={onOpenScreens} className="underline text-slate-400 hover:text-white whitespace-nowrap">No patient screen yet</button>
                    )}
                    {live.map(s => (
                        <span key={s.id} className="flex items-center gap-1 whitespace-nowrap" data-screen-now={s.n}>
                            <span className={`w-5 h-5 rounded text-[11px] font-black flex items-center justify-center ${window.SimScreens.numberColour(s.n)}`}>{s.n}</span>
                            {SHOWING[s.display] || window.SimScreens.ROLES[s.role].short}
                        </span>
                    ))}
                </div>
                {unseen && (
                    <button type="button" onClick={onOpenScreens} data-testid="screen-show-unseen"
                            title="Open Screens and turn it on for one of the patient screens."
                            className="h-8 px-2 flex items-center gap-1 rounded border border-amber-500 bg-amber-950/60 text-amber-200 text-[10px] uppercase font-bold whitespace-nowrap">
                        <Lucide icon="alert-triangle" className="w-3 h-3"/> No screen is set to show the {front === 'vent' ? 'ventilator' : front}
                    </button>
                )}
            </div>
        );
    };

    Object.assign(window, { ScreenLinkContext, useScreenLinkController, useMyScreen, ScreenNumberOverlay, ScreensPanel, ScreenDeviceWarning, screensSummary, PatientScreenSwitch });
})();
