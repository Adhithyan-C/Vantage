import type { RunView, SourceId, SourceRequestView } from '@vantage/shared';
import { SOURCE_LABEL } from '../lib/format';

interface SourceSummary {
  source: SourceId;
  ok: number;
  failed: number;
  total: number;
  items: number;
  duration: number;
  quota: number | null;
}

export function SourceActivity({
  requests,
  run,
}: {
  requests: SourceRequestView[];
  run: RunView;
}) {
  if (requests.length === 0) {
    return <section className="card" aria-labelledby="source-activity-title">
      <h2 className="card-title" id="source-activity-title">Source activity</h2>
      <p className="muted">No requests recorded for this run.</p>
    </section>;
  }

  const summaries = new Map<SourceId, SourceSummary>();
  for (const request of requests) {
    const current = summaries.get(request.source) ?? {
      source: request.source, ok: 0, failed: 0, total: 0, items: 0, duration: 0, quota: null,
    };
    if (request.status === 'ok') current.ok += 1;
    if (request.status === 'failed') current.failed += 1;
    current.total += 1;
    current.items += request.itemsReturned;
    current.duration += request.durationMs;
    if (request.quotaRemaining !== null) current.quota = request.quotaRemaining;
    summaries.set(request.source, current);
  }

  return <section className="card source-activity" aria-labelledby="source-activity-title">
    <h2 className="card-title" id="source-activity-title">Source activity</h2>
    <ul className="source-list">
      {[...summaries.values()].map((summary) => {
        const kept = run.status === 'running'
          ? undefined
          : run.sources.find((source) => source.source === summary.source)?.fetchedCount;
        return <li className="source-row" key={summary.source}>
          <strong className="source-name">{SOURCE_LABEL[summary.source]}</strong>
          <span>{summary.ok} requests ok / {summary.failed} failed</span>
          <span>{summary.items} items returned</span>
          <span>Average {Math.round(summary.duration / summary.total)} ms</span>
          {summary.quota !== null && <span>Quota remaining: {summary.quota}</span>}
          {kept !== undefined && <span>{kept} signals kept</span>}
        </li>;
      })}
    </ul>
    <details>
      <summary>Request log</summary>
      <ul className="request-log">
        {requests.map((request) => <li key={request.id}>
          <strong>{SOURCE_LABEL[request.source]}</strong> · {request.label} · {request.status === 'ok' ? 'OK' : request.status === 'failed' ? 'Failed' : 'Skipped'}
          {' · HTTP '}{request.httpStatus ?? '—'} · {request.durationMs} ms · {request.itemsReturned} items
          {request.outcome && <p>Outcome: {request.outcome}</p>}
          {request.request && <p>Request: <code>{request.request.endpoint}</code> {Object.entries(request.request.params).map(([key, value]) => `${key}=${value}`).join('&')}</p>}
          {request.responseSummary && <p>Response summary: <code>{JSON.stringify(request.responseSummary)}</code></p>}
          {request.error && <p className="source-error">{request.error}</p>}
        </li>)}
      </ul>
    </details>
  </section>;
}
