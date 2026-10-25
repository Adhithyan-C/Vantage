import express from 'express';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent, RunView } from '@vantage/shared';
import type { PipelineDeps } from '../src/orchestrator/runPipeline';
import { createRunsRouter } from '../src/routes/runs';

const runId = '00000000-0000-0000-0000-000000000001';
const run: RunView = {
  id: runId, status: 'completed', demo: false,
  params: { keywords: ['support'], sinceDays: 30, maxResults: 10 },
  startedAt: '2026-10-01T00:00:00Z', finishedAt: '2026-10-01T00:00:01Z',
  seller: { productName: 'Support', problemDescription: 'Tickets', idealCustomer: null, competitors: [] },
  sources: [], signalCount: 0,
};
const savedEvent: RunEvent = {
  id: 7, runId, agent: 'scout', kind: 'info', message: 'Found 0 signal(s)', counts: null,
  createdAt: '2026-10-01T00:00:01Z',
};
const servers: Server[] = [];

async function startServer(options: {
  getRun?: () => Promise<RunView | null>;
  listEvents?: (after: number) => Promise<RunEvent[]>;
} = {}): Promise<string> {
  const store = {
    getRun: vi.fn(options.getRun ?? (async () => run)),
    listEvents: vi.fn(async (_id: string, after: number) => options.listEvents
      ? options.listEvents(after)
      : after < savedEvent.id ? [savedEvent] : []),
  };
  const deps = { store, adapters: [], ctx: {} } as unknown as PipelineDeps;
  const app = express();
  app.use(createRunsRouter(deps, { tickMs: 10, heartbeatMs: 25, maxMs: 500 }));
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No ephemeral server address');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe('SSE HTTP endpoint', () => {
  it('streams exact ordered event frames, honors Last-Event-ID and ends with done', async () => {
    const base = await startServer();
    const response = await fetch(`${base}/runs/${runId}/events/stream?after=3`, { headers: { 'Last-Event-ID': '5' } });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    const body = await response.text();
    expect(body).toContain(`id: 7\nevent: run_event\ndata: ${JSON.stringify(savedEvent)}\n\n`);
    expect(body).toContain('event: done\ndata: {"status":"completed"}\n\n');
  });

  it('answers invalid id, invalid cursor and unknown run as JSON before streaming', async () => {
    const base = await startServer({ getRun: async () => null });
    const invalidId = await fetch(`${base}/runs/bad/events/stream`);
    expect(invalidId.status).toBe(400);
    expect(await invalidId.json()).toEqual({ error: 'Invalid run id' });
    const invalidAfter = await fetch(`${base}/runs/${runId}/events/stream?after=-1`);
    expect(invalidAfter.status).toBe(400);
    expect(await invalidAfter.json()).toEqual({ error: 'Invalid after' });
    const missing = await fetch(`${base}/runs/${runId}/events/stream`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Run not found' });
  });

  it('sends fatal on store failure and clears timers after a client abort', async () => {
    const failedBase = await startServer({ listEvents: async () => { throw new Error('store offline'); } });
    const failure = await fetch(`${failedBase}/runs/${runId}/events/stream`);
    expect(await failure.text()).toContain('event: fatal\ndata: {}\n\n');

    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const runningBase = await startServer({ getRun: async () => ({ ...run, status: 'running', finishedAt: null }) });
    const response = await fetch(`${runningBase}/runs/${runId}/events/stream`);
    const reader = response.body?.getReader();
    await reader?.read();
    await reader?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(clearIntervalSpy).toHaveBeenCalledTimes(2);
    clearIntervalSpy.mockRestore();
  });
});
