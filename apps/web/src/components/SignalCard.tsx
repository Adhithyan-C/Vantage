import type { LeadView } from '@vantage/shared';
import { formatAge, LABEL_TEXT, SOURCE_LABEL } from '../lib/format';
import { isRankedLabel } from '../lib/inbox';
import { ScoreMeter } from './ScoreMeter';

export function SignalCard({ signal, runId, animationIndex = 0 }: { signal: LeadView; runId: string; animationIndex?: number }) {
  const ranked = isRankedLabel(signal.label);
  return (
    <article className={`card signal-card${signal.status === 'rejected' ? ' signal-rejected' : ''}`} style={{ animationDelay: `${Math.min(animationIndex, 9) * 20}ms` }}>
      <div className="signal-card-top">
        {ranked && <span className="badge">Rank {signal.rank}</span>}
        <span className={`badge label-${signal.label}`}>{LABEL_TEXT[signal.label]}</span>
        {signal.source === 'snapshot' && <span className="badge">Sample data</span>}
        {ranked ? <ScoreMeter score={signal.score} /> : <span className="badge">Not ranked</span>}
        {signal.status === 'rejected' && <span className="badge status-rejected">Rejected</span>}
        {signal.status === 'accepted' && <span className="badge status-accepted">Accepted</span>}
      </div>
      <p className="signal-meta">
        {signal.confidence === 1
          ? 'Quotes verified · '
          : signal.confidence !== null && signal.confidence < 1
            ? 'Some quotes could not be verified · '
            : ''}
        {SOURCE_LABEL[signal.source]}{signal.community ? ` · ${signal.community}` : ''} · @{signal.authorHandle} · {formatAge(signal.createdAtSource, Date.now())}
      </p>
      <p>{signal.rationale}</p>
      <div className="signal-links">
        {signal.source === 'snapshot'
          ? <span>Sample post (not a real link)</span>
          : <a href={signal.url} target="_blank" rel="noopener noreferrer">Open original post</a>}
        <a className="why-link" href={`#/runs/${encodeURIComponent(runId)}/signals/${encodeURIComponent(signal.leadId)}`}>Why this signal?</a>
      </div>
    </article>
  );
}
