import type { RunEvent, RunStatus, RunView } from '@vantage/shared';
import { RUN_STATUS_LABEL, SOURCE_LABEL } from '../lib/format';
import { SourceHealthBadge } from './SourceHealthBadge';

interface Stage {
  id: string;
  name: string;
  description: string;
  built: boolean;
}

const STAGES: Stage[] = [
  { id: 'scout', name: 'Scout', description: 'Fetch, remove duplicates, store signals', built: true },
  { id: 'displacement', name: 'Displacement', description: 'Group competitor complaints', built: true },
  { id: 'classifier', name: 'Classifier', description: 'Label buying intent with evidence', built: true },
  { id: 'enricher', name: 'Enricher', description: 'Add structured context', built: true },
  { id: 'scorer', name: 'Scorer', description: 'Compute the score from the evidence', built: true },
];

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <span className={`badge badge-run-${status}`}>
      <span className="badge-dot" aria-hidden="true" />
      {RUN_STATUS_LABEL[status]}
    </span>
  );
}

function lastCount(events: RunEvent[], key: string): number | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const value = events[index]?.counts?.[key];
    if (typeof value === 'number') {
      return value;
    }
  }
  return null;
}

function scoutSummary(events: RunEvent[]): string {
  const fetched = lastCount(events, 'fetched');
  const unique = lastCount(events, 'afterDedupe');
  const inserted = lastCount(events, 'inserted');
  const updated = lastCount(events, 'updated');
  const parts: string[] = [];
  if (fetched !== null) {
    parts.push(`${fetched} fetched`);
  }
  if (unique !== null) {
    parts.push(`${unique} unique`);
  }
  if (inserted !== null && updated !== null) {
    parts.push(`${inserted} new, ${updated} refreshed`);
  }
  return parts.join(' · ');
}

export function scoutStatus(run: RunView, events: RunEvent[]): string {
  const hasResult = events.some(
    (event) => event.agent === 'scout' && typeof event.counts?.afterDedupe === 'number',
  );
  const allFailed = run.sources.length > 0 && run.sources.every((source) => source.status === 'failed');
  if (allFailed) {
    return 'Failed';
  }
  const hasWarningSource = run.sources.some(
    (source) => source.status === 'degraded' || source.status === 'failed' || source.status === 'skipped',
  );
  if (run.status === 'running' && !hasResult) {
    return 'Running';
  }
  if (hasWarningSource) {
    return 'Completed with warnings';
  }
  if (hasResult || run.status !== 'running') {
    return run.status === 'failed' ? 'Failed' : 'Completed';
  }
  return 'Running';
}

function classifierStatus(run: RunView, events: RunEvent[]): string {
  const classifierEvents = events.filter((event) => event.agent === 'classifier');
  if (classifierEvents.length === 0) {
    return run.status === 'running' ? 'Waiting' : 'Skipped';
  }
  const completed = classifierEvents.some(
    (event) => event.kind === 'info' && event.message.startsWith('Classified '),
  );
  if (!completed) {
    return 'Running';
  }
  return classifierEvents.some((event) => event.kind === 'warning' || event.kind === 'error')
    ? 'Completed with warnings'
    : 'Completed';
}

function classifierSummary(events: RunEvent[]): string {
  const finalEvent = [...events]
    .reverse()
    .find((event) => event.agent === 'classifier' && event.kind === 'info' && event.message.startsWith('Classified '));
  if (!finalEvent?.counts) {
    return '';
  }
  const count = (key: string) => {
    const value = finalEvent.counts?.[key];
    return typeof value === 'number' ? value : 0;
  };
  return `${count('buyer_intent')} buyer intent · ${count('competitor_complaint')} competitor complaint · ${count('venting')} venting · ${count('noise')} noise`;
}

export function agentStageStatus(
  agent: 'enricher' | 'scorer',
  finalPrefix: 'Enriched ' | 'Scored ',
  run: RunView,
  events: RunEvent[],
): string {
  const stageEvents = events.filter((event) => event.agent === agent);
  if (stageEvents.length === 0) {
    return run.status === 'running' ? 'Waiting' : 'Skipped';
  }
  const hasFinalInfo = stageEvents.some(
    (event) => event.kind === 'info' && event.message.startsWith(finalPrefix),
  );
  if (!hasFinalInfo) {
    return 'Running';
  }
  return stageEvents.some((event) => event.kind === 'warning' || event.kind === 'error')
    ? 'Completed with warnings'
    : 'Completed';
}

