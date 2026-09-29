// In-memory stand-in for the Firebase v8 compat SDK, used ONLY by the browser tests so they never
// touch the live database. It implements the small part of the API the app uses:
//   firebase.apps / initializeApp / database()
//   db.ref(path): child, on/off('value' | 'child_added'), once('value'), set, update, push,
//                 remove, onDisconnect().remove(), limitToLast(n)
// Pages in the same browser context share one database: every write is applied locally
// (listeners fire synchronously, like the real SDK does for local writes) and broadcast to the
// other pages, and a page that loads late asks the others for the current tree.
// firebase.auth is deliberately absent, so data/auth.js reports "accounts not configured".
(function () {
    'use strict';
    var channel = new BroadcastChannel('fake-rtdb');
    var root = {};
    var listeners = [];     // { path, event, cb, limit, seen }
    var disconnectOps = [];
    var pushCounter = 0;

    function parts(path) { return String(path || '').split('/').filter(Boolean); }
    function join(p) { return p.join('/'); }
    function clone(v) { return v === undefined ? null : JSON.parse(JSON.stringify(v)); }

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
                l.cb(snapshot(join(parts(l.path).concat([k])), getAt(join(parts(l.path).concat([k])))));
            });
        }
    }
    function notify(path) {
        listeners.slice().forEach(function (l) { if (listeners.indexOf(l) !== -1 && related(l.path, path)) fire(l); });
    }

    function write(op, path, value, remote) {
        if (op === 'set') setAt(path, value);
        else if (op === 'update') Object.keys(value || {}).forEach(function (k) { setAt(join(parts(path).concat(parts(k))), value[k]); });
        if (!remote) channel.postMessage({ op: op, path: path, value: clone(value) });
        notify(path);
        return Promise.resolve();
    }

    channel.onmessage = function (e) {
        var m = e.data || {};
        if (m.op === 'hello') channel.postMessage({ op: 'tree', value: root });
        else if (m.op === 'tree') {
            // A late joiner merges what the other pages hold; anything it already wrote wins.
            var merge = function (local, remote) {
                if (!remote || typeof remote !== 'object') return local === undefined ? remote : local;
                if (!local || typeof local !== 'object') return local === undefined ? clone(remote) : local;
                Object.keys(remote).forEach(function (k) { local[k] = merge(local[k], remote[k]); });
                return local;
            };
            if (m.value && Object.keys(m.value).length) { root = merge(root, m.value); notify(''); }
        } else if (m.op === 'set' || m.op === 'update') write(m.op, m.path, m.value, true);
    };
    channel.postMessage({ op: 'hello' });

    function pushKey() {
        pushCounter += 1;
        return '-' + Date.now().toString(36).padStart(10, '0') + String(pushCounter).padStart(6, '0') + Math.random().toString(36).slice(2, 6);
    }

    function makeRef(path, limit) {
        path = join(parts(path));
        var ref = {
            key: parts(path).slice(-1)[0] || null,
            path: path,
            child: function (c) { return makeRef(join(parts(path).concat(parts(c)))); },
            limitToLast: function (n) { return makeRef(path, n); },
            orderByChild: function () { return ref; },
            on: function (event, cb, errCb) {
                var l = { path: path, event: event, cb: cb, limit: limit || 0, seen: {}, last: undefined };
                listeners.push(l);
                setTimeout(function () { if (listeners.indexOf(l) !== -1) fire(l); }, 0);
                return cb;
            },
            off: function (event, cb) {
                listeners = listeners.filter(function (l) { return !(l.path === path && (!event || l.event === event) && (!cb || l.cb === cb)); });
            },
            once: function () { return Promise.resolve(snapshot(path, getAt(path))); },
            set: function (v) { return write('set', path, v); },
            update: function (v) { return write('update', path, v); },
            remove: function () { return write('set', path, null); },
            push: function (v) {
                var child = makeRef(join(parts(path).concat([pushKey()])));
                var p = v === undefined ? Promise.resolve() : child.set(v);
                child.then = p.then.bind(p);
                child.catch = p.catch.bind(p);
                return child;
            },
            onDisconnect: function () {
                return {
                    remove: function () { disconnectOps.push(path); return Promise.resolve(); },
                    cancel: function () { disconnectOps = disconnectOps.filter(function (x) { return x !== path; }); return Promise.resolve(); }
                };
            }
        };
        return ref;
    }

    window.addEventListener('pagehide', function () {
        disconnectOps.forEach(function (p) { write('set', p, null); });
    });

    var db = { ref: function (p) { return makeRef(p); } };
    window.firebase = {
        apps: [],
        initializeApp: function (cfg) { window.firebase.apps.push({ options: cfg }); return window.firebase.apps[0]; },
        database: function () { return db; }
    };
    // Test hook: inspect or seed the shared tree.
    window.__fakeRtdb = { get: function (p) { return clone(getAt(p || '')); }, set: function (p, v) { return write('set', p, v); } };
})();
