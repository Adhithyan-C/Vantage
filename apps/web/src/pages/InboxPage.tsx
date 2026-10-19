import { useCallback, useEffect, useState } from 'react';
import type { LeadView, RunView } from '@vantage/shared';
import { getLeads, getRun } from '../lib/api';
import { LABEL_TEXT, shortId } from '../lib/format';
import { countSignalGroups, filterSignals } from '../lib/inbox';
import type { LabelFilter, StatusFilter } from '../lib/inbox';
import { ErrorState } from '../components/ErrorState';
import { SignalCard } from '../components/SignalCard';

export function InboxPage({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunView | null>(null);
  const [signals, setSignals] = useState<LeadView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOtherSignals, setShowOtherSignals] = useState(false);
  const [label, setLabel] = useState<LabelFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [minScore, setMinScore] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextRun, nextSignals] = await Promise.all([getRun(runId), getLeads(runId)]);
      setRun(nextRun);
      setSignals(nextSignals);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return <div className="card" role="status">Loading signals…</div>;
  }
  if (error) {
    return <ErrorState title="Could not load signals" message={error} onRetry={() => void load()} />;
  }
  if (!run) {
    return <ErrorState title="Could not load this run" message="Run not found." onRetry={() => void load()} />;
  }
  if (signals.length === 0) {
    return <section className="stack"><a href={`#/runs/${encodeURIComponent(runId)}`}>Back to run</a><h1 className="page-title">{run.seller.productName}</h1><p className="muted">Run {shortId(run.id)}</p><p><a className="btn btn-secondary" href={`#/runs/${encodeURIComponent(run.id)}/report`}>View report</a></p><div className="card">No signals were scored for this run yet</div></section>;
  }

  const counts = countSignalGroups(signals);
  const parsedMinScore = minScore.trim() === '' ? null : Number(minScore);
  const visibleSignals = filterSignals(signals, {
    showOtherSignals,
    label,
    status,
    minScore: parsedMinScore !== null && Number.isFinite(parsedMinScore) ? parsedMinScore : null,
  });
  const defaultRankedCount = filterSignals(signals, {
    showOtherSignals: false, label: 'all', status: 'all', minScore: null,
  }).length;

  return (
    <div className="stack">
      <a href={`#/runs/${encodeURIComponent(runId)}`}>Back to run</a>
      <section className="card" aria-labelledby="inbox-title">
        <h1 className="page-title" id="inbox-title">{run.seller.productName}</h1>
        <p className="muted">Run {shortId(run.id)}</p>
        <p>{counts.buying} buying signals, {counts.other} other signals</p>
        <p><a className="btn btn-secondary" href={`#/runs/${encodeURIComponent(run.id)}/report`}>View report</a></p>
      </section>
      <section className="card filter-panel" aria-label="Signal filters">
        <div className="field-row">
          <label className="field"><span className="field-label">Label</span>
            <select className="control" value={label} onChange={(event) => setLabel(event.target.value as LabelFilter)}>
              <option value="all">All</option>
              <option value="buyer_intent">{LABEL_TEXT.buyer_intent}</option>
              <option value="competitor_complaint">{LABEL_TEXT.competitor_complaint}</option>
              <option value="venting">{LABEL_TEXT.venting}</option>
              <option value="noise">{LABEL_TEXT.noise}</option>
            </select>
          </label>
          <label className="field"><span className="field-label">Status</span>
            <select className="control" value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
              <option value="all">All</option><option value="new">New</option>
              <option value="accepted">Accepted</option><option value="rejected">Rejected</option>
            </select>
          </label>
          <label className="field"><span className="field-label">Minimum score (ranked signals)</span>
            <input className="control" type="number" min="0" max="100" value={minScore} onChange={(event) => setMinScore(event.target.value)} />
          </label>
        </div>
        <label className="toggle-row">
          <input type="checkbox" checked={showOtherSignals} onChange={(event) => setShowOtherSignals(event.target.checked)} />
          Show other signals (venting, noise)
        </label>
      </section>
      {visibleSignals.length === 0 && !showOtherSignals && counts.other > 0 && defaultRankedCount === 0 ? (
        <section className="card empty">
          <p className="empty-title">No buying signals in this run. {counts.other} other signals were classified as venting or noise.</p>
          <button className="btn btn-primary" type="button" onClick={() => setShowOtherSignals(true)}>Show other signals</button>
        </section>
      ) : visibleSignals.length === 0 ? (
        <div className="card">No signals match these filters.</div>
      ) : (
        <div className="stack">{visibleSignals.map((signal) => <SignalCard key={signal.leadId} signal={signal} runId={runId} />)}</div>
      )}
    </div>
  );
}
