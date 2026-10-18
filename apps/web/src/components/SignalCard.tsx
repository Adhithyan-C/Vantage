import type { LeadView } from '@vantage/shared';
import { formatAge, LABEL_TEXT, SOURCE_LABEL } from '../lib/format';
import { isRankedLabel } from '../lib/inbox';

export function SignalCard({ signal, runId }: { signal: LeadView; runId: string }) {
  const ranked = isRankedLabel(signal.label);
  return (
    <article className={`card signal-card${signal.status === 'rejected' ? ' signal-rejected' : ''}`}>
      <div className="signal-card-top">
        <span className="badge">Rank {signal.rank}</span>
        <span className="badge">{LABEL_TEXT[signal.label]}</span>
        {ranked ? <span className="badge">Score {signal.score}</span> : <span className="badge">Not ranked</span>}
        {signal.status === 'rejected' && <span className="badge status-rejected">Rejected</span>}
        {signal.status === 'accepted' && <span className="badge status-accepted">Accepted</span>}
      </div>
      <p className="muted signal-meta">
        {signal.confidence !== null && `Evidence check: ${Math.round(signal.confidence * 100)}% · `}
        {SOURCE_LABEL[signal.source]}{signal.community ? ` · ${signal.community}` : ''} · @{signal.authorHandle} · {formatAge(signal.createdAtSource, Date.now())}
      </p>
      <p>{signal.rationale}</p>
      <div className="signal-links">
        <a href={signal.url} target="_blank" rel="noopener noreferrer">Open original post</a>
        <a href={`#/runs/${encodeURIComponent(runId)}/signals/${encodeURIComponent(signal.leadId)}`}>View signal details</a>
      </div>
    </article>
  );
}
