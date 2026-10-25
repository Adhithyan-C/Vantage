import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import type { FeedbackAction, LeadDetail } from '@vantage/shared';
import type { LeadStore } from '../src/db/leads';
import { createLeadsRouter } from '../src/routes/leads';

const LEAD_ID = '00000000-0000-0000-0000-000000000001';
const detail: LeadDetail = {
  lead: {
    leadId: LEAD_ID, signalId: 'signal', rank: 1, label: 'buyer_intent', score: 60,
    confidence: 1, status: 'new', source: 'hackernews', url: 'https://example.test/post',
    authorHandle: 'author', community: null, createdAtSource: '2026-10-01T00:00:00Z',
    textPreview: 'A post asks for a better support tool.', rationale: 'The author asks for a tool.',
    criteria: [{ id: 'asks_for_recommendation', passed: true, quote: 'asks for a tool' }],
    evidenceVerified: true,
    breakdown: { components: [
      { name: 'intent', value: 0.5, weight: 0.4, contribution: 20 },
      { name: 'fit', value: 0.5, weight: 0.25, contribution: 12.5 },
      { name: 'recency', value: 0.5, weight: 0.2, contribution: 10 },
      { name: 'engagement', value: 0.5, weight: 0.15, contribution: 7.5 },
    ], total: 60 },
    enrichment: {
      ageDays: 30, commentCount: 1, upvotes: 2, source: 'hackernews', community: null,
      competitorsMentioned: [], purchaseTermsFound: [], teamTermsFound: [],
      fit: { competitorMentioned: false, purchaseLanguage: false, teamOrRoleContext: false },
    },
  },
  runId: '00000000-0000-0000-0000-000000000002',
  text: 'The author asks for a tool.',
  evidence: [{ criterion: 'asks_for_recommendation', quote: 'asks for a tool', start: 12, end: 27 }],
  discardedQuotes: 0,
  trace: { model: 'test-model', promptVersion: 'classifier.v2', createdAt: '2026-10-01T00:00:00Z', status: 'ok', output: {} },
  criticTrace: null,
};

function fakeStore(overrides: Partial<LeadStore> = {}): LeadStore & { calls: string[]; status: string | null; feedback: FeedbackAction[] } {
  const fake = {
    calls: [] as string[],
    status: null as string | null,
    feedback: [] as FeedbackAction[],
    async getScoringContext() { return { seller: { productName: 'A', problemDescription: 'B', competitors: [] }, items: [] }; },
    async saveLeads() {},
    async listLeads() { return []; },
    async getLeadDetail() { return detail; },
    async setLeadStatus(_id: string, statusValue: 'new' | 'accepted' | 'rejected') { fake.calls.push('status'); fake.status = statusValue; return true; },
    async addFeedback(_id: string, action: FeedbackAction) { fake.calls.push('feedback'); fake.feedback.push(action); },
    ...overrides,
  };
  return fake;
}

async function invoke(path: string, params: Record<string, string>, body?: unknown, store = fakeStore()) {
  const router = createLeadsRouter({ store });
  const route = router.stack.find((layer) => layer.route?.path === path)?.route;
  const handler = route?.stack[0]?.handle;
  if (!handler) throw new Error(`Missing handler for ${path}`);
  let statusCode = 0;
  let responseBody: unknown;
  const req = { params, body } as unknown as Request;
  const res = { status(code: number) { statusCode = code; return this; }, json(value: unknown) { responseBody = value; return this; } } as unknown as Response;
  await handler(req, res, () => {});
  return { statusCode, body: responseBody, store };
}

describe('signal detail and feedback routes', () => {
  it('returns 400 for an invalid id and 404 for an unknown signal', async () => {
    expect((await invoke('/leads/:leadId', { leadId: 'bad' })).statusCode).toBe(400);
    const missing = fakeStore({ async getLeadDetail() { return null; } });
    expect((await invoke('/leads/:leadId', { leadId: LEAD_ID }, undefined, missing)).statusCode).toBe(404);
  });

  it('returns the detail envelope', async () => {
    const result = await invoke('/leads/:leadId', { leadId: LEAD_ID });
    expect(result).toMatchObject({ statusCode: 200, body: { detail } });
  });

  it.each([
    ['accept', 'accepted'], ['reject', 'rejected'], ['reset', 'new'],
  ] as const)('maps %s to %s and writes feedback after the status update', async (action, status) => {
    const result = await invoke('/leads/:leadId/feedback', { leadId: LEAD_ID }, { action });
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ status });
    expect(result.store.calls).toEqual(['status', 'feedback']);
  });

  it('returns validation issues for bad bodies and stops feedback when no row matched', async () => {
    const invalid = await invoke('/leads/:leadId/feedback', { leadId: LEAD_ID }, { action: 'invalid' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.body).toMatchObject({ error: 'Invalid request' });
    const invalidBody = invalid.body as { issues?: unknown };
    expect(Array.isArray(invalidBody.issues)).toBe(true);
    const missing = fakeStore({ async setLeadStatus() { return false; } });
    const notFound = await invoke('/leads/:leadId/feedback', { leadId: LEAD_ID }, { action: 'accept' }, missing);
    expect(notFound.statusCode).toBe(404);
    expect(missing.calls).toEqual([]);
  });
});
