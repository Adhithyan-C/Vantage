import { useCallback, useEffect, useState } from 'react';
import type { FeedbackAction, LeadDetail } from '@vantage/shared';
import { ApiError, getLeadDetail, sendFeedback } from '../lib/api';
import { formatAge, LABEL_TEXT, SOURCE_LABEL } from '../lib/format';
import { isRankedLabel } from '../lib/inbox';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { EvidenceQuote } from '../components/EvidenceQuote';
import { CriteriaChecklist } from '../components/CriteriaChecklist';
import { ScoreBreakdown } from '../components/ScoreBreakdown';
import { ReasoningTrace } from '../components/ReasoningTrace';

export function DiscardedQuotesNote({ count }: { count: number }) {
  if (count <= 0) return null;
  return <p className="muted">{count} {count === 1 ? 'quote' : 'quotes'} from the model could not be found in the post and were discarded.</p>;
}

export function SignalDetailPage({ runId, leadId }: { runId: string; leadId: string }) {
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      setDetail(await getLeadDetail(leadId));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { void load(); }, [load]);

  async function updateFeedback(action: FeedbackAction): Promise<void> {
    setPending(true);
    setFeedbackError(null);
    try {
      const result = await sendFeedback(leadId, action);
      setDetail((current) => current ? { ...current, lead: { ...current.lead, status: result.status } } : current);
    } catch (err) {
      setFeedbackError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  if (loading) return <div className="card" role="status">Loading signal…</div>;
  if (notFound) return <div className="stack"><a href={`#/runs/${encodeURIComponent(runId)}/signals`}>Back to inbox</a><EmptyState title="Signal not found" /></div>;
  if (error) return <ErrorState title="Could not load this signal" message={error} onRetry={() => void load()} />;
  if (!detail) return <EmptyState title="Signal not found" />;

  const { lead } = detail;
  const ranked = isRankedLabel(lead.label);
  return (
    <div className="stack">
      <a href={`#/runs/${encodeURIComponent(runId)}/signals`}>Back to inbox</a>
      <section className="card stack" aria-labelledby="signal-title">
        <div className="signal-card-top">
          <span className="badge">{LABEL_TEXT[lead.label]}</span>
          {lead.source === 'snapshot' && <span className="badge">Sample data</span>}
          {ranked ? <><span className="badge">Rank {lead.rank}</span><span className="badge">Score {lead.score}</span></> : <span className="badge">Not ranked</span>}
          <span className={`badge status-${lead.status}`}>{lead.status === 'new' ? 'New' : lead.status === 'accepted' ? 'Accepted' : 'Rejected'}</span>
        </div>
        <h1 className="page-title" id="signal-title">@{lead.authorHandle}</h1>
        <p className="muted">{SOURCE_LABEL[lead.source]}{lead.community ? ` · ${lead.community}` : ''} · {formatAge(lead.createdAtSource, Date.now())}</p>
        {lead.source === 'snapshot'
          ? <p>Sample post (not a real link)</p>
          : <p><a href={lead.url} target="_blank" rel="noopener noreferrer">Open original post</a></p>}
        {lead.source === 'snapshot' && <p className="muted">This is a synthetic sample post written for testing.</p>}
        <p className="muted">Vantage shows public posts only. It does not provide contact details or send messages.</p>
        <div className="feedback-actions" aria-label="Signal status actions">
          <button className="btn btn-primary" type="button" disabled={pending} onClick={() => void updateFeedback('accept')}>Accept</button>
          <button className="btn btn-secondary" type="button" disabled={pending} onClick={() => void updateFeedback('reject')}>Reject</button>
          <button className="btn btn-secondary" type="button" disabled={pending} onClick={() => void updateFeedback('reset')}>Reset</button>
        </div>
        {feedbackError && <ErrorState title="Could not update signal status" message={feedbackError} />}
      </section>
      <section className="card" aria-labelledby="post-title">
        <h2 className="card-title" id="post-title">Post text</h2>
        <EvidenceQuote text={detail.text} spans={detail.evidence} />
      </section>
      <section className="card summary-card">
        <h2 className="card-title">Summary (written by the model)</h2>
        <p>{lead.rationale}</p>
        <DiscardedQuotesNote count={detail.discardedQuotes} />
      </section>
      <section className="card"><h2 className="card-title">Criteria checklist</h2><CriteriaChecklist criteria={lead.criteria} /></section>
      <section className="card"><h2 className="card-title">Score breakdown</h2><ScoreBreakdown lead={lead} /></section>
      <section className="card">
        <h2 className="card-title">Signal facts</h2>
        <dl className="facts-grid">
          <div><dt>Competitors mentioned</dt><dd>{lead.enrichment.competitorsMentioned.join(', ') || 'None'}</dd></div>
          <div><dt>Purchase terms found</dt><dd>{lead.enrichment.purchaseTermsFound.join(', ') || 'None'}</dd></div>
          <div><dt>Team terms found</dt><dd>{lead.enrichment.teamTermsFound.join(', ') || 'None'}</dd></div>
          <div><dt>Age in days</dt><dd>{lead.enrichment.ageDays}</dd></div>
          <div><dt>Comments</dt><dd>{lead.enrichment.commentCount}</dd></div>
          <div><dt>Upvotes</dt><dd>{lead.enrichment.upvotes}</dd></div>
        </dl>
      </section>
      <section className="card"><ReasoningTrace trace={detail.trace} /></section>
    </div>
  );
}
