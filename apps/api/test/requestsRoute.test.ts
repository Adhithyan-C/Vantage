import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import type { RunStore } from '../src/db/runs';
import { createRunsRouter } from '../src/routes/runs';
import type { PipelineDeps } from '../src/orchestrator/runPipeline';
import { defaultAdapterContext } from '../src/sources/index';

const runId = '00000000-0000-0000-0000-000000000001';
const record = { id: 1, source: 'hackernews' as const, label: 'support', status: 'ok' as const, httpStatus: 200, durationMs: 4, itemsReturned: 2, error: null, quotaRemaining: null, createdAt: '2026-10-01T00:00:00Z' };

async function invoke(id: string, exists: boolean) {
  const store = {
    async getRun() { return exists ? { id, status: 'completed', demo: false, params: { keywords: [], sinceDays: 1, maxResults: 1 }, startedAt: record.createdAt, finishedAt: record.createdAt, seller: { productName: 'x', problemDescription: 'x', idealCustomer: null, competitors: [] }, sources: [], signalCount: 0 } : null; },
    async listSourceRequests() { return [record]; },
  } as unknown as RunStore;
  const deps = { store, adapters: [], ctx: defaultAdapterContext() } satisfies PipelineDeps;
  const router = createRunsRouter(deps);
  const handler = router.stack.find((layer) => layer.route?.path === '/runs/:runId/requests')?.route?.stack[0]?.handle;
  if (!handler) throw new Error('Requests handler not registered');
  let statusCode = 0;
  let body: unknown;
  const req = { params: { runId: id } } as unknown as Request;
  const res = { status(code: number) { statusCode = code; return this; }, json(value: unknown) { body = value; return this; } } as unknown as Response;
  await handler(req, res, () => {});
  return { statusCode, body };
}

describe('GET /runs/:runId/requests', () => {
  it('returns 400 for a bad id', async () => {
    expect(await invoke('bad', true)).toMatchObject({ statusCode: 400, body: { error: 'Invalid run id' } });
  });
  it('returns 404 for an unknown run', async () => {
    expect(await invoke(runId, false)).toMatchObject({ statusCode: 404, body: { error: 'Run not found' } });
  });
  it('returns the request views for an existing run', async () => {
    expect(await invoke(runId, true)).toEqual({ statusCode: 200, body: { requests: [record] } });
  });
});
