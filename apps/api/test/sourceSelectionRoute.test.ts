import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import type {
  AgentId,
  EventKind,
  RawSignal,
  RunEvent,
  RunParams,
  RunStatus,
  RunView,
  SellerProfileInput,
  SourceId,
} from '@vantage/shared';
import type { RunStore, SourcePatch } from '../src/db/runs';
import { createRunsRouter } from '../src/routes/runs';
import type { AdapterContext, SourceAdapter } from '../src/sources/types';

const RUN_ID = '00000000-0000-0000-0000-000000000001';
const requestBody = {
  seller: { productName: 'Support', problemDescription: 'Support tickets', competitors: [] },
  params: { keywords: ['helpdesk'], sinceDays: 30, maxResults: 10, sources: ['snapshot'] },
};

class FakeRunStore implements RunStore {
  createdParams: RunParams | null = null;
  sources: SourceId[] = [];
  async createSellerProfile(_input: SellerProfileInput): Promise<string> { return 'seller'; }
  async createRun(_sellerProfileId: string, params: RunParams): Promise<string> {
    this.createdParams = params;
    return RUN_ID;
  }
  async getRun(_runId: string): Promise<RunView | null> { return null; }
  async listEvents(_runId: string, _afterId: number): Promise<RunEvent[]> { return []; }
  async saveSourceRequests() {}
  async listSourceRequests() { return []; }
  async setRunStatus(_runId: string, _status: RunStatus, _finished: boolean): Promise<void> {}
  async upsertRunSource(_runId: string, source: SourceId, _patch: SourcePatch): Promise<void> {
    this.sources.push(source);
  }
  async addEvent(
    _runId: string,
    _agent: AgentId,
    _kind: EventKind,
    _message: string,
    _counts?: Record<string, unknown>,
  ): Promise<void> {}
  async storeSignals(_runId: string, _signals: RawSignal[]): Promise<{ inserted: number; updated: number }> {
    return { inserted: 0, updated: 0 };
  }
  async failStaleRuns(): Promise<number> { return 0; }
}

const context: AdapterContext = {
  fetch: globalThis.fetch,
  now: () => new Date('2026-10-19T00:00:00Z'),
  userAgent: 'test',
  timeoutMs: 100,
  maxRetries: 0,
};

async function invoke(body: unknown, store: FakeRunStore, adapters: SourceAdapter[]) {
  const router = createRunsRouter({ store, adapters, ctx: context });
  const handler = router.stack
    .find((layer) => layer.route?.path === '/runs')
    ?.route?.stack[0]?.handle;
  if (!handler) throw new Error('POST /runs handler was not registered');
  let statusCode = 0;
  let responseBody: unknown;
  const req = { body } as Request;
  const res = {
    headersSent: false,
    status(code: number) { statusCode = code; return this; },
    json(value: unknown) { responseBody = value; return this; },
  } as unknown as Response;
  await handler(req, res, () => {});
  return { statusCode, body: responseBody };
}

describe('POST /runs source selection', () => {
  it('rejects a source that is not in the registered adapter list', async () => {
    const store = new FakeRunStore();
    const result = await invoke({
      ...requestBody,
      params: { ...requestBody.params, sources: ['devforums'] },
    }, store, []);
    expect(result).toEqual({
      statusCode: 400,
      body: { error: 'Invalid request', issues: ['params.sources: devforums is not available'] },
    });
    expect(store.createdParams).toBeNull();
  });

  it('accepts a registered source and passes it through to run creation and the pipeline', async () => {
    const store = new FakeRunStore();
    const searched: SourceId[] = [];
    const snapshot: SourceAdapter = {
      id: 'snapshot',
      async search() {
        searched.push('snapshot');
        return { signals: [], status: 'ok' };
      },
    };
    const result = await invoke(requestBody, store, [snapshot]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.statusCode).toBe(202);
    expect(store.createdParams?.sources).toEqual(['snapshot']);
    expect(store.sources).toContain('snapshot');
    expect(searched).toEqual(['snapshot']);
  });
});
