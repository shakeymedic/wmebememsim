// THE WHOLE SCENARIO FOR THE FACILITATOR, during the run: the summary in the "Patient now" strip
// (data/screens/patientstatus.js) and the "Full scenario" window it opens. Everything the briefing
// page shows (data/screens/setup.js BriefingScreen), plus the obs it starts with and what Better and
// Worse do, so nothing has to be remembered from the briefing.
(() => {
    const list = (v) => Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []);
    const OBS = [['hr', 'HR'], ['bpSys', 'BP'], ['spO2', 'SpO2'], ['rr', 'RR'], ['temp', 'Temp'], ['gcs', 'GCS'], ['bm', 'Glucose'], ['etco2', 'ETCO2']];
    const obsText = (v) => {
        if (!v) return null;
        const parts = OBS.filter(([k]) => v[k] !== undefined && v[k] !== null && v[k] !== '').map(([k, l]) =>
            k === 'bpSys' ? `BP ${v.bpSys}${v.bpDia !== undefined ? '/' + v.bpDia : ''}` : `${l} ${v[k]}${k === 'spO2' ? '%' : ''}`);
        return parts.length ? parts.join(' · ') : null;
    };
    const profileOf = (s) => s.profile || (window.formatProfileTemplate ? window.formatProfileTemplate(s.patientProfileTemplate || '', s.patientAge, s.sex) : '');
    // "Sam Jones (45y M)", leaving out whatever the scenario does not give
    const whoText = (s) => {
        const age = (s.patientAge !== undefined && s.patientAge !== null && s.patientAge !== '') ? (window.shortAge ? window.shortAge(s.patientAge) : s.patientAge) : '';
        const bits = [age, s.sex].filter(Boolean).join(' ');
        return [s.patientName, bits && `(${bits})`].filter(Boolean).join(' ');
    };
    const actionLabel = (k) => (window.INTERVENTIONS && window.INTERVENTIONS[k] && window.INTERVENTIONS[k].label) || k;

    // In the strip: who, what, the story and what happens next, with the button for the rest.
    const ScenarioSummary = ({ scenario, onOpen }) => {
        const { HumanFactorBadge } = window;
        const s = scenario || {};
        const brief = s.instructorBrief || {};
        return (
            <div className="min-w-0 flex-1 basis-full md:basis-0 flex flex-col gap-1 md:max-w-[34rem]" data-testid="scenario-summary">
                <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-[9px] uppercase font-bold text-slate-400">Scenario</span>
                    <span className="text-xs font-bold text-emerald-300 uppercase">{s.title}</span>
                    <HumanFactorBadge hf={s.hf} />
                </div>
                {whoText(s) && <div className="text-[11px] text-white font-bold">{whoText(s)}</div>}
                <div className="text-[11px] text-slate-200 line-clamp-3">{profileOf(s)}</div>
                {brief.progression && <div className="text-[11px] text-amber-200/90 line-clamp-2"><b className="text-amber-300">Progression: </b>{brief.progression}</div>}
                <button type="button" onClick={onOpen} data-testid="open-full-scenario"
                        className="self-start mt-0.5 text-[10px] uppercase font-bold px-2 py-1 rounded border border-sky-500 text-sky-200 bg-sky-900/40 hover:bg-sky-800/60">Full scenario</button>
            </div>
        );
    };

    const Block = ({ title, tone, children }) => (
        <div className={`p-3 rounded border ${tone || 'border-slate-700 bg-slate-900/50'}`}>
            <h4 className="text-xs font-bold uppercase tracking-wider mb-1 text-slate-300">{title}</h4>
            {children}
        </div>
    );
    const Bullets = ({ items }) => <ul className="list-disc pl-4 text-sm text-slate-200 space-y-0.5">{items.map((l, i) => <li key={i}>{String(l)}</li>)}</ul>;

    const FullScenarioModal = ({ scenario, onClose }) => {
        const { Modal, Button, Lucide, HumanFactorBadge } = window;
        const s = scenario || {};
        const brief = s.instructorBrief || {};
        const objectives = list(brief.debriefPoints || brief.learningObjectives || s.learningObjectives);
        const evo = s.evolution || {};
        const better = evo.improved ? obsText(evo.improved.vitals) : null;
        const worse = evo.deteriorated ? obsText(evo.deteriorated.vitals) : null;
        const injuries = window.Injuries ? window.Injuries.forScenario(s).map(window.Injuries.label) : [];
        return (
            <Modal fixed label={`Full scenario: ${s.title || ''}`} onClose={onClose}>
                <div className="bg-slate-800 p-5 rounded-lg border border-slate-600 w-full max-w-3xl shadow-2xl max-h-[90vh] flex flex-col" data-testid="full-scenario">
                    <div className="flex justify-between items-start gap-3 mb-3">
                        <div className="min-w-0">
                            <h3 className="text-xl font-bold text-white">{s.title}</h3>
                            <div className="flex flex-wrap gap-2 mt-1 text-xs">
                                {[s.category, s.ageRange, s.acuity].filter(Boolean).map(t => <span key={t} className="bg-slate-700 text-slate-200 px-2 py-0.5 rounded border border-slate-600">{t}</span>)}
                                <HumanFactorBadge hf={s.hf} />
                            </div>
                        </div>
                        <button aria-label="Close the full scenario" onClick={onClose} className="text-slate-400 hover:text-white flex-none"><Lucide icon="x" className="w-5 h-5" /></button>
                    </div>
                    <div className="overflow-y-auto pr-1 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                        <div className="space-y-3">
                            <Block title="Patient">
                                <p className="text-white font-bold">{whoText(s)}{s.wetflag && s.wetflag.weight ? `, ${s.wetflag.weight} kg` : ''}</p>
                                {s.presentingComplaint && <p className="text-slate-300">Presenting: {s.presentingComplaint}</p>}
                                <p className="text-slate-200 mt-1 leading-relaxed">{profileOf(s)}</p>
                                <div className="mt-2 space-y-0.5 text-slate-300">
                                    <div><b className="text-slate-400">PMH:</b> {list(s.pmh).join(', ') || 'Nil'}</div>
                                    <div><b className="text-slate-400">Medicines:</b> {list(s.dhx).join(', ') || 'Nil'}</div>
                                    <div><b className="text-slate-400">Allergies:</b> <span className="text-red-300 font-bold">{list(s.allergies).join(', ') || 'NKDA'}</span></div>
                                </div>
                            </Block>
                            {injuries.length > 0 && <Block title="Injuries (as on the patient picture)"><Bullets items={injuries} /></Block>}
                            {obsText(s.vitals) && <Block title="Obs at the start"><p className="text-slate-200">{obsText(s.vitals)}</p></Block>}
                            {(better || worse) && (
                                <Block title="Better / Worse go to">
                                    {better && <p className="text-emerald-300"><b>Better:</b> {better}</p>}
                                    {worse && <p className="text-red-300"><b>Worse:</b> {worse}</p>}
                                </Block>
                            )}
                            {s.hf && s.hf.id !== 'hf0' && s.hf.description && <Block title="Human factors" tone="border-fuchsia-600/40 bg-fuchsia-900/20"><p className="text-slate-200">{s.hf.description}</p></Block>}
                        </div>
                        <div className="space-y-3">
                            {brief.progression && <Block title="Clinical progression" tone="border-amber-600/40 bg-amber-900/20"><p className="text-slate-200 leading-relaxed">{brief.progression}</p></Block>}
                            {list(brief.interventions).length > 0 && <Block title="Key interventions" tone="border-emerald-600/40 bg-emerald-900/20"><Bullets items={list(brief.interventions)} /></Block>}
                            {list(s.recommendedActions).length > 0 && <Block title="Recommended actions"><p className="text-slate-200">{list(s.recommendedActions).map(actionLabel).join(', ')}</p></Block>}
                            {objectives.length > 0 && <Block title="Learning objectives" tone="border-indigo-600/40 bg-indigo-900/20"><Bullets items={objectives} /></Block>}
                            {list(s.equipment).length > 0 && <Block title="Equipment"><p className="text-slate-200">{list(s.equipment).join(', ')}</p></Block>}
                            {list(s.learningLinks).length > 0 && (
                                <Block title="Guidelines and resources">
                                    <div className="flex flex-col gap-1">{list(s.learningLinks).map((l, i) => <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-400 hover:underline">{l.label}</a>)}</div>
                                </Block>
                            )}
                        </div>
                    </div>
                    <div className="border-t border-slate-700 pt-3 mt-3 flex justify-end">
                        <Button onClick={onClose} variant="secondary" className="h-9 px-4">Close</Button>
                    </div>
                </div>
            </Modal>
        );
    };

    window.ScenarioView = { ScenarioSummary, FullScenarioModal };
})();
