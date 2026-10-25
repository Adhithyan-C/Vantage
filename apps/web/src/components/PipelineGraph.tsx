import type { LeadView, RunEvent, RunView, SignalJourney, SignalJourneyStage, SourceRequestView, ThemeView } from '@vantage/shared';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { stageStatus } from '../lib/stages';
import { criticReviewSpread } from '../lib/pipelineExplainability';
import { walkthroughArrowDelta, walkthroughStepAfter } from '../lib/walkthrough';

export type StageAgent = 'scout' | 'classifier' | 'critic' | 'enricher' | 'scorer' | 'displacement';

interface StageDefinition {
  agent: StageAgent;
  name: string;
  purpose: string;
}

const STAGES: StageDefinition[] = [
  { agent: 'scout', name: 'Scout', purpose: 'Collect, deduplicate and store public posts.' },
  { agent: 'classifier', name: 'Classifier', purpose: 'Apply the rubric and verify quoted evidence.' },
  { agent: 'critic', name: 'Critic', purpose: 'Record an independent evidence review.' },
  { agent: 'enricher', name: 'Enricher', purpose: 'Add source, fit and activity context.' },
  { agent: 'scorer', name: 'Scorer', purpose: 'Compute deterministic scores and ranks.' },
  { agent: 'displacement', name: 'Displacement', purpose: 'Cluster competitor complaints into themes.' },
];

function StageIcon({ agent }: { agent: StageAgent }) {
  const content: Record<StageAgent, ReactNode> = {
    scout: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /><path d="m12 12 6-6" /></>,
    classifier: <><path d="M5 6h14M5 12h8M5 18h10" /><path d="m16 14 2 2 4-5" /></>,
    critic: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M8 10h5M8 13h3" /></>,
    enricher: <><path d="M12 4v16M4 12h16" /><circle cx="12" cy="12" r="9" /></>,
    scorer: <><path d="M5 19V11M12 19V5M19 19v-8" /><path d="M3 20h18" /></>,
    displacement: <><circle cx="7" cy="8" r="3" /><circle cx="17" cy="8" r="3" /><circle cx="12" cy="17" r="3" /><path d="m9.5 10 1.5 4m3.5-4-1.5 4" /></>,
  };
  return <svg className="pipeline-stage-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{content[agent]}</svg>;
}

function recordedCount(events: RunEvent[], agent: StageAgent, key: string, prefix: string): number | null {
  const event = [...events].reverse().find((item) => item.agent === agent &&
    (item.kind === 'info' || item.kind === 'warning') && item.message.startsWith(prefix));
  const value = event?.counts?.[key];
  return typeof value === 'number' ? value : null;
}

function progressInput(events: RunEvent[], agent: StageAgent): number | null {
  const event = events.find((item) => item.agent === agent && item.kind === 'progress' &&
    typeof item.counts?.total === 'number');
  const value = event?.counts?.total;
  return typeof value === 'number' ? value : null;
}

function stageCounts(agent: StageAgent, events: RunEvent[]): [number | null, number | null] {
  if (agent === 'scout') {
    const sourceEvents = events.filter((event) => event.agent === 'scout');
    const fetched = sourceEvents.reduce((sum, event) => {
      const value = event.counts?.fetched;
      return sum + (typeof value === 'number' ? value : 0);
    }, 0);
    const afterDedupe = [...sourceEvents].reverse().find((event) => typeof event.counts?.afterDedupe === 'number')?.counts?.afterDedupe;
    return [sourceEvents.some((event) => typeof event.counts?.fetched === 'number') ? fetched : null,
      typeof afterDedupe === 'number' ? afterDedupe : null];
  }
  if (agent === 'classifier') return [progressInput(events, agent), recordedCount(events, agent, 'classified', 'Classified ')];
  if (agent === 'critic') return [progressInput(events, agent), recordedCount(events, agent, 'reviewed', 'Reviewed ')];
  if (agent === 'enricher') return [progressInput(events, agent), recordedCount(events, agent, 'enriched', 'Enriched ')];
  if (agent === 'scorer') return [progressInput(events, agent), recordedCount(events, agent, 'ranked', 'Scored ')];
  return [recordedCount(events, agent, 'complaintSignals', 'Found ') ?? recordedCount(events, agent, 'complaintSignals', 'No competitor'),
    recordedCount(events, agent, 'themeCount', 'Found ') ?? recordedCount(events, agent, 'themeCount', 'No competitor')];
}

