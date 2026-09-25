# WMEBEM Sim — West Midlands Emergency Medicine simulation suite

A facilitator-driven clinical simulation suite: a **controller** the facilitator drives, a **monitor**
screen the candidates watch, and a **defibrillator** simulator for a second tablet. Vanilla React 18 +
Tailwind. **Editing a file and pushing is still the whole deployment process**: the source runs
as-is in a browser (CDN React, in-browser Babel, the Tailwind CDN), and on every push Netlify runs
`npm run build`, which precompiles it into `dist/` with React, Firebase and the CSS self-hosted (see
*Production build* below). If that build ever fails, Netlify keeps serving the previous version.

| Path | What it is |
| --- | --- |
| `index.html` | Shell: CDN scripts, Firebase init (`window.db`), `ControllerApp`, `MonitorContainer` routing |
| `data/rhythms.js` | The single shared rhythm registry (`window.RHYTHMS`) — labels, shockability, arrest/ROSC sets, energy ladders |
| `data/interventions.js` | Every intervention and drug, with routes, effects and pharmacokinetic envelopes |
| `data/generators.js` | Random-patient generation, WETFLAG, VBG/imaging synthesis, builder validation, `buildQuickSimScenario` |
| `data/scenarios.js` | The 254 built-in scenarios plus `enrichScenario()` |
| `data/engine.js` | `useSimulation()` — all simulation state, the vitals model, drug PK, deterioration, arrest, defib, Firebase sync |
| `data/auth.js` | Firebase Auth, the entitlements model, the admin panel, restricted-scenario loading |
| `data/components.js` | Shared UI primitives (`Button`, `Modal`, `Lucide`, `ECGMonitor`, …) |
| `data/screens/` | `setup.js`, `livesim.js` (controller), `monitor.js`, `debrief.js` |
| `defib/` | The standalone defibrillator page and its cache-first service worker |
| `database.rules.json` | The Realtime Database security rules **you must paste into the Firebase console** |

---

## Running it

Open `index.html` over HTTP (not `file://` — the service worker and module fetches need an origin).

```bash
python3 -m http.server 8000
```

- Controller: `http://localhost:8000/`
- Monitor: `http://localhost:8000/?mode=monitor&session=ABCD`
- Defibrillator: `http://localhost:8000/defib/?session=ABCD`

The **Session ID** shown in the controller header is what pairs the screens. It maps to
`sessions/<CODE>` in the Realtime Database. New codes are six characters with no look-alike
characters (no 0/O, 1/I/L); a code already stored on a device is kept, and old four-character codes
still work. The controller's **Join** button shows QR codes for the room monitor and the defib, so a
tablet can pair by scanning instead of typing.

The standalone defibrillator links over the same Firebase session (`?session=CODE`, or type the code
into its banner), so it works on a separate tablet. The monitor-hosted defib (the controller's
**Defib** button) remains available too.

### Clearing out old sessions (optional, needs a server job)

`sessions/*` is deliberately open so monitors join with nothing but a code, and the Realtime Database
cannot expire data by itself, so old sessions accumulate. Each session carries `updatedAt` (epoch ms,
rounded to the minute) for a cleanup job to key on. **This job is not deployed**; if you want it, a
scheduled Cloud Function along these lines deletes sessions idle for more than a day:

```js
// functions/index.js — requires the Blaze plan. Not part of this repository's deployment.
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin'); admin.initializeApp();
exports.purgeOldSessions = onSchedule('every 24 hours', async () => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const snap = await admin.database().ref('sessions').orderByChild('updatedAt').endAt(cutoff).once('value');
  const updates = {}; snap.forEach(c => { updates[c.key] = null; });
  if (Object.keys(updates).length) await admin.database().ref('sessions').update(updates);
});
```

(Add `".indexOn": ["updatedAt"]` under `sessions` in the rules if you deploy it.)

---

## Launch modes

| Mode | What it does |
| --- | --- |
| **Quick Sim** | A blank synthetic patient and nothing else. Editable obs, the full rhythm list, arrest/ROSC, the monitor and the defib toggle. No scenario, no drugs, no interventions. For ad-hoc teaching at the bedside. |
| **Random** | Generates a patient from the scenario templates with randomised demographics and obs. |
| **Premade** | Pick from the 254 built-in scenarios by category. |
| **Restricted** | Copyright-restricted scenarios (e.g. RCUK), loaded from Firebase at runtime and gated on an entitlement. Locked unless your account has it. |
| **Custom** | Paste or import a scenario JSON file. |
| **Builder** | Build a scenario field by field in the UI. |

### Quick Sim

Quick Sim runs the **same controller** as everything else, with the scenario-dependent panels omitted —
it is not a separate implementation. It sets `scenario.quickSim = true` on a synthetic patient built by
`window.buildQuickSimScenario()`, and the controller, the monitor and the debrief all read that one
flag. Consequences worth knowing:

