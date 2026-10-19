import { describe, expect, it } from 'vitest';
import type { ClassificationPair } from '../src/evaluation/metrics';
import { accuracy, confusionMatrix, perLabelStats } from '../src/evaluation/metrics';

const pairs: ClassificationPair[] = [
  { expected: 'buyer_intent', predicted: 'buyer_intent' },
  { expected: 'buyer_intent', predicted: 'buyer_intent' },
  { expected: 'buyer_intent', predicted: 'competitor_complaint' },
  { expected: 'competitor_complaint', predicted: 'competitor_complaint' },
  { expected: 'competitor_complaint', predicted: 'venting' },
  { expected: 'venting', predicted: 'venting' },
  { expected: 'venting', predicted: 'noise' },
  { expected: 'noise', predicted: 'noise' },
];

describe('sample evaluation metrics', () => {
  it('computes the exact four-label confusion matrix, per-label statistics, and accuracy', () => {
    const matrix = confusionMatrix(pairs);
    expect(matrix).toEqual({
      buyer_intent: { buyer_intent: 2, competitor_complaint: 1, venting: 0, noise: 0 },
      competitor_complaint: { buyer_intent: 0, competitor_complaint: 1, venting: 1, noise: 0 },
      venting: { buyer_intent: 0, competitor_complaint: 0, venting: 1, noise: 1 },
      noise: { buyer_intent: 0, competitor_complaint: 0, venting: 0, noise: 1 },
    });
    expect(perLabelStats(matrix)).toEqual({
      buyer_intent: { precision: 1, recall: 2 / 3, support: 3 },
      competitor_complaint: { precision: 0.5, recall: 0.5, support: 2 },
      venting: { precision: 0.5, recall: 0.5, support: 2 },
      noise: { precision: 0.5, recall: 1, support: 1 },
    });
    expect(accuracy(pairs)).toBe(5 / 8);
  });

  it('returns zero precision when a label has no predictions and never produces NaN', () => {
    const stats = perLabelStats(confusionMatrix([
      { expected: 'competitor_complaint', predicted: 'venting' },
    ]));
    expect(stats.competitor_complaint).toEqual({ precision: 0, recall: 0, support: 1 });
    expect(Object.values(stats).every((entry) =>
      Number.isFinite(entry.precision) && Number.isFinite(entry.recall),
    )).toBe(true);
  });

  it('returns zero accuracy for empty input and zero stats for an empty matrix', () => {
    const matrix = confusionMatrix([]);
    expect(accuracy([])).toBe(0);
    expect(perLabelStats(matrix)).toEqual({
      buyer_intent: { precision: 0, recall: 0, support: 0 },
      competitor_complaint: { precision: 0, recall: 0, support: 0 },
      venting: { precision: 0, recall: 0, support: 0 },
      noise: { precision: 0, recall: 0, support: 0 },
    });
  });
});
