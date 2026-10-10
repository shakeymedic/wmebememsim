// =================================================================================================
// PATIENT SCREENS: what each screen in the room shows, and how many there are.
//
// The controller (this computer) runs the sim. Beside it there are one, two or three patient
// screens, either extra monitors plugged into this computer (each screen gets its own browser
// window) or separate devices (tablets, laptops, a TV browser) joined over the internet.
//
//   1 screen:  'all'      the patient monitor, and the defib and ventilator when they are brought
//                         into the room, switching between them.
//   2 screens: 'monitor'  the patient monitor only.
//              'devices'  the defib and the ventilator, switching between them.
//   3 screens: 'monitor', 'defib' (defib/index.html) and 'vent' (vent/index.html).
//
// A screen's role lives in its own address (?screen=...), never in the session, so each screen
// can be set up independently and a reload keeps it. Plain JS: the start screen, the controller
// and the monitor all use it.
// =================================================================================================
(function () {
    const ROLES = {
        all: { title: 'Monitor, defib and ventilator', short: 'All-in-one', icon: 'monitor',
               text: 'The patient monitor. When you bring in the defib or the ventilator, it switches to it, and the candidate can switch back and forth.' },
        monitor: { title: 'Patient monitor', short: 'Monitor', icon: 'activity',
               text: 'The obs, traces and results only. The defib and ventilator are on other screens.' },
        devices: { title: 'Defib and ventilator', short: 'Defib + ventilator', icon: 'zap',
               text: 'Both devices, ready to use. It switches to whichever you bring in, and the candidate can switch between them.' },
        defib: { title: 'Defibrillator', short: 'Defib', icon: 'zap',
               text: 'The defibrillator on its own screen.' },
        vent: { title: 'Ventilator', short: 'Ventilator', icon: 'wind',
               text: 'The HAMILTON-T1 ventilator on its own screen.' }
    };
    const LAYOUTS = { 1: ['all'], 2: ['monitor', 'devices'], 3: ['monitor', 'defib', 'vent'] };
    const MONITOR_PAGE_ROLES = ['all', 'monitor', 'devices'];

    const roleOf = (v) => (Object.prototype.hasOwnProperty.call(ROLES, v) ? v : 'all');

    // The address of a screen. `base` is the sim's own address (defaults to this page).
    const urlFor = (role, code, base) => {
        const here = base || window.location.href;
        const r = roleOf(role);
        const s = encodeURIComponent(code || '');
        if (r === 'defib') return new URL(`defib/index.html?session=${s}`, here).toString();
        if (r === 'vent') return new URL(`vent/index.html?session=${s}`, here).toString();
        const u = new URL(here);
        u.search = `?mode=monitor&session=${s}` + (r === 'all' ? '' : `&screen=${r}`);
        u.hash = '';
        return u.toString();
    };

    // On one computer every screen is its own WINDOW (not a tab in this window): a tab that is not
    // showing is slowed right down by the browser, and a window can be dragged onto its screen.
    const openWindow = (role, code) => {
        const r = roleOf(role);
        const w = window.open(urlFor(r, code), `emsim-screen-${r}`, 'popup=yes,width=1280,height=800');
        if (w) { try { w.focus(); } catch (e) {} }
        return !!w;
    };

    // What this device remembers: how many patient screens, and where they are.
    const KEY = 'wmebem_screens';
    const OLD_KEY = 'wmebem_setup_mode';
    const readSetup = () => {
        try {
            const v = JSON.parse(localStorage.getItem(KEY) || 'null');
            if (v && [1, 2, 3].includes(v.count) && ['here', 'devices'].includes(v.where)) return v;
            // The earlier chooser: one computer with two screens, or two devices.
            const old = localStorage.getItem(OLD_KEY);
            if (old === 'one') return { count: 1, where: 'here' };
            if (old === 'two') return { count: 1, where: 'devices' };
        } catch (e) {}
        return null;
    };
    const saveSetup = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} };

    window.SimScreens = { ROLES, LAYOUTS, MONITOR_PAGE_ROLES, roleOf, urlFor, openWindow, readSetup, saveSetup };
})();