function notRecorded(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

function StageDetails({
  stage,
  run,
  events,
  requests,
  leads,
  themes,
  journey,
}: {
  stage: StageDefinition;
  run: RunView;
  events: RunEvent[];
  requests: SourceRequestView[];
  leads: LeadView[];
  themes: ThemeView[];
  journey?: SignalJourney;
}) {
  const stageEvents = events.filter((event) => event.agent === stage.agent);
  const complaintEvent = [...stageEvents].reverse().find((event) => event.counts?.skippedCompetitors !== undefined);
  const skipped = complaintEvent?.counts?.skippedCompetitors;
  const reviews = leads.flatMap((lead) => lead.criticTrace ? [{ lead, trace: lead.criticTrace }] : []);
  const criticFinal = [...stageEvents].reverse().find((event) => event.message.startsWith('Reviewed '));
  const spread = criticReviewSpread(leads);
  const issues = reviews.flatMap(({ lead, trace }) => {
    const values = trace.output.issues;
    return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string')
      .map((issue) => ({ signalId: lead.signalId, issue })) : [];
  });
  const rankedLeads = leads.filter((lead) => lead.label === 'buyer_intent' || lead.label === 'competitor_complaint');
  const stageResult = stageEvents.length > 0
    ? stageEvents.map((event) => <li key={event.id}><span className="pipeline-event-kind">{event.kind}</span> {event.message}</li>)
    : null;

  return (
    <div className="pipeline-detail-body">
      <p>{stage.purpose}</p>
      {stage.agent === 'scout' && <div className="pipeline-detail-section">
        <h4>Recorded sources</h4>
        {run.sources.length > 0 ? <ul>{run.sources.map((source) => <li key={source.source}>{source.source}: {source.status}, {source.fetchedCount} stored signal(s)</li>)}</ul> : <p>Not recorded for this run.</p>}
        <p>{requests.length > 0 ? `${requests.length} source request(s) are available in Diagnostics.` : 'Request details: Not recorded for this run.'}</p>
      </div>}
      {stage.agent === 'classifier' && <div className="pipeline-detail-section">
        <h4>Recorded label totals</h4>
        {recordedCount(events, 'classifier', 'classified', 'Classified ') === null
          ? <p>Not recorded for this run.</p>
          : <ul>{(['buyer_intent', 'competitor_complaint', 'venting', 'noise'] as const).map((label) => {
            const summary = [...stageEvents].reverse().find((event) => event.message.startsWith('Classified '));
            const count = summary?.counts?.[label];
            return <li key={label}>{label.replaceAll('_', ' ')}: {typeof count === 'number' ? count : 'Not recorded for this run'}</li>;
          })}</ul>}
        <p>Classifier decisions remain available as the signal journey is opened.</p>
      </div>}
      {stage.agent === 'critic' && <div className="pipeline-detail-section">
        <p>The Critic records a verdict and concerns. It never changes a label or score.</p>
        <p>No corrections are recorded.</p>
        {criticFinal && <p>{typeof criticFinal.counts?.reviewed === 'number' ? criticFinal.counts.reviewed : 0} reviewed; {typeof criticFinal.counts?.failed === 'number' ? criticFinal.counts.failed : 0} failed.</p>}
        {reviews.length > 0 ? <>
          <h4>Recorded verdicts</h4>
          <ul><li>Supported: {spread.supported}</li><li>Weak: {spread.weak}</li><li>Unsupported: {spread.unsupported}</li></ul>
          <h4>Recorded concerns</h4>
          {issues.length > 0 ? <ul>{issues.map((item, index) => <li key={`${item.signalId}:${index}`}>{item.issue}</li>)}</ul> : <p>No review issues were recorded.</p>}
        </> : <p>Not recorded for this run.</p>}
      </div>}
      {stage.agent === 'enricher' && <div className="pipeline-detail-section">
        <h4>Recorded enrichment</h4>
        {leads.length > 0 ? <ul>{leads.slice(0, 5).map((lead) => <li key={lead.signalId}>{lead.authorHandle}: competitors {lead.enrichment.competitorsMentioned.join(', ') || 'none'}; purchase terms {lead.enrichment.purchaseTermsFound.join(', ') || 'none'}; team terms {lead.enrichment.teamTermsFound.join(', ') || 'none'}</li>)}</ul> : <p>Not recorded for this run.</p>}
      </div>}
      {stage.agent === 'scorer' && <div className="pipeline-detail-section">
        <h4>Recorded score components</h4>
        {rankedLeads.length > 0 ? <ul>{rankedLeads.slice(0, 5).map((lead) => <li key={lead.signalId}>Rank {lead.rank}: {lead.authorHandle}, score {lead.score}; {lead.breakdown.components.map((component) => `${component.name} ${component.contribution} (${Math.round(component.weight * 100)}% weight)`).join(', ')}</li>)}</ul> : <p>Not recorded for this run.</p>}
      </div>}
      {stage.agent === 'displacement' && <div className="pipeline-detail-section">
        <p>Method: local text embeddings and DBSCAN. No product opportunities are generated.</p>
        {themes.length > 0 ? <>
          <h4>Recorded themes and member posts</h4>
          {themes.map((theme) => <div className="pipeline-theme" key={theme.id}>
            <strong>{theme.competitor}: {theme.title}</strong>
            <p>{theme.summary}</p>
            <p>Recurring terms: {theme.title.startsWith(`${theme.competitor}: `) && !theme.title.endsWith(': shared complaint')
              ? theme.title.slice(theme.competitor.length + 2)
              : 'Not recorded for this run.'}</p>
            {theme.members.map((member) => {
              const lead = leads.find((item) => item.signalId === member.signalId);
              return <p key={member.signalId}>{lead ? <a href={`#/runs/${encodeURIComponent(run.id)}/signals/${encodeURIComponent(member.leadId ?? lead.leadId)}`}>{lead.authorHandle}: {lead.textPreview}</a> : `Signal ${member.signalId}: Not recorded for this run.`}</p>;
            })}
          </div>)}
        </> : <p>{stageEvents.length > 0 ? 'No themes were recorded for this run.' : 'Not recorded for this run.'}</p>}
        <h4>Skipped competitors</h4>
        {Array.isArray(skipped) ? skipped.length > 0 ? <ul>{skipped.filter((value): value is string => typeof value === 'string').map((name) => <li key={name}>{name}</li>)}</ul> : <p>None were recorded as skipped.</p> : <p>Not recorded for this run.</p>}
      </div>}
      <div className="pipeline-detail-section">
        <h4>Stage events</h4>
        {stageResult ? <ol className="pipeline-stage-events">{stageResult}</ol> : <p>Not recorded for this run.</p>}
      </div>
    </div>
  );
}

export function PipelineGraph({
  run,
  events,
  requests,
  leads,
  themes,
  journey,
  selectedAgent,
  onSelectAgent,
  motionReduced,
}: {
  run: RunView;
  events: RunEvent[];
  requests: SourceRequestView[];
  leads: LeadView[];
  themes: ThemeView[];
  journey?: SignalJourney;
  selectedAgent: StageAgent;
  onSelectAgent: (agent: StageAgent) => void;
  motionReduced?: boolean;
}) {
  const [walkthroughStep, setWalkthroughStep] = useState<number | null>(null);
  const tabRefs = useRef(new Map<StageAgent, HTMLButtonElement>());
  const stages = STAGES.map((stage) => ({ ...stage, status: stageStatus(stage.agent, events, run.status), counts: stageCounts(stage.agent, events) }));
  const selectedIndex = Math.max(0, stages.findIndex((stage) => stage.agent === selectedAgent));
  const activeIndex = walkthroughStep === null ? selectedIndex : Math.min(walkthroughStep, stages.length - 1);
  const selected = stages[activeIndex] ?? stages[0]!;
  const isResultStep = walkthroughStep === stages.length;
  const walkthrough = walkthroughStep !== null;
  const noMotion = motionReduced ?? (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const chooseIndex = (index: number, focus = false): void => {
    const next = stages[(index + stages.length) % stages.length];
    if (!next) return;
    onSelectAgent(next.agent);
    if (focus) window.requestAnimationFrame(() => tabRefs.current.get(next.agent)?.focus());
  };
  const moveWalkthrough = (delta: number): void => {
    const nextStep = walkthroughStepAfter(walkthroughStep ?? selectedIndex, delta, stages.length);
    setWalkthroughStep(nextStep);
    const nextStage = stages[Math.min(nextStep, stages.length - 1)];
    if (nextStage) onSelectAgent(nextStage.agent);
  };

  return (
    <section className="pipeline-explorer" aria-labelledby="pipeline-explorer-title">
      <div className="pipeline-explorer-heading">
        <div><p className="eyebrow">B · PIPELINE</p><h2 id="pipeline-explorer-title" className="card-title">Pipeline</h2></div>
        <button className="btn btn-secondary" type="button" aria-pressed={walkthrough} onClick={() => setWalkthroughStep((value) => value === null ? selectedIndex : null)}>Walk through</button>
      </div>
      <div className="pipeline-stage-tabs" role="tablist" aria-label="Pipeline stages" aria-orientation="horizontal"
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') { event.preventDefault(); chooseIndex(selectedIndex + 1, true); }
          if (event.key === 'ArrowLeft') { event.preventDefault(); chooseIndex(selectedIndex - 1, true); }
          if (event.key === 'Home') { event.preventDefault(); chooseIndex(0, true); }
          if (event.key === 'End') { event.preventDefault(); chooseIndex(stages.length - 1, true); }
        }}>
        {stages.map((stage, index) => {
          const isSelected = stage.agent === selectedAgent;
          const [input, output] = stage.counts;
          const duration = stage.status.durationMs === null ? 'Not recorded' : `${(stage.status.durationMs / 1000).toFixed(1)} s`;
          return <div className={`pipeline-stage-item${isSelected ? ' is-selected' : ''}`} key={stage.agent}>
            {index > 0 && <span className={`pipeline-stage-connector${stages[index - 1]?.status.state === 'completed' ? ' is-complete' : ''}`} aria-hidden="true" />}
            <button ref={(element) => { if (element) tabRefs.current.set(stage.agent, element); else tabRefs.current.delete(stage.agent); }}
              id={`pipeline-tab-${stage.agent}`} aria-label={`${stage.name}: ${stage.status.label}`}
              className={`pipeline-stage-tab state-${stage.status.state}${stage.status.state === 'running' && !noMotion ? ' is-pulsing' : ''}`}
              type="button" role="tab" aria-selected={isSelected} aria-controls="pipeline-stage-panel" tabIndex={isSelected ? 0 : -1}
              onClick={() => { onSelectAgent(stage.agent); setWalkthroughStep(null); }}>
              <span className="pipeline-stage-index">{index + 1}</span><StageIcon agent={stage.agent} />
              <span className="pipeline-stage-title">{stage.name}</span>
              <span className="pipeline-stage-purpose">{stage.purpose}</span>
              <span className="pipeline-stage-state"><span className="pipeline-status-dot" aria-hidden="true" />{stage.status.label}</span>
              <span className="pipeline-stage-counts">In {notRecorded(input) ? 'Not recorded' : input} · Out {notRecorded(output) ? 'Not recorded' : output}</span>
              <span className="pipeline-stage-duration">{duration}</span>
            </button>
          </div>;
        })}
      </div>
      <section id="pipeline-stage-panel" className="pipeline-stage-panel" role="tabpanel" aria-labelledby={isResultStep ? undefined : `pipeline-tab-${selected.agent}`}>
        <div className="pipeline-panel-heading"><div><p className="eyebrow">{isResultStep ? 'RESULT' : `STAGE ${activeIndex + 1}`}</p><h3>{isResultStep ? 'Result' : selected.name}</h3></div>{!isResultStep && <span className={`pipeline-stage-label state-${selected.status.state}`}><span className="pipeline-status-dot" aria-hidden="true" />{selected.status.label}</span>}</div>
        {walkthrough && <div className="walkthrough-controls" onKeyDown={(event) => {
          const delta = walkthroughArrowDelta(event.key);
          if (delta !== null) { event.preventDefault(); moveWalkthrough(delta); }
        }}>
          <span>Step {(walkthroughStep ?? 0) + 1} of {stages.length + 1}. {journey ? `Following ${journey.authorHandle}'s recorded post.` : 'Select a collected post to follow its recorded journey.'}</span>
          <button type="button" className="btn btn-secondary" disabled={(walkthroughStep ?? 0) === 0} onClick={() => moveWalkthrough(-1)}>Back</button>
          <button type="button" className="btn btn-primary" disabled={isResultStep} onClick={() => moveWalkthrough(1)}>Next</button>
        </div>}
        {isResultStep ? <div className="pipeline-detail-body"><p>{String(journey?.timeline.find((item) => item.stage === 'outcome')?.output?.reason ?? 'Not recorded for this run.')}</p>{typeof journey?.timeline.find((item) => item.stage === 'outcome')?.output?.theme === 'string' && <p>Also a member of theme: {String(journey.timeline.find((item) => item.stage === 'outcome')?.output?.theme)}</p>}</div>
          : <><StageDetails stage={selected} run={run} events={events} requests={requests} leads={leads} themes={themes} />
            {walkthrough && journey && <RecordedStageForSignal journey={journey} stage={selected.agent} />}</>}
      </section>
    </section>
  );
}

function RecordedStageForSignal({ journey, stage }: { journey: SignalJourney; stage: Exclude<SignalJourneyStage, 'outcome'> }) {
  const entry = journey.timeline.find((item) => item.stage === stage);
  if (!entry) return <p className="muted">Not recorded for this run.</p>;
  return <section className="pipeline-detail-section" aria-label={`${stage} result for selected post`}>
    <h4>Selected post</h4>
    <p>{entry.reason ?? `Status: ${entry.status.replaceAll('_', ' ')}`}</p>
    {entry.output && <pre className="journey-output">{JSON.stringify(entry.output, null, 2)}</pre>}
  </section>;
}
