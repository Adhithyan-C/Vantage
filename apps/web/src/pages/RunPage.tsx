import { useEffect, useState } from 'react';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { PipelineProgress, RunStatusBadge } from '../components/PipelineProgress';
import { SourceActivity } from '../components/SourceActivity';
import { useRunEvents } from '../hooks/useRunEvents';
import { EVENT_KIND_LABEL, formatClock, formatDuration, shortId } from '../lib/format';
import { LoadingState } from '../components/LoadingState';

export function RunPage({ runId }: { runId: string }) {
  const { run, events, requests, error, retry } = useRunEvents(runId);
  const [now, setNow] = useState<number>(() => Date.now());
  const running = run?.status === 'running';

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

  if (!run) {
    if (error) {
      return <ErrorState title="Could not load this run" message={error} onRetry={retry} />;
    }
    return (
      <LoadingState label="Loading run" />
    );
  }

  const duration = formatDuration(run.startedAt, run.finishedAt, now);

  return (
    <div className="stack">
      <section className="card" aria-labelledby="run-title">
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
      </section>

      {error && <ErrorState title="Connection problem" message={error} onRetry={retry} />}

      <PipelineProgress run={run} events={events} />
      <SourceActivity requests={requests} run={run} />

      {run.status !== 'running' && (
        <section className="card" aria-labelledby="result-title">
          <h2 id="result-title" className="card-title">
            Result
          </h2>
          <dl className="stats">
            <div>
              <dt>Signals found</dt>
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
          {run.signalCount === 0 ? (
            <EmptyState
              title="No signals found"
              hint="Try different keywords or a longer time window."
              action={{ label: 'Start a new search', href: '#/' }}
            />
          ) : (
            <p className="report-actions">
              <a className="btn btn-primary" href={`#/runs/${encodeURIComponent(run.id)}/signals`}>View signals</a>
              <a className="btn btn-secondary" href={`#/runs/${encodeURIComponent(run.id)}/report`}>View report</a>
            </p>
          )}
        </section>
      )}

      <section className="card" aria-labelledby="log-title">
        <h2 id="log-title" className="card-title">
          Event log
        </h2>
        {events.length === 0 ? (
          <p className="muted">No events yet.</p>
        ) : (
          <ol className="log" role="log" aria-live="polite" aria-label="Run events">
            {events.map((item) => (
              <li key={item.id} className={`log-row log-${item.kind}`}>
                <time dateTime={item.createdAt}>{formatClock(item.createdAt)}</time>
                <span className="chip">{item.agent}</span>
                <span className="log-kind">{EVENT_KIND_LABEL[item.kind]}</span>
                <span className="log-message">{item.message}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <p>
        <a className="btn btn-secondary" href="#/">
          New search
        </a>
      </p>
    </div>
  );
}
