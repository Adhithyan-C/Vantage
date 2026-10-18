import { describe, expect, it } from 'vitest';
import type { Enrichment } from '@vantage/shared';
import { ENGAGEMENT_CAP, RECENCY_HALF_LIFE_DAYS, SCORE_WEIGHTS } from '../src/config/scoring';
import { RUBRIC } from '../src/config/rubric';
import { computeConfidence, computeScore, rankLeads } from '../src/scoring/computeScore';

function enrichment(overrides: Partial<Enrichment> = {}): Enrichment {
  return {
    ageDays: 0,
    commentCount: 0,
    upvotes: 0,
    source: 'hackernews',
    community: null,
    competitorsMentioned: [],
    purchaseTermsFound: [],
    teamTermsFound: [],
    fit: { competitorMentioned: false, purchaseLanguage: false, teamOrRoleContext: false },
    ...overrides,
  };
}

function score(passedCriteria: Array<(typeof RUBRIC)[number]['id']>, values: Enrichment) {
  return computeScore({
    passedCriteria,
    enrichment: values,
    rubric: RUBRIC,
    weights: SCORE_WEIGHTS,
    halfLifeDays: RECENCY_HALF_LIFE_DAYS,
    engagementCap: ENGAGEMENT_CAP,
  });
}

describe('computeScore', () => {
  it('matches golden case A and orders the components with configured weights', () => {
    const result = score(
      ['states_problem', 'asks_for_recommendation', 'names_competitor'],
      enrichment({
        ageDays: 30,
        commentCount: 3,
        upvotes: 7,
        fit: { competitorMentioned: true, purchaseLanguage: true, teamOrRoleContext: false },
      }),
    );
    expect(result.components.map((component) => component.name)).toEqual([
      'intent', 'fit', 'recency', 'engagement',
    ]);
    expect(result.components.map((component) => component.weight)).toEqual([
      SCORE_WEIGHTS.intent, SCORE_WEIGHTS.fit, SCORE_WEIGHTS.recency, SCORE_WEIGHTS.engagement,
    ]);
    expect(result.components[0]?.value).toBeCloseTo(0.7, 2);
    expect(result.components[1]?.value).toBeCloseTo(2 / 3, 2);
    expect(result.components[2]?.value).toBeCloseTo(0.5, 2);
    expect(result.components[3]?.value).toBeCloseTo(Math.log(5.4) / Math.log(41), 4);
    expect(result.components[0]?.contribution).toBeCloseTo(28, 2);
    expect(result.components[1]?.contribution).toBeCloseTo(16.67, 2);
    expect(result.components[2]?.contribution).toBeCloseTo(10, 2);
    expect(result.components[3]?.contribution).toBeCloseTo(6.81, 2);
    expect(result.total).toBe(61);
  });

  it('matches golden case B and computes total from unrounded component values', () => {
    const result = score([], enrichment());
    expect(result.components.map((component) => component.contribution)).toEqual([0, 0, 20, 0]);
    expect(result.total).toBe(20);
    expect(result.total).toBe(Math.round(100 * result.components.reduce(
      (sum, component) => sum + component.weight * component.value,
      0,
    )));
  });

  it('caps engagement and matches golden cases C and D', () => {
    const highEngagement = score([], enrichment({ commentCount: 100 }));
    expect(highEngagement.components[3]?.value).toBe(1);
    expect(highEngagement.components[3]?.contribution).toBe(15);
    const older = score([], enrichment({ ageDays: 60 }));
    expect(older.components[2]?.value).toBe(0.25);
  });

  it('clamps total to the supported score range', () => {
    const overWeighted = computeScore({
      passedCriteria: ['states_problem', 'asks_for_recommendation', 'mentions_team_or_budget', 'shows_urgency', 'names_competitor'],
      enrichment: enrichment({
        commentCount: 100,
        fit: { competitorMentioned: true, purchaseLanguage: true, teamOrRoleContext: true },
      }),
      rubric: RUBRIC,
      weights: { intent: 0.6, fit: 0.4, recency: 0.2, engagement: 0.1 },
      halfLifeDays: RECENCY_HALF_LIFE_DAYS,
      engagementCap: ENGAGEMENT_CAP,
    });
    expect(overWeighted.total).toBe(100);
  });
});

describe('computeConfidence', () => {
  it('returns the passed share, or null when there is no evidence', () => {
    expect(computeConfidence(2, 1)).toBeCloseTo(0.6667, 4);
    expect(computeConfidence(0, 0)).toBeNull();
    expect(computeConfidence(3, 0)).toBe(1);
  });
});

describe('rankLeads', () => {
  it('sorts by label tier before score and assigns ranks from one', () => {
    const ranked = rankLeads([
      { signalId: 'noise', label: 'noise' as const, score: 100, createdAtSource: '2026-10-18T00:00:00Z' },
      { signalId: 'buyer', label: 'buyer_intent' as const, score: 1, createdAtSource: '2026-10-01T00:00:00Z' },
    ]);
    expect(ranked.map((item) => [item.signalId, item.rank])).toEqual([['buyer', 1], ['noise', 2]]);
  });

  it('uses created time descending then signal id to break ties', () => {
    const ranked = rankLeads([
      { signalId: 'b', label: 'buyer_intent' as const, score: 50, createdAtSource: '2026-10-01T00:00:00Z' },
      { signalId: 'z', label: 'buyer_intent' as const, score: 50, createdAtSource: '2026-10-02T00:00:00Z' },
      { signalId: 'a', label: 'buyer_intent' as const, score: 50, createdAtSource: '2026-10-01T00:00:00Z' },
    ]);
    expect(ranked.map((item) => item.signalId)).toEqual(['z', 'a', 'b']);
  });
});
