(() => {
    // THE SIMULATION ENGINE: DEFIBRILLATION AND PACING. Shock outcomes, cardioversion, drug-driven
    // conversion, the device controls, Defib Sim custom sequences and transcutaneous pacing.
    // Called by useSimulation (data/engine.js) at a fixed point on every render, so its hooks keep
    // their order. It receives what it uses from the rest of the engine and returns what the rest
    // of the engine uses (both lists generated from a scope analysis of the original code).
    const { useState, useEffect, useRef } = React;
    const RG = window.RHYTHMS;
    const {
        isDrugSpent
    } = window.__EngineModel;

    const useDefib = (ctx) => {
        const {
            RESET_HOLD_KEYS, addLogEntry, arrestVitals, changeRhythm, dispatch, isMonitorMode, state,
            stateRef, triggerArrest, triggerROSC
        } = ctx;

        // =====================================================================================
        // DEFIBRILLATION (C4 / C6 / C7) — one shared outcome helper, reached by:
        //   * the facilitator's arrest/defib panel (initCharge / deliverShock)
        //   * the 'Defib' intervention (effect.changeRhythm === 'defib')
        //   * a student pressing SHOCK on the monitor-hosted defib (Firebase deviceEvents)
        //   * a student pressing SHOCK on the standalone defib page (BroadcastChannel)
        // =====================================================================================
        const SHOCK_REFRACTORY_MS = 5000;   // C7: stops charge/shock button-mashing maximising ROSC
        const refibTimerRef = useRef(null);

        const defibWeight = () => {
            const cur = stateRef.current;
            const w = Number(cur.scenario?.wetflag?.weight);
            return Number.isFinite(w) && w > 0 ? w : null;
        };
        const recommendedShockEnergy = () => {
            const cur = stateRef.current;
            return RG.recommendedEnergy(defibWeight(), cur.scenario?.patientAge);
        };

        const scheduleRefibrillation = (fromRhythm) => {
            const table = RG.SHOCK_OUTCOMES[RG.canonical(fromRhythm)];
            if (!table || !table.refibChance) return;
            if (Math.random() >= table.refibChance) return;
            if (refibTimerRef.current) clearTimeout(refibTimerRef.current);
            const delay = 20000 + Math.random() * 40000;
            refibTimerRef.current = setTimeout(() => {
                refibTimerRef.current = null;
                const cur = stateRef.current;
                if (!cur.isRunning || cur.isFinished) return;
                if (RG.isPulseless(cur.rhythm)) return;     // already re-arrested another way
                dispatch({ type: 'UPDATE_VITALS', payload: arrestVitals(cur.baseVitals) });
                changeRhythm(fromRhythm, 'refibrillation', { note: 're-arrest after ROSC' });
                dispatch({ type: 'SET_FLASH', payload: 'red' });
            }, delay);
        };

        // ---- Shock-response settings (state.defibSettings). ----------------------------------
        const shockPolicy = (cur) => (cur.defibSettings && cur.defibSettings.shockResponse) || 'model';
        // How many ADEQUATE shocks this rhythm needs before it converts, or null for "never".
        // 'auto' uses the scenario's own number when it sets one (scenario.shockToConvert).
        const shocksRequired = (cur, isArrest) => {
            const pol = shockPolicy(cur);
            if (pol === 'never') return null;
            if (/^[1-5]$/.test(pol)) return Number(pol);
            const sc = Number(cur.scenario && cur.scenario.shockToConvert);
            return Number.isFinite(sc) && sc > 0 ? sc : (isArrest ? 3 : 1);
        };
        // Is `key` pharmacologically on board right now (a dose given and not yet worn off)?
        const drugOnBoard = (cur, key) => (cur.activeDrugs || []).some(d => d.key === key && !isDrugSpent(d, cur.time));
        // Where a fixed-count shockable arrest converts to (scenario.successRhythm if it names one).
        const roscTargetFor = (cur, fromRhythm) => {
            const named = cur.scenario && cur.scenario.successRhythm;
            if (named && RG.isKnown(named) && !RG.isPulseless(named)) return RG.canonical(named);
            const table = RG.SHOCK_OUTCOMES[RG.canonical(fromRhythm)] || RG.SHOCK_OUTCOMES['VF'];
            return RG.weightedPick(table.rosc);
        };
        // "VF recurs once": 30-90 s after ROSC, if the patient is still in the rhythm they converted to.
        const scheduleFixedRefib = (convertedTo) => {
            if (refibTimerRef.current) clearTimeout(refibTimerRef.current);
            dispatch({ type: 'SET_DEFIB_STATE', payload: { refibDone: true } });
            refibTimerRef.current = setTimeout(() => {
                refibTimerRef.current = null;
                const now = stateRef.current;
                if (!now || now.isFinished || RG.canonical(now.rhythm) !== RG.canonical(convertedTo)) return;
                dispatch({ type: 'UPDATE_VITALS', payload: arrestVitals(now.baseVitals) });
                changeRhythm('VF', 'refibrillation', { note: 're-arrest after ROSC' });
                addLogEntry('VF has recurred after ROSC (refibrillation). Restart CPR and the shockable pathway.', 'danger', true);
                dispatch({ type: 'SET_FLASH', payload: 'red' });
            }, 30000 + Math.random() * 60000);
        };
        const afterShockRosc = (cur, fromRhythm, convertedTo) => {
            const refib = (cur.defibSettings && cur.defibSettings.refib) || 'model';
            if (refib === 'model') scheduleRefibrillation(fromRhythm);
            else if (refib === 'once' && !(cur.defib && cur.defib.refibDone)) scheduleFixedRefib(convertedTo);
        };

        // The ONE place a shock outcome is decided.
        function applyShockOutcome(cur, opts = {}) {
            const joules = Number.isFinite(Number(opts.energy)) ? Math.round(Number(opts.energy)) : recommendedShockEnergy();
            const sync = !!opts.sync;
            const source = opts.source || 'facilitator';
            const now = Date.now();
            const d = cur.defib || {};

            // --- Metrics (B5). EVERY delivered shock counts here, shockable or not, and these
            // numbers live in state so they reach Firebase, localStorage and the debrief.
            const nextDefib = {
                shockCount: (d.shockCount || 0) + 1,
                totalEnergy: (d.totalEnergy || 0) + joules,
                lastEnergy: joules,
                lastShockAt: now,
                charged: false,
                chargeEnergy: null
            };

            // --- C4: paediatric energy. Never blocked, always flagged (Wave 1 philosophy).
            const dev = RG.energyDeviation(joules, defibWeight(), cur.scenario?.patientAge);
            if (dev) {
                addLogEntry(`Shock energy deviation: ${dev.reason}. Recommended for this patient: ${dev.expected}J (4 J/kg for a child).`, 'warning', true,
                    { action: 'Defib', label: 'Defibrillation', missing: [`correct energy (${dev.expected}J)`] });
            }

            const shockable = RG.isShockable(cur.rhythm);

            // --- C7 FIX: the shock counter used to increment BEFORE this guard, so shocking a
            // non-shockable rhythm silently inflated the ROSC probability of the next real shock.
            if (!shockable) {
                dispatch({ type: 'SET_DEFIB_STATE', payload: nextDefib });
                // An UNSYNCHRONISED shock into a rhythm WITH A PULSE can land on the T wave and
                // cause VF (R-on-T). Whether it does is the facilitator's setting.
                const perfusing = !RG.isPulseless(cur.rhythm) && RG.rWavePhase(cur.rhythm, cur.vitals && cur.vitals.hr, 0) !== null;
                const rOnT = (cur.defibSettings && cur.defibSettings.rOnT) || 'never';
                const causesVf = perfusing && !sync && (rOnT === 'always' || (rOnT === 'sometimes' && Math.random() < 1 / 3));
                if (causesVf) {
                    addLogEntry(`UNSYNCHRONISED shock delivered into ${RG.labelFor(cur.rhythm)} landed on the T wave — VF induced (R-on-T). A patient with a pulse needs SYNCHRONISED cardioversion.`, 'danger', true,
                        { action: 'Defib', label: 'Defibrillation', missing: ['synchronisation'] });
                    dispatch({ type: 'UPDATE_VITALS', payload: arrestVitals(cur.baseVitals), releaseManual: RESET_HOLD_KEYS });
                    changeRhythm('VF', 'defibrillation (R-on-T)', { energy: joules, sync: false });
                    dispatch({ type: 'SET_FLASH', payload: 'red' });
                    return;
                }
                if (RG.isSyncCardiovertible(cur.rhythm) && !sync) {
                    addLogEntry(`Unsynchronised shock delivered into ${RG.labelFor(cur.rhythm)} — this rhythm needs SYNCHRONISED cardioversion. Not blocked, but flagged.`, 'warning', true,
                        { action: 'Defib', label: 'Defibrillation', missing: ['synchronisation'] });
                } else {
                    addLogEntry(`Shock delivered into non-shockable rhythm (${RG.labelFor(cur.rhythm)}) — no effect. Check the rhythm before shocking.`, 'warning', true,
                        { action: 'Defib', label: 'Defibrillation', missing: ['a shockable rhythm'] });
                }
                changeRhythm(cur.rhythm, 'defibrillation', { energy: joules, sync, note: 'non-shockable, no change' });
                return;
            }

            if (sync) {
                addLogEntry(`SYNCHRONISED shock delivered into ${RG.labelFor(cur.rhythm)} — a pulseless rhythm has no R wave to synchronise to, so the device would not fire in sync. Treat as unsynchronised. Flagged.`, 'warning', true,
                    { action: 'Defib', label: 'Defibrillation', missing: ['unsynchronised mode'] });
            }

            nextDefib.shockableShocks = (d.shockableShocks || 0) + 1;

            // --- C7: refractory period. A shock stacked on top of the previous one within 5s is
            // still delivered and still logged, but earns no new physiological roll.
            const stacked = d.lastShockAt && (now - d.lastShockAt) < SHOCK_REFRACTORY_MS;
            if (stacked) {
                nextDefib.shockableShocks = d.shockableShocks || 0;   // does not advance the ROSC ladder
                dispatch({ type: 'SET_DEFIB_STATE', payload: nextDefib });
                addLogEntry(`Second shock delivered ${Math.round((now - d.lastShockAt) / 1000)}s after the last one — stacked shocks give no additional benefit. Two minutes of good CPR between shocks is the intervention. Flagged.`, 'warning', true,
                    { action: 'Defib', label: 'Defibrillation', missing: ['2 minutes of CPR between shocks'] });
                changeRhythm(cur.rhythm, 'defibrillation', { energy: joules, sync: false, note: 'stacked shock, no change' });
                return;
            }

            const fromRhythm = RG.canonical(cur.rhythm);
            const policy = shockPolicy(cur);

            // --- FIXED-COUNT POLICIES ('auto', '1'-'5', 'never'): an adequate shock advances the
            // episode count, and the rhythm converts when the count is reached.
            if (policy !== 'model') {
                const adequate = RG.adequateShock(joules, defibWeight(), cur.scenario?.patientAge, 'arrest');
                if (!adequate) {
                    dispatch({ type: 'SET_DEFIB_STATE', payload: nextDefib });
                    changeRhythm(cur.rhythm, 'defibrillation', { energy: joules, sync: false, note: 'energy too low to defibrillate — resume CPR' });
                    addLogEntry(`Shock at ${joules}J is below the energy needed to defibrillate this patient (${RG.isAdult(defibWeight(), cur.scenario?.patientAge) ? 'at least 150 J' : 'at least 3 J/kg'}). Resume CPR and select a higher energy.`, 'warning', true,
                        { action: 'Defib', label: 'Defibrillation', missing: ['adequate energy'] });
                    return;
                }
                nextDefib.episodeShocks = (d.episodeShocks || 0) + 1;
                dispatch({ type: 'SET_DEFIB_STATE', payload: nextDefib });
                if (cur.queuedRhythm) {
                    const q = RG.canonical(cur.queuedRhythm);
                    dispatch({ type: 'SET_QUEUED_RHYTHM', payload: null });
                    if (RG.isPulseless(q)) {
                        dispatch({ type: 'UPDATE_VITALS', payload: arrestVitals(cur.baseVitals) });
                        changeRhythm(q, 'defibrillation (facilitator override)', { energy: joules });
                    } else {
                        triggerROSC(q, 'defibrillation (facilitator override)', { energy: joules });
                        afterShockRosc(cur, fromRhythm, q);
                    }
                    return;
                }
                const required = shocksRequired(cur, true);
                if (required !== null && nextDefib.episodeShocks >= required) {
                    const target = roscTargetFor(cur, fromRhythm);
                    triggerROSC(target, 'defibrillation', { energy: joules, sync: false });
                    afterShockRosc(cur, fromRhythm, target);
                } else {
                    changeRhythm(cur.rhythm, 'defibrillation', { energy: joules, sync: false, note: 'no change — resume CPR' });
                    addLogEntry('No change after shock. Resume compressions immediately, 2-minute cycle, consider escalating energy.', 'warning');
                }
                return;
            }

            dispatch({ type: 'SET_DEFIB_STATE', payload: nextDefib });

            // --- FACILITATOR OVERRIDE (C7): "next shock converts to X". Uses the previously
            // unreachable queuedRhythm / SET_QUEUED_RHYTHM code, which is now driven by a real
            // control on the assessor's defib panel.
            if (cur.queuedRhythm) {
                const q = RG.canonical(cur.queuedRhythm);
                dispatch({ type: 'SET_QUEUED_RHYTHM', payload: null });
                if (RG.isPulseless(q)) {
                    dispatch({ type: 'UPDATE_VITALS', payload: arrestVitals(cur.baseVitals) });
                    changeRhythm(q, 'defibrillation (facilitator override)', { energy: joules });
                } else {
                    triggerROSC(q, 'defibrillation (facilitator override)', { energy: joules });
                    scheduleRefibrillation(cur.rhythm);
                }
                return;
            }

            // --- C7: energy-, rhythm-, CPR- and drug-sensitive ROSC probability.
            const shocks = nextDefib.shockableShocks;
            const expected = recommendedShockEnergy();
            // Under-dosing genuinely reduces defibrillation success; over-dosing does not help.
            const energyFactor = Math.max(0.4, Math.min(1.1, joules / Math.max(1, expected)));
            const rhythmFactor = (RG.canonical(cur.rhythm) === 'Fine VF') ? 0.6 : 1.0;   // fine VF defibrillates poorly
            const cprBonus = cur.cprInProgress ? 0.10 : 0;
            const drugBonus = Math.min(0.15, Number(d.shockBonus) || 0);
            const base = 0.08 + 0.07 * Math.min(shocks, 5);
            const roscChance = Math.max(0.02, Math.min(0.55, (base + cprBonus + drugBonus) * energyFactor * rhythmFactor));

            const table = RG.SHOCK_OUTCOMES[fromRhythm] || RG.SHOCK_OUTCOMES['VF'];
            if (Math.random() < roscChance) {
                const target = RG.weightedPick(table.rosc);
                // Banked drug bonus is consumed by a successful shock.
                dispatch({ type: 'SET_DEFIB_STATE', payload: { shockBonus: 0 } });
                triggerROSC(target, 'defibrillation', { energy: joules, sync: false });
                afterShockRosc(cur, fromRhythm, target);
            } else {
                const target = RG.weightedPick(table.noRosc);
                if (target !== fromRhythm) {
                    dispatch({ type: 'UPDATE_VITALS', payload: arrestVitals(cur.baseVitals) });
                }
                changeRhythm(target, 'defibrillation', { energy: joules, sync: false, note: target === fromRhythm ? 'no change — resume CPR' : 'post-shock rhythm change' });
                if (target === fromRhythm) {
                    addLogEntry('No change after shock. Resume compressions immediately, 2-minute cycle, consider escalating energy.', 'warning');
                }
            }
        }

        // --- C6: SYNCHRONISED CARDIOVERSION. `toggleSync` used to only flip a flag; the flag was
        // transmitted and then DISCARDED engine-side, and the 'Cardioversion' intervention's
        // changeRhythm:'sync' was never handled at all.
        function applyCardioversion(cur, opts = {}) {
            const joules = Number.isFinite(Number(opts.energy)) ? Math.round(Number(opts.energy)) : recommendedShockEnergy();
            const d = cur.defib || {};
            const now = Date.now();
            const nextDefib = {
                shockCount: (d.shockCount || 0) + 1,
                totalEnergy: (d.totalEnergy || 0) + joules,
                lastEnergy: joules, lastShockAt: now, charged: false, chargeEnergy: null, syncMode: true
            };

            const dev = RG.energyDeviation(joules, defibWeight(), cur.scenario?.patientAge);
            if (dev) addLogEntry(`Cardioversion energy deviation: ${dev.reason}. Recommended: ${dev.expected}J.`, 'warning', true,
                { action: 'Cardioversion', label: 'Synchronised Cardioversion', missing: [`correct energy (${dev.expected}J)`] });

            if (RG.isPulseless(cur.rhythm)) {
                dispatch({ type: 'SET_DEFIB_STATE', payload: nextDefib });
                // Never blocked — flagged. A defibrillator in SYNC mode will not discharge into VF,
                // and that is itself the teaching point.
                addLogEntry(`SYNC mode armed in ${RG.labelFor(cur.rhythm)} — a real defibrillator will not discharge in SYNC without an R wave. Switch to unsynchronised defibrillation. Flagged.`, 'danger', true,
                    { action: 'Cardioversion', label: 'Synchronised Cardioversion', missing: ['unsynchronised mode for a pulseless rhythm'] });
                changeRhythm(cur.rhythm, 'cardioversion', { energy: joules, sync: true, note: 'no R wave, device would not fire' });
                return;
            }
            if (!RG.isSyncCardiovertible(cur.rhythm)) {
                dispatch({ type: 'SET_DEFIB_STATE', payload: nextDefib });
                addLogEntry(`Synchronised shock delivered into ${RG.labelFor(cur.rhythm)} — cardioversion is not indicated for this rhythm. Flagged.`, 'warning', true,
                    { action: 'Cardioversion', label: 'Synchronised Cardioversion', missing: ['an indication for cardioversion'] });
                changeRhythm(cur.rhythm, 'cardioversion', { energy: joules, sync: true, note: 'not indicated, no change' });
                return;
            }

            // The rhythm FIRST (it brings the new rhythm's rate band), then any obs the scenario names.
            // In the other order the rhythm change, which reads the pre-shock state, put the
            // tachycardic rate back: "Sinus Rhythm" at 190/min.
            const convertToSinus = () => {
                const sv = cur.scenario && cur.scenario.successVitals;
                const named = cur.scenario && cur.scenario.successRhythm;
                const target = named && RG.isKnown(named) && !RG.isPulseless(named) ? RG.canonical(named) : 'Sinus Rhythm';
                changeRhythm(target, 'cardioversion', { energy: joules, sync: true });
                if (sv && typeof sv === 'object') {
                    const vit = {};
                    ['hr', 'bpSys', 'bpDia', 'spO2', 'rr', 'etco2'].forEach(k => { if (Number.isFinite(Number(sv[k]))) vit[k] = Number(sv[k]); });
                    if (Object.keys(vit).length) dispatch({ type: 'UPDATE_VITALS', payload: vit });
                }
            };

            if (shockPolicy(cur) !== 'model') {
                if (!RG.adequateShock(joules, defibWeight(), cur.scenario?.patientAge, 'cardiovert')) {
                    dispatch({ type: 'SET_DEFIB_STATE', payload: nextDefib });
                    changeRhythm(cur.rhythm, 'cardioversion', { energy: joules, sync: true, note: 'energy too low to cardiovert' });
                    return;
                }
                nextDefib.episodeShocks = (d.episodeShocks || 0) + 1;
                dispatch({ type: 'SET_DEFIB_STATE', payload: nextDefib });
                const required = shocksRequired(cur, false);
                if (required !== null && nextDefib.episodeShocks >= required) convertToSinus();
                else changeRhythm(cur.rhythm, 'cardioversion', { energy: joules, sync: true, note: 'unsuccessful — escalate energy, check sedation and synchronisation' });
                return;
            }

            dispatch({ type: 'SET_DEFIB_STATE', payload: nextDefib });
            // Success depends on the rhythm and on adequate energy.
            const baseSuccess = { 'SVT': 0.85, 'VT': 0.80, 'AF': 0.6, 'Atrial Flutter': 0.9 }[RG.canonical(cur.rhythm)] || 0.7;
            const expected = recommendedShockEnergy();
            const energyFactor = Math.max(0.5, Math.min(1.1, joules / Math.max(1, expected)));
            if (Math.random() < baseSuccess * energyFactor) {
                convertToSinus();
            } else {
                changeRhythm(cur.rhythm, 'cardioversion', { energy: joules, sync: true, note: 'unsuccessful — escalate energy, check sedation and synchronisation' });
            }
        }

        // --- C6: DRUG-MEDIATED CONVERSION. `changeRhythm: 'chance'` was unhandled, so Adrenaline IV
        // and Amiodarone — the two most important drugs in a shockable arrest — changed NOTHING.
        function applyDrugConversion(cur, key, label, opts = {}) {
            const table = RG.DRUG_CONVERSION[key];
            const rid = RG.canonical(cur.rhythm);
            let rule = table && table[rid];
            // E2: adenosine's success probability escalates with the 6 → 12 → 18 mg sequence, so the
            // caller may supply the chance for THIS dose. The registry still owns the target rhythm.
            if (rule && Number.isFinite(opts.chance)) rule = { ...rule, chance: opts.chance };
            if (!rule) {
                addLogEntry(`${label} given in ${RG.labelFor(rid)} — no direct rhythm effect expected for this combination.`, 'info');
                return;
            }
            if (rule.shockBonus) {
                const d = cur.defib || {};
                dispatch({ type: 'SET_DEFIB_STATE', payload: { shockBonus: Math.min(0.15, (Number(d.shockBonus) || 0) + rule.shockBonus) } });
                addLogEntry(`${label} on board — improves the chance that the NEXT shock is successful (${Math.round(rule.shockBonus * 100)}% added).`, 'info');
            }
            if (!rule.chance || !rule.to) return;
            if (Math.random() < rule.chance) {
                if (RG.isPulseless(rule.to)) {
                    dispatch({ type: 'UPDATE_VITALS', payload: arrestVitals(cur.baseVitals) });
                    changeRhythm(rule.to, 'drug', { agent: label });
                } else if (RG.isPulseless(rid)) {
                    triggerROSC(rule.to, 'drug', { agent: label });
                } else {
                    changeRhythm(rule.to, 'drug', { agent: label });
                }
            } else {
                addLogEntry(`${label} given — rhythm unchanged (${RG.labelFor(rid)}).`, 'info');
            }
        }

        function initCharge(energy) {
            const cur = stateRef.current;
            const j = Number.isFinite(Number(energy)) ? Math.round(Number(energy)) : recommendedShockEnergy();
            dispatch({ type: 'SET_FLASH', payload: 'yellow' });
            dispatch({ type: 'SET_DEFIB_STATE', payload: { charged: true, chargeEnergy: j, energy: j } });
            addLogEntry(`Defib charging (${j}J${cur.defib?.syncMode ? ', SYNC' : ''})`, 'warning');
            dispatch({ type: 'SET_NOTIFICATION', payload: { msg: `Charging ${j}J...`, type: 'warning', id: Date.now() } });
            setTimeout(() => dispatch({ type: 'SET_FLASH', payload: null }), 1000);
        }

        function deliverShock(energy, source = 'facilitator', opts = {}) {
            const cur = stateRef.current;
            const j = Number.isFinite(Number(energy)) ? Math.round(Number(energy)) : recommendedShockEnergy();
            const sync = opts.sync !== undefined ? !!opts.sync : !!(cur.defib && cur.defib.syncMode);
            dispatch({ type: 'SET_FLASH', payload: 'red' });
            // B5: logged as 'danger' AND flagged, and the debrief now plots danger-type markers.
            addLogEntry(`Shock delivered ${j}J${sync ? ' (SYNC)' : ''} (${source})`, 'danger', true);
            dispatch({ type: 'SET_NOTIFICATION', payload: { msg: `Shock Delivered ${j}J`, type: 'danger', id: Date.now() } });
            setTimeout(() => dispatch({ type: 'SET_FLASH', payload: null }), 500);
            if (stepsRunning(cur)) { customStepShock(cur, j, sync); return; }
            if (sync) applyCardioversion(cur, { energy: j, source });
            else applyShockOutcome(cur, { energy: j, sync: false, source });
        }

        // Assessor-facing defib device controls, shared by the controller panel and by student
        // events arriving over Firebase / BroadcastChannel.
        const setDefibMode = (mode, source = 'facilitator') => {
            dispatch({ type: 'SET_DEFIB_STATE', payload: { mode, charged: false, chargeEnergy: null } });
            addLogEntry(`Defibrillator mode: ${String(mode).toUpperCase()} (${source})`, 'action');
        };
        const setDefibEnergy = (j, source = 'facilitator') => {
            const v = Math.max(1, Math.round(Number(j) || 0));
            dispatch({ type: 'SET_DEFIB_STATE', payload: { energy: v, charged: false, chargeEnergy: null } });
            addLogEntry(`Energy selected: ${v}J (${source})`, 'action');
        };
        const toggleDefibSync = (source = 'facilitator') => {
            const cur = stateRef.current;
            const next = !(cur.defib && cur.defib.syncMode);
            dispatch({ type: 'SET_DEFIB_STATE', payload: { syncMode: next } });
            addLogEntry(`SYNC ${next ? 'ON' : 'OFF'} (${source})${next && RG.isPulseless(cur.rhythm) ? ' — SYNC armed in a pulseless rhythm; the device will not discharge. Flagged.' : ''}`, next && RG.isPulseless(cur.rhythm) ? 'warning' : 'action', next && RG.isPulseless(cur.rhythm));
        };
        const analyseRhythm = (source = 'student') => {
            const cur = stateRef.current;
            const shockable = RG.isShockable(cur.rhythm);
            const result = shockable ? 'SHOCK ADVISED' : 'NO SHOCK ADVISED';
            dispatch({ type: 'SET_DEFIB_STATE', payload: { analysing: false, lastAnalysis: { result, rhythm: RG.canonical(cur.rhythm), at: Date.now() } } });
            addLogEntry(`Defib analysis (${source}): ${result} — ${RG.labelFor(cur.rhythm)}`, 'action');
            defibStepTrigger('analyse');
            return result;
        };
        const setQueuedRhythm = (r) => {
            if (!r) { dispatch({ type: 'SET_QUEUED_RHYTHM', payload: null }); addLogEntry('Facilitator override cleared: next shock follows the model.', 'system'); return; }
            const q = RG.canonical(r);
            dispatch({ type: 'SET_QUEUED_RHYTHM', payload: q });
            addLogEntry(`Facilitator override armed: the NEXT shock will convert to ${RG.labelFor(q)}.`, 'system');
        };
        const toggleCPR = (on, source = 'facilitator') => {
            const cur = stateRef.current;
            const next = on === undefined ? !cur.cprInProgress : !!on;
            if (next === cur.cprInProgress) return;
            dispatch({ type: 'TOGGLE_CPR', payload: next });
            if (next) dispatch({ type: 'RESET_CYCLE_TIMER' });
            addLogEntry(next
                ? `CPR started (${source}) — arrest ETCO2, compression artefact and the ROSC bonus are now active. Aim for 100-120/min, minimise pauses.`
                : `CPR stopped (${source}).`, next ? 'action' : 'warning', !next && RG.isPulseless(cur.rhythm));
        };

        // =====================================================================================
        // DEFIB SIM CUSTOM SCENARIOS. The facilitator's sequence of rhythms decides what happens:
        // each step moves on at its trigger (a rhythm analysis, a shock, pacing capture or a
        // timer). While a sequence runs, a shock never converts the rhythm by itself — only a
        // step whose trigger is "shock" moves on (and a shock on the LAST such step converts to
        // sinus rhythm), exactly as in the standalone Defib-sim.
        // =====================================================================================
        const DEFIB_TRIGGER_LABELS = { analyse: 'on analyse', shock: 'on shock', capture: 'on pacing capture', timer_30: 'after 30 s', timer_60: 'after 60 s', timer_120: 'after 2 min' };
        const defibSteps = (cur) => (cur.scenario && cur.scenario.defibSim && Array.isArray(cur.scenario.defibSim.steps)) ? cur.scenario.defibSim.steps : [];
        const stepsRunning = (cur) => !!(cur.defibStep && !cur.defibStep.done && defibSteps(cur).length);
        const goToDefibStep = (index, cause = 'facilitator') => {
            const cur = stateRef.current;
            const steps = defibSteps(cur);
            if (!steps.length) return;
            const i = Math.max(0, Math.floor(Number(index) || 0));
            if (i >= steps.length) {
                dispatch({ type: 'SET_DEFIB_STEP', payload: { index: steps.length, since: Number(cur.time) || 0, done: true } });
                addLogEntry(`Custom scenario complete (${cause}).`, 'success');
                return;
            }
            const step = steps[i];
            const to = RG.canonical(step.rhythm);
            dispatch({ type: 'SET_DEFIB_STEP', payload: { index: i, since: Number(cur.time) || 0, done: false } });
            addLogEntry(`Custom scenario: step ${i + 1}/${steps.length} — ${RG.labelFor(to)} (moves on ${DEFIB_TRIGGER_LABELS[step.trigger] || step.trigger}; ${cause})`, 'system');
            if (to === RG.canonical(cur.rhythm)) return;
            if (RG.isPulseless(to) && !RG.isPulseless(cur.rhythm)) triggerArrest(to, `custom scenario step ${i + 1}`);
            else if (!RG.isPulseless(to) && RG.isPulseless(cur.rhythm)) triggerROSC(to, `custom scenario step ${i + 1}`);
            else changeRhythm(to, `custom scenario step ${i + 1}`);
        };
        const defibStepTrigger = (kind) => {
            const cur = stateRef.current;
            if (!stepsRunning(cur)) return;
            const step = defibSteps(cur)[cur.defibStep.index];
            if (step && step.trigger === kind) goToDefibStep(cur.defibStep.index + 1, DEFIB_TRIGGER_LABELS[kind] || kind);
        };
        // A shock while a sequence runs: counted, logged, and it moves the sequence on only when the
        // current step says so.
        const customStepShock = (cur, joules, sync) => {
            const d = cur.defib || {};
            dispatch({ type: 'SET_DEFIB_STATE', payload: { shockCount: (d.shockCount || 0) + 1, totalEnergy: (d.totalEnergy || 0) + joules, lastEnergy: joules, lastShockAt: Date.now(), charged: false, chargeEnergy: null } });
            const steps = defibSteps(cur);
            const index = cur.defibStep.index;
            const step = steps[index];
            if (!step || step.trigger !== 'shock') {
                changeRhythm(cur.rhythm, 'defibrillation', { energy: joules, sync, note: 'no change (custom scenario step)' });
                return;
            }
            setTimeout(() => {
                const now = stateRef.current;
                if (!now.defibStep || now.defibStep.done || now.defibStep.index !== index) return;
                if (index + 1 >= steps.length) {
                    dispatch({ type: 'SET_DEFIB_STEP', payload: { index: steps.length, since: Number(now.time) || 0, done: true } });
                    if (RG.isPulseless(now.rhythm)) triggerROSC('Sinus Rhythm', 'defibrillation (custom scenario)', { energy: joules });
                    else changeRhythm('Sinus Rhythm', 'cardioversion (custom scenario)', { energy: joules, sync });
                    addLogEntry('Custom scenario complete: the final shock converted the rhythm.', 'success');
                    return;
                }
                goToDefibStep(index + 1, 'on shock');
            }, 1000);
        };
        // Timer steps run on the sim clock, so they pause with the scenario.
        useEffect(() => {
            if (isMonitorMode) return;
            const cur = stateRef.current;
            if (!stepsRunning(cur) || !cur.isRunning) return;
            const step = defibSteps(cur)[cur.defibStep.index];
            const m = /^timer_(\d+)$/.exec((step && step.trigger) || '');
            if (m && (Number(cur.time) || 0) - (Number(cur.defibStep.since) || 0) >= Number(m[1])) goToDefibStep(cur.defibStep.index + 1, DEFIB_TRIGGER_LABELS[step.trigger]);
        }, [isMonitorMode, state.time]);

        // =====================================================================================
        // TRANSCUTANEOUS PACING, AS THE DEVICE DELIVERS IT.
        // With the defibrillator in PACER mode, capture is re-evaluated whenever the output, rate,
        // threshold or underlying rhythm changes:
        //   * ELECTRICAL capture at the threshold: every spike is followed by a broad complex, the
        //     monitor rate becomes the paced rate — but the circulation has not improved yet.
        //   * MECHANICAL capture ~10 mA above it: a palpable pulse at the paced rate, BP and
        //     saturation improve.
        // Demand mode is inhibited while the patient's own rate is at or above the set rate.
        // Losing capture (or leaving PACER mode) restores the underlying rhythm and obs.
        // =====================================================================================
        const MECHANICAL_MARGIN_MA = 10;
        useEffect(() => {
            if (isMonitorMode) return;
            const cur = stateRef.current;
            const pacing = cur.pacing || {};
            const mode = cur.defib && cur.defib.mode;
            const pacer = cur.remotePacerState || {};
            const rate = Number(pacer.rate) || 0, output = Number(pacer.output) || 0;
            const demand = pacer.demand !== false;
            // The facilitator changed the rhythm under an established capture: that is the new
            // underlying rhythm, and the capture has to be earned again.
            if (pacing.electrical && RG.canonical(cur.rhythm) !== 'Paced') {
                dispatch({ type: 'SET_PACING', payload: { electrical: false, mechanical: false, underlying: null, pre: null } });
                return;
            }
            const underlying = pacing.electrical ? pacing.underlying : RG.canonical(cur.rhythm);
            const ownRate = pacing.electrical ? ((pacing.pre && pacing.pre.hr) || 0) : ((cur.vitals && cur.vitals.hr) || 0);
            const threshold = Number(cur.pacingThreshold) || 70;
            const on = mode === 'pacer' && rate > 0 && output > 0;
            const capable = RG.PACEABLE.indexOf(RG.canonical(underlying)) !== -1;
            const inhibited = demand && ownRate >= rate;
            const electrical = on && capable && !inhibited && output >= threshold;
            const mechanical = electrical && output >= threshold + MECHANICAL_MARGIN_MA;

            if (electrical && !pacing.electrical) {
                const v = cur.baseVitals || {};
                const pre = { hr: v.hr, bpSys: v.bpSys, bpDia: v.bpDia, spO2: v.spO2 };
                dispatch({ type: 'SET_PACING', payload: { electrical: true, mechanical: false, underlying: RG.canonical(underlying), pre } });
                changeRhythm('Paced', 'pacing', { note: `electrical capture at ${output}mA, ${rate}/min` });
                dispatch({ type: 'UPDATE_VITALS', payload: { hr: rate } });
                addLogEntry(`Pacing: ELECTRICAL capture at ${output}mA, ${rate}/min. Confirm MECHANICAL capture — a palpable pulse at the paced rate. Pacing hurts: give analgesia and sedation.`, 'success');
                // After this render, so the step's rhythm follows the capture rather than racing it.
                setTimeout(() => defibStepTrigger('capture'), 0);
                return;
            }
            if (!electrical && pacing.electrical) {
                const pre = pacing.pre || {};
                dispatch({ type: 'SET_PACING', payload: { electrical: false, mechanical: false, underlying: null, pre: null } });
                changeRhythm(pacing.underlying || 'Sinus Rhythm', 'pacing', { note: mode === 'pacer' ? 'capture lost' : 'pacing stopped' });
                const restore = {};
                ['hr', 'bpSys', 'bpDia', 'spO2'].forEach(k => { if (Number.isFinite(Number(pre[k]))) restore[k] = Number(pre[k]); });
                dispatch({ type: 'UPDATE_VITALS', payload: restore });
                addLogEntry(mode === 'pacer' ? `Pacing: capture LOST (${output}mA < threshold). Increase the output.` : 'Pacing stopped — back to the underlying rhythm.', 'warning', mode === 'pacer');
                return;
            }
            if (!electrical) return;
            const updates = {};
            if (Number((cur.baseVitals || {}).hr) !== rate) updates.hr = rate;
            if (mechanical && !pacing.mechanical) {
                const pre = pacing.pre || {};
                updates.bpSys = Math.max((Number(pre.bpSys) || 70) + 25, 95);
                updates.bpDia = Math.max((Number(pre.bpDia) || 40) + 15, 55);
                if (Number(pre.spO2) > 0) updates.spO2 = Math.max(Number(pre.spO2), 95);
                dispatch({ type: 'SET_PACING', payload: { mechanical: true } });
                addLogEntry(`Pacing: MECHANICAL capture at ${output}mA — pulse palpable at ${rate}/min, blood pressure improving.`, 'success');
            } else if (!mechanical && pacing.mechanical) {
                const pre = pacing.pre || {};
                ['bpSys', 'bpDia', 'spO2'].forEach(k => { if (Number.isFinite(Number(pre[k]))) updates[k] = Number(pre[k]); });
                dispatch({ type: 'SET_PACING', payload: { mechanical: false } });
                addLogEntry(`Pacing: mechanical capture lost at ${output}mA — electrical capture only, no pulse at the paced rate.`, 'warning', true);
            }
            if (Object.keys(updates).length) dispatch({ type: 'UPDATE_VITALS', payload: updates });
        }, [isMonitorMode, state.defib && state.defib.mode, state.remotePacerState, state.pacingThreshold, state.rhythm, state.pacing]);

        return {
            analyseRhythm, applyCardioversion, applyDrugConversion, applyShockOutcome, defibWeight,
            deliverShock, drugOnBoard, goToDefibStep, initCharge, recommendedShockEnergy, refibTimerRef,
            setDefibEnergy, setDefibMode, setQueuedRhythm, shockPolicy, stepsRunning, toggleCPR,
            toggleDefibSync
        };
    };

    window.__EngineDefib = { useDefib };
})();
