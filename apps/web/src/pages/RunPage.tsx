import { useEffect, useState } from 'react';
import type { LeadView, SignalJourney, SignalRunSummary, ThemeView } from '@vantage/shared';
import { ErrorState } from '../components/ErrorState';
import { PipelineProgress, RunStatusBadge } from '../components/PipelineProgress';
import { PipelineGraph } from '../components/PipelineGraph';
import { SourceActivity } from '../components/SourceActivity';
import { useRunEvents } from '../hooks/useRunEvents';
import { EVENT_KIND_LABEL, formatClock, formatDuration, shortId } from '../lib/format';
import { LoadingState } from '../components/LoadingState';
import { getLeads, getSignalJourney, getRunSignals, getThemes } from '../lib/api';
import { buildFunnel, runOutcome } from '../lib/pipelineExplainability';
import type { StageAgent } from '../components/PipelineGraph';
import { SignalJourneyTimeline } from '../components/SignalJourneyTimeline';

export function RunPage({ runId }: { runId: string }) {
  const { run, events, requests, error, retry } = useRunEvents(runId);
  const [leads, setLeads] = useState<LeadView[]>([]);
  const [themes, setThemes] = useState<ThemeView[]>([]);
  const [collectedSignals, setCollectedSignals] = useState<SignalRunSummary[]>([]);
  const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
  const [journey, setJourney] = useState<SignalJourney | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<StageAgent>('scout');
  const [now, setNow] = useState<number>(() => Date.now());
  const running = run?.status === 'running';
  const resultEventKey = events.filter((event) =>
    (event.agent === 'classifier' && event.message.startsWith('Classified ')) ||
    (event.agent === 'scorer' && event.message.startsWith('Scored ')) ||
    (event.agent === 'displacement' && (event.message.startsWith('Found ') || event.message.startsWith('No competitor'))),
  ).map((event) => event.id).join(',');

  useEffect(() => {
    if (!running) {
      return undefined;
    }
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [running]);

  useEffect(() => {
    if (!run || (running && !resultEventKey)) return;
    let cancelled = false;
    setDetailsError(null);
    void Promise.allSettled([getLeads(runId), getThemes(runId), (async () => {
      const collected: SignalRunSummary[] = [];
      let total = 0;
      do {
        const page = await getRunSignals(runId, 100, collected.length);
        collected.push(...page.signals);
        total = page.total;
        if (page.signals.length === 0) break;
      } while (collected.length < total);
      return collected;
    })()]).then(([leadResult, themeResult, signalResult]) => {
      if (cancelled) return;
      if (leadResult.status === 'fulfilled') setLeads(leadResult.value);
      if (themeResult.status === 'fulfilled') setThemes(themeResult.value);
      if (signalResult.status === 'fulfilled') {
        setCollectedSignals(signalResult.value);
        const rankedLead = leadResult.status === 'fulfilled' ? [...leadResult.value].filter((lead) => lead.label === 'buyer_intent' || lead.label === 'competitor_complaint').sort((a, b) => a.rank - b.rank)[0] : undefined;
        const nextSignal = (rankedLead && signalResult.value.find((signal) => signal.signalId === rankedLead.signalId)) ??
          signalResult.value.find((signal) => signal.stages.classifier.status === 'completed' || signal.stages.critic.status === 'completed') ?? signalResult.value[0];
        setSelectedSignalId((current) => running && current && signalResult.value.some((signal) => signal.signalId === current) ? current : nextSignal?.signalId ?? null);
      }
      const errors = [leadResult, themeResult, signalResult].flatMap((result) => result.status === 'rejected'
        ? [result.reason instanceof Error ? result.reason.message : String(result.reason)] : []);
      setDetailsError(errors.length > 0 ? errors.join('; ') : null);
    });
    return () => { cancelled = true; };
  }, [runId, run?.status, running, resultEventKey]);

  useEffect(() => {
    if (!selectedSignalId) { setJourney(null); return; }
    let cancelled = false;
    void getSignalJourney(runId, selectedSignalId).then((next) => { if (!cancelled) setJourney(next); })
      .catch(() => { if (!cancelled) setJourney(null); });
    return () => { cancelled = true; };
  }, [runId, selectedSignalId, resultEventKey, run?.status]);

  if (!run) {
    if (error) {
      return <ErrorState title="Could not load this run" message={error} onRetry={retry} />;
    }
    return (
      <LoadingState label="Loading run" />
    );
  }

  const duration = formatDuration(run.startedAt, run.finishedAt, now);
  const funnel = buildFunnel(run, events);
  const outcome = runOutcome(run, events, funnel);

  return (
    <div className="stack">
      <section className="card run-summary" aria-labelledby="run-title">
        <div className="card-head">
          <div>
            <h1 id="run-title" className="page-title">
              {run.seller.productName}
            </h1>
            <p className="muted">
              Run <span className="mono">{shortId(run.id)}</span> · started <span className="mono">{formatClock(run.startedAt)}</span>
              {duration ? ` · ${duration}` : ''}
            </p>
          </div>
          <RunStatusBadge status={run.status} />
        </div>
        <p className="muted">
          Searching for: {run.params.keywords.join(', ')} (last {run.params.sinceDays} days, up to{' '}
          {run.params.maxResults} per source)
        </p>
        <ol className="funnel-strip" aria-label="Signal funnel">
          {funnel.map((step) => <li key={step.key} className="funnel-step">
            <span className="funnel-label">{step.label}</span>
            <strong className="funnel-count">{step.count ?? 'Not recorded'}</strong>
            {step.note && <span className="funnel-note">{step.note}</span>}
          </li>)}
        </ol>
      </section>

      {error && <ErrorState title="Connection problem" message={error} onRetry={retry} />}
      {detailsError && <p className="notice" role="status">Some recorded stage details could not be loaded: {detailsError}</p>}

      <PipelineGraph run={run} events={events} requests={requests} leads={leads} themes={themes}
        journey={journey ?? undefined} selectedAgent={selectedAgent} onSelectAgent={setSelectedAgent} />

      {collectedSignals.length > 0 && <section className="card stack" aria-labelledby="follow-signal-title">
        <div><p className="eyebrow">SIGNAL TRACE</p><h2 id="follow-signal-title" className="card-title">Follow a collected post</h2><p className="muted">Select any collected post to see only the recorded evidence through its journey.</p></div>
        <ul className="collected-signal-list">{collectedSignals.map((signal) => <li key={signal.signalId}>
          <div><strong>{signal.authorHandle}</strong><span className="muted">{signal.stages.classifier.reason === 'Excluded before classification' ? 'Excluded before classification' : signal.label?.replaceAll('_', ' ') ?? 'Not classified'}{signal.score !== null ? ` · score ${signal.score}` : ''}</span><p>{signal.textPreview}</p><a href={`#/runs/${encodeURIComponent(runId)}/signals/${encodeURIComponent(signal.leadId ?? signal.signalId)}`}>Open signal journey</a></div>
          <button className="btn btn-secondary" type="button" aria-pressed={selectedSignalId === signal.signalId} onClick={() => setSelectedSignalId(signal.signalId)}>Follow this post</button>
        </li>)}</ul>
        {journey && <SignalJourneyTimeline journey={journey} />}
      </section>}

      {run.status !== 'running' && (
        <section className="card run-results" aria-labelledby="result-title">
          <h2 id="result-title" className="card-title">
            Result
          </h2>
          <dl className="stats">
            <div>
              <dt>Signals collected</dt>
              <dd>{run.signalCount}</dd>
            </div>
            <div>
              <dt>Sources</dt>
              <dd>{run.sources.length}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{duration || '-'}</dd>
            </div>
          </dl>
          {outcome && <div className="run-outcome" role={run.status === 'completed_with_warnings' ? 'status' : undefined}>
            <h3>{outcome.title}</h3><p>{outcome.hint}</p>
          </div>}
          <p className="report-actions">
            <a className="btn btn-primary" href={`#/runs/${encodeURIComponent(run.id)}/signals`}>Review collected posts</a>
            <a className="btn btn-secondary" href="#/">Change keywords</a>
            <a className="btn btn-secondary" href="#pipeline-tab-classifier" onClick={() => setSelectedAgent('classifier')}>Inspect classifier decisions</a>
            {run.signalCount > 0 && <>
              <a className="btn btn-secondary" href={`#/runs/${encodeURIComponent(run.id)}/themes`}>View themes</a>
              <a className="btn btn-secondary" href={`#/runs/${encodeURIComponent(run.id)}/report`}>View report</a>
            </>}
          </p>
        </section>
      )}

      <details className="run-diagnostics">
        <summary>Diagnostics</summary>
        <div className="stack">
          <PipelineProgress run={run} events={events} showStages={false} />
          <SourceActivity requests={requests} run={run} />
          <section className="card" aria-labelledby="log-title">
            <h2 id="log-title" className="card-title">Event log</h2>
            {events.length === 0 ? <p className="muted">No events yet.</p> : (
              <ol className="log" role="log" aria-live="polite" aria-label="Run events">
                {events.map((item) => <li key={item.id} className={`log-row log-${item.kind}`}>
                  <time dateTime={item.createdAt}>{formatClock(item.createdAt)}</time>
                  <span className="chip">{item.agent}</span>
                  <span className="log-kind">{EVENT_KIND_LABEL[item.kind]}</span>
                  <span className="log-message">{item.message}</span>
                </li>)}
              </ol>
            )}
          </section>
        </div>
      </details>

      <p>
        <a className="btn btn-secondary" href="#/">
          New search
        </a>
      </p>
    </div>
  );
}
