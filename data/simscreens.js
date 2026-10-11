// =================================================================================================
// PATIENT SCREENS: what each screen in the room shows.
//
// The controller runs the sim. Every other screen in the room (a tablet, a laptop, a TV browser, or
// an extra monitor plugged into the controller's computer) is a PATIENT SCREEN: it joins with the
// session code and does nothing else. The controller numbers each screen as it joins (1, 2, 3 ...),
// each screen shows its number while the controller's Screens panel is open (like Windows'
// "Identify"), and the controller picks what each one shows, at any time, from:
//
//   Monitor      the obs, traces and results
//   Defib        the defibrillator (defib/index.html, embedded)
//   Ventilator   the HAMILTON-T1 (vent/index.html, embedded)
//
// in any combination (a screen always shows at least one). A screen with the monitor switches to
// the defib or the ventilator when the facilitator brings it in; a screen without the monitor shows
// its device(s) all the time. The choice lives in the session (sessions/<CODE>/screens/<id>, written
// by the controller, see data/screens/screenspanel.js), so a change reaches the screen at once and
// a reload keeps it. Plain JS: the start screen, the controller and the monitor all use it.
// =================================================================================================
(function () {
    var PARTS = ['monitor', 'defib', 'vent'];
    var PART_LABELS = { monitor: 'Monitor', defib: 'Defib', vent: 'Ventilator' };
    var PART_ICONS = { monitor: 'activity', defib: 'zap', vent: 'wind' };

    var ROLES = {
        all: { parts: ['monitor', 'defib', 'vent'], title: 'Monitor, defib and ventilator', short: 'Everything', icon: 'monitor',
               text: 'The monitor. It switches to the defib or the ventilator when you bring one in, and the candidates can switch back.' },
        monitor: { parts: ['monitor'], title: 'Patient monitor', short: 'Monitor', icon: 'activity',
               text: 'The monitor only. The defib and the ventilator never appear here.' },
        mondefib: { parts: ['monitor', 'defib'], title: 'Monitor and defib', short: 'Monitor + defib', icon: 'monitor',
               text: 'The monitor. It switches to the defib when you bring it in. The ventilator never appears here.' },
        monvent: { parts: ['monitor', 'vent'], title: 'Monitor and ventilator', short: 'Monitor + ventilator', icon: 'monitor',
               text: 'The monitor. It switches to the ventilator when you bring it in. The defib never appears here.' },
        devices: { parts: ['defib', 'vent'], title: 'Defib and ventilator', short: 'Defib + ventilator', icon: 'zap',
               text: 'The defib and the ventilator, ready all the time. It shows whichever you bring in, and the candidates can switch between them.' },
        defib: { parts: ['defib'], title: 'Defibrillator', short: 'Defib', icon: 'zap',
               text: 'The defib, ready all the time.' },
        vent: { parts: ['vent'], title: 'Ventilator', short: 'Ventilator', icon: 'wind',
               text: 'The ventilator, ready all the time.' }
    };
    var ROLE_KEYS = Object.keys(ROLES);

    var isRole = function (v) { return typeof v === 'string' && Object.prototype.hasOwnProperty.call(ROLES, v); };
    var roleOf = function (v) { return isRole(v) ? v : 'all'; };
    var partsOf = function (role) { return ROLES[roleOf(role)].parts.slice(); };
    // The role for a set of parts, or null for an empty set (a screen must show something).
    var roleFromParts = function (parts) {
        var want = PARTS.filter(function (p) { return parts.indexOf(p) >= 0; }).join(',');
        for (var i = 0; i < ROLE_KEYS.length; i++) if (ROLES[ROLE_KEYS[i]].parts.join(',') === want) return ROLE_KEYS[i];
        return null;
    };

    // Each screen number has its own colour, on the controller and on the screen itself, so the
    // number across the room and the row on the controller are matched at a glance.
    var NUMBER_COLOURS = ['bg-sky-700 text-white', 'bg-amber-400 text-slate-950', 'bg-emerald-700 text-white', 'bg-fuchsia-700 text-white',
        'bg-rose-700 text-white', 'bg-indigo-600 text-white', 'bg-lime-400 text-slate-950', 'bg-orange-700 text-white'];
    var numberColour = function (n) { return Number(n) >= 1 ? NUMBER_COLOURS[(Number(n) - 1) % NUMBER_COLOURS.length] : 'bg-slate-700 text-slate-200'; };

    // One-click set-ups for the screens connected now, in screen-number order (like Windows'
    // Duplicate / Extend). A screen beyond the set-up's list shows the monitor.
    var presetsFor = function (count) {
        if (count < 2) return [];
        var list = [{ key: 'split2', label: 'Monitor | Defib + ventilator', roles: ['monitor', 'devices'] }];
        if (count >= 3) list.push({ key: 'split3', label: 'Monitor | Defib | Ventilator', roles: ['monitor', 'defib', 'vent'] });
        list.push({ key: 'same', label: 'Everything on every screen', roles: ['all'] });
        return list;
    };
    var presetRole = function (preset, i) {
        var r = preset.roles;
        if (i < r.length) return r[i];
        return r.length === 1 ? r[0] : 'monitor';
    };

    // The address a patient screen joins at. `base` is the sim's own address (defaults to this page).
    var screenUrl = function (code, base) {
        var u = new URL(base || window.location.href);
        u.search = '?mode=monitor&session=' + encodeURIComponent(code || '');
        u.hash = '';
        return u.toString();
    };
    // The standalone device pages (the Defib Sim's "Open defib", older links), or a patient screen
    // that starts as `role` (older links carried ?screen=; the controller can still change it).
    var urlFor = function (role, code, base) {
        var here = base || window.location.href;
        var s = encodeURIComponent(code || '');
        if (role === 'defib') return new URL('defib/index.html?session=' + s, here).toString();
        if (role === 'vent') return new URL('vent/index.html?session=' + s, here).toString();
        var u = screenUrl(code, here);
        return (isRole(role) && role !== 'all') ? u + '&screen=' + role : u;
    };

    // On one computer every screen is its own WINDOW (not a tab in this window): a tab that is not
    // showing is slowed right down by the browser, and a window can be dragged onto its screen.
    var openWindow = function (role, code) {
        var w = window.open(urlFor(role, code), 'emsim-screen-' + roleOf(role), 'popup=yes,width=1280,height=800');
        if (w) { try { w.focus(); } catch (e) {} }
        return !!w;
    };
    // A new patient screen in a window of its own; every press opens another one.
    var windowCount = 0;
    var openScreenWindow = function (code) {
        windowCount += 1;
        var w = window.open(screenUrl(code), 'emsim-patient-screen-' + Date.now().toString(36) + windowCount, 'popup=yes,width=1280,height=800');
        if (w) { try { w.focus(); } catch (e) {} }
        return !!w;
    };

    // ---- This screen's own id -------------------------------------------------------------------
    // Kept per browser tab (sessionStorage), so a reload is the same screen with the same number,
    // and two windows on one computer are two screens. A DUPLICATED tab copies sessionStorage, so a
    // screen first asks the other tabs of this browser whether its id is taken, and takes a new one
    // if it is. Calls cb(id) once; returns a function that cancels.
    var ID_KEY = 'wmebem_screen_id';
    var newId = function () { return (Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)).slice(0, 12); };
    var validId = function (v) { return typeof v === 'string' && /^[a-z0-9]{8,16}$/.test(v); };
    var claimScreenId = function (cb) {
        var id = null;
        try { id = sessionStorage.getItem(ID_KEY); } catch (e) {}
        if (!validId(id)) id = newId();
        var done = false, cancelled = false, ch = null, timer = null;
        var finish = function () {
            if (done || cancelled) return;
            done = true;
            try { sessionStorage.setItem(ID_KEY, id); } catch (e) {}
            cb(id);
        };
        try {
            ch = new BroadcastChannel('wmebem-screen-ids');
            ch.onmessage = function (e) {
                var m = e.data || {};
                if (done && m.ask === id) ch.postMessage({ taken: id });             // another tab wants our id
                else if (!done && m.taken === id) id = newId();                       // ours is taken: a new one
            };
            ch.postMessage({ ask: id });
            timer = setTimeout(finish, 250);
        } catch (e) { finish(); }
        // The channel stays open while this screen lives, to answer later duplicates.
        return function () { cancelled = true; if (timer) clearTimeout(timer); try { if (ch) ch.close(); } catch (e) {} };
    };

    window.SimScreens = {
        PARTS: PARTS, PART_LABELS: PART_LABELS, PART_ICONS: PART_ICONS, ROLES: ROLES, ROLE_KEYS: ROLE_KEYS,
        isRole: isRole, roleOf: roleOf, partsOf: partsOf, roleFromParts: roleFromParts,
        numberColour: numberColour, presetsFor: presetsFor, presetRole: presetRole,
        screenUrl: screenUrl, urlFor: urlFor, openWindow: openWindow, openScreenWindow: openScreenWindow,
        claimScreenId: claimScreenId
    };
})();
