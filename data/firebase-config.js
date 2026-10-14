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
