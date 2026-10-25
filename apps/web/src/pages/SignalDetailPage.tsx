import { useCallback, useEffect, useState } from 'react';
import type { CriterionId, DecisionTrace, FeedbackAction, LeadDetail, SignalJourney } from '@vantage/shared';
import { ApiError, getLeadDetail, getSignalJourney, sendFeedback } from '../lib/api';
import { formatAge, LABEL_TEXT, SOURCE_LABEL } from '../lib/format';
import { isRankedLabel } from '../lib/inbox';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { EvidenceQuote } from '../components/EvidenceQuote';
import { CriteriaChecklist } from '../components/CriteriaChecklist';
import { ScoreBreakdown } from '../components/ScoreBreakdown';
import { ReasoningTrace } from '../components/ReasoningTrace';
import { LoadingState } from '../components/LoadingState';
import { ScoreMeter } from '../components/ScoreMeter';
import { SignalJourneyTimeline } from '../components/SignalJourneyTimeline';

const CRITERION_LABEL: Record<CriterionId, string> = {
  states_problem: 'States a problem',
  asks_for_recommendation: 'Asks for a recommendation',
  mentions_team_or_budget: 'Mentions team or budget',
  shows_urgency: 'Shows urgency',
  names_competitor: 'Names a competitor',
};

export function CriticTrustReview({ trace }: { trace: DecisionTrace | null | undefined }) {
  if (!trace) return null;
  const verdict = trace.output.verdict;
  if (trace.status !== 'ok' || (verdict !== 'supported' && verdict !== 'weak' && verdict !== 'unsupported')) {
    return <span className="badge">Trust review unavailable</span>;
  }
  const issues = Array.isArray(trace.output.issues)
    ? trace.output.issues.filter((issue): issue is string => typeof issue === 'string')
    : [];
  return (
    <div className="critic-trust-review">
      <span className={`badge critic-${verdict}`}>Trust review: {verdict}</span>
      {(verdict === 'weak' || verdict === 'unsupported') && issues.length > 0 && (
        <details>
          <summary>Review issues</summary>
          <ul>{issues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

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
  const [journey, setJourney] = useState<SignalJourney | null>(null);
  const [journeyError, setJourneyError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const result = await getLeadDetail(leadId);
      setDetail(result);
      try {
        setJourney(await getSignalJourney(runId, result.lead.signalId));
        setJourneyError(null);
      } catch (err) {
        setJourneyError(err instanceof Error ? err.message : String(err));
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        try {
          setJourney(await getSignalJourney(runId, leadId));
          setJourneyError(null);
        } catch (journeyErr) {
          setNotFound(true);
          setJourneyError(journeyErr instanceof Error ? journeyErr.message : String(journeyErr));
        }
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setLoading(false);
    }
  }, [leadId, runId]);

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

  if (loading) return <LoadingState label="Loading signal" />;
  if (!detail && journey) return <div className="stack">
    <a className="back-link" href={`#/runs/${encodeURIComponent(runId)}`}>Back to run</a>
    <section className="card stack"><p className="eyebrow">COLLECTED POST</p><h1 className="page-title">@{journey.authorHandle}</h1><p className="muted">{journey.source} · {journey.createdAtSource}</p><p><a href={journey.url} target="_blank" rel="noopener noreferrer">Open original post</a></p></section>
    <SignalJourneyTimeline journey={journey} />
  </div>;
  if (notFound) return <div className="stack"><a className="back-link" href={`#/runs/${encodeURIComponent(runId)}/signals`}>Back to inbox</a><EmptyState title="Signal not found" hint="This signal may have been removed from the run." action={{ label: 'Return to inbox', href: `#/runs/${encodeURIComponent(runId)}/signals` }} /></div>;
  if (error) return <ErrorState title="Could not load this signal" message={error} onRetry={() => void load()} />;
  if (!detail) return <EmptyState title="Signal not found" hint="Return to the inbox to choose another signal." action={{ label: 'Return to inbox', href: `#/runs/${encodeURIComponent(runId)}/signals` }} />;

  const { lead } = detail;
  const ranked = isRankedLabel(lead.label);
  return (
    <div className="stack">
      <a className="back-link" href={`#/runs/${encodeURIComponent(runId)}/signals`}>Back to inbox</a>
      <section className="card stack" aria-labelledby="signal-title">
        <div className="signal-card-top">
          <span className={`badge label-${lead.label}`}>{LABEL_TEXT[lead.label]}</span>
          {lead.source === 'snapshot' && <span className="badge">Sample data</span>}
          {ranked ? <><span className="badge">Rank {lead.rank}</span><ScoreMeter score={lead.score} /></> : <span className="badge">Not ranked</span>}
          <span className={`badge status-${lead.status}`}>{lead.status === 'new' ? 'New' : lead.status === 'accepted' ? 'Accepted' : 'Rejected'}</span>
          <CriticTrustReview trace={detail.criticTrace} />
        </div>
        <h1 className="page-title" id="signal-title">@{lead.authorHandle}</h1>
        <p className="signal-meta">{SOURCE_LABEL[lead.source]}{lead.community ? ` · ${lead.community}` : ''} · <span className="mono">{formatAge(lead.createdAtSource, Date.now())}</span></p>
        <div className="detail-why-links">
          <a className="why-link" href="#classification-why">Why this label?</a>
          {ranked && <a className="why-link" href="#score-why">Why this score?</a>}
        </div>
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
      {journey && <SignalJourneyTimeline journey={journey} />}
      {journeyError && <section className="card"><ErrorState title="Signal journey unavailable" message={journeyError} /></section>}
      <section className="card reasoning-block" id="classification-why" aria-labelledby="reasoning-title">
        <p className="eyebrow">CLASSIFIER EXPLANATION</p>
        <h2 className="card-title" id="reasoning-title">Reasoning</h2>
        <p>{lead.rationale}</p>
        <h3 className="card-subtitle">Evidence quotes</h3>
        {lead.criteria.some((criterion) => criterion.passed && criterion.quote) ? (
          <ul className="evidence-links">
            {lead.criteria.filter((criterion) => criterion.passed && criterion.quote).map((criterion) => (
              <li key={criterion.id}>
                <span className="evidence-criterion">{CRITERION_LABEL[criterion.id]}</span>
                {lead.source === 'snapshot'
                  ? <blockquote>“{criterion.quote}”</blockquote>
                  : <a href={lead.url} target="_blank" rel="noopener noreferrer"><blockquote>“{criterion.quote}”</blockquote></a>}
              </li>
            ))}
          </ul>
        ) : <p className="muted">No evidence quotes were verified for this signal.</p>}
        <DiscardedQuotesNote count={detail.discardedQuotes} />
      </section>
      <section className="card"><h2 className="card-title">Classification criteria</h2><CriteriaChecklist criteria={lead.criteria} /></section>
      <section className="card" id="score-why"><p className="eyebrow">DETERMINISTIC SCORE</p><h2 className="card-title">Why this score?</h2><ScoreBreakdown lead={lead} /></section>
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
