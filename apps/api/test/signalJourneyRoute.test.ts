import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import type { RunStore } from '../src/db/runs';
import type { SignalJourney, SignalRunSummary } from '@vantage/shared';
import type { SignalJourneyStore } from '../src/db/signalJourneys';
import { createRunsRouter } from '../src/routes/runs';
import { defaultAdapterContext } from '../src/sources/index';

const runId = '00000000-0000-0000-0000-000000000001';
const signalId = '00000000-0000-0000-0000-000000000002';
const journey: SignalJourney = {
  signalId, leadId: null, source: 'hackernews', authorHandle: 'seller', url: 'https://example.test/post', textPreview: 'A post', createdAtSource: '2026-10-01T00:00:00Z',
  label: null, score: null, text: 'A post',
  stages: Object.fromEntries(['scout', 'classifier', 'critic', 'enricher', 'scorer', 'displacement', 'outcome'].map((stage) => [stage, { status: 'not_available' }])) as SignalJourney['stages'],
  timeline: ['scout', 'classifier', 'critic', 'enricher', 'scorer', 'displacement', 'outcome'].map((stage) => ({ stage, status: 'not_available' as const, reason: null, output: null })) as SignalJourney['timeline'],
};
const summary: SignalRunSummary = (({ text: _text, timeline: _timeline, ...item }) => item)(journey);

async function invoke(path: string, options: { exists?: boolean; signals?: SignalRunSummary[]; journey?: SignalJourney | null; query?: Record<string, unknown>; params?: Record<string, string> } = {}) {
  let calledPage: [string, number, number] | null = null;
  const runStore = { async getRun() { return options.exists === false ? null : { id: runId }; } } as unknown as RunStore;
  const signalJourneyStore: SignalJourneyStore = {
    async listRunSignals(id, limit, offset) { calledPage = [id, limit, offset]; return { signals: options.signals ?? [summary], total: options.signals?.length ?? 1 }; },
    async getSignalJourney() { return options.journey === undefined ? journey : options.journey; },
  };
  const router = createRunsRouter({ store: runStore, adapters: [], ctx: defaultAdapterContext(), signalJourneyStore });
  const handler = router.stack.find((layer) => layer.route?.path === path)?.route?.stack[0]?.handle;
  if (!handler) throw new Error(`Missing route ${path}`);
  let statusCode = 0;
  let body: unknown;
  const req = { params: options.params ?? { runId, signalId }, query: options.query ?? {} } as unknown as Request;
  const res = { status(code: number) { statusCode = code; return this; }, json(value: unknown) { body = value; return this; } } as unknown as Response;
  await handler(req, res, () => {});
  return { statusCode, body, calledPage };
}

describe('signal trace routes', () => {
  it('validates collection paging and run membership', async () => {
    expect((await invoke('/runs/:runId/signals', { params: { runId: 'bad' } })).body).toEqual({ error: 'Invalid run id' });
    expect((await invoke('/runs/:runId/signals', { query: { limit: '101' } })).body).toEqual({ error: 'Invalid paging values' });
    expect((await invoke('/runs/:runId/signals', { exists: false })).statusCode).toBe(404);
  });

  it('returns paged collected signals including unclassified records', async () => {
    const result = await invoke('/runs/:runId/signals', { query: { limit: '20', offset: '10' } });
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ signals: [summary], total: 1 });
    expect(result.calledPage).toEqual([runId, 20, 10]);
  });

  it('validates trace ids, missing run and missing membership', async () => {
    expect((await invoke('/runs/:runId/signals/:signalId/trace', { params: { runId, signalId: 'bad' } })).statusCode).toBe(400);
    expect((await invoke('/runs/:runId/signals/:signalId/trace', { exists: false })).statusCode).toBe(404);
    expect((await invoke('/runs/:runId/signals/:signalId/trace', { journey: null })).body).toEqual({ error: 'Signal not found in this run' });
  });

  it('returns the ordered seven-entry journey', async () => {
    const result = await invoke('/runs/:runId/signals/:signalId/trace');
    expect(result.statusCode).toBe(200);
    expect((result.body as { journey: SignalJourney }).journey.timeline.map((entry) => entry.stage)).toEqual(['scout', 'classifier', 'critic', 'enricher', 'scorer', 'displacement', 'outcome']);
  });
});