export function agentSummary(events: RunEvent[], agent: 'enricher' | 'scorer'): string {
  const prefix = agent === 'enricher' ? 'Enriched ' : 'Scored ';
  const finalEvent = [...events]
    .reverse()
    .find((event) => event.agent === agent && event.kind === 'info' && event.message.startsWith(prefix));
  if (!finalEvent?.counts) {
    return '';
  }
  const count = (key: string) => {
    const value = finalEvent.counts?.[key];
    return typeof value === 'number' ? value : 0;
  };
  return agent === 'enricher'
    ? `${count('enriched')} enriched`
    : `${count('scored')} scored · ${count('ranked')} in the ranked list`;
}

export function displacementStatus(run: RunView, events: RunEvent[]): string {
  const stageEvents = events.filter((event) => event.agent === 'displacement');
  if (stageEvents.length === 0) return run.status === 'running' ? 'Waiting' : 'Skipped';
  const final = [...stageEvents].reverse().find((event) =>
    event.message.startsWith('Found ') || event.message.startsWith('No competitor') || event.message.startsWith('Displacement failed'),
  );
  if (!final) return 'Running';
  if (final.message.startsWith('Displacement failed')) return 'Failed';
  return stageEvents.some((event) => event.kind === 'warning' || event.kind === 'error')
    ? 'Completed with warnings' : 'Completed';
}

export function displacementSummary(events: RunEvent[]): string {
  const finalInfo = [...events].reverse().find((event) => event.agent === 'displacement' && event.kind === 'info' &&
    (event.message.startsWith('Found ') || event.message.startsWith('No competitor')));
  if (!finalInfo) return '';
  if (finalInfo.message.startsWith('No competitor')) return 'no complaints';
  const count = finalInfo.counts?.themeCount;
  return `${typeof count === 'number' ? count : 0} themes`;
}

export function PipelineProgress({ run, events }: { run: RunView; events: RunEvent[] }) {
  const summary = scoutSummary(events);
  const scoutBadge = scoutStatus(run, events);
  const classifierInfo = classifierSummary(events);
  const classifierBadge = classifierStatus(run, events);
  const enricherInfo = agentSummary(events, 'enricher');
  const enricherBadge = agentStageStatus('enricher', 'Enriched ', run, events);
  const scorerInfo = agentSummary(events, 'scorer');
  const scorerBadge = agentStageStatus('scorer', 'Scored ', run, events);
  const displacementBadge = displacementStatus(run, events);
  const displacementInfo = displacementSummary(events);

  return (
    <section className="card" aria-labelledby="pipeline-title">
      <h2 id="pipeline-title" className="card-title">
        Pipeline
      </h2>
      <ol className="stage-list">
        {STAGES.map((stage) => (
          <li key={stage.id} className={stage.built ? 'stage' : 'stage stage-planned'}>
            <div>
              <p className="stage-name">{stage.name}</p>
              <p className="muted">{stage.description}</p>
              {stage.id === 'scout' && summary && <p className="stage-summary">{summary}</p>}
              {stage.id === 'displacement' && displacementInfo && <p className="stage-summary">{displacementInfo}</p>}
              {stage.id === 'classifier' && classifierInfo && (
                <p className="stage-summary">{classifierInfo}</p>
              )}
              {stage.id === 'enricher' && enricherInfo && (
                <p className="stage-summary">{enricherInfo}</p>
              )}
              {stage.id === 'scorer' && scorerInfo && (
                <p className="stage-summary">{scorerInfo}</p>
              )}
            </div>
            {stage.id === 'scout' ? (
              <span className="badge badge-planned">{scoutBadge}</span>
            ) : stage.id === 'classifier' ? (
              <span className="badge badge-planned">{classifierBadge}</span>
            ) : stage.id === 'displacement' ? (
              <span className="badge badge-planned">{displacementBadge}</span>
            ) : stage.id === 'enricher' ? (
              <span className="badge badge-planned">{enricherBadge}</span>
            ) : stage.id === 'scorer' ? (
              <span className="badge badge-planned">{scorerBadge}</span>
            ) : stage.built ? (
              <RunStatusBadge status={run.status} />
            ) : (
              <span className="badge badge-planned">Planned</span>
            )}
          </li>
        ))}
      </ol>

      <h3 className="card-subtitle">Sources</h3>
      {run.sources.length === 0 ? (
        <p className="muted">Waiting for the first source to report.</p>
      ) : (
        <ul className="source-list">
          {run.sources.map((source) => (
            <li key={source.source} className="source-row">
              <span className="source-name">{SOURCE_LABEL[source.source]}</span>
              <SourceHealthBadge status={source.status} />
              <span className="muted">{source.fetchedCount} fetched</span>
              {source.error && <span className="source-error">{source.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
