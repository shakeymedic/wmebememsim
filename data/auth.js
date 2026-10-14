(() => {
    // =============================================================================================
    // WAVE 4b / PART B + C — ACCOUNTS, ADMIN APPROVAL, ENTITLEMENTS, RESTRICTED CONTENT
    // ---------------------------------------------------------------------------------------------
    // THE ONE RULE THIS FILE MUST NEVER BREAK (requirement B4):
    //   The app is fully usable with NO account. Nothing here may block, prompt, redirect, throw,
    //   or log noise. Sign-in gates RESTRICTED CONTENT and SAVING YOUR OWN SCENARIOS (My scenarios)
    //   only. Every other feature — all 254
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
    //     entitlements: { rcuk: false, etc: false, premium: false, expiresAt: null },   // ADMIN-WRITE-ONLY
    //     requestedAccess: { rcuk: true, at: 1758556800000 }                // user-writable, no privilege
    //   }
    // Access is an ENTITLEMENTS MAP, never a single boolean, so a paid tier is a new key
    // (`premium`, `institution`, ...) rather than a rewrite. `expiresAt` is a ms epoch or null.
    // =============================================================================================

    const { useState, useEffect, useCallback } = React;

    // ---- ENTITLEMENT KEYS ----------------------------------------------------------------------
    // Declared centrally so the admin panel, the gate and the future payment webhook agree.
    const ENTITLEMENT_KEYS = [
        { key: 'rcuk',    label: 'ALS and other courses (RCUK)', note: 'Unlocks the ALS and other non-ETC course scenarios.' },
        { key: 'etc',     label: 'ETC',                          note: 'Unlocks the ETC (European Trauma Course) scenarios and their images.' },
        { key: 'premium', label: 'Premium (future paid tier)',   note: 'Reserved. Not sold yet; no payment path is connected.' }
    ];
    const DEFAULT_ENTITLEMENTS = { rcuk: false, etc: false, premium: false, expiresAt: null };

    // ---- COURSE ACCESS -------------------------------------------------------------------------
    // Each course is released separately, because different people are entitled to each. A course
    // has its own entitlement key and its own place in the database, and database.rules.json lets
    // only accounts holding that key read it. Scenarios are routed by their `course` field: ETC to
    // courseScenarios/etc, everything else (ALS and older uploads) to restrictedScenarios.
    const COURSE_ACCESS = [
        { key: 'rcuk', name: 'ALS and other courses', short: 'ALS', path: 'restrictedScenarios', images: null },
        { key: 'etc',  name: 'ETC (European Trauma Course)', short: 'ETC', path: 'courseScenarios/etc', images: 'courseImages/etc' }
    ];
    const courseKeyFor = (sc) => {
        const c = String((sc && sc.course) || '').trim().toUpperCase();
        return c === 'ETC' ? 'etc' : 'rcuk';
    };
    window.COURSE_ACCESS = COURSE_ACCESS;
    window.courseKeyFor = courseKeyFor;

    // ---- LAZY, SILENT AUTH RESOLUTION ----------------------------------------------------------
    // The sign-in SDK (~180 KB) is fetched on demand from window.FIREBASE_AUTH_SRC: when someone
    // signs in, or at start-up when this browser has signed in before (so a returning account is
    // restored without asking). Monitors and defib tablets never fetch it.
    const AUTH_FLAG = 'wmebem_auth_used';          // '1' signed in before, '0' signed out
    let _auth = null;
    let _authError = null;
    let _sdkFailed = false;
    let _sdkPromise = null;
    const sdkPresent = () => !!(window.firebase && typeof window.firebase.auth === 'function');
    const canLoadSdk = () => sdkPresent() || !!(window.firebase && window.FIREBASE_AUTH_SRC);
    const loadAuthSdk = () => {
        if (sdkPresent()) return Promise.resolve(true);
        if (_sdkPromise) return _sdkPromise;
        if (!canLoadSdk()) { _sdkFailed = true; _authError = 'not-loaded'; return Promise.resolve(false); }
        _sdkPromise = new Promise(resolve => {
            const el = document.createElement('script');
            el.src = window.FIREBASE_AUTH_SRC;
            el.async = true;
            el.onload = () => { if (!sdkPresent()) { _sdkFailed = true; _authError = 'not-loaded'; } resolve(sdkPresent()); };
            el.onerror = () => { _sdkFailed = true; _authError = 'not-loaded'; resolve(false); };
            document.head.appendChild(el);
        });
        return _sdkPromise;
    };
    const setAuthFlag = (v) => { try { localStorage.setItem(AUTH_FLAG, v); } catch (e) {} };

    // A Google pop-up is not dependable in the installed app (the Android app, or the site added
    // to a home screen): on an iPhone home-screen app Firebase cannot even see the window, so it
    // waits for ever. There the page goes to Google and comes back instead. This flag (per tab)
    // marks a sign-in on its way back.
    const REDIRECT_FLAG = 'wmebem_google_redirect';
    const redirectPending = () => { try { return sessionStorage.getItem(REDIRECT_FLAG) === '1'; } catch (e) { return false; } };
    const setRedirectPending = (on) => { try { on ? sessionStorage.setItem(REDIRECT_FLAG, '1') : sessionStorage.removeItem(REDIRECT_FLAG); } catch (e) {} };
    // Read once as the page loads: only a page that has just come back from Google asks for the
    // result (asking on the page that is about to leave would clear the flag too early).
    let _backFromGoogle = redirectPending();
    const INSTALLED_FLAG = 'wmebem_installed_app';
    const isInstalledApp = () => {
        try {
            if (String(document.referrer || '').indexOf('android-app://') === 0) sessionStorage.setItem(INSTALLED_FLAG, '1');
            if (sessionStorage.getItem(INSTALLED_FLAG) === '1') return true;
        } catch (e) {}
        try { if (window.navigator && window.navigator.standalone === true) return true; } catch (e) {}
        try { if (window.matchMedia && (window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches)) return true; } catch (e) {}
        return false;
    };
    window.__isInstalledApp = isInstalledApp;
    // Has this browser signed in before? Our own flag first; for accounts from before the flag
    // existed, Firebase's own persisted-session storage.
    const signedInBefore = async () => {
        if (_backFromGoogle) return true;
        try {
            const f = localStorage.getItem(AUTH_FLAG);
            if (f === '1') return true;
            if (f === '0') return false;
            for (let i = 0; i < localStorage.length; i++) if (String(localStorage.key(i)).indexOf('firebase:authUser:') === 0) return true;
        } catch (e) {}
        try {
            if (window.indexedDB && indexedDB.databases) return (await indexedDB.databases()).some(d => d && d.name === 'firebaseLocalStorageDb');
        } catch (e) {}
        return false;
    };
    const getAuth = () => {
        if (_auth) return _auth;
        if (!sdkPresent()) return null;
        try {
            _auth = window.firebase.auth();
            return _auth;
        } catch (e) {
            // Deliberately NOT console.error: an un-configured project is a supported state
            // (requirement C4 — no console noise), not a bug.
            _authError = 'unavailable';
            _sdkFailed = true;
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
        'auth/popup-blocked': 'The Google sign-in window was blocked. Use the button below to sign in with Google in this window instead.',
        'auth/operation-not-supported-in-this-environment': 'Google sign-in cannot open a window here. Use the button below to sign in with Google in this window instead.',
        'auth/web-storage-unsupported': 'This browser is blocking the storage Google sign-in needs (often private browsing). Try a normal browser window, or sign in with email.',
        'auth/redirect-cancelled-by-user': 'Sign-in was cancelled.',
        'auth/user-cancelled': 'Sign-in was cancelled.',
        'auth/internal-error': 'Google sign-in did not finish. Please try again.',
        'auth/popup-closed-by-user': 'Sign-in was cancelled.',
        'auth/cancelled-popup-request': 'Sign-in was cancelled.',
        'auth/account-exists-with-different-credential': 'There is already an account with this email. Sign in with your email and password instead.',
        'auth/unauthorized-domain': 'Google sign-in is not allowed on this web address yet. The owner needs to add it under Firebase → Authentication → Settings → Authorised domains.',
        'google/not-enabled': 'Google sign-in is not switched on for this project yet. The owner can turn it on under Firebase → Authentication → Sign-in method → Google.'
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
        const [sdkReady, setSdkReady] = useState(() => sdkPresent());
        const [state, setState] = useState(() => ({
            // 'idle' while the SDK has not been fetched (nobody has signed in on this browser),
            // 'checking' until onAuthStateChanged fires once, or 'off' when auth cannot load at
            // all. Never 'error' — an unavailable auth is a normal, supported state.
            phase: sdkPresent() ? (getAuth() ? 'checking' : 'off') : (canLoadSdk() ? 'idle' : 'off'),
            available: sdkPresent() ? !!getAuth() : canLoadSdk(),
            reason: _authError,
            user: null,
            profile: null,
            busy: false,
            // true while a Google pop-up is open: the Google button then offers to cancel, so a
            // window that never reports back cannot leave the box stuck on "Working…".
            googlePending: false,
            // true after a pop-up was blocked or is not possible here: offer the same-window way.
            offerRedirect: false,
            error: null,
            notice: null
        }));

        // Returning accounts: fetch the SDK at start-up so the session is restored (never on the
        // room monitor, which has no use for an account).
        useEffect(() => {
            if (sdkReady) return;
            let gone = false;
            let monitor = false;
            try { monitor = new URLSearchParams(window.location.search).get('mode') === 'monitor'; } catch (e) {}
            if (monitor) return;
            signedInBefore().then(before => {
                if (!before || gone) return;
                setState(s => ({ ...s, phase: 'checking' }));
                return loadAuthSdk().then(ok => {
                    if (gone) return;
                    if (ok && getAuth()) setSdkReady(true);
                    else setState(s => ({ ...s, phase: 'off', available: false, reason: _authError }));
                });
            });
            return () => { gone = true; };
        }, []);

        useEffect(() => {
            if (!sdkReady) return;
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
                    // Leave any error alone: with the SDK fetched on demand, this first "nobody
                    // signed in" callback can land just after a failed first attempt.
                    setState(s => ({ ...s, phase: 'signedOut', user: null, profile: null }));
                    return;
                }
                setAuthFlag('1');
                const summary = { uid: user.uid, email: user.email, displayName: user.displayName };
                setRedirectPending(false);
                setState(s => ({ ...s, phase: 'signedIn', user: summary, error: null, busy: false, googlePending: false, offerRedirect: false }));

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
                            // A brand-new account's chosen name: the profile write races signUp's own,
                            // and updateProfile() has not always landed yet, so use the name typed.
                            displayName: user.displayName || window.__pendingSignupName || (user.email ? String(user.email).split('@')[0] : 'User'),
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

            // Back from Google in the same window: success arrives through onAuthStateChanged
            // above; a failure is only reported here, so keep it for the sign-in box.
            if (_backFromGoogle && typeof auth.getRedirectResult === 'function') {
                _backFromGoogle = false;
                auth.getRedirectResult().then(() => { setRedirectPending(false); }).catch((e) => {
                    setRedirectPending(false);
                    if (cancelled) return;
                    setState(s => ({ ...s, busy: false, googlePending: false, error: describeAuthError(e), notice: null, redirectFailed: true }));
                });
            }

            return () => { cancelled = true; detachProfile(); try { unsub(); } catch (e) {} };
        }, [sdkReady]);

        const run = useCallback(async (fn, successNotice) => {
            setState(s => ({ ...s, busy: true, googlePending: false, offerRedirect: false, error: null, notice: null }));
            const loaded = await loadAuthSdk();
            const auth = loaded ? getAuth() : null;
            if (!auth) {
                setState(s => ({ ...s, busy: false, phase: 'off', available: false, reason: _authError,
                    error: _authError === 'not-loaded' ? AUTH_MESSAGES['auth/network-request-failed'] : AUTH_MESSAGES['auth/configuration-not-found'] }));
                return false;
            }
            setSdkReady(true);
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
                const name = String(displayName || '').trim();
                window.__pendingSignupName = name || null;
                const cred = await auth.createUserWithEmailAndPassword(String(email || '').trim(), String(password || ''));
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
            }), [run]);

        const resetPassword = useCallback((email) =>
            run(auth => auth.sendPasswordResetEmail(String(email || '').trim()),
                'Password reset email sent. Check your inbox (and spam).'), [run]);

        // Signs in, or creates the account on first use (the profile is written by the
        // onAuthStateChanged handler above, as for any sign-in). If the Google provider is not
        // enabled in the console, or this web address is not an authorised domain, it fails with a
        // message saying which, and nothing else changes.
        //
        // In a browser tab Google opens in a pop-up, so the page (and anything typed in the
        // Builder) stays as it is. In the installed app, or when asked (`sameWindow`, offered after
        // a pop-up was blocked), the page goes to Google and comes back signed in.
        const googleAttempt = React.useRef(0);
        const signInWithGoogle = useCallback(async (opts) => {
            const sameWindow = !!(opts && opts.sameWindow === true) || isInstalledApp();
            const attempt = ++googleAttempt.current;
            setState(s => ({ ...s, busy: true, googlePending: !sameWindow, offerRedirect: false, error: null, notice: null }));
            const loaded = await loadAuthSdk();
            const auth = loaded ? getAuth() : null;
            if (attempt !== googleAttempt.current) return false;
            if (!auth) {
                setState(s => ({ ...s, busy: false, googlePending: false, phase: 'off', available: false, reason: _authError,
                    error: _authError === 'not-loaded' ? AUTH_MESSAGES['auth/network-request-failed'] : AUTH_MESSAGES['auth/configuration-not-found'] }));
                return false;
            }
            setSdkReady(true);
            try {
                if (!window.firebase.auth.GoogleAuthProvider) throw { code: 'google/not-enabled' };
                const provider = new window.firebase.auth.GoogleAuthProvider();
                if (provider.setCustomParameters) provider.setCustomParameters({ prompt: 'select_account' });
                if (sameWindow) {
                    setRedirectPending(true);
                    await auth.signInWithRedirect(provider);   // the page leaves for Google here
                    return true;
                }
                await auth.signInWithPopup(provider);
                if (attempt === googleAttempt.current) setState(s => ({ ...s, busy: false, googlePending: false, error: null }));
                return true;
            } catch (e0) {
                if (sameWindow) setRedirectPending(false);
                const e = (e0 && e0.code === 'auth/operation-not-allowed') ? { code: 'google/not-enabled' } : e0;
                if (attempt !== googleAttempt.current) return false;   // cancelled meanwhile
                const code = e && e.code;
                setState(s => ({ ...s, busy: false, googlePending: false, error: describeAuthError(e), notice: null,
                    offerRedirect: !sameWindow && (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') }));
                return false;
            }
        }, []);

        // Gives up waiting for the Google pop-up. If it does finish later, onAuthStateChanged
        // still signs the account in.
        const cancelGoogle = useCallback(() => {
            googleAttempt.current++;
            setState(s => ({ ...s, busy: false, googlePending: false, error: null, notice: null }));
        }, []);

        const signOut = useCallback(() => run(async (auth) => { await auth.signOut(); setAuthFlag('0'); }), [run]);

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

        const clearFeedback = useCallback(() => setState(s => ({ ...s, error: null, notice: null, offerRedirect: false, redirectFailed: false })), []);

        return {
            ...state,
            isAdmin: !!(state.profile && state.profile.role === 'admin'),
            entitlements: (state.profile && state.profile.entitlements) || { ...DEFAULT_ENTITLEMENTS },
            has: (key) => hasEntitlement(state.profile, key),
            signIn, signUp, signOut, resetPassword, signInWithGoogle, cancelGoogle, requestAccess, clearFeedback
        };
    };
    window.useAuth = useAuth;

    // =============================================================================================
    // MY SCENARIOS — custom scenarios saved to the signed-in account
    // ---------------------------------------------------------------------------------------------
    // Scenarios built in the Builder or imported from a file live at userScenarios/{uid}/{id}, and
    // the rules let only that account read or write them. Saving needs an account; running a
    // built-in scenario, or running a Builder scenario without saving it, does not.
    // Before accounts held them they lived in this browser's localStorage (LEGACY_KEY). Those are
    // still listed on this device and can be added to the account once signed in; a different web
    // address (the custom domain) cannot see them at all, which is why the account is the home now.
    // =============================================================================================
    const LEGACY_KEY = 'wmebem_custom_scenarios';
    const MAX_USER_SCENARIOS = 200;
    // Firebase keys cannot contain . # $ [ ] / and the rules cap the length.
    const safeKey = (id) => typeof id === 'string' && id.length > 0 && id.length <= 100 && !/[.#$\[\]\/\u0000-\u001f\u007f]/.test(id);
    const isScenario = (s) => !!s && typeof s === 'object' && !Array.isArray(s)
        && typeof s.id === 'string' && s.id.length > 0 && typeof s.title === 'string' && s.title.length > 0;
    // Through JSON: drops undefined and functions, which Firebase refuses to store.
    const forStorage = (s) => { const c = JSON.parse(JSON.stringify(s)); c.title = String(c.title).slice(0, 200); return c; };
    // A scenario whose id cannot be a database key gets a CUST_ id made from the old one rather than
    // being refused. The same old id always gives the same new id, so importing a file twice (or
    // adding this device's scenarios twice) skips the ones already there instead of copying them.
    const hashId = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0; return h.toString(36); };
    const withSafeId = (s) => safeKey(s.id) ? s : { ...s, id: `CUST_${hashId(String(s.id))}` };
    // set() and update() THROW (rather than reject) on a key Firebase forbids anywhere inside the
    // scenario; make that a rejection so the caller's message is shown.
    const write = (fn) => { try { return Promise.resolve(fn()); } catch (e) { return Promise.reject(e); } };
    const listFrom = (raw) => {
        if (!raw || typeof raw !== 'object') return [];
        return Object.keys(raw).map(k => raw[k]).filter(isScenario)
            .sort((a, b) => (Number(a.savedAt) || 0) - (Number(b.savedAt) || 0) || a.title.localeCompare(b.title));
    };

    const UserScenarios = {
        LEGACY_KEY, MAX: MAX_USER_SCENARIOS, isScenario, safeKey,
        // Live list for one account. onList gets an array; onError gets 'denied' or 'unavailable'.
        subscribe(uid, onList, onError) {
            if (!uid || !window.db) { if (onError) onError('unavailable'); return () => {}; }
            const ref = window.db.ref(`userScenarios/${uid}`);
            const handler = ref.on('value', snap => {
                const list = listFrom(snap.val());
                UserScenarios.cache = list;
                onList(list);
            }, (e) => {
                if (onError) onError(/permission|denied/i.test(String((e && e.message) || '')) ? 'denied' : 'unavailable');
            });
            return () => { try { ref.off('value', handler); } catch (e) {} };
        },
        save(uid, scenario) {
            if (!uid || !window.db) return Promise.reject(new Error('Sign in to save scenarios.'));
            if (!isScenario(scenario)) return Promise.reject(new Error('A scenario needs an id and a title.'));
            const s = withSafeId(forStorage(scenario));
            s.savedAt = Date.now();
            return write(() => window.db.ref(`userScenarios/${uid}/${s.id}`).set(s)).then(() => s);
        },
        // Several at once (file import, moving this device's scenarios in). Ids already in the
        // account are skipped, never overwritten. Resolves to the number added.
        saveMany(uid, list, existing) {
            if (!uid || !window.db) return Promise.reject(new Error('Sign in to save scenarios.'));
            const have = new Set((existing || []).map(s => s.id));
            const room = Math.max(0, MAX_USER_SCENARIOS - have.size);
            const updates = {};
            let n = 0;
            (list || []).filter(isScenario).forEach(raw => {
                if (n >= room || have.has(raw.id)) return;
                const s = withSafeId(forStorage(raw));
                if (have.has(s.id)) return;
                s.savedAt = Date.now() + n;
                updates[s.id] = s;
                have.add(s.id);
                n++;
            });
            if (!n) return Promise.resolve(0);
            return write(() => window.db.ref(`userScenarios/${uid}`).update(updates)).then(() => n);
        },
        remove(uid, id) {
            if (!uid || !window.db || !safeKey(id)) return Promise.reject(new Error('Sign in to delete scenarios.'));
            return window.db.ref(`userScenarios/${uid}/${id}`).remove();
        },
        // Scenarios saved in this browser before accounts held them.
        readLegacy() {
            try {
                const raw = localStorage.getItem(LEGACY_KEY);
                if (!raw) return [];
                const parsed = JSON.parse(raw);
                return (Array.isArray(parsed) ? parsed : [parsed]).filter(isScenario);
            } catch (e) { return []; }
        },
        clearLegacy() { try { localStorage.removeItem(LEGACY_KEY); } catch (e) {} },
        // The signed-in account's list as last loaded, so a resumed run can find its scenario.
        cache: []
    };
    window.UserScenarios = UserScenarios;

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
    // `keys` are the course entitlements this account holds (window.COURSE_ACCESS). Each course is
    // read on its own, so a refusal for one (not entitled, rules not yet published) does not hide
    // the other. ETC scenarios uploaded to restrictedScenarios before the courses were split are
    // skipped there: they belong to ETC and the next upload moves them.
    window.loadRestrictedScenarios = async (keys = ['rcuk']) => {
        if (!window.db) return { ok: false, reason: 'no-database', scenarios: [] };
        const wanted = COURSE_ACCESS.filter(c => keys.includes(c.key));
        const scenarios = [];
        let okCount = 0, denied = false;
        for (const c of wanted) {
            try {
                const snap = await window.db.ref(c.path).once('value');
                okCount++;
                const raw = snap.val();
                if (!raw || typeof raw !== 'object') continue;
                const list = Array.isArray(raw) ? raw : Object.keys(raw).map(k => {
                    const entry = raw[k];
                    if (!entry || typeof entry !== 'object') return null;
                    return { ...entry, id: entry.id || k };
                });
                list.forEach(s => {
                    // Same shape guard the custom-scenario importer uses: an id and a title, or it is
                    // not a scenario and must not reach the list renderer.
                    if (!s || typeof s.id !== 'string' || !s.id || typeof s.title !== 'string' || !s.title) return;
                    if (courseKeyFor(s) !== c.key) return;
                    if (scenarios.some(x => x.id === s.id)) return;
                    try {
                        const enriched = window.enrichScenario ? window.enrichScenario({ ...s, restricted: true, courseKey: c.key }) : { ...s, restricted: true, courseKey: c.key };
                        if (enriched) scenarios.push(enriched);
                    } catch (e) { /* one malformed pasted entry must not take the list down */ }
                });
            } catch (e) {
                // PERMISSION_DENIED is the expected, correct answer for an unentitled account. It is a
                // state, not an error, and must not reach the console (requirement C4).
                if (/permission|denied/i.test(String((e && e.message) || ''))) denied = true;
            }
        }
        if (!okCount) return { ok: false, reason: denied ? 'denied' : 'unavailable', scenarios: [] };
        return { ok: true, reason: scenarios.length ? 'loaded' : 'empty', scenarios };
    };

    // A course image (an X-ray, CT, eFAST or scene photo from the course slides), read when a mark
    // sheet shows it. Same entitlement as the course's scenarios. Cached for the page's lifetime.
    const _courseImageCache = {};
    window.loadCourseImage = async (courseKey, id) => {
        const c = COURSE_ACCESS.find(x => x.key === courseKey);
        if (!c || !c.images || !id || !window.db) return null;
        const k = `${courseKey}/${id}`;
        if (!_courseImageCache[k]) {
            _courseImageCache[k] = window.db.ref(`${c.images}/${id}`).once('value')
                .then(snap => { const v = snap.val(); return v && typeof v.src === 'string' ? v : null; })
                .catch(() => { delete _courseImageCache[k]; return null; });
        }
        return _courseImageCache[k];
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
            <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{label}</span>
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

        // Once signed in (email, new account or the Google window) the box has done its job: close
        // it so the header shows the account straight away instead of a sign-in form that looks
        // as if nothing happened.
        const signedInNow = auth.phase === 'signedIn' && !!auth.user;
        useEffect(() => { if (signedInNow && onClose) onClose(); }, [signedInNow]);

        // Fetch the sign-in library as the box opens, so tapping "Continue with Google" opens
        // Google's window straight away: a phone browser blocks a window opened after a wait.
        useEffect(() => { if (auth.available && canLoadSdk()) loadAuthSdk(); }, []);
        const installed = isInstalledApp();

        return (
            <Modal label="Account" onClose={onClose}>
                <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-md shadow-2xl">
                    <div className="flex justify-between items-start mb-3">
                        <div>
                            <h3 className="text-lg font-bold text-white uppercase tracking-wider">Account</h3>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                                An account saves your own scenarios so you can use them on any device. Everything else in the app works without one.
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
                                        className={`pb-2 px-2 text-[11px] font-bold uppercase tracking-wider ${tab === id ? 'text-sky-400 border-b-2 border-sky-400' : 'text-slate-400 hover:text-slate-300'}`}>{label}</button>
                                ))}
                            </div>

                            {tab !== 'reset' && (
                                <>
                                    {auth.googlePending ? (
                                        <div className="space-y-1">
                                            <button type="button" onClick={auth.cancelGoogle}
                                                className="w-full h-11 rounded border border-slate-500 bg-slate-200 text-slate-900 text-sm font-bold hover:bg-white flex items-center justify-center gap-2">
                                                Waiting for Google… tap to cancel
                                            </button>
                                            <p className="text-[11px] text-slate-400 text-center" role="status">Finish signing in in the Google window. If you closed it, tap the button above and try again.</p>
                                        </div>
                                    ) : (
                                        <button type="button" onClick={() => auth.signInWithGoogle()} disabled={auth.busy}
                                            className="w-full h-11 rounded border border-slate-500 bg-white text-slate-900 text-sm font-bold hover:bg-slate-100 flex items-center justify-center gap-2 disabled:opacity-60">
                                            <span aria-hidden="true" className="font-black text-base text-sky-600">G</span>
                                            {tab === 'signup' ? 'Create account with Google' : 'Continue with Google'}
                                        </button>
                                    )}
                                    {installed && !auth.googlePending && context && /save/i.test(context) && (
                                        <p className="text-[11px] text-amber-300 text-center">In the app, Google sign-in leaves this page briefly, so anything not yet saved is lost. Signing in with email keeps it.</p>
                                    )}
                                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-400" aria-hidden="true">
                                        <span className="flex-1 border-t border-slate-700"></span>or use email<span className="flex-1 border-t border-slate-700"></span>
                                    </div>
                                </>
                            )}
                            {tab === 'signup' && <Field label="Display name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Optional" autoComplete="name" />}
                            <Field label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required />
                            {tab !== 'reset' && <Field label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={tab === 'signup' ? 'new-password' : 'current-password'} required />}

                            {auth.error && <div className="bg-red-950/50 border border-red-600 rounded p-2 text-[11px] text-red-200">{auth.error}</div>}
                            {auth.offerRedirect && (
                                <button type="button" onClick={() => auth.signInWithGoogle({ sameWindow: true })} disabled={auth.busy}
                                    className="w-full h-11 rounded border border-sky-500 bg-slate-900 text-sky-200 text-sm font-bold hover:bg-slate-800 disabled:opacity-60">
                                    Sign in with Google in this window
                                </button>
                            )}
                            {auth.notice && <div className="bg-emerald-950/50 border border-emerald-600 rounded p-2 text-[11px] text-emerald-200">{auth.notice}</div>}

                            <Button type="submit" variant="primary" disabled={auth.busy} className="w-full h-11 font-bold">
                                {auth.busy && !auth.googlePending ? 'Working…' : (tab === 'signin' ? 'Sign in' : tab === 'signup' ? 'Create account' : 'Send reset email')}
                            </Button>
                        </form>
                    )}
                    <Button onClick={onClose} variant="outline" className="w-full mt-4">Close</Button>
                </div>
            </Modal>
        );
    };

    // ---- COURSE SCENARIO UPLOAD (admin) --------------------------------------------------------
    // Restricted course scenarios (e.g. the ETC pack) are kept OUT of this public repository and
    // uploaded from a JSON file the owner holds. Accepts { "<ID>": scenario, … }, an array of
    // scenarios, { "restrictedScenarios": { … } }, or { "scenarios": { … }, "images": { … } }.
    // Each scenario goes to its course's place (COURSE_ACCESS: ETC to courseScenarios/etc, the
    // rest to restrictedScenarios) with update(), so scenarios already there that are not in the
    // file are left alone, a scenario with the same id is replaced, and a copy of it left in the
    // other course's place is removed. Images (data URLs, one per key, each with a `credit`) go to
    // courseImages/<course>/<id>, one write each: a single write is limited in size.
    const BAD_KEY = /[.#$\[\]\/]/;
    const parseCourseScenarioFile = (text) => {
        let raw;
        try { raw = JSON.parse(text); } catch (e) { return { error: 'That file is not valid JSON.' }; }
        let rawImages = null;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            if (raw.images && typeof raw.images === 'object' && !Array.isArray(raw.images)) rawImages = raw.images;
            if (raw.scenarios && typeof raw.scenarios === 'object') raw = raw.scenarios;
            else if (raw.restrictedScenarios && typeof raw.restrictedScenarios === 'object') raw = raw.restrictedScenarios;
        }
        const list = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.keys(raw).map(k => (raw[k] && typeof raw[k] === 'object') ? { ...raw[k], id: raw[k].id || k } : null) : []);
        const ok = {}, bad = [];
        list.forEach((sc, i) => {
            const id = sc && typeof sc.id === 'string' ? sc.id.trim() : '';
            if (!sc || !id || typeof sc.title !== 'string' || !sc.title.trim()) { bad.push(`item ${i + 1}: needs an id and a title`); return; }
            if (BAD_KEY.test(id)) { bad.push(`${id}: an id cannot contain . # $ [ ] or /`); return; }
            if (ok[id]) { bad.push(`${id}: appears twice`); return; }
            // Realtime Database refuses the whole upload if any key, at any depth, has one of these.
            const badKey = (function find(v) {
                if (!v || typeof v !== 'object') return null;
                for (const k of Object.keys(v)) { if (BAD_KEY.test(k)) return k; const inner = find(v[k]); if (inner) return inner; }
                return null;
            })(sc);
            if (badKey) { bad.push(`${id}: the field name "${badKey.slice(0, 40)}" cannot contain . # $ [ ] or /`); return; }
            ok[id] = { ...sc, id };
        });
        const images = {};
        if (rawImages) Object.keys(rawImages).forEach(id => {
            const im = rawImages[id];
            if (BAD_KEY.test(id) || id.length > 100) { bad.push(`image ${id.slice(0, 40)}: an id cannot contain . # $ [ ] or /`); return; }
            if (!im || typeof im.src !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(im.src)) { bad.push(`image ${id}: needs a JPEG, PNG or WebP data URL`); return; }
            if (im.src.length > 1000000) { bad.push(`image ${id}: larger than 1 MB`); return; }
            if (typeof im.credit !== 'string' || !im.credit.trim()) { bad.push(`image ${id}: needs a credit`); return; }
            const key = courseKeyFor(im);
            const course = COURSE_ACCESS.find(c => c.key === key);
            if (!course || !course.images) { bad.push(`image ${id}: images are only stored for ETC`); return; }
            images[id] = { key, value: { src: im.src, credit: im.credit.slice(0, 400), modality: String(im.modality || '').slice(0, 16), ...(Number.isFinite(im.w) ? { w: im.w } : {}), ...(Number.isFinite(im.h) ? { h: im.h } : {}) } };
        });
        if (!Object.keys(ok).length && !Object.keys(images).length) return { error: bad.length ? `No scenarios could be read (${bad.slice(0, 3).join('; ')}).` : 'The file has no scenarios in it.' };
        const courses = {};
        Object.values(ok).forEach(sc => { const c = (typeof sc.course === 'string' && sc.course.trim()) || 'No course'; courses[c] = (courses[c] || 0) + 1; });
        return { scenarios: ok, images, bad, courses };
    };
    window.parseCourseScenarioFile = parseCourseScenarioFile;

    // Writes a parsed file. `onProgress(done, total)` follows the image writes.
    const uploadCourseFile = async (parsed, onProgress) => {
        const byPath = {};
        COURSE_ACCESS.forEach(c => { byPath[c.path] = {}; });
        Object.values(parsed.scenarios || {}).forEach(sc => {
            const key = courseKeyFor(sc);
            COURSE_ACCESS.forEach(c => { byPath[c.path][sc.id] = c.key === key ? sc : null; });
        });
        for (const path of Object.keys(byPath)) {
            if (Object.keys(byPath[path]).length) await window.db.ref(path).update(byPath[path]);
        }
        const ids = Object.keys(parsed.images || {});
        for (let i = 0; i < ids.length; i++) {
            const { key, value } = parsed.images[ids[i]];
            const course = COURSE_ACCESS.find(c => c.key === key);
            await window.db.ref(`${course.images}/${ids[i]}`).set(value);
            if (onProgress) onProgress(i + 1, ids.length);
        }
    };
    window.uploadCourseFile = uploadCourseFile;

    const CourseScenarioUpload = () => {
        const { Button, Lucide } = window;
        const [parsed, setParsed] = useState(null);
        const [fileName, setFileName] = useState('');
        const [busy, setBusy] = useState(false);
        const [progress, setProgress] = useState(null);
        const [message, setMessage] = useState(null);
        const onFile = (e) => {
            const f = e.target.files && e.target.files[0];
            setMessage(null); setParsed(null); setFileName(f ? f.name : '');
            if (!f) return;
            const reader = new FileReader();
            reader.onload = () => setParsed(parseCourseScenarioFile(String(reader.result || '')));
            reader.onerror = () => setParsed({ error: 'The file could not be read.' });
            reader.readAsText(f);
        };
        const count = parsed && parsed.scenarios ? Object.keys(parsed.scenarios).length : 0;
        const imageCount = parsed && parsed.images ? Object.keys(parsed.images).length : 0;
        const upload = async () => {
            if (!parsed || (!count && !imageCount) || !window.db) return;
            setBusy(true); setMessage(null); setProgress(null);
            try {
                await uploadCourseFile(parsed, (done, total) => setProgress(`${done} of ${total} images`));
                setMessage({ ok: true, text: `Uploaded ${count} scenario${count === 1 ? '' : 's'}${imageCount ? ` and ${imageCount} image${imageCount === 1 ? '' : 's'}` : ''}. Reopen Course scenarios to see them.` });
                setParsed(null);
            } catch (e) {
                setMessage({ ok: false, text: 'The database refused the upload. Only an admin can write course scenarios: check your own role is "admin" and that database.rules.json is published.' });
            }
            setBusy(false); setProgress(null);
        };
        const label = `Upload ${count} scenario${count === 1 ? '' : 's'}${imageCount ? ` and ${imageCount} image${imageCount === 1 ? '' : 's'}` : ''}`;
        return (
            <div className="border-t border-slate-700 mt-3 pt-3" data-testid="course-upload">
                <div className="text-[11px] font-bold uppercase tracking-wider text-amber-400 mb-1 flex items-center gap-1"><Lucide icon="upload" className="w-3 h-3"/> Course scenarios</div>
                <p className="text-[11px] text-slate-400 mb-2">Upload a course scenario file (JSON). ETC scenarios and images are only readable with ETC access; all others with ALS access. Scenarios with the same id are replaced; others already in the database are kept.</p>
                <label className="inline-flex items-center gap-2 text-xs text-slate-200">
                    <span className="sr-only">Course scenario file</span>
                    <input type="file" accept="application/json,.json" aria-label="Course scenario file" onChange={onFile} className="text-xs text-slate-300 file:mr-2 file:rounded file:border file:border-slate-600 file:bg-slate-900 file:px-2 file:py-1 file:text-slate-200" />
                </label>
                {parsed && parsed.error && <div className="text-[11px] text-red-300 mt-2">{parsed.error}</div>}
                {(count > 0 || imageCount > 0) && (
                    <div className="mt-2 text-[11px] text-slate-300 space-y-1">
                        <div>{fileName}: <b>{count}</b> scenario{count === 1 ? '' : 's'}{count ? ` (${Object.keys(parsed.courses).map(c => `${c}: ${parsed.courses[c]}`).join(', ')})` : ''}{imageCount ? <>, <b>{imageCount}</b> image{imageCount === 1 ? '' : 's'}</> : null}.</div>
                        {parsed.bad.length > 0 && <div className="text-amber-300">Skipped {parsed.bad.length}: {parsed.bad.slice(0, 5).join('; ')}{parsed.bad.length > 5 ? '…' : ''}</div>}
                        <Button onClick={upload} disabled={busy} variant="primary" className="h-8 px-3 text-xs">{busy ? `Uploading…${progress ? ` ${progress}` : ''}` : label}</Button>
                    </div>
                )}
                {message && <div className={`text-[11px] mt-2 ${message.ok ? 'text-emerald-300' : 'text-red-300'}`}>{message.text}</div>}
            </div>
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
                        {users === null && !error && <div className="text-slate-400 text-sm text-center py-8">Loading users…</div>}
                        {users !== null && shown.length === 0 && <div className="text-slate-400 text-sm text-center py-8">No users in this view.</div>}
                        {shown.map(u => (
                            <div key={u.uid} className="bg-slate-900 border border-slate-700 rounded p-3">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="text-sm font-bold text-white truncate">{u.displayName || '(no name)'} {u.role === 'admin' && <span className="ml-1 text-[9px] px-1 rounded bg-sky-950 border border-sky-600 text-sky-300 uppercase font-bold">admin</span>}</div>
                                        <div className="text-[11px] text-slate-400 truncate">{u.email || '(no email)'}</div>
                                        <div className="text-[10px] text-slate-400 font-mono truncate">{u.uid}</div>
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
                                    <div className="text-[9px] uppercase tracking-widest text-slate-400 font-bold mb-1">Entitlements</div>
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

                    <CourseScenarioUpload />

                    <div className="border-t border-slate-700 mt-3 pt-3 text-[10px] text-slate-400">
                        Payments are not connected. When they are, entitlements must be written server-side from a
                        signature-verified webhook using the Firebase Admin SDK — never from this panel or any client.
                    </div>
                    <Button onClick={onClose} variant="outline" className="w-full mt-3">Close</Button>
                </div>
            </Modal>
        );
    };

    // ---- ACCOUNT PANEL -------------------------------------------------------------------------
    // Opened from the header once signed in: who you are, sign out, and (only if you want it) a
    // request for access to course scenarios. Course access is opt-in here rather than a status
    // badge in the header, because most people never need it.
    const COURSE_ACCESS_TEXT = 'Scenarios from specific courses (for example ALS and ETC) are copyrighted, so they are only released to approved course faculty and participants. Each course is approved separately.';
    // One row per course: approved, requested, or a Request button. Also used by the locked
    // Course scenarios section (data/screens/setup.js).
    const courseAccessState = (auth, key) => {
        const p = (auth && auth.profile) || {};
        if (auth && auth.has && auth.has(key)) return 'approved';
        if (p.status === 'rejected') return 'declined';
        return (p.requestedAccess && p.requestedAccess[key]) ? 'requested' : 'none';
    };
    const CourseAccessList = ({ auth, compact = false }) => {
        const { Button } = window;
        return (
            <ul className="space-y-1.5" data-testid="course-access-list">
                {COURSE_ACCESS.map(c => {
                    const st = courseAccessState(auth, c.key);
                    return (
                        <li key={c.key} className="flex flex-wrap items-center justify-between gap-2 text-xs" data-testid={`course-access-${c.key}`}>
                            <span className="text-slate-200 font-bold">{c.name}</span>
                            {st === 'approved' ? <span className="text-emerald-300 font-bold">Access approved</span>
                                : st === 'declined' ? <span className="text-red-300">Not approved</span>
                                : st === 'requested' ? <span className="text-amber-300">Requested, awaiting approval</span>
                                : <Button onClick={() => auth.requestAccess(c.key)} variant="outline" className={`${compact ? 'h-7' : 'h-8'} px-3 text-xs text-amber-300 border-amber-500/60`}>Request {c.short} access</Button>}
                        </li>
                    );
                })}
            </ul>
        );
    };
    window.CourseAccessList = CourseAccessList;
    window.courseAccessState = courseAccessState;
    const AccountPanel = ({ auth, onClose }) => {
        const { Button, Lucide, Modal } = window;
        const p = auth.profile || {};
        const anyApproved = COURSE_ACCESS.some(c => courseAccessState(auth, c.key) === 'approved');
        return (
            <Modal label="Your account" onClose={onClose}>
                <div className="bg-slate-800 p-6 rounded-lg border border-slate-600 w-full max-w-md shadow-2xl space-y-4">
                    <div className="flex justify-between items-start">
                        <div>
                            <h3 className="text-lg font-bold text-white uppercase tracking-wider">Your account</h3>
                            <p className="text-sm text-emerald-300 mt-1 flex items-center gap-1"><Lucide icon="check-circle" className="w-4 h-4"/> Signed in{auth.user && auth.user.email ? <> as <span className="font-bold text-white">{auth.user.email}</span></> : null}</p>
                        </div>
                        <button aria-label="Close account panel" onClick={onClose} className="text-slate-400 hover:text-white"><Lucide icon="x" className="w-5 h-5"/></button>
                    </div>
                    <p className="text-xs text-slate-300">Your saved scenarios (My scenarios) are kept in this account and are available on any device you sign in on.</p>

                    <section className="bg-slate-900 border border-slate-700 rounded p-3 space-y-2" aria-labelledby="course-access-heading">
                        <h4 id="course-access-heading" className="text-sm font-bold text-white">Course scenarios (optional)</h4>
                        <p className="text-xs text-slate-400">{COURSE_ACCESS_TEXT} You only need this if you teach or attend one of those courses.</p>
                        <CourseAccessList auth={auth} />
                        {anyApproved && <p className="text-xs text-emerald-300">Your course scenarios are in Scenario library, under Course scenarios.</p>}
                        {p.status === 'rejected' && <p className="text-xs text-red-300">Your request was not approved. Contact the site owner if you think this is wrong.</p>}
                        {auth.notice && <div className="text-[11px] text-emerald-300">{auth.notice}</div>}
                        {auth.error && <div className="text-[11px] text-red-300">{auth.error}</div>}
                    </section>

                    <div className="flex gap-2">
                        <Button onClick={async () => { await auth.signOut(); onClose(); }} variant="secondary" disabled={auth.busy} className="flex-1 h-10"><Lucide icon="log-out" className="w-4 h-4 mr-1"/> Sign out</Button>
                        <Button onClick={onClose} variant="outline" className="flex-1 h-10">Close</Button>
                    </div>
                </div>
            </Modal>
        );
    };

    // ---- HEADER BUTTON -------------------------------------------------------------------------
    // Sits in the controller header. It is a plain button: it never auto-opens, never nags, and
    // never gates anything. Requirement B4. Signed in, it shows the account's name and opens the
    // account panel.
    const AccountButton = ({ auth }) => {
        const { Button, Lucide } = window;
        const [showAuth, setShowAuth] = useState(false);
        const [showAccount, setShowAccount] = useState(false);
        const [showAdmin, setShowAdmin] = useState(false);

        const signedIn = auth.phase === 'signedIn' && auth.user;
        const name = signedIn ? ((auth.profile && auth.profile.displayName) || auth.user.displayName || auth.user.email || 'Account') : null;
        // Each box belongs to one state: signing in closes the sign-in box, signing out the
        // account panel, so neither reappears by itself on the next change.
        useEffect(() => { if (signedIn) setShowAuth(false); else setShowAccount(false); }, [!!signedIn]);
        // The one exception to "never auto-opens": back from Google in the same window with a
        // failure, the person has just asked to sign in, so show them why it did not work.
        useEffect(() => { if (auth.redirectFailed && !signedIn) setShowAuth(true); }, [!!auth.redirectFailed]);

        return (
            <div className="flex items-center gap-1">
                {signedIn && auth.isAdmin && (
                    <Button onClick={() => setShowAdmin(true)} variant="outline" className="h-8 px-2 text-[10px] uppercase font-bold text-sky-400 border-sky-500/50">
                        <Lucide icon="shield" className="w-3 h-3 mr-1"/> Admin
                    </Button>
                )}
                {signedIn ? (
                    <Button onClick={() => setShowAccount(true)} variant="secondary" ariaLabel={`Your account (${name})`}
                        className="h-8 px-2 text-[11px] font-bold max-w-[13rem] border-emerald-700/70">
                        <Lucide icon="user" className="w-3 h-3 mr-1 text-emerald-300"/>
                        <span className="truncate">{name}</span>
                    </Button>
                ) : (
                    <Button onClick={() => setShowAuth(true)} variant="secondary" className="h-8 px-2 text-[10px] uppercase font-bold">
                        <Lucide icon="log-in" className="w-3 h-3 mr-1"/>
                        <span>Sign in</span>
                    </Button>
                )}
                {showAuth && !signedIn && <AuthModal auth={auth} onClose={() => { auth.clearFeedback(); setShowAuth(false); }} />}
                {showAccount && signedIn && <AccountPanel auth={auth} onClose={() => { auth.clearFeedback(); setShowAccount(false); }} />}
                {showAdmin && <AdminPanel auth={auth} onClose={() => setShowAdmin(false)} />}
            </div>
        );
    };

    window.AuthModal = AuthModal;
    window.AdminPanel = AdminPanel;
    window.AccountButton = AccountButton;
    window.AccountPanel = AccountPanel;
})();
