import express from 'express';
import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import type { DecisionView, RunEvent, RunParams, RunStatus, RunView, SellerProfileInput, SourceId } from '@vantage/shared';
import type { DecisionStore } from '../src/db/decisions';
import type { RunStore, SourcePatch } from '../src/db/runs';
import { createRunsRouter } from '../src/routes/runs';
import type { AdapterContext } from '../src/sources/types';

const runId = '00000000-0000-0000-0000-000000000001';
const expectedDecision: DecisionView = {
  signalId: 'signal-1',
  source: 'hackernews',
  url: 'https://example.test/post',
  authorHandle: 'author',
  createdAtSource: '2026-10-01T00:00:00Z',
  textPreview: 'A public post about a customer support problem.',
  label: 'buyer_intent',
  rationale: 'The author describes the support issue.',
  criteria: [{ id: 'states_problem', passed: true, quote: 'support issue' }],
  evidenceVerified: true,
  model: 'gemini-2.5-flash',
  promptVersion: 'classifier.v2',
  status: 'ok',
};

const runStore: RunStore = {
  async createSellerProfile(_input: SellerProfileInput): Promise<string> { return 'seller'; },
  async createRun(_sellerProfileId: string, _params: RunParams): Promise<string> { return runId; },
  async getRun(_id: string): Promise<RunView | null> { return null; },
  async listEvents(_id: string, _afterId: number): Promise<RunEvent[]> { return []; },
  async setRunStatus(_id: string, _status: RunStatus, _finished: boolean): Promise<void> {},
  async upsertRunSource(_id: string, _source: SourceId, _patch: SourcePatch): Promise<void> {},
  async addEvent(_id: string): Promise<void> {},
  async storeSignals(_id: string): Promise<{ inserted: number; updated: number }> { return { inserted: 0, updated: 0 }; },
  async failStaleRuns(): Promise<number> { return 0; },
};

const adapterContext: AdapterContext = {
  fetch: globalThis.fetch,
  now: () => new Date(),
  userAgent: 'test',
  timeoutMs: 100,
  maxRetries: 0,
};

describe('GET /runs/:runId/decisions', () => {
  it('returns 400 for an invalid run id and 200 with decision views for a valid id', async () => {
    const decisionStore: DecisionStore = {
      async getRunContext() { return { seller: { productName: 'Support', problemDescription: 'Tickets', competitors: [] }, signals: [] }; },
      async findReusable() { return null; },
      async saveDecision() {},
      async listDecisions() { return [expectedDecision]; },
    };
    const router = createRunsRouter({ store: runStore, adapters: [], ctx: adapterContext, decisionStore });
    const route = router.stack.find((layer) => layer.route?.path === '/runs/:runId/decisions')?.route;
    const handler = route?.stack[0]?.handle;
    expect(handler).toBeDefined();
    if (!handler) {
      throw new Error('Decisions route handler was not registered');
    }

    async function invoke(
      routeHandler: NonNullable<typeof handler>,
      runIdValue: string,
    ): Promise<{ statusCode: number; body: unknown }> {
      let statusCode = 0;
      let body: unknown;
      const request = { params: { runId: runIdValue }, query: {} } as unknown as Request;
      const response = {
        headersSent: false,
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(value: unknown) {
          body = value;
          return this;
        },
      } as unknown as Response;
      await routeHandler(request, response, () => {});
      return { statusCode, body };
    }

    expect(await invoke(handler, 'not-a-uuid')).toEqual({
      statusCode: 400,
      body: { error: 'Invalid run id' },
    });
    expect(await invoke(handler, runId)).toEqual({
      statusCode: 200,
      body: { decisions: [expectedDecision] },
    });
  });
});

