(() => {
    const { useState, useEffect, useRef, useMemo } = React;

    // =========================================================================================
    // THE OBS TIMELINE: the patient's obs over the whole session, with what was done and what
    // changed, on one time axis. Shared by the debrief screen (dark, interactive) and the printed
    // report (light, static), so both always show the same chart.
    //
    // Form: small multiples. HR, BP, SpO2 and RR have different units, so each gets its own panel
    // and scale rather than sharing one y-axis. Above them, a rhythm lane (pulseless periods in
    // red, also washed across every panel); below them, numbered event markers in four labelled
    // lanes. Every marker number is in the event list under the chart, and every value is in the
    // obs table, so nothing depends on hovering or on colour alone.
    // =========================================================================================
    const escHtml = (v) => String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmtClock = (s) => { const t = Math.max(0, Math.round(Number(s) || 0)); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

    // Colours: series slot 1 (blue) and slot 2 (orange) from the validated categorical palette,
    // checked against these two surfaces; red and amber are the reserved status colours and
    // always come with a lane label and an icon. Text uses the ink tokens, never a series colour.
    const THEMES = {
        dark: { surface: '#020617', grid: '#1e293b', axis: '#334155', muted: '#94a3b8', secondary: '#cbd5e1', primary: '#f8fafc',
            line: '#3987e5', band: 'rgba(57,135,229,0.14)', action: '#3987e5', change: '#d95926', rhythm: '#d03b3b', flag: '#fab219',
            arrestWash: 'rgba(208,59,59,0.14)', perfusing: '#1e293b' },
        light: { surface: '#ffffff', grid: '#e2e8f0', axis: '#cbd5e1', muted: '#64748b', secondary: '#475569', primary: '#0f172a',
            line: '#2a78d6', band: 'rgba(42,120,214,0.10)', action: '#2a78d6', change: '#eb6834', rhythm: '#d03b3b', flag: '#fab219',
            arrestWash: 'rgba(208,59,59,0.09)', perfusing: '#eef2f7' }
    };
    // White or ink on a coloured marker, by the fill's luminance.
    const inkOn = (hex) => { const n = parseInt(hex.slice(1), 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#0f172a' : '#ffffff'; };

    const EVENT_CATS = [
        { id: 'rhythm', label: 'Rhythm, arrest and shocks', icon: '⚡' },
        { id: 'action', label: 'Team actions and treatment', icon: '●' },
        { id: 'change', label: 'Facilitator changes', icon: '✎' },
        { id: 'flag', label: 'Flags and warnings', icon: '⚑' }
    ];
    // Which lane a log entry belongs in. Housekeeping (sync, settings, teaching notes typed 'info',
    // unflagged warnings such as "Defib charging") stays in the full log, off the graph.
    const classifyEvent = (l) => {
        const m = String(l.msg || '');
        if (/^Rhythm: .*→/.test(m) || /^CARDIAC ARREST/.test(m) || /^ROSC achieved/.test(m) || /^Shock delivered/.test(m) || /recurred after ROSC/i.test(m)) return 'rhythm';
        if (/^(Obs changed|Obs trend started|Patient Improving|Patient Deteriorating|Patient condition|Preset|Patient: |Sound: |NIBP cycled|NIBP Manual|Audio Loop|Facilitator override)/.test(m)) return 'change';
        if (l.flagged || (l.deviation && Array.isArray(l.deviation.missing))) return 'flag';
        if (l.type === 'action' || l.type === 'success') return 'action';
        if (l.type === 'manual') return 'change';        // the facilitator's own log entries
        if (l.type === 'danger') return 'flag';          // timer alerts, failed airway
        return null;
    };

    const PANELS = [
        { key: 'hr', title: 'Heart rate', unit: 'bpm', dp: 0 },
        { key: 'bp', title: 'Blood pressure', unit: 'mmHg', dp: 0, low: 'bpDia' },
        { key: 'spo2', title: 'SpO2', unit: '%', dp: 0 },
        { key: 'rr', title: 'Resp rate', unit: '/min', dp: 0 },
        { key: 'etco2', title: 'ETCO2', unit: 'kPa', dp: 1, onlyWhen: (h) => h.co2 === 1 },
        { key: 'temp', title: 'Temperature', unit: '°C', dp: 1, ifChanged: 0.25 },
        { key: 'bm', title: 'Glucose', unit: 'mmol/L', dp: 1, ifChanged: 0.6 },
        { key: 'ph', title: 'pH', unit: '', dp: 2, ifChanged: 0.02 },
        { key: 'gcs', title: 'GCS', unit: '', dp: 0, ifChanged: 0.5 }
    ];
    const numOf = (h, k) => { const v = Number(h[k]); return (h[k] === null || h[k] === undefined || !Number.isFinite(v)) ? null : v; };
    const ceilTo = (v, step) => Math.ceil(v / step) * step;
    const domainFor = (key, vals) => {
        const hi0 = Math.max(...vals), lo0 = Math.min(...vals);
        switch (key) {
            case 'hr': return [0, Math.max(160, ceilTo(hi0 * 1.1, 20))];
            case 'bp': return [0, Math.max(180, ceilTo(hi0 * 1.1, 20))];
            case 'spo2': return [Math.max(0, Math.min(80, Math.floor((lo0 - 5) / 10) * 10)), 100];
            case 'rr': return [0, Math.max(40, ceilTo(hi0 * 1.1, 10))];
            case 'etco2': return [0, Math.max(8, Math.ceil(hi0 + 1))];
            case 'temp': return [Math.min(34, Math.floor(lo0 - 0.5)), Math.max(40, Math.ceil(hi0 + 0.5))];
            case 'bm': return [0, Math.max(20, ceilTo(hi0 * 1.1, 5))];
            case 'ph': return [Math.min(6.9, Math.floor((lo0 - 0.05) * 10) / 10), Math.max(7.6, Math.ceil((hi0 + 0.05) * 10) / 10)];
            case 'gcs': return [3, 15];
            default: return [Math.min(0, lo0), hi0 || 1];
        }
    };
    const tickStep = (span) => [30, 60, 120, 300, 600, 900, 1800, 3600, 7200].find(s => span / s <= 7) || 7200;

    // Lay out the whole chart for a given width. Returns the SVG markup plus the geometry the
    // interactive layer needs (null when fewer than two samples were recorded).
    const buildTimeline = (history, log, opts) => {
        const o = opts || {};
        const th = THEMES[o.theme === 'light' ? 'light' : 'dark'];
        const RG = window.RHYTHMS;
        const pts = (history || []).filter(h => h && Number.isFinite(Number(h.time))).slice().sort((a, b) => a.time - b.time);
        if (pts.length < 2) return null;
        const events = (log || [])
            .filter(l => l && Number.isFinite(Number(l.timeSeconds)))
            .map((l, i) => ({ msg: String(l.msg || ''), simTime: l.simTime, t: Number(l.timeSeconds), cat: classifyEvent(l), order: i }))
            .filter(e => e.cat)
            .sort((a, b) => a.t - b.t || a.order - b.order)
            .map((e, i) => ({ ...e, n: i + 1 }));
        const t0 = Math.min(pts[0].time, ...events.map(e => e.t));
        const t1 = Math.max(pts[pts.length - 1].time, ...events.map(e => e.t));
        const span = Math.max(1, t1 - t0);

        const W = Math.max(320, Math.round(o.width || 720));
        const FS = o.theme === 'light' ? 12 : 11;            // label size
        const L = 44, R = 64, plotW = W - L - R;
        const x = (t) => L + ((t - t0) / span) * plotW;
        const out = [];
        const text = (tx, ty, s, attrs) => `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" font-size="${(attrs && attrs.size) || FS}" fill="${(attrs && attrs.fill) || th.muted}"${attrs && attrs.anchor ? ` text-anchor="${attrs.anchor}"` : ''}${attrs && attrs.weight ? ` font-weight="${attrs.weight}"` : ''}>${escHtml(s)}</text>`;
        let y = 4;

        // Pulseless stretches, from the rhythm recorded in each sample.
        const segs = [];
        if (RG && pts.some(h => h.rhythm)) {
            pts.forEach((h, i) => {
                const end = i < pts.length - 1 ? pts[i + 1].time : t1;
                const r = h.rhythm || (segs.length ? segs[segs.length - 1].rhythm : null);
                if (!r) return;
                const last = segs[segs.length - 1];
                if (last && last.rhythm === r) last.end = end; else segs.push({ rhythm: r, start: h.time, end, pulseless: RG.isPulseless(r) });
            });
        }
        const washes = segs.filter(s => s.pulseless && s.end > s.start);

        // ---- Rhythm lane
        let rhythmLane = null;
        if (segs.length) {
            out.push(text(L, y + FS, 'Rhythm', { fill: th.primary, weight: 'bold', size: FS + 1 }));
            y += FS + 6;
            const h = 20;
            segs.forEach(s => {
                const xa = x(s.start), xb = Math.max(xa + 1, x(s.end));
                const fill = s.pulseless ? th.rhythm : th.perfusing;
                const label = RG.labelFor(s.rhythm);
                const short = (RG.shortFor && RG.shortFor(s.rhythm)) || label;
                out.push(`<g><title>${escHtml(`${label}: ${fmtClock(s.start)}–${fmtClock(s.end)}`)}</title><rect x="${xa.toFixed(1)}" y="${y}" width="${Math.max(1, xb - xa - 2).toFixed(1)}" height="${h}" rx="3" fill="${fill}"/></g>`);
                const fit = [label, short].find(l => l.length * FS * 0.58 + 10 < xb - xa - 2);
                if (fit) out.push(text(xa + 5, y + h / 2 + FS * 0.36, fit, { fill: s.pulseless ? '#ffffff' : th.primary, size: FS }));
            });
            rhythmLane = { top: y, bottom: y + h };
            y += h + 10;
        }

        // ---- Obs panels
        const plotTop = y;
        const panels = [];
        const PH = o.panelHeight || 58;
        PANELS.forEach(p => {
            const usable = pts.filter(h => (!p.onlyWhen || p.onlyWhen(h)) && numOf(h, p.key) !== null);
            if (usable.length < 2) return;
            const vals = usable.map(h => numOf(h, p.key)).concat(p.low ? usable.map(h => numOf(h, p.low)).filter(v => v !== null) : []);
            if (p.ifChanged && (Math.max(...vals) - Math.min(...vals)) < p.ifChanged) return;
            const [lo, hi] = domainFor(p.key, vals);
            const top = y + FS + 6, bottom = top + PH;
            const yOf = (v) => bottom - ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * PH;
            out.push(`<text x="${L}" y="${y + FS}" font-size="${FS + 1}" font-weight="bold" fill="${th.primary}">${escHtml(p.title)}${p.unit ? `<tspan font-weight="normal" font-size="${FS}" fill="${th.muted}" dx="6">${escHtml(p.unit)}</tspan>` : ''}</text>`);
            washes.forEach(s => out.push(`<rect x="${x(s.start).toFixed(1)}" y="${top}" width="${Math.max(1, x(s.end) - x(s.start)).toFixed(1)}" height="${PH}" fill="${th.arrestWash}"/>`));
            [lo, (lo + hi) / 2, hi].forEach(v => {
                out.push(`<line x1="${L}" x2="${L + plotW}" y1="${yOf(v).toFixed(1)}" y2="${yOf(v).toFixed(1)}" stroke="${v === lo ? th.axis : th.grid}" stroke-width="1"/>`);
                out.push(text(L - 6, yOf(v) + FS * 0.35, Number(v).toFixed(p.dp === 2 ? 1 : (p.dp && hi - lo < 20 ? 1 : 0)), { anchor: 'end' }));
            });
            // A line broken wherever the value was not recorded (or capnography was off).
            const pathFor = (key) => {
                let d = '', pen = false;
                pts.forEach(h => {
                    const v = (!p.onlyWhen || p.onlyWhen(h)) ? numOf(h, key) : null;
                    if (v === null) { pen = false; return; }
                    d += `${pen ? 'L' : 'M'}${x(h.time).toFixed(1)},${yOf(v).toFixed(1)}`; pen = true;
                });
                return d;
            };
            if (p.low) {
                // BP: systolic and diastolic, with the pulse pressure as a light band between them.
                const both = pts.filter(h => numOf(h, p.key) !== null && numOf(h, p.low) !== null);
                if (both.length > 1) {
                    const band = both.map((h, i) => `${i ? 'L' : 'M'}${x(h.time).toFixed(1)},${yOf(numOf(h, p.key)).toFixed(1)}`).join('') +
                        both.slice().reverse().map(h => `L${x(h.time).toFixed(1)},${yOf(numOf(h, p.low)).toFixed(1)}`).join('') + 'Z';
                    out.push(`<path d="${band}" fill="${th.band}" stroke="none"/>`);
                }
                out.push(`<path d="${pathFor(p.low)}" fill="none" stroke="${th.line}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
            }
            out.push(`<path d="${pathFor(p.key)}" fill="none" stroke="${th.line}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
            // The last value, at the end of the line.
            const lastH = usable[usable.length - 1];
            const lastV = numOf(lastH, p.key);
            const lastLow = p.low ? numOf(lastH, p.low) : null;
            const fmt = (v) => Number(v).toFixed(p.dp);
            out.push(`<circle cx="${x(lastH.time).toFixed(1)}" cy="${yOf(lastV).toFixed(1)}" r="4" fill="${th.line}" stroke="${th.surface}" stroke-width="2"/>`);
            out.push(text(L + plotW + 8, Math.min(bottom, Math.max(top + FS, yOf(lastV) + FS * 0.35)), lastLow !== null ? `${fmt(lastV)}/${fmt(lastLow)}` : fmt(lastV), { fill: th.secondary, weight: 'bold' }));
            panels.push({ ...p, top, bottom, yOf, lo, hi });
            y = bottom + 10;
        });
        if (!panels.length) return null;
        const plotBottom = y - 10;

        // Rhythm events: a hairline through every panel, so the obs can be read against them.
        events.filter(e => e.cat === 'rhythm').forEach(e => {
            out.push(`<line x1="${x(e.t).toFixed(1)}" x2="${x(e.t).toFixed(1)}" y1="${(rhythmLane ? rhythmLane.top : plotTop).toFixed(1)}" y2="${plotBottom.toFixed(1)}" stroke="${th.rhythm}" stroke-width="1" stroke-opacity="0.55"/>`);
        });

        // ---- Time axis
        const step = tickStep(span);
        for (let t = Math.ceil(t0 / step) * step; t <= t1 + 0.001; t += step) {
            out.push(`<line x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${plotBottom}" y2="${plotBottom + 4}" stroke="${th.axis}" stroke-width="1"/>`);
            out.push(text(x(t), plotBottom + 6 + FS, fmtClock(t), { anchor: 'middle' }));
        }
        y = plotBottom + FS + 16;

        // ---- Event lanes. Markers that would overlap in a lane share one marker ("12 +2").
        const lanes = [];
        EVENT_CATS.forEach(c => {
            const evs = events.filter(e => e.cat === c.id);
            if (!evs.length) return;
            out.push(text(L, y + FS, `${c.icon} ${c.label}`, { fill: th.secondary, weight: 'bold' }));
            const top = y + FS + 5, hgt = 18;
            const clusters = [];
            evs.forEach(e => {
                const ex = x(e.t);
                const c0 = clusters[clusters.length - 1];
                if (c0 && ex - 9 < c0.left + c0.width + 2) { c0.items.push(e); }
                else clusters.push({ x: ex, items: [e] });
                const cl = clusters[clusters.length - 1];
                const label = cl.items.length === 1 ? String(cl.items[0].n) : `${cl.items[0].n} +${cl.items.length - 1}`;
                cl.label = label; cl.width = Math.max(hgt, label.length * FS * 0.62 + 10);
                cl.left = Math.min(Math.max(0, cl.x - hgt / 2), W - cl.width);
            });
            const fill = th[c.id];
            clusters.forEach(cl => {
                const tip = cl.items.map(e => `${e.n}. ${fmtClock(e.t)} ${e.msg}`).join('\n');
                out.push(`<g><title>${escHtml(tip)}</title><rect x="${cl.left.toFixed(1)}" y="${top}" width="${cl.width.toFixed(1)}" height="${hgt}" rx="${hgt / 2}" fill="${fill}" stroke="${th.surface}" stroke-width="2"/>${text(cl.left + cl.width / 2, top + hgt / 2 + FS * 0.36, cl.label, { anchor: 'middle', fill: inkOn(fill), weight: 'bold' })}</g>`);
            });
            lanes.push({ id: c.id, top, bottom: top + hgt });
            y = top + hgt + 8;
        });
        const H = Math.ceil(y + 4);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escHtml(o.ariaLabel || 'The patient’s obs over the session, with the rhythm, what was done and what changed')}" style="display:block;max-width:100%;height:auto;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:${th.surface}"><rect width="${W}" height="${H}" fill="${th.surface}"/>${out.join('')}</svg>`;
        return { svg, W, H, L, R, plotW, x, t0, t1, top: rhythmLane ? rhythmLane.top : plotTop, plotBottom, panels, pts, events, lanes, theme: th };
    };

    // Rows for the obs table: one per 30 s of session time, plus the last.
    const tableRows = (pts) => {
        const rows = []; let lastT = -Infinity;
        pts.forEach((h, i) => { if (h.time - lastT >= 30 || i === pts.length - 1) { rows.push(h); lastT = h.time; } });
        return rows;
    };
    const cell = (h, k, dp) => { const v = numOf(h, k); return v === null ? '—' : v.toFixed(dp || 0); };
    const bpCell = (h) => numOf(h, 'bp') === null ? '—' : `${cell(h, 'bp')}${numOf(h, 'bpDia') !== null ? '/' + cell(h, 'bpDia') : ''}`;
    const rhythmName = (r) => (r && window.RHYTHMS) ? window.RHYTHMS.labelFor(r) : (r || '—');

    // ---- The printed / downloaded report: the same chart, light, with the event list and table.
    const buildReportTrend = (history, log) => {
        const tl = buildTimeline(history, log, { theme: 'light', width: 940 });
        if (!tl) {
            return `<div class="card"><h3 style="margin-top:0;">Obs, interventions and changes</h3><div class="muted">Not enough obs were recorded for a graph (they are sampled every 5 seconds of session time).</div></div>`;
        }
        const catOf = (id) => EVENT_CATS.find(c => c.id === id);
        const eventList = tl.events.length
            ? `<ol class="events">${tl.events.map(e => `<li value="${e.n}"><span class="mono">${escHtml(fmtClock(e.t))}</span> <span class="chip" style="background:${tl.theme[e.cat]};color:${inkOn(tl.theme[e.cat])}">${escHtml(catOf(e.cat).icon)} ${escHtml(catOf(e.cat).label)}</span> ${escHtml(e.msg)}</li>`).join('')}</ol>`
            : '<div class="muted">No interventions or changes were logged.</div>';
        const rows = tableRows(tl.pts);
        const table = `<table class="compact"><thead><tr><th>Time</th><th>Rhythm</th><th>HR</th><th>BP</th><th>SpO2</th><th>RR</th><th>ETCO2</th><th>Temp</th><th>GCS</th></tr></thead><tbody>${rows.map(h => `<tr><td class="mono">${fmtClock(h.time)}</td><td>${escHtml(rhythmName(h.rhythm))}</td><td>${cell(h, 'hr')}</td><td>${bpCell(h)}</td><td>${cell(h, 'spo2')}</td><td>${cell(h, 'rr')}</td><td>${h.co2 === 1 ? cell(h, 'etco2', 1) : '—'}</td><td>${cell(h, 'temp', 1)}</td><td>${escHtml(h.gcs ?? '—')}</td></tr>`).join('')}</tbody></table>`;
        return `<div class="card"><h3 style="margin-top:0;">Obs, interventions and changes</h3><p class="muted" style="margin-top:0;">The patient’s true obs every 5 seconds (what the team could see depended on what was attached). Red shading marks time without a pulse. The numbered markers match the list below.</p><div class="timeline">${tl.svg}</div><h4>What happened</h4>${eventList}<h4>Obs every 30 seconds</h4>${table}</div>`;
    };
    window.__debriefReportTrend = buildReportTrend;   // test handle
    window.__buildObsTimeline = buildTimeline;        // test handle

    // ---- The debrief screen: the same chart, dark, with a crosshair read-out and the event list.
    const ObsTimeline = ({ history, log, emptyText }) => {
        const wrapRef = useRef(null);
        const [width, setWidth] = useState(720);
        const [hover, setHover] = useState(null);       // index into tl.pts
        const [ptrY, setPtrY] = useState(null);         // pointer height, for placing the read-out
        const [picked, setPicked] = useState(null);     // event number
        const [showTable, setShowTable] = useState(false);
        useEffect(() => {
            const el = wrapRef.current;
            if (!el) return;
            const measure = () => { const w = Math.floor(el.clientWidth); if (w > 0) setWidth(w); };
            measure();
            if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure); }
            const ro = new ResizeObserver(measure); ro.observe(el);
            return () => ro.disconnect();
        }, []);
        const tl = useMemo(() => buildTimeline(history, log, { theme: 'dark', width }), [history, log, width]);
        if (!tl) return <div ref={wrapRef} className="text-slate-400 text-xs p-4 text-center bg-slate-900 border border-slate-700 rounded mb-4" data-testid="obs-timeline-empty">{emptyText}</div>;

        const nearest = (t) => {
            let best = 0;
            tl.pts.forEach((h, i) => { if (Math.abs(h.time - t) < Math.abs(tl.pts[best].time - t)) best = i; });
            return best;
        };
        const onMove = (e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = (e.clientX - rect.left) * (tl.W / rect.width);
            if (px < tl.L - 4 || px > tl.L + tl.plotW + 4) return;
            setPtrY((e.clientY - rect.top) * (tl.W / rect.width));
            setHover(nearest(tl.t0 + ((px - tl.L) / tl.plotW) * (tl.t1 - tl.t0)));
        };
        const onKey = (e) => {
            const last = tl.pts.length - 1;
            const cur = hover === null ? last : hover;
            const go = { ArrowLeft: Math.max(0, cur - 1), ArrowRight: Math.min(last, cur + 1), Home: 0, End: last }[e.key];
            if (go === undefined) return;
            e.preventDefault(); setPtrY(null); setHover(go);
        };
        const h = hover !== null ? tl.pts[hover] : null;
        const pickedEv = picked !== null ? tl.events.find(ev => ev.n === picked) : null;
        const near = h ? tl.events.filter(ev => Math.abs(ev.t - h.time) <= 2.5) : [];
        const catOf = (id) => EVENT_CATS.find(c => c.id === id);
        const readout = h ? [
            ['HR', cell(h, 'hr'), 'bpm'], ['BP', bpCell(h), 'mmHg'], ['SpO2', cell(h, 'spo2'), '%'], ['RR', cell(h, 'rr'), '/min'],
            ...(h.co2 === 1 ? [['ETCO2', cell(h, 'etco2', 1), 'kPa']] : []),
            ...(numOf(h, 'temp') !== null ? [['Temp', cell(h, 'temp', 1), '°C']] : []),
            ...(numOf(h, 'gcs') !== null ? [['GCS', cell(h, 'gcs'), '']] : [])
        ] : [];
        // Beside the crosshair, on whichever side has room, and clear of the pointer.
        const tipLeft = h ? (tl.x(h.time) + 232 > tl.W ? Math.max(0, tl.x(h.time) - 222) : tl.x(h.time) + 12) : 0;
        const tipTop = ptrY === null ? 4 : Math.max(4, Math.min(tl.H - 190, ptrY + 18));

        return (
            <div className="w-full bg-slate-900 border border-slate-700 rounded p-3 mb-4" data-testid="obs-timeline">
                <h4 className="text-xs font-bold text-slate-300 mb-1 uppercase tracking-wide">Obs, interventions and changes</h4>
                <p className="text-[11px] text-slate-400 mb-2">The patient's true obs every 5 seconds. Red shading marks time without a pulse. Hover, or focus the chart and use the arrow keys, to read the values at any moment; the numbered markers match the list below.</p>
                <div ref={wrapRef} className="w-full">
                    <div className="relative outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded" tabIndex={0}
                         role="group" aria-label="Obs timeline. Use the left and right arrow keys to step through the recorded obs."
                         onPointerMove={onMove} onPointerLeave={() => setHover(null)} onKeyDown={onKey} onBlur={() => setHover(null)}>
                        <div dangerouslySetInnerHTML={{ __html: tl.svg }} />
                        <svg className="absolute inset-0 pointer-events-none" viewBox={`0 0 ${tl.W} ${tl.H}`} width="100%" height="100%" aria-hidden="true">
                            {pickedEv && <line x1={tl.x(pickedEv.t)} x2={tl.x(pickedEv.t)} y1={tl.top} y2={tl.H - 4} stroke={tl.theme[pickedEv.cat]} strokeWidth="2" />}
                            {h && <line x1={tl.x(h.time)} x2={tl.x(h.time)} y1={tl.top} y2={tl.plotBottom} stroke="#e2e8f0" strokeWidth="1" />}
                            {h && tl.panels.map(p => {
                                const v = numOf(h, p.key);
                                if (v === null || (p.onlyWhen && !p.onlyWhen(h))) return null;
                                return <circle key={p.key} cx={tl.x(h.time)} cy={p.yOf(v)} r="4" fill={tl.theme.line} stroke={tl.theme.surface} strokeWidth="2" />;
                            })}
                        </svg>
                        {h && (
                            <div className="absolute z-10 pointer-events-none bg-slate-800/95 border border-slate-600 rounded shadow-xl p-2 text-xs w-[210px]" style={{ left: tipLeft, top: tipTop }} data-testid="obs-readout">
                                <div className="font-mono text-slate-300 mb-0.5">{fmtClock(h.time)}</div>
                                {h.rhythm && <div className="text-slate-300 mb-1">{rhythmName(h.rhythm)}</div>}
                                <div className="grid grid-cols-2 gap-x-2">
                                    {readout.map(([k, v, u]) => <div key={k}><span className="font-bold text-white font-mono">{v}</span> <span className="text-slate-400">{k}{u ? ` ${u}` : ''}</span></div>)}
                                </div>
                                {near.length > 0 && <ul className="mt-1 border-t border-slate-600 pt-1 space-y-0.5">{near.map(ev => <li key={ev.n} className="text-slate-200"><b>{ev.n}.</b> {ev.msg}</li>)}</ul>}
                            </div>
                        )}
                    </div>
                </div>
                <h5 className="text-[11px] font-bold text-slate-300 uppercase tracking-wide mt-3 mb-1">What happened ({tl.events.length})</h5>
                {tl.events.length === 0 ? <div className="text-xs text-slate-400">No interventions or changes were logged.</div> : (
                    <ol className="max-h-56 overflow-y-auto space-y-0.5 pr-1" data-testid="obs-events">
                        {tl.events.map(ev => (
                            <li key={ev.n}>
                                <button type="button" onClick={() => { setPicked(picked === ev.n ? null : ev.n); }}
                                        aria-pressed={picked === ev.n}
                                        className={`w-full text-left flex gap-2 items-start text-xs rounded px-1 py-0.5 ${picked === ev.n ? 'bg-slate-700' : 'hover:bg-slate-800'}`}>
                                    <span className="flex-none min-w-[1.6rem] text-center rounded-full font-bold text-[11px] leading-5" style={{ background: tl.theme[ev.cat], color: inkOn(tl.theme[ev.cat]) }}>{ev.n}</span>
                                    <span className="flex-none font-mono text-slate-400 leading-5">{fmtClock(ev.t)}</span>
                                    <span className="text-slate-200 leading-5"><span className="sr-only">{catOf(ev.cat).label}: </span>{ev.msg}</span>
                                </button>
                            </li>
                        ))}
                    </ol>
                )}
                <button type="button" onClick={() => setShowTable(!showTable)} aria-expanded={showTable} className="mt-2 text-[11px] text-sky-400 underline">{showTable ? 'Hide' : 'Show'} the obs as a table</button>
                {showTable && (
                    <div className="mt-1 max-h-56 overflow-auto">
                        <table className="w-full text-[11px] text-slate-300 font-mono" data-testid="obs-table">
                            <thead><tr className="text-slate-400 text-left">{['Time', 'Rhythm', 'HR', 'BP', 'SpO2', 'RR', 'ETCO2', 'Temp', 'GCS'].map(c => <th key={c} className="pr-2 font-bold">{c}</th>)}</tr></thead>
                            <tbody>{tableRows(tl.pts).map(r => (
                                <tr key={r.time} className="border-t border-slate-800">
                                    <td className="pr-2">{fmtClock(r.time)}</td><td className="pr-2 font-sans">{rhythmName(r.rhythm)}</td><td className="pr-2">{cell(r, 'hr')}</td><td className="pr-2">{bpCell(r)}</td>
                                    <td className="pr-2">{cell(r, 'spo2')}</td><td className="pr-2">{cell(r, 'rr')}</td><td className="pr-2">{r.co2 === 1 ? cell(r, 'etco2', 1) : '—'}</td><td className="pr-2">{cell(r, 'temp', 1)}</td><td className="pr-2">{r.gcs ?? '—'}</td>
                                </tr>
                            ))}</tbody>
                        </table>
                    </div>
                )}
            </div>
        );
    };

    const DebriefScreen = ({ sim, onExit }) => {
        const { state } = sim;
        const { Lucide, Button } = window;
        const scenario = state.scenario || {};
        // QUICK SIM DEBRIEF. Quick Sim produces a real, lightweight debrief — event
        // log, vitals trend graph and instructor notes — but there is no scenario, so there are no
        // learning objectives to score and no score to show. Every scenario-dependent block below is
        // guarded, and `state.scenario` being null outright (an edge case that could previously
        // reach this screen via an aborted load) is handled by the `|| {}` above.
        const isQuickSim = !!scenario.quickSim;
        // Defib Sim: feedback in the standalone Defib-sim's style, and a printable certificate.
        const defibSim = scenario.defibSim && window.DefibSim && window.DefibSim.assess ? scenario.defibSim : null;
        const defibReview = defibSim ? window.DefibSim.assess(state) : null;
        // Ventilator feedback: any session in which a ventilator was used (Ventilator Sim or not).
        const ventSim = scenario.ventSim || null;
        const ventReview = window.VentSim && window.VentSim.used(state) ? window.VentSim.assess(state) : null;
        const printCertificate = () => {
            const name = window.prompt('Learner name for the certificate (leave blank to omit):', '') ;
            if (name === null) return;
            const html = window.DefibSim.certificateHtml(state, name.trim());
            const w = window.open('', '_blank');
            if (w && w.document) {
                w.document.open(); w.document.write(html); w.document.close();
                const go = () => { try { w.focus(); w.print(); } catch (e) {} };
                if (w.document.readyState === 'complete') setTimeout(go, 300); else w.addEventListener('load', () => setTimeout(go, 300));
                return;
            }
            const blob = new Blob([html], { type: 'text/html' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `Certificate_${Date.now()}.html`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
        };
        const [filter, setFilter] = useState('all');
        // The session's length on the debrief timeline (Quick Sim records it before START too).
        const duration = Number.isFinite(Number(state.sessionTime)) ? Math.max(Number(state.sessionTime), Number(state.time) || 0) : (Number(state.time) || 0);
        const durationText = `${Math.floor(duration / 60)}m ${duration % 60}s`;
        const timelineEmpty = isQuickSim
            ? 'Not enough obs were recorded for a graph yet: they are sampled every 5 seconds from the moment the Quick Sim starts.'
            : defibSim
                ? 'No obs were recorded: the graph records while the clock runs, which starts at the learner\u2019s first action on the defib (or when you press START).'
                : 'No obs were recorded: the graph records while the scenario clock runs, so press START at the beginning of the scenario.';
        // Keyed on state.runId — a genuinely unique id minted per RUN by the engine.
        // It used to read `state.sessionID`, which has never existed on state, so the key silently
        // collapsed to the SCENARIO id and every run of the same scenario shared one set of notes.
        // The remaining fallbacks only matter for a pre-Wave-4b saved session.
        const notesKey = `wmebem_debrief_notes_${state.runId || scenario.id || 'current'}`;
        const [instructorNotes, setInstructorNotes] = useState(() => { try { return localStorage.getItem(notesKey) || ''; } catch (e) { return ''; } });
        useEffect(() => { try { localStorage.setItem(notesKey, instructorNotes); } catch (e) {} }, [notesKey, instructorNotes]);

        const filteredLog = state.log.filter(entry => {
            if (filter === 'all') return true;
            if (filter === 'actions') return entry.type === 'action';
            if (filter === 'manual') return entry.type === 'manual' || entry.flagged;
            if (filter === 'system') return entry.type === 'system';
            // The log filter had no way of showing 'danger'/'warning' entries at all, so shocks
            // and flagged deviations could not be isolated in the debrief.
            if (filter === 'shocks') return entry.type === 'danger' || /shock|defib|cardiovers/i.test(entry.msg || '');
            if (filter === 'rhythm') return /^Rhythm:/i.test(entry.msg || '') || /ROSC|CARDIAC ARREST/i.test(entry.msg || '');
            return true;
        });

        // ---- B5: SHOCK METRICS IN THE DEBRIEF ------------------------------------------------
        // These now exist because Wave 3 moved the shock tally out of a bare useRef (which never
        // reached state, Firebase, localStorage or this screen, and reset on resume) into
        // state.defib, which is synced and persisted.
        const defibMetrics = state.defib || {};
        const shockEvents = state.log.filter(l => l.type === 'danger' && /shock delivered/i.test(l.msg || ''));
        const conversionEvents = state.log.filter(l => /^Rhythm:/.test(l.msg || '') && /\u2192/.test(l.msg || ''));

        // Sequence deviations: structured records written by the engine's permissive gating. Nothing
        // was blocked during the session; these are the teaching points that fell out of it.
        const deviations = state.log.filter(l => l.deviation && Array.isArray(l.deviation.missing));
        // `flagged` marks BOTH deviations and merely-significant events (arrests,
        // shocks, hand flags). The two counts are now reported separately and labelled, so neither
        // screen shows a deviation count that disagrees with the deviation list.
        const flaggedCount = state.log.filter(l => l.flagged).length;
        const significanceCount = flaggedCount - deviations.length;

        const allObjectives = (() => {
            // No scenario means no objectives. Array.isArray guards a restricted/pasted scenario
            // that carries a malformed learningObjectives field.
            const a = Array.isArray(scenario.learningObjectives) ? scenario.learningObjectives : [];
            const b = Array.isArray(scenario.instructorBrief?.learningObjectives) ? scenario.instructorBrief.learningObjectives : [];
            const seen = new Set();
            return [...a, ...b].filter(o => { if (seen.has(o)) return false; seen.add(o); return true; });
        })();
        const objectivesTotal = allObjectives.length;
        const completed = state.completedObjectives instanceof Set ? state.completedObjectives : new Set();
        // ---- WAVE 5 / ITEM 2: PARTIAL CREDIT ON MULTI-COMPONENT OBJECTIVES --------------------
        // "Hyperkalaemia treatment" needs calcium AND insulin/dextrose. Giving only calcium used to
        // read "0% — Objectives Met: 0/1", which a facilitator reasonably mistakes for a bug. The
        // engine now derives each objective's COMPONENTS from the scenario's own recommended actions
        // and reports which were done and which were missing. Scores are not inflated: the headline
        // number still counts only fully-completed objectives, and the partial-credit number is
        // shown next to it, explicitly labelled.
        const progress = (window.computeObjectiveProgress
            ? window.computeObjectiveProgress(state.scenario || {}, {
                interventionCounts: state.interventionCounts,
                activeInterventions: state.activeInterventions,
                completedObjectives: completed
            })
            : { objectives: [], total: objectivesTotal, fullyMet: 0, partial: 0, score: null, partialScore: null, hasPartial: false });
        const objectiveRows = progress.objectives || [];
        const objectivesMet = progress.fullyMet;
        // A score of "100%" against zero objectives is meaningless and actively misleading in Quick
        // Sim, so the score is null when there is nothing to score and the card is omitted.
        const score = objectivesTotal > 0 ? (progress.score ?? 0) : null;
        const partialScore = objectivesTotal > 0 ? (progress.partialScore ?? 0) : null;
        const partialCount = progress.partial || 0;
        const statusOf = (obj) => {
            const row = objectiveRows.find(r => r.objective === obj);
            return row || { objective: obj, status: completed.has(obj) ? 'met' : 'none', components: [], metComponents: [], missingComponents: [], multiComponent: false };
        };

        const generateReport = (mode) => {
            const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
            // The report shows the same three-state status and names the components
            // that were and were not done, so a partial objective is never printed as a bare failure.
            const objRows = allObjectives.map(obj => {
                const r = statusOf(obj);
                const colour = r.status === 'met' ? '#22c55e' : r.status === 'partial' ? '#fbbf24' : '#ef4444';
                const label = r.status === 'met' ? '\u2713 Met' : r.status === 'partial' ? '\u25D0 Partly done' : '\u2715 Not Met';
                const detail = (r.components && r.components.length)
                    ? `${r.metComponents.length ? 'Done: ' + esc(r.metComponents.join(', ')) : ''}${r.metComponents.length && r.missingComponents.length ? '<br>' : ''}${r.missingComponents.length ? 'Not done: ' + esc(r.missingComponents.join(', ')) : ''}`
                    : '<span style="color:#64748b;">No component breakdown available for this objective.</span>';
                return `<tr><td style="padding:6px 10px;border-bottom:1px solid #334155;">${esc(obj)}</td><td style="padding:6px 10px;border-bottom:1px solid #334155;color:${colour};font-weight:bold;white-space:nowrap;">${label}</td><td style="padding:6px 10px;border-bottom:1px solid #334155;color:#cbd5e1;font-size:.85rem;">${detail}</td></tr>`;
            }).join('');
            const logRows = state.log.map(l => { const colour = l.type === 'danger' ? '#ef4444' : l.type === 'success' ? '#22c55e' : '#cbd5e1'; return `<tr><td style="padding:5px 10px;border-bottom:1px solid #1e293b;color:#94a3b8;font-family:monospace;white-space:nowrap;">${esc(l.simTime)}</td><td style="padding:5px 10px;border-bottom:1px solid #1e293b;color:${colour};">${l.flagged ? '\uD83D\uDEA9 ' : ''}${esc(l.msg)}</td></tr>`; }).join('');
            const devRows = deviations.map(d => `<tr><td style="padding:5px 10px;border-bottom:1px solid #1e293b;color:#94a3b8;font-family:monospace;white-space:nowrap;">${esc(d.simTime)}</td><td style="padding:5px 10px;border-bottom:1px solid #1e293b;color:#fbbf24;font-weight:bold;">${esc(d.deviation.label || d.deviation.action)}</td><td style="padding:5px 10px;border-bottom:1px solid #1e293b;color:#cbd5e1;">${esc(d.deviation.missing.join(', '))}</td></tr>`).join('');
            const shockRows = shockEvents.map(l => `<tr><td style="padding:5px 10px;border-bottom:1px solid #1e293b;color:#94a3b8;font-family:monospace;white-space:nowrap;">${esc(l.simTime)}</td><td style="padding:5px 10px;border-bottom:1px solid #1e293b;color:#fca5a5;">${esc(l.msg)}</td></tr>`).join('');
            const convRows = conversionEvents.map(l => `<tr><td style="padding:5px 10px;border-bottom:1px solid #1e293b;color:#94a3b8;font-family:monospace;white-space:nowrap;">${esc(l.simTime)}</td><td style="padding:5px 10px;border-bottom:1px solid #1e293b;color:#fbbf24;">${esc(l.msg)}</td></tr>`).join('');
            // Defibrillation data reaches the downloadable debrief report too.
            const defibCard = `<div class="card"><h3 style="color:#ef4444;margin-top:0;">Defibrillation &amp; Rhythm</h3><div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:12px;"><div><div style="font-size:.7rem;color:#64748b;text-transform:uppercase;">Shocks</div><div style="font-size:1.5rem;font-weight:bold;">${esc(defibMetrics.shockCount || shockEvents.length || 0)}</div></div><div><div style="font-size:.7rem;color:#64748b;text-transform:uppercase;">Into shockable rhythm</div><div style="font-size:1.5rem;font-weight:bold;">${esc(defibMetrics.shockableShocks || 0)}</div></div><div><div style="font-size:.7rem;color:#64748b;text-transform:uppercase;">Cumulative energy</div><div style="font-size:1.5rem;font-weight:bold;">${esc(defibMetrics.totalEnergy || 0)} J</div></div><div><div style="font-size:.7rem;color:#64748b;text-transform:uppercase;">Last energy</div><div style="font-size:1.5rem;font-weight:bold;">${esc(defibMetrics.lastEnergy ?? '--')} J</div></div></div>${shockRows ? `<table><thead><tr><th>Time</th><th>Shock</th></tr></thead><tbody>${shockRows}</tbody></table>` : '<div style="color:#94a3b8;">No shocks delivered.</div>'}${convRows ? `<h4 style="color:#fbbf24;">Rhythm transitions</h4><table><thead><tr><th>Time</th><th>Transition</th></tr></thead><tbody>${convRows}</tbody></table>` : ''}</div>`;
            const devCard = `<div class="card"><h3 style="color:#fbbf24;margin-top:0;">Sequence Deviations</h3>${deviations.length ? `<table><thead><tr><th>Time</th><th>Action</th><th>Not in place</th></tr></thead><tbody>${devRows}</tbody></table>` : '<div style="color:#94a3b8;">No sequence deviations recorded.</div>'}</div>`;
            const safeTitle = esc(scenario.title || 'Simulation');
            // The objectives card and the score are omitted from the downloadable report when
            // there are no objectives, rather than printing "100% of 0".
            const scoreBlock = score === null
                ? `<div><div style="font-size:.75rem;color:#64748b;text-transform:uppercase;">Mode</div><div style="font-size:1.5rem;font-weight:bold;">Quick Sim</div><div style="font-size:.7rem;color:#64748b;">No scenario \u2014 nothing to score</div></div>`
                : `<div><div style="font-size:.75rem;color:#64748b;text-transform:uppercase;">Score (fully met)</div><div class="score">${esc(score)}%</div></div><div><div style="font-size:.75rem;color:#64748b;text-transform:uppercase;">Objectives Met</div><div style="font-size:1.5rem;font-weight:bold;">${esc(objectivesMet)} / ${esc(objectivesTotal)}</div>${partialCount ? `<div style="font-size:.7rem;color:#fbbf24;">+ ${esc(partialCount)} partly done</div>` : ''}</div>${partialCount ? `<div><div style="font-size:.75rem;color:#64748b;text-transform:uppercase;">With partial credit</div><div style="font-size:1.5rem;font-weight:bold;color:#fbbf24;">${esc(partialScore)}%</div><div style="font-size:.7rem;color:#64748b;">components done / components expected</div></div>` : ''}`;
            const objCard = objectivesTotal === 0 ? '' : `<div class="card"><h3 style="color:#a78bfa;margin-top:0;">Learning Objectives</h3><p style="color:#94a3b8;font-size:.8rem;margin-top:0;">Objectives made of more than one component are only \u201cmet\u201d when every component was done. Anything started but incomplete is shown as partly done, with the missing component named \u2014 a low score here is a discussion point, not a verdict.</p><table><thead><tr><th>Objective</th><th>Status</th><th>Components</th></tr></thead><tbody>${objRows}</tbody></table></div>`;
            // Light, print-friendly theme (it used to be dark, which printed as solid black pages).
            // The inline colours inside the cards were written for a dark background, so the CSS
            // re-maps the light-on-dark ones to readable ink.
            const reportCss = `body{font-family:Arial,sans-serif;background:#fff;color:#0f172a;margin:0;padding:24px;max-width:1000px}h1{color:#0369a1;margin-bottom:4px}h2{color:#475569;font-size:1rem;font-weight:normal;margin-bottom:24px}h3{color:#0f172a!important}h4{margin:14px 0 6px;color:#334155}.card{background:#fff;border-radius:8px;padding:16px;margin-bottom:16px;border:1px solid #cbd5e1;break-inside:avoid}.score{font-size:3rem;font-weight:bold;color:#0369a1}table{width:100%;border-collapse:collapse}th{text-align:left;padding:8px 10px;color:#475569;font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #cbd5e1}td{color:#0f172a!important;border-bottom:1px solid #e2e8f0!important}.muted{color:#64748b;font-size:.85rem}.mono{font-family:monospace;color:#475569}.minis{display:grid;grid-template-columns:1fr 1fr;gap:8px}.mini{margin:0;border:1px solid #e2e8f0;border-radius:6px;padding:4px}.mini svg{width:100%;height:auto;display:block}.events{margin:0;padding-left:28px;font-size:.85rem}.events li{margin:2px 0}.chip{display:inline-block;border-radius:9px;padding:0 6px;font-size:.7rem;font-weight:bold;margin-right:4px}.timeline{overflow:hidden;margin:8px 0}.timeline svg{width:100%;height:auto;display:block}table.compact td,table.compact th{padding:3px 8px;font-size:.8rem}@media (max-width:640px){.minis{grid-template-columns:1fr}}@media print{body{padding:0}.card{border-color:#94a3b8}a{color:inherit}}`;
            const trendCard = buildReportTrend(state.history, state.log);
            const defibFeedbackCard = defibReview ? `<div class="card"><h3 style="margin-top:0;">Defib Sim feedback</h3><p class="muted" style="margin-top:0;">${esc(defibSim.name)} &middot; ${defibSim.mode === 'assessment' ? 'Assessment' : 'Education'} mode</p>${defibReview.outcome ? `<p><b>${esc(defibReview.outcome.title)}.</b> ${esc(defibReview.outcome.text)}</p>` : ''}${defibReview.good.length ? `<h4>Good practice</h4><ul>${defibReview.good.map(g => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}${defibReview.improve.length ? `<h4>Areas for improvement</h4><ul>${defibReview.improve.map(g => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}</div>` : '';
            const li = (arr) => arr.map(g => `<li>${esc(g)}</li>`).join('');
            const ventFeedbackCard = ventReview ? `<div class="card"><h3 style="margin-top:0;">Ventilator feedback</h3>${ventSim ? `<p class="muted" style="margin-top:0;">${esc(ventSim.name)} &middot; ${ventSim.mode === 'assessment' ? 'Assessment' : 'Education'} mode</p>` : ''}${ventReview.stats.length ? `<ul>${li(ventReview.stats)}</ul>` : ''}${ventReview.good.length ? `<h4>Good practice</h4><ul>${li(ventReview.good)}</ul>` : ''}${ventReview.improve.length ? `<h4>Areas for improvement</h4><ul>${li(ventReview.improve)}</ul>` : ''}${ventReview.problems.length ? `<h4>Problems</h4><ul>${li(ventReview.problems.map(p => p.text))}</ul>` : ''}</div>` : '';
            const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Debrief \u2014 ${safeTitle}</title><style>${reportCss}</style></head><body><h1>${safeTitle}</h1><h2>Simulation Debrief Report &nbsp;&bull;&nbsp; ${esc(new Date().toLocaleString('en-GB'))}</h2><div class="card"><div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;">${scoreBlock}<div><div style="font-size:.75rem;color:#64748b;text-transform:uppercase;">Duration</div><div style="font-size:1.5rem;font-weight:bold;">${esc(durationText)}</div></div></div></div>${defibFeedbackCard}${ventFeedbackCard}${objCard}${trendCard}${devCard}${defibCard}<div class="card"><h3 style="color:#38bdf8;margin-top:0;">Simulation Log</h3><table><thead><tr><th>Time</th><th>Event</th></tr></thead><tbody>${logRows}</tbody></table></div><div class="card"><h3 style="color:#fbbf24;margin-top:0;">Instructor Notes</h3><div style="white-space:pre-wrap;">${esc(instructorNotes)}</div></div></body></html>`;
            if (mode === 'print') {
                // Opened from the click itself, so popup blockers allow it. If one still blocks it,
                // fall back to downloading the same file.
                const w = window.open('', '_blank');
                if (w && w.document) {
                    w.document.open(); w.document.write(html); w.document.close();
                    const go = () => { try { w.focus(); w.print(); } catch (e) {} };
                    if (w.document.readyState === 'complete') setTimeout(go, 300); else w.addEventListener('load', () => setTimeout(go, 300));
                    return;
                }
            }
            const blob = new Blob([html], { type: 'text/html' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `Debrief_${Date.now()}.html`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
        };

        return (
            <div className="h-full flex flex-col bg-slate-900 p-4 overflow-hidden">
                <div className="flex justify-between items-center mb-4 border-b border-slate-700 pb-4">
                    <div>
                        <h1 className="text-2xl font-bold text-white flex items-center gap-2"><Lucide icon="check-circle" className="text-emerald-500"/> Simulation Complete</h1>
                        <p className="text-slate-400">
                            {scenario.title || 'Simulation'}
                            {isQuickSim && <span className="ml-2 text-[10px] uppercase tracking-wider font-bold text-sky-400 border border-sky-700 bg-sky-950/40 rounded px-1.5 py-0.5">Quick Sim &middot; no scenario</span>}
                            {' '}• Duration: {durationText}
                        </p>
                    </div>
                    <div className="flex gap-2">
                        {defibSim && <Button onClick={printCertificate} variant="secondary" title="Print a certificate of completion for the learner"><Lucide icon="check-circle" className="mr-2 h-4 w-4"/> Certificate</Button>}
                        <Button onClick={() => generateReport('print')} variant="secondary" title="Open a print-friendly report and print it (or save as PDF)"><Lucide icon="printer" className="mr-2 h-4 w-4"/> Print</Button>
                        <Button onClick={() => generateReport('download')} variant="secondary"><Lucide icon="download" className="mr-2 h-4 w-4"/> Download Report</Button>
                        <Button onClick={onExit} variant="danger">Exit to Menu</Button>
                    </div>
                </div>

                <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-hidden min-h-0">
                    <div className="overflow-y-auto space-y-4 pr-2">
                        <ObsTimeline history={state.history} log={state.log} emptyText={timelineEmpty} />
                        {defibReview && (
                            <div className="bg-slate-800 p-4 rounded-lg border border-amber-700/60" data-testid="defib-feedback">
                                <h3 className="text-lg font-bold text-white mb-1 flex items-center gap-2"><Lucide icon="zap" className="w-4 h-4 text-amber-400"/> Defib Sim feedback</h3>
                                <p className="text-xs text-slate-400 mb-3">{defibSim.name} &middot; {defibSim.mode === 'assessment' ? 'Assessment' : 'Education'} mode</p>
                                {defibReview.outcome && (
                                    <div className={`mb-3 p-2 rounded border ${defibReview.outcome.ok ? 'border-emerald-600 bg-emerald-950/40 text-emerald-300' : 'border-amber-600 bg-amber-950/40 text-amber-300'}`}>
                                        <div className="font-bold">{defibReview.outcome.ok ? '\u2713' : '\u26a0'} {defibReview.outcome.title}</div>
                                        <div className="text-xs text-slate-300">{defibReview.outcome.text}</div>
                                    </div>
                                )}
                                {defibReview.good.length > 0 && (
                                    <div className="mb-2 border-l-4 border-emerald-500 bg-emerald-950/20 p-2 rounded">
                                        <div className="text-xs font-bold text-emerald-400 uppercase mb-1">Good practice</div>
                                        <ul className="text-sm text-slate-200 space-y-0.5">{defibReview.good.map(g => <li key={g}>{'\u2713'} {g}</li>)}</ul>
                                    </div>
                                )}
                                {defibReview.improve.length > 0 && (
                                    <div className="border-l-4 border-red-500 bg-red-950/20 p-2 rounded">
                                        <div className="text-xs font-bold text-red-400 uppercase mb-1">Areas for improvement</div>
                                        <ul className="text-sm text-slate-200 space-y-0.5">{defibReview.improve.map(g => <li key={g}>{'\u26a0'} {g}</li>)}</ul>
                                    </div>
                                )}
                            </div>
                        )}
                        {ventReview && (
                            <div className="bg-slate-800 p-4 rounded-lg border border-cyan-700/60" data-testid="vent-feedback">
                                <h3 className="text-lg font-bold text-white mb-1 flex items-center gap-2"><Lucide icon="wind" className="w-4 h-4 text-cyan-400"/> Ventilator feedback</h3>
                                {ventSim && <p className="text-xs text-slate-400 mb-2">{ventSim.name} &middot; {ventSim.mode === 'assessment' ? 'Assessment' : 'Education'} mode</p>}
                                {ventReview.stats.length > 0 && <ul className="text-xs text-slate-300 mb-2 space-y-0.5">{ventReview.stats.map(g => <li key={g}>{'\u2022'} {g}</li>)}</ul>}
                                {ventReview.good.length > 0 && (
                                    <div className="mb-2 border-l-4 border-emerald-500 bg-emerald-950/20 p-2 rounded">
                                        <div className="text-xs font-bold text-emerald-400 uppercase mb-1">Good practice</div>
                                        <ul className="text-sm text-slate-200 space-y-0.5">{ventReview.good.map(g => <li key={g}>{'\u2713'} {g}</li>)}</ul>
                                    </div>
                                )}
                                {ventReview.improve.length > 0 && (
                                    <div className="mb-2 border-l-4 border-red-500 bg-red-950/20 p-2 rounded">
                                        <div className="text-xs font-bold text-red-400 uppercase mb-1">Areas for improvement</div>
                                        <ul className="text-sm text-slate-200 space-y-0.5">{ventReview.improve.map(g => <li key={g}>{'\u26a0'} {g}</li>)}</ul>
                                    </div>
                                )}
                                {ventReview.problems.length > 0 && (
                                    <div className="border-l-4 border-amber-500 bg-amber-950/20 p-2 rounded">
                                        <div className="text-xs font-bold text-amber-400 uppercase mb-1">Problems injected</div>
                                        <ul className="text-sm text-slate-200 space-y-0.5">{ventReview.problems.map((p, i) => <li key={i}>{p.text}</li>)}</ul>
                                    </div>
                                )}
                                <p className="text-[10px] text-slate-500 mt-2">Targets are the simulator's teaching targets for this scenario, not a guideline.</p>
                            </div>
                        )}
                        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                            <h3 className="text-lg font-bold text-white mb-2">Performance Summary</h3>
                            {/* With no scenario there are no objectives and therefore no score.
                                Showing "100%" against zero objectives would be actively misleading. */}
                            {score === null ? (
                                <div className="mb-4 text-sm text-slate-400">
                                    {isQuickSim
                                        ? 'Quick Sim has no scenario, so there are no learning objectives to score. The obs graph, the event log and your notes are the debrief.'
                                        : 'This session declared no learning objectives, so there is nothing to score.'}
                                </div>
                            ) : (
                                <div className="flex items-center gap-4 mb-4 flex-wrap">
                                    <div>
                                        <div className="text-4xl font-bold text-sky-400">{score}%</div>
                                        <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Fully met</div>
                                    </div>
                                    {/* Partial credit is shown next to the strict score, never
                                        folded into it, so a part-treated multi-component objective reads as
                                        "1 of 2 components done" rather than as a flat 0%. */}
                                    {partialCount > 0 && (
                                        <div>
                                            <div className="text-4xl font-bold text-amber-400">{partialScore}%</div>
                                            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">With partial credit</div>
                                        </div>
                                    )}
                                    <div className="text-sm text-slate-400">
                                        Objectives Met: {objectivesMet}/{objectivesTotal}
                                        {partialCount > 0 && <span className="text-amber-400"> · {partialCount} partly done</span>}
                                    </div>
                                </div>
                            )}
                            
                            {/* Shock summary. Shock count, cumulative energy and the last energy
                                used are teaching data (energy escalation, 4 J/kg in children,
                                shocks-per-ROSC) and were previously unavailable after the session. */}
                            <div className="mb-4 bg-slate-900 border border-red-900/60 rounded p-3">
                                <h4 className="text-xs font-bold text-red-400 uppercase mb-2 flex items-center gap-1"><Lucide icon="zap" className="w-3 h-3"/> Defibrillation</h4>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    {[['Shocks', defibMetrics.shockCount || shockEvents.length || 0, ''],
                                      ['Into shockable', defibMetrics.shockableShocks || 0, ''],
                                      ['Cumulative', defibMetrics.totalEnergy || 0, 'J'],
                                      ['Last energy', defibMetrics.lastEnergy ?? '--', 'J']].map(([lbl, val, unit]) => (
                                        <div key={lbl} className="bg-slate-800 rounded p-2 text-center border border-slate-700">
                                            <div className="text-[10px] font-bold uppercase text-slate-400">{lbl}</div>
                                            <div className="text-lg font-mono font-bold text-white">{val}<span className="text-[9px] text-slate-400 ml-0.5">{unit}</span></div>
                                        </div>
                                    ))}
                                </div>
                                <div className="text-[10px] text-slate-400 mt-2">
                                    Device left in {String(defibMetrics.mode || 'monitor').toUpperCase()} mode{defibMetrics.syncMode ? ', SYNC armed' : ''}.
                                    {' '}{conversionEvents.length} rhythm transition{conversionEvents.length === 1 ? '' : 's'} recorded.
                                </div>
                                {shockEvents.length > 0 && (
                                    <div className="mt-2 max-h-28 overflow-y-auto space-y-1">
                                        {shockEvents.map((l, i) => (
                                            <div key={i} className="flex gap-2 text-[11px]">
                                                <span className="font-mono text-slate-400 flex-none">{l.simTime}</span>
                                                <span className="text-red-300">{l.msg}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Omitted entirely rather than rendered as an empty list. */}
                            {objectivesTotal > 0 && (
                                <>
                                    <h4 className="text-sm font-bold text-white mb-2 uppercase">Learning Objectives</h4>
                                    <ul className="space-y-2">
                                        {allObjectives.map((obj, i) => {
                                            const r = statusOf(obj);
                                            const icon = r.status === 'met' ? 'check-square' : r.status === 'partial' ? 'minus-square' : 'square';
                                            const colour = r.status === 'met' ? 'text-emerald-500' : r.status === 'partial' ? 'text-amber-400' : 'text-slate-400';
                                            return (
                                                <li key={i} className="text-sm text-slate-300">
                                                    <div className="flex items-start gap-2">
                                                        <Lucide icon={icon} className={`${colour} w-4 h-4 flex-none mt-0.5`} />
                                                        <span className="flex-1">{obj}</span>
                                                        {r.status === 'partial' && <span className="text-[9px] uppercase font-bold text-amber-300 border border-amber-700 bg-amber-950/40 rounded px-1 py-0.5 flex-none">partly done</span>}
                                                    </div>
                                                    {/* Name the components, so "not met" is never opaque. */}
                                                    {r.components && r.components.length > 0 && (
                                                        <div className="ml-6 mt-1 flex flex-wrap gap-1">
                                                            {r.components.map(c => (
                                                                <span key={c.key} className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${c.met ? 'text-emerald-300 border-emerald-800 bg-emerald-950/40' : 'text-slate-400 border-slate-700 bg-slate-900'}`}>
                                                                    {c.met ? '\u2713' : '\u2715'} {c.label}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                    <p className="text-[10px] text-slate-400 mt-2">A multi-component objective counts as met only when every component was done. Partly-done objectives show the missing component above and are excluded from the fully-met score.</p>
                                </>
                            )}
                        </div>

                        {/* The sequence-deviation card is expectation machinery. Quick Sim has no
                            interventions at all, so there is nothing that could be out of sequence and
                            the card is omitted rather than shown permanently empty. Manual flags still
                            appear in the log pane on the right. */}
                        {!isQuickSim && (
                        <div className="bg-slate-800 p-4 rounded-lg border border-amber-600/50">
                            <h3 className="text-lg font-bold text-amber-400 mb-1 flex items-center gap-2"><Lucide icon="flag" className="w-4 h-4"/> Sequence Deviations</h3>
                            <p className="text-xs text-slate-400 mb-3">Actions performed before their usual prerequisites were in place. Nothing was blocked — these are discussion points, not errors by definition. {deviations.length} deviation{deviations.length === 1 ? '' : 's'}; {significanceCount} other flagged event{significanceCount === 1 ? '' : 's'} (arrests, shocks and manual flags) are highlighted in the timeline but are not deviations.</p>
                            {deviations.length === 0 ? (
                                <div className="text-sm text-slate-400">No sequence deviations recorded.</div>
                            ) : (
                                <ul className="space-y-2">
                                    {deviations.map((entry, i) => (
                                        <li key={i} className="bg-slate-900 border border-amber-700/40 rounded p-2">
                                            <div className="flex justify-between gap-2 items-baseline">
                                                <span className="text-sm font-bold text-amber-200">{entry.deviation.label || entry.deviation.action}</span>
                                                <span className="font-mono text-xs text-slate-400">{entry.simTime}</span>
                                            </div>
                                            <div className="text-xs text-slate-300 mt-0.5">Not in place: {entry.deviation.missing.join(', ')}</div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                        )}

                        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                            <h3 className="text-lg font-bold text-white mb-2">Instructor Notes</h3>
                            <textarea value={instructorNotes} onChange={e => setInstructorNotes(e.target.value)} className="w-full h-32 bg-slate-900 border border-slate-600 rounded p-2 text-white text-sm" placeholder="Add feedback notes here..."></textarea>
                        </div>
                    </div>

                    <div className="flex flex-col bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
                        <div className="flex border-b border-slate-700 bg-slate-900 p-2 gap-2">
                            {['all', 'actions', 'manual', 'shocks', 'rhythm', 'system'].map(f => (
                                <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1 rounded text-xs font-bold uppercase ${filter === f ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>
                                    {f}
                                </button>
                            ))}
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-2">
                            {filteredLog.map((entry, i) => (
                                <div key={i} className={`flex gap-3 text-sm border-b border-slate-700/50 pb-1 ${entry.flagged ? 'bg-amber-900/10 p-1 rounded' : ''}`}>
                                    <span className="text-slate-400 font-mono w-16 flex-shrink-0">{entry.simTime}</span>
                                    <span className={`flex-grow ${entry.type === 'danger' ? 'text-red-400 font-bold' : entry.type === 'success' ? 'text-emerald-400 font-bold' : 'text-slate-300'}`}>
                                        {entry.flagged && <Lucide icon="flag" className="inline w-3 h-3 text-amber-500 mr-1"/>}
                                        {entry.msg}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    window.DebriefScreen = DebriefScreen;
})();
