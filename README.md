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
| `defib/` | The defibrillator tablet page and its service worker |
| `database.rules.json` | The Realtime Database security rules **you must paste into the Firebase console** |

---

## Running it

Open `index.html` over HTTP (not `file://` — the service worker and module fetches need an origin).

```bash
python3 -m http.server 8000
```

- Controller: `http://localhost:8000/`
- Monitor: `http://localhost:8000/?mode=monitor&session=K7PQ3M`
- Defibrillator: `http://localhost:8000/defib/?session=K7PQ3M`

The **Session ID** shown in the controller header is what pairs the screens. It maps to
`sessions/<CODE>` in the Realtime Database. New codes are six characters with no look-alike
characters (no 0/O, 1/I/L). The database rules accept only codes in this format. The controller replaces any older four-character code (from this browser
or the address bar) with a new one when it loads, and **New code** on the setup screen starts a fresh
one at any time. The controller's **Join** button shows QR codes for the room monitor and the defib, so a
tablet can pair by scanning instead of typing.

The standalone defibrillator links over the same Firebase session (`?session=CODE`, or type the code
into its banner), so it works on a separate tablet. The monitor-hosted defib (the controller's
**Defib** button) remains available too.

### Clearing out old sessions

The Realtime Database cannot expire data by itself, so without a clean-up old sessions accumulate.
`.github/workflows/cleanup-sessions.yml` runs `scripts/cleanup-sessions.mjs` every day on GitHub (no
Firebase paid plan needed) and deletes sessions with no activity of any kind (patient updates,
screens connected, defib presses) for more than 24 hours. **It does nothing until you give it access:**

1. Firebase console → Project settings → Service accounts → **Generate new private key**. This downloads
   a JSON file. Treat it like a password.
2. GitHub → this repository → Settings → Secrets and variables → Actions → **New repository secret**,
   name `FIREBASE_SERVICE_ACCOUNT`, value: the whole contents of that JSON file.
3. Publish `database.rules.json` (it declares the index the job uses).
4. Optional: Actions → "Clear out old sessions" → Run workflow, with "Only list" ticked, to see what it
   would delete before the first real run.

---

## The instructor screen

- **Top bar:** Back, Finish, START/PAUSE, one connection badge (live sync plus which screens are
  linked), the **Simple / Full** switch, and the clock. **Screens ▾** holds Launch room monitor, Join by QR code and Open defib
  tablet; **Tools ▾** holds the drug calculator, timer alerts, the full log, where sound plays, mute
  and the keyboard shortcuts. Muted alarms show as a red "Muted" button until unmuted.
- **Left column, in expandable sections** that remember whether they are open on each device: Monitoring
  & access (closed, with a one-line summary and "Attach standard" on its header), the monitor strip
  with the core obs (HR, BP, SpO2, RR, Temp, ETCO2) and a smaller **More obs** row (GCS, glucose, pH,
  K+), **Drugs on board** (one list: phase, effect, time left, titration), **Patient condition**
  (closed; AUTO/MANUAL deterioration, with Trend Better/Worse on its header) and **Rhythm & resus**
  (arrest, ROSC, arrest view, defib, NIBP and the shock tally). The section titles and summaries are
  the same Section component everywhere (`data/components.js`).
- **NIBP rule (every mode, including the defib tablet):** the team's screens show `state.nibp`, the last
  cuff reading, never the live BP. Only `COMMIT_NIBP` (a cuff cycle: the team's press, the facilitator's,
  the defib's NIBP key via the `NIBP_START` device event, or the auto timer) and `SET_NIBP` (Manual
  reading) change it. The BP modal defaults to *Now* and offers **Change, don't send** or **Change and
  cycle cuff now**. WETFLAG on the room monitor starts hidden (`showWetflag` defaults to false) and is
  toggled from Rhythm & resus.
