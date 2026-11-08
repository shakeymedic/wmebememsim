// THE SAME-DEVICE LINK (no internet). Jake, 8 Nov 2026: "build the EM Sim same-device link".
//
// Normally every screen (controller, monitor, defib, ventilator) links through the Firebase Realtime
// Database, which needs the internet. With no internet, screens open in the SAME browser on the SAME
// device (a laptop with the monitor in a second window on a projector or TV, a tablet in split
// screen) link to each other directly instead, over a BroadcastChannel. Nothing leaves the device.
//
// How: this file wraps firebase.database(). Only the live-session paths (sessions/...) and
// .info/connected are switchable; everything else (accounts, course scenarios) always goes to
// Firebase. The live-session paths use:
//   * Firebase, normally;
//   * the local link when the browser says it is offline (navigator.onLine false), or when the
//     facilitator has chosen "Link on this device" (SimLink.setDevice(true): remembered for 12 hours
//     and shared by every tab of this site in this browser).
// Switching moves every listener across, so a session carries on when the internet drops; the local
// link answers .info/connected = true, so the controller sends the whole patient again at once.
// The local database is the in-memory one the browser tests have used since Oct 2026
// (tests/fake-firebase.js): each page holds the tree, every write is applied locally and broadcast,
// and a page that opens late asks the others for what they hold.
//
// Plain ES5 on purpose: the build minifies data/*.js and this runs before React on every page.
(function () {
    'use strict';
    if (window.SimLink) return;

    var FLAG = 'emsim-device-link';
    var FLAG_HOURS = 12;
    var CHANNEL = 'emsim-device-link-v1';

    // ---- the local database ------------------------------------------------------------------
    function createLocalDb() {
        var channel = null;
        try { channel = ('BroadcastChannel' in window) ? new BroadcastChannel(CHANNEL) : null; } catch (e) { channel = null; }
        var root = {};
        var listeners = [];      // { path, event, cb, limit, seen, last }
        var disconnectOps = [];
        var pushCounter = 0;

        function parts(path) { return String(path || '').split('/').filter(Boolean); }
        function join(p) { return p.join('/'); }
        function clone(v) { return v === undefined ? null : JSON.parse(JSON.stringify(v)); }
        function post(m) { if (channel) { try { channel.postMessage(m); } catch (e) {} } }

        function getAt(path) {
            var node = root, p = parts(path);
            for (var i = 0; i < p.length; i++) {
                if (node === null || typeof node !== 'object' || !(p[i] in node)) return null;
                node = node[p[i]];
            }
            return node === undefined ? null : node;
        }
        function prune(obj) {
            if (obj === null || typeof obj !== 'object') return obj;
            Object.keys(obj).forEach(function (k) {
                obj[k] = prune(obj[k]);
                if (obj[k] === null || (typeof obj[k] === 'object' && Object.keys(obj[k]).length === 0)) delete obj[k];
            });
            return obj;
        }
        function setAt(path, value) {
            var p = parts(path);
            if (!p.length) { root = (value && typeof value === 'object') ? clone(value) : {}; return; }
            var node = root;
            for (var i = 0; i < p.length - 1; i++) {
                if (node[p[i]] === null || typeof node[p[i]] !== 'object') node[p[i]] = {};
                node = node[p[i]];
            }
            if (value === null || value === undefined) delete node[p[p.length - 1]];
            else node[p[p.length - 1]] = clone(value);
            prune(root);
        }
        function related(a, b) {
            var pa = parts(a), pb = parts(b), n = Math.min(pa.length, pb.length);
            for (var i = 0; i < n; i++) if (pa[i] !== pb[i]) return false;
            return true;
        }
        function snapshot(path, value) {
            var p = parts(path);
            return {
                key: p.length ? p[p.length - 1] : null,
                ref: makeRef(path),
                val: function () { return clone(value); },
                exists: function () { return value !== null && value !== undefined; },
                child: function (c) { return snapshot(join(p.concat(parts(c))), value && typeof value === 'object' ? (value[c] === undefined ? null : value[c]) : null); },
                forEach: function (fn) {
                    if (!value || typeof value !== 'object') return false;
                    return Object.keys(value).sort().some(function (k) { return fn(snapshot(join(p.concat([k])), value[k])) === true; });
                }
            };
        }
        function childKeys(path, limit) {
            var v = getAt(path);
            var keys = (v && typeof v === 'object') ? Object.keys(v).sort() : [];
            return limit ? keys.slice(-limit) : keys;
        }
        function fire(l) {
            if (l.event === 'value') {
                var v = l.path === '.info/connected' ? true : getAt(l.path);
                var s = JSON.stringify(v);
                if (s === l.last) return;
                l.last = s;
                l.cb(snapshot(l.path, v));
            } else if (l.event === 'child_added') {
                childKeys(l.path, l.limit).forEach(function (k) {
                    if (l.seen[k]) return;
                    l.seen[k] = true;
                    var cp = join(parts(l.path).concat([k]));
                    l.cb(snapshot(cp, getAt(cp)));
                });
            }
        }
        function notify(path) {
            listeners.slice().forEach(function (l) {
                if (listeners.indexOf(l) === -1 || !related(l.path, path)) return;
                try { fire(l); } catch (e) { console.warn('Device link listener failed', e); }
            });
        }
        function write(op, path, value, remote) {
            if (op === 'set') setAt(path, value);
            else if (op === 'update') Object.keys(value || {}).forEach(function (k) { setAt(join(parts(path).concat(parts(k))), value[k]); });
            if (!remote) post({ op: op, path: path, value: clone(value) });
            notify(path);
            return Promise.resolve();
        }
        function merge(local, remote) {
            if (!remote || typeof remote !== 'object') return local === undefined ? remote : local;
            if (!local || typeof local !== 'object') return local === undefined ? clone(remote) : local;
            Object.keys(remote).forEach(function (k) { local[k] = merge(local[k], remote[k]); });
            return local;
        }
        if (channel) {
            channel.onmessage = function (e) {
                var m = e.data || {};
                if (m.op === 'hello') post({ op: 'tree', value: root });
                else if (m.op === 'tree') {
                    // A page that opens late merges what the others hold; what it wrote itself wins.
                    if (m.value && typeof m.value === 'object' && Object.keys(m.value).length) { root = merge(root, m.value); notify(''); }
                } else if (m.op === 'set' || m.op === 'update') write(m.op, m.path, m.value, true);
            };
            post({ op: 'hello' });
        }
        function pushKey() {
            pushCounter += 1;
            // Sorts by time like a Firebase push id; the random tail keeps two tabs' keys apart.
            return '-' + ('0000000000' + Date.now().toString(36)).slice(-10) + ('000000' + pushCounter).slice(-6) + Math.random().toString(36).slice(2, 6);
        }
        function makeRef(path, limit) {
            path = join(parts(path));
            var ref = {
                key: parts(path).slice(-1)[0] || null,
                path: path,
                child: function (c) { return makeRef(join(parts(path).concat(parts(c)))); },
                limitToLast: function (n) { return makeRef(path, n); },
                orderByChild: function () { return ref; },
                on: function (event, cb) {
                    var l = { path: path, event: event, cb: cb, limit: limit || 0, seen: {}, last: undefined };
                    listeners.push(l);
                    setTimeout(function () { if (listeners.indexOf(l) !== -1) fire(l); }, 0);
                    return cb;
                },
                off: function (event, cb) {
                    listeners = listeners.filter(function (l) { return !(l.path === path && (!event || l.event === event) && (!cb || l.cb === cb)); });
                },
                once: function () { return Promise.resolve(snapshot(path, path === '.info/connected' ? true : getAt(path))); },
                set: function (v) { return write('set', path, v); },
                update: function (v) { return write('update', path, v); },
                remove: function () { return write('set', path, null); },
                push: function (v) {
                    var child = makeRef(join(parts(path).concat([pushKey()])));
                    var p = v === undefined ? Promise.resolve() : child.set(v);
                    child.then = p.then.bind(p);
                    child['catch'] = p['catch'].bind(p);
                    return child;
                },
                onDisconnect: function () {
                    return {
                        remove: function () { disconnectOps.push({ path: path, value: null }); return Promise.resolve(); },
                        set: function (v) { disconnectOps.push({ path: path, value: clone(v) }); return Promise.resolve(); },
                        cancel: function () { disconnectOps = disconnectOps.filter(function (x) { return x.path !== path; }); return Promise.resolve(); }
                    };
                }
            };
            return ref;
        }
        window.addEventListener('pagehide', function () {
            disconnectOps.forEach(function (d) { write('set', d.path, d.value); });
            disconnectOps = [];
        });
        return { ref: function (p) { return makeRef(p); }, __local: true, __get: function (p) { return clone(getAt(p || '')); } };
    }

    // ---- which link is in use ---------------------------------------------------------------
    var local = null;
    function localDb() { if (!local) local = createLocalDb(); return local; }
    function flagSet() {
        try {
            var ts = Number(localStorage.getItem(FLAG));
            return Number.isFinite(ts) && ts > 0 && Date.now() - ts < FLAG_HOURS * 3600000;
        } catch (e) { return false; }
    }
    function browserOffline() { try { return navigator.onLine === false; } catch (e) { return false; } }
    var wrapped = [];        // every switchable database made on this page
    function computeDevice(sw) { return !sw.fb || flagSet() || browserOffline(); }

    function isLive(path) {
        var p = String(path || '').replace(/^\/+/, '');
        return p === '.info/connected' || p === 'sessions' || p.indexOf('sessions/') === 0;
    }

    function createSwitchDb(fb) {
        var sw = { fb: fb, device: false, entries: [] };
        sw.device = computeDevice(sw);
        function backend() { return sw.device ? localDb() : sw.fb; }
        function target(path, limit) {
            var r = backend().ref(path);
            return limit ? r.limitToLast(limit) : r;
        }
        function attach(en) {
            en.backend = backend();
            var r = en.backend.ref(en.path);
            if (en.limit) r = r.limitToLast(en.limit);
            r.on(en.event, en.cb, en.err);
        }
        function detach(en) {
            try {
                var r = en.backend.ref(en.path);
                if (en.limit) r = r.limitToLast(en.limit);
                r.off(en.event, en.cb);
            } catch (e) {}
        }
        function makeRef(path, limit) {
            path = String(path || '').replace(/^\/+|\/+$/g, '');
            var ref = {
                key: path.split('/').filter(Boolean).slice(-1)[0] || null,
                child: function (c) { return makeRef(path + '/' + String(c).replace(/^\/+/, '')); },
                limitToLast: function (n) { return makeRef(path, n); },
                on: function (event, cb, err) {
                    var en = { path: path, limit: limit || 0, event: event, cb: cb, err: err };
                    sw.entries.push(en);
                    attach(en);
                    return cb;
                },
                off: function (event, cb) {
                    sw.entries = sw.entries.filter(function (en) {
                        var match = en.path === path && (!event || en.event === event) && (!cb || en.cb === cb);
                        if (match) detach(en);
                        return !match;
                    });
                },
                once: function (ev) { return target(path, limit).once(ev || 'value'); },
                set: function (v) { return target(path).set(v); },
                update: function (v) { return target(path).update(v); },
                remove: function () { return target(path).remove(); },
                push: function (v) { return v === undefined ? target(path).push() : target(path).push(v); },
                onDisconnect: function () { return target(path).onDisconnect(); }
            };
            return ref;
        }
        sw.refresh = function () {
            var next = computeDevice(sw);
            if (next === sw.device) return;
            sw.device = next;
            sw.entries.forEach(function (en) { detach(en); attach(en); });
        };
        // Everything else the real database object offers stays reachable (useEmulator, goOffline, ...).
        var db = fb ? Object.create(fb) : {};
        db.ref = function (path) {
            if (isLive(path) || !sw.fb) return makeRef(path);
            return sw.fb.ref(path);
        };
        db.__simLink = sw;
        wrapped.push(sw);
        return db;
    }

    function refreshAll() {
        wrapped.forEach(function (sw) { sw.refresh(); });
        try { window.dispatchEvent(new CustomEvent('emsim-link-mode', { detail: { device: SimLink.isDevice() } })); } catch (e) {}
    }
    window.addEventListener('online', refreshAll);
    window.addEventListener('offline', refreshAll);
    // Another tab chose (or cleared) "Link on this device".
    window.addEventListener('storage', function (e) { if (e.key === FLAG) refreshAll(); });
    // The 12 hours can run out while a page is open.
    setInterval(function () { if (wrapped.some(function (sw) { return sw.device !== computeDevice(sw); })) refreshAll(); }, 60000);

    var SimLink = {
        /** True when the live session is on the same-device link. */
        isDevice: function () { return wrapped.length ? wrapped[0].device : (flagSet() || browserOffline()); },
        /** True when the facilitator chose the same-device link (rather than the browser being offline). */
        isChosen: flagSet,
        browserOffline: browserOffline,
        /** Turn the same-device link on or off for every tab of this site in this browser. */
        setDevice: function (on) {
            try { if (on) localStorage.setItem(FLAG, String(Date.now())); else localStorage.removeItem(FLAG); } catch (e) {}
            refreshAll();
        },
        wrap: function (fb) { return createSwitchDb(fb); },
        /** For the tests: the local tree. */
        __localGet: function (p) { return localDb().__get(p); }
    };
    window.SimLink = SimLink;

    // Wrap firebase.database() on this page. Each page loads this file after the Firebase SDK.
    try {
        var fbns = window.firebase;
        if (fbns && typeof fbns.database === 'function' && !fbns.database.__simLinkWrapped) {
            var original = fbns.database;
            var cache = null;
            var patched = function () {
                if (!cache) cache = createSwitchDb(original.apply(fbns, arguments));
                return cache;
            };
            patched.__simLinkWrapped = true;
            // Keep static members (firebase.database.ServerValue etc.).
            for (var key in original) { try { patched[key] = original[key]; } catch (e) {} }
            fbns.database = patched;
        }
    } catch (e) { console.warn('Device link: could not wrap the Firebase database', e); }
})();
