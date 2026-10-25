import { describe, expect, it, vi } from 'vitest';
import { createRelevanceStage, scoreRelevance } from '../src/agents/relevance';
import type { SellerProfileInput } from '@vantage/shared';
import type { DecisionRow, DecisionStore, RunSignalContext } from '../src/db/decisions';

const seller: SellerProfileInput = {
  productName: 'TraceLite',
  problemDescription: 'self-hosted error monitoring',
  idealCustomer: undefined,
  competitors: [],
};
const signals: RunSignalContext[] = [
  { id: 'relevant', text: 'self-hosted error monitoring for teams', contentHash: 'a', source: 'hackernews', url: 'https://example.test/relevant', authorHandle: 'user1', createdAtSource: '2026-01-01T00:00:00Z' },
  { id: 'off-topic', text: 'political campaign and election debate', contentHash: 'b', source: 'hackernews', url: 'https://example.test/off-topic', authorHandle: 'user2', createdAtSource: '2026-01-02T00:00:00Z' },
];

describe('scoreRelevance', () => {
  it('keeps relevant vectors and excludes low-similarity posts with the configured threshold', async () => {
    const embed = vi.fn(async () => [[1, 0], [0.9, 0.1], [0.1, 0.9]]);
    const result = await scoreRelevance(seller, signals, embed, { threshold: 0.5, maxClassifyPerRun: 10 });
    expect(result).toMatchObject({ eligibleIds: ['relevant'], total: 2, eligible: 1, excluded: 1, threshold: 0.5 });
    expect(result.scores['off-topic']).toBeLessThan(0.5);
  });

  it('caps classification to the highest similarity signals', async () => {
    const embed = vi.fn(async () => [[1, 0], [0.8, 0.6], [0.98, 0.2]]);
    const result = await scoreRelevance(seller, signals, embed, { threshold: 0.3, maxClassifyPerRun: 1 });
    expect(result.eligibleIds).toEqual(['off-topic']);
    expect(result.excluded).toBe(1);
  });

  it('persists a score, threshold and eligibility fact for every signal using the fake embedder', async () => {
    const saved: DecisionRow[] = [];
    const store: DecisionStore = {
      getRunContext: async () => ({ seller, signals }),
      listCriticCandidates: async () => [],
      findReusable: async () => null,
      saveDecision: async (row) => { saved.push(row); },
      listDecisions: async () => [],
    };
    const embed = vi.fn(async (texts: string[]) => texts.map((_text, index) => index === 0 ? [1, 0] : index === 1 ? [0.9, 0.1] : [0.1, 0.9]));
    const result = await createRelevanceStage({ store, embed, config: { threshold: 0.5, maxClassifyPerRun: 10 } })('run-1', ['error tracking']);
    expect(embed.mock.calls[0]?.[0]?.[0]).toContain('error tracking');
    expect(saved).toHaveLength(2);
    expect(saved.map((row) => [row.agent, row.output.eligible, row.output.threshold])).toEqual([
      ['scout', true, 0.5], ['scout', false, 0.5],
    ]);
    expect(result.eligibleIds).toEqual(['relevant']);
  });
});
