import type { CriterionId } from '@vantage/shared';
export const RUBRIC: ReadonlyArray<{ id: CriterionId; description: string; weight: number }> = [
  { id: 'states_problem', description: 'The author describes a problem in their own words that the seller product addresses.', weight: 0.3 },
  { id: 'asks_for_recommendation', description: 'The author asks for a tool, alternative, or recommendation.', weight: 0.25 },
  { id: 'mentions_team_or_budget', description: 'The author mentions team size, company size, or budget.', weight: 0.15 },
  { id: 'shows_urgency', description: 'The author indicates they need a solution soon or are actively evaluating.', weight: 0.15 },
  { id: 'names_competitor', description: 'The author names a competitor product from the seller profile.', weight: 0.15 },
];
