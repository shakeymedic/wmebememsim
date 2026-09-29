// In-memory stand-in for the Firebase v8 compat auth SDK, for the browser tests only.
// Any email signs in with the password "correct horse"; uid = "uid_" + email. The signed-in user
// is kept in localStorage so a reload restores it, as Firebase does.
(function () {
  if (!window.firebase) return;
  var KEY = 'fakeAuthUser';
  var current = null;
  try { current = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  var listeners = [];
  window.__fakeAuthLoads = (window.__fakeAuthLoads || 0) + 1;
  function save() { try { current ? localStorage.setItem(KEY, JSON.stringify(current)) : localStorage.removeItem(KEY); } catch (e) {} }
  function emit() { listeners.slice().forEach(function (fn) { try { fn(current); } catch (e) {} }); }
  function userFor(email, name) {
    return { uid: 'uid_' + String(email).replace(/[^a-z0-9]/gi, '_'), email: email, displayName: name || null,
      updateProfile: function (p) { this.displayName = p.displayName; return Promise.resolve(); } };
  }
  var auth = {
    get currentUser() { return current; },
    onAuthStateChanged: function (fn) { listeners.push(fn); setTimeout(function () { fn(current); }, 0);
      return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
    signInWithEmailAndPassword: function (email, pw) {
      if (pw !== 'correct horse') return Promise.reject({ code: 'auth/wrong-password' });
      current = userFor(email); save(); emit(); return Promise.resolve({ user: current });
    },
    createUserWithEmailAndPassword: function (email, pw) {
      if (String(pw).length < 6) return Promise.reject({ code: 'auth/weak-password' });
      current = userFor(email); save(); emit(); return Promise.resolve({ user: current });
    },
    sendPasswordResetEmail: function () { return Promise.resolve(); },
    signOut: function () { current = null; save(); emit(); return Promise.resolve(); },
    signInWithPopup: function () { return Promise.reject({ code: 'auth/operation-not-allowed' }); }
  };
  window.firebase.auth = function () { return auth; };
  window.firebase.auth.GoogleAuthProvider = function () {};
})();
