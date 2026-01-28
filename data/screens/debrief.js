// data/screens/debrief.js - Debrief/Summary Screen
// Full implementation with large vitals graph and intervention markers

window.DebriefScreen = ({ sim, onRestart, onMainMenu }) => {
    const { useState, useMemo, useRef, useEffect } = React;
    const { state } = sim;
    const { scenario, vitalsHistory, interventionsApplied, elapsedTime } = state;

    const [activeTab, setActiveTab] = useState('summary');
    const [selectedVitals, setSelectedVitals] = useState(['hr', 'bpSys', 'spo2']);
    const graphRef = useRef(null);

    // Format time helper
    const formatTime = (seconds) => {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    // Calculate performance metrics
    const metrics = useMemo(() => {
        if (!interventionsApplied || interventionsApplied.length === 0) {
            return { totalInterventions: 0, categories: {}, timeToFirst: null };
        }

        const categories = {};
        interventionsApplied.forEach(int => {
            const cat = int.category || 'Other';
            categories[cat] = (categories[cat] || 0) + 1;
        });

        const sortedByTime = [...interventionsApplied].sort((a, b) => a.time - b.time);
        const timeToFirst = sortedByTime[0]?.time || null;

        return {
            totalInterventions: interventionsApplied.length,
            categories,
            timeToFirst,
            firstIntervention: sortedByTime[0]
        };
    }, [interventionsApplied]);

    // Vital colors
    const vitalColors = {
        hr: '#22c55e',
        bpSys: '#ef4444',
        bpDia: '#f87171',
        spo2: '#06b6d4',
        rr: '#eab308',
        etco2: '#a855f7',
        temp: '#f97316',
        gcs: '#ec4899'
    };

    const vitalLabels = {
        hr: 'Heart Rate',
        bpSys: 'Systolic BP',
        bpDia: 'Diastolic BP',
        spo2: 'SpO₂',
        rr: 'Resp Rate',
        etco2: 'EtCO₂',
        temp: 'Temperature',
        gcs: 'GCS'
    };

    // Normalize value for graph (0-100 scale)
    const normalizeValue = (vital, value) => {
        const ranges = {
            hr: { min: 0, max: 200 },
            bpSys: { min: 40, max: 220 },
            bpDia: { min: 20, max: 140 },
            spo2: { min: 50, max: 100 },
            rr: { min: 0, max: 50 },
            etco2: { min: 0, max: 10 },
            temp: { min: 32, max: 42 },
            gcs: { min: 3, max: 15 }
        };
        const range = ranges[vital] || { min: 0, max: 100 };
        return ((value - range.min) / (range.max - range.min)) * 100;
    };

    // Draw graph
    useEffect(() => {
        if (!graphRef.current || !vitalsHistory || vitalsHistory.length === 0) return;

        const canvas = graphRef.current;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        
        // Set canvas size
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const width = rect.width;
        const height = rect.height;
        const padding = { top: 40, right: 120, bottom: 60, left: 60 };
        const graphWidth = width - padding.left - padding.right;
        const graphHeight = height - padding.top - padding.bottom;

        // Clear canvas
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, width, height);

        // Draw grid
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 0.5;
        
        // Horizontal grid lines
        for (let i = 0; i <= 10; i++) {
            const y = padding.top + (graphHeight * i / 10);
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();
        }

        // Vertical grid lines (every minute)
        const totalSeconds = elapsedTime || vitalsHistory.length;
        const minuteInterval = Math.ceil(totalSeconds / 60);
        for (let i = 0; i <= minuteInterval; i++) {
            const x = padding.left + (graphWidth * (i * 60) / totalSeconds);
            if (x <= width - padding.right) {
                ctx.beginPath();
                ctx.moveTo(x, padding.top);
                ctx.lineTo(x, height - padding.bottom);
                ctx.stroke();
                
                // Time labels
                ctx.fillStyle = '#94a3b8';
                ctx.font = '12px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(`${i}:00`, x, height - padding.bottom + 20);
            }
        }

        // Draw intervention markers
        if (interventionsApplied && interventionsApplied.length > 0) {
            interventionsApplied.forEach((int, idx) => {
                const x = padding.left + (graphWidth * int.time / totalSeconds);
                
                // Vertical line
                ctx.strokeStyle = '#f59e0b';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(x, padding.top);
                ctx.lineTo(x, height - padding.bottom);
                ctx.stroke();
                ctx.setLineDash([]);

                // Marker dot
                ctx.fillStyle = '#f59e0b';
                ctx.beginPath();
                ctx.arc(x, padding.top - 10, 6, 0, Math.PI * 2);
                ctx.fill();

                // Label (rotate for long text)
                ctx.save();
                ctx.translate(x, padding.top - 20);
                ctx.rotate(-Math.PI / 4);
                ctx.fillStyle = '#fbbf24';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'left';
                const label = int.label || int.id;
                ctx.fillText(label.substring(0, 20), 0, 0);
                ctx.restore();
            });
        }

        // Draw vital traces
        selectedVitals.forEach(vital => {
            const color = vitalColors[vital];
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();

            let started = false;
            vitalsHistory.forEach((record, idx) => {
                const value = record[vital];
                if (value === undefined || value === null) return;

                const x = padding.left + (graphWidth * idx / totalSeconds);
                const normalizedY = normalizeValue(vital, value);
                const y = padding.top + graphHeight - (graphHeight * normalizedY / 100);

                if (!started) {
                    ctx.moveTo(x, y);
                    started = true;
                } else {
                    ctx.lineTo(x, y);
                }
            });

            ctx.stroke();
        });

        // Draw legend
        const legendX = width - padding.right + 10;
        let legendY = padding.top;

        ctx.font = 'bold 12px sans-serif';
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText('Legend', legendX, legendY);
        legendY += 20;

        selectedVitals.forEach(vital => {
            ctx.fillStyle = vitalColors[vital];
            ctx.fillRect(legendX, legendY - 8, 12, 12);
            ctx.fillStyle = '#e2e8f0';
            ctx.font = '11px sans-serif';
            ctx.fillText(vitalLabels[vital], legendX + 18, legendY);
            legendY += 18;
        });

        // Intervention legend
        legendY += 10;
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(legendX + 6, legendY - 4, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#e2e8f0';
        ctx.fillText('Intervention', legendX + 18, legendY);

        // Axes labels
        ctx.fillStyle = '#94a3b8';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Time (minutes)', width / 2, height - 10);

        ctx.save();
        ctx.translate(15, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('Normalised Value', 0, 0);
        ctx.restore();

    }, [vitalsHistory, interventionsApplied, elapsedTime, selectedVitals]);

    return (
        <div className="h-full flex flex-col bg-slate-900">
            {/* Header */}
            <div className="bg-slate-800 border-b border-slate-700 p-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-white">Scenario Debrief</h1>
                        <p className="text-slate-400">{scenario?.name || 'Unknown Scenario'} • Duration: {formatTime(elapsedTime)}</p>
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={onRestart}
                            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg font-medium transition-colors"
                        >
                            Restart Scenario
                        </button>
                        <button
                            onClick={onMainMenu}
                            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
                        >
                            Main Menu
                        </button>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-700 bg-slate-800/50">
                <button
                    onClick={() => setActiveTab('summary')}
                    className={`px-6 py-3 font-medium transition-colors ${activeTab === 'summary' ? 'text-sky-400 border-b-2 border-sky-400 bg-slate-800' : 'text-slate-400 hover:text-white'}`}
                >
                    Summary
                </button>
                <button
                    onClick={() => setActiveTab('graph')}
                    className={`px-6 py-3 font-medium transition-colors ${activeTab === 'graph' ? 'text-sky-400 border-b-2 border-sky-400 bg-slate-800' : 'text-slate-400 hover:text-white'}`}
                >
                    Vitals Graph
                </button>
                <button
                    onClick={() => setActiveTab('timeline')}
                    className={`px-6 py-3 font-medium transition-colors ${activeTab === 'timeline' ? 'text-sky-400 border-b-2 border-sky-400 bg-slate-800' : 'text-slate-400 hover:text-white'}`}
                >
                    Intervention Timeline
                </button>
                <button
                    onClick={() => setActiveTab('learning')}
                    className={`px-6 py-3 font-medium transition-colors ${activeTab === 'learning' ? 'text-sky-400 border-b-2 border-sky-400 bg-slate-800' : 'text-slate-400 hover:text-white'}`}
                >
                    Learning Points
                </button>
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto p-6">
                {activeTab === 'summary' && (
                    <div className="max-w-4xl mx-auto space-y-6">
                        {/* Quick Stats */}
                        <div className="grid grid-cols-4 gap-4">
                            <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 text-center">
                                <div className="text-3xl font-bold text-sky-400">{formatTime(elapsedTime)}</div>
                                <div className="text-slate-400 text-sm mt-1">Total Duration</div>
                            </div>
                            <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 text-center">
                                <div className="text-3xl font-bold text-green-400">{metrics.totalInterventions}</div>
                                <div className="text-slate-400 text-sm mt-1">Interventions</div>
                            </div>
                            <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 text-center">
                                <div className="text-3xl font-bold text-amber-400">
                                    {metrics.timeToFirst !== null ? formatTime(metrics.timeToFirst) : '--:--'}
                                </div>
                                <div className="text-slate-400 text-sm mt-1">Time to First Action</div>
                            </div>
                            <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 text-center">
                                <div className="text-3xl font-bold text-purple-400">{Object.keys(metrics.categories).length}</div>
                                <div className="text-slate-400 text-sm mt-1">Categories Used</div>
                            </div>
                        </div>

                        {/* Intervention Breakdown */}
                        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
                            <h3 className="text-lg font-semibold text-white mb-4">Intervention Breakdown</h3>
                            <div className="grid grid-cols-2 gap-4">
                                {Object.entries(metrics.categories).map(([cat, count]) => (
                                    <div key={cat} className="flex items-center justify-between p-3 bg-slate-900 rounded-lg">
                                        <span className="text-slate-300">{cat}</span>
                                        <span className="text-sky-400 font-bold">{count}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Scenario Info */}
                        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
                            <h3 className="text-lg font-semibold text-white mb-4">Scenario Details</h3>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <span className="text-slate-400">Patient:</span>
                                    <span className="text-white ml-2">{scenario?.patientName || 'Unknown'}, {scenario?.age} years</span>
                                </div>
                                <div>
                                    <span className="text-slate-400">Presenting Complaint:</span>
                                    <span className="text-white ml-2">{scenario?.chiefComplaint || 'N/A'}</span>
                                </div>
                                <div className="col-span-2">
                                    <span className="text-slate-400">History:</span>
                                    <p className="text-white mt-1">{scenario?.history || 'N/A'}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'graph' && (
                    <div className="h-full flex flex-col">
                        {/* Vital Selectors */}
                        <div className="mb-4 flex flex-wrap gap-2">
                            {Object.entries(vitalLabels).map(([key, label]) => (
                                <button
                                    key={key}
                                    onClick={() => {
                                        setSelectedVitals(prev => 
                                            prev.includes(key) 
                                                ? prev.filter(v => v !== key)
                                                : [...prev, key]
                                        );
                                    }}
                                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                        selectedVitals.includes(key)
                                            ? 'text-white'
                                            : 'bg-slate-800 text-slate-400 hover:text-white'
                                    }`}
                                    style={{
                                        backgroundColor: selectedVitals.includes(key) ? vitalColors[key] : undefined
                                    }}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>

                        {/* Large Graph Canvas */}
                        <div className="flex-1 min-h-[500px] bg-slate-950 rounded-lg border border-slate-700 overflow-hidden">
                            <canvas 
                                ref={graphRef} 
                                className="w-full h-full"
                            />
                        </div>

                        <p className="text-slate-500 text-sm mt-2 text-center">
                            Dashed vertical lines indicate intervention times. Hover over intervention markers for details.
                        </p>
                    </div>
                )}

                {activeTab === 'timeline' && (
                    <div className="max-w-3xl mx-auto">
                        <div className="relative">
                            {/* Timeline line */}
                            <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-slate-700"></div>

                            {/* Timeline entries */}
                            <div className="space-y-4">
                                {interventionsApplied && interventionsApplied.length > 0 ? (
                                    [...interventionsApplied]
                                        .sort((a, b) => a.time - b.time)
                                        .map((int, idx) => (
                                            <div key={idx} className="relative flex items-start gap-4 pl-16">
                                                {/* Timeline dot */}
                                                <div className="absolute left-6 w-5 h-5 bg-sky-500 rounded-full border-4 border-slate-900"></div>
                                                
                                                {/* Content */}
                                                <div className="flex-1 bg-slate-800 border border-slate-700 rounded-lg p-4">
                                                    <div className="flex items-center justify-between">
                                                        <h4 className="text-white font-medium">{int.label || int.id}</h4>
                                                        <span className="text-sky-400 font-mono text-sm">{formatTime(int.time)}</span>
                                                    </div>
                                                    {int.dose && <p className="text-slate-400 text-sm mt-1">{int.dose}</p>}
                                                    <span className="inline-block mt-2 px-2 py-0.5 bg-slate-700 rounded text-xs text-slate-300">
                                                        {int.category || 'Other'}
                                                    </span>
                                                </div>
                                            </div>
                                        ))
                                ) : (
                                    <div className="text-center py-12 text-slate-500">
                                        No interventions were applied during this scenario
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'learning' && (
                    <div className="max-w-3xl mx-auto space-y-6">
                        {scenario?.learningObjectives && scenario.learningObjectives.length > 0 ? (
                            <>
                                <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
                                    <h3 className="text-lg font-semibold text-white mb-4">Learning Objectives</h3>
                                    <ul className="space-y-3">
                                        {scenario.learningObjectives.map((obj, idx) => (
                                            <li key={idx} className="flex items-start gap-3">
                                                <span className="text-sky-400 mt-0.5">•</span>
                                                <span className="text-slate-300">{obj}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>

                                {scenario?.keyActions && scenario.keyActions.length > 0 && (
                                    <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
                                        <h3 className="text-lg font-semibold text-white mb-4">Key Actions Expected</h3>
                                        <ul className="space-y-3">
                                            {scenario.keyActions.map((action, idx) => {
                                                const wasApplied = interventionsApplied?.some(i => i.id === action.id);
                                                return (
                                                    <li key={idx} className="flex items-center gap-3 p-3 bg-slate-900 rounded-lg">
                                                        {wasApplied ? (
                                                            <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                            </svg>
                                                        ) : (
                                                            <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                            </svg>
                                                        )}
                                                        <span className={wasApplied ? 'text-green-300' : 'text-slate-400'}>
                                                            {action.label || action.id}
                                                        </span>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="text-center py-12 text-slate-500">
                                No learning objectives defined for this scenario
                            </div>
                        )}

                        {/* Discussion Points */}
                        <div className="bg-amber-900/20 border border-amber-500/30 rounded-lg p-6">
                            <h3 className="text-lg font-semibold text-amber-400 mb-4">Discussion Points</h3>
                            <ul className="space-y-3 text-slate-300">
                                <li>• What went well during this scenario?</li>
                                <li>• Were there any delays in recognition or treatment?</li>
                                <li>• How was communication within the team?</li>
                                <li>• What would you do differently next time?</li>
                                <li>• Were there any safety concerns?</li>
                            </ul>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
