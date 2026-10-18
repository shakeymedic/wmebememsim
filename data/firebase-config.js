// The Firebase project config, shared by the controller/monitor (index.html) and the standalone
// defibrillator (defib/index.html) so the two can never point at different databases.
// These values are public client identifiers, not secrets: access is enforced by
// database.rules.json.
window.FIREBASE_CONFIG = {
    apiKey: "AIzaSyBz77EHl9QhFJ0k2ZFODydChuGeCAXq1II",
    authDomain: "wmebem-sim.firebaseapp.com",
    // This project uses Realtime Database, not Firestore. Keep the exact database host
    // explicit rather than relying on the SDK's projectId-derived fallback.
    databaseURL: "https://wmebem-sim-default-rtdb.firebaseio.com",
    projectId: "wmebem-sim",
    storageBucket: "wmebem-sim.firebasestorage.app",
    messagingSenderId: "143041936940",
    appId: "1:143041936940:web:4d15c3fc3ce7e10c081b89",
    measurementId: "G-8C6WW1EWXJ"
};

// Google sign-in runs through this site's own address on the live hosts: _redirects passes
// /__/auth/* through to wmebem-sim.firebaseapp.com. With the Firebase address as authDomain, phone
// browsers that block third-party storage (Safari, and Chrome since 2023) can lose the sign-in
// result, and the page waits for ever. Each host here needs https://<host>/__/auth/handler listed
// under the OAuth client's "Authorised redirect URIs" in Google Cloud Console, or Google refuses
// with redirect_uri_mismatch.
(function () {
    try {
        var OWN_AUTH_HOSTS = ['emsimulator.com', 'www.emsimulator.com', 'wmebemsim.netlify.app'];
        if (OWN_AUTH_HOSTS.indexOf(window.location.hostname) !== -1) window.FIREBASE_CONFIG.authDomain = window.location.host;
    } catch (e) {}
})();

// Local testing only: ?emulator=127.0.0.1:9000 points the database at the Firebase emulator. It is
// honoured only when the page itself is served from this computer, so it cannot redirect a
// deployed site.
window.useFirebaseEmulatorIfAsked = function (db) {
    try {
        var host = window.location.hostname;
        if (host !== 'localhost' && host !== '127.0.0.1') return false;
        var target = new URLSearchParams(window.location.search).get('emulator');
        var m = target && /^([\w.-]+):(\d{2,5})$/.exec(target);
        if (!m || !db || typeof db.useEmulator !== 'function') return false;
        db.useEmulator(m[1], Number(m[2]));
        return true;
    } catch (e) { return false; }
};

// ---- FIREBASE APP CHECK ----------------------------------------------------------------------
// App Check makes the database accept requests only from this site's real pages (a reCAPTCHA v3
// token the browser earns silently), not from scripts calling the database directly. It protects
// the licensed course scenarios (ETC, ALS) on top of database.rules.json.
//
// APP_CHECK_SITE_KEY: the reCAPTCHA v3 SITE key (public, not the secret key). While it is empty,
// App Check is skipped entirely and nothing changes. Setting it only SENDS tokens; whether the
// database REQUIRES them is the "Enforce" switch in the Firebase console, which stays off until the
// App Check metrics show real traffic passing. README.md, "Firebase App Check", has the steps.
window.APP_CHECK_SITE_KEY = '';

// Call straight after firebase.initializeApp() and before the first firebase.database(), on every
// page that uses the database. Returns true when App Check was turned on. Never throws: a failure
// here must not stop the sim (until enforcement is on, the database works without a token anyway).
window.initFirebaseAppCheck = function () {
    try {
        var key = String(window.APP_CHECK_SITE_KEY || '').trim();
        if (!key) return false;
        if (window.__appCheckActivated) return true;
        if (!window.firebase || typeof window.firebase.appCheck !== 'function') {
            console.warn('App Check: the App Check SDK did not load, so this page sends no App Check token.');
            return false;
        }
        // Testing on this computer: ?appcheck-debug=1 makes the SDK print a debug token in the
        // console (register it under App Check -> Apps -> Manage debug tokens). Only on localhost, so
        // a deployed page can never be put into debug mode.
        var host = window.location.hostname;
        if ((host === 'localhost' || host === '127.0.0.1') && /[?&]appcheck-debug=1(&|$)/.test(window.location.search)) {
            self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
        }
        // true = refresh the token automatically before it expires.
        window.firebase.appCheck().activate(new window.firebase.appCheck.ReCaptchaV3Provider(key), true);
        window.__appCheckActivated = true;
        return true;
    } catch (e) {
        console.warn('App Check could not start:', e);
        return false;
    }
};
