// Deletes live sessions nobody has touched for a day (the Realtime Database cannot expire data by
// itself). Run daily by .github/workflows/cleanup-sessions.yml with a Firebase service account.
//
//   FIREBASE_SERVICE_ACCOUNT='<service account JSON>' node scripts/cleanup-sessions.mjs
//   node scripts/cleanup-sessions.mjs --dry-run     (lists what it would delete)
//   node scripts/cleanup-sessions.mjs --self-test   (checks the selection logic; no database)
//
// A session's last activity is the newest timestamp anywhere in it: the controller's
// live/updatedAt, or a screen's presence / defib mirror / event / command. So a monitor that joined
// minutes ago and is still waiting for its controller is never deleted.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const DAY = 24 * 60 * 60 * 1000;

export function lastActivity(session) {
    if (!session || typeof session !== 'object') return 0;
    const times = [];
    const live = session.live || {};
    if (Number.isFinite(live.updatedAt)) times.push(live.updatedAt);
    ['presence', 'deviceState', 'deviceEvents'].forEach(k => Object.values(session[k] || {}).forEach(v => { if (v && Number.isFinite(v.ts)) times.push(v.ts); }));
    if (session.command && Number.isFinite(session.command.ts)) times.push(session.command.ts);
    return times.length ? Math.max(...times) : 0;
}

export function idleCodes(sessions, now, maxAge = DAY) {
    return Object.keys(sessions || {}).filter(code => lastActivity(sessions[code]) < now - maxAge);
}

function selfTest() {
    const now = Date.UTC(2026, 0, 2);
    const sessions = {
        OLDAAA: { live: { updatedAt: now - 2 * DAY } },
        NEWAAA: { live: { updatedAt: now - 60 * 1000 } },
        WAITAA: { presence: { m1: { role: 'monitor', ts: now - 5 * 60 * 1000 } } },            // monitor waiting
        OLDPRE: { presence: { m1: { role: 'monitor', ts: now - 3 * DAY } } },
        OLDLIV: { live: { updatedAt: now - 2 * DAY }, deviceState: { d1: { ts: now - 1000 } } }, // tablet still there
        EMPTYA: {}
    };
    assert.deepEqual(idleCodes(sessions, now).sort(), ['EMPTYA', 'OLDAAA', 'OLDPRE']);
    console.log('cleanup-sessions self-test passed');
}

async function main() {
    if (process.argv.includes('--self-test')) return selfTest();
    const creds = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!creds) { console.log('FIREBASE_SERVICE_ACCOUNT is not set: nothing to do. See README "Clearing out old sessions".'); return; }
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const cfg = fs.readFileSync(path.join(ROOT, 'data', 'firebase-config.js'), 'utf8');
    const databaseURL = process.env.FIREBASE_DATABASE_URL || (cfg.match(/databaseURL:\s*"([^"]+)"/) || [])[1];
    const { default: admin } = await import('firebase-admin');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(creds)), databaseURL });
    const now = Date.now();
    // Sessions whose patient has not changed for a day (or that never had one) are the candidates;
    // each is then judged on its newest activity of any kind.
    const snap = await admin.database().ref('sessions').orderByChild('live/updatedAt').endAt(now - DAY).once('value');
    const codes = idleCodes(snap.val() || {}, now);
    console.log(`${codes.length} idle session(s)${codes.length ? ': ' + codes.join(', ') : ''}`);
    if (codes.length && !process.argv.includes('--dry-run')) {
        await admin.database().ref('sessions').update(Object.fromEntries(codes.map(c => [c, null])));
        console.log('deleted');
    }
    await admin.app().delete();
}

main().catch(e => { console.error(e); process.exit(1); });
