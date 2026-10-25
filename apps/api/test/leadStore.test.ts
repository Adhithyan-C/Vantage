import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createLeadStore } from '../src/db/leads';

class DetailQuery {
  private readonly equals = new Map<string, unknown>();

  constructor(private readonly table: string, private readonly records: Record<string, unknown>[]) {}

  select(): this { return this; }
  eq(column: string, value: unknown): this { this.equals.set(column, value); return this; }
  order(): this { return this; }
  limit(): this { return this; }

  async maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: null }> {
    const record = this.records.find((row) => [...this.equals.entries()].every(([key, value]) => row[key] === value));
    return { data: record ?? null, error: null };
  }
}

const leadId = '00000000-0000-0000-0000-000000000001';
const signalId = '00000000-0000-0000-0000-000000000002';
const runId = '00000000-0000-0000-0000-000000000003';

function fakeDb(critic?: Record<string, unknown>): SupabaseClient {
  const records: Record<string, Record<string, unknown>[]> = {
    leads: [{
      id: leadId,
      run_id: runId,
      signal_id: signalId,
      label: 'buyer_intent',
      score: 80,
      score_breakdown: {
        components: [
          { name: 'intent', value: 1, weight: 0.4, contribution: 40 },
          { name: 'fit', value: 1, weight: 0.25, contribution: 25 },
          { name: 'recency', value: 0.5, weight: 0.2, contribution: 10 },
          { name: 'engagement', value: 1, weight: 0.15, contribution: 15 },
        ],
        total: 80,
        confidence: 1,
        enrichment: {
          ageDays: 30, commentCount: 1, upvotes: 1, source: 'hackernews', community: null,
          competitorsMentioned: [], purchaseTermsFound: [], teamTermsFound: [],
          fit: { competitorMentioned: false, purchaseLanguage: true, teamOrRoleContext: false },
        },
      },
      rank: 1,
      status: 'new',
    }],
    signals: [{
      id: signalId,
      source: 'hackernews',
      url: 'https://example.test/post',
      author_handle: 'author',
      community: null,
      created_at_source: '2026-10-01T00:00:00Z',
      text_snapshot: 'I need a support tool.',
    }],
    decisions: [
      {
        run_id: runId,
        signal_id: signalId,
        agent: 'classifier',
        model: 'classifier-model',
        prompt_version: 'classifier.v2',
        created_at: '2026-10-02T00:00:00Z',
        status: 'ok',
        output: {
          label: 'buyer_intent',
          rationale: 'The author asks for a tool.',
          criteria: [{ id: 'states_problem', passed: true, quote: 'need a support tool' }],
          notes: { unverified: [] },
        },
      },
      ...(critic ? [{ run_id: runId, signal_id: signalId, agent: 'critic', ...critic }] : []),
    ],
  };
  const db = {
    from(table: string) {
      return new DetailQuery(table, records[table] ?? []);
    },
  };
  return db as unknown as SupabaseClient;
}

describe('LeadStore.getLeadDetail critic trace', () => {
  it('returns the latest critic decision trace for the lead run and signal', async () => {
    const store = createLeadStore(fakeDb({
      model: 'critic-model',
      prompt_version: 'critic.v1',
      created_at: '2026-10-03T00:00:00Z',
      status: 'ok',
      output: { verdict: 'weak', issues: ['The quote does not support urgency.'], trustScore: 0.4 },
    }));

    const detail = await store.getLeadDetail(leadId);

    expect(detail?.criticTrace).toEqual({
      model: 'critic-model',
      promptVersion: 'critic.v1',
      createdAt: '2026-10-03T00:00:00Z',
      status: 'ok',
      output: { verdict: 'weak', issues: ['The quote does not support urgency.'], trustScore: 0.4 },
    });
  });

  it('returns a null critic trace when no critic decision exists', async () => {
    const store = createLeadStore(fakeDb());
    await expect(store.getLeadDetail(leadId)).resolves.toMatchObject({ criticTrace: null });
  });
});
