import { describe, expect, it } from 'vitest';
import type { ClassifierOutput, LeadLabel } from '@vantage/shared';
import { createScoreStage } from '../src/agents/scorer';
import type { LeadStore, LeadUpsertRow, ScoringContext } from '../src/db/leads';

const criteria: ClassifierOutput['criteria'] = [
  { id: 'states_problem', passed: true, quote: 'support problem' },
  { id: 'asks_for_recommendation', passed: true, quote: 'recommendation' },
  { id: 'mentions_team_or_budget', passed: false, quote: null },
  { id: 'shows_urgency', passed: false, quote: null },
  { id: 'names_competitor', passed: false, quote: null },
];

function item(signal: string, label: LeadLabel, createdAtSource = '2026-10-01T00:00:00Z'):
  ScoringContext['items'][number] {
  return {
    signal,
    text: 'Our support team has a support problem and needs a recommendation.',
    source: 'hackernews',
    community: null,
    url: `https://example.test/${signal}`,
    authorHandle: 'seller',
    createdAtSource,
    engagement: { comments: 2, score: 10 },
    decision: {
      output: {
        label,
        criteria,
        rationale: 'A buyer described their support problem.',
        notes: { unverified: ['names_competitor'] },
      },
      evidenceVerified: false,
    },
  };
}

class FakeLeadStore implements LeadStore {
  context: ScoringContext = {
    seller: { productName: 'Support', problemDescription: 'Support workflows', competitors: [] },
    items: [
      item('noise', 'noise'),
      item('competitor', 'competitor_complaint'),
      item('buyer', 'buyer_intent'),
    ],
  };
  saved: Array<{ runId: string; rows: LeadUpsertRow[] }> = [];

  async getScoringContext(_runId: string): Promise<ScoringContext> {
    return this.context;
  }

  async saveLeads(runId: string, rows: LeadUpsertRow[]): Promise<void> {
    this.saved.push({ runId, rows });
  }

  async listLeads(_runId: string, _includeAll: boolean) {
    return [];
  }

  async getLeadDetail(_leadId: string) { return null; }

  async setLeadStatus(_leadId: string, _status: 'new' | 'accepted' | 'rejected') { return true; }

  async addFeedback(_leadId: string, _action: 'accept' | 'reject' | 'reset'): Promise<void> {}
}

describe('createScoreStage', () => {
  it('enriches, scores, ranks, and saves every classified item without a status field', async () => {
    const store = new FakeLeadStore();
    const score = createScoreStage({ store, now: () => new Date('2026-10-18T00:00:00Z') });
    const result = await score('run-1');

    expect(result).toMatchObject({ scored: 3, ranked: 2 });
    expect(result.topScore).toBeTypeOf('number');
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0]?.runId).toBe('run-1');
    expect(store.saved[0]?.rows.map((row) => [row.signalId, row.rank])).toEqual([
      ['buyer', 1], ['competitor', 2], ['noise', 3],
    ]);
    for (const row of store.saved[0]?.rows ?? []) {
      expect('status' in row).toBe(false);
      expect(row.score).toBeGreaterThanOrEqual(0);
      expect(row.score).toBeLessThanOrEqual(100);
      expect(Object.keys(row.scoreBreakdown).sort()).toEqual([
        'components', 'confidence', 'enrichment', 'total',
      ]);
      expect(row.scoreBreakdown.confidence).toBeCloseTo(2 / 3, 5);
      expect(row.scoreBreakdown.enrichment.source).toBe('hackernews');
    }
  });

  it('returns zero summary and saves nothing for an empty context', async () => {
    const store = new FakeLeadStore();
    store.context.items = [];
    const score = createScoreStage({ store });
    await expect(score('run-empty')).resolves.toEqual({ scored: 0, ranked: 0, topScore: null });
    expect(store.saved).toEqual([]);
  });

  it('counts only buyer and competitor labels in ranked and topScore', async () => {
    const store = new FakeLeadStore();
    store.context.items = [item('venting', 'venting'), item('noise', 'noise')];
    const score = createScoreStage({ store, now: () => new Date('2026-10-18T00:00:00Z') });
    await expect(score('run-unranked')).resolves.toEqual({ scored: 2, ranked: 0, topScore: null });
    expect(store.saved[0]?.rows).toHaveLength(2);
  });
});
