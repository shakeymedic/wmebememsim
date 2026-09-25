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
