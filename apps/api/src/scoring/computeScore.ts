import type { CriterionId, Enrichment, LeadLabel, ScoreBreakdown } from '@vantage/shared';

export interface ScoreWeights {
  intent: number;
  fit: number;
  recency: number;
  engagement: number;
}

export interface ScoreRubricCriterion {
  id: CriterionId;
  weight: number;
}

export interface ComputeScoreInput {
  passedCriteria: CriterionId[];
  enrichment: Enrichment;
  rubric: ReadonlyArray<ScoreRubricCriterion>;
  weights: ScoreWeights;
  halfLifeDays: number;
  engagementCap: number;
}

export function computeScore({
  passedCriteria,
  enrichment,
  rubric,
  weights,
  halfLifeDays,
  engagementCap,
}: ComputeScoreInput): ScoreBreakdown {
  const passed = new Set(passedCriteria);
  const totalRubricWeight = rubric.reduce((sum, criterion) => sum + criterion.weight, 0);
  const passedWeight = rubric.reduce(
    (sum, criterion) => sum + (passed.has(criterion.id) ? criterion.weight : 0),
    0,
  );
  const intent = totalRubricWeight === 0 ? 0 : passedWeight / totalRubricWeight;
  const fit = Object.values(enrichment.fit).filter(Boolean).length / 3;
  const recency = 0.5 ** (enrichment.ageDays / halfLifeDays);
  const engagement = Math.min(
    1,
    Math.log(1 + enrichment.commentCount + enrichment.upvotes / 5) /
      Math.log(1 + engagementCap),
  );
  const values = { intent, fit, recency, engagement };
  const components = (Object.keys(values) as Array<keyof typeof values>).map((name) => {
    const value = values[name];
    const weight = weights[name];
    return {
      name,
      value,
      weight,
      contribution: Math.round(100 * weight * value * 100) / 100,
    };
  });
  const weightedTotal = components.reduce((sum, component) => sum + component.weight * component.value, 0);
  const total = Math.min(100, Math.max(0, Math.round(100 * weightedTotal)));
  return { components, total };
}

export function computeConfidence(passedCount: number, unverifiedCount: number): number | null {
  const total = passedCount + unverifiedCount;
  return total === 0 ? null : passedCount / total;
}

export interface RankableLead {
  label: LeadLabel;
  score: number;
  createdAtSource: string;
  signalId: string;
}

const LABEL_TIER: Record<LeadLabel, number> = {
  buyer_intent: 0,
  competitor_complaint: 1,
  venting: 2,
  noise: 3,
};

export function rankLeads<T extends RankableLead>(items: T[]): Array<T & { rank: number }> {
  return [...items]
    .sort((left, right) =>
      LABEL_TIER[left.label] - LABEL_TIER[right.label] ||
      right.score - left.score ||
      Date.parse(right.createdAtSource) - Date.parse(left.createdAtSource) ||
      left.signalId.localeCompare(right.signalId),
    )
    .map((item, index) => ({ ...item, rank: index + 1 }));
}
