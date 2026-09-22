(() => {
    // =============================================================================================
    // WAVE 4b / PART B + C — ACCOUNTS, ADMIN APPROVAL, ENTITLEMENTS, RESTRICTED CONTENT
    // ---------------------------------------------------------------------------------------------
    // THE ONE RULE THIS FILE MUST NEVER BREAK (requirement B4):
    //   The app is fully usable with NO account. Nothing here may block, prompt, redirect, throw,
    //   or log noise. Sign-in gates RESTRICTED CONTENT ONLY. Every existing feature — all 254
    //   scenarios, Quick Sim, the monitor, the defibrillator, the debrief — works signed out, and
    //   works identically whether or not Firebase Authentication has even been enabled in the
    //   console. Requirement C4: until auth is enabled, the restricted section must simply read as
    //   locked, with no errors and no broken UI.
    //
    // HOW THAT IS ACHIEVED:
    //   * Auth is resolved ONCE, lazily, inside try/catch into `authAvailable`. If the compat auth
    //     SDK is absent, or the project has no auth configured, we degrade to available:false and
    //     every UI path renders the "locked / not configured" state instead of erroring.
    //   * No network call happens at load beyond onAuthStateChanged, which is free and silent.
    //   * Every RTDB read/write below is .catch()ed. A PERMISSION_DENIED from the rules is an
    //     EXPECTED outcome (that is the enforcement working), so it is swallowed into state rather
    //     than thrown or console.error'd.
    //
    // DATA MODEL (users/{uid}) — see database.rules.json for the matching security rules:
    //   {
    //     email: 'a@b.com',
    //     displayName: 'Dr A B',
    //     createdAt: 1758556800000,
    //     lastSeenAt: 1758556800000,
    //     status: 'pending' | 'approved' | 'rejected',     // ADMIN-WRITE-ONLY
    //     role:   'user' | 'admin',                        // ADMIN-WRITE-ONLY
    //     entitlements: { rcuk: false, premium: false, expiresAt: null },   // ADMIN-WRITE-ONLY
    //     requestedAccess: { rcuk: true, at: 1758556800000 }                // user-writable, no privilege
    //   }
    // Access is an ENTITLEMENTS MAP, never a single boolean, so a paid tier is a new key
    // (`premium`, `institution`, ...) rather than a rewrite. `expiresAt` is a ms epoch or null.
    // =============================================================================================

    const { useState, useEffect, useCallback } = React;

    // ---- ENTITLEMENT KEYS ----------------------------------------------------------------------
    // Declared centrally so the admin panel, the gate and the future payment webhook agree.
    const ENTITLEMENT_KEYS = [
        { key: 'rcuk',    label: 'RCUK / restricted scenarios', note: 'Unlocks the Restricted premade section.' },
        { key: 'premium', label: 'Premium (future paid tier)',  note: 'Reserved. Not sold yet; no payment path is connected.' }
    ];
    const DEFAULT_ENTITLEMENTS = { rcuk: false, premium: false, expiresAt: null };

    // ---- LAZY, SILENT AUTH RESOLUTION ----------------------------------------------------------
    let _authResolved = false;
    let _auth = null;
    let _authError = null;
    const getAuth = () => {
        if (_authResolved) return _auth;
        _authResolved = true;
        try {
            if (!window.firebase || typeof window.firebase.auth !== 'function') {
                _authError = 'not-loaded';
                return null;
            }
            _auth = window.firebase.auth();
            return _auth;
        } catch (e) {
            // Deliberately NOT console.error: an un-configured project is a supported state
            // (requirement C4 — no console noise), not a bug.
            _authError = 'unavailable';
            _auth = null;
            return null;
        }
    };

    // Friendly, non-alarming copy for every compat error code we can actually hit. Anything
    // unmapped falls back to the raw message, which is better than a blank box.
    const AUTH_MESSAGES = {
        'auth/operation-not-allowed': 'Email/password sign-in is not switched on for this project yet. See database.rules.json step 1.',
        'auth/configuration-not-found': 'Firebase Authentication has not been set up for this project yet. See database.rules.json step 1.',
        'auth/invalid-email': 'That does not look like a valid email address.',
        'auth/missing-password': 'Please enter a password.',
        'auth/weak-password': 'Please use a password of at least 6 characters.',
        'auth/email-already-in-use': 'There is already an account with that email. Try signing in instead.',
        'auth/user-not-found': 'No account found with that email.',
        'auth/wrong-password': 'Incorrect password.',
        'auth/invalid-credential': 'Incorrect email or password.',
        'auth/invalid-login-credentials': 'Incorrect email or password.',
        'auth/too-many-requests': 'Too many attempts. Please wait a minute and try again.',
        'auth/network-request-failed': 'Could not reach Firebase. Check the network connection.',
        'auth/popup-blocked': 'The sign-in popup was blocked by the browser.',
        'auth/popup-closed-by-user': 'Sign-in was cancelled.',
        'auth/unauthorized-domain': 'This domain is not in the Firebase authorised domains list.'
    };
    const describeAuthError = (e) => {
        if (!e) return null;
        return AUTH_MESSAGES[e.code] || e.message || 'Sign-in failed.';
    };

    const normaliseEntitlements = (raw) => {
        const out = { ...DEFAULT_ENTITLEMENTS };
        if (raw && typeof raw === 'object') {
            Object.keys(raw).forEach(k => { out[k] = raw[k]; });
        }
        // An expired entitlement is not an entitlement. Enforced client-side for the UI; the DB
        // rules are the real gate, and a server-side expiry sweep would own this properly later.
        const exp = Number(out.expiresAt);
        if (Number.isFinite(exp) && exp > 0 && exp < Date.now()) {
            ENTITLEMENT_KEYS.forEach(({ key }) => { out[key] = false; });
            out.expired = true;
        }
        return out;
    };

    const normaliseProfile = (uid, raw, fallbackEmail) => {
        const p = (raw && typeof raw === 'object') ? raw : {};
        return {
            uid,
            email: p.email || fallbackEmail || null,
            displayName: p.displayName || null,
            createdAt: p.createdAt || null,
            lastSeenAt: p.lastSeenAt || null,
            status: (p.status === 'approved' || p.status === 'rejected') ? p.status : 'pending',
            role: p.role === 'admin' ? 'admin' : 'user',
            entitlements: normaliseEntitlements(p.entitlements),
            requestedAccess: (p.requestedAccess && typeof p.requestedAccess === 'object') ? p.requestedAccess : null
        };
    };
    window.normaliseAuthProfile = normaliseProfile;
    window.normaliseEntitlements = normaliseEntitlements;
    window.ENTITLEMENT_KEYS = ENTITLEMENT_KEYS;
    window.DEFAULT_ENTITLEMENTS = DEFAULT_ENTITLEMENTS;

    // Single source of truth for "may this account see restricted content?". The DB rules mirror
    // this exactly (approved + matching entitlement). Client-side it controls the UI only.
    // An entitlement grants access only when ALL THREE hold: the account is approved, the specific
    // key is true, and the (optional) expiry is in the future. `expiresAt` is what a paid licence
    // will set, so it has to be honoured here from the outset rather than bolted on later, otherwise
    // a lapsed licence would keep working until someone remembered to revoke it by hand.
    // `expiresAt: null` means "no expiry", which is the default for a manually granted entitlement.
    const entitlementsExpired = (ent) => {
        const at = ent && ent.expiresAt;
        if (at === null || at === undefined || at === '' || at === false) return false;
        const t = Number(at);
        if (!Number.isFinite(t) || t <= 0) return false;   // unparseable expiry is treated as "none"
        return t <= Date.now();
    };
    const hasEntitlement = (profile, key) => !!(
        profile && profile.status === 'approved' &&
        profile.entitlements && profile.entitlements[key] === true &&
        !entitlementsExpired(profile.entitlements)
    );
    window.__entitlementsExpired = entitlementsExpired;
    window.hasEntitlement = hasEntitlement;

    // =============================================================================================
    // useAuth() — the hook every screen uses. Safe to call when auth is unavailable.
    // =============================================================================================
    const useAuth = () => {
        const [state, setState] = useState(() => ({
            // 'checking' until onAuthStateChanged fires once, or immediately 'off' when there is
            // no auth SDK at all. Never 'error' — an unavailable auth is a normal, supported state.
            phase: getAuth() ? 'checking' : 'off',
            available: !!getAuth(),
            reason: _authError,
            user: null,
            profile: null,
            busy: false,
            error: null,
            notice: null
        }));

        useEffect(() => {
            const auth = getAuth();
            if (!auth) return;
            let profileRef = null;
            let profileHandler = null;
            let cancelled = false;

            const detachProfile = () => {
                if (profileRef && profileHandler) { try { profileRef.off('value', profileHandler); } catch (e) {} }
                profileRef = null; profileHandler = null;
            };

            const unsub = auth.onAuthStateChanged((user) => {
                if (cancelled) return;
                detachProfile();
                if (!user) {
                    setState(s => ({ ...s, phase: 'signedOut', user: null, profile: null, error: null }));
                    return;
                }
                const summary = { uid: user.uid, email: user.email, displayName: user.displayName };
                setState(s => ({ ...s, phase: 'signedIn', user: summary, error: null }));

                const db = window.db;
                if (!db) {
                    // Auth without a database: still signed in, just no profile/entitlements.
                    setState(s => ({ ...s, profile: normaliseProfile(user.uid, null, user.email) }));
                    return;
                }
                // Create-if-absent, then live-subscribe. The create writes ONLY profile fields —
                // never role/status/entitlements, which the rules forbid the user from writing.
                profileRef = db.ref(`users/${user.uid}`);
                profileRef.once('value').then(snap => {
                    if (cancelled) return;
                    if (!snap.exists()) {
                        return profileRef.update({
                            email: user.email || '',
                            displayName: user.displayName || (user.email ? String(user.email).split('@')[0] : 'User'),
                            createdAt: Date.now(),
                            lastSeenAt: Date.now()
                        }).catch(() => {});
                    }
                    return profileRef.child('lastSeenAt').set(Date.now()).catch(() => {});
                }).catch(() => {});

                profileHandler = profileRef.on('value', (snap) => {
                    if (cancelled) return;
                    setState(s => ({ ...s, profile: normaliseProfile(user.uid, snap.val(), user.email) }));
                }, () => {
                    // PERMISSION_DENIED here means the rules are doing their job. Fall back to a
                    // pending, entitlement-free profile rather than surfacing an error.
                    if (cancelled) return;
                    setState(s => ({ ...s, profile: normaliseProfile(user.uid, null, user.email) }));
                });
            }, () => {
                if (cancelled) return;
                setState(s => ({ ...s, phase: 'off', available: false, reason: 'unavailable' }));
            });

            return () => { cancelled = true; detachProfile(); try { unsub(); } catch (e) {} };
        }, []);

        const run = useCallback(async (fn, successNotice) => {
            const auth = getAuth();
            if (!auth) { setState(s => ({ ...s, error: AUTH_MESSAGES['auth/configuration-not-found'] })); return false; }
            setState(s => ({ ...s, busy: true, error: null, notice: null }));
            try {
                await fn(auth);
                setState(s => ({ ...s, busy: false, error: null, notice: successNotice || null }));
                return true;
            } catch (e) {
                setState(s => ({ ...s, busy: false, error: describeAuthError(e), notice: null }));
                return false;
            }
        }, []);

        const signIn = useCallback((email, password) =>
            run(auth => auth.signInWithEmailAndPassword(String(email || '').trim(), String(password || ''))), [run]);

        const signUp = useCallback((email, password, displayName) =>
            run(async (auth) => {
                const cred = await auth.createUserWithEmailAndPassword(String(email || '').trim(), String(password || ''));
                const name = String(displayName || '').trim();
                if (name && cred.user && cred.user.updateProfile) { try { await cred.user.updateProfile({ displayName: name }); } catch (e) {} }
                // New accounts are 'pending' by ABSENCE: the user cannot write status, so the
                // profile simply has no status until an admin approves. normaliseProfile() reads
                // a missing status as 'pending'.
                if (window.db && cred.user) {
                    try {
                        await window.db.ref(`users/${cred.user.uid}`).update({
                            email: cred.user.email || '',
                            displayName: name || (cred.user.email ? String(cred.user.email).split('@')[0] : 'User'),
                            createdAt: Date.now(),
                            lastSeenAt: Date.now()
                        });
                    } catch (e) {}
                }
            }, 'Account created. Access to restricted content needs approval — use "Request access" below.'), [run]);

        const resetPassword = useCallback((email) =>
            run(auth => auth.sendPasswordResetEmail(String(email || '').trim()),
                'Password reset email sent. Check your inbox (and spam).'), [run]);

        // Optional and entirely non-load-bearing: if the Google provider is not enabled in the
        // console this fails with a friendly message and nothing else changes.
        const signInWithGoogle = useCallback(() =>
            run(auth => {
                if (!window.firebase.auth.GoogleAuthProvider) throw { code: 'auth/operation-not-allowed' };
                return auth.signInWithPopup(new window.firebase.auth.GoogleAuthProvider());
            }), [run]);

        const signOut = useCallback(() => run(auth => auth.signOut()), [run]);

        // Asking is not granting. This writes to users/{uid}/requestedAccess, which carries no
        // privilege at all — the admin panel reads it to build the approval queue.
        const requestAccess = useCallback(async (key = 'rcuk') => {
            const uid = state.user && state.user.uid;
            if (!uid || !window.db) { setState(s => ({ ...s, error: 'Sign in first to request access.' })); return false; }
            try {
                await window.db.ref(`users/${uid}/requestedAccess`).update({ [key]: true, at: Date.now() });
                setState(s => ({ ...s, notice: 'Access request recorded. You will be notified once it is approved.', error: null }));
                return true;
            } catch (e) {
                setState(s => ({ ...s, error: 'Could not record the request. The database rules may not be published yet.' }));
                return false;
            }
        }, [state.user]);

        const clearFeedback = useCallback(() => setState(s => ({ ...s, error: null, notice: null })), []);

        return {
            ...state,
            isAdmin: !!(state.profile && state.profile.role === 'admin'),
            entitlements: (state.profile && state.profile.entitlements) || { ...DEFAULT_ENTITLEMENTS },
            has: (key) => hasEntitlement(state.profile, key),
            signIn, signUp, signOut, resetPassword, signInWithGoogle, requestAccess, clearFeedback
        };
    };
    window.useAuth = useAuth;

    // =============================================================================================
    // RESTRICTED SCENARIO LOADER (requirement C2 / C5)
    // ---------------------------------------------------------------------------------------------
    // Restricted scenarios are read from RTDB at `restrictedScenarios/` AT RUNTIME and are never
    // part of the shipped JavaScript bundle — that is the entire point, so copyrighted content is
    // not sitting in a public static file. Once loaded, each entry is put through
    // window.enrichScenario() — the SAME function every built-in scenario goes through — so
    // enrichment, WETFLAG, investigations, defib and deterioration all behave identically with no
    // special-casing anywhere downstream.
    // =============================================================================================
    window.loadRestrictedScenarios = async () => {
        if (!window.db) return { ok: false, reason: 'no-database', scenarios: [] };
        try {
            const snap = await window.db.ref('restrictedScenarios').once('value');
            const raw = snap.val();
            if (!raw || typeof raw !== 'object') return { ok: true, reason: 'empty', scenarios: [] };
            const list = Array.isArray(raw) ? raw : Object.keys(raw).map(k => {
                const entry = raw[k];
                if (!entry || typeof entry !== 'object') return null;
                return { ...entry, id: entry.id || k };
            });
            const scenarios = [];
            list.forEach(s => {
                // Same shape guard the custom-scenario importer uses: an id and a title, or it is
                // not a scenario and must not reach the list renderer.
                if (!s || typeof s.id !== 'string' || !s.id || typeof s.title !== 'string' || !s.title) return;
                try {
                    const enriched = window.enrichScenario ? window.enrichScenario({ ...s, restricted: true }) : { ...s, restricted: true };
                    if (enriched) scenarios.push(enriched);
                } catch (e) { /* one malformed pasted entry must not take the list down */ }
            });
            return { ok: true, reason: scenarios.length ? 'loaded' : 'empty', scenarios };
        } catch (e) {
            // PERMISSION_DENIED is the expected, correct answer for an unentitled account. It is a
            // state, not an error, and must not reach the console (requirement C4).
            const denied = /permission|denied/i.test(String((e && e.message) || ''));
            return { ok: false, reason: denied ? 'denied' : 'unavailable', scenarios: [] };
        }
    };

    // =============================================================================================
    // PAYMENT SEAM — DELIBERATELY NOT CONNECTED (requirement B6)
    // ---------------------------------------------------------------------------------------------
    // When paid licences are added, DO NOT write entitlements from this file or any other
    // client-side code. The flow must be:
    //
    //   1. Client calls your server to create a checkout session (Stripe, Paddle, GoCardless...).
    //   2. Provider redirects the buyer back to the app. The client learns NOTHING authoritative
    //      from that redirect — it is a hint to re-read users/{uid}, nothing more.
    //   3. The provider's WEBHOOK hits YOUR SERVER. The server verifies the signature, then uses
    //      the Firebase Admin SDK (which bypasses database.rules.json) to write:
    //          users/{uid}/entitlements/premium  = true
    //          users/{uid}/entitlements/expiresAt = <ms epoch>
    //      and appends an audit record under paymentEvents/{eventId}.
    //   4. The client's live `on('value')` subscription above picks the change up automatically —
    //      no extra client code is needed, which is why there is no client hook here.
    //
    // ENTITLEMENTS MUST NEVER BE CLIENT-WRITABLE. database.rules.json enforces that (admin-only
    // .write on users/$uid/entitlements, plus paymentEvents closed to every client in both
    // directions). A client that can write its own entitlements has no paywall at all.
    //
    // The function below exists ONLY to make the seam findable and to fail loudly if someone
    // wires it up client-side by mistake. It is not called from anywhere.
    window.__paymentWebhookSeam = () => {
        throw new Error('Entitlements are server-owned. Write them from a signature-verified webhook using the Firebase Admin SDK — never from the client. See data/auth.js.');
    };

    // =============================================================================================
    // UI — AccountButton (header), AuthModal, AdminPanel
    // =============================================================================================
    const Field = ({ label, ...props }) => (
        <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{label}</span>
            <input {...props} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm mt-0.5 focus:border-sky-500 outline-none" />
        </label>
    );

    const AuthModal = ({ auth, onClose, initialTab = 'signin', context = null }) => {
        const { Button, Lucide, Modal } = window;
        const [tab, setTab] = useState(initialTab);
        const [email, setEmail] = useState('');
        const [password, setPassword] = useState('');
        const [name, setName] = useState('');

        const submit = async (e) => {
            if (e && e.preventDefault) e.preventDefault();
            if (tab === 'signin') await auth.signIn(email, password);
            else if (tab === 'signup') await auth.signUp(email, password, name);
            else await auth.resetPassword(email);
        };

        const TABS = [['signin', 'Sign in'], ['signup', 'Create account'], ['reset', 'Reset password']];

        return (
            <Modal label="Account" onClose={onClose}>
                <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-md shadow-2xl">
                    <div className="flex justify-between items-start mb-3">
                        <div>
                            <h3 className="text-lg font-bold text-white uppercase tracking-wider">Account</h3>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                                An account is only needed for restricted content. Everything else in the app works without one.
                            </p>
                        </div>
                        <button aria-label="Close account panel" onClick={onClose} className="text-slate-400 hover:text-white"><Lucide icon="x" className="w-5 h-5"/></button>
                    </div>

                    {context && <div className="mb-3 text-xs bg-slate-900 border border-slate-700 rounded p-2 text-slate-300">{context}</div>}

                    {!auth.available ? (
                        <div className="bg-amber-950/40 border border-amber-600/60 rounded p-3 text-xs text-amber-200 space-y-2">
                            <p className="font-bold uppercase tracking-wider text-[10px]">Sign-in not configured yet</p>
                            <p>Firebase Authentication has not been enabled for this project, so accounts cannot be created yet. The rest of the simulator is unaffected.</p>
                            <p className="text-amber-300/80">Owner: enable Email/Password under Build → Authentication → Sign-in method, then publish <span className="font-mono">database.rules.json</span>.</p>
                        </div>
                    ) : (
                        <form onSubmit={submit} className="space-y-3">
                            <div className="flex gap-1 border-b border-slate-700 mb-1">
                                {TABS.map(([id, label]) => (
                                    <button key={id} type="button" onClick={() => { setTab(id); auth.clearFeedback(); }}
                                        className={`pb-2 px-2 text-[11px] font-bold uppercase tracking-wider ${tab === id ? 'text-sky-400 border-b-2 border-sky-400' : 'text-slate-500 hover:text-slate-300'}`}>{label}</button>
                                ))}
                            </div>

                            {tab === 'signup' && <Field label="Display name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Optional" autoComplete="name" />}
                            <Field label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required />
                            {tab !== 'reset' && <Field label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={tab === 'signup' ? 'new-password' : 'current-password'} required />}

                            {auth.error && <div className="bg-red-950/50 border border-red-600 rounded p-2 text-[11px] text-red-200">{auth.error}</div>}
                            {auth.notice && <div className="bg-emerald-950/50 border border-emerald-600 rounded p-2 text-[11px] text-emerald-200">{auth.notice}</div>}

                            <Button type="submit" variant="primary" disabled={auth.busy} className="w-full h-11 font-bold">
                                {auth.busy ? 'Working…' : (tab === 'signin' ? 'Sign in' : tab === 'signup' ? 'Create account' : 'Send reset email')}
                            </Button>
                            {tab === 'signin' && (
                                <button type="button" onClick={auth.signInWithGoogle} disabled={auth.busy}
                                    className="w-full h-9 rounded border border-slate-600 bg-slate-900 text-slate-300 text-xs font-bold hover:bg-slate-700">
                                    Continue with Google (if enabled)
                                </button>
                            )}
                        </form>
                    )}
                    <Button onClick={onClose} variant="outline" className="w-full mt-4">Close</Button>
                </div>
            </Modal>
        );
    };

    // ---- ADMIN PANEL (requirement B3) ----------------------------------------------------------
    // Visible only when role === 'admin'. Lists every user with their status and entitlements,
    // approves/rejects pending requests, and grants/revokes each entitlement individually.
    // `users` is normally loaded live from the database by the panel itself. It is accepted as an
    // OPTIONAL prop so the panel can be rendered from the Node verification harness (and previewed)
    // against a known list without a live Firebase connection. Passing it skips the subscription.
    const AdminPanel = ({ auth, onClose, users: usersProp = null }) => {
        const { Button, Lucide, Modal } = window;
        const [users, setUsers] = useState(usersProp);
        const [error, setError] = useState(null);
        const [busyUid, setBusyUid] = useState(null);
        const [filter, setFilter] = useState('all');

        useEffect(() => {
            if (usersProp) return;
            if (!window.db) { setError('No database connection.'); return; }
            const ref = window.db.ref('users');
            const handler = ref.on('value', snap => {
                const raw = snap.val() || {};
                const list = Object.keys(raw).map(uid => window.normaliseAuthProfile(uid, raw[uid], null));
                list.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
                setUsers(list);
                setError(null);
            }, () => setError('Could not read the user list. Publish database.rules.json and make sure your own users/<uid>/role is "admin".'));
            return () => { try { ref.off('value', handler); } catch (e) {} };
        }, [usersProp]);

        const write = async (uid, patch) => {
            if (!window.db) return;
            setBusyUid(uid);
            try { await window.db.ref(`users/${uid}`).update(patch); }
            catch (e) { setError('Write refused. Only an admin may change role, status or entitlements — check your own role in the console.'); }
            setBusyUid(null);
        };
        const setStatus = (uid, status) => write(uid, { status });
        const setEntitlement = (uid, key, value) => write(uid, { [`entitlements/${key}`]: value });
        const setRole = (uid, role) => write(uid, { role });

        const shown = (users || []).filter(u => {
            if (filter === 'pending') return u.status === 'pending';
            if (filter === 'approved') return u.status === 'approved';
            if (filter === 'rejected') return u.status === 'rejected';
            if (filter === 'requests') return !!u.requestedAccess;
            return true;
        });
        const pendingCount = (users || []).filter(u => u.status === 'pending').length;

        const STATUS_STYLE = {
            approved: 'bg-emerald-950/60 border-emerald-600 text-emerald-300',
            pending:  'bg-amber-950/60 border-amber-600 text-amber-300',
            rejected: 'bg-red-950/60 border-red-600 text-red-300'
        };

        return (
            <Modal label="Admin — users and entitlements" onClose={onClose}>
                <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-3xl shadow-2xl max-h-[85vh] flex flex-col">
                    <div className="flex justify-between items-start mb-3">
                        <div>
                            <h3 className="text-lg font-bold text-white uppercase tracking-wider flex items-center gap-2">
                                <Lucide icon="shield" className="w-4 h-4 text-sky-400"/> Admin — users &amp; entitlements
                            </h3>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                                Approve who may see restricted content, and grant each entitlement individually.
                                {pendingCount > 0 && <span className="text-amber-300 font-bold"> {pendingCount} awaiting approval.</span>}
                            </p>
                        </div>
                        <button aria-label="Close admin panel" onClick={onClose} className="text-slate-400 hover:text-white"><Lucide icon="x" className="w-5 h-5"/></button>
                    </div>

                    <div className="flex gap-1 mb-3 flex-wrap">
                        {['all', 'pending', 'approved', 'rejected', 'requests'].map(f => (
                            <button key={f} onClick={() => setFilter(f)}
                                className={`px-3 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${filter === f ? 'bg-sky-600 text-white' : 'bg-slate-900 text-slate-400 hover:bg-slate-700 border border-slate-700'}`}>{f}</button>
                        ))}
                    </div>

                    {error && <div className="bg-red-950/50 border border-red-600 rounded p-2 text-[11px] text-red-200 mb-3">{error}</div>}

                    <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                        {users === null && !error && <div className="text-slate-500 text-sm text-center py-8">Loading users…</div>}
                        {users !== null && shown.length === 0 && <div className="text-slate-500 text-sm text-center py-8">No users in this view.</div>}
                        {shown.map(u => (
                            <div key={u.uid} className="bg-slate-900 border border-slate-700 rounded p-3">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="text-sm font-bold text-white truncate">{u.displayName || '(no name)'} {u.role === 'admin' && <span className="ml-1 text-[9px] px-1 rounded bg-sky-950 border border-sky-600 text-sky-300 uppercase font-bold">admin</span>}</div>
                                        <div className="text-[11px] text-slate-400 truncate">{u.email || '(no email)'}</div>
                                        <div className="text-[10px] text-slate-600 font-mono truncate">{u.uid}</div>
                                        {u.requestedAccess && (
                                            <div className="text-[10px] text-amber-300 mt-1">
                                                Requested: {Object.keys(u.requestedAccess).filter(k => k !== 'at' && u.requestedAccess[k]).join(', ') || '—'}
                                            </div>
                                        )}
                                    </div>
                                    <span className={`text-[9px] px-2 py-0.5 rounded border uppercase font-bold tracking-wider ${STATUS_STYLE[u.status] || STATUS_STYLE.pending}`}>{u.status}</span>
                                </div>

                                <div className="flex flex-wrap items-center gap-1 mt-2">
                                    <Button onClick={() => setStatus(u.uid, 'approved')} disabled={busyUid === u.uid || u.status === 'approved'} variant="success" className="h-7 px-2 text-[10px] uppercase font-bold">Approve</Button>
                                    <Button onClick={() => setStatus(u.uid, 'rejected')} disabled={busyUid === u.uid || u.status === 'rejected'} variant="danger" className="h-7 px-2 text-[10px] uppercase font-bold">Reject</Button>
                                    <Button onClick={() => setStatus(u.uid, 'pending')} disabled={busyUid === u.uid || u.status === 'pending'} variant="outline" className="h-7 px-2 text-[10px] uppercase font-bold">Reset to pending</Button>
                                    <span className="w-px h-5 bg-slate-700 mx-1"></span>
                                    <Button onClick={() => setRole(u.uid, u.role === 'admin' ? 'user' : 'admin')} disabled={busyUid === u.uid || u.uid === (auth.user && auth.user.uid)}
                                        variant="outline" className="h-7 px-2 text-[10px] uppercase font-bold"
                                        title={u.uid === (auth.user && auth.user.uid) ? 'You cannot change your own role — do that in the Firebase console.' : ''}>
                                        {u.role === 'admin' ? 'Revoke admin' : 'Make admin'}
                                    </Button>
                                </div>

                                <div className="mt-2 border-t border-slate-800 pt-2">
                                    <div className="text-[9px] uppercase tracking-widest text-slate-500 font-bold mb-1">Entitlements</div>
                                    <div className="flex flex-wrap gap-1">
                                        {ENTITLEMENT_KEYS.map(({ key, label, note }) => {
                                            const on = u.entitlements[key] === true;
                                            return (
                                                <button key={key} title={note} disabled={busyUid === u.uid}
                                                    onClick={() => setEntitlement(u.uid, key, !on)}
                                                    className={`px-2 py-1 rounded border text-[10px] font-bold ${on ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300' : 'bg-slate-800 border-slate-600 text-slate-400 hover:bg-slate-700'}`}>
                                                    {on ? '✓ ' : ''}{label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {u.entitlements.expired && <div className="text-[10px] text-amber-400 mt-1">Entitlements have expired (expiresAt in the past).</div>}
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="border-t border-slate-700 mt-3 pt-3 text-[10px] text-slate-500">
                        Payments are not connected. When they are, entitlements must be written server-side from a
                        signature-verified webhook using the Firebase Admin SDK — never from this panel or any client.
                    </div>
                    <Button onClick={onClose} variant="outline" className="w-full mt-3">Close</Button>
                </div>
            </Modal>
        );
    };

    // ---- HEADER BUTTON -------------------------------------------------------------------------
    // Sits in the controller header. It is a plain button: it never auto-opens, never nags, and
    // never gates anything. Requirement B4.
    const AccountButton = ({ auth }) => {
        const { Button, Lucide } = window;
        const [showAuth, setShowAuth] = useState(false);
        const [showAdmin, setShowAdmin] = useState(false);

        const signedIn = auth.phase === 'signedIn' && auth.user;
        const label = signedIn
            ? ((auth.profile && auth.profile.displayName) || auth.user.email || 'Account')
            : 'Sign in';

        return (
            <div className="flex items-center gap-1">
                {signedIn && auth.isAdmin && (
                    <Button onClick={() => setShowAdmin(true)} variant="outline" className="h-8 px-2 text-[10px] uppercase font-bold text-sky-400 border-sky-500/50">
                        <Lucide icon="shield" className="w-3 h-3 mr-1"/> Admin
                    </Button>
                )}
                <Button onClick={() => (signedIn ? auth.signOut() : setShowAuth(true))} variant="secondary"
                    className="h-8 px-2 text-[10px] uppercase font-bold max-w-[11rem]"
                    title={signedIn ? `Signed in as ${auth.user.email} — status: ${auth.profile ? auth.profile.status : 'pending'}. Click to sign out.` : 'Optional. Only needed for restricted content.'}>
                    <Lucide icon={signedIn ? 'user' : 'log-in'} className="w-3 h-3 mr-1"/>
                    <span className="truncate">{signedIn ? 'Sign out' : label}</span>
                </Button>
                {signedIn && auth.profile && (
                    <span className={`hidden sm:inline text-[9px] px-1.5 py-0.5 rounded border uppercase font-bold tracking-wider ${auth.profile.status === 'approved' ? 'bg-emerald-950/60 border-emerald-700 text-emerald-300' : auth.profile.status === 'rejected' ? 'bg-red-950/60 border-red-700 text-red-300' : 'bg-amber-950/60 border-amber-700 text-amber-300'}`}
                        title="Approval status for restricted content only. It does not affect anything else in the app.">
                        {auth.profile.status}
                    </span>
                )}
                {showAuth && <AuthModal auth={auth} onClose={() => { auth.clearFeedback(); setShowAuth(false); }} />}
                {showAdmin && <AdminPanel auth={auth} onClose={() => setShowAdmin(false)} />}
            </div>
        );
    };

    window.AuthModal = AuthModal;
    window.AdminPanel = AdminPanel;
    window.AccountButton = AccountButton;
})();
