import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { RunEvent, RunView } from '@vantage/shared';
import type { PipelineDeps } from '../src/orchestrator/runPipeline';
import { createRunsRouter } from '../src/routes/runs';

const runId = '00000000-0000-0000-0000-000000000001';
const completedRun: RunView = {
  id: runId, status: 'completed', demo: false,
  params: { keywords: ['support'], sinceDays: 30, maxResults: 10 },
  startedAt: '2026-10-01T00:00:00Z', finishedAt: '2026-10-01T00:00:01Z',
  seller: { productName: 'Support', problemDescription: 'Tickets', idealCustomer: null, competitors: [] },
  sources: [], signalCount: 0,
};
const event: RunEvent = {
  id: 7, runId, agent: 'scout', kind: 'info', message: 'Found 0 signal(s)', counts: null,
  createdAt: '2026-10-01T00:00:01Z',
};

function handler(options: {
  getRun?: () => Promise<RunView | null>;
  listEvents?: (_id: string, after: number) => Promise<RunEvent[]>;
} = {}) {
  const store = {
    getRun: vi.fn(options.getRun ?? (async () => completedRun)),
    listEvents: vi.fn(options.listEvents ?? (async (_id: string, after: number) => after < event.id ? [event] : [])),
  };
  const deps = { store, adapters: [], ctx: {} } as unknown as PipelineDeps;
  const router = createRunsRouter(deps, { tickMs: 10, heartbeatMs: 20, maxMs: 100 });
  const route = router.stack.find((layer) => layer.route?.path === '/runs/:runId/events/stream');
  const routeHandler = route?.route?.stack[0]?.handle;
  if (!routeHandler) throw new Error('Missing SSE route handler');
  return { routeHandler, store };
}

describe('run event SSE route', () => {
  it('validates before headers and applies Last-Event-ID on reconnect', async () => {
    const { routeHandler } = handler();
    const invalidRes = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    await routeHandler({ params: { runId: 'bad' }, query: {}, get: () => undefined } as unknown as Request, invalidRes, () => {});
    expect(invalidRes.status).toHaveBeenCalledWith(400);

    vi.useFakeTimers();
    try {
      const { routeHandler: validHandler, store } = handler();
      const chunks: string[] = [];
      const response = new EventEmitter() as EventEmitter & {
        set: (headers: Record<string, string>) => void;
        flushHeaders: () => void;
        write: (chunk: string) => void;
        end: () => void;
        writableEnded: boolean;
        headers: Record<string, string>;
      };
      response.headers = {};
      response.writableEnded = false;
      response.set = (headers) => { response.headers = headers; };
      response.flushHeaders = () => {};
      response.write = (chunk) => { chunks.push(chunk); return true; };
      response.end = () => { response.writableEnded = true; };
      const request = new EventEmitter() as EventEmitter & Request;
      request.params = { runId };
      request.query = { after: '3' };
      request.get = ((name: string) => name === 'Last-Event-ID' ? '5' : undefined) as Request['get'];
      await validHandler(request, response as unknown as Response, () => {});
      await vi.advanceTimersByTimeAsync(1);
      expect(response.headers).toMatchObject({ 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' });
      expect(store.listEvents).toHaveBeenCalledWith(runId, 5);
      expect(chunks.join('')).toContain(`id: 7\nevent: run_event\ndata: ${JSON.stringify(event)}\n\n`);
      expect(chunks.join('')).toContain('event: done\ndata: {"status":"completed"}\n\n');
      expect(response.writableEnded).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops its timers when the client closes the stream', async () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    try {
      const { routeHandler } = handler();
      const response = new EventEmitter() as EventEmitter & Response;
      response.set = vi.fn().mockReturnThis();
      response.flushHeaders = vi.fn();
      response.write = vi.fn().mockReturnValue(true);
      response.end = vi.fn().mockReturnThis();
      Object.defineProperty(response, 'writableEnded', { value: false });
      const request = new EventEmitter() as EventEmitter & Request;
      request.params = { runId };
      request.query = {};
      request.get = () => undefined;
      await routeHandler(request, response, () => {});
      response.emit('close');
      expect(clearIntervalSpy).toHaveBeenCalledTimes(2);
    } finally {
      clearIntervalSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('returns 404 before opening the stream and emits fatal after a store error', async () => {
    const missing = handler({ getRun: async () => null });
    const missingRes = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    await missing.routeHandler({ params: { runId }, query: {}, get: () => undefined } as unknown as Request, missingRes, () => {});
    expect(missingRes.status).toHaveBeenCalledWith(404);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'Run not found' });

    vi.useFakeTimers();
    try {
      const broken = handler({ listEvents: async () => { throw new Error('store offline'); } });
      const chunks: string[] = [];
      const response = new EventEmitter() as EventEmitter & Response;
      response.set = vi.fn().mockReturnThis();
      response.flushHeaders = vi.fn();
      response.write = vi.fn((chunk: string) => { chunks.push(chunk); return true; });
      response.end = vi.fn().mockImplementation(() => { Object.defineProperty(response, 'writableEnded', { value: true }); return response; });
      const request = new EventEmitter() as EventEmitter & Request;
      request.params = { runId };
      request.query = {};
      request.get = () => undefined;
      await broken.routeHandler(request, response, () => {});
      await vi.advanceTimersByTimeAsync(1);
      expect(chunks.join('')).toContain('event: fatal\ndata: {}\n\n');
      expect(response.end).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
