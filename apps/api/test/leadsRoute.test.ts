import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import type {
  Enrichment,
  LeadView,
  RunEvent,
  RunParams,
  RunStatus,
  RunView,
  SellerProfileInput,
  SourceId,
} from '@vantage/shared';
import type { LeadStore, ScoringContext } from '../src/db/leads';
import type { RunStore, SourcePatch } from '../src/db/runs';
import { createRunsRouter } from '../src/routes/runs';
import type { AdapterContext } from '../src/sources/types';

const RUN_ID = '00000000-0000-0000-0000-000000000001';
const enrichment: Enrichment = {
  ageDays: 2,
  commentCount: 3,
  upvotes: 5,
  source: 'hackernews',
  community: null,
  competitorsMentioned: [],
  purchaseTermsFound: ['recommendation'],
  teamTermsFound: [],
  fit: { competitorMentioned: false, purchaseLanguage: true, teamOrRoleContext: false },
};
const lead: LeadView = {
  leadId: 'lead-1',
  signalId: 'signal-1',
  rank: 1,
  label: 'buyer_intent',
  score: 70,
  confidence: 1,
  status: 'new',
  source: 'hackernews',
  url: 'https://example.test/post',
  authorHandle: 'author',
  community: null,
  createdAtSource: '2026-10-16T00:00:00Z',
  textPreview: 'A support tool recommendation request.',
  rationale: 'The author asks for a support recommendation.',
  criteria: [{ id: 'asks_for_recommendation', passed: true, quote: 'recommendation' }],
  evidenceVerified: true,
  breakdown: {
    components: [
      { name: 'intent', value: 0.7, weight: 0.4, contribution: 28 },
      { name: 'fit', value: 1 / 3, weight: 0.25, contribution: 8.33 },
      { name: 'recency', value: 0.95, weight: 0.2, contribution: 19 },
      { name: 'engagement', value: 0.5, weight: 0.15, contribution: 7.5 },
    ],
    total: 70,
  },
  enrichment,
};

const runStore: RunStore = {
  async createSellerProfile(_input: SellerProfileInput): Promise<string> { return 'seller'; },
  async createRun(_sellerProfileId: string, _params: RunParams): Promise<string> { return RUN_ID; },
  async getRun(_runId: string): Promise<RunView | null> { return null; },
  async listEvents(_runId: string, _afterId: number): Promise<RunEvent[]> { return []; },
  async saveSourceRequests() {},
  async listSourceRequests() { return []; },
  async setRunStatus(_runId: string, _status: RunStatus, _finished: boolean): Promise<void> {},
  async upsertRunSource(_runId: string, _source: SourceId, _patch: SourcePatch): Promise<void> {},
  async addEvent(_runId: string): Promise<void> {},
  async storeSignals(_runId: string): Promise<{ inserted: number; updated: number }> { return { inserted: 0, updated: 0 }; },
  async failStaleRuns(): Promise<number> { return 0; },
};

const leadStore: LeadStore & { calls: Array<{ runId: string; includeAll: boolean }> } = {
  calls: [],
  async getScoringContext(_runId: string): Promise<ScoringContext> {
    return { seller: { productName: 'Support', problemDescription: 'Tickets', competitors: [] }, items: [] };
  },
  async saveLeads(_runId, _rows): Promise<void> {},
  async listLeads(runId, includeAll): Promise<LeadView[]> {
    this.calls.push({ runId, includeAll });
    return [lead];
  },
  async getLeadDetail(_leadId) { return null; },
  async setLeadStatus(_leadId, _status) { return true; },
  async addFeedback(_leadId, _action) {},
};

const ctx: AdapterContext = {
  fetch: globalThis.fetch,
  now: () => new Date(),
  userAgent: 'test',
  timeoutMs: 100,
  maxRetries: 0,
};

const route = createRunsRouter({ store: runStore, adapters: [], ctx, leadStore });
const handler = route.stack
  .find((layer) => layer.route?.path === '/runs/:runId/leads')
  ?.route?.stack[0]?.handle;

async function invoke(runId: string, include?: unknown): Promise<{ statusCode: number; body: unknown }> {
  if (!handler) {
    throw new Error('Leads route handler was not registered');
  }
  let statusCode = 0;
  let body: unknown;
  const query = include === undefined ? {} : { include };
  const request = { params: { runId }, query } as unknown as Request;
  const response = {
    headersSent: false,
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { body = value; return this; },
  } as unknown as Response;
  await handler(request, response, () => {});
  return { statusCode, body };
}

describe('GET /runs/:runId/leads', () => {
  it('returns 400 for an invalid run id or include value', async () => {
    expect(await invoke('invalid')).toEqual({ statusCode: 400, body: { error: 'Invalid run id' } });
    expect(await invoke(RUN_ID, 'foo')).toEqual({ statusCode: 400, body: { error: 'Invalid include' } });
  });

  it('returns LeadView rows and defaults to the ranked labels', async () => {
    expect(await invoke(RUN_ID)).toEqual({ statusCode: 200, body: { leads: [lead] } });
    expect(leadStore.calls.at(-1)).toEqual({ runId: RUN_ID, includeAll: false });
  });

  it('passes include=all through to the store', async () => {
    expect((await invoke(RUN_ID, 'all')).statusCode).toBe(200);
    expect(leadStore.calls.at(-1)).toEqual({ runId: RUN_ID, includeAll: true });
  });
});
