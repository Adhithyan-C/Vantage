import type { EvidenceSpan } from '@vantage/shared';
import { segmentText } from '../lib/evidence';

const CRITERION_TEXT: Record<EvidenceSpan['criterion'], string> = {
  states_problem: 'States a problem',
  asks_for_recommendation: 'Asks for a recommendation',
  mentions_team_or_budget: 'Mentions team or budget',
  shows_urgency: 'Shows urgency',
  names_competitor: 'Names a competitor',
};

export function EvidenceQuote({ text, spans }: { text: string; spans: EvidenceSpan[] }) {
  return (
    <p className="post-text">
      {segmentText(text, spans).map((segment, index) => {
        if (!segment.highlighted || !segment.criterion) {
          return <span key={`${index}-${segment.text}`}>{segment.text}</span>;
        }
        const name = CRITERION_TEXT[segment.criterion];
        return <mark key={`${index}-${segment.text}`} title={name} aria-label={name}>{segment.text}</mark>;
      })}
    </p>
  );
}
