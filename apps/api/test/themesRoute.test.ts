import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import type { RunStore } from '../src/db/runs';
import type { ThemeStore } from '../src/db/themes';
import { createRunsRouter } from '../src/routes/runs';
import { defaultAdapterContext } from '../src/sources/index';

const runId = '00000000-0000-0000-0000-000000000001';

async function invoke(id: string, exists: boolean, themes: ThemeStore | undefined) {
  const store = {
    async getRun() { return exists ? { id, status: 'completed', demo: false, params: { keywords: [], sinceDays: 1, maxResults: 1 }, startedAt: '2026-10-01T00:00:00Z', finishedAt: '2026-10-01T00:01:00Z', seller: { productName: 'x', problemDescription: 'x', idealCustomer: null, competitors: [] }, sources: [], signalCount: 0 } : null; },
  } as unknown as RunStore;
  const router = createRunsRouter({ store, adapters: [], ctx: defaultAdapterContext(), themes });
  const handler = router.stack.find((layer) => layer.route?.path === '/runs/:runId/themes')?.route?.stack[0]?.handle;
  if (!handler) throw new Error('Themes handler not registered');
  let statusCode = 0;
  let body: unknown;
  const req = { params: { runId: id } } as unknown as Request;
  const res = { status(code: number) { statusCode = code; return this; }, json(value: unknown) { body = value; return this; } } as unknown as Response;
  await handler(req, res, () => {});
  return { statusCode, body };
}

describe('GET /runs/:runId/themes', () => {
  it('rejects an invalid run id', async () => {
    expect(await invoke('bad', true, undefined)).toEqual({ statusCode: 400, body: { error: 'Invalid run id' } });
  });
  it('returns 404 when the run does not exist', async () => {
    expect(await invoke(runId, false, undefined)).toEqual({ statusCode: 404, body: { error: 'Run not found' } });
  });
  it('returns an empty list when no theme store is configured', async () => {
    expect(await invoke(runId, true, undefined)).toEqual({ statusCode: 200, body: { themes: [] } });
  });
  it('returns themes for an existing run', async () => {
    const themes = [{ id: 't', runId, competitor: 'Acme', title: 'Acme: search', summary: '3 signals', quotes: [], members: [], sampleData: false }];
    const themeStore = { async listThemes() { return themes; } } as unknown as ThemeStore;
    expect(await invoke(runId, true, themeStore)).toEqual({ statusCode: 200, body: { themes } });
  });
});