- **Debrief obs graph (every mode):** `state.sessionTime` is the debrief timeline. It advances with
  `time` (TICK_TIME), and in a live Quick Sim before START also via the record-only `TICK_RECORD`
  (no physiology). History samples (every 5 s: obs, `bpDia`, ETCO2 with a capnography flag, and the
  rhythm) and log `timeSeconds` use it, and it is saved in the resume snapshot with the history. The
  chart (`data/screens/debrief.js`, `buildTimeline`) is small multiples with a rhythm lane and four
  numbered event lanes, drawn dark on screen and light in the report from the same code.
- **Right column:** intervention search and tabs (the Common tab no longer repeats the recommended
  actions), and the **event log**, always on screen with notes and flags; the full log is in Tools.
- **Simple / Full view** (remembered on each device, Simple by default; every open screen on the
  device follows a change). Simple hides the advanced extras: the drug-timing detail lines in Drugs on
  board, the "+ Invasive" bulk button (the individual chips stay), the pH and K+ tiles (GCS and
  glucose stay), the shock-response settings and "Next shock converts to" in the defib panel (one
  line says what is set, and opens Full view), and the Quick Sim preset list (a running preset stays
  on screen so it can be stopped). Nothing is removed in either view.
- **Defib Sim controller:** Shock response, Pacing & artefacts and Drugs start closed, each with a
  one-line summary (e.g. "Never converts · cardioversion at 200 J", "Threshold 70 mA · no
  artefacts", "Adrenaline 1 · Amiodarone 0"). The RCUK drug prompts sit above Drugs so they show
  while it is closed. Rhythm, Arrest and the event log are always open.

## Instructor guides

`guides/` holds two static pages for instructors, a **Quick Start Guide** and a **Full Instructor
Guide**, plus a landing page (`guides/index.html`) and an A4 PDF of each. A small highlighted
"Instructor guides" link group sits at the left of the footer on every instructor screen (setup,
live scenario, debrief); it never appears on the room monitor or the defib. The pages are plain HTML
with `guides/guides.css`, which also holds the print layout.

After editing a guide page, rebuild its PDF so the download matches, then commit both:

```bash
cd tests && npm ci && cd .. && node scripts/build-guides.mjs
```

`tests/specs/guides.spec.js` checks the links from the app, every link on the pages (the PDFs
included) and accessibility. The service worker stores the guide pages for offline use but not the
PDFs.

## Capnography

One capnogram for every screen: `RHYTHMS.capnogram(phase, etco2, pattern, severity, rate)` in
`data/rhythms.js`, timed in real seconds from the start of inspiration (the same breath clock as the
chest-impedance trace). Inspiration is a third of the breath up to 1.7 s, so a slow rate gives a wide,
long-plateau wave and a fast rate a narrow one; the upstroke and downstroke take about 0.25 s at any
rate. Shapes: normal, obstructive shark fin (scaled by the bronchospasm model), rebreathing, curare
cleft, no waveform when nothing ventilates the patient, and low with compression ripples at 10
breaths/min during CPR. The room monitor and controller draw it at half the ECG speed (16 s against
8 s, i.e. 12.5 against 25 mm/s), the arrest view adds a CO2 lane when capnography is attached, and
the defib tablet draws it under its ECG. `tests/specs/capnography.spec.js` checks the shapes and timing.

## Launch modes

| Mode | What it does |
| --- | --- |
| **Quick Sim** | A blank synthetic patient and nothing else. Editable obs, the full rhythm list, arrest/ROSC, the monitor and the defib toggle. No scenario, no drugs, no interventions. For ad-hoc teaching at the bedside. |
| **Defib Sim** | Defibrillator skills on a ZOLL-style tablet defib, with its own Defib controller. Built-in defibrillation, cardioversion and pacing scenarios, free play, or a custom sequence of rhythms. Education or Assessment mode. |
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
  silent only when you deliberately pause or finish. So do the facilitator's sound effects (charge,
  shock, etc.), the patient's voice and the NIBP auto-cycle countdown.
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