- It starts with **no monitoring attached**, like every other mode: the team's monitor reads "No sensor
  detected" until the facilitator attaches the standard set (one press, on the strip or in *Monitoring &
  access*) or individual sensors. Removing a sensor blanks its trace and number on both the team's
  monitor and the controller strip at once (ECG/SpO2 lanes stay in place, labelled "leads off" /
  "no probe"). The exception is NIBP: removing the cuff keeps the last measured reading on screen (marked "cuff
  off") and no new reading can be taken until it is back on. The pulse beep and each alarm follow the
  sensor that measures them, and in Quick Sim they sound before START too (like the trace), falling
  silent only when you deliberately pause or finish.
- Deterioration is always **MANUAL** (the synthetic patient declares no rate, so AUTO could never do
  anything) and the AUTO/MANUAL toggle is hidden. Ramp obs with the trend control on any vitals tile.
- **Presets** run a scripted sequence of rhythm and obs changes with one press (for example
  bradycardia → complete heart block, or SVT that reverts when you press Next). Steps fire on a timer
  that freezes while you pause, or wait for **Next**. **+ Save current** stores the present rhythm and
  obs as a one-press preset on that device. Built-in presets live in `data/presets.js`.
- Age and weight are optional. Set a paediatric age and **WETFLAG, paediatric defibrillation energies
  and weight-based dosing all work**; leave them alone and you get a sensible 40-year-old adult.
- It **does** produce a debrief — event log, vitals trend, instructor notes — but no score and no
  learning objectives, because there is no scenario to have objectives.

---

## Firebase setup — what you must do in the console yourself

The app works **completely without any of this**. Every launch mode except Restricted, all 254
scenarios, the monitor, the defibrillator and the debrief work with no account and no sign-in. The
steps below only enable accounts and restricted content.

### 1. Enable Email/Password sign-in

Firebase console → **Build → Authentication → Get started → Sign-in method → Email/Password → Enable →
Save**. (Optionally enable **Google** too; the app offers a Google button and hides it silently if the
provider is not enabled.)

Until you do this, the account button shows "Accounts unavailable" and the Restricted section shows as
locked with an explanation. No errors, no console noise.

### 2. Publish the database rules

Firebase console → **Build → Realtime Database → Rules**. Paste the contents of
[`database.rules.json`](./database.rules.json) and press **Publish**. The comments in that file are
accepted by the console's rules editor.

These rules are the *actual* enforcement. The client-side entitlement checks only control what the UI
shows; someone who bypasses the UI still cannot read restricted content, because the database refuses.

### 3. Make yourself an admin — manually

This step **cannot** be done from inside the app, by design. The rules forbid a user from writing their
own `role`, `status` or `entitlements`; otherwise anyone could grant themselves access.

1. Sign up in the app with your own email.
2. Console → **Authentication → Users** → copy your **User UID**.
3. Console → **Realtime Database → Data** → create:

```
users
└── <YOUR_UID>
    ├── role:   "admin"
    └── status: "approved"
```

Reload the app. You now have an **Admin** panel that lists every user and lets you approve or reject
pending requests and grant or revoke entitlements per user, without touching the console again.

### 4. Add restricted scenarios

See the next section.

---

## Restricted scenarios

Restricted scenarios are **never in this repository and never in the shipped JavaScript bundle**. That
is the entire point: RCUK and similarly licensed material stays in your private database, readable only
by accounts you have personally granted the matching entitlement. The app ships this section *empty but
fully wired*.

Write them under `restrictedScenarios/<ID>` in the Realtime Database. The shape is the ordinary
scenario shape — the same one the built-in scenarios in `data/scenarios.js` use — because restricted
scenarios run through **exactly the same pipeline** as built-in ones: `enrichScenario()`, WETFLAG,
investigations, defibrillation, deterioration. There is no special-casing downstream of loading.

### Required fields

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Must be unique and must match the key. Required by the DB rules. |
| `title` | string | Shown in the picker. Required by the DB rules. |

Everything else is optional and defaults the same way a built-in scenario would.

### Commonly used fields

| Field | Type | Notes |
| --- | --- | --- |
| `category` | string | Grouping label in the picker |
| `ageRange` | `"Adult"` \| `"Paediatric"` \| `"Elderly"` | `"Paediatric"` turns on WETFLAG and paediatric energies |
| `patientAge` | number | Years. Use a decimal for infants (0.5 = 6 months) |
| `sex` | `"Male"` \| `"Female"` | |
| `patientName` | string | |
| `acuity` | `"Resus"` \| `"Majors"` \| `"Minors"` | |
| `presentingComplaint` | string | |
| `profile` / `patientProfileTemplate` | string | The brief. `{age}` and `{sex}` are substituted |
| `vitals` | object | `hr`, `bpSys`, `bpDia`, `spO2`, `rr`, `temp`, `etco2`, `gcs`, `bm`, `ph`, `k`, `pupils` |
| `rhythm` | string | Must be a label from `data/rhythms.js` |
| `pmh`, `dhx`, `allergies` | string[] | |
| `recommendedActions` | string[] | Intervention keys from `data/interventions.js` |
| `learningObjectives` | string[] | Scored in the debrief |
| `deterioration` | object | `{ active, type, rate }` — drives AUTO mode |
| `investigations` | object | `{ bloods, ecg, cxr, … }` |
| `instructorBrief` | object | `{ progression, interventions, learningObjectives }` |

### Example entry

Paste this at `restrictedScenarios/RCUK_ALS_01` to check the wiring end to end:

```json
{
  "id": "RCUK_ALS_01",
  "title": "ALS — Shockable Rhythm",
  "category": "RCUK ALS",
  "ageRange": "Adult",
  "patientAge": 62,
  "sex": "Male",
  "patientName": "Restricted Example",
  "acuity": "Resus",
  "presentingComplaint": "Witnessed collapse in the department",
  "profile": "A {age}-year-old {sex} collapsed in the waiting room. CPR in progress on arrival.",
  "rhythm": "Ventricular Fibrillation",
  "vitals": { "hr": 0, "bpSys": 0, "bpDia": 0, "spO2": 0, "rr": 0, "temp": 36.2, "gcs": 3, "bm": 6.1, "k": 4.4, "ph": 7.1 },
  "pmh": ["Ischaemic heart disease", "Type 2 diabetes"],
  "dhx": ["Aspirin 75 mg OD", "Bisoprolol 5 mg OD"],
  "allergies": ["NKDA"],
  "recommendedActions": ["CPR", "Defib", "Adrenaline", "Amiodarone", "IV Access", "Airway"],
  "learningObjectives": [
    "Recognises a shockable rhythm and delivers the first shock without delay",
    "Minimises interruptions to chest compressions",
    "Gives adrenaline after the third shock and amiodarone after the third shock",
    "Considers and verbalises the reversible causes"
  ],
  "instructorBrief": {
    "progression": "VF persists through two shocks, then converts to a perfusing sinus rhythm after the third.",
    "interventions": ["High-quality CPR", "Early defibrillation", "Adrenaline 1 mg IV", "Amiodarone 300 mg IV"],
    "learningObjectives": ["Runs the ALS algorithm as team leader with a clear, closed-loop handover"]
  }
}
```

### Granting access

A user needs **both** `status: "approved"` **and** `entitlements.rcuk: true`. Do this from the Admin
panel in the app. A user can press "Request access" from the locked section, which writes a timestamped
flag to their own record for you to see in the panel — it cannot grant anything.

---

## Payments

Not implemented, deliberately. `entitlements` exists as a **map** (`{ rcuk, premium, expiresAt }`)
rather than a single boolean precisely so a paid tier can be added without reworking the model.

The one rule that must never be broken: **entitlements must only ever be written server-side.** The
database rules already enforce this — `entitlements`, `role` and `status` are admin-write-only. A
payment integration must therefore run its webhook through the Firebase **Admin SDK** (a Cloud Function
or a small server), never from the browser. `window.__paymentWebhookSeam` in `data/auth.js` documents
the seam and throws if called, so nobody can accidentally wire a client-side grant.

---

## Development notes

- **No build is needed to develop.** Every `.js` file under `data/` is loaded as
  `<script type="text/babel">` and compiled in the browser, so `python3 -m http.server` on the repo
  root runs the app. JSX is fine; ES modules, imports and bare `export` are not. Each file is an IIFE
  that assigns to `window`. A plain (non-JSX) file such as `data/rhythms.js` or `data/presets.js` is
  loaded with a bare `<script>` tag.
- **Production build.** `npm install && npm run build` writes `dist/` (Netlify does this on every
  deploy; `netlify.toml` sets the command and publish directory). It compiles every `text/babel`
  script ahead of time with the same Babel library and options the browser used, serves React,
  ReactDOM and the Firebase SDK from `dist/vendor/`, generates the Tailwind stylesheet
  (`dist/assets/app.css`, from `tailwind.config.js`), and points the defib service worker at those
  local files. It refuses to finish if any CDN reference or `text/babel` script survives. Adding a new
  `data/` file only needs its `<script>` tag in `index.html`, as before; the build finds it.
- **The service worker in `defib/sw.js` is cache-first.** Bump `CACHE_NAME` on every deploy or tablets
  will keep serving a stale build of a clinical device.
- **Permissive philosophy: never block, only flag.** The simulator does not stop the facilitator doing
  anything clinically odd. It records it, and the debrief raises it as a discussion point.
- **Vitals precedence** (each stage overrides the last): manual set → active trends → autonomous
  deterioration → airway/paralysis/hypoxia → drug pharmacokinetic envelope → clamp and round.
- **Sync payloads are primitives only.** `Set`s become arrays, `undefined` and `NaN` are stripped;
  Realtime Database rejects them and a rejected write silently freezes the candidates' monitor.
