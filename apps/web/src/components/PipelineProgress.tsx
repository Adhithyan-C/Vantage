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
  { id: 'displacement', name: 'Displacement', description: 'Group competitor complaints', built: false },
  { id: 'classifier', name: 'Classifier', description: 'Label buying intent with evidence', built: true },
  { id: 'enricher', name: 'Enricher', description: 'Add structured context', built: false },
  { id: 'scorer', name: 'Scorer', description: 'Compute the score from the evidence', built: false },
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

export function PipelineProgress({ run, events }: { run: RunView; events: RunEvent[] }) {
  const summary = scoutSummary(events);
  const classifierInfo = classifierSummary(events);
  const classifierBadge = classifierStatus(run, events);

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
              {stage.id === 'classifier' && classifierInfo && (
                <p className="stage-summary">{classifierInfo}</p>
              )}
            </div>
            {stage.id === 'classifier' ? (
              <span className="badge badge-planned">{classifierBadge}</span>
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
