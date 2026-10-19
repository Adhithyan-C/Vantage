import { LEAD_LABELS } from '@vantage/shared';
import type { LeadLabel } from '@vantage/shared';

export type ConfusionMatrix = Record<LeadLabel, Record<LeadLabel, number>>;

export interface LabelStats {
  precision: number;
  recall: number;
  support: number;
}

export type PerLabelStats = Record<LeadLabel, LabelStats>;

export interface ClassificationPair {
  expected: LeadLabel;
  predicted: LeadLabel;
}

function emptyRow(): Record<LeadLabel, number> {
  return { buyer_intent: 0, competitor_complaint: 0, venting: 0, noise: 0 };
}

export function confusionMatrix(pairs: ClassificationPair[]): ConfusionMatrix {
  const matrix: ConfusionMatrix = {
    buyer_intent: emptyRow(),
    competitor_complaint: emptyRow(),
    venting: emptyRow(),
    noise: emptyRow(),
  };
  for (const pair of pairs) {
    matrix[pair.expected][pair.predicted] += 1;
  }
  return matrix;
}

export function perLabelStats(matrix: ConfusionMatrix): PerLabelStats {
  const stats = {} as PerLabelStats;
  for (const label of LEAD_LABELS) {
    const support = LEAD_LABELS.reduce((total, predicted) => total + matrix[label][predicted], 0);
    const predictedCount = LEAD_LABELS.reduce(
      (total, expected) => total + matrix[expected][label],
      0,
    );
    const correct = matrix[label][label];
    stats[label] = {
      precision: predictedCount === 0 ? 0 : correct / predictedCount,
      recall: support === 0 ? 0 : correct / support,
      support,
    };
  }
  return stats;
}

export function accuracy(pairs: ClassificationPair[]): number {
  if (pairs.length === 0) {
    return 0;
  }
  const correct = pairs.filter((pair) => pair.expected === pair.predicted).length;
  return correct / pairs.length;
}
