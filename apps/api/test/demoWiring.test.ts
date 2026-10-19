import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import type { AdapterContext } from '../src/sources/types';
import { createHealthRouter } from '../src/index';
import { createReplay } from '../src/demo/replay';
import { fixture, RUN_ID } from './demoTestFixtures';
import { createRunsRouter } from '../src/routes/runs';

const context: AdapterContext = {
  fetch: globalThis.fetch,
  now: () => new Date('2026-10-19T00:00:00Z'),
  userAgent: 'test',
  timeoutMs: 100,
  maxRetries: 0,
};

async function call(router: ReturnType<typeof createRunsRouter>, path: string, body?: unknown) {
  const handler = router.stack.find((layer) => layer.route?.path === path)?.route?.stack[0]?.handle;
  if (!handler) throw new Error(`Missing handler for ${path}`);
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

describe('demo API wiring', () => {
  it('skips source validation and calls the injected runner when demo mode is enabled', async () => {
    const replay = createReplay({ fixture: (await import('../src/demo/schema')).DemoRunSchema.parse(fixture()) });
    let runnerCalls = 0;
    const router = createRunsRouter({
      store: replay.runStore,
      adapters: [],
      ctx: context,
      demoMode: true,
      runner: async (_deps, runId) => { runnerCalls += 1; expect(runId).toBe(RUN_ID); },
    });
    const result = await call(router, '/runs', {
      seller: { productName: 'Support', problemDescription: 'Support workflow', competitors: [] },
      params: { keywords: ['support'], sinceDays: 30, maxResults: 10, sources: ['snapshot'] },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result).toEqual({ statusCode: 202, body: { runId: RUN_ID } });
    expect(runnerCalls).toBe(1);
    expect(router.stack.some((layer) => layer.route?.path === '/runs/:runId/decisions')).toBe(false);
  });

  it('retains source validation without demo mode', async () => {
    const replay = createReplay({ fixture: (await import('../src/demo/schema')).DemoRunSchema.parse(fixture()) });
    const router = createRunsRouter({ store: replay.runStore, adapters: [], ctx: context });
    const result = await call(router, '/runs', {
      seller: { productName: 'Support', problemDescription: 'Support workflow', competitors: [] },
      params: { keywords: ['support'], sinceDays: 30, maxResults: 10, sources: ['snapshot'] },
    });
    expect(result.statusCode).toBe(400);
  });

  it('reports demo true and false from the health router', async () => {
    for (const demo of [true, false]) {
      const router = createHealthRouter(demo);
      const handler = router.stack.find((layer) => layer.route?.path === '/health')?.route?.stack[0]?.handle;
      if (!handler) throw new Error('Missing health handler');
      let body: unknown;
      const response = { json(value: unknown) { body = value; return this; } } as unknown as Response;
      await handler({} as Request, response, () => {});
      expect(body).toEqual({ status: 'ok', demo });
    }
  });
});
