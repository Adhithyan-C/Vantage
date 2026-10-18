import { CRITERION_IDS } from '@vantage/shared';
import type { CriterionId, LeadView } from '@vantage/shared';

const CRITERION_TEXT: Record<CriterionId, string> = {
  states_problem: 'States a problem',
  asks_for_recommendation: 'Asks for a recommendation',
  mentions_team_or_budget: 'Mentions team or budget',
  shows_urgency: 'Shows urgency',
  names_competitor: 'Names a competitor',
};

export function CriteriaChecklist({ criteria }: { criteria: LeadView['criteria'] }) {
  return (
    <ul className="criteria-list">
      {CRITERION_IDS.map((id) => {
        const criterion = criteria.find((item) => item.id === id);
        return (
          <li key={id}>
            <strong>{CRITERION_TEXT[id]}</strong> — {criterion?.passed ? 'Passed' : 'Not passed'}
            {criterion?.passed && criterion.quote && <blockquote>{criterion.quote}</blockquote>}
          </li>
        );
      })}
    </ul>
  );
}
