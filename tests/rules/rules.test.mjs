// database.rules.json in the real Firebase Realtime Database emulator.
// Run by the CI job "rules": `npm test` in this folder (needs Java 21 for the emulator).
import { test, before, after, beforeEach } from 'node:test';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

const RULES = fs.readFileSync(new URL('../../database.rules.json', import.meta.url), 'utf8');   // the repository's own file
const CODE = 'K7PQ3M';
let env;

before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-emsim', database: { rules: RULES, host: '127.0.0.1', port: 9000 } });
});
after(async () => { if (env) await env.cleanup(); });
beforeEach(async () => { await env.clearDatabase(); });

const anon = () => env.unauthenticatedContext().database();
const user = (uid) => env.authenticatedContext(uid).database();
const seed = (path, value) => env.withSecurityRulesDisabled(ctx => ctx.database().ref(path).set(value));

// ---- sessions ----------------------------------------------------------------------------------
test('the controller can publish the patient under a valid code', async () => {
  await assertSucceeds(anon().ref(`sessions/${CODE}/live`).update({
    vitals: { hr: 80, bpSys: 120 }, rhythm: 'Sinus Rhythm', isRunning: true, updatedAt: Date.now(),
    defib: { mode: 'off', shockCount: 0 }, activeDrugs: [{ key: 'AdrenalineIV' }]
  }));
});

test('sessions are readable by code but cannot be listed', async () => {
  await seed(`sessions/${CODE}/live/rhythm`, 'VF');
  await assertSucceeds(anon().ref(`sessions/${CODE}`).once('value'));
  await assertFails(anon().ref('sessions').once('value'));
});

test('only current-format six-character codes can be written', async () => {
  for (const bad of ['ABCD', 'abcdef', 'ABC0EF', 'AIBCDE', 'ABCDEFG']) {
    await assertFails(anon().ref(`sessions/${bad}/live/rhythm`).set('VF'));
  }
});

test('unknown fields are refused, in the patient and beside it', async () => {
  await assertFails(anon().ref(`sessions/${CODE}/live/somethingElse`).set('x'));
  await assertFails(anon().ref(`sessions/${CODE}/junk`).set({ a: 1 }));
  await assertFails(anon().ref(`sessions/${CODE}/live/updatedAt`).set('yesterday'));
});

test('presence heartbeats are accepted; extra or oversized fields are not', async () => {
  const ok = { role: 'defib', display: 'defib', ua: 'Mozilla/5.0', ts: Date.now() };
  await assertSucceeds(anon().ref(`sessions/${CODE}/presence/abc123`).update(ok));
  await assertFails(anon().ref(`sessions/${CODE}/presence/abc124`).set({ ...ok, extra: 1 }));
  await assertFails(anon().ref(`sessions/${CODE}/presence/abc125`).set({ ...ok, ua: 'x'.repeat(500) }));
  await assertFails(anon().ref(`sessions/${CODE}/presence/abc126`).set({ display: 'defib' }));
  await assertSucceeds(anon().ref(`sessions/${CODE}/presence/abc123`).remove());
});

test('defib presses, the defib mirror and monitor commands', async () => {
  await assertSucceeds(anon().ref(`sessions/${CODE}/deviceEvents`).push({ type: 'SHOCK_DELIVERED', payload: { energy: 150, sync: true }, ts: Date.now(), from: 'k5rzc2xy', device: 'standalone-defib' }));
  await assertFails(anon().ref(`sessions/${CODE}/deviceEvents`).push({ payload: {}, ts: Date.now() }));
  await assertSucceeds(anon().ref(`sessions/${CODE}/deviceState/k5rzc2xy`).set({ mode: 'pacer', machine: 'IDLE', energy: 150, sync: false, lead: 'II', gain: 1, pacerOutput: 70, pacerRate: 70, pacerDemand: true, message: 'PACER OUTPUT 70 mA', messageType: 'ready', ts: Date.now() }));
  await assertFails(anon().ref(`sessions/${CODE}/deviceState/k5rzc2xy`).set({ mode: 'pacer', ts: 'now' }));
  await assertSucceeds(anon().ref(`sessions/${CODE}/command`).set({ type: 'START_NIBP', ts: Date.now() }));
  await assertSucceeds(anon().ref(`sessions/${CODE}/command`).set({ type: 'TRIGGER_ACTION', payload: 'Oxygen', ts: Date.now() }));
  await assertFails(anon().ref(`sessions/${CODE}/command`).set({ type: 'START_NIBP' }));
});

// ---- accounts and restricted content ------------------------------------------------------------
test('a user can edit their own profile but never their role, status or entitlements', async () => {
  await assertSucceeds(user('u1').ref('users/u1').update({ email: 'a@b.org', displayName: 'A', createdAt: Date.now() }));
  await assertFails(user('u1').ref('users/u1/role').set('admin'));
  await assertFails(user('u1').ref('users/u1/status').set('approved'));
  await assertFails(user('u1').ref('users/u1/entitlements/rcuk').set(true));
  await assertFails(user('u2').ref('users/u1/email').set('x@y.org'));
  await assertFails(anon().ref('users/u1').once('value'));
});

test('an admin can approve and grant; nobody else can list users', async () => {
  await seed('users/admin1', { role: 'admin', status: 'approved' });
  await seed('users/u1', { email: 'a@b.org' });
  await assertSucceeds(user('admin1').ref('users/u1/status').set('approved'));
  await assertSucceeds(user('admin1').ref('users/u1/entitlements/rcuk').set(true));
  await assertSucceeds(user('admin1').ref('users').once('value'));
  await assertFails(user('u1').ref('users').once('value'));
});

test('restricted scenarios need an approved account with the rcuk entitlement', async () => {
  await seed('restrictedScenarios/RC001', { id: 'RC001', title: 'Test' });
  await seed('users/pending', { status: 'pending', entitlements: { rcuk: true } });
  await seed('users/approvedNoKey', { status: 'approved' });
  await seed('users/ok', { status: 'approved', entitlements: { rcuk: true } });
  await assertFails(anon().ref('restrictedScenarios').once('value'));
  await assertFails(user('pending').ref('restrictedScenarios').once('value'));
  await assertFails(user('approvedNoKey').ref('restrictedScenarios').once('value'));
  await assertSucceeds(user('ok').ref('restrictedScenarios').once('value'));
  await assertFails(user('ok').ref('restrictedScenarios/RC002').set({ id: 'RC002', title: 'Mine' }));
});

test('payment events are closed to every client', async () => {
  await seed('users/admin1', { role: 'admin', status: 'approved' });
  await assertFails(user('admin1').ref('paymentEvents/e1').set({ ok: true }));
  await assertFails(user('admin1').ref('paymentEvents').once('value'));
});