### Defib Sim

Defib Sim is the standalone Defib-sim rebuilt inside this app, so it uses the same session codes,
engine, Firebase link and debrief. The learner works the defibrillator at `defib/index.html` (the
**Join** button shows its QR code, or type the session code on the tablet); the facilitator runs
the scenario from the **Defib controller**, which opens instead of the normal controller for a Defib
Sim scenario (`scenario.defibSim`).

- **Scenarios** (`data/defibsim.js`): VF, pulseless VT, unstable VT, unstable SVT, fast AF, complete
  heart block and symptomatic bradycardia; free play; or a **custom sequence** of up to five rhythms,
  each moving on at a trigger (analyse, shock, pacing capture, or a 30 s / 60 s / 2 min timer that runs
  on the sim clock). While a custom sequence runs, a shock changes the rhythm only when the current step
  moves on at a shock (and a shock on the last such step converts to sinus rhythm), as in the
  standalone app. Sequences can be saved on the device, exported and imported (the standalone app's
  files import too).
- **The clock** starts by itself at the learner's first action on the defib (switching it on,
  charging, analysing, CPR and so on), so a forgotten START does not leave every log entry at 00:00.
  A deliberate PAUSE is respected: presses are still logged but the clock stays stopped until START.
  The controller shows a banner whenever the clock is not running.
- **Education vs Assessment.** In Education the defib shows pulse-check results and the RCUK hint
  cards. In Assessment it shows neither (a real defibrillator tells you neither). The facilitator sees
  the RCUK drug prompts in both modes; the learner never does. For a patient under 18 the hint cards
  and drug prompts are the paediatric ones (15:2, 4 J/kg, 10 micrograms/kg adrenaline, 5 mg/kg
  amiodarone, cardioversion at 1 J/kg doubling to 4 J/kg).
- **Shock response.** Defib Sim defaults to **Auto**: an arrest converts on the scenario's shock number
  (the third adequate shock) and a cardioversion on the first adequate synchronised shock; an
  unsynchronised shock into a rhythm with a pulse causes VF. "Adequate" means at least 150 J for an
  adult (3 J/kg for a child) to defibrillate, and 70 J (1 J/kg) to cardiovert. These thresholds are
  simulator settings, not guideline values. The realistic probabilistic model and fixed shock counts
  are one select away, as they are on the main controller.
- **Cardioversion succeeds at** (Shock response panel, Defib controller and main controller) lets the
  facilitator choose the energy a cardioversion needs, from the device's own steps. Synchronised
  shocks below it never convert; one at or above it converts (on the shock number set by "Converts";
  with the realistic model it converts for certain). "Default" keeps the 70 J adult / 1 J/kg child
  rule above.
- **Paediatric content** follows RCUK Guidelines 2025: the Paediatric advanced life support algorithm
  (Nov 2025 V2), the Paediatric cardiac arrhythmias algorithm and the Paediatric emergency drug chart
  (Feb 2026). The estimated weight and tube size (WETFLAG) come from the chart; the engine logs
  weight-based doses for a child (atropine, adenosine, IM adrenaline by age, amiodarone, buccal
  midazolam, levetiracetam, 10% glucose, calcium gluconate); and from the 5th shock a child's
  refractory VF/pVT may be escalated to 8 J/kg without being flagged. `tests/specs/paediatric.spec.js`
  checks these values.
- **Anaphylaxis** follows the RCUK Emergency treatment of anaphylaxis guideline (May 2021): steroids
  and antihistamines are not recommended actions and do not slow the decline; giving one before
  adrenaline is flagged; the second IM dose prompts the refractory pathway; tryptase timing,
  observation periods and the low-dose adrenaline infusion are in the log. **Newborn** scenarios get
  the Newborn life support algorithm's steps (Guidelines 2025) as coaching lines.
  `tests/specs/anaphylaxis-newborn.spec.js` checks both.
- **Drugs work in every mode** through the normal engine: for example isoprenaline speeds a complete
  heart block escape, atropine barely moves it, and in a non-shockable arrest on Auto, ROSC comes at the
  second rhythm check after adrenaline with CPR running. IV access is assumed in place at the start.
- **Pacing** captures electrically at the scenario's threshold (varied by up to 15 mA each run) and
  mechanically about 10 mA above it; demand mode is inhibited by a faster intrinsic rate.
- **The tablet mirrors to the controller**: it publishes what it shows to
  `sessions/<CODE>/deviceState/<id>` (removed when it disconnects), and every press goes through
  `sessions/<CODE>/deviceEvents` like the monitor-hosted defib.
- **Capnography** (Arrest card: Capnography on/off) puts the capnogram under the ECG on the learner's
  defib, at half the ECG speed as on the ZOLL R Series, scaled 0-50 mmHg (6.7 kPa). While it is off
  the tablet shows "--" for ETCO2, as a real R Series without its CO2 sensor shows no CO2 box.
- **Debrief**: good practice and areas for improvement (pulse checks, mode, SYNC, energies, time to
  first shock, adrenaline and amiodarone after the 3rd shock, sedation before cardioversion,
  analgesia for pacing, capture) and a printable certificate.

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
  local files. It then minifies the app's JavaScript with esbuild (writing a `.map` source map next to
  each file). The Firebase sign-in library is not loaded with the page: `data/auth.js` fetches it when
  someone signs in, or at start-up if this browser has signed in before. It refuses to finish if any CDN reference or `text/babel` script survives. Adding a new
  `data/` file only needs its `<script>` tag in `index.html`, as before; the build finds it.
- **Tests.** GitHub Actions runs three jobs on every pull request and on pushes to `main`:
  - `playwright`: `npm run build`, then `cd tests && npm install && npx playwright test`. Browser tests
    against `dist/` with in-memory stand-ins for Firebase and sign-in (`tests/fake-firebase.js`,
    `tests/fake-auth.js`), so no network is needed. They include every built-in scenario, offline
    loading, the defib tablet, the Defib controller, and automated WCAG 2.1 AA checks (axe-core).
  - `rules`: `database.rules.json` in the Firebase Realtime Database emulator (`tests/rules`, needs Java 21).
  - `e2e`: the built app with the real Firebase SDK against the emulator enforcing the rules
    (`cd tests/rules && npm run e2e`).
- **The engine** is five files, loaded in order: `engine-model.js` (initial states, physiology, drug
  kinetics, deterioration, objectives), `engine-reducers.js`, `engine-sync.js` (the live session and
  device presses), `engine-defib.js` (shocks, cardioversion, pacing, Defib Sim sequences) and
  `engine.js` (the `useSimulation` hook that ties them together). Each exports only what the others use.
- **Offline and updates.** `sw.js` (the app) and `defib/sw.js` (the tablet) share `sw-shared.js`: network
  first, so an online device always runs the latest deploy, falling back to stored copies offline. The
  build stamps each worker with the deploy's version and the files to store at install, so there is
  nothing to bump by hand. Each worker only deletes its own old caches.
- **Session layout.** The controller publishes the patient to `sessions/<CODE>/live`; monitors and the
  defib listen there only. Device traffic stays beside it: `presence/`, `deviceEvents/`, `deviceState/`
  and `command`.
- **Permissive philosophy: never block, only flag.** The simulator does not stop the facilitator doing
  anything clinically odd. It records it, and the debrief raises it as a discussion point.
- **Vitals precedence** (each stage overrides the last): manual set → active trends → autonomous
  deterioration → airway/paralysis/hypoxia → drug pharmacokinetic envelope → clamp and round.
- **Sync payloads are primitives only.** `Set`s become arrays, `undefined` and `NaN` are stripped;
  Realtime Database rejects them and a rejected write silently freezes the candidates' monitor.
